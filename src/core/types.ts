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

// Wire protocol — messages over Socket.IO.
// Server → Client events
export interface ServerEvents {
  'agent:message': { agentRunId: number; role: 'assistant' | 'user' | 'system'; content: string; timestamp: number }
  'agent:state':   { agentRunId: number; state: AgentState }
  'ship:state':    { shipId: number; state: ShipState }
  'clarification:requested': { agentRunId: number; toolUseId: string; question: string }
  'clarification:resolved':  { agentRunId: number; toolUseId: string }
  'ping': { count: number; at: number }
}

// Client → Server events
export interface ClientEvents {
  'agent:send':    { agentRunId: number; content: string }
  'clarification:reply': { agentRunId: number; toolUseId: string; answer: string }
}
