import type { TerminalProfileId } from '../core/types'

export const DEFAULT_TERMINAL_PROFILE: TerminalProfileId =
  typeof navigator !== 'undefined' && /Win/.test(navigator.platform) ? 'powershell' : 'unix-shell'

export const TERMINAL_PROFILE_OPTIONS: { id: TerminalProfileId; label: string }[] = [
  { id: 'powershell', label: 'powershell' },
  { id: 'unix-shell', label: 'shell' },
  { id: 'claude-cli', label: 'claude' },
  { id: 'codex-cli', label: 'codex' },
]
