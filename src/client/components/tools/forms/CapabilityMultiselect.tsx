import type { ToolSummary } from '../../../../core/tools'
import { EmptyMessage } from '../../ui/EmptyMessage'
import { Label } from './formChrome'

export function CapabilityMultiselect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: ToolSummary[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const stale = selected.filter((s) => !options.find((o) => o.name === s))

  return (
    <div>
      <Label hint={`from this ship's library — ${options.length} available`}>{label}</Label>
      {options.length === 0 && stale.length === 0 ? (
        <EmptyMessage>none in library</EmptyMessage>
      ) : (
        <div className="space-y-1 max-h-40 overflow-y-auto pr-1 border border-cyan-500/20 rounded p-1">
          {options.map((o) => {
            const checked = selected.includes(o.name)
            return (
              <label
                key={o.scope + '/' + o.name}
                className="flex items-start gap-2 cursor-pointer hover:bg-zinc-800/40 px-1 py-0.5 rounded"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, o.name]
                      : selected.filter((n) => n !== o.name)
                    onChange(next)
                  }}
                  className="mt-0.5 accent-cyan-500"
                />
                <span className="flex-1">
                  <span className="text-cyan-300">{o.name}</span>{' '}
                  <span className="text-[10px] text-zinc-500">[{o.scope}]</span>
                  {o.description && (
                    <span className="block text-[10px] text-zinc-500 leading-tight">
                      {o.description}
                    </span>
                  )}
                </span>
              </label>
            )
          })}
          {stale.length > 0 && (
            <div className="border-t border-amber-500/30 mt-1 pt-1">
              {stale.map((s) => (
                <div key={s} className="flex items-center gap-1 px-1 py-0.5">
                  <span className="flex-1 text-amber-300 text-[10px]">
                    {s} <span className="text-zinc-500">(missing from library)</span>
                  </span>
                  <button
                    onClick={() => onChange(selected.filter((n) => n !== s))}
                    className="px-1 py-0 border border-rose-500/60 text-rose-300 hover:bg-rose-500/20 text-[10px]"
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
