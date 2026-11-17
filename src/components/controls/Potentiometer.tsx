import { useRef } from 'react'
import { InputSlider } from './InputSlider'

export function Potentiometer({ value, maximum, onChange, disabled }: { value: number; maximum: number; onChange: (value: number) => void; disabled: boolean }) {
  const drag = useRef<{ y: number; value: number } | null>(null)
  const change = (voltage: number) => onChange(Math.round(Math.min(maximum, Math.max(0, voltage)) * 100) / 100)
  return <div className="potentiometer">
    <div className="potentiometer-dial" role="slider" tabIndex={disabled ? -1 : 0} aria-label="Virtual potentiometer" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={value} aria-valuetext={`${value.toFixed(2)} volts`} aria-disabled={disabled}
      onPointerDown={event => { if (disabled) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { y: event.clientY, value }; event.currentTarget.focus() }}
      onPointerMove={event => { if (drag.current && !disabled) change(drag.current.value + (drag.current.y - event.clientY) * maximum / 150) }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
      onKeyDown={event => {
        if (disabled) return
        const changes: Record<string, number> = { ArrowUp: value + 0.01, ArrowRight: value + 0.01, ArrowDown: value - 0.01, ArrowLeft: value - 0.01, PageUp: value + 0.1, PageDown: value - 0.1, Home: 0, End: maximum }
        if (event.key in changes) { event.preventDefault(); change(changes[event.key]) }
      }}><span style={{ transform: `rotate(${-135 + value / maximum * 270}deg)` }} /></div>
    <div className="potentiometer-setting"><InputSlider label="DC voltage" value={value} min={0} max={maximum} step={0.01} unit="V" onChange={onChange} disabled={disabled} /><p className="control-hint">Drag dial up/down or use arrow keys.</p></div>
  </div>
}
