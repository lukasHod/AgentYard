import { useEffect, useMemo, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import type { ShipSummary } from '../../core/types'
import type { Workflow, WorkflowNode } from '../../core/schema'
import { useDismissable } from '../hooks/useDismissable'
import { TestRunForm } from './testRun/TestRunForm'
import { TestRunLive } from './testRun/TestRunLive'
import { SYSTEM_TAB_ID, type TestRunRequest } from './testRun/types'
import { useTestRunSocket } from './testRun/useTestRunSocket'

export type { TestRunRequest } from './testRun/types'

interface Props {
  request: TestRunRequest
  workflow: Workflow
  ships: ShipSummary[]
  socket: Socket | null
  onClose: () => void
}

export function TestRunModal({ request, workflow, ships, socket, onClose }: Props) {
  const targetNode: WorkflowNode | null =
    request.scope === 'node' && request.nodeId
      ? workflow.graph.nodes.find((n) => n.id === request.nodeId) ?? null
      : null
  const customNodes = useMemo(
    () => new Map(workflow.graph.nodes.filter((n) => n.type === 'custom').map((n) => [n.id, n])),
    [workflow.graph.nodes],
  )

  const [shipId, setShipId] = useState<number | null>(ships[0]?.id ?? null)
  const [task, setTask] = useState('')
  const [upstreamOutputs, setUpstreamOutputs] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [testRunId, setTestRunId] = useState<string | null>(null)
  const [selectedTab, setSelectedTab] = useState<string>(SYSTEM_TAB_ID)
  const [chatInput, setChatInput] = useState('')
  const [replyInput, setReplyInput] = useState('')

  const {
    stage,
    setStage,
    sessions,
    transcripts,
    pendings,
    nodeProgress,
    scriptOutputs,
    finalSummary,
    error,
  } = useTestRunSocket({ socket, testRunId, customNodes })

  const scrollRef = useRef<HTMLDivElement>(null)

  // Whenever the visible transcript changes, scroll to bottom.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [selectedTab, transcripts, pendings, nodeProgress, scriptOutputs, finalSummary, error])

  // Auto-select a new agent tab the first time it appears (only while running).
  useEffect(() => {
    if (stage !== 'running') return
    if (selectedTab === SYSTEM_TAB_ID && sessions.length > 0) {
      setSelectedTab(sessions[0]!.id)
    }
  }, [sessions, selectedTab, stage])

  async function submit() {
    if (!shipId) {
      setSubmitError('Select a ship')
      return
    }
    if (task.trim().length === 0) {
      setSubmitError('Task is required')
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/test-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipId,
          workflowId: workflow.id,
          task,
          scope: request.scope,
          nodeId: request.nodeId,
          upstreamOutputs: request.scope === 'node' ? upstreamOutputs : undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitError(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`)
        setSubmitting(false)
        return
      }
      setTestRunId(body.testRunId)
      setStage('running')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  async function abort() {
    if (!testRunId) return
    setStage('aborted')
    await fetch(`/api/test-runs/${testRunId}/abort`, { method: 'POST' }).catch(() => {})
  }

  function sendBarge() {
    const text = chatInput.trim()
    if (!text || !testRunId || !socket || selectedTab === SYSTEM_TAB_ID) return
    if (selectedTab.startsWith('script:')) return
    socket.emit('test-run:agent:send', {
      testRunId,
      agentRunId: selectedTab,
      content: text,
    })
    setChatInput('')
  }

  function sendReply() {
    const text = replyInput.trim()
    if (!text || !testRunId || !socket) return
    const pending = pendings.get(selectedTab)
    if (!pending) return
    socket.emit('test-run:clarification:reply', {
      testRunId,
      agentRunId: selectedTab,
      toolUseId: pending.toolUseId,
      answer: text,
    })
    setReplyInput('')
  }

  const headerLabel =
    request.scope === 'workflow'
      ? `test workflow › ${workflow.name}`
      : `test node › ${targetNode?.title ?? request.nodeId}`

  useDismissable(true, onClose)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-black border border-fuchsia-500/60 shadow-[0_0_30px_rgba(217,70,239,0.25)] w-[min(1100px,95vw)] h-[min(800px,90vh)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 border-b border-fuchsia-500/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-fuchsia-300 text-xs tracking-[0.3em] uppercase">sandbox</span>
            <span className="text-zinc-300 text-xs">{headerLabel}</span>
            {testRunId && <span className="text-zinc-600 text-[10px] font-mono">{testRunId}</span>}
          </div>
          <div className="flex items-center gap-2">
            {stage === 'running' && (
              <button
                onClick={abort}
                className="px-2 py-0.5 border border-rose-500/60 text-rose-300 hover:bg-rose-500/20 text-xs"
              >
                abort
              </button>
            )}
            <button
              onClick={onClose}
              className="px-2 py-0.5 border border-zinc-500 text-zinc-400 hover:bg-zinc-700/40 text-xs"
            >
              close
            </button>
          </div>
        </div>

        {stage === 'form' ? (
          <TestRunForm
            ships={ships}
            shipId={shipId}
            setShipId={setShipId}
            task={task}
            setTask={setTask}
            request={request}
            workflow={workflow}
            targetNode={targetNode}
            upstreamOutputs={upstreamOutputs}
            setUpstreamOutputs={setUpstreamOutputs}
            submitting={submitting}
            submitError={submitError}
            onSubmit={submit}
          />
        ) : (
          <TestRunLive
            stage={stage}
            sessions={sessions}
            transcripts={transcripts}
            pendings={pendings}
            nodeProgress={nodeProgress}
            scriptOutputs={scriptOutputs}
            customNodes={customNodes}
            finalSummary={finalSummary}
            error={error}
            selectedTab={selectedTab}
            setSelectedTab={setSelectedTab}
            scrollRef={scrollRef}
            chatInput={chatInput}
            setChatInput={setChatInput}
            replyInput={replyInput}
            setReplyInput={setReplyInput}
            onSendBarge={sendBarge}
            onSendReply={sendReply}
          />
        )}
      </div>
    </div>
  )
}
