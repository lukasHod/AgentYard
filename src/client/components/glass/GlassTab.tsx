// src/client/components/glass/GlassTab.tsx
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'

export function GlassTab({
  active,
  className = '',
  children,
  ...rest
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }>) {
  return (
    <button className={`glass-tab ${active ? 'active' : ''} ${className}`} {...rest}>
      {children}
    </button>
  )
}
