import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import pty from '@lydell/node-pty'
import type { IPty } from '@lydell/node-pty'

/**
 * Thin wrapper around @lydell/node-pty (prebuilt for Windows / mac / Linux).
 *
 * Responsibilities:
 *   - Spawn an OS pseudoterminal in the requested cwd / env.
 *   - Emit data + exit events.
 *   - Maintain a bounded rolling stdout buffer so a freshly connecting
 *     dashboard tab can show the last N KB without re-execing the child.
 *   - Best-effort graceful stop (SIGINT -> SIGTERM -> SIGKILL after 5s).
 *
 * The runtime does NOT understand AgentEvents. ptyAgentBase wraps this
 * runtime and runs the agent-specific line classifier.
 */

export interface PtySpawnOptions {
  argv: string[] // [program, ...args]
  cwd?: string
  env?: NodeJS.ProcessEnv
  cols?: number
  rows?: number
  /** Max bytes kept in the rolling buffer. Default 1 MB. */
  bufferLimit?: number
}

export interface PtyProcess {
  readonly pid: number
  /** Append-only ring of the last `bufferLimit` bytes of stdout. */
  buffer(): string
  /** Write to the PTY's stdin. */
  write(text: string): void
  /** Resize the terminal (used by dashboard PTY attach). */
  resize(cols: number, rows: number): void
  /** SIGTERM, then SIGKILL after 5s if still alive. */
  kill(): Promise<void>
  /** Event sink: 'data' (string), 'exit' ({code, signal}). */
  events: EventEmitter
}

const DEFAULT_BUFFER_LIMIT = 1024 * 1024
const KILL_GRACE_MS = 5000

/**
 * Resolve a program name to an absolute path on Windows. node-pty on
 * Windows refuses a bare name like `node` — it needs the actual binary
 * path. On POSIX this returns the input unchanged because /bin/sh / fork
 * handle PATH lookup. Pull the same resolution into the runtime so callers
 * (CLI adapters) don't reimplement it.
 */
function resolveProgramSync(name: string): string {
  if (process.platform !== 'win32') return name
  // Already absolute or contains an extension — assume the caller knows.
  if (name.includes(':') || name.includes('\\') || name.includes('/')) return name
  if (/\.(exe|cmd|bat|com)$/i.test(name)) return name
  // Search PATH for `<name>.exe` / `.cmd` / `.bat`.
  const pathExt = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
  const dirs = (process.env.PATH ?? '').split(';').filter(Boolean)
  // Lazy require — keep `node:path` / `node:fs` out of the import section
  // since this helper is the only place inside the runtime that needs them.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  for (const dir of dirs) {
    for (const ext of pathExt) {
      const cand = path.join(dir, `${name}${ext}`)
      try {
        if (fs.statSync(cand).isFile()) return cand
      } catch {
        // continue
      }
    }
  }
  return name // fall back; the pty.spawn will surface a clear error
}

export function spawnPty(opts: PtySpawnOptions): PtyProcess {
  const [program, ...args] = opts.argv
  if (!program) throw new Error('spawnPty: argv must have at least one element')

  const events = new EventEmitter()
  const bufferLimit = opts.bufferLimit ?? DEFAULT_BUFFER_LIMIT
  let rolling = ''
  let exited = false

  const child: IPty = pty.spawn(resolveProgramSync(program), args, {
    name: 'xterm-color',
    cols: opts.cols ?? 120,
    rows: opts.rows ?? 30,
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env } as Record<string, string>,
  })

  child.onData((d) => {
    rolling = (rolling + d).slice(-bufferLimit)
    events.emit('data', d)
  })

  child.onExit(({ exitCode, signal }) => {
    exited = true
    events.emit('exit', { code: exitCode, signal: signal ?? null })
  })

  return {
    pid: child.pid,
    buffer: () => rolling,
    write: (text) => {
      if (!exited) child.write(text)
    },
    resize: (cols, rows) => {
      if (!exited) child.resize(cols, rows)
    },
    kill: async () => {
      if (exited) return
      // On Windows, node-pty's IPty.kill() terminates the conhost wrapping
      // the agent process, but a grandchild that has its own event loop
      // (Node's setInterval, a Python interpreter waiting on stdin, ...)
      // is NOT in a job object and survives. Use taskkill /F /T to tear
      // down the whole tree. AO's runtime-process plugin does the same.
      try {
        if (process.platform === 'win32') {
          await killTreeWindows(child.pid)
        } else {
          child.kill('SIGTERM')
        }
      } catch {
        // ignore
      }
      await waitForExitOrTimeout(events, KILL_GRACE_MS)
      if (!exited) {
        try {
          if (process.platform === 'win32') {
            await killTreeWindows(child.pid, true)
          } else {
            child.kill('SIGKILL')
          }
        } catch {
          // ignore
        }
      }
    },
    events,
  }
}

function waitForExitOrTimeout(events: EventEmitter, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), ms)
    events.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * `taskkill /F /T /PID <pid>` — the only reliable way to terminate a process
 * tree spawned through ConPTY on Windows. `/T` walks descendants; `/F` is
 * mandatory once `/T` is set or taskkill prompts instead of killing the
 * orphans.
 */
function killTreeWindows(pid: number, force: boolean = false): Promise<void> {
  return new Promise((resolve) => {
    const args = force
      ? ['/F', '/T', '/PID', String(pid)]
      : ['/T', '/PID', String(pid)]
    const proc = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true })
    proc.on('error', () => resolve())
    proc.on('exit', () => resolve())
  })
}
