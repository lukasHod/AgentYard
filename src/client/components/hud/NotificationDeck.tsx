import { useEffect, useRef } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { useGlobalWaitingCount, usePendingQuestions } from '../../state/socketStore'
import { useUiStore } from '../../state/uiStore'
import { answerQuestion, dismissQuestion } from '../../state/socketClient'
import { playClarificationChime, isAudioMuted } from '../../canvas/chime'
import { useNotificationRows } from './useNotificationRows'
import { useState } from 'react'

function InlineAnswerForm({ questionId }: { questionId: string }) {
  const [answer, setAnswer] = useState('')
  const submit = () => {
    const t = answer.trim()
    if (!t) return
    answerQuestion(questionId, t)
    setAnswer('')
  }
  return (
    <div className="flex gap-1 mt-1">
      <input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        placeholder="answer…"
        className="flex-1 bg-black/40 border border-amber-400/30 rounded px-2 py-0.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-300"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!answer.trim()}
        className="px-2 py-0.5 text-[10px] text-amber-300 border border-amber-400/30 rounded hover:border-amber-300 disabled:opacity-40"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={() => dismissQuestion(questionId)}
        className="px-2 py-0.5 text-[10px] text-slate-500 border border-slate-600/30 rounded hover:text-slate-300"
      >
        ×
      </button>
    </div>
  )
}

export function NotificationDeck() {
  const globalWaiting = useGlobalWaitingCount()
  const durableQuestions = usePendingQuestions()
  const navigateTo = useUiStore((s) => s.navigateTo)
  const prevCount = useRef(0)

  // Chime when the global waiting count rises.
  useEffect(() => {
    if (globalWaiting > prevCount.current && !isAudioMuted()) {
      playClarificationChime()
    }
    prevCount.current = globalWaiting
  }, [globalWaiting])

  const rows = useNotificationRows()
  // Build a lookup so each row can find its durable question for inline answering.
  const questionBySession = new Map(durableQuestions.map((q) => [q.agentSessionId, q]))

  if (rows.length === 0) return null

  return (
    <div className="absolute right-4 top-20 w-80 z-30 pointer-events-auto">
      <GlassPanel className="overflow-hidden">
        <div className="px-3 py-2 border-b border-amber-300/30 text-xs tracking-widest text-amber-300">
          INBOX · {rows.length}
        </div>
        <ul>
          {rows.map((r) => {
            const durableQ = questionBySession.get(r.agentSessionId)
            return (
              <li
                key={r.agentSessionId}
                className="px-3 py-2 border-b border-amber-300/10 hover:bg-amber-300/5"
              >
                <div
                  className="text-sky-300 text-xs cursor-pointer hover:text-sky-200"
                  onClick={() => navigateTo({
                    planetId: r.planetId,
                    featureId: r.shipFeatureId,
                    terminalSessionId: r.terminalSessionId,
                  })}
                >
                  {r.planetName} · {r.featureName}
                  {r.terminalSessionId && (
                    <span className="ml-1 text-[10px] text-amber-300/60">→ agent tab</span>
                  )}
                </div>
                <p className="text-slate-300 text-sm mt-0.5 line-clamp-2">{r.question}</p>
                {durableQ && <InlineAnswerForm questionId={durableQ.id} />}
              </li>
            )
          })}
        </ul>
      </GlassPanel>
    </div>
  )
}
