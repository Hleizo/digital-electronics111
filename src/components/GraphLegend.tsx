import type { Accent } from '../types'

export function GraphLegend({ label, accent, dashed = false, points = false }: { label: string; accent: Accent; dashed?: boolean; points?: boolean }) {
  return <span className={`graph-legend accent-${accent}`}><span className={points ? 'legend-point' : dashed ? 'legend-line legend-line--dashed' : 'legend-line'} aria-hidden="true" />{label}</span>
}

export function GraphAxisLabel({ axis, children }: { axis: 'voltage' | 'time'; children: React.ReactNode }) {
  return <span className={`axis-label axis-label--${axis}`}>{children}</span>
}
