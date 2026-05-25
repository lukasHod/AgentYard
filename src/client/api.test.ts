import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { apiDelete, apiGet, apiPost, apiPut } from './api'

const originalFetch = globalThis.fetch

interface FakeOpts {
  status?: number
  body?: unknown
  textBody?: string
  reject?: Error
}

function mockFetch(opts: FakeOpts) {
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    if (opts.reject) throw opts.reject
    const status = opts.status ?? 200
    const responseText =
      opts.textBody !== undefined
        ? opts.textBody
        : opts.body !== undefined
          ? JSON.stringify(opts.body)
          : ''
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => responseText,
      json: async () => (opts.body ?? JSON.parse(responseText || '{}')),
    } as Response
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('apiGet', () => {
  it('returns parsed JSON on 2xx', async () => {
    mockFetch({ body: { hello: 'world' } })
    const res = await apiGet<{ hello: string }>('/api/foo')
    expect(res).toEqual({ ok: true, data: { hello: 'world' } })
  })

  it('returns undefined data for 204 No Content', async () => {
    mockFetch({ status: 204 })
    const res = await apiGet('/api/foo')
    expect(res.ok).toBe(true)
  })

  it('returns undefined data for empty body', async () => {
    mockFetch({ status: 200, textBody: '' })
    const res = await apiGet('/api/foo')
    expect(res.ok).toBe(true)
  })
})

describe('apiPost', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({}),
    } as Response))
    globalThis.fetch = fetchSpy as unknown as typeof fetch
  })

  it('sends a JSON body when one is provided', async () => {
    await apiPost('/api/x', { a: 1 })
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('omits headers and body when called with no payload', async () => {
    await apiPost('/api/x')
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect(init.body).toBeUndefined()
    expect(init.headers).toBeUndefined()
  })
})

describe('apiPut & apiDelete', () => {
  it('apiPut uses PUT method', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({}),
    } as Response))
    globalThis.fetch = spy as unknown as typeof fetch
    await apiPut('/api/x', { y: 2 })
    expect(spy.mock.calls[0]?.[1]?.method).toBe('PUT')
  })

  it('apiDelete uses DELETE method', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({}),
    } as Response))
    globalThis.fetch = spy as unknown as typeof fetch
    await apiDelete('/api/x')
    expect(spy.mock.calls[0]?.[1]?.method).toBe('DELETE')
  })
})

describe('error path', () => {
  it('extracts `error` field from JSON error response', async () => {
    mockFetch({ status: 400, body: { error: 'bad thing' } })
    const res = await apiGet('/api/x')
    expect(res).toEqual({ ok: false, error: 'bad thing', status: 400 })
  })

  it('falls back to "HTTP <status>" when error field missing', async () => {
    mockFetch({ status: 500, body: { foo: 'bar' } })
    const res = await apiGet('/api/x')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('HTTP 500')
      expect(res.status).toBe(500)
    }
  })

  it('returns network error message when fetch throws', async () => {
    mockFetch({ reject: new Error('connection refused') })
    const res = await apiGet('/api/x')
    expect(res).toEqual({ ok: false, error: 'connection refused' })
  })
})
