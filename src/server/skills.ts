import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export interface LoadedSkill {
  name: string
  description: string
  path: string
  body: string
}

export const SKILLS_DIR = path.join(homedir(), '.agentyard', 'skills')

const EXAMPLE_SKILL_NAME = 'agentyard-style'
const EXAMPLE_SKILL_CONTENT = `---
name: agentyard-style
description: Default AgentYard tone — concise, factual, no flowery language. Loaded as an example skill so the library isn't empty.
---

# AgentYard tone

When responding as an AgentYard drone, keep these in mind:

- Lead with the answer; no preamble.
- Use bullet points or numbered lists when the answer has more than one part.
- If you have to acknowledge a limitation, do it in one sentence.

This is a starter skill. Replace it with your own by creating a folder in \`~/.agentyard/skills/\` containing a \`SKILL.md\` with frontmatter (\`name\`, \`description\`) and any body text.
`

/** Minimal frontmatter parser — only handles `key: value` lines (no nesting, no lists). */
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith('---')) return { meta: {}, body: text }
  // Find the closing '---' on its own line.
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { meta: {}, body: text }
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) return { meta: {}, body: text }
  const fmLines = lines.slice(1, endIdx)
  const body = lines.slice(endIdx + 1).join('\n').replace(/^\n+/, '')
  const meta: Record<string, string> = {}
  for (const line of fmLines) {
    const m = line.match(/^([\w-]+):\s*(.*)$/)
    if (m && m[1]) {
      let v = m[2] ?? ''
      v = v.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
      meta[m[1]] = v
    }
  }
  return { meta, body }
}

function ensureSkillsDir(): void {
  if (!existsSync(SKILLS_DIR)) {
    mkdirSync(SKILLS_DIR, { recursive: true })
  }
  // Seed the example skill so the UI library has at least one entry.
  const examplePath = path.join(SKILLS_DIR, EXAMPLE_SKILL_NAME)
  const exampleFile = path.join(examplePath, 'SKILL.md')
  if (!existsSync(exampleFile)) {
    mkdirSync(examplePath, { recursive: true })
    writeFileSync(exampleFile, EXAMPLE_SKILL_CONTENT, 'utf8')
  }
}

let cache: LoadedSkill[] = []

export function scanSkills(): LoadedSkill[] {
  ensureSkillsDir()
  const skills: LoadedSkill[] = []
  for (const entry of readdirSync(SKILLS_DIR)) {
    const dir = path.join(SKILLS_DIR, entry)
    let st
    try {
      st = statSync(dir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    const skillFile = path.join(dir, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    let raw: string
    try {
      raw = readFileSync(skillFile, 'utf8')
    } catch {
      continue
    }
    const { meta, body } = parseFrontmatter(raw)
    const name = meta.name?.trim() || entry
    const description = meta.description?.trim() || ''
    skills.push({ name, description, path: dir, body: body.trim() })
  }
  skills.sort((a, b) => a.name.localeCompare(b.name))
  cache = skills
  return skills
}

export function getLoadedSkills(): LoadedSkill[] {
  if (cache.length === 0) scanSkills()
  return cache
}

export function findSkill(name: string): LoadedSkill | undefined {
  return getLoadedSkills().find((s) => s.name === name)
}

/** Render attached skill bodies as a section to inject into an agent's system prompt. */
export function renderSkillContext(names: string[]): string {
  const skills = names.map((n) => findSkill(n)).filter((s): s is LoadedSkill => !!s)
  if (skills.length === 0) return ''
  const blocks = skills.map(
    (s) => `### Skill: ${s.name}\n${s.description ? `_${s.description}_\n\n` : ''}${s.body}`,
  )
  return [
    '## Skills loaded',
    'You have the following skill instructions in context. Apply them throughout this task.',
    '',
    blocks.join('\n\n---\n\n'),
  ].join('\n')
}
