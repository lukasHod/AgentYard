import { useState } from 'react'
import { GlassTab } from '../glass/GlassTab'
import { ToolsTabContent } from '../ToolsTabContent'
import { PlanetDashboard } from './PlanetDashboard'

type SunTab = 'dashboard' | 'workflows' | 'tools' | 'agents' | 'mcps'

export function SunPanelInfo() {
  const [tab, setTab] = useState<SunTab>('dashboard')

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap gap-2 mb-4 flex-shrink-0">
        <GlassTab active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>DASHBOARD</GlassTab>
        <GlassTab active={tab === 'workflows'} onClick={() => setTab('workflows')}>WORKFLOWS</GlassTab>
        <GlassTab active={tab === 'tools'} onClick={() => setTab('tools')}>TOOLS</GlassTab>
        <GlassTab active={tab === 'agents'} onClick={() => setTab('agents')}>AGENTS</GlassTab>
        <GlassTab active={tab === 'mcps'} onClick={() => setTab('mcps')}>MCPS</GlassTab>
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'workflows' && <WorkflowsTab />}
        {tab === 'tools' && <ToolsTabContent planetId={null} />}
        {tab === 'agents' && <ToolsTabContent planetId={null} />}
        {tab === 'mcps' && <ToolsTabContent planetId={null} />}
      </div>
    </div>
  )
}

function DashboardTab() {
  return <PlanetDashboard />
}

function WorkflowsTab() {
  return (
    <div className="text-sm text-slate-300">
      Global workflow library lands as a follow-up polish. The single workflow
      can be edited via the ⚙ button on any planet.
    </div>
  )
}
