import { useToastStore } from '../state/toastStore'

const KIND_STYLES = {
  error: 'border-rose-500/80 text-rose-100 bg-rose-950/80',
  info: 'border-cyan-500/60 text-cyan-100 bg-cyan-950/80',
  success: 'border-emerald-500/60 text-emerald-100 bg-emerald-950/80',
} as const

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-md pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto text-left text-xs px-3 py-2 border shadow-lg backdrop-blur-sm tracking-wide ${KIND_STYLES[t.kind]}`}
        >
          <span className="opacity-60 mr-2 uppercase text-[10px]">{t.kind}</span>
          {t.message}
        </button>
      ))}
    </div>
  )
}
