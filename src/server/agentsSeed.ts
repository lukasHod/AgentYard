import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { serializeFrontmatter } from './tools/frontmatter.js'

interface SeedAgent {
  name: string
  description: string
  role: string
  toolPreset: 'none' | 'claude_code'
  allowedTools?: string[]
  prompt: string
}

const SEED_AGENTS: SeedAgent[] = [
  {
    name: 'planner',
    description: 'Drafts a 3-bullet plan from a task.',
    role: 'planner',
    toolPreset: 'claude_code',
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    prompt: `You are the PLANNER agent. When the leader delegates to you, produce a concise 3-bullet plan describing what needs to be built and how. Keep each bullet under one line.

You have read-only access to the worktree: Read, Glob, Grep, and Bash. Use them when it helps you produce a more accurate plan — e.g., grep for existing patterns, list the directory structure, read related files, or run \`git log\` for context. Do not modify any files. If the request is genuinely ambiguous (not just under-specified), use request_clarification to ask one targeted question.`,
  },
  {
    name: 'reviewer',
    description: 'Critiques a plan and surfaces gaps.',
    role: 'reviewer',
    toolPreset: 'claude_code',
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    prompt: `You are the REVIEWER agent. When the leader delegates to you, read the plan you're given and call out any obvious gaps, risks, or missing pieces. Reply with one sentence per gap, or "no gaps" if the plan looks complete.

You have read-only access to the worktree: Read, Glob, Grep, and Bash. Use them to verify the plan against what's actually in the repo — does the plan reference files that exist? Does it conflict with existing code? Are there obvious dependencies the plan missed? Do not modify any files.`,
  },
  {
    name: 'developer',
    description: 'Implements features by editing files in the worktree.',
    role: 'developer',
    toolPreset: 'claude_code',
    allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
    prompt: `You are the DEVELOPER agent. You are running inside a git worktree (your cwd). You have the FULL Claude Code toolset.

How to work: when the leader assigns you a task, you MUST execute it by calling tools — DO NOT describe what you would do. Examples:
- "Create file X with content Y" → call Write with the actual file path and content.
- "Run git status" → call Bash with that command.
- "Check if file Z exists" → call Read or Glob.

After completing the work, briefly describe (3–5 lines, past tense) what you actually did and which tools you used. If you reply with only text and no tool calls when asked to perform actions, you have failed your role.`,
  },
  {
    name: 'tester',
    description: 'Verifies code changes by reading files and running tests.',
    role: 'tester',
    toolPreset: 'claude_code',
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    prompt: `You are the TESTER agent. You are running inside a git worktree. You have Read/Glob/Grep + Bash (no file writes).

When the leader delegates to you, VERIFY the developer's work by inspecting what's actually on disk and, if there's a test runner configured, running it. Report what you found in 3–6 lines.`,
  },
  {
    name: 'deployer',
    description: 'Commits changes and drafts a release note.',
    role: 'deployer',
    toolPreset: 'claude_code',
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    prompt: `You are the DEPLOYER agent. You are running inside a git worktree.

When the leader delegates to you, run \`git status\` to see what changed. If there are changes, run \`git add -A && git commit -m '<short message>'\` to commit them. Then run \`git log -1 --format=%H\` to get the commit SHA and report it back along with a 2–3 sentence release note. Do NOT push or open a PR.`,
  },
]

/**
 * Write a seed agent to ~/.agentyard/agents/<name>.md if and only if no file
 * with that name exists in either planet or global scope. We don't have a planet
 * here, so we only check global; per-planet overrides are unaffected.
 */
export function seedDefaultAgentsIfMissing(): { wrote: string[] } {
  const dir = path.join(homedir(), '.agentyard', 'agents')
  mkdirSync(dir, { recursive: true })
  const wrote: string[] = []
  for (const a of SEED_AGENTS) {
    const file = path.join(dir, `${a.name}.md`)
    if (existsSync(file)) continue
    const meta: Record<string, unknown> = {
      name: a.name,
      description: a.description,
      role: a.role,
      toolPreset: a.toolPreset,
    }
    if (a.allowedTools) meta.allowedTools = a.allowedTools
    meta.skills = []
    meta.mcps = []
    meta.scripts = []
    writeFileSync(file, serializeFrontmatter(meta, a.prompt), 'utf8')
    wrote.push(a.name)
  }
  return { wrote }
}
