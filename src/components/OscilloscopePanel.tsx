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
import type { DacReconstruction } from '../core/dac/reconstruction'
import { drawDac } from './oscilloscope/drawDac'
import { subscribeFrame } from '../utils/frameLoop'

export interface DacPlotConfig {
  engine: AnalogAcquisition
  status: AcquisitionStatus
  trace: DacReconstruction
  scale: ScopeConfig
  settings: object
  referenceConfig?: SignalConfig
  animate?: boolean
  refreshTime?: number
}

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
  dac?: DacPlotConfig
}

/** Shared synchronized instrument frame for analog, ADC and DAC traces. */
export function OscilloscopePanel({ channel, title, subtitle, accent, legend, emptyLabel, footer, referenceVoltage, analog, controls, adc, details, dac }: OscilloscopePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const id = `panel-${channel}`

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let width = 0
    let height = 0
    let unsubscribe = () => {}
    const context = canvas.getContext('2d')
    if (!context) return
    const grid = document.createElement('canvas')
    const gridContext = grid.getContext('2d')
    let lastTime = NaN, lastSequence = -1, lastGeneration = -1
    const render = () => {
      if (!width || !height) return
      const engine = analog?.engine ?? adc?.engine ?? dac?.engine
      if (engine && engine.elapsed === lastTime && engine.samples.sequence === lastSequence && engine.samples.generation === lastGeneration) return
      if (engine) { lastTime = engine.elapsed; lastSequence = engine.samples.sequence; lastGeneration = engine.samples.generation }
      context.clearRect(0, 0, width, height)
      if (gridContext) context.drawImage(grid, 0, 0, width, height)
      else drawGrid(context, width, height)
      if (analog) drawAnalog(context, width, height, analog.engine, analog.scale, referenceVoltage)
      if (adc) drawAdc(context, width, height, adc.engine, adc.model, 10 * adc.timePerDivision, adc.metric ?? 'code', accent === 'cyan' ? '#4ddbd1' : '#f0bd67')
      if (dac) drawDac(context, width, height, dac.engine, dac.trace, dac.scale)
    }
    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      width = bounds.width
      height = bounds.height
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(bounds.width * ratio)
      canvas.height = Math.round(bounds.height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      grid.width = canvas.width; grid.height = canvas.height
      if (gridContext) { gridContext.setTransform(ratio, 0, 0, ratio, 0, 0); drawGrid(gridContext, width, height) }
      lastTime = NaN
      render()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    window.addEventListener('resize', resize)
    resize()
    if (analog?.status === 'live' || (adc?.status === 'live' && adc.animate !== false) || (dac?.status === 'live' && dac.animate !== false)) {
      unsubscribe = subscribeFrame(render)
    }
    return () => { unsubscribe(); observer.disconnect(); window.removeEventListener('resize', resize) }
  }, [analog?.engine, analog?.status, analog?.scale, analog?.signalConfig, referenceVoltage, footer, adc?.engine, adc?.status, adc?.model, adc?.timePerDivision, adc?.metric, adc?.animate, adc?.refreshTime, dac?.engine, dac?.status, dac?.trace, dac?.scale, dac?.settings, dac?.referenceConfig, dac?.animate, dac?.refreshTime, accent])

  const voltageScale = analog?.scale ?? dac?.scale
  const voltageMaximum = voltageScale ? referenceVoltage / 2 + 2 * voltageScale.voltsPerDivision : referenceVoltage
  const voltageSpan = voltageScale ? 4 * voltageScale.voltsPerDivision : referenceVoltage
  const timeWindow = voltageScale ? voltageScale.timePerDivision * 10 : adc ? adc.timePerDivision * 10 : TIME_WINDOW_MS
  const status = analog?.status ?? adc?.status ?? dac?.status
  const hasSignal = status && status !== 'idle'
  const timeIsSeconds = !!(analog || adc || dac)
  const metric = adc?.metric ?? 'code'
  const hardwareInput = analog?.engine.inputSource === 'hardware' || dac?.engine.inputSource === 'hardware'
  const description = analog
    ? `${title}: ${analog.status}, ${hardwareInput ? 'received voltage estimates joined only across adjacent samples' : 'continuous synthetic analog model'}, cyan captured sample points. ${analog.scale.timePerDivision} s/div, ${analog.scale.voltsPerDivision} V/div.`
    : adc ? `${title}: ${adc.status}, ${adc.model.resolution}-bit ${metric === 'code' ? `digital staircase, codes 0 to ${adc.model.maximumCode}` : `quantization error bounded by ${(adc.model.errorBound * 1000).toFixed(3)} mV for in-range inputs`}. Synchronized ${timeWindow}-second window. Clipping is red.`
    : dac ? `${title}: ${dac.status}, ${hardwareInput ? 'received voltage estimates' : 'original synthetic model'} green, captured ADC points cyan, calculated DAC staircase purple${dac.trace.enabled ? ', RC output amber' : ', filter bypassed'}. Same voltage and time scales as input.` : `${title}: empty voltage/time grid.`
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(fraction => adc
    ? metric === 'code' ? String(Math.round((1 - fraction) * adc.model.maximumCode)) : ((adc.model.errorBound - fraction * adc.model.delta) * 1000).toFixed(3)
    : (voltageMaximum - fraction * voltageSpan).toFixed(2))

  return <section className={`scope-panel accent-${accent}${dac ? ' scope-panel--dac' : ''}`} aria-labelledby={id} data-acquisition={status ?? 'idle'}>
    <div className="scope-heading"><div className="scope-title"><span className="channel-badge">{channel}</span><div><h3 id={id}>{title}</h3><p>{subtitle}</p></div></div><span className={`panel-state${hasSignal ? ' panel-state--active' : ''}`}>{hasSignal ? status.toUpperCase() : 'NO DATA'}</span></div>
    {controls}
    <div className="scope-plot">
      <GraphAxisLabel axis="voltage">{adc ? metric === 'code' ? 'Digital code' : 'Error (mV)' : 'Voltage (V)'}</GraphAxisLabel>
      <div className="voltage-ticks" aria-hidden="true">{ticks.map((tick, index) => <span key={index}>{tick}</span>)}</div>
      <div className={`plot-canvas${analog ? ' plot-canvas--analog' : adc ? ' plot-canvas--adc' : dac ? ' plot-canvas--dac' : ''}`}><canvas ref={canvasRef} role="img" aria-label={description} />{!hasSignal && <div className="plot-empty"><span className="empty-crosshair" aria-hidden="true">+</span><span>{emptyLabel}</span></div>}</div>
      <div className="time-ticks" aria-hidden="true">{[0, 0.2, 0.4, 0.6, 0.8, 1].map(fraction => <span key={fraction}>{timeIsSeconds ? ((fraction - 1) * timeWindow).toFixed(2) : fraction * timeWindow}</span>)}</div>
      <GraphAxisLabel axis="time">{timeIsSeconds ? 'Time from present (s)' : 'Time (ms)'}</GraphAxisLabel>
    </div>
    <div className="scope-footer"><GraphLegend label={legend} accent={accent} />{analog && <GraphLegend label="Sampled points" accent="cyan" points />}{dac && <><GraphLegend label="Original analog" accent="green" /><GraphLegend label="ADC samples" accent="cyan" points />{dac.trace.enabled && <GraphLegend label="RC filtered" accent="amber" />}</>}{adc && <span className="clipped-legend"><span />Clipped</span>}<span>{footer}</span><span className="division-label">{voltageScale ? `${voltageScale.timePerDivision} s/div · ${voltageScale.voltsPerDivision} V/div` : adc ? `${adc.timePerDivision} s/div` : `${TIME_WINDOW_MS / 10} ms/div`}</span></div>
    {details}
  </section>
}
