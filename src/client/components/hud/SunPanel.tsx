import { useState } from 'react'
import { GlassTab } from '../glass/GlassTab'
import { ToolsTabContent } from '../ToolsTabContent'

type SunTab = 'dashboard' | 'workflows' | 'tools' | 'agents' | 'mcps'

export function SunPanelInfo() {
  const [tab, setTab] = useState<SunTab>('dashboard')

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        <GlassTab active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>DASHBOARD</GlassTab>
        <GlassTab active={tab === 'workflows'} onClick={() => setTab('workflows')}>WORKFLOWS</GlassTab>
        <GlassTab active={tab === 'tools'} onClick={() => setTab('tools')}>TOOLS</GlassTab>
        <GlassTab active={tab === 'agents'} onClick={() => setTab('agents')}>AGENTS</GlassTab>
        <GlassTab active={tab === 'mcps'} onClick={() => setTab('mcps')}>MCPS</GlassTab>
      </div>
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'workflows' && <WorkflowsTab />}
      {tab === 'tools' && <ToolsTabContent planetId={null} />}
      {tab === 'agents' && <ToolsTabContent planetId={null} />}
      {tab === 'mcps' && <ToolsTabContent planetId={null} />}
    </>
  )
}

function DashboardTab() {
  return (
    <div className="text-sm text-slate-300">
      All-projects overview lands as a Phase 14 polish.
    </div>
  )
}

function WorkflowsTab() {
  return (
    <div className="text-sm text-slate-300">
      Global workflow library lands as a follow-up polish. The single workflow
      can be edited via the ⚙ button on any planet.
    </div>
  )
}
