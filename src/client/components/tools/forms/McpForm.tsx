import { useState } from 'react'
import type { McpTool, McpTransport } from '../../../../core/tools'
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
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
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
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
        />
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
