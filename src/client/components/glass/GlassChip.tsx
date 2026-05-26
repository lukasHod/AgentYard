// src/client/components/glass/GlassChip.tsx
import type { HTMLAttributes, PropsWithChildren } from 'react'

export function GlassChip({ className = '', children, ...rest }: PropsWithChildren<HTMLAttributes<HTMLSpanElement>>) {
  return <span className={`glass-chip ${className}`} {...rest}>{children}</span>
}
