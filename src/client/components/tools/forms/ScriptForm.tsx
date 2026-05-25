import { useState } from 'react'
import type { ScriptArg, ScriptTool } from '../../../../core/tools'
import { FormButtons, Label, NameDescriptionFields, inputCls, textareaCls } from './formChrome'

export function ScriptForm({
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
      <NameDescriptionFields
        name={name}
        description={description}
        onName={setName}
        onDescription={setDescription}
        disableName={disableName}
        layout="side-by-side"
      />
      <div>
        <Label hint="authoritative; supports {argName} substitution from this tool's args">CMD</Label>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="npm test -- --reporter=json"
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
