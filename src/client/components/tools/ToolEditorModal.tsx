import { useEffect, useMemo, useState } from 'react'
import type {
  AgentTool,
  AgentToolPreset,
  McpTool,
  McpTransport,
  ScriptArg,
  ScriptTool,
  SkillTool,
  ToolSummary,
  ToolType,
} from '../../../core/tools'
import { useDismissable } from '../../hooks/useDismissable'

export type EditorScope = 'ship' | 'global'

export type EditorMode =
  | { kind: 'create'; type: ToolType; scope: EditorScope }
  | { kind: 'edit'; type: ToolType; scope: EditorScope; initial: AnyToolData }

export type AnyToolData = SkillTool | McpTool | ScriptTool | AgentTool

interface Props {
  mode: EditorMode
  shipId: number | null
  library: ToolSummary[]
  onClose: () => void
  onSaved: () => void
}

const TYPE_TITLE: Record<ToolType, string> = {
  skill: 'SKILL',
  agent: 'AGENT',
  mcp: 'MCP',
  script: 'SCRIPT',
}

export function ToolEditorModal({ mode, shipId, library, onClose, onSaved }: Props) {
  useDismissable(true, onClose)
  const [saving, setSaving] = useState(false)
  const [scope, setScope] = useState<EditorScope>(mode.scope)
  const editing = mode.kind === 'edit'
  const title = `${editing ? 'EDIT' : 'CREATE'} ${TYPE_TITLE[mode.type]}`

  async function save(data: AnyToolData) {
    setSaving(true)
    try {
      const res = await persist(mode, scope, shipId, data)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(`Save failed: ${j.error ?? res.status}`)
        return
      }
      onSaved()
      onClose()
    } catch (e) {
      alert(`Network error: ${e}`)
    } finally {
      setSaving(false)
    }
  }

  function renderForm() {
    switch (mode.type) {
      case 'skill':
        return (
          <SkillForm
            initial={mode.kind === 'edit' ? (mode.initial as SkillTool) : undefined}
            disableName={editing}
            onSubmit={save}
            onCancel={onClose}
            saving={saving}
          />
        )
      case 'mcp':
        return (
          <McpForm
            initial={mode.kind === 'edit' ? (mode.initial as McpTool) : undefined}
            disableName={editing}
            onSubmit={save}
            onCancel={onClose}
            saving={saving}
          />
        )
      case 'script':
        return (
          <ScriptForm
            initial={mode.kind === 'edit' ? (mode.initial as ScriptTool) : undefined}
            disableName={editing}
            onSubmit={save}
            onCancel={onClose}
            saving={saving}
          />
        )
      case 'agent':
        return (
          <AgentForm
            initial={mode.kind === 'edit' ? (mode.initial as AgentTool) : undefined}
            disableName={editing}
            library={library}
            onSubmit={save}
            onCancel={onClose}
            saving={saving}
          />
        )
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-30"
      onClick={onClose}
    >
      <div
        className="bg-black border border-cyan-500/60 rounded w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-cyan-500/40 px-4 py-2 flex items-center justify-between">
          <h2 className="text-cyan-300 tracking-widest">{title}</h2>
          <div className="flex items-center gap-2">
            {/* Only allow scope switching on create — editing in-place keeps the same scope. */}
            {!editing && (
              <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                save to:
                <button
                  onClick={() => setScope('ship')}
                  className={`px-2 py-0.5 border ${
                    scope === 'ship'
                      ? 'border-cyan-400 text-cyan-200 bg-cyan-500/10'
                      : 'border-zinc-600 text-zinc-400'
                  }`}
                  disabled={shipId === null}
                >
                  ship
                </button>
                <button
                  onClick={() => setScope('global')}
                  className={`px-2 py-0.5 border ${
                    scope === 'global'
                      ? 'border-emerald-400 text-emerald-200 bg-emerald-500/10'
                      : 'border-zinc-600 text-zinc-400'
                  }`}
                >
                  global
                </button>
              </span>
            )}
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
              ×
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{renderForm()}</div>
      </div>
    </div>
  )
}

// ============================================================
// Persistence
// ============================================================

async function persist(
  mode: EditorMode,
  scope: EditorScope,
  shipId: number | null,
  data: AnyToolData,
): Promise<Response> {
  const inShip = scope === 'ship'
  if (inShip && shipId === null) {
    throw new Error('Cannot save to ship scope without a shipId')
  }
  if (mode.kind === 'create') {
    const url = inShip
      ? `/api/ships/${shipId}/tools/${mode.type}`
      : `/api/global-tools/${mode.type}`
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    })
  }
  // edit
  const name = (data as { name: string }).name
  const url = inShip
    ? `/api/ships/${shipId}/tools/${mode.type}/${name}`
    : `/api/global-tools/${mode.type}/${name}`
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  })
}

// ============================================================
// Shared form chrome
// ============================================================

interface FormChromeProps {
  onCancel: () => void
  onSubmit: () => void
  saving: boolean
  submitLabel?: string
}

function FormButtons({ onCancel, onSubmit, saving, submitLabel = 'save' }: FormChromeProps) {
  return (
    <div className="flex gap-2 justify-end mt-4 pt-3 border-t border-cyan-500/20">
      <button
        onClick={onCancel}
        disabled={saving}
        className="px-3 py-1 border border-zinc-500 text-zinc-300 hover:bg-zinc-700 tracking-wide"
      >
        cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={saving}
        className="px-4 py-1 border border-cyan-400 text-cyan-200 hover:bg-cyan-500 hover:text-black tracking-wide disabled:opacity-50"
      >
        {saving ? 'saving…' : submitLabel}
      </button>
    </div>
  )
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">
      {children}
      {hint && <span className="ml-2 normal-case tracking-normal text-zinc-600 italic">— {hint}</span>}
    </label>
  )
}

const inputCls =
  'w-full bg-black border border-cyan-500/40 rounded px-2 py-1 text-zinc-100 focus:outline-none focus:border-cyan-300 disabled:opacity-50'

const textareaCls = inputCls + ' font-mono'

// ============================================================
// SkillForm
// ============================================================

function SkillForm({
  initial,
  disableName,
  onSubmit,
  onCancel,
  saving,
}: {
  initial?: SkillTool
  disableName: boolean
  onSubmit: (d: SkillTool) => void
  onCancel: () => void
  saving: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [body, setBody] = useState(initial?.body ?? '')

  function submit() {
    if (!name.trim()) return alert('name is required')
    onSubmit({ name: name.trim(), description: description.trim(), body })
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>NAME</Label>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={disableName} className={inputCls} />
      </div>
      <div>
        <Label>DESCRIPTION</Label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
      </div>
      <div>
        <Label hint="loaded into the drone's system prompt when this skill is attached">BODY (markdown)</Label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={18}
          className={textareaCls}
        />
      </div>
      <FormButtons onCancel={onCancel} onSubmit={submit} saving={saving} />
    </div>
  )
}

// ============================================================
// McpForm
// ============================================================

function McpForm({
  initial,
  disableName,
  onSubmit,
  onCancel,
  saving,
}: {
  initial?: McpTool
  disableName: boolean
  onSubmit: (d: McpTool) => void
  onCancel: () => void
  saving: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [transport, setTransport] = useState<McpTransport>(initial?.transport ?? 'stdio')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [argsText, setArgsText] = useState((initial?.args ?? []).join(' '))
  const [envText, setEnvText] = useState(envToText(initial?.env))
  const [url, setUrl] = useState(initial?.url ?? '')
  const [headersText, setHeadersText] = useState(envToText(initial?.headers))

  function submit() {
    if (!name.trim()) return alert('name is required')
    const data: McpTool = {
      name: name.trim(),
      description: description.trim(),
      transport,
    }
    if (transport === 'stdio') {
      data.command = command.trim()
      data.args = argsText.trim() ? argsText.trim().split(/\s+/) : undefined
      const env = textToKv(envText)
      if (Object.keys(env).length > 0) data.env = env
    } else {
      data.url = url.trim()
      const headers = textToKv(headersText)
      if (Object.keys(headers).length > 0) data.headers = headers
    }
    onSubmit(data)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>NAME</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={disableName} className={inputCls} />
        </div>
        <div>
          <Label>TRANSPORT</Label>
          <div className="flex gap-1 text-[10px]">
            {(['stdio', 'http', 'sse'] as McpTransport[]).map((t) => (
              <button
                key={t}
                onClick={() => setTransport(t)}
                className={`px-2 py-1 border ${
                  transport === t
                    ? 'border-cyan-400 text-cyan-200 bg-cyan-500/10'
                    : 'border-zinc-600 text-zinc-400'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <Label>DESCRIPTION</Label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
      </div>

      {transport === 'stdio' ? (
        <>
          <div>
            <Label>COMMAND</Label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
              className={inputCls}
            />
          </div>
          <div>
            <Label hint="space-separated">ARGS</Label>
            <input
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="@modelcontextprotocol/server-github"
              className={inputCls}
            />
          </div>
          <div>
            <Label hint="KEY=value per line — supports ${env:VAR}">ENV</Label>
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder="GITHUB_TOKEN=${env:GITHUB_TOKEN}"
              rows={4}
              className={textareaCls}
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>URL</Label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls} />
          </div>
          <div>
            <Label hint="KEY=value per line — supports ${env:VAR}">HEADERS</Label>
            <textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              rows={4}
              className={textareaCls}
            />
          </div>
        </>
      )}

      <FormButtons onCancel={onCancel} onSubmit={submit} saving={saving} />
    </div>
  )
}

function envToText(env?: Record<string, string>): string {
  if (!env) return ''
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')
}

function textToKv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return out
}

// ============================================================
// ScriptForm
// ============================================================

function ScriptForm({
  initial,
  disableName,
  onSubmit,
  onCancel,
  saving,
}: {
  initial?: ScriptTool
  disableName: boolean
  onSubmit: (d: ScriptTool) => void
  onCancel: () => void
  saving: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [cmd, setCmd] = useState(initial?.cmd ?? '')
  const [args, setArgs] = useState<ScriptArg[]>(initial?.args ?? [])
  const [includeBody, setIncludeBody] = useState<boolean>(!!initial?.bodyFile)
  const [bodyFile, setBodyFile] = useState<string>(initial?.bodyFile ?? 'script.sh')
  const [body, setBody] = useState<string>(initial?.body ?? '')

  function submit() {
    if (!name.trim()) return alert('name is required')
    if (!cmd.trim()) return alert('cmd is required')
    const data: ScriptTool = {
      name: name.trim(),
      description: description.trim(),
      cmd: cmd.trim(),
      args,
    }
    if (includeBody) {
      data.bodyFile = bodyFile.trim() || 'script.sh'
      data.body = body
    }
    onSubmit(data)
  }

  function addArg() {
    setArgs((a) => [...a, { name: '', description: '', required: false }])
  }
  function removeArg(i: number) {
    setArgs((a) => a.filter((_, j) => j !== i))
  }
  function updateArg(i: number, patch: Partial<ScriptArg>) {
    setArgs((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>NAME</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={disableName} className={inputCls} />
        </div>
        <div>
          <Label>DESCRIPTION</Label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div>
        <Label hint="authoritative; supports {argName} substitution from this tool's args">CMD</Label>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder='npm test -- --reporter=json'
          className={inputCls}
        />
      </div>

      <div>
        <Label>ARGS</Label>
        {args.length === 0 ? (
          <p className="text-zinc-600 italic">// no args declared</p>
        ) : (
          <div className="space-y-1">
            {args.map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr_auto_auto] gap-2 items-center">
                <input
                  value={a.name}
                  onChange={(e) => updateArg(i, { name: e.target.value })}
                  placeholder="name"
                  className={inputCls}
                />
                <input
                  value={a.description ?? ''}
                  onChange={(e) => updateArg(i, { description: e.target.value })}
                  placeholder="description"
                  className={inputCls}
                />
                <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <input
                    type="checkbox"
                    checked={a.required}
                    onChange={(e) => updateArg(i, { required: e.target.checked })}
                    className="accent-cyan-500"
                  />
                  required
                </label>
                <button
                  onClick={() => removeArg(i)}
                  className="px-2 py-0.5 border border-rose-500/60 text-rose-300 hover:bg-rose-500/20 text-[10px]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={addArg}
          className="mt-2 px-2 py-0.5 border border-zinc-500 text-zinc-300 hover:bg-zinc-700 text-[10px]"
        >
          + add arg
        </button>
      </div>

      <div>
        <label className="flex items-center gap-2 text-zinc-400 mb-1">
          <input
            type="checkbox"
            checked={includeBody}
            onChange={(e) => setIncludeBody(e.target.checked)}
            className="accent-cyan-500"
          />
          include script body file
        </label>
        {includeBody && (
          <div className="space-y-2 mt-1">
            <div>
              <Label hint="reference explicitly from cmd, e.g. bash script.sh">BODY FILENAME</Label>
              <input
                value={bodyFile}
                onChange={(e) => setBodyFile(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <Label>BODY</Label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className={textareaCls}
              />
            </div>
          </div>
        )}
      </div>

      <FormButtons onCancel={onCancel} onSubmit={submit} saving={saving} />
    </div>
  )
}

// ============================================================
// AgentForm
// ============================================================

function AgentForm({
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
  const [toolPreset, setToolPreset] = useState<AgentToolPreset>(initial?.toolPreset ?? 'claude_code')
  const [allowedToolsText, setAllowedToolsText] = useState((initial?.allowedTools ?? []).join(','))
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? [])
  const [mcps, setMcps] = useState<string[]>(initial?.mcps ?? [])
  const [scripts, setScripts] = useState<string[]>(initial?.scripts ?? [])
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')

  // Library narrowing — only show editable-scope items (ship + global). Catalog entries
  // can't be referenced from an agent until adopted.
  const availableSkills = useMemo(
    () => library.filter((t) => t.type === 'skill' && (t.scope === 'ship' || t.scope === 'global')),
    [library],
  )
  const availableMcps = useMemo(
    () => library.filter((t) => t.type === 'mcp' && (t.scope === 'ship' || t.scope === 'global')),
    [library],
  )
  const availableScripts = useMemo(
    () => library.filter((t) => t.type === 'script' && (t.scope === 'ship' || t.scope === 'global')),
    [library],
  )

  function submit() {
    if (!name.trim()) return alert('name is required')
    const allowedTools = allowedToolsText.trim()
      ? allowedToolsText.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined
    const data: AgentTool = {
      name: name.trim(),
      description: description.trim(),
      role: role.trim() || name.trim(),
      model: model.trim() || undefined,
      toolPreset,
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
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={disableName} className={inputCls} />
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
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>TOOL PRESET</Label>
          <div className="flex gap-1 text-[10px]">
            {(['none', 'claude_code'] as AgentToolPreset[]).map((p) => (
              <button
                key={p}
                onClick={() => setToolPreset(p)}
                className={`px-2 py-1 border ${
                  toolPreset === p
                    ? 'border-cyan-400 text-cyan-200 bg-cyan-500/10'
                    : 'border-zinc-600 text-zinc-400'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {toolPreset === 'claude_code' && (
          <div>
            <Label hint="comma-separated; leave blank for full preset">ALLOWED TOOLS</Label>
            <input
              value={allowedToolsText}
              onChange={(e) => setAllowedToolsText(e.target.value)}
              placeholder="Read,Edit,Write,Glob,Grep,Bash"
              className={inputCls}
            />
          </div>
        )}
      </div>

      <CapabilityMultiselect
        label="SKILLS"
        options={availableSkills}
        selected={skills}
        onChange={setSkills}
      />
      <CapabilityMultiselect
        label="MCPS"
        options={availableMcps}
        selected={mcps}
        onChange={setMcps}
      />
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

function CapabilityMultiselect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: ToolSummary[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const stale = selected.filter((s) => !options.find((o) => o.name === s))

  return (
    <div>
      <Label hint={`from this ship's library — ${options.length} available`}>{label}</Label>
      {options.length === 0 && stale.length === 0 ? (
        <p className="text-zinc-600 italic">// none in library</p>
      ) : (
        <div className="space-y-1 max-h-40 overflow-y-auto pr-1 border border-cyan-500/20 rounded p-1">
          {options.map((o) => {
            const checked = selected.includes(o.name)
            return (
              <label
                key={o.scope + '/' + o.name}
                className="flex items-start gap-2 cursor-pointer hover:bg-zinc-800/40 px-1 py-0.5 rounded"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, o.name]
                      : selected.filter((n) => n !== o.name)
                    onChange(next)
                  }}
                  className="mt-0.5 accent-cyan-500"
                />
                <span className="flex-1">
                  <span className="text-cyan-300">{o.name}</span>{' '}
                  <span className="text-[10px] text-zinc-500">[{o.scope}]</span>
                  {o.description && (
                    <span className="block text-[10px] text-zinc-500 leading-tight">{o.description}</span>
                  )}
                </span>
              </label>
            )
          })}
          {stale.length > 0 && (
            <div className="border-t border-amber-500/30 mt-1 pt-1">
              {stale.map((s) => (
                <div key={s} className="flex items-center gap-1 px-1 py-0.5">
                  <span className="flex-1 text-amber-300 text-[10px]">
                    {s} <span className="text-zinc-500">(missing from library)</span>
                  </span>
                  <button
                    onClick={() => onChange(selected.filter((n) => n !== s))}
                    className="px-1 py-0 border border-rose-500/60 text-rose-300 hover:bg-rose-500/20 text-[10px]"
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
