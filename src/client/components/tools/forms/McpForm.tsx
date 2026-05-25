import type { McpTool, McpTransport } from '../../../../core/tools'
import { useObjectState } from '../../../hooks/useObjectState'
import { FormButtons, Label, inputCls, textareaCls } from './formChrome'
import { envToText, textToKv } from './kvParsing'

export function McpForm({
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
  const [form, set] = useObjectState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    transport: initial?.transport ?? ('stdio' as McpTransport),
    command: initial?.command ?? '',
    argsText: (initial?.args ?? []).join(' '),
    envText: envToText(initial?.env),
    url: initial?.url ?? '',
    headersText: envToText(initial?.headers),
  })

  function submit() {
    if (!form.name.trim()) return alert('name is required')
    const data: McpTool = {
      name: form.name.trim(),
      description: form.description.trim(),
      transport: form.transport,
    }
    if (form.transport === 'stdio') {
      data.command = form.command.trim()
      data.args = form.argsText.trim() ? form.argsText.trim().split(/\s+/) : undefined
      const env = textToKv(form.envText)
      if (Object.keys(env).length > 0) data.env = env
    } else {
      data.url = form.url.trim()
      const headers = textToKv(form.headersText)
      if (Object.keys(headers).length > 0) data.headers = headers
    }
    onSubmit(data)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
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
          <Label>TRANSPORT</Label>
          <div className="flex gap-1 text-[10px]">
            {(['stdio', 'http', 'sse'] as McpTransport[]).map((t) => (
              <button
                key={t}
                onClick={() => set({ transport: t })}
                className={`px-2 py-1 border ${
                  form.transport === t
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
        <input
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          className={inputCls}
        />
      </div>

      {form.transport === 'stdio' ? (
        <>
          <div>
            <Label>COMMAND</Label>
            <input
              value={form.command}
              onChange={(e) => set({ command: e.target.value })}
              placeholder="npx"
              className={inputCls}
            />
          </div>
          <div>
            <Label hint="space-separated">ARGS</Label>
            <input
              value={form.argsText}
              onChange={(e) => set({ argsText: e.target.value })}
              placeholder="@modelcontextprotocol/server-github"
              className={inputCls}
            />
          </div>
          <div>
            <Label hint="KEY=value per line — supports ${env:VAR}">ENV</Label>
            <textarea
              value={form.envText}
              onChange={(e) => set({ envText: e.target.value })}
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
            <input
              value={form.url}
              onChange={(e) => set({ url: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <Label hint="KEY=value per line — supports ${env:VAR}">HEADERS</Label>
            <textarea
              value={form.headersText}
              onChange={(e) => set({ headersText: e.target.value })}
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
