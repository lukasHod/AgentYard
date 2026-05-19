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

export interface DroneSlot {
  role: string
  requiredSkills: string[]
  required: boolean
}

export interface WorkflowNode {
  id: string
  kind: 'analyze' | 'develop' | 'deploy' | 'custom'
  prompt: string
  skills: string[]
  drones: DroneSlot[]
  inputs: string[]
  outputs: string[]
}

export interface WorkflowEdge {
  from: string
  to: string
}

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

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
}

// Client → Server events
export interface ClientEvents {
  'agent:send':          { agentRunId: string; content: string }
  'clarification:reply': { agentRunId: string; toolUseId: string; answer: string }
}
