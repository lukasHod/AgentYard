import { z } from 'zod/v4'

export const DroneSlotSchema = z.object({
  role: z.string().min(1),
  requiredSkills: z.array(z.string()).default([]),
  required: z.boolean().default(true),
})

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['analyze', 'develop', 'deploy', 'custom']),
  /** Display title shown in the editor and in the chat tabs. */
  title: z.string().min(1),
  /**
   * Leader system prompt for this node. May contain template tokens:
   *   {task}             — the run's user-provided task
   *   {upstream_outputs} — concatenated summaries of upstream nodes
   */
  prompt: z.string().min(1),
  /** Skill names attached to this node — passed into drone prompts in later phases. */
  skills: z.array(z.string()).default([]),
  /** Drone slots. The leader fills tasking; this is the workflow-defined roster. */
  drones: z.array(DroneSlotSchema).default([]),
  /** Canvas position for the React Flow editor. */
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
})

export const WorkflowEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
})

export const WorkflowGraphSchema = z.object({
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
})

export const WorkflowSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  graph: WorkflowGraphSchema,
  isTemplate: z.boolean().default(false),
})

export type DroneSlot = z.infer<typeof DroneSlotSchema>
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>
export type Workflow = z.infer<typeof WorkflowSchema>

/**
 * The default workflow that ships with AgentYard: a three-node pipeline
 * from analyze (planning) through develop (execution) to deploy (handoff).
 */
export const DEFAULT_WORKFLOW_GRAPH: WorkflowGraph = {
  nodes: [
    {
      id: 'analyze',
      kind: 'analyze',
      title: 'Analyze',
      prompt: `You are the LEADER of the ANALYZE phase. The user provided this task:

{task}

Your job: produce a concise plan describing what needs to be built and how. Delegate to the planner drone to draft a 3-bullet plan, and to the reviewer drone to call out any obvious gaps in one sentence. Then call mark_node_complete with the final plan as the summary.`,
      skills: [],
      drones: [
        { role: 'planner', requiredSkills: [], required: true },
        { role: 'reviewer', requiredSkills: [], required: true },
      ],
      position: { x: 0, y: 0 },
    },
    {
      id: 'develop',
      kind: 'develop',
      title: 'Develop',
      prompt: `You are the LEADER of the DEVELOP phase. The original task was:

{task}

The analyze phase produced this plan:

{upstream_outputs}

Your job: turn the plan into a concrete output. Delegate to the implementer drone to describe the implementation in ~5 lines, and to the tester drone to list 3 verification steps. Then call mark_node_complete with the combined result.`,
      skills: [],
      drones: [
        { role: 'implementer', requiredSkills: [], required: true },
        { role: 'tester', requiredSkills: [], required: true },
      ],
      position: { x: 350, y: 0 },
    },
    {
      id: 'deploy',
      kind: 'deploy',
      title: 'Deploy',
      prompt: `You are the LEADER of the DEPLOY phase. The original task was:

{task}

The develop phase produced this output:

{upstream_outputs}

Your job: produce a one-paragraph "release note" summarizing what was built and how to verify it. Delegate to the deploy drone to draft the note. Then call mark_node_complete with the release note as the summary.`,
      skills: [],
      drones: [{ role: 'deployer', requiredSkills: [], required: true }],
      position: { x: 700, y: 0 },
    },
  ],
  edges: [
    { from: 'analyze', to: 'develop' },
    { from: 'develop', to: 'deploy' },
  ],
}
