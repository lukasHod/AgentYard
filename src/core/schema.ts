import { z } from 'zod/v4'

/**
 * Two node types per the v2 design:
 *   - 'ai'     — LLM-driven. Has a system prompt, connects to agents from the
 *                planet's tool library. The leader spawns each connected agent
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
  /** Agent names referencing this planet's tool library (resolver walks planet → global). */
  agents: z.array(z.string()).default([]).optional(),

  // ── type === 'custom' ──
  /** Which custom runner to use. Currently only 'script'. */
  customType: CustomNodeKindSchema.optional(),
  /** For customType='script': the script tool's name (resolver walks planet → global). */
  scriptName: z.string().optional(),
  /**
   * For customType='script': arg values keyed by the script's declared arg names.
   * Strings may include {task} / {upstream_outputs} template tokens; those are
   * substituted before being passed into the script's `cmd:`.
   */
  args: z.record(z.string(), z.string()).optional(),

  /** Canvas position for the React Flow editor. */
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),

  /**
   * Phase 6: optional override for which AgentKind runs this node's
   * leader (AI nodes only — custom/script nodes ignore it). When
   * omitted, the cascade falls back to feature → planet → global default.
   */
  agentKind: z.enum(['claude-sdk', 'claude-code-cli', 'codex-cli']).optional(),

  /**
   * Phase 14: reviewer/developer loop policy. When present on an AI node the
   * runner repeats a dev→review cycle until all required reviewers approve
   * or maxIterations is reached. CLI (PTY) mode only — SDK fallback runs a
   * single pass without looping.
   */
  reviewLoop: z
    .object({
      /** Agent names (from the tool library) that run as developers. */
      developerSlots: z.array(z.string()).min(1),
      /** Agent names that run as reviewers. */
      reviewerSlots: z.array(z.string()).min(1),
      /**
       * Subset of reviewerSlots whose approval is required to exit the loop.
       * Defaults to all reviewerSlots when omitted.
       */
      approvalRequiredFrom: z.array(z.string()).optional(),
      /** Maximum dev→review iterations before forcing node completion. */
      maxIterations: z.number().int().positive().default(3),
      /** Reserved: pause before entering review until tests pass. */
      requireTestsPassing: z.boolean().default(false),
    })
    .optional(),
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

export type ReviewLoopPolicy = NonNullable<z.infer<typeof WorkflowNodeSchema>['reviewLoop']>
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

/**
 * Phase 8a: AO-style default workflow. Seeded alongside the simple
 * analyze/develop/deploy template and chosen as the default for newly
 * created features. The SCM-touching steps (open-pr, watch-ci,
 * watch-review) ship as placeholder script nodes that write marker
 * files — Phase 8b swaps them for real `gh`-backed implementations.
 *
 * Pipeline:
 *   analyze (AI) → create-branch (script) → implement (AI) →
 *   self-review (AI) → run-tests (script) → commit (script) →
 *   open-pr (script) → watch-ci (script) → watch-review (script) →
 *   mark-ready (script)
 */
export const AO_WORKFLOW_GRAPH: WorkflowGraph = {
  nodes: [
    {
      id: 'analyze',
      type: 'ai',
      title: 'Analyze',
      prompt: `You are the LEADER of the ANALYZE phase. The user provided this task:

{task}

Your job: produce a concise plan (3–5 bullets) describing what needs to be built and how. Delegate to the planner agent and the reviewer agent, then call mark_node_complete with the final plan and a short slug (kebab-case, max 4 words) that the next node will use as the branch name. Format the summary as:

slug: <kebab-slug>
plan:
- bullet 1
- bullet 2
...`,
      agents: ['planner', 'reviewer'],
      position: { x: 0, y: 0 },
    },
    {
      id: 'create-branch',
      type: 'custom',
      title: 'Create branch',
      customType: 'script',
      scriptName: 'ao-create-branch',
      args: {
        // Plan node prefixes its summary with `slug: <name>`. We just pass
        // upstream_outputs through; the script's git checkout consumes the
        // first line after `slug:`. In Phase 8b the create-branch step
        // becomes a smarter helper that parses the slug deterministically.
        branch: 'feature/{upstream_outputs}',
      },
      position: { x: 350, y: 0 },
    },
    {
      id: 'implement',
      type: 'ai',
      title: 'Implement',
      prompt: `You are the LEADER of the IMPLEMENT phase.

Task: {task}

Plan from analyze:
{upstream_outputs}

Delegate to the developer agent to write the code (Read/Edit/Write/Glob/Grep/Bash all in the feature worktree). Then delegate to the tester agent to verify by reading the files actually produced and running smoke checks.

Call mark_node_complete with a 1–2 paragraph summary of what was written to disk (file paths + brief description).`,
      agents: ['developer', 'tester'],
      position: { x: 700, y: 0 },
    },
    {
      id: 'self-review',
      type: 'ai',
      title: 'Self-review',
      prompt: `You are the LEADER of the SELF-REVIEW phase.

Implementation summary:
{upstream_outputs}

Delegate to the reviewer agent to read each changed file and flag bugs, dead code, missing tests, or unclear naming. The reviewer should produce a numbered list of concrete fixes — anything more than 3 items means we'll loop back to implement.

Call mark_node_complete with the review findings. If there are no blocking issues, end the summary with the line "review-ok".`,
      agents: ['reviewer'],
      position: { x: 1050, y: 0 },
    },
    {
      id: 'run-tests',
      type: 'custom',
      title: 'Run tests',
      customType: 'script',
      scriptName: 'ao-run-tests',
      args: {},
      position: { x: 1400, y: 0 },
    },
    {
      id: 'commit',
      type: 'custom',
      title: 'Commit',
      customType: 'script',
      scriptName: 'ao-commit',
      args: {
        message: 'agentyard: {task}',
      },
      position: { x: 1750, y: 0 },
    },
    {
      id: 'open-pr',
      type: 'custom',
      title: 'Open PR',
      customType: 'script',
      scriptName: 'ao-open-pr',
      args: {
        title: '{task}',
        body: '{upstream_outputs}',
      },
      position: { x: 2100, y: 0 },
    },
    {
      id: 'watch-ci',
      type: 'custom',
      title: 'Watch CI',
      customType: 'script',
      scriptName: 'ao-watch-ci',
      args: {},
      position: { x: 2450, y: 0 },
    },
    {
      id: 'watch-review',
      type: 'custom',
      title: 'Watch review',
      customType: 'script',
      scriptName: 'ao-watch-review',
      args: {},
      position: { x: 2800, y: 0 },
    },
    {
      id: 'mark-ready',
      type: 'custom',
      title: 'Ready to merge',
      customType: 'script',
      scriptName: 'ao-mark-ready',
      args: {
        summary: 'Feature {task} is ready to merge.',
      },
      position: { x: 3150, y: 0 },
    },
  ],
  edges: [
    { from: 'analyze', to: 'create-branch' },
    { from: 'create-branch', to: 'implement' },
    { from: 'implement', to: 'self-review' },
    { from: 'self-review', to: 'run-tests' },
    { from: 'run-tests', to: 'commit' },
    { from: 'commit', to: 'open-pr' },
    { from: 'open-pr', to: 'watch-ci' },
    { from: 'watch-ci', to: 'watch-review' },
    { from: 'watch-review', to: 'mark-ready' },
  ],
}
