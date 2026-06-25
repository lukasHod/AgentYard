import type { FastifyReply } from 'fastify'
import type { z } from 'zod/v4'

export function parseRequestPart<T>(
  label: string,
  value: unknown,
  schema: z.ZodType<T>,
  reply: FastifyReply,
): T | null {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    reply.code(400).send({ error: `invalid ${label}: ${parsed.error.message}` })
    return null
  }
  return parsed.data
}

export function parseRouteId(
  label: string,
  value: unknown,
  reply: FastifyReply,
): number | null {
  const id = Number(value)
  if (!Number.isInteger(id) || id < 0) {
    reply.code(400).send({ error: `invalid ${label}` })
    return null
  }
  return id
}
