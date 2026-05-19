import { z } from 'zod/v4'

export const DroneSlotSchema = z.object({
  role: z.string().min(1),
  requiredSkills: z.array(z.string()).default([]),
  required: z.boolean().default(true),
})

export const ToolPresetSchema = z.enum(['none', 'claude_code'])

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
  /**
   * Built-in tool preset for this node's drones. 'none' = just custom tools
   * (request_clarification). 'claude_code' = full Read/Edit/Write/Glob/Grep/Bash —
   * use for nodes that should actually modify files in the worktree.
   */
  toolPreset: ToolPresetSchema.default('none'),
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
      toolPreset: 'none',
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

Your job: get a working implementation into the repo. The implementer and tester drones have the full Claude Code toolset (Read, Edit, Write, Glob, Grep, Bash) rooted in a feature worktree.

DELEGATION RULES — read carefully:
1. When you call assign_task, the instruction MUST be an imperative that the drone executes by CALLING TOOLS, not by describing. Write instructions like:
   "Use the Write tool to create FILE.ext at the repo root with this exact content: <content>. After writing, use Read to confirm the file exists."
2. Do NOT delegate descriptive work like "describe how to..." or "explain the approach". Drones that describe instead of doing are a failure.
3. After the implementer completes, delegate the tester to VERIFY by using Read/Bash to inspect what the implementer actually produced.
4. Only after both drones have actually performed file work, call mark_node_complete with a 1–2 paragraph summary of WHAT WAS WRITTEN TO DISK (file paths + brief description).`,
      skills: [],
      drones: [
        { role: 'implementer', requiredSkills: [], required: true },
        { role: 'tester', requiredSkills: [], required: true },
      ],
      toolPreset: 'claude_code',
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

Your job: commit the changes from the develop phase. The deploy drone has Bash tool access in the feature worktree.

DELEGATION RULES:
1. Send the deploy drone an imperative instruction that REQUIRES it to call Bash. For example:
   "Run \`git status\` to confirm changes are present. If there are changes, run \`git add -A && git commit -m 'agentyard: <short summary>'\` to commit them. Then run \`git log -1 --format=%H\` to get the commit SHA and report it back."
2. After the drone completes, call mark_node_complete with a 2–3 sentence release note that includes the commit SHA the drone reported. Do NOT push or open a PR (manual user step for now).`,
      skills: [],
      drones: [{ role: 'deployer', requiredSkills: [], required: true }],
      toolPreset: 'claude_code',
      position: { x: 700, y: 0 },
    },
  ],
  edges: [
    { from: 'analyze', to: 'develop' },
    { from: 'develop', to: 'deploy' },
  ],
}
