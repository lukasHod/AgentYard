import type { ScriptArg, ScriptTool } from '../../../../core/tools'
import { useObjectState } from '../../../hooks/useObjectState'
import { EmptyMessage } from '../../ui/EmptyMessage'
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
  const [form, set] = useObjectState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    cmd: initial?.cmd ?? '',
    args: (initial?.args ?? []) as ScriptArg[],
    includeBody: !!initial?.bodyFile,
    bodyFile: initial?.bodyFile ?? 'script.sh',
    body: initial?.body ?? '',
  })

  function submit() {
    if (!form.name.trim()) return alert('name is required')
    if (!form.cmd.trim()) return alert('cmd is required')
    const data: ScriptTool = {
      name: form.name.trim(),
      description: form.description.trim(),
      cmd: form.cmd.trim(),
      args: form.args,
    }
    if (form.includeBody) {
      data.bodyFile = form.bodyFile.trim() || 'script.sh'
      data.body = form.body
    }
    onSubmit(data)
  }

  function addArg() {
    set({ args: [...form.args, { name: '', description: '', required: false }] })
  }
  function removeArg(i: number) {
    set({ args: form.args.filter((_, j) => j !== i) })
  }
  function updateArg(i: number, patch: Partial<ScriptArg>) {
    set({ args: form.args.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  }

  return (
    <div className="space-y-3">
      <NameDescriptionFields
        name={form.name}
        description={form.description}
        onName={(v) => set({ name: v })}
        onDescription={(v) => set({ description: v })}
        disableName={disableName}
        layout="side-by-side"
      />
      <div>
        <Label hint="authoritative; supports {argName} substitution from this tool's args">CMD</Label>
        <input
          value={form.cmd}
          onChange={(e) => set({ cmd: e.target.value })}
          placeholder="npm test -- --reporter=json"
          className={inputCls}
        />
      </div>

      <div>
        <Label>ARGS</Label>
        {form.args.length === 0 ? (
          <EmptyMessage>no args declared</EmptyMessage>
        ) : (
          <div className="space-y-1">
            {form.args.map((a, i) => (
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
            checked={form.includeBody}
            onChange={(e) => set({ includeBody: e.target.checked })}
            className="accent-cyan-500"
          />
          include script body file
        </label>
        {form.includeBody && (
          <div className="space-y-2 mt-1">
            <div>
              <Label hint="reference explicitly from cmd, e.g. bash script.sh">BODY FILENAME</Label>
              <input
                value={form.bodyFile}
                onChange={(e) => set({ bodyFile: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <Label>BODY</Label>
              <textarea
                value={form.body}
                onChange={(e) => set({ body: e.target.value })}
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
