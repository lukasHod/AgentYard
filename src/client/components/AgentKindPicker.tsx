import { useEffect, useState } from 'react'
import type { AgentCapabilities, AgentKind } from '../../core/plugins'

/**
 * Phase 6: dropdown that fetches the registered agent kinds + their
 * capabilities from `/api/agent-kinds` and lets the user pick one. Used
 * by the planet/feature settings panels and the workflow-node editor.
 *
 * Props are intentionally minimal — callers control the value and onChange
 * so this works as a controlled component. `null` / undefined value means
 * "inherit from the cascade above".
 */

export interface AgentKindInfo {
  kind: AgentKind
  runtime: 'sdk' | 'pty'
  capabilities: AgentCapabilities
}

interface AgentKindsResponse {
  defaultKind: AgentKind
  kinds: AgentKindInfo[]
}

export interface AgentKindPickerProps {
  value: AgentKind | null | undefined
  onChange: (kind: AgentKind | null) => void
  /** When true, render an explicit "Inherit" option (default). When false,
   *  the selection is required. */
  allowInherit?: boolean
  /** Optional id for label association. */
  id?: string
  /** Inline CSS classes for styling under the existing system. */
  className?: string
  /** Filter: only show kinds whose capabilities match all of these flags. */
  requireCapabilities?: Array<keyof AgentCapabilities>
}

let _cache: AgentKindsResponse | null = null
let _inflight: Promise<AgentKindsResponse> | null = null

async function fetchAgentKinds(): Promise<AgentKindsResponse> {
  if (_cache) return _cache
  if (_inflight) return _inflight
  _inflight = fetch('/api/agent-kinds')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<AgentKindsResponse>
    })
    .then((data) => {
      _cache = data
      _inflight = null
      return data
    })
    .catch((err) => {
      _inflight = null
      throw err
    })
  return _inflight
}

export function AgentKindPicker(props: AgentKindPickerProps) {
  const {
    value,
    onChange,
    allowInherit = true,
    id,
    className,
    requireCapabilities,
  } = props

  const [data, setData] = useState<AgentKindsResponse | null>(_cache)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (data) return
    let cancelled = false
    fetchAgentKinds()
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [data])

  if (error) {
    return (
      <select disabled className={className} id={id}>
        <option>error: {error}</option>
      </select>
    )
  }
  if (!data) {
    return (
      <select disabled className={className} id={id}>
        <option>loading…</option>
      </select>
    )
  }

  const visible = requireCapabilities
    ? data.kinds.filter((info) =>
        requireCapabilities.every((cap) => info.capabilities[cap]),
      )
    : data.kinds

  return (
    <select
      id={id}
      className={className}
      value={value ?? ''}
      onChange={(e) => {
        const next = e.target.value
        onChange(next === '' ? null : (next as AgentKind))
      }}
    >
      {allowInherit ? (
        <option value="">Inherit (default: {data.defaultKind})</option>
      ) : null}
      {visible.map((info) => (
        <option key={info.kind} value={info.kind}>
          {info.kind} ({info.runtime})
        </option>
      ))}
    </select>
  )
}
