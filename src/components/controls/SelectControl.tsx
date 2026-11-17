import { useId } from 'react'

interface SelectControlProps<T extends string> {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}

export function SelectControl<T extends string>({ label, value, options, onChange, disabled }: SelectControlProps<T>) {
  const id = useId()
  return <div className="select-field"><label htmlFor={id}>{label}</label><select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value as T)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
}
