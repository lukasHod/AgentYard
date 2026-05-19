import { useState } from 'react'

export interface SkillSummary {
  name: string
  description: string
  path: string
}

interface Props {
  skills: SkillSummary[]
  onRefresh: () => Promise<void> | void
}

export function SkillsView({ skills, onRefresh }: Props) {
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setBusy(true)
    try {
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 text-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-cyan-300 tracking-widest text-sm">SKILL LIBRARY</h2>
          <p className="text-zinc-500 text-xs mt-1">
            Drop a folder into <code className="text-cyan-300">~/.agentyard/skills/</code> with a{' '}
            <code className="text-cyan-300">SKILL.md</code> (frontmatter: name, description) and click refresh.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className="px-3 py-1 border border-cyan-500 text-cyan-300 hover:bg-cyan-500 hover:text-black tracking-wide text-xs disabled:opacity-30"
        >
          {busy ? 'refreshing…' : '↻ refresh'}
        </button>
      </div>

      {skills.length === 0 ? (
        <p className="text-zinc-500 italic">// no skills loaded. drop folders into ~/.agentyard/skills/ and refresh.</p>
      ) : (
        <ul className="space-y-3">
          {skills.map((s) => (
            <li
              key={s.name}
              className="border border-cyan-500/30 rounded p-4 bg-cyan-500/5"
            >
              <div className="flex items-baseline gap-3">
                <span className="text-cyan-300 tracking-wide">{s.name}</span>
                <span className="text-zinc-600 text-[10px] font-mono">{s.path}</span>
              </div>
              {s.description && (
                <p className="text-zinc-300 mt-1 text-xs">{s.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
