import type { Server, Socket } from 'socket.io'
import type { ClientEvents, ServerEvents } from '../core/types.js'

/**
 * Socket.IO `Server` and `Socket` parametrised with our wire contract
 * (`core/types.ts`). Importing these aliases instead of the bare types
 * gives every `io.emit(...)` and `socket.on(...)` checked event names
 * and payload shapes — drift between client and server fails the build.
 *
 * socket.io expects each event as a listener signature `(payload) => void`,
 * but core/types.ts stores them as payload shapes so the client can use them
 * directly as types. This mapped type bridges the two forms.
 */
type AsListenerMap<E> = { [K in keyof E]: (payload: E[K]) => void }

export type TypedIOServer = Server<AsListenerMap<ClientEvents>, AsListenerMap<ServerEvents>>
export type TypedSocket = Socket<AsListenerMap<ClientEvents>, AsListenerMap<ServerEvents>>
