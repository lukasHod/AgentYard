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
    const { address } = await startServer({ port, dev: !!opts.dev })
    const uiUrl = opts.dev ? 'http://localhost:5173' : address
    console.log(`\n  AgentYard is up.`)
    console.log(`  Server:  ${address}`)
    console.log(`  UI:      ${uiUrl}\n`)
    if (opts.open && !opts.dev) {
      // In dev, Vite opens itself; we only auto-open the prod UI.
      await open(uiUrl)
    }
  })

program.parseAsync(process.argv).catch((err) => {
  console.error(err)
  process.exit(1)
})
