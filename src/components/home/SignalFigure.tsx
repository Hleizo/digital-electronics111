import { useEffect, useId, useRef } from 'react'
import type { RefObject } from 'react'
import { evaluateSignal } from '../../core/signal/model'
import { createAdcModel } from '../../core/adc'
import { createDacModel, rcLowPassStep } from '../../core/dac'
import type { SignalConfig } from '../../types'

// A labeled, independent educational illustration. It never supplies readings
// to the laboratory or changes its acquisition session or hardware source.
const signal: SignalConfig = { source: 'ecg', amplitude: 1.05, frequency: 1.2, offset: 1.35, phaseDegrees: 0, noiseAmplitude: 0 }
const fs = 100, duration = 2.4
const adc8 = createAdcModel({ resolution: 8, referenceVoltage: 3.3 })
const adc4 = createAdcModel({ resolution: 4, referenceVoltage: 3.3 })
const dac4 = createDacModel({ resolution: 4, referenceVoltage: 3.3 })
const ink = '#181C1D', green = '#30765D', digital = '#B36B38', blue = '#355DB0'

export function SignalFigure({ journey, progress }: { journey?: boolean; progress?: RefObject<number> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const readout = useRef<HTMLOutputElement>(null)
  const probe = useRef<number | null>(null)
  const id = useId()
  useEffect(() => {
    const node = canvas.current
    if (!node) return
    const context = node.getContext('2d')
    if (!context) return
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0, height = 0, frame = 0, visible = true, reduced = media.matches
    const origin = performance.now()
    let lastTimestamp = origin, lastReadout = -Infinity
    function draw(timestamp: number) {
      lastTimestamp = timestamp
      if (!width || !height || !context) return
      const time = reduced ? 4.8 : 4.8 + (timestamp - origin) / 1000 * .55
      const left = 40, top = 26, w = width - 60, h = height - 66
      const start = time - duration
      const x = (t: number) => left + (t - start) / duration * w
      const y = (v: number) => top + h - v / 3.3 * h
      const stage = journey ? progress?.current ?? 0 : 1
      const digitalAxis = journey && stage >= 1.75 && stage < 2.7
      const sampleOpacity = journey ? Math.min(1, Math.max(0, stage - .1)) : .45
      const codeOpacity = journey ? Math.min(1, Math.max(0, stage - 1)) : 0
      const outputOpacity = journey ? Math.min(1, Math.max(0, (stage - 2.7) / .3)) : 0
      const adc = journey ? adc4 : adc8
      context.clearRect(0, 0, width, height)
      context.font = '10px Consolas, monospace'
      context.lineWidth = .6
      for (let i = 0; i <= 24; i++) {
        context.strokeStyle = i % 4 === 0 ? '#D9DDD6' : '#E8EAE3'
        context.beginPath(); context.moveTo(left + i / 24 * w, top); context.lineTo(left + i / 24 * w, top + h); context.stroke()
      }
      for (let i = 0; i <= 8; i++) {
        context.strokeStyle = i % 2 === 0 ? '#D9DDD6' : '#E8EAE3'
        context.beginPath(); context.moveTo(left, top + i / 8 * h); context.lineTo(left + w, top + i / 8 * h); context.stroke()
      }
      context.fillStyle = '#707772'; context.textAlign = 'right'
      for (let i = 0; i <= 4; i++) context.fillText(digitalAxis ? String(Math.round(15 * (1 - i / 4))) : (3.3 - i * .825).toFixed(2), left - 9, top + i / 4 * h + 3)
      context.textAlign = 'left'; context.fillText(digitalAxis ? 'Code' : 'V', left, 12)
      for (let i = 0; i <= 6; i++) {
        context.textAlign = i === 0 ? 'left' : i === 6 ? 'right' : 'center'
        context.fillText((-duration + duration * i / 6).toFixed(1), left + w * i / 6, top + h + 19)
      }
      context.textAlign = 'right'; context.fillText('t / seconds', left + w, height - 4)
      context.save(); context.beginPath(); context.rect(left, top, w, h); context.clip()
      context.globalAlpha = 1 - codeOpacity
      context.strokeStyle = green; context.lineWidth = 1.65; context.beginPath()
      const count = Math.max(240, Math.min(900, Math.ceil(w * 1.4)))
      for (let i = 0; i <= count; i++) {
        const t = start + duration * i / count
        if (i) context.lineTo(x(t), y(evaluateSignal(signal, t)))
        else context.moveTo(x(t), y(evaluateSignal(signal, t)))
      }
      context.stroke()
      const first = Math.ceil(start * fs), last = Math.floor(time * fs)
      context.globalAlpha = sampleOpacity; context.fillStyle = digital
      for (let i = first; i <= last; i++) {
        const t = i / fs, raw = evaluateSignal(signal, t)
        const v = digitalAxis ? dac4.voltageForCode(adc4.codeFor(raw)) : raw
        context.beginPath(); context.arc(x(t), y(v), journey ? 1.6 : 1, 0, Math.PI * 2); context.fill()
      }
      const staircase = new Path2D(), filtered = new Path2D()
      let state = dac4.voltageForCode(adc4.codeFor(evaluateSignal(signal, first / fs)))
      for (let i = first; i <= last; i++) {
        const t = i / fs, end = Math.min(time, (i + 1) / fs)
        const v = dac4.voltageForCode(adc4.codeFor(evaluateSignal(signal, t)))
        if (i === first) { staircase.moveTo(x(t), y(v)); filtered.moveTo(x(t), y(state)) }
        else staircase.lineTo(x(t), y(v))
        staircase.lineTo(x(end), y(v))
        state = rcLowPassStep(state, v, 4, end - t)
        filtered.lineTo(x(end), y(state))
      }
      context.globalAlpha = codeOpacity * (1 - .5 * outputOpacity)
      context.strokeStyle = digital; context.lineWidth = 1.4; context.stroke(staircase)
      context.globalAlpha = outputOpacity; context.strokeStyle = blue; context.lineWidth = 2; context.stroke(filtered)
      const selectedTime = probe.current === null ? last / fs : Math.max(first, Math.min(last, Math.round((start + probe.current * duration) * fs))) / fs
      const voltage = evaluateSignal(signal, selectedTime), code = adc.convert(voltage)
      context.globalAlpha = 1; context.strokeStyle = ink; context.lineWidth = .65; context.setLineDash([3, 5])
      context.beginPath(); context.moveTo(x(selectedTime), top); context.lineTo(x(selectedTime), top + h); context.stroke(); context.setLineDash([])
      context.fillStyle = digitalAxis ? digital : green; context.beginPath(); context.arc(x(selectedTime), y(digitalAxis ? dac4.voltageForCode(code.code) : voltage), 3.2, 0, Math.PI * 2); context.fill()
      context.restore()
      if (readout.current && (timestamp - lastReadout > 100 || reduced || probe.current !== null)) {
        readout.current.textContent = `${voltage.toFixed(3)} V  →  ${code.binary}₂`
        lastReadout = timestamp
      }
    }
    function loop(timestamp: number) { frame = 0; draw(timestamp); if (visible && !reduced && !document.hidden) frame = requestAnimationFrame(loop) }
    function schedule() { if (!frame && visible && !reduced && !document.hidden) frame = requestAnimationFrame(loop) }
    function resize() {
      const bounds = node!.getBoundingClientRect(), ratio = window.devicePixelRatio || 1
      width = bounds.width; height = bounds.height
      node!.width = Math.round(width * ratio); node!.height = Math.round(height * ratio)
      context!.setTransform(ratio, 0, 0, ratio, 0, 0); draw(lastTimestamp)
    }
    function preference() { reduced = media.matches; cancelAnimationFrame(frame); frame = 0; draw(lastTimestamp); schedule() }
    const resizeObserver = new ResizeObserver(resize)
    const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (!visible) { cancelAnimationFrame(frame); frame = 0 } else { draw(lastTimestamp); schedule() } })
    const redraw = () => { draw(lastTimestamp); schedule() }
    resizeObserver.observe(node); intersection.observe(node)
    media.addEventListener('change', preference)
    document.addEventListener('visibilitychange', redraw)
    node.addEventListener('bioscope:probe', redraw)
    window.addEventListener('scroll', redraw, { passive: true })
    resize(); schedule()
    return () => { cancelAnimationFrame(frame); resizeObserver.disconnect(); intersection.disconnect(); media.removeEventListener('change', preference); document.removeEventListener('visibilitychange', redraw); node.removeEventListener('bioscope:probe', redraw); window.removeEventListener('scroll', redraw) }
  }, [journey, progress])
  return <figure className={`signal-figure${journey ? ' signal-figure--journey' : ''}`} aria-labelledby={id}>
    <div className="figure-heading"><span>{journey ? 'FIG. 02 / THE CONVERSION PATH' : 'FIG. 01 / A SIGNAL, OBSERVED'}</span><span>{journey ? '4 BIT' : '8 BIT'} · 100 Sa/s</span></div>
    <canvas ref={canvas} role="img" tabIndex={0} aria-label="Synthetic ECG educational illustration. Move over the waveform or use left and right arrows to inspect a computed sample. Not a patient measurement."
      onPointerMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); probe.current = Math.max(0, Math.min(1, (event.clientX - bounds.left - 40) / (bounds.width - 60))); event.currentTarget.dispatchEvent(new Event('bioscope:probe')) }}
      onPointerLeave={event => { probe.current = null; event.currentTarget.dispatchEvent(new Event('bioscope:probe')) }}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); probe.current = Math.max(0, Math.min(1, (probe.current ?? .5) + (event.key === 'ArrowLeft' ? -.02 : .02))) } else if (event.key === 'Escape') probe.current = null; event.currentTarget.dispatchEvent(new Event('bioscope:probe')) }} />
    <figcaption id={id}><span>Synthetic ECG · not patient data</span><output ref={readout} aria-live="off">Computed sample</output></figcaption>
    {!journey && <p className="figure-instruction">Move across the trace to read a sample <span>↗</span></p>}
  </figure>
}
