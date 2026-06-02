import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { createPlanet, deletePlanet, getPlanet, listPlanets } from '../planets.js'
import type { AppContext } from './context.js'

export function registerPlanetRoutes({ app, io, planetChats, manager, apiError }: AppContext): void {
  app.get('/api/planets', async () => listPlanets())

  app.get<{ Params: { id: string } }>('/api/planets/:id', async (req, reply) => {
    const planet = getPlanet(Number(req.params.id))
    if (!planet) return reply.code(404).send({ error: 'not found' })
    return planet
  })

  app.post<{ Body: { name?: string; projectPath?: string; workflowId?: number } }>(
    '/api/planets',
    async (req, reply) => {
      try {
        const planet = await createPlanet({
          name: req.body.name ?? '',
          projectPath: req.body.projectPath ?? '',
          workflowId: req.body.workflowId,
        })
        io.emit('planet:created', planet)
        return planet
      } catch (e) {
        // createPlanet throws validation errors with messages intended for the user
        // (e.g. "Project path does not exist: ..."). Pass them through but still log.
        const publicMessage = e instanceof Error ? e.message : 'invalid planet config'
        return apiError(reply, 400, publicMessage, e)
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/api/planets/:id', async (req) => {
    const planetId = Number(req.params.id)
    // Tear down the chat session (if any) + drop its transcript BEFORE the
    // planet row is gone, so the session's tools (start_feature) can still
    // resolve the planet during graceful close.
    await planetChats.deleteForPlanet(planetId)
    deletePlanet(planetId)
    io.emit('planet:deleted', { id: planetId })
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/api/planets/:id/chat/open', async (req, reply) => {
    const planetId = Number(req.params.id)
    const planet = getPlanet(planetId)
    if (!planet) return reply.code(404).send({ error: 'planet not found' })
    if (!planet.pathExists) {
      return apiError(
        reply,
        400,
        'Planet project path is missing on disk — cannot start chat.',
      )
    }
    try {
      const session = planetChats.openChat(planetId)
      return manager.describe(session)
    } catch (e) {
      return apiError(reply, 500, 'failed to open planet chat', e)
    }
  })

  app.get<{ Params: { id: string } }>('/api/planets/:id/description', async (req, reply) => {
    const planet = getPlanet(Number(req.params.id))
    if (!planet) return reply.code(404).send({ error: 'planet not found' })

    const pathExists = existsSync(planet.projectPath)
    let readme: string | null = null
    let readmePath: string | null = null
    if (pathExists) {
      for (const candidate of ['README.md', 'README', 'README.txt', 'Readme.md']) {
        const p = path.join(planet.projectPath, candidate)
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
        const g = simpleGit(planet.projectPath)
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

    return { readme, readmePath, git, projectPath: planet.projectPath, pathExists }
  })
}
