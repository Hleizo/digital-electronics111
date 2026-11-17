import { useEffect, useRef } from 'react'
import type { Accent } from '../types'
import { TIME_WINDOW_MS } from '../config/defaults'
import { GraphAxisLabel, GraphLegend } from './GraphLegend'
import type { AnalogAcquisition } from '../core/signal'
import type { AcquisitionStatus, ScopeConfig, SignalConfig } from '../types'
import type { ReactNode } from 'react'
import { drawAnalog, drawGrid } from './oscilloscope/draw'
import { drawAdc } from './oscilloscope/drawAdc'
import type { AdcModel } from '../core/adc'

export interface AdcPlotConfig {
  engine: AnalogAcquisition
  status: AcquisitionStatus
  model: AdcModel
  timePerDivision: number
  metric?: 'code' | 'error'
  animate?: boolean
  refreshTime?: number
}

interface OscilloscopePanelProps {
  channel: string
  title: string
  subtitle: string
  accent: Accent
  legend: string
  emptyLabel: string
  footer: string
  referenceVoltage: number
  analog?: { engine: AnalogAcquisition; status: AcquisitionStatus; scale: ScopeConfig; signalConfig: SignalConfig }
  controls?: ReactNode
  adc?: AdcPlotConfig
  details?: ReactNode
}

/** Shared instrument frame for analog/ADC traces and the future DAC placeholder. */
export function OscilloscopePanel({ channel, title, subtitle, accent, legend, emptyLabel, footer, referenceVoltage, analog, controls, adc, details }: OscilloscopePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const id = `panel-${channel}`

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let width = 0
    let height = 0
    let frame = 0
    const context = canvas.getContext('2d')
    if (!context) return
    const render = () => {
      drawGrid(context, width, height)
      if (analog) drawAnalog(context, width, height, analog.engine, analog.scale, referenceVoltage)
      if (adc) drawAdc(context, width, height, adc.engine, adc.model, 10 * adc.timePerDivision, adc.metric ?? 'code', accent === 'cyan' ? '#4ddbd1' : '#f0bd67')
    }
    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      width = bounds.width
      height = bounds.height
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(bounds.width * ratio)
      canvas.height = Math.round(bounds.height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      render()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    window.addEventListener('resize', resize)
    resize()
    if (analog?.status === 'live' || (adc?.status === 'live' && adc.animate !== false)) {
      const tick = () => { render(); frame = requestAnimationFrame(tick) }
      frame = requestAnimationFrame(tick)
    }
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', resize) }
  }, [analog?.engine, analog?.status, analog?.scale, analog?.signalConfig, referenceVoltage, footer, adc?.engine, adc?.status, adc?.model, adc?.timePerDivision, adc?.metric, adc?.animate, adc?.refreshTime, accent])

  const voltageMaximum = analog ? referenceVoltage / 2 + 2 * analog.scale.voltsPerDivision : referenceVoltage
  const voltageSpan = analog ? 4 * analog.scale.voltsPerDivision : referenceVoltage
  const timeWindow = analog ? analog.scale.timePerDivision * 10 : adc ? adc.timePerDivision * 10 : TIME_WINDOW_MS
  const status = analog?.status ?? adc?.status
  const hasSignal = status && status !== 'idle'
  const timeIsSeconds = !!(analog || adc)
  const metric = adc?.metric ?? 'code'
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(fraction => adc
    ? metric === 'code' ? String(Math.round((1 - fraction) * adc.model.maximumCode)) : ((adc.model.errorBound - fraction * adc.model.delta) * 1000).toFixed(3)
    : (voltageMaximum - fraction * voltageSpan).toFixed(2))

  return <section className={`scope-panel accent-${accent}`} aria-labelledby={id}>
    <div className="scope-heading"><div className="scope-title"><span className="channel-badge">{channel}</span><div><h3 id={id}>{title}</h3><p>{subtitle}</p></div></div><span className={`panel-state${hasSignal ? ' panel-state--active' : ''}`}>{hasSignal ? status.toUpperCase() : 'NO DATA'}</span></div>
    {controls}
    <div className="scope-plot">
      <GraphAxisLabel axis="voltage">{adc ? metric === 'code' ? 'Digital code' : 'Error (mV)' : 'Voltage (V)'}</GraphAxisLabel>
      <div className="voltage-ticks" aria-hidden="true">{ticks.map((tick, index) => <span key={index}>{tick}</span>)}</div>
      <div className={`plot-canvas${analog ? ' plot-canvas--analog' : adc ? ' plot-canvas--adc' : ''}`}><canvas ref={canvasRef} role="img" aria-label={analog ? `${title}: ${analog.status}, green continuous analog waveform with cyan unquantized sampled points. ${analog.scale.timePerDivision} seconds per division, ${analog.scale.voltsPerDivision} volts per division.` : adc ? `${title}: ${adc.status}, ${adc.model.resolution}-bit ${metric === 'code' ? `digital staircase, codes 0 to ${adc.model.maximumCode}` : `quantization error between plus/minus ${(adc.model.errorBound * 1000).toFixed(3)} mV`}. Time window ${timeWindow} seconds, synchronized with the analog input. Clipped samples are red.` : `${title}: empty voltage versus time grid, 0 to ${referenceVoltage} volts and 0 to ${TIME_WINDOW_MS} milliseconds. No samples available.`} />{!hasSignal && <div className="plot-empty"><span className="empty-crosshair" aria-hidden="true">+</span><span>{emptyLabel}</span></div>}</div>
      <div className="time-ticks" aria-hidden="true">{[0, 0.2, 0.4, 0.6, 0.8, 1].map(fraction => <span key={fraction}>{timeIsSeconds ? ((fraction - 1) * timeWindow).toFixed(2) : fraction * timeWindow}</span>)}</div>
      <GraphAxisLabel axis="time">{timeIsSeconds ? 'Time from present (s)' : 'Time (ms)'}</GraphAxisLabel>
    </div>
    <div className="scope-footer"><GraphLegend label={legend} accent={accent} />{analog && <GraphLegend label="Sampled points" accent="cyan" points />}{adc && <span className="clipped-legend"><span />Clipped</span>}<span>{footer}</span><span className="division-label">{analog ? `${analog.scale.timePerDivision} s/div · ${analog.scale.voltsPerDivision} V/div` : adc ? `${adc.timePerDivision} s/div` : `${TIME_WINDOW_MS / 10} ms/div`}</span></div>
    {details}
  </section>
}
