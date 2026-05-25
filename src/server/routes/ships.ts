import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { createShip, deleteShip, getShip, listShips } from '../ships.js'
import type { AppContext } from './context.js'

export function registerShipRoutes({ app, io, apiError }: AppContext): void {
  app.get('/api/ships', async () => listShips())

  app.get<{ Params: { id: string } }>('/api/ships/:id', async (req, reply) => {
    const ship = getShip(Number(req.params.id))
    if (!ship) return reply.code(404).send({ error: 'not found' })
    return ship
  })

  app.post<{ Body: { name?: string; projectPath?: string; workflowId?: number } }>(
    '/api/ships',
    async (req, reply) => {
      try {
        const ship = await createShip({
          name: req.body.name ?? '',
          projectPath: req.body.projectPath ?? '',
          workflowId: req.body.workflowId,
        })
        io.emit('ship:created', ship)
        return ship
      } catch (e) {
        // createShip throws validation errors with messages intended for the user
        // (e.g. "Project path does not exist: ..."). Pass them through but still log.
        const publicMessage = e instanceof Error ? e.message : 'invalid ship config'
        return apiError(reply, 400, publicMessage, e)
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/api/ships/:id', async (req) => {
    deleteShip(Number(req.params.id))
    io.emit('ship:deleted', { id: Number(req.params.id) })
    return { ok: true }
  })

  app.get<{ Params: { id: string } }>('/api/ships/:id/description', async (req, reply) => {
    const ship = getShip(Number(req.params.id))
    if (!ship) return reply.code(404).send({ error: 'ship not found' })

    const pathExists = existsSync(ship.projectPath)
    let readme: string | null = null
    let readmePath: string | null = null
    if (pathExists) {
      for (const candidate of ['README.md', 'README', 'README.txt', 'Readme.md']) {
        const p = path.join(ship.projectPath, candidate)
        if (existsSync(p)) {
          try {
            readme = readFileSync(p, 'utf8')
            readmePath = candidate
            break
          } catch {
            // ignore — try next candidate
          }
        }
      }
    }

    let git: { branch?: string; head?: { sha: string; subject: string } } = {}
    if (pathExists) {
      try {
        const g = simpleGit(ship.projectPath)
        if (await g.checkIsRepo()) {
          const branch = (await g.revparse(['--abbrev-ref', 'HEAD'])).trim()
          const log = await g.log({ maxCount: 1 }).catch(() => null)
          git = {
            branch,
            head: log?.latest
              ? { sha: log.latest.hash.slice(0, 7), subject: log.latest.message }
              : undefined,
          }
        }
      } catch {
        // ignore — corrupt repo state
      }
    }

    return { readme, readmePath, git, projectPath: ship.projectPath, pathExists }
  })
}
