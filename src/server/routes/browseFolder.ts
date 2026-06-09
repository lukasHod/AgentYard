import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppContext } from './context.js'

const execFileP = promisify(execFile)

// Opens a native Windows folder-picker dialog via PowerShell and returns the
// selected path. The dialog blocks until the user picks or cancels.
async function pickFolderWindows(): Promise<string | null> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$d.Description = "Select project folder"',
    '$d.ShowNewFolderButton = $true',
    'if ($d.ShowDialog() -eq "OK") { Write-Output $d.SelectedPath }',
  ].join('; ')

  const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-Command', script], {
    timeout: 120_000,
    windowsHide: false,
  })
  const p = stdout.trim()
  return p.length > 0 ? p : null
}

export function registerBrowseFolderRoute({ app, apiError }: AppContext): void {
  app.get('/api/browse-folder', async (_req, reply) => {
    if (process.platform !== 'win32') {
      return apiError(reply, 501, 'Folder browser is only supported on Windows')
    }
    try {
      const folder = await pickFolderWindows()
      return { path: folder }
    } catch (e) {
      return apiError(reply, 500, 'Failed to open folder browser', e)
    }
  })
}
