import type { Reading } from './readouts'

export function MeasurementTable({ caption, readings }: { caption: string; readings: Reading[] }) {
  return <div className="technical-table-scroll" role="region" aria-label={caption} tabIndex={0}><table className="technical-table"><caption>{caption}</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Measured / calculated</th><th scope="col">Reference</th></tr></thead><tbody>{readings.map(reading => <tr key={reading.label} data-measurement={reading.label} className={`measurement-record accent-${reading.accent ?? 'cyan'}${reading.warning ? ' measurement-record--warning' : ''}`}>
    <th scope="row" className="measurement-label">{reading.label}</th><td><span className={`measurement-value${reading.binary ? ' measurement-value--binary' : ''}`}>{reading.value ?? '—'}{reading.unit && <span>{reading.unit}</span>}</span></td><td className="measurement-detail">{reading.detail}</td>
  </tr>)}</tbody></table></div>
}
