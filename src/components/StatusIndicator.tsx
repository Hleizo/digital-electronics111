export function StatusIndicator({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'cyan' | 'green' | 'amber' }) {
  return <span className={`status status--${tone}`}><span className="status-dot" aria-hidden="true" />{label}</span>
}
