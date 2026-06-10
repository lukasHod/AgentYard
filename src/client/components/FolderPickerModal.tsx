import { useEffect, useRef, useState } from 'react'
import { GlassPanel } from './glass/GlassPanel'
import { GlassButton } from './glass/GlassButton'
import { apiGet } from '../api'
import { parentDirectory } from '../state/projectPickerPrefs'

interface DirEntry { name: string; path: string }
interface DirListing {
  current: string
  parent: string | null
  entries: DirEntry[]
  roots: DirEntry[]
}

interface Props {
  initialPath?: string
  onSelect: (path: string) => void
  onClose: () => void
}

export function FolderPickerModal({ initialPath = '', onSelect, onClose }: Props) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const requestId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  async function navigate(p: string, optimistic = false) {
    const nextRequestId = requestId.current + 1
    requestId.current = nextRequestId
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    if (optimistic) {
      const parent = parentDirectory(p) || null
      setListing((current) => ({
        current: p,
        parent,
        entries: [],
        roots: current?.roots ?? [],
      }))
      setTyped(p)
    }

    setLoading(true)
    setError(null)
    const res = await apiGet<DirListing>(
      `/api/fs/dirs?path=${encodeURIComponent(p)}`,
      { signal: controller.signal },
    )
    if (nextRequestId !== requestId.current) return
    if (!res.ok && res.aborted) return
    setLoading(false)
    if (res.ok) {
      setListing(res.data)
      setTyped(res.data.current)
      return
    }
    setError(
      res.status === 500
        ? 'Folder browser is unavailable. Make sure the AgentYard server is running on port 4242.'
        : res.error,
    )
  }

  useEffect(() => {
    navigate(initialPath)
    return () => abortRef.current?.abort()
  }, [initialPath])

  function handleTyped(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') navigate(typed)
  }

  if (!listing) {
    return (
      <div
        className="fixed inset-0 z-50 pointer-events-auto bg-black/70 flex items-center justify-center"
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <GlassPanel className="p-6 w-[520px] flex flex-col gap-3">
          <p className="text-slate-400 text-xs">{loading ? 'loading...' : 'Folder browser unavailable'}</p>
          {error && <p className="text-rose-300 text-xs leading-relaxed">{error}</p>}
          {error && (
            <div className="flex justify-end gap-2">
              <GlassButton variant="ghost" className="text-xs" onClick={onClose}>close</GlassButton>
              <GlassButton className="text-xs" onClick={() => navigate(typed)}>retry</GlassButton>
            </div>
          )}
        </GlassPanel>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-auto bg-black/70 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <GlassPanel className="p-4 w-[560px] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sky-300 tracking-widest text-xs">SELECT FOLDER</span>
          <GlassButton variant="ghost" className="text-xs" onClick={onClose}>✕</GlassButton>
        </div>

        {/* Path bar */}
        <input
          className="w-full bg-black/40 border border-sky-400/30 rounded px-2 py-1 font-mono text-xs"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={handleTyped}
          placeholder="Type a path and press Enter"
          spellCheck={false}
        />

        {/* Drive roots (Windows) or / (Unix) */}
        {listing.roots.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            {listing.roots.map((r) => (
              <button
                key={r.path}
                onClick={() => navigate(r.path, true)}
                className="text-[10px] px-2 py-0.5 rounded border border-sky-400/20 text-sky-400 hover:bg-sky-400/10"
              >
                {r.name}
              </button>
            ))}
          </div>
        )}

        {/* Directory listing */}
        <div className="overflow-y-auto max-h-64 space-y-0.5">
          {listing.parent !== null && (
            <button
              onClick={() => navigate(listing.parent!, true)}
              className="w-full text-left px-2 py-1 rounded text-xs text-slate-400 hover:bg-sky-400/10 flex items-center gap-2"
            >
              <span>↑</span>
              <span className="font-mono">..</span>
            </button>
          )}
          {loading && <p className="text-slate-500 text-xs px-2 py-1">loading...</p>}
          {!loading && listing.entries.length === 0 && (
            <p className="text-slate-600 text-xs px-2 py-1 italic">no subdirectories</p>
          )}
          {!loading && listing.entries.map((e) => (
            <button
              key={e.path}
              onClick={() => navigate(e.path, true)}
              className="w-full text-left px-2 py-1 rounded text-xs text-slate-200 hover:bg-sky-400/10 flex items-center gap-2 font-mono"
            >
              <span className="text-sky-400/60">📁</span>
              {e.name}
            </button>
          ))}
        </div>

        {/* Current selection */}
        <div className="border-t border-sky-400/10 pt-2 flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-slate-400 truncate">{listing.current}</span>
          <GlassButton
            variant="primary"
            className="shrink-0 text-xs"
            onClick={() => { onSelect(listing.current); onClose() }}
          >
            Select
          </GlassButton>
        </div>
      </GlassPanel>
    </div>
  )
}
