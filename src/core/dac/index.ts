import type { AdcConfig, AdcSample, DacConfig, SignalSample } from '../../types'

/** Contract only. No reconstructed samples are produced in the dashboard shell. */
export interface DacReconstructor {
  reconstruct(samples: readonly AdcSample[], adc: AdcConfig, dac: DacConfig): SignalSample[]
}
