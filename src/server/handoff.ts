import { execFile as execFileCb, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { HandoffSummary } from '../core/types.js'

const execFile = promisify(execFileCb)

function git(repoPath: string, args: string[], opts?: { input?: string }) {
  if (opts?.input !== undefined) {
    // execFile's `input` option doesn't reliably close stdin on Windows for
    // commands like `git mktree` that read until EOF. Use spawn with explicit
    // stdin.end() instead.
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const proc = spawn('git', ['-C', repoPath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
      proc.stdin.write(opts.input!)
      proc.stdin.end()
      proc.on('close', (code) => {
        if (code === 0) resolve({ stdout, stderr })
        else reject(Object.assign(new Error(`git ${args[0]} failed (${code}): ${stderr}`), { stdout, stderr, code }))
      })
      proc.on('error', reject)
    })
  }
  return execFile('git', ['-C', repoPath, ...args], { encoding: 'utf8' })
}

export interface HandoffAgent {
  id: string
  role: 'leader' | 'drone' | 'free'
  label: string | undefined
  messages: Array<{ role: 'assistant' | 'user' | 'system'; content: string; timestamp: number }>
}

export interface HandoffPayload {
  version: 1
  branch: string | null
  featureId: number
  planetId: number
  featureName: string
  shortDescription: string
  featureDescription: string
  implementationPlan: string | null
  handoffNote: string | null
  sender: string
  timestamp: number
  agents: HandoffAgent[]
  workflowState: {
    nodeStates: Record<string, string>
    nodeSummaries: Record<string, string>
  }
}

export async function getGitUser(repoPath: string): Promise<string> {
  try {
    const { stdout } = await git(repoPath, ['config', 'user.name'])
    const name = stdout.trim()
    if (name) return name
  } catch {
    // fall through to email
  }
  try {
    const { stdout } = await git(repoPath, ['config', 'user.email'])
    return stdout.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Create an orphan handoff branch via git plumbing — never touches the working
 * tree or index of any existing worktree.
 */
export async function createHandoffBranch(repoPath: string, payload: HandoffPayload): Promise<void> {
  const branchSlug = payload.branch
    ? payload.branch.replace(/^refs\/heads\//, '')
    : `idea-${payload.featureName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${payload.featureId}`
  const handoffBranch = `agentyard/handoff/${branchSlug}`
  const json = JSON.stringify(payload, null, 2)

  // Write payload to a temp file so hash-object can read it without stdin.
  const tmpFile = path.join(tmpdir(), `agentyard-handoff-${Date.now()}.json`)
  await writeFile(tmpFile, json, 'utf8')

  try {
    // 1. Create blob object in the repo's object store.
    const { stdout: blobRaw } = await git(repoPath, ['hash-object', '-w', tmpFile])
    const blobHash = blobRaw.trim()

    // 2. Create a tree containing only handoff.json.
    const treeSpec = `100644 blob ${blobHash}\thandoff.json\n`
    const { stdout: treeRaw } = await git(repoPath, ['mktree'], { input: treeSpec })
    const treeHash = treeRaw.trim()

    // 3. Create a commit from the tree (orphan — no parent).
    const { stdout: commitRaw } = await git(repoPath, [
      'commit-tree',
      treeHash,
      '-m',
      `handoff: ${payload.featureName}`,
    ])
    const commitHash = commitRaw.trim()

    // 4. Point the handoff branch ref at that commit.
    await git(repoPath, ['update-ref', `refs/heads/${handoffBranch}`, commitHash])

    // 5. Push the handoff branch to origin.
    await git(repoPath, ['push', 'origin', `refs/heads/${handoffBranch}`])
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}

export async function listHandoffs(repoPath: string): Promise<HandoffSummary[]> {
  // Fetch remote handoff refs, ignore failures (no remote, no handoffs yet).
  try {
    await git(repoPath, [
      'fetch',
      'origin',
      'refs/heads/agentyard/handoff/*:refs/remotes/origin/agentyard/handoff/*',
      '--prune',
    ])
  } catch {
    // No remote or no handoff refs — return empty list.
    return []
  }

  let refsRaw: string
  try {
    const { stdout } = await git(repoPath, [
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/remotes/origin/agentyard/handoff/',
    ])
    refsRaw = stdout.trim()
  } catch {
    return []
  }

  const refs = refsRaw.split('\n').filter(Boolean)
  if (refs.length === 0) return []

  const summaries = await Promise.all(
    refs.map(async (ref): Promise<HandoffSummary | null> => {
      try {
        const { stdout: content } = await git(repoPath, ['show', `${ref}:handoff.json`])
        const payload = JSON.parse(content) as HandoffPayload
        // ref is e.g. "origin/agentyard/handoff/agentyard/my-feature-42"
        // Strip the "origin/" prefix to get the branch name.
        const handoffBranch = ref.replace(/^origin\//, '')
        return {
          handoffBranch,
          featureBranch: payload.branch,
          featureName: payload.featureName,
          shortDescription: payload.shortDescription,
          sender: payload.sender,
          timestamp: payload.timestamp,
        }
      } catch {
        return null
      }
    }),
  )

  return summaries.filter((s): s is HandoffSummary => s !== null)
}

export async function readHandoffPayload(
  repoPath: string,
  handoffBranch: string,
): Promise<HandoffPayload> {
  const remoteRef = `refs/remotes/origin/${handoffBranch}`
  const { stdout } = await git(repoPath, ['show', `${remoteRef}:handoff.json`])
  return JSON.parse(stdout) as HandoffPayload
}

export async function deleteHandoffBranch(repoPath: string, handoffBranch: string): Promise<void> {
  // Delete from remote (best-effort — may already be gone).
  try {
    await git(repoPath, ['push', 'origin', '--delete', handoffBranch])
  } catch {
    // ignore
  }
  // Clean up local remote-tracking ref.
  try {
    await git(repoPath, ['update-ref', '-d', `refs/remotes/origin/${handoffBranch}`])
  } catch {
    // ignore
  }
}

export interface GeneratedHandoffDescriptions {
  shortDescription: string
  featureDescription: string
  implementationPlan: string | null
}

/**
 * Ask Claude to generate handoff descriptions from feature context.
 * Uses the Anthropic messages API directly (one-shot, no agent session).
 */
export async function generateHandoffDescriptions(opts: {
  featureName: string
  featureTask: string
  agents: HandoffAgent[]
  worktreePath: string | null
}): Promise<GeneratedHandoffDescriptions> {
  const { featureName, featureTask, agents, worktreePath } = opts

  // Collect git diff from the worktree for context.
  let gitDiff = ''
  if (worktreePath) {
    try {
      const { stdout } = await execFile('git', ['-C', worktreePath, 'diff', 'HEAD'])
      gitDiff = stdout.trim().slice(0, 8000) // cap to avoid token overflow
    } catch {
      // best-effort
    }
    if (!gitDiff) {
      try {
        const { stdout } = await execFile('git', ['-C', worktreePath, 'status', '--short'])
        gitDiff = stdout.trim()
      } catch {
        // best-effort
      }
    }
  }

  // Format agent conversations.
  const conversationText = agents
    .filter((a) => a.messages.length > 0)
    .map((a) => {
      const header = `=== ${a.role.toUpperCase()}${a.label ? ` (${a.label})` : ''} ===`
      const msgs = a.messages
        .slice(-60) // last 60 messages per agent to keep context manageable
        .map((m) => `[${m.role}]: ${m.content}`)
        .join('\n')
      return `${header}\n${msgs}`
    })
    .join('\n\n')

  const prompt = `You are helping generate a feature handoff document for a developer handing work to a colleague.

Feature name: ${featureName}
Original task: ${featureTask}

${conversationText ? `Agent conversation history:\n${conversationText}` : 'No agent conversations recorded yet.'}

${gitDiff ? `Current git changes:\n\`\`\`\n${gitDiff}\n\`\`\`` : ''}

Based on the above context, generate a handoff document with exactly this JSON structure:
{
  "shortDescription": "<1-2 sentences shown in the handoff list UI — what is this feature and where is it at>",
  "featureDescription": "<2-5 paragraphs of full context for the colleague's Claude — what the feature does, why it exists, key decisions made, current state, what's left to do>",
  "implementationPlan": "<markdown list of remaining implementation steps if determinable from context, or null if the work is complete or steps are unclear>"
}

Reply with ONLY the JSON object, no other text.`

  const client = new Anthropic()
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content.find((b) => b.type === 'text')?.text ?? '{}'
  // Extract JSON even if the model adds surrounding text.
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {
      shortDescription: `Handoff for "${featureName}"`,
      featureDescription: featureTask,
      implementationPlan: null,
    }
  }
  const parsed = JSON.parse(jsonMatch[0]) as GeneratedHandoffDescriptions
  return {
    shortDescription: parsed.shortDescription ?? `Handoff for "${featureName}"`,
    featureDescription: parsed.featureDescription ?? featureTask,
    implementationPlan: parsed.implementationPlan ?? null,
  }
}

/** Format a HandoffPayload as a system-prompt preamble for the leader agent. */
export function formatHandoffContext(payload: HandoffPayload): string {
  const agentSections = payload.agents
    .map((a) => {
      const header = `--- ${a.role}${a.label ? ` (${a.label})` : ''} ---`
      const messages = a.messages
        .map((m) => `[${m.role}]: ${m.content}`)
        .join('\n')
      return `${header}\n${messages}`
    })
    .join('\n\n')

  return [
    '=== HANDOFF CONTEXT ===',
    'This feature was handed off to you. Resume work using the context below.',
    '',
    `Feature Description:\n${payload.featureDescription}`,
    '',
    `Implementation Plan:\n${payload.implementationPlan ?? 'none'}`,
    '',
    `Handoff Note: ${payload.handoffNote ?? 'none'}`,
    '',
    'Prior Agent Conversations:',
    agentSections || '(no prior conversations)',
    '=== END HANDOFF CONTEXT ===',
  ].join('\n')
}
