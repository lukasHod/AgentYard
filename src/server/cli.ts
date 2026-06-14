import { Command } from 'commander'
import open from 'open'
import { startServer } from './server.js'

const program = new Command()

program
  .name('agentyard')
  .description('Gamified agent orchestrator — a sci-fi shipyard for development workflows')
  .version('0.0.1')

program
  .command('start', { isDefault: true })
  .description('Start the AgentYard server and open the UI in your browser')
  .option('-p, --port <port>', 'port to bind', '4242')
  .option('--no-open', 'do not auto-open the browser')
  .option('--dev', 'development mode (do not serve client static; expect Vite separately)')
  .action(async (opts: { port: string; open: boolean; dev: boolean }) => {
    const port = Number(opts.port)
    const { address, shutdown } = await startServer({ port, dev: !!opts.dev })
    const devClientPort = process.env.AGENTYARD_CLIENT_PORT ?? '5173'
    const uiUrl = opts.dev ? `http://localhost:${devClientPort}` : address
    console.log(`\n  AgentYard is up.`)
    console.log(`  Server:  ${address}`)
    console.log(`  UI:      ${uiUrl}\n`)
    if (opts.open && !opts.dev) {
      // In dev, Vite opens itself; we only auto-open the prod UI.
      await open(uiUrl)
    }

    // Graceful shutdown: run the server's teardown on the first signal, then
    // exit cleanly. A second signal force-exits so a wedged shutdown can't
    // hold the terminal hostage.
    let shuttingDown = false
    const stop = async (signal: NodeJS.Signals) => {
      if (shuttingDown) {
        console.error(`\n${signal} received again — force exit.`)
        process.exit(1)
      }
      shuttingDown = true
      console.log(`\n${signal} received — shutting down…`)
      const timer = setTimeout(() => {
        console.error('Shutdown took longer than 5s — force exit.')
        process.exit(1)
      }, 5000)
      timer.unref()
      try {
        await shutdown()
      } catch (err) {
        console.error('Shutdown error:', err)
      } finally {
        clearTimeout(timer)
        process.exit(0)
      }
    }
    process.on('SIGINT', () => void stop('SIGINT'))
    process.on('SIGTERM', () => void stop('SIGTERM'))
  })

// ── Bridge subcommands ──────────────────────────────────────────────────────
//
// These run inside PTY terminal sessions spawned by AgentYard. They read the
// AGENTYARD_* env vars injected by TerminalSessionManager, call the bridge
// HTTP API, and exit. They are intentionally lightweight — no deps beyond
// Node builtins and the `commander` package already in use.

function bridgeUrl(): string {
  const url = process.env.AGENTYARD_BRIDGE_URL
  if (!url) {
    console.error(
      'AGENTYARD_BRIDGE_URL is not set.\n' +
        'This command must be run inside an AgentYard-managed terminal session.',
    )
    process.exit(1)
  }
  return url
}

function sessionId(): string {
  const id = process.env.AGENTYARD_SESSION_ID
  if (!id) {
    console.error('AGENTYARD_SESSION_ID is not set.')
    process.exit(1)
  }
  return id
}

async function bridgePost(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 30 * 60 * 1000,
): Promise<unknown> {
  const url = `${bridgeUrl()}${path}`
  const sid = sessionId()
  const signal = AbortSignal.timeout(timeoutMs)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agentyard-session-id': sid,
    },
    body: JSON.stringify(body),
    signal,
  })
  const json = await res.json() as Record<string, unknown>
  if (!res.ok) {
    const msg = typeof json.error === 'string' ? json.error : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json
}

program
  .command('ask-user <question>')
  .description(
    'Ask the user a question and wait for their reply. ' +
    'Prints the answer to stdout so the calling script can capture it. ' +
    'Must be run inside an AgentYard terminal session.',
  )
  .action(async (question: string) => {
    try {
      const result = await bridgePost('/api/bridge/ask-user', { question }) as { answer: string }
      process.stdout.write(result.answer + '\n')
    } catch (err) {
      console.error('ask-user failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command('mark-node-complete [summary]')
  .description(
    'Signal to AgentYard that the current workflow node is complete. ' +
    'The workflow engine will advance to the next node immediately. ' +
    'Must be run inside an AgentYard terminal session.',
  )
  .option('--output <key=value...>', 'named outputs passed to downstream nodes (repeatable)')
  .action(async (summary: string | undefined, opts: { output?: string[] }) => {
    const outputs: Record<string, string> = {}
    for (const kv of opts.output ?? []) {
      const eq = kv.indexOf('=')
      if (eq === -1) {
        console.error(`invalid --output value "${kv}" — expected key=value`)
        process.exit(1)
      }
      outputs[kv.slice(0, eq)] = kv.slice(eq + 1)
    }
    try {
      await bridgePost('/api/bridge/mark-node-complete', {
        summary: summary ?? '',
        ...(Object.keys(outputs).length > 0 ? { outputs } : {}),
      })
      console.log('Node marked complete.')
    } catch (err) {
      console.error('mark-node-complete failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command('fail-node [message]')
  .description('Report a fatal error to AgentYard, causing the workflow node to fail.')
  .action(async (message: string | undefined) => {
    try {
      await bridgePost('/api/bridge/fail-node', { error: message ?? 'agent reported failure' })
      console.log('Node failed.')
    } catch (err) {
      console.error('fail-node failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program
  .command('answer <questionId> <answerText>')
  .description('Submit an answer to a pending question from the terminal itself.')
  .action(async (questionId: string, answerText: string) => {
    try {
      await bridgePost('/api/bridge/answer', { questionId, answer: answerText })
      console.log('Answer submitted.')
    } catch (err) {
      console.error('answer failed:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

program.parseAsync(process.argv).catch((err) => {
  console.error(err)
  process.exit(1)
})
