import { useEffect, useState } from 'react'
import { GlassButton } from './glass/GlassButton'
import { EmptyMessage } from './ui/EmptyMessage'
import { apiGet, apiPost, apiDelete } from '../api'
import { pushToast } from '../state/toastStore'
import { useUiStore } from '../state/uiStore'
import type { HandoffSummary } from '../../core/types'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function HandoffsTab({ planetId }: { planetId: number }) {
  const [handoffs, setHandoffs] = useState<HandoffSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [pickingUp, setPickingUp] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const openInfoTab = useUiStore((s) => s.openInfoTab)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<HandoffSummary[]>(`/api/planets/${planetId}/handoffs`).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.ok) setHandoffs(res.data)
    })
    return () => { cancelled = true }
  }, [planetId])

  async function handlePickup(h: HandoffSummary) {
    setPickingUp(h.handoffBranch)
    const res = await apiPost(`/api/planets/${planetId}/handoffs/pickup`, {
      handoffBranch: h.handoffBranch,
    })
    setPickingUp(null)
    if (res.ok) {
      setHandoffs((prev) => prev.filter((x) => x.handoffBranch !== h.handoffBranch))
      pushToast('success', `Picked up "${h.featureName}"`)
      openInfoTab('features')
    } else {
      pushToast('error', `Pickup failed: ${res.error}`)
    }
  }

  async function handleCancel(h: HandoffSummary) {
    setCancelling(h.handoffBranch)
    const encodedBranch = encodeURIComponent(h.handoffBranch)
    const res = await apiDelete(`/api/planets/${planetId}/handoffs/${encodedBranch}`)
    setCancelling(null)
    if (res.ok) {
      setHandoffs((prev) => prev.filter((x) => x.handoffBranch !== h.handoffBranch))
      pushToast('info', `Cancelled handoff for "${h.featureName}"`)
    } else {
      pushToast('error', `Cancel failed: ${res.error}`)
    }
  }

  if (loading) return <EmptyMessage>loading...</EmptyMessage>
  if (handoffs.length === 0) return <EmptyMessage>no pending handoffs</EmptyMessage>

  return (
    <ul className="space-y-2">
      {handoffs.map((h) => (
        <li key={h.handoffBranch} className="border border-sky-400/15 rounded p-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sky-300 truncate">{h.featureName}</span>
            <span className="text-[10px] text-slate-500 shrink-0">{relativeTime(h.timestamp)}</span>
          </div>
          <p className="text-slate-300 mt-1 text-xs line-clamp-2">{h.shortDescription}</p>
          <p className="text-[10px] text-slate-500 mt-1">from {h.sender}</p>
          <div className="flex gap-2 mt-2">
            <GlassButton
              variant="primary"
              className="text-xs py-0.5 px-2"
              disabled={pickingUp === h.handoffBranch}
              onClick={() => handlePickup(h)}
            >
              {pickingUp === h.handoffBranch ? 'picking up...' : 'Pick up'}
            </GlassButton>
            <GlassButton
              variant="danger"
              className="text-xs py-0.5 px-2"
              disabled={cancelling === h.handoffBranch}
              onClick={() => handleCancel(h)}
            >
              {cancelling === h.handoffBranch ? 'cancelling...' : 'Cancel'}
            </GlassButton>
          </div>
        </li>
      ))}
    </ul>
  )
}
