/**
 * PortGrid Component
 *
 * Visual grid of switch ports mirroring a physical Cisco Catalyst switch.
 * - Rows of 24 ports (12 odd on top, 12 even on bottom)
 * - Dark chassis styling with realistic RJ45 port appearance
 * - Separate SFP+ uplink section
 */

import { useState, useMemo } from 'react'
import type { Interface } from '../../../types/device'
import { organizePortsForGrid, countPortsByStatus, type PortBank } from './portUtils'
import PortSquare from './PortSquare'
import PortDetailPanel from './PortDetailPanel'

interface PortGridProps {
  interfaces: Interface[]
  deviceName?: string
}

export default function PortGrid({ interfaces, deviceName }: PortGridProps) {
  const [selectedPort, setSelectedPort] = useState<Interface | null>(null)

  // Organize ports into grid layout
  const organized = useMemo(() => organizePortsForGrid(interfaces), [interfaces])

  // Count ports by status
  const counts = useMemo(() => countPortsByStatus(interfaces), [interfaces])

  // Check if we have any parseable ports
  const hasPorts = organized.modules.length > 0 || organized.uplinks.length > 0

  if (!hasPorts && organized.other.length === 0) {
    return (
      <div className="text-sm text-text-muted py-2">
        No port data available
      </div>
    )
  }

  // If a port is selected, show detail panel
  if (selectedPort) {
    return (
      <PortDetailPanel
        interface={selectedPort}
        onBack={() => setSelectedPort(null)}
      />
    )
  }

  return (
    <div className="space-y-3" data-tour="port-grid">
      {/* Switch Chassis */}
      <div className="switch-chassis">
        {/* Chassis top bezel with branding */}
        <div className="chassis-bezel-top">
          <span className="chassis-brand">CISCO</span>
          {deviceName && <span className="chassis-model">{deviceName}</span>}
        </div>

        {/* Port modules container */}
        <div className="chassis-ports-area">
          {/* Uplink ports (SFP+) - at top like real Catalyst switches */}
          {organized.uplinks.length > 0 && (
            <div className="uplink-module uplink-top">
              <div className="uplink-ports">
                {organized.uplinks.map((gridPort, idx) => (
                  <PortSquare
                    key={gridPort.interface.name}
                    interface={gridPort.interface}
                    onClick={() => setSelectedPort(gridPort.interface)}
                    variant="sfp"
                    position={idx === 0 ? 'left' : 'center'}
                    tooltipBelow={true}
                  />
                ))}
              </div>
              <div className="uplink-label">10G</div>
            </div>
          )}

          {/* Port banks by module */}
          {organized.modules.map((module) => (
            <div key={module.moduleId} className="port-module">
              {/* Module label if multiple modules */}
              {organized.modules.length > 1 && (
                <div className="module-label">{module.label}</div>
              )}

              {/* Banks of 24 ports */}
              {module.banks.map((bank, bankIdx) => (
                <PortBankDisplay
                  key={bankIdx}
                  bank={bank}
                  bankIndex={bankIdx}
                  onPortClick={setSelectedPort}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Chassis bottom bezel */}
        <div className="chassis-bezel-bottom" />
      </div>

      {/* Port Status Legend */}
      <div className="port-legend">
        <div className="legend-item">
          <span className="legend-led led-green" />
          <span>{counts.up} up</span>
        </div>
        <div className="legend-item">
          <span className="legend-led led-red" />
          <span>{counts.down} down</span>
        </div>
        {counts.disabled > 0 && (
          <div className="legend-item">
            <span className="legend-led led-off" />
            <span>{counts.disabled} disabled</span>
          </div>
        )}
      </div>

      {/* Other interfaces (management, VLAN, etc.) */}
      {organized.other.length > 0 && (
        <div className="other-interfaces">
          <div className="other-header">Other Interfaces</div>
          <div className="other-list">
            {organized.other.slice(0, 5).map((iface) => (
              <button
                key={iface.name}
                type="button"
                onClick={() => setSelectedPort(iface)}
                className="other-interface-btn"
              >
                <span className="font-mono truncate">{iface.name}</span>
                <span className={`other-status ${
                  iface.status === 'up' ? 'status-up' : 'status-down'
                }`} />
              </button>
            ))}
            {organized.other.length > 5 && (
              <div className="other-more">
                +{organized.other.length - 5} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inline styles for switch chassis appearance */}
      <style>{`
        .switch-chassis {
          background: linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%);
          border-radius: 6px;
          border: 1px solid #333;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.05),
            0 4px 12px rgba(0,0,0,0.5);
          overflow: hidden;
        }

        .chassis-bezel-top {
          background: linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%);
          padding: 6px 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #333;
        }

        .chassis-brand {
          font-family: 'Arial Black', sans-serif;
          font-size: 10px;
          font-weight: 900;
          color: #00bceb;
          letter-spacing: 2px;
          text-shadow: 0 0 8px rgba(0, 188, 235, 0.5);
        }

        .chassis-model {
          font-family: monospace;
          font-size: 9px;
          color: #666;
          text-transform: uppercase;
        }

        .chassis-ports-area {
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .port-module {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .module-label {
          font-size: 9px;
          color: #555;
          font-family: monospace;
          padding-left: 2px;
        }

        .port-bank {
          background: #111;
          border-radius: 4px;
          padding: 6px 8px;
          border: 1px solid #222;
        }

        .port-bank-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 4px;
        }

        .port-numbers {
          display: flex;
          justify-content: space-between;
          padding: 0 2px;
        }

        .port-number {
          font-size: 7px;
          color: #444;
          font-family: monospace;
          width: 18px;
          text-align: center;
        }

        .port-row {
          display: flex;
          gap: 2px;
          padding: 2px 0;
        }

        .uplink-module {
          display: flex;
          align-items: center;
          gap: 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid #222;
          margin-bottom: 4px;
        }

        .uplink-module.uplink-top {
          padding-top: 0;
          border-top: none;
          margin-top: 0;
        }

        .uplink-label {
          font-size: 9px;
          color: #555;
          font-family: monospace;
          font-weight: bold;
        }

        .uplink-ports {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .chassis-bezel-bottom {
          height: 4px;
          background: linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%);
          border-top: 1px solid #222;
        }

        .port-legend {
          display: flex;
          gap: 12px;
          font-size: 11px;
          color: #888;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .legend-led {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .led-green {
          background: #22c55e;
          box-shadow: 0 0 4px #22c55e;
        }

        .led-red {
          background: #ef4444;
          box-shadow: 0 0 4px #ef4444;
        }

        .led-off {
          background: #444;
        }

        .other-interfaces {
          padding-top: 8px;
          border-top: 1px solid #333;
        }

        .other-header {
          font-size: 11px;
          color: #666;
          margin-bottom: 6px;
        }

        .other-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .other-interface-btn {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 6px;
          font-size: 11px;
          border-radius: 4px;
          background: transparent;
          border: none;
          color: #aaa;
          cursor: pointer;
          transition: background 0.15s;
        }

        .other-interface-btn:hover {
          background: #222;
        }

        .other-status {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .other-status.status-up {
          background: #22c55e;
        }

        .other-status.status-down {
          background: #ef4444;
        }

        .other-more {
          font-size: 10px;
          color: #555;
          padding: 2px 6px;
        }
      `}</style>
    </div>
  )
}

/** Display a bank of 24 ports (12 odd on top, 12 even on bottom) */
function PortBankDisplay({
  bank,
  bankIndex,
  onPortClick,
}: {
  bank: PortBank
  bankIndex: number
  onPortClick: (iface: Interface) => void
}) {
  // Generate port numbers for labels (1,3,5... or 25,27,29...)
  const startPort = bankIndex * 24 + 1
  const topRowNumbers = Array.from({ length: 12 }, (_, i) => startPort + i * 2)

  return (
    <div className="port-bank">
      {/* Port numbers above top row */}
      <div className="port-numbers">
        {topRowNumbers.map((num) => (
          <span key={num} className="port-number">{num}</span>
        ))}
      </div>

      {/* Top row - odd ports (1, 3, 5...) */}
      <div className="port-row">
        {bank.oddPorts.map((gridPort, idx) => (
          <PortSquare
            key={gridPort.interface.name}
            interface={gridPort.interface}
            onClick={() => onPortClick(gridPort.interface)}
            variant="rj45"
            position={idx === 0 ? 'left' : idx >= 10 ? 'right' : 'center'}
          />
        ))}
        {/* Fill empty slots if less than 12 ports */}
        {Array.from({ length: Math.max(0, 12 - bank.oddPorts.length) }).map((_, i) => (
          <div key={`empty-odd-${i}`} className="port-empty" style={{ width: 18, height: 14 }} />
        ))}
      </div>

      {/* Bottom row - even ports (2, 4, 6...) */}
      <div className="port-row">
        {bank.evenPorts.map((gridPort, idx) => (
          <PortSquare
            key={gridPort.interface.name}
            interface={gridPort.interface}
            onClick={() => onPortClick(gridPort.interface)}
            variant="rj45"
            position={idx === 0 ? 'left' : idx >= 10 ? 'right' : 'center'}
          />
        ))}
        {/* Fill empty slots if less than 12 ports */}
        {Array.from({ length: Math.max(0, 12 - bank.evenPorts.length) }).map((_, i) => (
          <div key={`empty-even-${i}`} className="port-empty" style={{ width: 18, height: 14 }} />
        ))}
      </div>
    </div>
  )
}
