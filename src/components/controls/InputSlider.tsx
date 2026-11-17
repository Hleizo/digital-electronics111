import { useId } from 'react'

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
  return <div className="slider-field">
    <div className="field-heading"><label htmlFor={id}>{label}</label><output htmlFor={id}>{value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)} <span>{unit}</span></output></div>
    <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} aria-valuetext={`${value} ${unit}`} />
    <div className="range-limits" aria-hidden="true"><span>{min} {unit}</span><span>{max} {unit}</span></div>
  </div>
}
