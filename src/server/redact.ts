/**
 * Redaction helpers for audit data.
 * Keep names/identifiers; strip secret values (tokens, env values, URLs with auth).
 */

/** Redact a URL: keep scheme + host, strip path segments and query params that may contain tokens. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    // Strip query entirely — may contain API keys.
    u.search = ''
    // Strip path — may embed tokens as path segments.
    u.pathname = '/'
    return u.toString()
  } catch {
    return '[redacted-url]'
  }
}

const SECRET_PATTERNS = [
  /key/i,
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /auth/i,
  /credential/i,
  /api[-_]?key/i,
  /bearer/i,
]

function looksLikeSecret(name: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(name))
}

/**
 * Redact an env-var map: keep the key names, replace values that look like
 * secrets with `"[redacted]"`.
 */
export function redactEnvMap(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    result[k] = looksLikeSecret(k) ? '[redacted]' : v
  }
  return result
}

/**
 * Minimal redaction for MCP server config objects: strip headers and
 * URL query-params which can hold bearer tokens.
 */
export function redactMcpConfig(name: string, cfg: unknown): Record<string, unknown> {
  if (typeof cfg !== 'object' || cfg === null) return { name }
  const c = cfg as Record<string, unknown>
  const out: Record<string, unknown> = { name, type: c['type'] }
  if (c['command']) out['command'] = c['command']
  if (c['args']) out['args'] = c['args']
  if (c['url']) out['url'] = redactUrl(String(c['url']))
  // Never copy env or headers — they can contain auth.
  return out
}
