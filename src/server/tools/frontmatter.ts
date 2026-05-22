import yaml from 'js-yaml'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = FRONTMATTER_RE.exec(text)
  if (!m) return { meta: {}, body: text }
  let meta: Record<string, unknown> = {}
  try {
    const parsed = yaml.load(m[1] ?? '')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      meta = parsed as Record<string, unknown>
    }
  } catch {
    // fall back to empty meta
  }
  return { meta, body: (m[2] ?? '').replace(/^\r?\n+/, '') }
}

export function serializeFrontmatter(meta: Record<string, unknown>, body: string): string {
  // Drop undefined-valued keys so they don't render as YAML "null".
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined) clean[k] = v
  }
  const fm = yaml.dump(clean, { lineWidth: 0, noRefs: true, quotingType: '"' }).trim()
  return `---\n${fm}\n---\n\n${body.trim()}\n`
}
