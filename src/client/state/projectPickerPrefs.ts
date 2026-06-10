const LAST_PROJECT_PARENT_KEY = 'agentyard:lastProjectParentPath'

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

export function parentDirectory(projectPath: string): string {
  const trimmed = projectPath.trim()
  if (trimmed.length === 0) return ''

  const withoutTrailing =
    /^[A-Za-z]:[\\/]?$/.test(trimmed) || trimmed === '/'
      ? trimmed
      : trimmed.replace(/[\\/]+$/, '')
  const lastSlash = Math.max(withoutTrailing.lastIndexOf('/'), withoutTrailing.lastIndexOf('\\'))

  if (lastSlash < 0) return ''
  if (lastSlash === 0) return '/'
  if (lastSlash === 2 && withoutTrailing[1] === ':') return withoutTrailing.slice(0, 3)
  return withoutTrailing.slice(0, lastSlash)
}

export function readLastProjectParent(): string {
  try {
    return storage()?.getItem(LAST_PROJECT_PARENT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberProjectParent(projectPath: string): void {
  const parent = parentDirectory(projectPath)
  if (!parent) return

  try {
    storage()?.setItem(LAST_PROJECT_PARENT_KEY, parent)
  } catch {
    // Local storage can be disabled; the picker still works without persistence.
  }
}
