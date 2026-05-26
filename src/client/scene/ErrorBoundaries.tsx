// src/client/scene/ErrorBoundaries.tsx
import { Component, type ReactNode } from 'react'

interface State { failed: boolean }

interface Props {
  fallback: ReactNode
  children: ReactNode
}

export class GlbErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }
  static getDerivedStateFromError(): State {
    return { failed: true }
  }
  componentDidCatch(err: unknown): void {
    console.error('GLB load failed', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
