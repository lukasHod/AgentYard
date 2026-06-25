import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import {
  createPlanet,
  deletePlanet,
  getPlanet,
  listPlanets,
} from '../planets.js'
import { setPlanetSetting } from '../planetSettings.js'
import { listFeatures } from '../features.js'
import type { AppContext } from './context.js'
import { parseRequestPart, parseRouteId } from './validation.js'
import { z } from 'zod/v4'

const PlanetCreateBodySchema = z.object({
  name: z.string().optional(),
  projectPath: z.string().optional(),
  workflowId: z.number().int().positive().optional(),
}).default({})
const PlanetSettingsBodySchema = z.object({
  key: z.string().min(1),
  value: z.string().nullable(),
})

export function registerPlanetRoutes({ app, io, planetChats, manager, apiError }: AppContext): void {
  app.get('/api/planets', async () => listPlanets())

  app.get<{ Params: { id: string } }>('/api/planets/:id', async (req, reply) => {
    const planetId = parseRouteId('planet id', req.params.id, reply)
    if (planetId === null) return
    const planet = getPlanet(planetId)
    if (!planet) return reply.code(404).send({ error: 'not found' })
    return planet
  })

  app.post<{ Body: { name?: string; projectPath?: string; workflowId?: number } }>(
    '/api/planets',
    async (req, reply) => {
      const body = parseRequestPart('body', req.body, PlanetCreateBodySchema, reply)
      if (!body) return
      try {
        const planet = await createPlanet({
          name: body.name ?? '',
          projectPath: body.projectPath ?? '',
          workflowId: body.workflowId,
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

  app.delete<{ Params: { id: string } }>('/api/planets/:id', async (req, reply) => {
    const planetId = parseRouteId('planet id', req.params.id, reply)
    if (planetId === null) return
    // Tear down the chat session (if any) + drop its transcript BEFORE the
    // planet row is gone, so the session's tools (start_feature) can still
    // resolve the planet during graceful close.
    await planetChats.deleteForPlanet(planetId)
    deletePlanet(planetId)
    io.emit('planet:deleted', { id: planetId })
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/api/planets/:id/chat/open', async (req, reply) => {
    const planetId = parseRouteId('planet id', req.params.id, reply)
    if (planetId === null) return
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

  /**
   * Trigger a background git fetch on the planet repo and return the latest
   * feature list from the DB. The fetch is fire-and-forget — the response
   * returns immediately with fresh DB state.
   */
  app.post<{ Params: { id: string } }>('/api/planets/:id/sync', async (req, reply) => {
    const planetId = parseRouteId('planet id', req.params.id, reply)
    if (planetId === null) return
    const planet = getPlanet(planetId)
    if (!planet) return reply.code(404).send({ error: 'planet not found' })

    if (planet.pathExists) {
      // Fire-and-forget: update remote refs so callers see the latest handoff
      // branches, remote feature branches, etc. Never blocks the response.
      simpleGit(planet.projectPath)
        .fetch(['--all', '--prune'])
        .catch(() => {})
    }

    return listFeatures(planet.id)
  })

  app.put<{
    Params: { id: string }
    Body: { key: string; value: string | null }
  }>('/api/planets/:id/settings', async (req, reply) => {
    const planetId = parseRouteId('planet id', req.params.id, reply)
    if (planetId === null) return
    const body = parseRequestPart('body', req.body, PlanetSettingsBodySchema, reply)
    if (!body) return
    setPlanetSetting(planetId, body.key, body.value)
    const updated = getPlanet(planetId)
    if (!updated) return reply.code(404).send({ error: 'planet not found' })
    io.emit('planet:updated', updated)
    return updated
  })

  app.get<{ Params: { id: string } }>('/api/planets/:id/description', async (req, reply) => {
    const planetId = parseRouteId('planet id', req.params.id, reply)
    if (planetId === null) return
    const planet = getPlanet(planetId)
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
