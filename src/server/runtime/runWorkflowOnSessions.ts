import { randomUUID } from 'node:crypto'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Workflow } from '../../core/schema.js'
import {
  runWorkflow as coreRunWorkflow,
  type NodeRunInput,
  type NodeRunResult,
  type RunEvent,
} from '../../core/executor.js'
import { SessionManager } from './SessionManager.js'
import { Session } from './Session.js'
import { createAssignTaskTool } from './tools/assignTask.js'
import {
  createMarkNodeCompleteTool,
  type NodeCompleteOutputs,
} from './tools/markNodeComplete.js'
import { renderSkillContext } from '../skills.js'

export interface RunWorkflowOptions {
  workflow: Workflow
  task: string
  manager: SessionManager
  emit: (event: RunEvent) => void
}

/** Spawn leader+drones for a node, run it, return the leader's result. */
async function runNodeOnSessions(
  manager: SessionManager,
  input: NodeRunInput,
): Promise<NodeRunResult> {
  const skillContext = renderSkillContext(input.skills)
  const droneByRole = new Map<string, Session>()
  for (const slot of input.drones) {
    const basePrompt = `You are the ${slot.role.toUpperCase()} drone for the ${input.node.title} phase of an AgentYard workflow. When the leader delegates to you, perform your role in a concise way (3–6 lines unless asked for more). If the request is ambiguous, use the request_clarification tool. Do not call tools you do not have.`
    const drone = manager.spawn({
      role: 'drone',
      label: `${input.node.id}/${slot.role}`,
      systemPrompt: skillContext ? `${skillContext}\n\n## Your role\n${basePrompt}` : basePrompt,
    })
    droneByRole.set(slot.role, drone)
  }

  let resolveResult: ((r: NodeRunResult) => void) | null = null
  const result = new Promise<NodeRunResult>((resolve) => {
    resolveResult = resolve
  })

  const onComplete = (r: NodeCompleteOutputs) => {
    resolveResult?.({ summary: r.summary, outputs: r.outputs })
    resolveResult = null
  }

  const assignTaskTool = createAssignTaskTool({
    resolveDrone: (target) => droneByRole.get(target),
    rosterDescription: [...droneByRole.keys()].join(', '),
  })
  const markCompleteTool = createMarkNodeCompleteTool(onComplete)

  manager.spawn({
    role: 'leader',
    label: `${input.node.id}/leader`,
    systemPrompt: input.prompt,
    extraTools: [assignTaskTool, markCompleteTool] as SdkMcpToolDefinition<any>[],
  }).sendUserMessage(
    'Begin executing this workflow node. Follow your instructions, delegate to drones, then call mark_node_complete with the summary.',
  )

  return result
}

export async function runWorkflowOnSessions(opts: RunWorkflowOptions): Promise<string> {
  const runId = randomUUID()
  await coreRunWorkflow(opts.workflow, {
    runId,
    task: opts.task,
    emit: opts.emit,
    runNode: (input) => runNodeOnSessions(opts.manager, input),
  })
  return runId
}
