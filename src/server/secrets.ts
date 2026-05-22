import { existsSync, readFileSync } from 'node:fs'
import { secretsFile } from './tools/paths.js'

/**
 * Load secrets from `~/.agentyard/.secrets/secrets.env` into process.env.
 * Called once at server start. Existing env vars are NOT overwritten — shell /
 * launch env takes precedence over the file.
 */
export function loadSecrets(): { loaded: number; path: string } {
  const file = secretsFile()
  if (!existsSync(file)) return { loaded: 0, path: file }
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return { loaded: 0, path: file }
  }
  let loaded = 0
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
      loaded++
    }
  }
  return { loaded, path: file }
}

const ENV_VAR_RE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Substitute `${env:NAME}` placeholders in a string from `process.env`.
 * Missing vars become empty strings unless `strict: true`, in which case throws.
 */
export function resolveEnvVars(input: string, opts: { strict?: boolean } = {}): string {
  return input.replace(ENV_VAR_RE, (_full, name: string) => {
    const v = process.env[name]
    if (v === undefined) {
      if (opts.strict) throw new Error(`Required env var ${name} is not set`)
      return ''
    }
    return v
  })
}

/** Recursively substitute env-var placeholders in any string field of a value. */
export function resolveEnvVarsDeep<T>(value: T, opts: { strict?: boolean } = {}): T {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return resolveEnvVars(value, opts) as T
  if (Array.isArray(value)) return value.map((v) => resolveEnvVarsDeep(v, opts)) as T
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveEnvVarsDeep(v, opts)
    }
    return out as T
  }
  return value
}
