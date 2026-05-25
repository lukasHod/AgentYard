import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Extra utility classes (size, padding, etc.). Layered after the defaults. */
  className?: string
}

/**
 * The "// nothing here" placeholder used across views (no features yet,
 * waiting for first node, etc.). One styled italic paragraph with a `//`
 * prefix so the empty state reads like a code comment.
 *
 * For multi-line bodies, just pass JSX as children.
 */
export function EmptyMessage({ children, className }: Props) {
  return (
    <p className={`text-zinc-600 italic${className ? ` ${className}` : ''}`}>
      // {children}
    </p>
  )
}
