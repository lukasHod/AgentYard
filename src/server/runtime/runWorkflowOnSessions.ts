import { randomUUID } from 'node:crypto'
import type { McpServerConfig, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Workflow } from '../../core/schema.js'
import {
  runWorkflow as coreRunWorkflow,
  type NodeRunInput,
  type NodeRunResult,
  type RunEvent,
} from '../../core/executor.js'
import type { AgentKind } from '../../core/plugins.js'
import { SessionManager } from './SessionManager.js'
import { Session, type SessionEvent } from './Session.js'
import { createAssignTaskTool } from './tools/assignTask.js'
import { createMarkNodeCompleteTool } from './tools/markNodeComplete.js'
import { createMarkCompleteGate } from './markCompleteGate.js'
import { createScriptTool } from './tools/scriptTool.js'
import { resolveTool } from '../tools/resolver.js'
import type { ScanContext } from '../tools/scanner.js'
import type { AgentTool, McpTool, ScriptTool, SkillTool } from '../../core/tools.js'
import { resolveEnvVarsDeep } from '../secrets.js'
import { runScriptNode } from './scriptRuntime.js'
import { resolveAgentKind } from '../agentKindCascade.js'
import type { TerminalSessionManager } from './TerminalSessionManager.js'
import type { TerminalManagerEvent } from './TerminalSessionManager.js'
import { bridgeRegistry } from '../bridgeRegistry.js'
import { reviewGateRegistry } from '../reviewGateRegistry.js'
import {
  createLoopRun,
  updateLoopRun,
  createApproval,
  reviewLoopEmitter,
} from '../reviewLoopStore.js'
import type { TypedIOServer } from '../socketTypes.js'

type AnyTool = SdkMcpToolDefinition<any>

export interface RunWorkflowOptions {
  workflow: Workflow
  task: string
  manager: SessionManager
  /** Library-scan context — needs planetProjectPath for planet-scoped tool resolution. */
  ctx: ScanContext
  emit: (event: RunEvent) => void
  /** Working directory for AI drones / script nodes (feature worktree). */
  cwd?: string
  /**
   * Reject AI-node `mark_node_complete` waits after this many ms. Default
   * 30 min; set <= 0 to disable. Script nodes have their own timeout
   * inside scriptArgv.runProcess.
   */
  aiNodeTimeoutMs?: number
  /**
   * Aborts the whole run. Forwarded to the executor (per-node check) and
   * to AI-node gates / script-node spawns.
   */
  signal?: AbortSignal
  /**
   * Pre-formatted handoff context block to prepend to every AI-node leader's
   * system prompt. Set when this run is resuming a handed-off feature.
   */
  handoffContext?: string
  /**
   * Feature id — used by resolveAgentKind to walk the cascade and by terminal
   * sessions to tag which feature they belong to. Omit for ad-hoc runs.
   */
  featureId?: number | null
  /** Planet id — same cascade / tagging purpose as featureId. */
  planetId?: number | null
  /**
   * Terminal session manager — required for CLI-kind AI nodes. When absent
   * and a node resolves to a CLI kind, the SDK path is used as fallback.
   */
  terminals?: TerminalSessionManager
  /**
   * Socket.IO server — used by the review loop runner to broadcast
   * `review-loop:update` events as loop state changes.
   */
  io?: TypedIOServer
}

const DEFAULT_AI_NODE_TIMEOUT_MS = 30 * 60 * 1000 // 30 min

interface RunAINodeDeps {
  manager: SessionManager
  ctx: ScanContext
  input: NodeRunInput
  aiNodeTimeoutMs: number
  signal?: AbortSignal
  handoffContext?: string
  featureId?: number | null
  planetId?: number | null
  terminals?: TerminalSessionManager
  io?: TypedIOServer
}

/** Spawn leader + agents for an AI node, run it, return the leader's result. */
async function runAINodeOnSessions(deps: RunAINodeDeps): Promise<NodeRunResult> {
  const { manager, ctx, input, aiNodeTimeoutMs, signal } = deps
  const node = input.node

  // Resolve which agent runtime this node should use.
  const agentKind = resolveAgentKind({
    nodeOverride: node.agentKind,
    featureId: deps.featureId,
    planetId: deps.planetId,
  })

  // CLI kinds (claude-code-cli, codex-cli) run in PTY terminal sessions rather
  // than in-process SDK sessions. Fall back to SDK if no terminal manager is
  // available (ad-hoc /api/runs, test runs, etc.).
  if (agentKind !== 'claude-sdk' && deps.terminals) {
    // Review loop nodes get a dedicated runner that alternates dev/review phases.
    if (node.reviewLoop) {
      return runReviewLoopNode(deps, deps.terminals, agentKind, node.reviewLoop)
    }
    return runAINodeOnTerminals(deps, deps.terminals, agentKind)
  }

  const agentNames = node.agents ?? []
  if (agentNames.length === 0) {
    throw new Error(`AI node ${node.id} has no agents connected`)
  }

  // Resolve each agent name from the library (planet → global → error), then
  // spawn drones in parallel (each drone resolves its own attached tools).
  const resolvedAgents = await Promise.all(
    agentNames.map(async (name) => {
      const r = await resolveTool('agent', name, ctx)
      if (!r || r.type !== 'agent') {
        throw new Error(`Agent "${name}" not found in planet or global tool library`)
      }
      return r.data
    }),
  )
  const drones = await Promise.all(
    resolvedAgents.map((agent) => spawnAgentDrone(manager, ctx, node.id, agent, input.cwd)),
  )
  const droneByRole = new Map<string, Session>()
  for (let i = 0; i < resolvedAgents.length; i++) {
    const agent = resolvedAgents[i]!
    droneByRole.set(agent.role || agent.name, drones[i]!)
  }

  // The gate decouples the mark_node_complete callback from session lifetime:
  // if the leader's session closes (model exit, error) without firing the tool,
  // or the per-node timeout elapses, or the run is aborted, the gate rejects
  // — keeping the executor from hanging on `await runNode(input)`.
  const gate = createMarkCompleteGate({
    nodeId: node.id,
    timeoutMs: aiNodeTimeoutMs,
    signal,
  })
  const markCompleteTool = createMarkNodeCompleteTool({
    nodeId: node.id,
    outgoingNodeIds: input.outgoingNodeIds,
    onComplete: (r) => gate.complete({ summary: r.summary, outputs: r.outputs, next: r.next }),
  })

  const assignTaskTool = createAssignTaskTool({
    resolveDrone: (target) => droneByRole.get(target),
    rosterDescription: [...droneByRole.keys()].join(', '),
  })

  const leaderPrompt = deps.handoffContext
    ? `${deps.handoffContext}\n\n${input.prompt}`
    : input.prompt
  const leader = manager.spawn({
    role: 'leader',
    label: `${node.id}/leader`,
    systemPrompt: leaderPrompt,
    runtimeTools: [assignTaskTool, markCompleteTool] as AnyTool[],
  })

  const onLeaderEvent = (ev: SessionEvent) => {
    if (ev.type === 'closed') gate.notifyClosed()
  }
  leader.on('event', onLeaderEvent)

  leader.sendUserMessage(
    'Begin executing this workflow node. Follow your instructions, delegate to agents, then call mark_node_complete with the summary.',
  )

  try {
    return await gate.result
  } finally {
    leader.off('event', onLeaderEvent)
    gate.dispose()
  }
}

/**
 * Run an AI node using PTY terminal sessions (claude-code-cli / codex-cli).
 *
 * Spawns a leader terminal with the combined system prompt + task, and one
 * additional terminal per connected agent drone (fire-and-monitor). The node
 * completes when the leader terminal process exits, or the timeout elapses.
 *
 * The bridge (Step 12 / Phase 7) will later let CLI agents report structured
 * events; for now, exit code 0 = success and we read the last 2 KB of the
 * leader transcript as the node summary.
 */
async function runAINodeOnTerminals(
  deps: RunAINodeDeps,
  terminals: TerminalSessionManager,
  agentKind: Exclude<AgentKind, 'claude-sdk'>,
): Promise<NodeRunResult> {
  const { ctx, input, aiNodeTimeoutMs, signal } = deps
  const node = input.node

  const profileId = agentKind === 'claude-code-cli' ? 'claude-cli' : 'codex-cli'

  // System prompt = the node's own prompt (leader context) + upstream outputs.
  const systemPrompt = [
    input.prompt ?? '',
    input.upstreamOutputs
      ? `\n\n## Context from upstream phases\n${input.upstreamOutputs}`
      : '',
  ].filter(Boolean).join('').trim()

  // Build argv with system prompt injected where the CLI supports it.
  const leaderArgv = buildCliArgv(agentKind, systemPrompt)

  // Spawn the leader terminal.
  const leaderSession = terminals.start({
    profileId,
    argv: leaderArgv,
    cwd: input.cwd,
    featureId: deps.featureId ?? undefined,
    planetId: deps.planetId ?? undefined,
    role: 'leader',
    env: { CLAUDECODE: '' },
  })

  // Also spawn drone terminals for each connected agent (fire-and-monitor:
  // they run independently; the workflow engine doesn't wait for them).
  const agentNames = node.agents ?? []
  if (agentNames.length > 0) {
    const resolvedAgents = await Promise.allSettled(
      agentNames.map((name) => resolveTool('agent', name, ctx)),
    )
    for (const result of resolvedAgents) {
      if (result.status !== 'fulfilled' || !result.value || result.value.type !== 'agent') continue
      const agent = result.value.data as AgentTool
      const droneArgv = buildCliArgv(agentKind, agent.prompt.trim())
      try {
        terminals.start({
          profileId,
          argv: droneArgv,
          cwd: input.cwd,
          featureId: deps.featureId ?? undefined,
          planetId: deps.planetId ?? undefined,
          role: agent.role || agent.name,
          env: { CLAUDECODE: '' },
        })
      } catch {
        // Skip a drone that fails to spawn — don't abort the whole node.
      }
    }
  }

  // Write the initial task to the leader's stdin.
  // A short delay lets the CLI process start reading before we push data.
  await new Promise<void>((resolve) => setTimeout(resolve, 300))
  terminals.write(leaderSession.id, `${input.task}\n`)

  // Race three signals:
  //   A. Bridge mark-node-complete (preferred — agent explicitly signals done)
  //   B. Leader process exit (fallback — use transcript as summary)
  //   C. Timeout / abort
  return new Promise<NodeRunResult>((resolve, reject) => {
    let settled = false

    function settle(fn: () => void) {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    // A. Bridge gate — resolved by POST /api/bridge/mark-node-complete
    const unregisterGate = bridgeRegistry.registerGate(
      leaderSession.id,
      (result) => settle(() => resolve(result)),
      (err) => settle(() => reject(err)),
    )

    // B. Process exit
    function onTerminalEvent(ev: TerminalManagerEvent) {
      if (ev.type !== 'exit' || ev.sessionId !== leaderSession.id) return
      settle(() => {
        const code = ev.code
        if (code !== null && code !== 0) {
          reject(new Error(`CLI agent (${agentKind}) exited with code ${code}`))
          return
        }
        const snapshot = terminals.snapshot(leaderSession.id)
        const raw = snapshot?.data ?? ''
        const summary = raw.trim().slice(-2000) || `${agentKind} node completed (${node.id})`
        resolve({ summary })
      })
    }
    terminals.on('terminal:event', onTerminalEvent)

    // C. Timeout / abort
    const timeoutId =
      aiNodeTimeoutMs > 0
        ? setTimeout(() => {
            settle(() => {
              void terminals.kill(leaderSession.id)
              reject(new Error(`CLI node ${node.id} timed out after ${aiNodeTimeoutMs}ms`))
            })
          }, aiNodeTimeoutMs)
        : null

    const onAbort = () => {
      settle(() => {
        void terminals.kill(leaderSession.id)
        reject(new Error('run aborted'))
      })
    }
    signal?.addEventListener('abort', onAbort)

    function cleanup() {
      unregisterGate()
      if (timeoutId !== null) clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      terminals.off('terminal:event', onTerminalEvent)
    }
  })
}

/**
 * Run an AI node as a repeating developer → reviewer loop.
 *
 * Each iteration:
 *  1. Spawn developer terminals (leader + drones, like runAINodeOnTerminals).
 *     The leader calls mark-node-complete when dev work is done.
 *  2. Spawn reviewer terminals independently. Each reviewer calls
 *     /api/bridge/submit-review when done evaluating the developer output.
 *  3. If all required reviewers approve → complete the node.
 *     If any request changes and maxIterations not reached → loop back,
 *     feeding reviewer findings into the next dev phase.
 *     If maxIterations reached → complete with the last developer summary.
 */
async function runReviewLoopNode(
  deps: RunAINodeDeps,
  terminals: TerminalSessionManager,
  agentKind: Exclude<AgentKind, 'claude-sdk'>,
  policy: NonNullable<NonNullable<(typeof deps.input.node)['reviewLoop']>>,
): Promise<NodeRunResult> {
  const { ctx, input, aiNodeTimeoutMs, signal } = deps
  const node = input.node
  const profileId = agentKind === 'claude-code-cli' ? 'claude-cli' : 'codex-cli'
  const maxIter = policy.maxIterations ?? 3
  const requiredApprovers = policy.approvalRequiredFrom ?? policy.reviewerSlots

  // Create the durable review loop run record.
  const loopRun = createLoopRun({
    nodeRunId: node.id,
    featureId: deps.featureId,
    planetId: deps.planetId,
    maxIterations: maxIter,
    developerSlots: policy.developerSlots,
    reviewerSlots: policy.reviewerSlots,
    approvalRequiredFrom: requiredApprovers,
  })
  deps.io?.emit('review-loop:update', loopRun)

  let developerSummary = ''
  let reviewFindings = ''

  for (let iteration = 1; iteration <= maxIter; iteration++) {
    if (signal?.aborted) throw new Error('run aborted')

    // ── DEVELOPER PHASE ──────────────────────────────────────────────────────

    const updatedRunDev = updateLoopRun(loopRun.id, { iteration, state: 'developers_running' })
    if (updatedRunDev) deps.io?.emit('review-loop:update', updatedRunDev)

    // Build the developer prompt. On subsequent iterations, prepend reviewer findings.
    const devPromptBase = [
      input.prompt ?? '',
      input.upstreamOutputs
        ? `\n\n## Context from upstream phases\n${input.upstreamOutputs}`
        : '',
    ].filter(Boolean).join('').trim()

    const devPrompt =
      iteration > 1 && reviewFindings
        ? `${devPromptBase}\n\n## Reviewer Feedback — Please Fix Before Proceeding\n\n${reviewFindings}`
        : devPromptBase

    const devLeaderSlot = policy.developerSlots[0]!
    const devDroneSlots = policy.developerSlots.slice(1)

    // Resolve developer agents from the library.
    const devLeaderAgent = await resolveTool('agent', devLeaderSlot, ctx)
    const leaderSystemPrompt = devLeaderAgent?.type === 'agent'
      ? buildCliArgv(agentKind, `${devPrompt}\n\n## Your Role\nYou are the development leader. Coordinate with drones, implement the required changes, then call mark-node-complete with a summary.`).join(' ')
      : undefined

    const leaderArgv = buildCliArgv(agentKind, devPrompt)
    const leaderSession = terminals.start({
      profileId,
      argv: leaderArgv,
      cwd: input.cwd,
      featureId: deps.featureId ?? undefined,
      planetId: deps.planetId ?? undefined,
      role: devLeaderSlot,
      env: { CLAUDECODE: '' },
    })

    // Spawn developer drone terminals (fire-and-monitor).
    for (const droneSlot of devDroneSlots) {
      const droneAgent = await resolveTool('agent', droneSlot, ctx)
      if (!droneAgent || droneAgent.type !== 'agent') continue
      const droneArgv = buildCliArgv(agentKind, droneAgent.data.prompt.trim())
      try {
        terminals.start({
          profileId,
          argv: droneArgv,
          cwd: input.cwd,
          featureId: deps.featureId ?? undefined,
          planetId: deps.planetId ?? undefined,
          role: droneSlot,
          env: { CLAUDECODE: '' },
        })
      } catch {
        // Skip failing drone spawns — don't abort the loop.
      }
    }

    // Write initial task message to leader stdin.
    await new Promise<void>((r) => setTimeout(r, 300))
    terminals.write(leaderSession.id, `${input.task}\n`)

    // Wait for developer leader to call mark-node-complete or exit.
    const devResult = await new Promise<NodeRunResult>((resolve, reject) => {
      let settled = false
      function settle(fn: () => void) { if (settled) return; settled = true; cleanup(); fn() }

      const unregisterGate = bridgeRegistry.registerGate(
        leaderSession.id,
        (r) => settle(() => resolve(r)),
        (e) => settle(() => reject(e)),
      )

      function onTerminalEvent(ev: TerminalManagerEvent) {
        if (ev.type !== 'exit' || ev.sessionId !== leaderSession.id) return
        settle(() => {
          const code = ev.code
          if (code !== null && code !== 0) {
            reject(new Error(`Developer leader (${devLeaderSlot}) exited with code ${code}`))
            return
          }
          const snap = terminals.snapshot(leaderSession.id)
          const raw = snap?.data ?? ''
          resolve({ summary: raw.trim().slice(-2000) || `${devLeaderSlot} completed (iteration ${iteration})` })
        })
      }
      terminals.on('terminal:event', onTerminalEvent)

      const timeoutId = aiNodeTimeoutMs > 0
        ? setTimeout(() => settle(() => {
            void terminals.kill(leaderSession.id)
            reject(new Error(`Developer phase timed out after ${aiNodeTimeoutMs}ms`))
          }), aiNodeTimeoutMs)
        : null

      const onAbort = () => settle(() => {
        void terminals.kill(leaderSession.id)
        reject(new Error('run aborted'))
      })
      signal?.addEventListener('abort', onAbort)

      function cleanup() {
        unregisterGate()
        if (timeoutId !== null) clearTimeout(timeoutId)
        signal?.removeEventListener('abort', onAbort)
        terminals.off('terminal:event', onTerminalEvent)
      }
    })

    developerSummary = devResult.summary
    updateLoopRun(loopRun.id, { developerSummary })

    // ── REVIEWER PHASE ───────────────────────────────────────────────────────

    const updatedRunRev = updateLoopRun(loopRun.id, { state: 'reviewers_running' })
    if (updatedRunRev) deps.io?.emit('review-loop:update', updatedRunRev)

    // Spawn each reviewer independently (no leader-drone hierarchy).
    const reviewerSessions: Map<string, string> = new Map() // slot → sessionId
    for (const slot of policy.reviewerSlots) {
      const reviewerAgent = await resolveTool('agent', slot, ctx)
      const reviewerPromptBase = reviewerAgent?.type === 'agent'
        ? reviewerAgent.data.prompt.trim()
        : `You are a code reviewer for the slot "${slot}".`

      const reviewContext =
        `${reviewerPromptBase}\n\n## Implementation for Review\n\n${developerSummary}\n\n` +
        `When you finish your review, call \`agentyard submit-review --decision approved\` or ` +
        `\`agentyard submit-review --decision changes-requested --findings "..."\`.`

      const reviewArgv = buildCliArgv(agentKind, reviewContext)
      try {
        const reviewSession = terminals.start({
          profileId,
          argv: reviewArgv,
          cwd: input.cwd,
          featureId: deps.featureId ?? undefined,
          planetId: deps.planetId ?? undefined,
          role: slot,
          env: {
            CLAUDECODE: '',
            AGENTYARD_LOOP_RUN_ID: loopRun.id,
            AGENTYARD_REVIEWER_SLOT: slot,
          },
        })
        reviewerSessions.set(slot, reviewSession.id)
        // Pre-create approval record linked to this terminal session.
        createApproval(loopRun.id, iteration, slot, reviewSession.id)
      } catch {
        // If a reviewer fails to spawn, skip it.
      }
    }

    // Write task prompt to each reviewer's stdin.
    await new Promise<void>((r) => setTimeout(r, 300))
    for (const sessionId of reviewerSessions.values()) {
      terminals.write(sessionId, `Please review the implementation described above.\n`)
    }

    // Wait for all required reviewers to submit their decisions.
    const decisions = await new Promise<{ reviewerSlot: string; decision: string; findings: string | null }[]>(
      (resolve, reject) => {
        const unregister = reviewGateRegistry.register(
          loopRun.id,
          requiredApprovers,
          resolve,
          reject,
          aiNodeTimeoutMs > 0 ? aiNodeTimeoutMs : undefined,
        )

        const onAbort = () => {
          unregister()
          reject(new Error('run aborted'))
        }
        signal?.addEventListener('abort', onAbort)
        // The unregister above cleans up the gate; abort listener needs manual cleanup.
        // Wrap resolve/reject to also remove the abort listener.
        void Promise.resolve().then(() => {
          // No additional cleanup needed — the gate registry handles its own removal.
        })
      },
    )

    const changesRequested = decisions.filter((d) => d.decision === 'changes_requested')
    const allApproved = requiredApprovers.every((slot) =>
      decisions.some((d) => d.reviewerSlot === slot && d.decision === 'approved'),
    )

    reviewFindings = changesRequested
      .map((d) => d.findings)
      .filter(Boolean)
      .join('\n\n')

    updateLoopRun(loopRun.id, { reviewFindings: reviewFindings || null })

    if (allApproved) {
      const finalRun = updateLoopRun(loopRun.id, { state: 'approved' })
      if (finalRun) deps.io?.emit('review-loop:update', finalRun)
      return {
        summary: `${developerSummary}\n\n## Review\n\nAll reviewers approved after ${iteration} iteration(s).`,
      }
    }

    if (iteration >= maxIter) {
      const finalRun = updateLoopRun(loopRun.id, { state: 'max_iterations_reached' })
      if (finalRun) deps.io?.emit('review-loop:update', finalRun)
      return {
        summary:
          `${developerSummary}\n\n## Review\n\nMax iterations (${maxIter}) reached.\n` +
          (reviewFindings ? `Last reviewer findings:\n${reviewFindings}` : ''),
      }
    }
  }

  // Unreachable but satisfies TS.
  return { summary: developerSummary }
}

/** Build the argv for a CLI agent, injecting the system prompt where supported. */
function buildCliArgv(agentKind: Exclude<AgentKind, 'claude-sdk'>, systemPrompt: string): string[] {
  if (agentKind === 'claude-code-cli') {
    const argv = ['claude']
    if (systemPrompt) argv.push('--append-system-prompt', systemPrompt)
    return argv
  }
  // codex-cli: no append-system-prompt flag; we'll write the context to stdin
  return ['codex']
}

/** Spawn a single drone Session for a given agent definition. */
async function spawnAgentDrone(
  manager: SessionManager,
  ctx: ScanContext,
  nodeId: string,
  agent: AgentTool,
  cwd: string | undefined,
): Promise<Session> {
  // Resolve all attached capabilities in parallel. Missing references are
  // silently dropped — they surface as "missing reference" badges in the UI.
  const [skillResults, scriptResults, mcpResults] = await Promise.all([
    Promise.all(agent.skills.map((n) => resolveTool('skill', n, ctx))),
    Promise.all(agent.scripts.map((n) => resolveTool('script', n, ctx))),
    Promise.all(agent.mcps.map((n) => resolveTool('mcp', n, ctx))),
  ])
  const skills: SkillTool[] = skillResults
    .filter((r): r is NonNullable<typeof r> => r !== null && r.type === 'skill')
    .map((r) => r.data as SkillTool)
  const scripts: ScriptTool[] = scriptResults
    .filter((r): r is NonNullable<typeof r> => r !== null && r.type === 'script')
    .map((r) => r.data as ScriptTool)
  const mcpServerConfigs: Record<string, McpServerConfig> = {}
  for (let i = 0; i < agent.mcps.length; i++) {
    const r = mcpResults[i]
    if (r && r.type === 'mcp') {
      const cfg = mcpToolToServerConfig(r.data)
      if (cfg) mcpServerConfigs[agent.mcps[i]!] = cfg
    }
  }

  // Build the system prompt: skill context + agent's own prompt + a runtime note.
  const skillContext = renderSkillContextFromTools(skills)
  const runtimeNote = `\n\n## Workspace\nYou are running inside a git worktree at \`${cwd ?? 'the project root'}\`. Paths are relative to the worktree.`
  const systemPrompt = [skillContext, agent.prompt.trim(), runtimeNote].filter(Boolean).join('\n\n')

  // Wrap user-defined scripts as MCP-style tools.
  const scriptTools = scripts.map((s) => createScriptTool({ script: s, cwd }) as AnyTool)

  const drone = manager.spawn({
    role: 'drone',
    label: `${nodeId}/${agent.role || agent.name}`,
    systemPrompt,
    cwd,
    toolPreset: agent.toolPreset,
    ...(agent.allowedTools ? { allowedTools: agent.allowedTools } : {}),
    ...(agent.model ? { model: agent.model } : {}),
    scriptTools,
    mcpServerConfigs,
  })
  return drone
}

/**
 * Convert our McpTool config to the SDK's McpServerConfig type. Strings have
 * `${env:VAR}` placeholders resolved against process.env (including any values
 * loaded from ~/.agentyard/.secrets/secrets.env at server start).
 */
function mcpToolToServerConfig(mcp: McpTool): McpServerConfig | null {
  if (mcp.transport === 'stdio') {
    if (!mcp.command) return null
    return {
      type: 'stdio',
      command: resolveEnvVarsDeep(mcp.command),
      args: resolveEnvVarsDeep(mcp.args ?? []),
      env: mcp.env ? resolveEnvVarsDeep(mcp.env) : undefined,
    } as McpServerConfig
  }
  if (mcp.transport === 'http') {
    if (!mcp.url) return null
    return {
      type: 'http',
      url: resolveEnvVarsDeep(mcp.url),
      headers: mcp.headers ? resolveEnvVarsDeep(mcp.headers) : undefined,
    } as McpServerConfig
  }
  if (mcp.transport === 'sse') {
    if (!mcp.url) return null
    return {
      type: 'sse',
      url: resolveEnvVarsDeep(mcp.url),
      headers: mcp.headers ? resolveEnvVarsDeep(mcp.headers) : undefined,
    } as McpServerConfig
  }
  return null
}

/** Render an array of SkillTools as a single "## Skills loaded" prompt block. */
function renderSkillContextFromTools(skills: SkillTool[]): string {
  if (skills.length === 0) return ''
  const blocks = skills.map(
    (s) => `### Skill: ${s.name}\n${s.description ? `_${s.description}_\n\n` : ''}${s.body}`,
  )
  return [
    '## Skills loaded',
    'You have the following skill instructions in context. Apply them throughout this task.',
    '',
    blocks.join('\n\n---\n\n'),
  ].join('\n')
}

export async function runWorkflowOnSessions(opts: RunWorkflowOptions): Promise<string> {
  const runId = randomUUID()
  const aiNodeTimeoutMs = opts.aiNodeTimeoutMs ?? DEFAULT_AI_NODE_TIMEOUT_MS
  await coreRunWorkflow(opts.workflow, {
    runId,
    task: opts.task,
    cwd: opts.cwd,
    signal: opts.signal,
    emit: opts.emit,
    runNode: (input) => {
      if (input.node.type === 'custom') return runScriptNode(input, opts.ctx, opts.signal)
      return runAINodeOnSessions({
        manager: opts.manager,
        ctx: opts.ctx,
        input,
        aiNodeTimeoutMs,
        signal: opts.signal,
        handoffContext: opts.handoffContext,
        featureId: opts.featureId,
        planetId: opts.planetId,
        terminals: opts.terminals,
        io: opts.io,
      })
    },
  })
  return runId
}
