import { useEffect, useLayoutEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
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
} from '../state/socketClient'

interface Props {
  sessionId: string
  /** Optional className for the outer container. */
  className?: string
}

const TERMINAL_THEME = {
  background: '#020617',
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

export function TerminalPanel({ sessionId, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // Track how much of the rolling buffer has been written into xterm so a
  // store-driven re-render only forwards the delta — without this we'd
  // reprint the entire scrollback on every chunk.
  const writtenBufferRef = useRef('')

  const descriptor = useTerminal(sessionId)
  const buffer = useTerminalBuffer(sessionId)

  // Mount: build the terminal once per session id.
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
      allowProposedApi: true,
      theme: TERMINAL_THEME,
    })
    const fit = new FitAddon()
    const links = new WebLinksAddon()
    term.loadAddon(fit)
    term.loadAddon(links)
    term.open(containerRef.current)

    // Paint whatever the server has already sent for this session (snapshot
    // / accumulated data) before live data starts arriving.
    const initialBuffer = useSocketStore.getState().terminalBuffers.get(sessionId) ?? ''
    if (initialBuffer) term.write(initialBuffer)
    writtenBufferRef.current = initialBuffer

    termRef.current = term
    fitRef.current = fit

    // Keystrokes → server.
    const onDataDisposable = term.onData((data) => sendTerminalInput(sessionId, data))

    // Container resize → fit + tell the server.
    let lastCols = term.cols
    let lastRows = term.rows
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // ResizeObserver fires before layout settles in some StrictMode
        // double-mounts; ignore and let the next tick handle it.
      }
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols
        lastRows = term.rows
        resizeTerminal(sessionId, term.cols, term.rows)
      }
    })
    ro.observe(containerRef.current)

    // First fit on the next frame so layout has a real size.
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

  // Stream the delta whenever the buffer grows. A snapshot replaces the
  // buffer wholesale; in that case we clear xterm and repaint from scratch.
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
    {
      term.reset()
      term.write(buffer)
      writtenBufferRef.current = buffer
    }
  }, [buffer])

  // Surface terminated state so the user knows the PTY is gone. xterm itself
  // keeps showing the last frame, which is fine; we just add a banner.
  const ended =
    descriptor &&
    (descriptor.state === 'exited' ||
      descriptor.state === 'killed' ||
      descriptor.state === 'failed' ||
      descriptor.state === 'runtime_lost')

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      <div ref={containerRef} className="absolute inset-0 bg-slate-950" />
      {ended && (
        <div className="absolute inset-x-0 bottom-0 px-3 py-1 text-[10px] tracking-widest bg-black/70 border-t border-rose-400/40 text-rose-300 pointer-events-none">
          // {descriptor!.state.toUpperCase()}
          {descriptor!.exitCode !== null ? ` · exit ${descriptor!.exitCode}` : ''}
          {descriptor!.exitSignal !== null ? ` · sig ${descriptor!.exitSignal}` : ''}
        </div>
      )}
    </div>
  )
}
