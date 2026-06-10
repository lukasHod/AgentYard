import { createConnection, createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'

interface DevPorts {
  server: number
  client: number
}

const serverWatch = process.argv.includes('--watch')

function canConnect(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host })
    const done = (connected: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(300)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function isPortFree(port: number, host: string): Promise<boolean> {
  for (const probeHost of ['localhost', '127.0.0.1', '::1']) {
    if (await canConnect(port, probeHost)) return false
  }

  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

async function findFreePort(start: number, host = '127.0.0.1'): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (await isPortFree(port, host)) return port
  }
  throw new Error(`No free port found from ${start} to ${start + 99}`)
}

async function pickPorts(): Promise<DevPorts> {
  const server = await findFreePort(4242)
  const client = await findFreePort(5173)
  return { server, client }
}

function spawnDevProcess(name: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  const prefix = `[${name}] `
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(
      chunk
        .toString()
        .split(/\r?\n/)
        .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
        .join('\n'),
    )
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(
      chunk
        .toString()
        .split(/\r?\n/)
        .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
        .join('\n'),
    )
  })

  return child
}

function stopAll(children: ChildProcess[]) {
  for (const child of children) {
    if (!child.killed) child.kill()
  }
}

const ports = await pickPorts()
const env = {
  ...process.env,
  AGENTYARD_SERVER_PORT: String(ports.server),
  AGENTYARD_CLIENT_PORT: String(ports.client),
}

console.log('\nAgentYard dev ports')
console.log(`  Server: http://localhost:${ports.server}`)
console.log(`  UI:     http://localhost:${ports.client}\n`)
console.log(`  Server watch: ${serverWatch ? 'on' : 'off'}\n`)

const children = [
  spawnDevProcess(
    'server',
    process.execPath,
    [
      '--import',
      'tsx',
      ...(serverWatch ? ['--watch'] : []),
      'src/server/cli.ts',
      'start',
      '--dev',
      '--port',
      String(ports.server),
    ],
    env,
  ),
  spawnDevProcess('client', process.execPath, [
    'node_modules/vite/bin/vite.js',
    '--host',
    'localhost',
    '--port',
    String(ports.client),
    '--strictPort',
  ], env),
]

let exiting = false
for (const child of children) {
  child.on('exit', (code, signal) => {
    if (exiting) return
    exiting = true
    stopAll(children)
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

process.on('SIGINT', () => {
  exiting = true
  stopAll(children)
  process.exit(0)
})
process.on('SIGTERM', () => {
  exiting = true
  stopAll(children)
  process.exit(0)
})
