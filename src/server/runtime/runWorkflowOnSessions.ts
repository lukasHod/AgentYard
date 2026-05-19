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
  /** Working directory for drone sessions (typically a feature worktree). */
  cwd?: string
}

/** Spawn leader+drones for a node, run it, return the leader's result. */
async function runNodeOnSessions(
  manager: SessionManager,
  input: NodeRunInput,
): Promise<NodeRunResult> {
  const skillContext = renderSkillContext(input.skills)
  const toolPreset = input.node.toolPreset
  const droneByRole = new Map<string, Session>()
  for (const slot of input.drones) {
    const toolNote =
      toolPreset === 'claude_code'
        ? `\n\n## Workspace\nYou are running inside a git worktree at \`${input.cwd ?? 'the project root'}\`. You have the FULL Claude Code toolset: Read, Glob, Grep, Edit, Write, Bash, etc.\n\n## How to work\nWhen the leader gives you an instruction, you MUST execute it by calling tools. DO NOT describe what you would do — actually DO IT. Examples:\n- "Create file X with content Y" → call Write with the actual file path and content.\n- "Run git status" → call Bash with that command.\n- "Check if file Z exists" → call Read or Glob.\n\nIf you reply with only text (no tool calls) when the leader asks you to perform actions, you have failed your role. After completing the work, briefly describe what you actually did (in past tense, referencing the tools you used). Keep the post-work text to 3-5 lines.`
        : ''
    const basePrompt = `You are the ${slot.role.toUpperCase()} drone for the ${input.node.title} phase of an AgentYard workflow. When the leader delegates to you, perform your role. If the request is genuinely ambiguous (not just under-specified), use the request_clarification tool to ask one targeted question. Do not call tools you do not have.${toolNote}`
    const drone = manager.spawn({
      role: 'drone',
      label: `${input.node.id}/${slot.role}`,
      systemPrompt: skillContext ? `${skillContext}\n\n## Your role\n${basePrompt}` : basePrompt,
      cwd: input.cwd,
      toolPreset,
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
    cwd: opts.cwd,
    emit: opts.emit,
    runNode: (input) => runNodeOnSessions(opts.manager, input),
  })
  return runId
}
