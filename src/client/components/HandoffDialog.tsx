import { useState } from 'react'
import { GlassPanel } from './glass/GlassPanel'
import { GlassButton } from './glass/GlassButton'
import { apiPost } from '../api'
import { pushToast } from '../state/toastStore'
import type { FeatureSummary } from '../../core/types'

interface Props {
  planetId: number
  feature: FeatureSummary
  onClose: () => void
}

export function HandoffDialog({ planetId, feature, onClose }: Props) {
  const [handoffNote, setHandoffNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const res = await apiPost(`/api/planets/${planetId}/handoffs`, {
      featureId: feature.id,
      handoffNote: handoffNote.trim() || undefined,
    })
    setSubmitting(false)
    if (res.ok) {
      pushToast('success', `Handoff created for "${feature.name}"`)
      onClose()
    } else {
      pushToast('error', `Handoff failed: ${res.error}`)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <GlassPanel className="w-full max-w-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sky-300 tracking-widest text-xs">HAND OFF — {feature.name}</span>
          <GlassButton variant="ghost" className="text-xs" onClick={onClose}>✕</GlassButton>
        </div>

        <p className="text-slate-500 text-xs">
          Claude will analyze the current session context and generate the handoff description automatically.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[10px] tracking-widest text-slate-500 block mb-1">
              HANDOVER NOTE <span className="text-slate-600">(optional)</span>
            </label>
            <input
              type="text"
              className="w-full bg-slate-800/60 border border-sky-400/20 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-sky-400/60"
              placeholder="e.g. tests still failing on X, picked up mid-implementation"
              value={handoffNote}
              onChange={(e) => setHandoffNote(e.target.value)}
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <GlassButton type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </GlassButton>
            <GlassButton type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Generating & pushing...' : 'Hand off'}
            </GlassButton>
          </div>
        </form>
      </GlassPanel>
    </div>
  )
}
