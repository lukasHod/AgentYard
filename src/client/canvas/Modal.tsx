import type { ReactNode } from 'react'
import { useDismissable } from '../hooks/useDismissable'

export function Modal({
  title,
  children,
  onClose,
  onSubmit,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  onSubmit: () => void
}) {
  useDismissable(true, onClose)
  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-20"
      onClick={onClose}
    >
      <div
        className="bg-black border border-cyan-500/60 rounded p-6 max-w-xl w-full text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-cyan-300 tracking-widest text-sm mb-4">{title}</h2>
        {children}
        <div className="flex gap-2 mt-4 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1 border border-zinc-500 text-zinc-400 hover:bg-zinc-700 text-xs tracking-wide"
          >
            cancel
          </button>
          <button
            onClick={onSubmit}
            className="px-4 py-1 border border-fuchsia-500 text-fuchsia-300 hover:bg-fuchsia-500 hover:text-black text-xs tracking-wide"
          >
            launch
          </button>
        </div>
      </div>
    </div>
  )
}
