import { useCallback, useEffect, useMemo, useState } from 'react'
import { GlassPanel } from '../glass/GlassPanel'
import { GlassButton } from '../glass/GlassButton'
import { apiGet, apiPut } from '../../api'
import type { Workflow } from '../../../core/schema'
import type { ToolSummary } from '../../../core/tools'
import { EditorView } from '../../views/EditorView'
import { pushToast } from '../../state/toastStore'

interface Props {
  planetId: number | null
  onClose: () => void
}

export function WorkflowEditorOverlay({ planetId, onClose }: Props) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [tools, setTools] = useState<ToolSummary[]>([])
  const toolLibraryUrl = useMemo(
    () => (planetId === null ? '/api/global-tools' : `/api/planets/${planetId}/tools`),
    [planetId],
  )

  const refreshTools = useCallback(async () => {
    const res = await apiGet<ToolSummary[]>(toolLibraryUrl)
    if (res.ok) setTools(res.data)
    else pushToast('error', `Tool library load failed: ${res.error}`)
  }, [toolLibraryUrl])

  // Load the planet's assigned workflow (or fall back to the first global one).
  useEffect(() => {
    const loadWorkflow = async () => {
      if (planetId !== null) {
        const planetRes = await apiGet<{ workflowId: number | null }>(`/api/planets/${planetId}`)
        if (planetRes.ok && planetRes.data.workflowId !== null) {
          const wfRes = await apiGet<Workflow>(`/api/workflows/${planetRes.data.workflowId}`)
          if (wfRes.ok) {
            setWorkflow(wfRes.data)
            return
          }
        }
      }
      const res = await apiGet<Workflow[]>('/api/workflows')
      if (res.ok && res.data[0]) setWorkflow(res.data[0])
    }
    void loadWorkflow()
    void refreshTools()
  }, [planetId, refreshTools])

  // Esc closes — use capture phase to beat BackOutHandler's listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const onSave = async (updated: Workflow) => {
    const res = await apiPut<Workflow>(`/api/workflows/${updated.id}`, {
      name: updated.name,
      graph: updated.graph,
    })
    if (res.ok) setWorkflow(res.data)
    else {
      pushToast('error', `Save failed: ${res.error}`)
      throw new Error(res.error)
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center backdrop-blur-sm pointer-events-auto">
      <GlassPanel className="w-[90vw] h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-sky-400/20">
          <h2 className="text-sm tracking-widest text-sky-300">
            WORKFLOW EDITOR{workflow ? ` — ${workflow.name}` : ''}
          </h2>
          <GlassButton variant="ghost" onClick={onClose}>✕ close</GlassButton>
        </div>
        <div className="flex-1 overflow-hidden bg-black/40">
          {workflow ? (
            <EditorView
              workflow={workflow}
              planetId={planetId}
              tools={tools}
              onSave={onSave}
              onRefreshTools={refreshTools}
              onOpenTestRun={() => {
                /* TestRun trigger not exposed from the overlay in this spec */
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              loading workflow…
            </div>
          )}
        </div>
      </GlassPanel>
    </div>
  )
}
