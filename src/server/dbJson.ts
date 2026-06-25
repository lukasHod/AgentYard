import type { z } from 'zod/v4'

export function parseDbJson<T>(
  column: string,
  raw: string,
  schema: z.ZodType<T>,
): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Invalid JSON in ${column}: ${message}`)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid shape in ${column}: ${result.error.message}`)
  }
  return result.data
}
