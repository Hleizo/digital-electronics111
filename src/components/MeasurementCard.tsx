import type { Accent } from '../types'

export interface MeasurementCardProps { label: string; value: string | number | null; unit?: string; detail: string; accent?: Accent; binary?: boolean; warning?: boolean }

export function MeasurementCard({ label, value, unit, detail, accent = 'cyan', binary = false, warning = false }: MeasurementCardProps) {
  return <div data-measurement={label} className={`measurement-card accent-${accent}${warning ? ' measurement-card--warning' : ''}`} title={detail}>
    <div className="measurement-label"><span className="measurement-dot" aria-hidden="true" />{label}</div>
    <div className={`measurement-value${binary ? ' measurement-value--binary' : ''}`}>{value ?? '—'}{unit && <span>{unit}</span>}</div>
    <div className="measurement-detail">{detail}</div>
  </div>
}
