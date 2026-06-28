import type { SessionEvent } from './Session.js'

/**
 * Minimal interface that every agent session provider must satisfy.
 *
 * The Claude Agent SDK implementation is `Session` (Session.ts). Future
 * providers (Codex, etc.) plug in by implementing this interface and
 * registering an `IAgentSessionAdapter` with `SessionManager`.
 *
 * Components that only need to observe or drive a session — such as
 * `SdkTerminalBridge` — depend on this interface, not the concrete class.
 */
export interface IAgentSession {
  readonly id: string
  readonly role: 'leader' | 'drone' | 'free'
  /** Model identifier used by this session, or undefined if using the adapter default. */
  readonly model: string | undefined
  on(event: 'event', listener: (e: SessionEvent) => void): this
  off(event: 'event', listener: (e: SessionEvent) => void): this
  sendUserMessage(content: string): void
  resolveClarification(id: string, answer: string): boolean
  close(): Promise<void>
}
