import { useId, useState } from 'react'

interface InputSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (value: number) => void
  disabled?: boolean
}

export function InputSlider({ label, value, min, max, step, unit, onChange, disabled = false }: InputSliderProps) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const invalid = draft !== null && (draft.trim() === '' || !Number.isFinite(Number(draft)) || Number(draft) < min || Number(draft) > max)
  return <div className="slider-field">
    <div className="field-heading"><label htmlFor={id}>{label}</label><div className="numeric-entry">
      <input type="number" aria-label={`${label} value`} min={min} max={max} step="any" value={draft ?? String(value)} disabled={disabled} aria-invalid={invalid} title={`${min}–${max} ${unit}. Enter a value or adjust the slider.`}
        onFocus={() => setDraft(String(value))}
        onChange={event => {
          setDraft(event.target.value)
          const next = event.target.valueAsNumber
          if (Number.isFinite(next) && next >= min && next <= max) onChange(next)
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur() }} />
      <span>{unit}</span>
    </div></div>
    <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} aria-valuetext={`${value} ${unit}`} />
    <div className="range-limits" aria-hidden="true"><span>{min} {unit}</span><span>{max} {unit}</span></div>
    {invalid && <p className="input-error" role="status">Enter {min}–{max} {unit}. The last valid setting is retained.</p>}
  </div>
}
