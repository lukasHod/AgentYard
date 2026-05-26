// src/client/components/glass/GlassPanel.tsx
import type { HTMLAttributes, PropsWithChildren } from 'react'

export function GlassPanel({ className = '', children, ...rest }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={`glass-panel ${className}`} {...rest}>
      {children}
    </div>
  )
}
