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

const PERMISSION_PRESETS = [
  { label: 'Research', tools: ['Read', 'Glob', 'Grep'] },
  { label: 'Build', tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'] },
  { label: 'Shell', tools: ['Read', 'Glob', 'Grep', 'Bash'] },
  { label: 'Review', tools: ['Read', 'Glob', 'Grep', 'Bash'] },
] as const

const COMMON_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'NotebookEdit'] as const

/** Agent capabilities may reference editable tools and read-only catalog tools. */
function useAvailable(library: ToolSummary[], type: ToolType) {
  return useMemo(() => library.filter((t) => t.type === type), [library, type])
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
  const selectedTools = useMemo(
    () =>
      form.allowedToolsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [form.allowedToolsText],
  )

  function setAllowedTools(tools: readonly string[]) {
    set({ allowedToolsText: tools.join(',') })
  }

  function toggleAllowedTool(tool: string) {
    const next = selectedTools.includes(tool)
      ? selectedTools.filter((t) => t !== tool)
      : [...selectedTools, tool]
    setAllowedTools(next)
  }

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
    <div className="space-y-4">
      <section className="rounded border border-cyan-500/20 bg-cyan-500/[0.03] p-3 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>NAME</Label>
            <input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              disabled={disableName}
              placeholder="frontend-builder"
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
            placeholder="Short summary shown in workflow node agent pickers"
            className={inputCls}
          />
        </div>
      </section>

      <section className="grid grid-cols-[1.2fr_0.8fr] gap-4">
        <div>
          <Label hint="the agent's full role, boundaries, and operating style">
            AGENT ROLE PROMPT
          </Label>
          <textarea
            value={form.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            rows={16}
            placeholder="Describe what this agent is responsible for, what good output looks like, and when it should ask for help."
            className={textareaCls}
          />
        </div>

        <div className="space-y-3">
          <div>
            <Label hint="leave blank for the full Claude Code preset">PERMISSIONS</Label>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {PERMISSION_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setAllowedTools(preset.tools)}
                  className="rounded border border-zinc-700 px-2 py-1 text-left text-[10px] text-zinc-300 hover:border-cyan-400 hover:text-cyan-200"
                >
                  <span className="block text-cyan-300">{preset.label}</span>
                  <span className="text-zinc-600">{preset.tools.join(', ')}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {COMMON_TOOLS.map((tool) => {
                const active = selectedTools.includes(tool)
                return (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => toggleAllowedTool(tool)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${
                      active
                        ? 'border-cyan-400 bg-cyan-500/15 text-cyan-100'
                        : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
                    }`}
                  >
                    {tool}
                  </button>
                )
              })}
            </div>
            <input
              value={form.allowedToolsText}
              onChange={(e) => set({ allowedToolsText: e.target.value })}
              placeholder="Read,Edit,Write,Glob,Grep,Bash"
              className={inputCls}
            />
          </div>

          <CapabilityMultiselect
            label="SKILLS / RULES"
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
        </div>
      </section>

      <FormButtons onCancel={onCancel} onSubmit={submit} saving={saving} />
    </div>
  )
}
