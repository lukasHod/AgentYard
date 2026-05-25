import { randomUUID } from 'node:crypto'
import { SessionManager } from './SessionManager.js'
import type { SessionDescriptor } from './SessionManager.js'
import type { SessionEvent } from './Session.js'
import { runWorkflowOnSessions } from './runWorkflowOnSessions.js'
import { createTestWorktree, removeTestWorktree } from './worktrees.js'
import type { Workflow, WorkflowNode } from '../../core/schema.js'
import type { Ship } from '../ships.js'
import type { TypedIOServer } from '../socketTypes.js'

export interface TestRunStartOptions {
  ship: Ship
  workflow: Workflow
  task: string
  scope: 'workflow' | 'node'
  /** Required when scope === 'node'. */
  nodeId?: string
  /** Only meaningful for scope === 'node'. Empty string by default. */
  upstreamOutputs?: string
}

interface TestRunState {
  testRunId: string
  ship: Ship
  manager: SessionManager
  worktreePath: string
  worktreeBranch: string
  status: 'running' | 'completed' | 'failed' | 'aborted'
  aborted: boolean
  /** Detaches all manager listeners — called at teardown to break leaks. */
  detach: () => void
}

/**
 * Owns all in-flight sandbox test runs.
 *
 * Each test run gets:
 *   - Its own disposable git worktree off the ship's current HEAD
 *   - Its own SessionManager (no overlap with the real run state)
 *   - Scoped socket.io events (`test-run:*`) carrying its testRunId
 *
 * Nothing here writes to SQLite. The full transcript is in-memory only;
 * once the modal is closed and the run torn down, it's gone.
 */
export class TestRunRegistry {
  private runs = new Map<string, TestRunState>()

  constructor(private io: TypedIOServer) {}

  /** Kick off a new test run. Returns the testRunId immediately; the run executes async. */
  async start(opts: TestRunStartOptions): Promise<string> {
    const testRunId = `test-${randomUUID().slice(0, 8)}`
    const { ship, workflow, task, scope, nodeId, upstreamOutputs = '' } = opts

    const wfToRun = buildWorkflowForScope(workflow, scope, nodeId, upstreamOutputs)
    const wt = await createTestWorktree({ shipPath: ship.projectPath, testRunId })

    const manager = new SessionManager()
    const detach = this.wireManagerToSocket(manager, testRunId)

    const state: TestRunState = {
      testRunId,
      ship,
      manager,
      worktreePath: wt.path,
      worktreeBranch: wt.branch,
      status: 'running',
      aborted: false,
      detach,
    }
    this.runs.set(testRunId, state)

    // Kick off async; do NOT await here — caller wants the runId now.
    void this.runOnce(state, wfToRun, task, scope)

    return testRunId
  }

  /** Best-effort abort — kills sessions immediately; teardown runs in finally. */
  async abort(testRunId: string): Promise<void> {
    const state = this.runs.get(testRunId)
    if (!state || state.aborted) return
    state.aborted = true
    state.status = 'aborted'
    try {
      await state.manager.destroyAll()
    } catch {
      // best effort
    }
  }

  /** Abort every in-flight test run in parallel. Used by graceful shutdown. */
  async abortAll(): Promise<void> {
    await Promise.allSettled([...this.runs.keys()].map((id) => this.abort(id)))
  }

  /** Forward a barge-in message to a specific agent in the sandbox SessionManager. */
  sendToAgent(testRunId: string, agentRunId: string, content: string): boolean {
    const state = this.runs.get(testRunId)
    const sess = state?.manager.get(agentRunId)
    if (!sess) return false
    sess.sendUserMessage(content)
    return true
  }

  /** Resolve a clarification raised by an agent in the sandbox. */
  replyClarification(
    testRunId: string,
    agentRunId: string,
    toolUseId: string,
    answer: string,
  ): boolean {
    const state = this.runs.get(testRunId)
    const sess = state?.manager.get(agentRunId)
    if (!sess) return false
    return sess.resolveClarification(toolUseId, answer)
  }

  get(testRunId: string): TestRunState | undefined {
    return this.runs.get(testRunId)
  }

  // ── internals ──

  private async runOnce(
    state: TestRunState,
    workflow: Workflow,
    task: string,
    scope: 'workflow' | 'node',
  ) {
    const { testRunId } = state
    try {
      this.io.emit('test-run:started', {
        testRunId,
        nodeIds: workflow.graph.nodes.map((n) => n.id),
        task,
        scope,
      })

      await runWorkflowOnSessions({
        workflow,
        task,
        manager: state.manager,
        ctx: { shipProjectPath: state.ship.projectPath },
        cwd: state.worktreePath,
        emit: (ev) => {
          if (state.aborted) return
          switch (ev.type) {
            case 'node:started':
              this.io.emit('test-run:node:started', {
                testRunId,
                nodeId: ev.nodeId,
                title: ev.title,
              })
              break
            case 'node:complete':
              this.io.emit('test-run:node:complete', {
                testRunId,
                nodeId: ev.nodeId,
                title: ev.title,
                summary: ev.summary,
              })
              break
            case 'node:skipped':
              this.io.emit('test-run:node:skipped', {
                testRunId,
                nodeId: ev.nodeId,
                title: ev.title,
              })
              break
            case 'run:complete':
              if (state.status === 'running') state.status = 'completed'
              this.io.emit('test-run:complete', {
                testRunId,
                finalSummary: ev.finalSummary,
              })
              break
            case 'run:failed':
              if (state.status === 'running') state.status = 'failed'
              this.io.emit('test-run:failed', {
                testRunId,
                nodeId: ev.nodeId,
                error: ev.error,
              })
              break
          }
        },
      })
    } catch (err) {
      if (state.status === 'running') {
        state.status = state.aborted ? 'aborted' : 'failed'
        const msg = err instanceof Error ? err.message : String(err)
        this.io.emit('test-run:failed', { testRunId, error: msg })
      }
    } finally {
      await this.teardown(state)
    }
  }

  private wireManagerToSocket(manager: SessionManager, testRunId: string): () => void {
    const onSessionAdded = (desc: SessionDescriptor) => {
      this.io.emit('test-run:session:added', { testRunId, descriptor: desc })
    }
    const onSessionRemoved = (ev: { id: string }) => {
      this.io.emit('test-run:session:removed', { testRunId, id: ev.id })
    }
    const onSessionEvent = (ev: SessionEvent) => {
      const id = ev.agentRunId
      switch (ev.type) {
        case 'message':
          this.io.emit('test-run:agent:message', {
            testRunId,
            agentRunId: id,
            role: ev.message.role,
            content: ev.message.text,
            timestamp: ev.message.timestamp,
          })
          break
        case 'state':
          this.io.emit('test-run:agent:state', {
            testRunId,
            agentRunId: id,
            state: ev.state,
          })
          break
        case 'clarification:requested':
          this.io.emit('test-run:clarification:requested', {
            testRunId,
            agentRunId: id,
            toolUseId: ev.req.id,
            question: ev.req.question,
          })
          break
        case 'clarification:resolved':
          this.io.emit('test-run:clarification:resolved', {
            testRunId,
            agentRunId: id,
            toolUseId: ev.id,
          })
          break
      }
    }
    manager.on('session:added', onSessionAdded)
    manager.on('session:removed', onSessionRemoved)
    manager.on('event', onSessionEvent)
    return () => {
      manager.off('session:added', onSessionAdded)
      manager.off('session:removed', onSessionRemoved)
      manager.off('event', onSessionEvent)
    }
  }

  private async teardown(state: TestRunState) {
    const { testRunId } = state
    try {
      await state.manager.destroyAll()
    } catch {
      // best effort
    }
    state.detach()
    try {
      await removeTestWorktree(state.ship.projectPath, state.worktreePath, state.worktreeBranch)
    } catch {
      // best effort
    }
    this.runs.delete(testRunId)
    this.io.emit('test-run:teardown', { testRunId })
  }
}

/**
 * For scope='node', synthesize a 1-node workflow whose only node has
 * {upstream_outputs} pre-substituted with the user's input. The executor
 * will see this node as a root with no incoming edges → upstreamText is
 * empty → the second `replaceAll('{upstream_outputs}', '')` is a no-op.
 *
 * For scope='workflow', return the workflow unchanged.
 */
function buildWorkflowForScope(
  workflow: Workflow,
  scope: 'workflow' | 'node',
  nodeId: string | undefined,
  upstreamOutputs: string,
): Workflow {
  if (scope === 'workflow') return workflow
  if (!nodeId) throw new Error('nodeId required for scope=node')
  const node = workflow.graph.nodes.find((n) => n.id === nodeId)
  if (!node) throw new Error(`Node ${nodeId} not found in workflow ${workflow.id}`)
  return {
    ...workflow,
    graph: {
      nodes: [prerenderUpstream(node, upstreamOutputs)],
      edges: [],
    },
  }
}

/** Pre-substitute only `{upstream_outputs}` in a node's prompt + script args. */
function prerenderUpstream(node: WorkflowNode, upstreamOutputs: string): WorkflowNode {
  const sub = (s: string) => s.replaceAll('{upstream_outputs}', upstreamOutputs)
  return {
    ...node,
    prompt: node.prompt !== undefined ? sub(node.prompt) : undefined,
    args: node.args
      ? Object.fromEntries(Object.entries(node.args).map(([k, v]) => [k, sub(v)]))
      : undefined,
  }
}
