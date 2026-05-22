import { z } from 'zod/v4'

/**
 * Two node types per the v2 design:
 *   - 'ai'     — LLM-driven. Has a system prompt, connects to agents from the
 *                ship's tool library. The leader spawns each connected agent
 *                as a drone and delegates via assign_task.
 *   - 'custom' — Deterministic. customType picks the runner; first member:
 *                'script' (runs a named script tool from the library, args
 *                substituted, stdout captured as the node's output).
 *
 * Each node carries fields only relevant to its type — the other ones stay
 * undefined.
 */
export const WorkflowNodeTypeSchema = z.enum(['ai', 'custom'])
export type WorkflowNodeType = z.infer<typeof WorkflowNodeTypeSchema>

export const CustomNodeKindSchema = z.enum(['script'])
export type CustomNodeKind = z.infer<typeof CustomNodeKindSchema>

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  /** Display title shown in the editor and in the chat tabs. */
  title: z.string().min(1),
  /** Discriminator. */
  type: WorkflowNodeTypeSchema,

  // ── type === 'ai' ──
  /**
   * Leader system prompt for this node. Supports template tokens:
   *   {task}             — the run's user-provided task
   *   {upstream_outputs} — concatenated summaries of reached upstream nodes
   */
  prompt: z.string().optional(),
  /** Agent names referencing this ship's tool library (resolver walks ship → global). */
  agents: z.array(z.string()).default([]).optional(),

  // ── type === 'custom' ──
  /** Which custom runner to use. Currently only 'script'. */
  customType: CustomNodeKindSchema.optional(),
  /** For customType='script': the script tool's name (resolver walks ship → global). */
  scriptName: z.string().optional(),
  /**
   * For customType='script': arg values keyed by the script's declared arg names.
   * Strings may include {task} / {upstream_outputs} template tokens; those are
   * substituted before being passed into the script's `cmd:`.
   */
  args: z.record(z.string(), z.string()).optional(),

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

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>
export type Workflow = z.infer<typeof WorkflowSchema>

/**
 * The default workflow seeded on first boot. Pipeline:
 *   analyze (AI) → print-context (custom/script) → develop (AI) → deploy (AI)
 * The print-context script node is a demo of the custom/script runtime — it
 * echoes the analyze plan and proves data flows through a non-AI node.
 * Referenced agents (planner/reviewer/...) and the print-task script are
 * seeded under `~/.agentyard/` so the resolver finds them in global scope.
 */
export const DEFAULT_WORKFLOW_GRAPH: WorkflowGraph = {
  nodes: [
    {
      id: 'analyze',
      type: 'ai',
      title: 'Analyze',
      prompt: `You are the LEADER of the ANALYZE phase. The user provided this task:

{task}

Your job: produce a concise plan describing what needs to be built and how. Delegate to the planner agent to draft a 3-bullet plan, and to the reviewer agent to call out any obvious gaps in one sentence. Then call mark_node_complete with the final plan as the summary.`,
      agents: ['planner', 'reviewer'],
      position: { x: 0, y: 0 },
    },
    {
      id: 'print-context',
      type: 'custom',
      title: 'Print context (demo)',
      customType: 'script',
      scriptName: 'print-task',
      args: {
        message: 'Plan handed off to develop:\n{upstream_outputs}',
      },
      position: { x: 350, y: 0 },
    },
    {
      id: 'develop',
      type: 'ai',
      title: 'Develop',
      prompt: `You are the LEADER of the DEVELOP phase. The original task was:

{task}

The analyze phase produced this plan:

{upstream_outputs}

Your job: get a working implementation into the repo. The developer and tester agents have the full Claude Code toolset (Read, Edit, Write, Glob, Grep, Bash) rooted in a feature worktree.

DELEGATION RULES — read carefully:
1. When you call assign_task, the instruction MUST be an imperative that the agent executes by CALLING TOOLS, not by describing. Write instructions like:
   "Use the Write tool to create FILE.ext at the repo root with this exact content: <content>. After writing, use Read to confirm the file exists."
2. Do NOT delegate descriptive work like "describe how to..." or "explain the approach". Agents that describe instead of doing are a failure.
3. After the developer completes, delegate the tester to VERIFY by using Read/Bash to inspect what the developer actually produced.
4. Only after both agents have actually performed file work, call mark_node_complete with a 1–2 paragraph summary of WHAT WAS WRITTEN TO DISK (file paths + brief description).`,
      agents: ['developer', 'tester'],
      position: { x: 700, y: 0 },
    },
    {
      id: 'deploy',
      type: 'ai',
      title: 'Deploy',
      prompt: `You are the LEADER of the DEPLOY phase. The original task was:

{task}

The develop phase produced this output:

{upstream_outputs}

Your job: commit the changes from the develop phase. The deployer agent has Bash tool access in the feature worktree.

DELEGATION RULES:
1. Send the deployer agent an imperative instruction that REQUIRES it to call Bash. For example:
   "Run \`git status\` to confirm changes are present. If there are changes, run \`git add -A && git commit -m 'agentyard: <short summary>'\` to commit them. Then run \`git log -1 --format=%H\` to get the commit SHA and report it back."
2. After the agent completes, call mark_node_complete with a 2–3 sentence release note that includes the commit SHA the agent reported. Do NOT push or open a PR (manual user step for now).`,
      agents: ['deployer'],
      position: { x: 1050, y: 0 },
    },
  ],
  edges: [
    { from: 'analyze', to: 'print-context' },
    { from: 'print-context', to: 'develop' },
    { from: 'develop', to: 'deploy' },
  ],
}
