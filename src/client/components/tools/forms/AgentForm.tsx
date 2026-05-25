import { useMemo, useState } from 'react'
import type { AgentTool, ToolSummary, ToolType } from '../../../../core/tools'
import {
  FormButtons,
  Label,
  inputCls,
  textareaCls,
} from './formChrome'
import { CapabilityMultiselect } from './CapabilityMultiselect'

/** Library narrowing — only ship- or global-scoped items of the given type are usable. */
function useAvailable(library: ToolSummary[], type: ToolType) {
  return useMemo(
    () => library.filter((t) => t.type === type && (t.scope === 'ship' || t.scope === 'global')),
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
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [role, setRole] = useState(initial?.role ?? '')
  const [model, setModel] = useState(initial?.model ?? '')
  // Every agent uses the claude_code preset — the UI picker was removed;
  // restrict the surface via the ALLOWED TOOLS list instead.
  const [allowedToolsText, setAllowedToolsText] = useState((initial?.allowedTools ?? []).join(','))
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? [])
  const [mcps, setMcps] = useState<string[]>(initial?.mcps ?? [])
  const [scripts, setScripts] = useState<string[]>(initial?.scripts ?? [])
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')

  const availableSkills = useAvailable(library, 'skill')
  const availableMcps = useAvailable(library, 'mcp')
  const availableScripts = useAvailable(library, 'script')

  function submit() {
    if (!name.trim()) return alert('name is required')
    const allowedTools = allowedToolsText.trim()
      ? allowedToolsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined
    const data: AgentTool = {
      name: name.trim(),
      description: description.trim(),
      role: role.trim() || name.trim(),
      model: model.trim() || undefined,
      toolPreset: 'claude_code',
      allowedTools,
      skills,
      mcps,
      scripts,
      prompt,
    }
    onSubmit(data)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>NAME</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disableName}
            className={inputCls}
          />
        </div>
        <div>
          <Label>ROLE</Label>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="defaults to name"
            className={inputCls}
          />
        </div>
        <div>
          <Label>MODEL</Label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="(SDK default)"
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <Label>DESCRIPTION</Label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
        />
      </div>

      <div>
        <Label hint="comma-separated subset of Claude Code's toolset (Read, Edit, Write, Glob, Grep, Bash, NotebookEdit, …); leave blank for the full preset">
          ALLOWED TOOLS
        </Label>
        <input
          value={allowedToolsText}
          onChange={(e) => setAllowedToolsText(e.target.value)}
          placeholder="Read,Edit,Write,Glob,Grep,Bash"
          className={inputCls}
        />
      </div>

      <CapabilityMultiselect label="SKILLS" options={availableSkills} selected={skills} onChange={setSkills} />
      <CapabilityMultiselect label="MCPS" options={availableMcps} selected={mcps} onChange={setMcps} />
      <CapabilityMultiselect
        label="SCRIPTS"
        options={availableScripts}
        selected={scripts}
        onChange={setScripts}
      />

      <div>
        <Label hint="becomes the drone's system prompt">SYSTEM PROMPT</Label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={14}
          className={textareaCls}
        />
      </div>

      <FormButtons onCancel={onCancel} onSubmit={submit} saving={saving} />
    </div>
  )
}
