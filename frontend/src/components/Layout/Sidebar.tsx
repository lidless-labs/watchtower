import { useState } from 'react'
import { useNocStore } from '../../store/nocStore'
import DeviceCard from '../Sidebar/DeviceCard'
import ConnectionCard from '../Sidebar/ConnectionCard'
import NetworkSummary from '../Sidebar/NetworkSummary'
import PhysicalLinksPanel from '../Sidebar/PhysicalLinksPanel'
import SpeedtestWidget from '../Sidebar/SpeedtestWidget'
import PortGroupWidget from '../Sidebar/PortGroupWidget'
import PortSearchWidget from '../Sidebar/PortSearchWidget'

type SidebarTab = 'overview' | 'links'

export default function Sidebar() {
  const selectedDevice = useNocStore((state) => state.selectedDevice)
  const selectedConnection = useNocStore((state) => state.selectedConnection)
  const [activeTab, setActiveTab] = useState<SidebarTab>('overview')

  // If something is selected, show the detail view
  if (selectedDevice) {
    return (
      <div className="h-full flex flex-col overflow-hidden" data-tour="sidebar-device-card">
        <DeviceCard device={selectedDevice} />
      </div>
    )
  }

  if (selectedConnection) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <ConnectionCard connection={selectedConnection} />
      </div>
    )
  }

  // Otherwise show tabbed view
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tab header */}
      <div className="flex border-b border-border-primary bg-bg-secondary">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'overview'
              ? 'text-accent-primary border-b-2 border-accent-primary'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('links')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'links'
              ? 'text-accent-primary border-b-2 border-accent-primary'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Physical Links
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'overview' ? (
          <div className="h-full overflow-y-auto">
            <div data-tour="speedtest-widget">
              <SpeedtestWidget />
            </div>
            <PortGroupWidget />
            <PortSearchWidget />
            <div data-tour="network-summary">
              <NetworkSummary />
            </div>
            <div className="p-3 border-t border-border-primary">
              <div className="text-xs text-text-tertiary text-center">
                Click a device or connection for details
              </div>
            </div>
          </div>
        ) : (
          <PhysicalLinksPanel />
        )}
      </div>
    </div>
  )
}
