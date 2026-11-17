import { useLayoutEffect, useMemo, useState } from 'react'
import type { AnalogAcquisition } from '../core/signal'
import type { AcquisitionStatus, DashboardConfig } from '../types'
import { resolveDacSettings } from '../core/dac'
import { DacReconstruction } from '../core/dac/reconstruction'
import { measureReconstruction } from '../core/dac/measurements'

export function useDacReconstruction(config: DashboardConfig, engine: AnalogAcquisition, elapsed: number, status: AcquisitionStatus) {
  const [trace] = useState(() => new DacReconstruction())
  const [comparisons] = useState(() => [new DacReconstruction(), new DacReconstruction()] as const)
  const settings = useMemo(() => resolveDacSettings(config.dac, config.adc), [config.dac, config.adc.resolution, config.adc.referenceVoltage])
  const [measurements, setMeasurements] = useState(() => measureReconstruction(engine, trace, elapsed))
  const [comparisonMeasurements, setComparisonMeasurements] = useState(() => comparisons.map(comparison => measureReconstruction(engine, comparison, elapsed)))

  useLayoutEffect(() => {
    trace.configure(config.adc, settings, config.dac.cutoffFrequency, config.dac.smoothing)
    trace.sync(engine.samples)
    setMeasurements(measureReconstruction(engine, trace, elapsed))
    setComparisonMeasurements(comparisons.map((comparison, index) => {
      const resolution = index === 0 ? 4 : 8
      comparison.configure({ resolution, referenceVoltage: config.adc.referenceVoltage }, { resolution, referenceVoltage: settings.referenceVoltage }, config.dac.cutoffFrequency, config.dac.smoothing)
      comparison.sync(engine.samples)
      return measureReconstruction(engine, comparison, elapsed)
    }))
  }, [trace, comparisons, engine, elapsed, status, settings, config.signal, config.adc.resolution, config.adc.referenceVoltage, config.dac.cutoffFrequency, config.dac.smoothing])

  return useMemo(() => ({ trace, settings, measurements, comparisons, comparisonMeasurements }), [trace, settings, measurements, comparisons, comparisonMeasurements])
}
