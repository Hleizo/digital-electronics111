# BioScope

Biomedical ADC/DAC Oscilloscope — interactive analog acquisition and Approach 11 ADC conversion.

## Run locally

Use Node.js 20.19+ or 22.12+ (Node 24 also works).

```sh
npm install
npm run dev
```

Open the local address printed by Vite. For a production build, run `npm run build`; `npm run preview` serves that build. `npm run typecheck` checks TypeScript.

If Windows PowerShell blocks the `npm.ps1` script, use `npm.cmd install` and `npm.cmd run dev` instead. No execution-policy change is needed.

## Analog acquisition

Choose Simulation, select a waveform, and press Start above the analog graph or in Acquisition Controls. Pause freezes the acquisition clock, readouts, and trace. Resume continues without counting paused time. Reset acquisition clears history and elapsed time while keeping settings. Reset configuration also restores defaults. Settings reset on page reload.

The seven continuous-time models are sine, triangle, square, sawtooth/ramp, DC, synthetic ECG-like, and synthetic PPG-like. **ECG and PPG are educational synthetic signals, not actual patient measurements.** Voltage is evaluated at timestamps in seconds; it is never quantized or clamped. Amplitude means peak excursion for bipolar signals and pulse height for ECG/PPG. DC uses offset directly; its rotary potentiometer supports vertical pointer dragging, arrow keys, Page Up/Down, Home/End, and a voltage slider. Frequency, amplitude, and phase do not affect pure DC.

ECG is a defined 32-harmonic Fourier series of wrapped P/Q/R/S/T Gaussian pulses. PPG is a defined 16-harmonic series with systolic and reflected pulses. These finite series are the models themselves, with analytical Fourier coefficients. Optional reproducible noise adds 37, 61, and 89 Hz sine components weighted 0.5, 0.3, and 0.2; its peak magnitude cannot exceed the selected noise amplitude.

The green continuous trace is evaluated independently of the cyan raw sampled points. The sampling clock uses integer indices (`epoch + index / fs`) and works independently of requestAnimationFrame/display refresh. Changing sample rate starts a new sampling epoch at the current acquisition time; existing points retain their original timestamps. Changing the signal preserves prior trace segments and resets extrema for the new settings. There is no automatic restart when changing display scales.

Time scale spans ten horizontal divisions (0.02–1 s/div). Labels show time relative to the current/frozen acquisition endpoint, so the waveform scrolls left smoothly. Voltage scale spans four vertical divisions (0.1–2 V/div), centered on half the educational input maximum. Dashed lines mark the educational input range; out-of-range values remain intact, and warnings distinguish range and viewport overflow. Increase the voltage scale to see a trace outside the viewport.

The default educational range is 0–3.3 V. The 0–5 V setting is available in simulation only. **Never connect 5 V directly to an ESP32 input.** Selecting ESP32 clears acquisition, returns the configured maximum to 3.3 V, and disables acquisition; no hardware connection is made.

Nyquist (`fs/2`) warnings consider every modeled component, including ECG/PPG harmonics and noise. Ideal triangle, square, and ramp waveforms have infinitely many harmonics, so every finite sampling rate aliases their high-frequency tails. Components exactly at Nyquist also trigger a warning because phase can make them unobservable. DC has no nonzero signal frequency unless noise is enabled.

Readouts update about ten times per second; Canvas rendering follows requestAnimationFrame, targeting roughly 60 FPS on capable displays. Extrema are high-resolution numerical estimates of the analog model since Start/Reset or the last signal-parameter change, independent of the selected sample rate. A background-tab gap limits extrema catch-up to 8,192 evaluations. Raw-sample storage is fixed at 20,002 entries, covering up to ten seconds at 2,000 samples/s; only recent data is retained after a gap. Signal history is time-pruned and capped at 1,024 segments. Animation frames and resize observers are cleaned up on pause/unmount.

## Approach 11: ideal ADC conversion

The selected ADC converts the **latest captured raw sample**, not the instantaneous model value between sampling events. Readouts identify that sample's voltage and timestamp. The same captured timestamps feed the analog sampling points, selected-resolution code staircase, and simultaneous 4-bit/8-bit code and error plots. Pause freezes acquisition; ADC setting changes still recalculate those displayed raw samples without restarting the clock. Binary LEDs represent the actual selected code, MSB first, with exactly N indicators and N binary digits.

The uniform-bin transfer is explicitly:

```text
Levels = 2^N
Delta = Vref / Levels
Code = clamp(floor(Vin / Delta), 0, Levels - 1)
Vquantized = (Code + 0.5) * Delta
Error = Vin - Vquantized
```

Default N is 8 (256 levels, codes 0–255); 4-bit has 16 levels and codes 0–15. Vref defaults to 3.3 V; educational choices are 1, 2.5, 3.3, and 5 V. **ADC Vref is independent of the analog educational input range.** Lowering Vref does not change the original waveform, analog scale, amplitude/offset, sampling frequency or sample timestamps. The 5 V reference/range choices remain simulation only and do not imply hardware compatibility.

For `0 <= Vin < Vref`, signed quantization error is bounded approximately by `-Delta/2 <= Error <= Delta/2`. At 0 V, the code is 0 but its midpoint voltage is Delta/2, so error is -Delta/2. At or above Vref the code saturates at `Levels - 1`; below zero it saturates at 0. **Vin = Vref is explicitly flagged as high clipping**, even though its total conversion error is half an LSB.

The core returns raw input voltage, decimal/binary code, midpoint voltage, total conversion error, normal quantization error, absolute error, clipping classification, range excess, and range utilization. Normal quantization error is `null` when clipped; a separate overrange total-error readout reports `Vin - Vquantized`. Range excess is `Vin` below zero or `Vin - Vref` at/above reference. Range utilization is the unclamped `100 * Vin / Vref`, so out-of-range inputs can display negative percentages or more than 100%. The original analog values are never clamped before conversion.

Red staircase segments, clipping status, and highlighted sampled-input/error cards identify saturation. Error comparison plots use their own ±half-LSB scales and omit normal-error traces for clipped samples, marking those samples with red edge ticks. At the same Vref, 8-bit LSB and the worst-case normal error bound are 16 times smaller than 4-bit. A particular input can coincide with a 4-bit midpoint, so the 8-bit absolute error is not necessarily smaller for every individual voltage.

The educational table calculates representative inputs (including negative voltage, bin midpoints/edges, Vref, overrange, and the current sample) through the same ADC model. The displayed staircase is a **digital code visualization**. The midpoint equivalent voltage is a calculation within the ADC model, not a DAC reconstruction.

Selected-resolution rendering follows requestAnimationFrame; comparison plots refresh with the roughly 10 Hz readouts. Conversion uses bounded raw-sample storage from Prompt 2 and allocates no per-sample binary strings in plot rendering. When several samples occupy a single horizontal pixel, every sample is converted, while the drawn path retains first/minimum/maximum/last values with their real timestamps and preserves clipping transitions. Raw samples and readouts remain unchanged. There is no second sampling engine or converted-sample history that grows over time.

## Future stages

DAC reconstruction/smoothing and Bluetooth remain unimplemented. The DAC panel remains explicitly empty, its measured voltage uses an em dash, and device connection remains disabled. DAC method/smoothing controls remain configuration placeholders.

## Verification

`npm test` runs the numerical/sampling/buffering/ADC tests using Node 24 (no test dependencies). `npm run build` checks TypeScript and builds the application. Tests cover all waveforms, signal parameters, phase, DC, noise, harmonic aliasing, exact sampling across different display rates, sample-clock changes, configuration history, bounded storage/catch-up, ADC endpoints and bin transitions, monotonic codes, exact binary widths, midpoint errors and bounds, saturation, Vref changes, and raw sample/timestamp preservation.

## Source layout

- `src/components/`: reusable dashboard, Canvas panel, labels, legends, indicators, measurement cards, and controls.
- `src/core/signal/`: reusable pure signal models, spectrum metadata, raw-sample ring buffer, and timestamp-driven acquisition engine.
- `src/core/adc/`: pure uniform-bin ADC model and raw-sample conversion adapter.
- `src/core/dac/`: DAC interface only.
- `src/services/bluetooth/`: Bluetooth transport interface and availability flag only.
- `src/types/`: shared configuration, sample, and measurement types.
- `src/config/`: initial configuration, empty measurements, and plot window.
- `src/App.tsx`: dashboard composition and configuration state.
- `src/hooks/`: acquisition lifecycle and throttled measurement readouts.
- `src/components/oscilloscope/`: Canvas grid, analog/sample rendering, and digital code/error staircases.
- `src/components/adc/`: conversion pipeline, binary LEDs, calculated readouts, theory, resolution comparison, table, and scoped styling.
- `tests/`: numerical signal, acquisition, and ADC tests using Node's test runner.
- `src/styles.css`: responsive instrument theme and accessible interaction styling.

React, React DOM, TypeScript, Vite, and the official React Vite plugin are the only application/tooling dependencies. No backend or external font service is required.
