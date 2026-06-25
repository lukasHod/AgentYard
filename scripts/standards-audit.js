import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const SOURCE_DIRS = ['src', 'scripts']
const CHECK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const SELF = 'scripts/standards-audit.js'

const RULES = [
  { name: 'no-explicit-any-cast', pattern: /\bas\s+any\b/ },
  { name: 'no-ts-ignore', pattern: /@ts-ignore\b/ },
  { name: 'no-debugger', pattern: /\bdebugger\b/ },
  { name: 'no-dangerous-html', pattern: /\bdangerouslySetInnerHTML\b|\binnerHTML\b/ },
  { name: 'no-dynamic-code-eval', pattern: /\beval\s*\(|\bnew\s+Function\s*\(/ },
]

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') return []
      return listSourceFiles(fullPath)
    }
    if (!entry.isFile()) return []
    if (!CHECK_EXTENSIONS.has(path.extname(entry.name))) return []
    return [fullPath]
  }))
  return files.flat()
}

function relativePath(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/')
}

function auditText(file, text) {
  const normalized = relativePath(file)
  if (normalized === SELF) return []

  const findings = []
  const lines = text.split(/\r?\n/)
  lines.forEach((lineText, index) => {
    for (const rule of RULES) {
      if (!rule.pattern.test(lineText)) continue
      findings.push({
        file: normalized,
        line: index + 1,
        rule: rule.name,
        text: lineText.trim(),
      })
    }
  })
  return findings
}

async function main() {
  const sourceFiles = (await Promise.all(
    SOURCE_DIRS.map((dir) => listSourceFiles(path.join(ROOT, dir))),
  )).flat()

  const findings = (await Promise.all(
    sourceFiles.map(async (file) => auditText(file, await readFile(file, 'utf8'))),
  )).flat()

  if (findings.length === 0) {
    console.log('standards-audit: ok')
    return
  }

  console.error(`standards-audit: ${findings.length} finding(s)`)
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`)
  }
  process.exitCode = 1
}

void main().catch((err) => {
  console.error('standards-audit failed:', err)
  process.exitCode = 1
})
