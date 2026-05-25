// Shared types used by both server and client.
// Authoritative shapes for ships, workflows, agents, messages.
// Keep this file dependency-free.

export type AgentState =
  | 'idle'
  | 'thinking'
  | 'tool_running'
  | 'awaiting_clarification'
  | 'done'
  | 'failed'

export type ShipState =
  | 'idle'
  | 'analyzing'
  | 'developing'
  | 'deploying'
  | 'awaiting_clarification'
  | 'ready_to_liftoff'

export type AgentRole = 'leader' | 'drone' | 'free'

// Workflow shapes live in core/schema.ts (Zod-derived). Don't redefine here.

export interface Ship {
  id: number
  name: string
  projectPath: string
  workflowId: number
  state: ShipState
  createdAt: number
}

export interface SessionDescriptor {
  id: string
  role: AgentRole
  label?: string
  state: AgentState
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
}

export interface ShipSummary {
  id: number
  name: string
  projectPath: string
  workflowId: number | null
  state: string
  createdAt: number
  /** True if projectPath exists on disk (computed server-side at read time). */
  pathExists: boolean
}

export interface FeatureSummary {
  id: number
  shipId: number
  name: string
  task: string
  branch: string | null
  worktreePath: string | null
  status: 'pending' | 'running' | 'complete' | 'failed'
  finalSummary: string | null
  error: string | null
  workflowId: number
  createdAt: number
}

// Wire protocol — messages over Socket.IO.
// Server → Client events
export interface ServerEvents {
  'session:list':     SessionDescriptor[]
  'session:added':    SessionDescriptor
  'session:removed':  { id: string }
  'agent:message':    { agentRunId: string; role: 'assistant' | 'user' | 'system'; content: string; timestamp: number }
  'agent:state':      { agentRunId: string; state: AgentState }
  'ship:state':       { shipId: number; state: ShipState }
  'clarification:requested': { agentRunId: string; toolUseId: string; question: string }
  'clarification:resolved':  { agentRunId: string; toolUseId: string }
  'run:snapshot':     RunSnapshot
  'run:started':      { runId: string; task: string; nodeIds: string[] }
  'node:started':     { runId: string; nodeId: string; title: string }
  'node:complete':    { runId: string; nodeId: string; title: string; summary: string; outputs?: Record<string, string> }
  'run:complete':     { runId: string; finalSummary: string }
  'run:failed':       { runId: string; nodeId?: string; error: string }
  'ship:created':     ShipSummary
  'ship:deleted':     { id: number }
  'feature:created':  FeatureSummary
  'feature:updated':  FeatureSummary
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
  // ── Sandbox test-run client→server messages ──
  // Forwarded by the server to the test-run's isolated SessionManager.
  'test-run:agent:send':           { testRunId: string; agentRunId: string; content: string }
  'test-run:clarification:reply':  { testRunId: string; agentRunId: string; toolUseId: string; answer: string }
}
