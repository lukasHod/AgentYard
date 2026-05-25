import { randomUUID } from 'node:crypto'
import type { McpServerConfig, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Workflow } from '../../core/schema.js'
import {
  runWorkflow as coreRunWorkflow,
  type NodeRunInput,
  type NodeRunResult,
  type RunEvent,
} from '../../core/executor.js'
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

type AnyTool = SdkMcpToolDefinition<any>

export interface RunWorkflowOptions {
  workflow: Workflow
  task: string
  manager: SessionManager
  /** Library-scan context — needs shipProjectPath for ship-scoped tool resolution. */
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
}

const DEFAULT_AI_NODE_TIMEOUT_MS = 30 * 60 * 1000 // 30 min

interface RunAINodeDeps {
  manager: SessionManager
  ctx: ScanContext
  input: NodeRunInput
  aiNodeTimeoutMs: number
  signal?: AbortSignal
}

/** Spawn leader + agents for an AI node, run it, return the leader's result. */
async function runAINodeOnSessions(deps: RunAINodeDeps): Promise<NodeRunResult> {
  const { manager, ctx, input, aiNodeTimeoutMs, signal } = deps
  const node = input.node
  const agentNames = node.agents ?? []
  if (agentNames.length === 0) {
    throw new Error(`AI node ${node.id} has no agents connected`)
  }

  // Resolve each agent name from the library (ship → global → error), then
  // spawn drones in parallel (each drone resolves its own attached tools).
  const resolvedAgents = await Promise.all(
    agentNames.map(async (name) => {
      const r = await resolveTool('agent', name, ctx)
      if (!r || r.type !== 'agent') {
        throw new Error(`Agent "${name}" not found in ship or global tool library`)
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

  const leader = manager.spawn({
    role: 'leader',
    label: `${node.id}/leader`,
    systemPrompt: input.prompt,
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
      })
    },
  })
  return runId
}
