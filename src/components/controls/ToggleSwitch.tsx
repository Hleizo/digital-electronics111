import { useId } from 'react'

export function ToggleSwitch({ label, checked, onChange, description }: { label: string; checked: boolean; onChange: (value: boolean) => void; description?: string }) {
  const id = useId()
  return <div className="toggle-field"><div><label htmlFor={id}>{label}</label>{description && <p>{description}</p>}</div><button id={id} className="toggle" type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button></div>
}
