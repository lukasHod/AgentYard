import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import './TerminalPanel.css'
import {
  useTerminal,
  useTerminalBuffer,
  useSocketStore,
} from '../state/socketStore'
import {
  attachTerminal,
  detachTerminal,
  resizeTerminal,
  sendTerminalInput,
  restartTerminal,
  resumeTerminal,
  openShellFromTerminal,
  restartTerminalWithContext,
} from '../state/socketClient'

interface Props {
  sessionId: string
  className?: string
}

const TERMINAL_THEME = {
  background: 'rgba(2, 6, 23, 0)',
  foreground: '#e2e8f0',
  cursor: '#67e8f9',
  cursorAccent: '#020617',
  selectionBackground: 'rgba(103, 232, 249, 0.35)',
  black: '#020617',
  red: '#f43f5e',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e2e8f0',
  brightBlack: '#475569',
  brightRed: '#fb7185',
  brightGreen: '#6ee7b7',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f8fafc',
}

const BTN =
  'px-2.5 py-0.5 rounded text-[11px] font-medium border transition-colors ' +
  'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

const BTN_PRIMARY =
  'px-2.5 py-0.5 rounded text-[11px] font-medium border transition-colors ' +
  'border-cyan-600 bg-cyan-800/60 text-cyan-200 hover:bg-cyan-700/70 hover:text-white'

export function TerminalPanel({ sessionId, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const writtenBufferRef = useRef('')

  const descriptor = useTerminal(sessionId)
  const buffer = useTerminalBuffer(sessionId)

  const [contextMarkdown, setContextMarkdown] = useState<string | null>(null)
  const [loadingContext, setLoadingContext] = useState(false)

  useLayoutEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: true,
      allowProposedApi: true,
      theme: TERMINAL_THEME,
    })
    const fit = new FitAddon()
    const links = new WebLinksAddon()
    term.loadAddon(fit)
    term.loadAddon(links)
    term.open(containerRef.current)

    const initialBuffer = useSocketStore.getState().terminalBuffers.get(sessionId) ?? ''
    if (initialBuffer) term.write(initialBuffer)
    writtenBufferRef.current = initialBuffer

    termRef.current = term
    fitRef.current = fit

    const onDataDisposable = term.onData((data) => sendTerminalInput(sessionId, data))

    let lastCols = term.cols
    let lastRows = term.rows
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // ResizeObserver fires before layout settles in some StrictMode double-mounts
      }
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols
        lastRows = term.rows
        resizeTerminal(sessionId, term.cols, term.rows)
      }
    })
    ro.observe(containerRef.current)

    const raf = requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        // ignore
      }
      lastCols = term.cols
      lastRows = term.rows
      attachTerminal(sessionId)
      resizeTerminal(sessionId, term.cols, term.rows)
    })

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      onDataDisposable.dispose()
      detachTerminal(sessionId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
      writtenBufferRef.current = ''
    }
  }, [sessionId])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const written = writtenBufferRef.current
    if (buffer === written) return
    if (buffer.startsWith(written)) {
      term.write(buffer.slice(written.length))
      writtenBufferRef.current = buffer
      return
    }
    term.reset()
    term.write(buffer)
    writtenBufferRef.current = buffer
  }, [buffer])

  const ended =
    descriptor &&
    (descriptor.state === 'exited' ||
      descriptor.state === 'killed' ||
      descriptor.state === 'failed' ||
      descriptor.state === 'runtime_lost')

  const canResume = descriptor?.profileId === 'claude-cli'
  const hasFeatureContext = descriptor?.featureId !== null && descriptor?.featureId !== undefined

  const handleFetchContext = async () => {
    setLoadingContext(true)
    try {
      const res = await fetch(`/api/terminals/${sessionId}/handoff-summary`)
      if (res.ok) {
        const data = (await res.json()) as { markdown: string }
        setContextMarkdown(data.markdown)
      }
    } finally {
      setLoadingContext(false)
    }
  }

  const handleStartWithContext = () => {
    if (!contextMarkdown) return
    restartTerminalWithContext(sessionId, contextMarkdown)
    setContextMarkdown(null)
  }

  const stateLabel = (() => {
    if (!descriptor) return ''
    switch (descriptor.state) {
      case 'runtime_lost': return 'Runtime lost — server restarted'
      case 'exited': return 'Session exited'
      case 'killed': return 'Session killed'
      case 'failed': return 'Session failed'
      default: return descriptor.state
    }
  })()

  return (
    <div className={`terminal-panel relative h-full w-full ${className ?? ''}`}>
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden bg-slate-950/25 backdrop-blur-[2px]"
      />

      {ended && (
        <div className="absolute inset-x-0 bottom-0 bg-slate-950/95 border-t border-slate-700/70 flex flex-col gap-0">
          {/* State info */}
          <div className="px-3 pt-1.5 pb-0.5 text-[10px] tracking-widest text-rose-300/80 select-none">
            {stateLabel}
            {descriptor!.exitCode !== null ? ` · exit ${descriptor!.exitCode}` : ''}
            {descriptor!.exitSignal !== null ? ` · sig ${descriptor!.exitSignal}` : ''}
          </div>

          {/* Action buttons */}
          <div className="px-2 pb-2 flex gap-1.5 flex-wrap items-center">
            <button className={BTN} onClick={() => restartTerminal(sessionId)}>
              Restart
            </button>
            {canResume && (
              <button className={BTN} onClick={() => resumeTerminal(sessionId)}>
                Resume ↩
              </button>
            )}
            <button
              className={BTN}
              onClick={handleFetchContext}
              disabled={loadingContext}
            >
              {loadingContext ? 'Loading…' : 'Restart with Context'}
            </button>
            <button className={BTN} onClick={() => openShellFromTerminal(sessionId)}>
              Open Shell
            </button>
          </div>

          {/* Context preview panel */}
          {contextMarkdown !== null && (
            <div className="px-2 pb-2 flex flex-col gap-1.5 border-t border-slate-700/50 pt-2">
              <div className="text-[10px] text-slate-400 px-1">
                Edit the handoff context below, then click{' '}
                <span className="text-cyan-300">Start with Context</span>.
                {!hasFeatureContext && (
                  <span className="text-amber-400"> No feature context — git info may be missing.</span>
                )}
              </div>
              <textarea
                className="w-full h-40 text-[10px] font-mono bg-slate-900/80 text-slate-300 border border-slate-600/60 rounded p-2 resize-y leading-relaxed outline-none focus:border-slate-500"
                value={contextMarkdown}
                onChange={(e) => setContextMarkdown(e.target.value)}
                spellCheck={false}
              />
              <div className="flex gap-2">
                <button className={BTN_PRIMARY} onClick={handleStartWithContext}>
                  Start with Context
                </button>
                <button className={BTN} onClick={() => setContextMarkdown(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
