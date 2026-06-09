import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { getPlanet } from '../planets.js'
import { createFeature, getFeature, updateFeature } from '../features.js'
import { getWorkflow, listWorkflows } from '../workflows.js'
import { createPickupWorktree } from '../runtime/worktrees.js'
import {
  createHandoffBranch,
  deleteHandoffBranch,
  generateHandoffDescriptions,
  getGitUser,
  listHandoffs,
  readHandoffPayload,
  type HandoffAgent,
  type HandoffPayload,
} from '../handoff.js'
import type { AppContext } from './context.js'
import type { FeatureSummary } from '../../core/types.js'

const execFile = promisify(execFileCb)

function featureToSummary(f: ReturnType<typeof getFeature>): FeatureSummary {
  return f as FeatureSummary
}

export function registerHandoffRoutes(ctx: AppContext): void {
  const { app, io, manager, transcripts, runState, apiError } = ctx

  /** List pending handoffs on origin for a planet. */
  app.get<{ Params: { id: string } }>('/api/planets/:id/handoffs', async (req, reply) => {
    const planet = getPlanet(Number(req.params.id))
    if (!planet) return reply.code(404).send({ error: 'planet not found' })
    if (!planet.pathExists) return reply.code(422).send({ error: 'planet path not found on disk' })
    try {
      return await listHandoffs(planet.projectPath)
    } catch (e) {
      return apiError(reply, 500, 'failed to list handoffs', e)
    }
  })

  /** Create a handoff from a feature. Claude auto-generates descriptions from context. */
  app.post<{
    Params: { id: string }
    Body: { featureId: number; handoffNote?: string }
  }>('/api/planets/:id/handoffs', async (req, reply) => {
    const planet = getPlanet(Number(req.params.id))
    if (!planet) return reply.code(404).send({ error: 'planet not found' })
    if (!planet.pathExists) return reply.code(422).send({ error: 'planet path not found on disk' })

    const { featureId, handoffNote } = req.body

    const feature = getFeature(featureId)
    if (!feature) return reply.code(404).send({ error: 'feature not found' })
    if (feature.planetId !== planet.id) return reply.code(403).send({ error: 'feature does not belong to this planet' })
    if (!feature.branch) return reply.code(422).send({ error: 'feature has no branch yet' })

    // Collect agent transcripts for all current sessions.
    const sessions = manager.describeAll()
    const sessionTranscripts = transcripts.getTranscripts(sessions.map((s) => s.id))
    const agents: HandoffAgent[] = sessions.map((s) => ({
      id: s.id,
      role: s.role,
      label: s.label,
      messages: (sessionTranscripts.get(s.id) ?? []).map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    }))

    // Commit any uncommitted work in the feature worktree before generating diff context.
    if (feature.worktreePath) {
      try {
        await execFile('git', ['-C', feature.worktreePath, 'add', '-A'])
        await execFile('git', ['-C', feature.worktreePath, 'commit', '-m', 'wip: handoff snapshot', '--allow-empty'])
        await execFile('git', ['-C', feature.worktreePath, 'push', 'origin', feature.branch])
      } catch {
        // Best-effort — if nothing to commit or push fails, continue anyway.
      }
    }

    // Auto-generate descriptions via Claude.
    let generated: { shortDescription: string; featureDescription: string; implementationPlan: string | null }
    try {
      generated = await generateHandoffDescriptions({
        featureName: feature.name,
        featureTask: feature.task,
        agents,
        worktreePath: feature.worktreePath,
      })
    } catch (e) {
      app.log.error({ err: e }, 'handoff: failed to generate descriptions, using fallback')
      generated = {
        shortDescription: `Handoff for "${feature.name}"`,
        featureDescription: feature.task,
        implementationPlan: null,
      }
    }

    // Capture workflow state snapshot.
    const snap = runState.snapshot()
    const workflowState = {
      nodeStates: snap?.nodeStates ?? {},
      nodeSummaries: snap?.nodeSummaries ?? {},
    }

    const sender = await getGitUser(planet.projectPath)

    const payload: HandoffPayload = {
      version: 1,
      branch: feature.branch,
      featureId: feature.id,
      planetId: planet.id,
      featureName: feature.name,
      shortDescription: generated.shortDescription,
      featureDescription: generated.featureDescription,
      implementationPlan: generated.implementationPlan,
      handoffNote: handoffNote?.trim() || null,
      sender,
      timestamp: Date.now(),
      agents,
      workflowState,
    }

    try {
      await createHandoffBranch(planet.projectPath, payload)
    } catch (e) {
      return apiError(reply, 500, 'failed to create handoff branch', e)
    }

    const summary = {
      handoffBranch: `agentyard/handoff/${feature.branch.replace(/^refs\/heads\//, '')}`,
      featureBranch: feature.branch,
      featureName: feature.name,
      shortDescription: payload.shortDescription,
      sender,
      timestamp: payload.timestamp,
    }
    io.emit('handoff:created', summary)
    return summary
  })

  /** Pick up a handoff — creates a local worktree and imports session context. */
  app.post<{
    Params: { id: string }
    Body: { handoffBranch: string }
  }>('/api/planets/:id/handoffs/pickup', async (req, reply) => {
    const planet = getPlanet(Number(req.params.id))
    if (!planet) return reply.code(404).send({ error: 'planet not found' })
    if (!planet.pathExists) return reply.code(422).send({ error: 'planet path not found on disk' })

    const { handoffBranch } = req.body
    if (!handoffBranch) return reply.code(400).send({ error: 'handoffBranch required' })

    let payload: HandoffPayload
    try {
      payload = await readHandoffPayload(planet.projectPath, handoffBranch)
    } catch (e) {
      return apiError(reply, 404, 'handoff not found or unreadable', e)
    }

    const workflowId =
      payload.featureId
        ? (getFeature(payload.featureId)?.workflowId ?? planet.workflowId ?? listWorkflows()[0]?.id)
        : (planet.workflowId ?? listWorkflows()[0]?.id)
    if (typeof workflowId !== 'number') {
      return reply.code(400).send({ error: 'no workflow available' })
    }
    const wf = getWorkflow(workflowId)
    if (!wf) return reply.code(404).send({ error: 'workflow not found' })

    // Create a new feature row for the picked-up work.
    let feature = createFeature({
      planetId: planet.id,
      name: payload.featureName,
      task: payload.featureDescription,
      workflowId,
    })

    // Create worktree on the existing handed-off branch.
    let worktreePath: string
    try {
      const wt = await createPickupWorktree({
        planetPath: planet.projectPath,
        featureId: feature.id,
        branch: payload.branch,
      })
      worktreePath = wt.path
      feature = updateFeature(feature.id, {
        branch: payload.branch,
        worktreePath,
        handoffContext: JSON.stringify(payload),
      })!
    } catch (e) {
      return apiError(reply, 500, 'failed to create worktree for handoff', e)
    }

    // Remove the handoff branch from origin now that it's been consumed.
    try {
      await deleteHandoffBranch(planet.projectPath, handoffBranch)
    } catch {
      // Best-effort — don't fail the pickup if cleanup fails.
    }

    const featureSummary = featureToSummary(feature)!
    io.emit('feature:created', featureSummary)
    io.emit('handoff:pickedup', { handoffBranch, feature: featureSummary })

    return featureSummary
  })

  /** Cancel (delete) a pending handoff branch. */
  app.delete<{
    Params: { id: string; branch: string }
  }>('/api/planets/:id/handoffs/:branch', async (req, reply) => {
    const planet = getPlanet(Number(req.params.id))
    if (!planet) return reply.code(404).send({ error: 'planet not found' })

    // The branch param may contain slashes; Fastify captures up to the first slash
    // by default, so clients should URL-encode slashes as %2F.
    const handoffBranch = decodeURIComponent(req.params.branch)

    try {
      await deleteHandoffBranch(planet.projectPath, handoffBranch)
    } catch (e) {
      return apiError(reply, 500, 'failed to delete handoff branch', e)
    }

    io.emit('handoff:cancelled', { handoffBranch })
    return { ok: true }
  })
}
