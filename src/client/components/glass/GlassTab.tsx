// src/client/components/glass/GlassTab.tsx
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'

type GlassTabState = 'active' | 'idle'

export function GlassTab({
  state = 'idle',
  className = '',
  children,
  ...rest
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { state?: GlassTabState }>) {
  return (
    <button className={`glass-tab ${state === 'active' ? 'active' : ''} ${className}`} {...rest}>
      {children}
    </button>
  )
}
