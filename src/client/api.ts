/**
 * Thin typed fetch wrappers. Every call returns a discriminated union
 * so callers must handle the error path explicitly — no silent thrown
 * exceptions, no `.catch(() => {})` swallowing.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; aborted?: boolean }

export interface ApiOptions {
  /** Forwarded to fetch — caller controls cancellation. */
  signal?: AbortSignal
}

async function send<T>(url: string, init: RequestInit, opts?: ApiOptions): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { ...init, signal: opts?.signal })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const error =
        typeof body?.error === 'string' && body.error.length > 0
          ? body.error
          : `HTTP ${res.status}`
      return { ok: false, error, status: res.status }
    }
    // 204 / empty body — return undefined typed as T.
    if (res.status === 204) return { ok: true, data: undefined as unknown as T }
    const text = await res.text()
    if (text.length === 0) return { ok: true, data: undefined as unknown as T }
    return { ok: true, data: JSON.parse(text) as T }
  } catch (err) {
    const aborted =
      (err instanceof DOMException && err.name === 'AbortError') ||
      opts?.signal?.aborted === true
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...(aborted ? { aborted: true } : {}),
    }
  }
}

export function apiGet<T>(url: string, opts?: ApiOptions): Promise<ApiResult<T>> {
  return send<T>(url, { method: 'GET' }, opts)
}

export function apiPost<T>(url: string, body?: unknown, opts?: ApiOptions): Promise<ApiResult<T>> {
  return send<T>(
    url,
    {
      method: 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    opts,
  )
}

export function apiPut<T>(url: string, body?: unknown, opts?: ApiOptions): Promise<ApiResult<T>> {
  return send<T>(
    url,
    {
      method: 'PUT',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    opts,
  )
}

export function apiDelete<T>(url: string, opts?: ApiOptions): Promise<ApiResult<T>> {
  return send<T>(url, { method: 'DELETE' }, opts)
}
