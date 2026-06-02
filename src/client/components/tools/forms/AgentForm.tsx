import { useMemo } from 'react'
import type { AgentTool, ToolSummary, ToolType } from '../../../../core/tools'
import { useObjectState } from '../../../hooks/useObjectState'
import { CapabilityMultiselect } from './CapabilityMultiselect'
import {
  FormButtons,
  Label,
  inputCls,
  textareaCls,
} from './formChrome'

/** Library narrowing — only planet- or global-scoped items of the given type are usable. */
function useAvailable(library: ToolSummary[], type: ToolType) {
  return useMemo(
    () => library.filter((t) => t.type === type && (t.scope === 'planet' || t.scope === 'global')),
    [library, type],
  )
}

export function AgentForm({
  initial,
  disableName,
  library,
  onSubmit,
  onCancel,
  saving,
}: {
  initial?: AgentTool
  disableName: boolean
  library: ToolSummary[]
  onSubmit: (d: AgentTool) => void
  onCancel: () => void
  saving: boolean
}) {
  const [form, set] = useObjectState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    role: initial?.role ?? '',
    model: initial?.model ?? '',
    // Every agent uses the claude_code preset — the UI picker was removed;
    // restrict the surface via the ALLOWED TOOLS list instead.
    allowedToolsText: (initial?.allowedTools ?? []).join(','),
    skills: initial?.skills ?? [],
    mcps: initial?.mcps ?? [],
    scripts: initial?.scripts ?? [],
    prompt: initial?.prompt ?? '',
  })

  const availableSkills = useAvailable(library, 'skill')
  const availableMcps = useAvailable(library, 'mcp')
  const availableScripts = useAvailable(library, 'script')

  function submit() {
    if (!form.name.trim()) return alert('name is required')
    const allowedTools = form.allowedToolsText.trim()
      ? form.allowedToolsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined
    const data: AgentTool = {
      name: form.name.trim(),
      description: form.description.trim(),
      role: form.role.trim() || form.name.trim(),
      model: form.model.trim() || undefined,
      toolPreset: 'claude_code',
      allowedTools,
      skills: form.skills,
      mcps: form.mcps,
      scripts: form.scripts,
      prompt: form.prompt,
    }
    onSubmit(data)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>NAME</Label>
          <input
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            disabled={disableName}
            className={inputCls}
          />
        </div>
        <div>
          <Label>ROLE</Label>
          <input
            value={form.role}
            onChange={(e) => set({ role: e.target.value })}
            placeholder="defaults to name"
            className={inputCls}
          />
        </div>
        <div>
          <Label>MODEL</Label>
          <input
            value={form.model}
            onChange={(e) => set({ model: e.target.value })}
            placeholder="(SDK default)"
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <Label>DESCRIPTION</Label>
        <input
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          className={inputCls}
        />
      </div>

      <div>
        <Label hint="comma-separated subset of Claude Code's toolset (Read, Edit, Write, Glob, Grep, Bash, NotebookEdit, …); leave blank for the full preset">
          ALLOWED TOOLS
        </Label>
        <input
          value={form.allowedToolsText}
          onChange={(e) => set({ allowedToolsText: e.target.value })}
          placeholder="Read,Edit,Write,Glob,Grep,Bash"
          className={inputCls}
        />
      </div>

      <CapabilityMultiselect
        label="SKILLS"
        options={availableSkills}
        selected={form.skills}
        onChange={(skills) => set({ skills })}
      />
      <CapabilityMultiselect
        label="MCPS"
        options={availableMcps}
        selected={form.mcps}
        onChange={(mcps) => set({ mcps })}
      />
      <CapabilityMultiselect
        label="SCRIPTS"
        options={availableScripts}
        selected={form.scripts}
        onChange={(scripts) => set({ scripts })}
      />

      <div>
        <Label hint="becomes the drone's system prompt">SYSTEM PROMPT</Label>
        <textarea
          value={form.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
          rows={14}
          className={textareaCls}
        />
      </div>

      <FormButtons onCancel={onCancel} onSubmit={submit} saving={saving} />
    </div>
  )
}
