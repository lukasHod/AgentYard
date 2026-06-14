import { AgentAdapterRegistry } from '../runtime/adapters/registry.js'
import { getGlobalDefaultAgentKind } from '../agentKindCascade.js'
import type { AppContext } from './context.js'

/**
 * Phase 6: surface the registered AgentKinds + their capabilities so the
 * frontend AgentKindPicker can render a dropdown without hard-coding what
 * the backend supports. The registry is constructed per-request because
 * its construction is cheap and the registry is currently stateless.
 */
export function registerAgentKindRoutes(ctx: AppContext): void {
  const { app } = ctx
  app.get('/api/agent-kinds', async () => {
    const registry = new AgentAdapterRegistry()
    return {
      defaultKind: getGlobalDefaultAgentKind(),
      kinds: registry.list().map((adapter) => ({
        kind: adapter.kind,
        runtime: adapter.runtime,
        capabilities: adapter.capabilities,
      })),
    }
  })
}
