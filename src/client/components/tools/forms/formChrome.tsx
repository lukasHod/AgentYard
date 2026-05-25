import type { ReactNode } from 'react'

export const inputCls =
  'w-full bg-black border border-cyan-500/40 rounded px-2 py-1 text-zinc-100 focus:outline-none focus:border-cyan-300 disabled:opacity-50'

export const textareaCls = inputCls + ' font-mono'

interface FormChromeProps {
  onCancel: () => void
  onSubmit: () => void
  saving: boolean
  submitLabel?: string
}

export function FormButtons({ onCancel, onSubmit, saving, submitLabel = 'save' }: FormChromeProps) {
  return (
    <div className="flex gap-2 justify-end mt-4 pt-3 border-t border-cyan-500/20">
      <button
        onClick={onCancel}
        disabled={saving}
        className="px-3 py-1 border border-zinc-500 text-zinc-300 hover:bg-zinc-700 tracking-wide"
      >
        cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={saving}
        className="px-4 py-1 border border-cyan-400 text-cyan-200 hover:bg-cyan-500 hover:text-black tracking-wide disabled:opacity-50"
      >
        {saving ? 'saving…' : submitLabel}
      </button>
    </div>
  )
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">
      {children}
      {hint && (
        <span className="ml-2 normal-case tracking-normal text-zinc-600 italic">— {hint}</span>
      )}
    </label>
  )
}

/** Standard name+description header block used by every tool form. */
export function NameDescriptionFields({
  name,
  description,
  onName,
  onDescription,
  disableName,
  layout = 'stacked',
}: {
  name: string
  description: string
  onName: (v: string) => void
  onDescription: (v: string) => void
  disableName: boolean
  layout?: 'stacked' | 'side-by-side'
}) {
  if (layout === 'side-by-side') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>NAME</Label>
          <input
            value={name}
            onChange={(e) => onName(e.target.value)}
            disabled={disableName}
            className={inputCls}
          />
        </div>
        <div>
          <Label>DESCRIPTION</Label>
          <input
            value={description}
            onChange={(e) => onDescription(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>
    )
  }
  return (
    <>
      <div>
        <Label>NAME</Label>
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          disabled={disableName}
          className={inputCls}
        />
      </div>
      <div>
        <Label>DESCRIPTION</Label>
        <input
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          className={inputCls}
        />
      </div>
    </>
  )
}
