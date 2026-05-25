import { useDismissable } from '../hooks/useDismissable'
import type { SessionDescriptor } from '../../core/types'
import { AgentChat, type AgentChatMessage, type AgentChatPending } from '../components/AgentChat'

export function ChatModal({
  title,
  agentRunId,
  session,
  transcript,
  pending,
  connected,
  onSend,
  onReply,
  onClose,
}: {
  title: string
  agentRunId: string
  session: SessionDescriptor | null
  transcript: AgentChatMessage[]
  pending: AgentChatPending | null
  connected: boolean
  onSend: (content: string) => void
  onReply: (toolUseId: string, answer: string) => void
  onClose: () => void
}) {
  useDismissable(true, onClose)
  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-20"
      onClick={onClose}
    >
      <div
        className="bg-black border border-cyan-500/60 rounded w-full max-w-2xl h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-cyan-500/40 px-4 py-2 flex items-center justify-between">
          <h2 className="text-cyan-300 tracking-widest text-xs">{title}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">
            ×
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <AgentChat
            agentRunId={agentRunId}
            label={session?.label}
            role={session?.role}
            state={session?.state}
            transcript={transcript}
            pending={pending}
            connected={connected}
            onSend={onSend}
            onReply={onReply}
          />
        </div>
      </div>
    </div>
  )
}
