import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnalogAcquisition } from '../core/signal'
import type { AcquisitionStatus, DashboardConfig } from '../types'
import type { Esp32Bluetooth, HardwareStatus } from '../services/bluetooth'
import { subscribeFrame } from '../utils/frameLoop'

export function useAnalogAcquisition(config: DashboardConfig, bluetooth?: Esp32Bluetooth, hardware?: HardwareStatus) {
  const [engine] = useState(() => new AnalogAcquisition(config.signal, config.adc.samplingFrequency))
  const [status, setStatus] = useState<AcquisitionStatus>('idle')
  const [measurements, setMeasurements] = useState(() => engine.snapshot())
  const clock = useRef<{ origin: number; elapsed: number } | null>(null)
  const packetArrival = useRef(0)
  const [renderFps, setRenderFps] = useState(0)

  useLayoutEffect(() => {
    engine.configure(config.signal, config.adc.samplingFrequency)
    setMeasurements(engine.snapshot())
  }, [engine, config.signal, config.adc.samplingFrequency])

  const reset = useCallback(() => {
    clock.current = null
    engine.reset()
    setMeasurements(engine.snapshot())
    setStatus('idle')
  }, [engine])

  useLayoutEffect(() => { reset(); engine.setInputSource(config.mode === 'esp32' ? 'hardware' : 'simulation') }, [config.mode, reset, engine])

  useEffect(() => {
    if (config.mode !== 'esp32' || !bluetooth) return
    return bluetooth.onSamples(samples => {
      if (engine.inputSource !== 'hardware') return
      engine.ingestHardware(samples, bluetooth.snapshot().hardwareSampleRate)
      packetArrival.current = performance.now()
      setStatus('live')
    })
  }, [config.mode, bluetooth, engine])

  useEffect(() => {
    if (config.mode === 'esp32' && hardware?.status !== 'connected') setStatus(engine.active ? 'paused' : 'idle')
  }, [config.mode, hardware?.status, engine])

  useEffect(() => {
    if (status !== 'live') { setRenderFps(0); return }
    let lastReadout = -Infinity
    let frameStart = performance.now(), frames = 0
    const tick = (timestamp: number) => {
      if (config.mode === 'esp32') {
        if (timestamp - packetArrival.current > 1000) { setStatus('paused'); setMeasurements(engine.snapshot()); return }
        engine.advanceHardwareDisplay(engine.hardwareLatestTime + Math.max(0, timestamp - packetArrival.current) / 1000)
      } else {
        if (!clock.current) clock.current = { origin: timestamp, elapsed: engine.elapsed }
        // An input event can occur just after the next rAF timestamp was captured.
        engine.advance(Math.max(engine.elapsed, clock.current.elapsed + (timestamp - clock.current.origin) / 1000))
      }
      frames++
      if (timestamp - frameStart >= 1000) { setRenderFps(frames * 1000 / (timestamp - frameStart)); frames = 0; frameStart = timestamp }
      if (timestamp - lastReadout >= 100) {
        setMeasurements(engine.snapshot())
        lastReadout = timestamp
      }
    }
    return subscribeFrame(tick, 'acquire')
  }, [engine, status, config.mode])

  function start() {
    if (config.mode !== 'simulation' || status === 'live') return
    clock.current = { origin: performance.now(), elapsed: engine.elapsed }
    engine.advance(engine.elapsed)
    setMeasurements(engine.snapshot())
    setStatus('live')
  }

  function pause() {
    if (status !== 'live') return
    if (clock.current) engine.advance(clock.current.elapsed + (performance.now() - clock.current.origin) / 1000)
    clock.current = null
    setMeasurements(engine.snapshot())
    setStatus('paused')
  }

  return { engine, status, measurements, start, pause, reset, renderFps }
}
