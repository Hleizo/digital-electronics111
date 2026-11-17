import type { DacModel } from '../../core/dac'
import type { DacResult } from '../../types'

export function R2rLadder({ model, result }: { model: DacModel; result: DacResult | null }) {
  return <section className="r2r-panel" aria-labelledby="r2r-title">
    <div className="adc-section-heading"><h3 id="r2r-title">R-2R ladder · educational circuit explanation</h3><p>Static conceptual schematic. The browser runs equations, not a physical resistor network.</p></div>
    <div className="r2r-schematic"><svg viewBox="0 0 900 310" role="img" aria-labelledby="r2r-svg-title r2r-svg-description"><title id="r2r-svg-title">Conceptual 4-bit voltage-mode R-2R ladder and buffer</title><desc id="r2r-svg-description">Four bit-controlled 2R branches are joined by R resistors. Each switch chooses reference or ground. A terminating 2R branch completes the ladder. The output node feeds an op-amp voltage follower, which drives an optional low-pass filter.</desc>
      <g fill="none" stroke="currentColor" strokeWidth="2">
        {[110, 230, 350, 470].map((x, index) => <g key={x}>
          {index < 3 && <><path d={`M${x} 120h30m60 0h30`} /><rect x={x + 30} y="110" width="60" height="20" /></>}
          <circle cx={x} cy="120" r="3" fill="currentColor" />
          <path d={`M${x} 120v25m0 60v20m0 0-18 20`} /><rect x={x - 10} y="145" width="20" height="60" />
          <circle cx={x - 18} cy="250" r="3" /><circle cx={x + 18} cy="250" r="3" />
        </g>)}
        <path d="M470 120h30m60 0h30v40m-12 0h24m-20 5h16m-12 5h8" /><rect x="500" y="110" width="60" height="20" />
        <path d="M110 120V35H645V90H670" />
        <path d="M670 50V110L730 80Z M730 80H802 M760 80V15H650V60H670 M877 80H892" />
        <rect x="802" y="65" width="75" height="30" rx="4" />
      </g>
      <g fill="currentColor" fontFamily="Consolas, monospace" fontSize="13">
        {[110, 230, 350, 470].map((x, index) => <g key={x}><text x={x + 50} y="100">{index < 3 ? 'R' : '2R'}</text><text x={x + 16} y="181">2R</text><text x={x - 36} y="277">Vref</text><text x={x + 5} y="277">GND</text><text x={x - 20} y="300">b{3 - index}{index === 0 ? ' MSB' : index === 3 ? ' LSB' : ''}</text></g>)}
        <text x="120" y="24">Vladder</text><text x="680" y="91">+</text><text x="680" y="63">−</text><text x="725" y="119">Buffer</text><text x="811" y="85">RC LPF</text><text x="605" y="192">R = 10 kΩ, 2R = 20 kΩ</text><text x="605" y="216">Illustrative values only</text>
      </g>
    </svg></div>
    <div className="r2r-explanation"><p>R and 2R form repeated 2:1 ratios. Bit switches select Vref or ground, producing binary-weighted contributions. A voltage follower isolates the ladder from its load. A low-pass filter reduces staircase transitions, with settling and phase lag. <a href="https://www.analog.com/media/en/training-seminars/tutorials/MT-015.pdf" target="_blank" rel="noreferrer">Analog Devices: binary DAC architectures</a>; <a href="https://www.analog.com/en/resources/analog-dialogue/articles/buffering-the-output-of-high-speed-dacs.html" target="_blank" rel="noreferrer">DAC output buffers</a>.</p>
      <p>A conventional unloaded voltage-mode ladder uses Vref × Code / 2^N. BioScope uses the requested endpoint mapping, Vref × Code / (2^N − 1), equivalent to a normalization gain of 2^N / (2^N − 1). The table below shows these normalized software-model contributions, not measured circuit voltages.</p>
    </div>
    <div className="adc-table-scroll" role="region" aria-label="Binary weighted DAC contributions" tabIndex={0}><table className="adc-table dac-bit-table"><caption>Endpoint-model bit contributions · sum = {result ? result.outputVoltage.toFixed(6) : '—'} V</caption><thead><tr><th scope="col">Bit</th><th scope="col">State</th><th scope="col">Normalized weight</th><th scope="col">Contribution (V)</th></tr></thead><tbody>{Array.from({ length: model.resolution }, (_, index) => {
      const bit = model.resolution - 1 - index
      const state = result ? (result.code >> bit) & 1 : null
      return <tr key={bit}><th scope="row">b{bit}{index === 0 ? ' · MSB' : bit === 0 ? ' · LSB' : ''}</th><td>{state ?? '—'}</td><td>{2 ** bit} / {model.maximumCode}</td><td>{state === null ? '—' : (state * 2 ** bit / model.maximumCode * model.referenceVoltage).toFixed(6)}</td></tr>
    })}</tbody></table></div>
  </section>
}
