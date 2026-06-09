import { useState } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { apiPost, apiGet } from '../../api'
import { pushToast } from '../../state/toastStore'

export function NewPlanetModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  const submit = async () => {
    if (!name.trim() || !projectPath.trim()) return
    setBusy(true)
    const res = await apiPost('/api/planets', { name: name.trim(), projectPath: projectPath.trim() })
    setBusy(false)
    if (!res.ok) { pushToast('error', `Create project failed: ${res.error}`); return }
    onClose()
  }

  const browse = async () => {
    setBrowsing(true)
    const res = await apiGet<{ path: string | null }>('/api/browse-folder')
    setBrowsing(false)
    if (!res.ok) { pushToast('error', `Browse failed: ${res.error}`); return }
    if (res.data.path) setProjectPath(res.data.path)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center pointer-events-auto" onClick={onClose}>
      <GlassPanel className="p-6 w-[420px]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm tracking-widest text-sky-300 mb-3">NEW PROJECT</h2>
        <label className="text-xs text-slate-400">PROJECT NAME</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="w-full mt-1 mb-3 bg-black/40 border border-sky-400/30 rounded px-2 py-1 text-sm"
        />
        <label className="text-xs text-slate-400">PROJECT PATH</label>
        <input
          value={projectPath}
          onChange={(e) => setProjectPath(e.target.value)}
          onClick={browse}
          readOnly={browsing}
          placeholder="C:/code/my-repo (must be a git repository)"
          className="w-full mt-1 mb-4 bg-black/40 border border-sky-400/30 rounded px-2 py-1 font-mono text-xs cursor-pointer"
        />
        <div className="flex justify-end gap-2">
          <GlassButton variant="ghost" onClick={onClose}>cancel</GlassButton>
          <GlassButton onClick={submit} disabled={busy}>{busy ? 'creating…' : 'create'}</GlassButton>
        </div>
      </GlassPanel>
    </div>
  )
}
