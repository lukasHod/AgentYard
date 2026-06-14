import type { AgentAdapter, AgentKind } from '../../../core/plugins.js'
import { ClaudeSdkAdapter } from './claudeSdk.js'
import { ClaudeCodeCliAdapter } from './claudeCodeCli.js'
import { CodexCliAdapter } from './codexCli.js'

/**
 * Single source of truth for which adapters AgentYard ships. Phase 6 lets
 * the user select a kind per planet / feature / workflow node; the
 * selection becomes an AgentKind that this registry resolves to a concrete
 * AgentAdapter.
 */
export class AgentAdapterRegistry {
  private readonly adapters = new Map<AgentKind, AgentAdapter>()

  constructor() {
    this.register(new ClaudeSdkAdapter())
    this.register(new ClaudeCodeCliAdapter())
    this.register(new CodexCliAdapter())
  }

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.kind, adapter)
  }

  get(kind: AgentKind): AgentAdapter {
    const adapter = this.adapters.get(kind)
    if (!adapter) throw new Error(`No agent adapter registered for kind "${kind}"`)
    return adapter
  }

  list(): AgentAdapter[] {
    return Array.from(this.adapters.values())
  }
}
