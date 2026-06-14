import { execFileSync } from 'node:child_process'
import { getDb } from './db.js'
import { listTerminalChunks } from './terminalStore.js'
import type { TerminalSessionDescriptor } from '../core/types.js'

interface FeatureRow {
  name: string
  task: string
  branch: string | null
  worktree_path: string | null
}

interface NodeRunRow {
  title: string
}

interface QuestionRow {
  question: string
  created_at: number
}

export interface SessionHandoffContext {
  role: string | null
  cwd: string | null
  argv: string[]
  profileId: string
  featureName: string | null
  featureTask: string | null
  featureBranch: string | null
  featureWorktree: string | null
  nodeTitle: string | null
  pendingQuestions: { question: string; createdAt: number }[]
  recentCommits: string
  changedFiles: string
  transcriptTail: string
  generatedAt: number
}

export function buildHandoffContext(session: TerminalSessionDescriptor): SessionHandoffContext {
  const db = getDb()

  let featureName: string | null = null
  let featureTask: string | null = null
  let featureBranch: string | null = null
  let featureWorktree: string | null = null
  if (session.featureId !== null) {
    const row = db
      .prepare('SELECT name, task, branch, worktree_path FROM features WHERE id = ?')
      .get(session.featureId) as FeatureRow | undefined
    if (row) {
      featureName = row.name
      featureTask = row.task || null
      featureBranch = row.branch
      featureWorktree = row.worktree_path
    }
  }

  let nodeTitle: string | null = null
  if (session.nodeRunId) {
    const row = db.prepare('SELECT title FROM node_runs WHERE id = ?').get(session.nodeRunId) as
      | NodeRunRow
      | undefined
    nodeTitle = row?.title ?? null
  }

  const agentRef = session.agentSessionId ?? session.id
  const questionRows = db
    .prepare(
      `SELECT question, created_at FROM pending_questions
       WHERE agent_session_id = ? AND state = 'pending'
       ORDER BY created_at`,
    )
    .all(agentRef) as QuestionRow[]
  const pendingQuestions = questionRows.map((q) => ({
    question: q.question,
    createdAt: q.created_at,
  }))

  const effectiveCwd = session.cwd ?? featureWorktree ?? undefined
  let recentCommits = ''
  let changedFiles = ''
  if (effectiveCwd) {
    try {
      recentCommits = execFileSync('git', ['log', '--oneline', '-10'], {
        cwd: effectiveCwd,
        encoding: 'utf8',
        timeout: 5000,
      }).trim()
    } catch {
      // not a git repo or git unavailable
    }
    try {
      changedFiles = execFileSync('git', ['status', '--short'], {
        cwd: effectiveCwd,
        encoding: 'utf8',
        timeout: 5000,
      }).trim()
    } catch {
      // ignore
    }
  }

  const chunks = listTerminalChunks(session.id, { limit: 100 })
  const raw = chunks.join('')
  // Strip ANSI escape sequences for readability
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
  const transcriptTail = stripped.slice(-4000).trimStart()

  return {
    role: session.role,
    cwd: effectiveCwd ?? null,
    argv: session.argv,
    profileId: session.profileId,
    featureName,
    featureTask,
    featureBranch,
    featureWorktree,
    nodeTitle,
    pendingQuestions,
    recentCommits,
    changedFiles,
    transcriptTail,
    generatedAt: Date.now(),
  }
}

export function renderHandoffMarkdown(ctx: SessionHandoffContext): string {
  const parts: string[] = ['# AgentYard Session Handoff Context']

  const meta: string[] = []
  if (ctx.role) meta.push(`**Role:** ${ctx.role}`)
  if (ctx.featureName) meta.push(`**Feature:** ${ctx.featureName}`)
  if (ctx.nodeTitle) meta.push(`**Workflow Node:** ${ctx.nodeTitle}`)
  if (ctx.featureBranch) meta.push(`**Branch:** \`${ctx.featureBranch}\``)
  if (ctx.featureWorktree) meta.push(`**Worktree:** \`${ctx.featureWorktree}\``)
  else if (ctx.cwd) meta.push(`**Working Directory:** \`${ctx.cwd}\``)
  if (meta.length > 0) parts.push('', meta.join('  \n'))

  if (ctx.featureTask) {
    parts.push('', '## Task', '', ctx.featureTask)
  }

  if (ctx.recentCommits) {
    parts.push('', '## Recent Commits', '', '```', ctx.recentCommits, '```')
  }

  if (ctx.changedFiles) {
    parts.push('', '## Changed Files', '', '```', ctx.changedFiles, '```')
  }

  if (ctx.pendingQuestions.length > 0) {
    parts.push('', '## Unanswered Questions')
    for (const q of ctx.pendingQuestions) {
      parts.push(`- ${q.question}`)
    }
  }

  if (ctx.transcriptTail) {
    parts.push('', '## Recent Session Output', '', '```', ctx.transcriptTail, '```')
  }

  return parts.join('\n') + '\n'
}
