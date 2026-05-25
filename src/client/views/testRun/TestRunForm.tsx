import type { ShipSummary } from '../../../core/types'
import type { Workflow, WorkflowNode } from '../../../core/schema'
import type { TestRunRequest } from './types'

export function TestRunForm(props: {
  ships: ShipSummary[]
  shipId: number | null
  setShipId: (id: number) => void
  task: string
  setTask: (s: string) => void
  request: TestRunRequest
  workflow: Workflow
  targetNode: WorkflowNode | null
  upstreamOutputs: string
  setUpstreamOutputs: (s: string) => void
  submitting: boolean
  submitError: string | null
  onSubmit: () => void
}) {
  const {
    ships,
    shipId,
    setShipId,
    task,
    setTask,
    request,
    workflow,
    targetNode,
    upstreamOutputs,
    setUpstreamOutputs,
    submitting,
    submitError,
    onSubmit,
  } = props

  // Upstream node ids for the node being tested in isolation —
  // drives the help text + placeholder.
  const upstreamNodeIds =
    request.scope === 'node' && request.nodeId
      ? workflow.graph.edges.filter((e) => e.to === request.nodeId).map((e) => e.from)
      : []
  const upstreamNodes = upstreamNodeIds
    .map((id) => workflow.graph.nodes.find((n) => n.id === id))
    .filter((n): n is WorkflowNode => Boolean(n))
  const promptUsesUpstream = (targetNode?.prompt ?? '').includes('{upstream_outputs}')
  const argsUseUpstream = Object.values(targetNode?.args ?? {}).some((v) =>
    v.includes('{upstream_outputs}'),
  )
  const nodeReferencesUpstream = promptUsesUpstream || argsUseUpstream

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-xs">
      <p className="text-zinc-400 leading-relaxed">
        Spawns a disposable git worktree on the selected ship, runs the{' '}
        {request.scope === 'workflow' ? 'whole workflow' : 'selected node only'} in that sandbox,
        and tears the worktree down when the run ends. Your project files outside the sandbox are
        not touched.
      </p>

      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">SHIP</label>
        <p className="text-zinc-600 text-[10px] mb-1">
          The project the sandbox worktree will be forked from. Tools and per-ship agents resolve
          from this ship's library too.
        </p>
        {ships.length === 0 ? (
          <p className="text-zinc-600 italic">
            // no ships registered. create one from the galaxy view first.
          </p>
        ) : (
          <select
            value={shipId ?? ''}
            onChange={(e) => setShipId(Number(e.target.value))}
            className="w-full bg-black border border-fuchsia-500/40 rounded px-2 py-1 focus:outline-none focus:border-fuchsia-300"
          >
            {ships.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.projectPath}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">TASK</label>
        <p className="text-zinc-600 text-[10px] mb-1 leading-relaxed">
          The user-facing request — what someone would type to start a real run. Available
          everywhere in prompts and script args as{' '}
          <code className="text-fuchsia-300">{'{task}'}</code>, and stays the same across every
          node in the workflow.
        </p>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
          placeholder={
            request.scope === 'workflow'
              ? 'e.g. add a hello world endpoint and commit it'
              : 'e.g. add a hello world endpoint'
          }
          className="w-full bg-black border border-fuchsia-500/40 rounded p-2 text-zinc-200 focus:outline-none focus:border-fuchsia-300 font-mono"
        />
      </div>

      {request.scope === 'node' && (
        <div>
          <label className="text-[10px] tracking-widest text-zinc-500 block mb-1">
            UPSTREAM CONTEXT
          </label>
          <p className="text-zinc-600 text-[10px] mb-1 leading-relaxed">
            What the previous node(s) would have produced. In a real workflow this flows in
            automatically — when you test a single node in isolation, the upstreams don't run, so
            you paste here whatever you want them to have said. Available as{' '}
            <code className="text-fuchsia-300">{'{upstream_outputs}'}</code> in this node's prompt
            and script args.
          </p>
          {upstreamNodes.length > 0 ? (
            <p className="text-zinc-500 text-[10px] mb-1">
              In a real run, this node receives the summaries from:{' '}
              {upstreamNodes.map((n, i) => (
                <span key={n.id}>
                  {i > 0 && ', '}
                  <span className="text-fuchsia-300">{n.id}</span>{' '}
                  <span className="text-zinc-600">({n.type})</span>
                </span>
              ))}
              .
            </p>
          ) : (
            <p className="text-zinc-500 text-[10px] mb-1">
              <span className="text-fuchsia-300">{targetNode?.id}</span> has no upstream nodes in
              the workflow (it's a root) — in a real run{' '}
              <code className="text-fuchsia-300">{'{upstream_outputs}'}</code> would be empty. Only
              fill this if this node's prompt explicitly uses the token.
            </p>
          )}
          {!nodeReferencesUpstream && (
            <p className="text-zinc-600 text-[10px] mb-1 italic">
              // heads up: this node's prompt and args don't reference{' '}
              <code className="text-zinc-500">{'{upstream_outputs}'}</code> — whatever you paste
              here won't actually appear anywhere.
            </p>
          )}
          <textarea
            value={upstreamOutputs}
            onChange={(e) => setUpstreamOutputs(e.target.value)}
            rows={4}
            placeholder={
              upstreamNodes.length > 0
                ? `e.g. paste here what '${upstreamNodes[0]!.id}' would normally produce`
                : '(leave blank — no upstream in real runs either)'
            }
            className="w-full bg-black border border-fuchsia-500/40 rounded p-2 text-zinc-200 focus:outline-none focus:border-fuchsia-300 font-mono"
          />
        </div>
      )}

      {submitError && <p className="text-rose-300 text-xs">// {submitError}</p>}

      <div className="flex justify-end">
        <button
          onClick={onSubmit}
          disabled={submitting || !shipId || task.trim().length === 0}
          className="px-4 py-2 border border-fuchsia-500 text-fuchsia-200 hover:bg-fuchsia-500/20 tracking-wide disabled:opacity-30"
        >
          {submitting ? 'launching…' : '▶ launch sandbox'}
        </button>
      </div>
    </div>
  )
}
