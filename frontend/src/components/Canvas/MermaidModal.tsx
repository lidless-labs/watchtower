import { useEffect, useRef, useState, useCallback } from 'react'
import mermaid from 'mermaid'

interface MermaidModalProps {
  isOpen: boolean
  onClose: () => void
  diagram: string
}

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#3b82f6',
    primaryTextColor: '#e5e7eb',
    primaryBorderColor: '#4b5563',
    lineColor: '#6b7280',
    secondaryColor: '#1f2937',
    tertiaryColor: '#111827',
    background: '#0d1117',
    mainBkg: '#161b22',
    secondBkg: '#21262d',
    border1: '#30363d',
    border2: '#21262d',
    arrowheadColor: '#6b7280',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: '14px',
    nodeBorder: '#30363d',
    clusterBkg: '#161b22',
    clusterBorder: '#30363d',
    titleColor: '#e5e7eb',
    edgeLabelBackground: '#161b22',
  },
  flowchart: {
    htmlLabels: true,
    curve: 'basis',
    padding: 20,
    nodeSpacing: 50,
    rankSpacing: 80,
  },
})

export default function MermaidModal({ isOpen, onClose, diagram }: MermaidModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  // Render the mermaid diagram
  useEffect(() => {
    if (!isOpen || !diagram || !containerRef.current) return

    const renderDiagram = async () => {
      try {
        setError(null)
        // Clear previous content
        while (containerRef.current?.firstChild) {
          containerRef.current.removeChild(containerRef.current.firstChild)
        }

        // Generate unique ID for each render to avoid Mermaid caching issues
        const uniqueId = `mermaid-diagram-${Date.now()}`
        const { svg } = await mermaid.render(uniqueId, diagram)

        // Parse as HTML (not XML) since Mermaid SVG contains HTML labels like <br>
        const parser = new DOMParser()
        const doc = parser.parseFromString(svg, 'text/html')
        const svgElement = doc.querySelector('svg')

        if (svgElement && containerRef.current) {
          svgElement.style.maxWidth = '100%'
          svgElement.style.height = 'auto'
          svgElement.style.display = 'block'
          svgElement.style.margin = '0 auto'
          containerRef.current.appendChild(svgElement)
        }
      } catch (err) {
        console.error('Mermaid render error:', err)
        setError(err instanceof Error ? err.message : 'Failed to render diagram')
      }
    }

    renderDiagram()

    // Reset view when opening
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [isOpen, diagram])

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Zoom handlers
  const handleZoomIn = useCallback(() => setScale(s => Math.min(s + 0.5, 20)), [])
  const handleZoomOut = useCallback(() => setScale(s => Math.max(s - 0.5, 0.1)), [])
  const handleResetView = useCallback(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [])

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return // Only left click
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }, [position])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }, [isDragging, dragStart])

  const handleMouseUp = useCallback(() => setIsDragging(false), [])

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.2 : 0.2
    setScale(s => Math.max(0.1, Math.min(20, s + delta)))
  }, [])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-[90vw] h-[85vh] max-w-7xl bg-bg-primary border border-border-default rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-bg-secondary">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-accent-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            <h2 className="text-lg font-semibold text-text-primary">Network Topology Diagram</h2>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {/* Zoom controls */}
            <div className="flex items-center gap-1 bg-bg-tertiary rounded-lg p-1">
              <button
                onClick={handleZoomOut}
                className="p-1.5 hover:bg-bg-secondary rounded transition-colors text-text-secondary hover:text-text-primary"
                title="Zoom out"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>
              <span className="text-xs text-text-secondary px-2 min-w-[50px] text-center">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={handleZoomIn}
                className="p-1.5 hover:bg-bg-secondary rounded transition-colors text-text-secondary hover:text-text-primary"
                title="Zoom in"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            <button
              onClick={handleResetView}
              className="p-1.5 hover:bg-bg-tertiary rounded transition-colors text-text-secondary hover:text-text-primary"
              title="Reset view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-red-500/20 rounded transition-colors text-text-secondary hover:text-red-400 ml-2"
              title="Close (Esc)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Diagram container */}
        <div
          className="flex-1 overflow-hidden bg-[#0d1117] cursor-grab active:cursor-grabbing relative"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          {error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center p-8">
                <svg className="w-12 h-12 text-status-red mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-text-primary font-medium mb-2">Failed to render diagram</p>
                <p className="text-text-secondary text-sm">{error}</p>
              </div>
            </div>
          ) : (
            <div
              className="w-full h-full flex items-center justify-center p-8"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
              }}
            >
              <div
                ref={containerRef}
                className="mermaid-container"
              />
            </div>
          )}

        </div>

        {/* Legend - positioned over diagram */}
        <div className="absolute bottom-12 left-4 z-20 bg-bg-secondary/95 backdrop-blur-sm border border-border-default rounded-lg p-3 text-xs shadow-lg">
          <div className="font-semibold text-text-primary mb-2 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Legend
          </div>

          {/* Device Shapes */}
          <div className="mb-2">
            <div className="text-text-muted mb-1">Device Types</div>
            <div className="space-y-1 ml-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-blue-500/30 border border-blue-500/50 rounded-sm" style={{ clipPath: 'polygon(15% 0%, 85% 0%, 100% 50%, 85% 100%, 15% 100%, 0% 50%)' }} />
                <span className="text-text-secondary">Switch</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-orange-500/30 border border-orange-500/50" style={{ clipPath: 'polygon(0% 0%, 100% 0%, 85% 100%, 15% 100%)' }} />
                <span className="text-text-secondary">Firewall</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-purple-500/30 border border-purple-500/50 rounded-sm" />
                <span className="text-text-secondary">Server</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-gray-500/30 border border-gray-500/50 rounded-full" />
                <span className="text-text-secondary">External</span>
              </div>
            </div>
          </div>

          {/* Connection Types */}
          <div>
            <div className="text-text-muted mb-1">Connections</div>
            <div className="space-y-1 ml-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-blue-400" />
                <span className="text-text-secondary">Physical Link</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-blue-400 border-dashed" style={{ borderTopWidth: '2px', borderTopStyle: 'dashed', height: 0, backgroundColor: 'transparent', borderColor: '#60a5fa' }} />
                <span className="text-text-secondary">WAN / External</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-border-default bg-bg-secondary text-xs text-text-muted flex items-center justify-between">
          <span>Drag to pan - Scroll to zoom - Press Esc to close</span>
          <span className="opacity-50">Powered by Mermaid</span>
        </div>
      </div>
    </div>
  )
}
