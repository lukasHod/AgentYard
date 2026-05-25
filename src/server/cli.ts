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
  .option('--dev', 'development mode (do not serve client static; expect Vite on :5173)')
  .action(async (opts: { port: string; open: boolean; dev: boolean }) => {
    const port = Number(opts.port)
    const { address, shutdown } = await startServer({ port, dev: !!opts.dev })
    const uiUrl = opts.dev ? 'http://localhost:5173' : address
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

program.parseAsync(process.argv).catch((err) => {
  console.error(err)
  process.exit(1)
})
