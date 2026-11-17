import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnalogAcquisition } from '../core/signal'
import type { AcquisitionStatus, DashboardConfig } from '../types'

export function useAnalogAcquisition(config: DashboardConfig) {
  const [engine] = useState(() => new AnalogAcquisition(config.signal, config.adc.samplingFrequency))
  const [status, setStatus] = useState<AcquisitionStatus>('idle')
  const [measurements, setMeasurements] = useState(() => engine.snapshot())
  const clock = useRef<{ origin: number; elapsed: number } | null>(null)

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

  useLayoutEffect(() => { reset() }, [config.mode, reset])

  useEffect(() => {
    if (status !== 'live' || config.mode !== 'simulation') return
    let frame: number
    let lastReadout = -Infinity
    const tick = (timestamp: number) => {
      if (!clock.current) clock.current = { origin: timestamp, elapsed: engine.elapsed }
      // An input event can occur just after the next rAF timestamp was captured.
      // Keep the simulation monotonic across that sub-frame clock difference.
      engine.advance(Math.max(engine.elapsed, clock.current.elapsed + (timestamp - clock.current.origin) / 1000))
      if (timestamp - lastReadout >= 100) {
        setMeasurements(engine.snapshot())
        lastReadout = timestamp
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
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

  return { engine, status, measurements, start, pause, reset }
}
