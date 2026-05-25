import { create } from 'zustand'

export type ToastKind = 'error' | 'info' | 'success'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface State {
  toasts: Toast[]
}

interface Actions {
  push: (kind: ToastKind, message: string) => void
  dismiss: (id: number) => void
}

let counter = 0

export const useToastStore = create<State & Actions>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = ++counter
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    // Auto-dismiss after 6s for non-error toasts; errors persist until clicked.
    if (kind !== 'error') {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, 6000)
    }
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const pushToast = (kind: ToastKind, message: string) =>
  useToastStore.getState().push(kind, message)
