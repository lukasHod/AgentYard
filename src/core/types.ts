import type { PlanetTextureName } from './planetTextures'
import type { AgentCapabilities, AgentKind, RuntimeKind } from './plugins'

// Shared types used by both server and client.
// Authoritative shapes for planets, workflows, agents, messages.
// Keep this file dependency-free.

export type AgentState =
  | 'idle'
  | 'thinking'
  | 'tool_running'
  | 'awaiting_clarification'
  | 'done'
  | 'failed'

export type PlanetState =
  | 'idle'
  | 'analyzing'
  | 'developing'
  | 'deploying'
  | 'awaiting_clarification'
  | 'ready_to_liftoff'

export type AgentRole = 'leader' | 'drone' | 'free'

// Workflow shapes live in core/schema.ts (Zod-derived). Don't redefine here.

export interface Planet {
  id: number
  name: string
  projectPath: string
  workflowId: number
  state: PlanetState
  createdAt: number
}

export interface SessionDescriptor {
  id: string
  role: AgentRole
  label?: string
  state: AgentState
  /**
   * Which agent backend powers this session. Always `'claude-sdk'` until the
   * CLI adapters land in later phases; sent over the wire so the UI can switch
   * tool panes / cost badges based on capabilities below.
   */
  agentKind: AgentKind
  runtimeKind: RuntimeKind
  capabilities: AgentCapabilities
}

export type NodeRunStatus = 'pending' | 'running' | 'complete' | 'failed'

export interface RunSnapshot {
  runId: string
  task: string
  nodeIds: string[]
  nodeStates: Record<string, NodeRunStatus>
  nodeSummaries: Record<string, string>
  finalSummary?: string
  error?: string
  /** Phase 7: which feature this run belongs to. Null for ad-hoc /api/runs
   *  invocations. Sent over the wire so the dashboard can group runs. */
  featureId?: number | null
  /** Phase 7: planet that owns the feature, when known. */
  planetId?: number | null
}

export interface PlanetSummary {
  id: number
  name: string
  projectPath: string
  workflowId: number | null
  state: string
  createdAt: number
  texture: PlanetTextureName
  hasClouds: boolean
  /** True if projectPath exists on disk (computed server-side at read time). */
  pathExists: boolean
}

export interface FeatureSummary {
  id: number
  planetId: number
  name: string
  task: string
  description: string | null
  chatName: string | null
  branch: string | null
  worktreePath: string | null
  status: 'idle' | 'running' | 'done' | 'complete' | 'failed' | 'pending' | (string & {})
  finalSummary: string | null
  error: string | null
  workflowId: number
  createdAt: number
}

export interface HandoffSummary {
  handoffBranch: string
  featureBranch: string | null
  featureName: string
  shortDescription: string
  sender: string
  timestamp: number
}

export type TerminalProfileId =
  | 'claude-cli'
  | 'codex-cli'
  | 'powershell'
  | 'unix-shell'
  | 'custom'

export type TerminalSessionState = 'running' | 'exited' | 'killed' | 'runtime_lost' | 'failed'

export interface TerminalSessionDescriptor {
  id: string
  profileId: TerminalProfileId
  runtimeKind: 'pty'
  planetId: number | null
  featureId: number | null
  workflowRunId: string | null
  nodeRunId: string | null
  agentSessionId: string | null
  role: string | null
  cwd: string | null
  argv: string[]
  state: TerminalSessionState
  exitCode: number | null
  exitSignal: number | null
  pid: number | null
  createdAt: number
  updatedAt: number
  lastStartedAt: number | null
  lastExitedAt: number | null
}

export interface TerminalStartRequest {
  sessionId?: string
  profileId: TerminalProfileId
  argv?: string[]
  cwd?: string
  env?: Record<string, string>
  planetId?: number
  featureId?: number
  workflowRunId?: string
  nodeRunId?: string
  agentSessionId?: string
  role?: string
  cols?: number
  rows?: number
}

// Wire protocol — messages over Socket.IO.
// Server → Client events
export interface ServerEvents {
  'session:list':     SessionDescriptor[]
  'session:added':    SessionDescriptor
  'session:removed':  { id: string }
  'terminal:list':    TerminalSessionDescriptor[]
  'terminal:session:added': TerminalSessionDescriptor
  'terminal:session:update': TerminalSessionDescriptor
  'terminal:session:removed': { sessionId: string }
  'terminal:data':    { sessionId: string; data: string; timestamp: number }
  'terminal:snapshot': { sessionId: string; data: string; state: TerminalSessionState }
  'terminal:exit':    { sessionId: string; code: number | null; signal: number | null; timestamp: number }
  'agent:message':    { agentRunId: string; role: 'assistant' | 'user' | 'system'; content: string; timestamp: number }
  'agent:state':      { agentRunId: string; state: AgentState }
  /** Phase 3: agent invoked a tool. Only emitted by adapters whose
   *  capabilities.supports_structured_events is true. */
  'agent:tool_use':   { agentRunId: string; tool: string; toolUseId: string; input: unknown; timestamp: number }
  /** Phase 3: tool returned a result. */
  'agent:tool_result':{ agentRunId: string; tool: string; toolUseId: string; output: unknown; isError?: boolean; timestamp: number }
  /** Phase 3: per-turn cost report. Only emitted by adapters whose
   *  capabilities.supports_cost is true. */
  'agent:cost':       { agentRunId: string; inputTokens: number; outputTokens: number; timestamp: number }
  'planet:state':     { planetId: number; state: PlanetState }
  'clarification:requested': { agentRunId: string; toolUseId: string; question: string }
  'clarification:resolved':  { agentRunId: string; toolUseId: string }
  'run:snapshot':     RunSnapshot
  /** Phase 7: emitted on connection so a dashboard tab sees every in-flight
   *  run, not just the most recent one. Empty array means no active runs. */
  'run:snapshot:list': RunSnapshot[]
  'run:started':      { runId: string; task: string; nodeIds: string[] }
  'node:started':     { runId: string; nodeId: string; title: string }
  'node:complete':    { runId: string; nodeId: string; title: string; summary: string; outputs?: Record<string, string> }
  'node:skipped':     { runId: string; nodeId: string; title: string }
  'run:complete':     { runId: string; finalSummary: string }
  'run:failed':       { runId: string; nodeId?: string; error: string }
  'planet:created':   PlanetSummary
  'planet:deleted':   { id: number }
  'feature:created':  FeatureSummary
  'feature:updated':  FeatureSummary
  'feature:deleted':  { id: number }
  'handoff:created':  HandoffSummary
  'handoff:pickedup': { handoffBranch: string; feature: FeatureSummary }
  'handoff:cancelled': { handoffBranch: string }
  // ── Sandbox test-run events ──
  // Scoped so the normal Run view + galaxy don't ever pick them up. Every payload
  // carries testRunId so the modal can filter to the one it's watching.
  'test-run:started':                  { testRunId: string; nodeIds: string[]; task: string; scope: 'workflow' | 'node' }
  'test-run:complete':                 { testRunId: string; finalSummary: string }
  'test-run:failed':                   { testRunId: string; error: string; nodeId?: string }
  'test-run:node:started':             { testRunId: string; nodeId: string; title: string }
  'test-run:node:complete':            { testRunId: string; nodeId: string; title: string; summary: string }
  'test-run:node:skipped':             { testRunId: string; nodeId: string; title: string }
  'test-run:session:added':            { testRunId: string; descriptor: SessionDescriptor }
  'test-run:session:removed':          { testRunId: string; id: string }
  'test-run:agent:message':            { testRunId: string; agentRunId: string; role: 'assistant' | 'user' | 'system'; content: string; timestamp: number }
  'test-run:agent:state':              { testRunId: string; agentRunId: string; state: AgentState }
  'test-run:clarification:requested':  { testRunId: string; agentRunId: string; toolUseId: string; question: string }
  'test-run:clarification:resolved':   { testRunId: string; agentRunId: string; toolUseId: string }
  'test-run:teardown':                 { testRunId: string }
}

// Client → Server events
export interface ClientEvents {
  'agent:send':          { agentRunId: string; content: string }
  'clarification:reply': { agentRunId: string; toolUseId: string; answer: string }
  'terminal:start':      TerminalStartRequest
  'terminal:attach':     { sessionId: string }
  'terminal:detach':     { sessionId: string }
  'terminal:input':      { sessionId: string; data: string }
  'terminal:resize':     { sessionId: string; cols: number; rows: number }
  'terminal:kill':       { sessionId: string }
  'terminal:restart':    { sessionId: string }
  'terminal:delete':     { sessionId: string }
  // ── Sandbox test-run client→server messages ──
  // Forwarded by the server to the test-run's isolated SessionManager.
  'test-run:agent:send':           { testRunId: string; agentRunId: string; content: string }
  'test-run:clarification:reply':  { testRunId: string; agentRunId: string; toolUseId: string; answer: string }
}
