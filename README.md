# BioScope

Biomedical ADC/DAC Oscilloscope for Approach 11 (sensor ADC) and Approach 12 (DAC reconstruction). React, TypeScript, Vite and Canvas; no backend. All displayed conversions use actual computed samples. ECG/PPG models are educational synthetic signals, not patient measurements.

## Install and start

Use Node.js 22.18+ or 24+ (Node 24 was used for validation).

```sh
npm install
npm run dev
```

Open the address printed by Vite. If PowerShell blocks `npm.ps1`, use `npm.cmd` instead of `npm`; no execution-policy change is needed. `npm run build` creates `dist/`, and `npm run preview` serves it locally.

## Simulation Mode

1. Choose **Simulation**, select sine, triangle, square, ramp, DC, ECG-like or PPG-like, then **Start**.
2. Adjust amplitude, frequency, offset, phase and optional reproducible noise. DC uses the virtual potentiometer/voltage slider; amplitude, phase and frequency do not affect pure DC.
3. Change sampling frequency independently of display refresh and ADC resolution. Green is the continuous model, cyan marks captured samples, amber shows ADC codes, and purple shows DAC zero-order hold. The optional filtered reconstruction is amber in the DAC panel.
4. Set time/voltage scales, ADC resolution/reference and filter cutoff. DAC settings follow ADC by default; independent settings show mismatch/overflow warnings. The comparisons use the same raw samples at 4 and 8 bits.
5. **Pause/Resume** freezes/continues all stages together. Acquisition **Reset** clears history; **Reset configuration** also restores settings. Settings reset on reload.

The default educational range is 0–3.3 V; 0–5 V is simulation only. Signals are never clamped before ADC conversion. Range/clipping and viewport overflow have separate warnings. Nyquist warnings include ECG's 32 harmonics, PPG's 16 harmonics and noise at 37/61/89 Hz. Ideal square, triangle and ramp have infinite harmonic tails and are never labeled perfectly band-limited. Equality with Nyquist also warns.

## ADC and DAC conventions

The ideal **ADC uses uniform bins with saturation**:

```text
Levels = 2^N
Delta = Vref / Levels
Code = clamp(floor(Vin / Delta), 0, Levels - 1)
Vquantized = (Code + 0.5) * Delta
ADC quantization error = sampled Vin - Vquantized
```

At 3.3 V, 8 bits gives 256 levels/codes 0–255 and Delta = **0.012890625 V = 12.890625 mV**. Four bits gives 16 levels/codes 0–15 and Delta = **0.20625 V**. For `0 <= Vin < Vref`, error lies approximately within ±Delta/2. Inputs below 0 or at/above Vref saturate and are flagged as clipped; their total conversion error is reported separately from normal quantization error. Utilization is unclamped `100 * Vin / Vref`.

The ideal **DAC uses endpoint mapping**, a different convention:

```text
MaximumCode = 2^N - 1
Vout = Code * Vref / MaximumCode
DAC increment = Vref / MaximumCode
```

Code 0 produces 0 V; maximum code produces Vref. A word too wide for a separately configured DAC saturates, with a warning. At the same reference, the ADC step ratio (4/8-bit) is 16; the DAC increment ratio is 17. An individual input can coincide with a 4-bit midpoint, so 8-bit absolute error need not improve at every single voltage.

The optional RC filter follows `yEnd = alpha*yStart + (1-alpha)*x`, with `alpha = exp(-2*pi*fc*dt)`. For uniform updates `dt = 1/fs`. Each captured code is held over its actual interval; the response inside that interval is evaluated continuously as `x + (yStart-x)*exp(-2*pi*fc*t)`. Initial state equals the first available output. Filter/settings edits recompute retained history; bypass does not restart acquisition.

**DAC reconstruction error** is `original(t) - reconstructed(t)` at the same acquisition time, including hold/filter lag. It differs from ADC midpoint error at a captured sample. RMS uses 2,048 uniform time-midpoint evaluations over the trailing **1 second**, shortened to available history; the actual window is shown. Filtering smooths transitions but cannot restore quantization/aliasing/clipping losses or increase resolution.

The R-2R schematic is educational. A conventional unloaded ladder gives `Vref * Code / 2^N`; endpoint mapping additionally normalizes gain by `2^N/(2^N-1)`. No physical ladder runs in the browser. Ideal models do not reproduce every hardware imperfection.

## ESP32 Live Mode

Use a Web Bluetooth capable browser, such as supported desktop Chrome/Edge, with Bluetooth enabled and **HTTPS or localhost**. Simulation works without Bluetooth; unsupported browsers receive an explanation and disabled Connect button. Browser/OS support varies; do not assume Firefox, Safari or iOS support.

1. Follow the [firmware build, upload, wiring and calibration guide](firmware/README.md). Target is the **original/classic ESP32 DevKit**, not S2/S3/C3/C6. Install Arduino-ESP32 3.3.11, select **ESP32 Dev Module**, open `firmware/BioScopeESP32/BioScopeESP32.ino`, select the board's serial port and upload.
2. Choose **ESP32**, press **Connect ESP32**, then choose **BioScope-ESP32**. Connection is explicit; no automatic chooser/reconnect. Incoming readings feed the existing educational ADC/DAC chain. Virtual signal controls are disabled.
3. Inspect raw counts, estimate provenance, receiving status, rates and loss diagnostics. Disconnect explicitly or return to Simulation to release BLE and clear source history.

**Safe wiring:** a 10 kΩ educational potentiometer between board 3.3 V and GND, wiper to **GPIO34 (ADC1)**. Never connect 5 V directly to ESP32 inputs. Follow board electrical limits; full potentiometer travel can exceed the ADC's accurately measurable range. Do not connect this prototype to patients/electrodes. Optional GPIO25 DAC is off by default and supports only a suitable high-impedance measurement input with common GND; see the hardware guide.

Firmware samples nominally at **100 samples/s**, 12-bit counts 0–4095, 11 dB attenuation, normally four samples per notification (~25 notifications/s). Browser rendering is separate. Internal ESP32 ADC reference is not a 3.3 V full-scale input reference. Available eFuse lookup calibration estimates voltage from the same raw reading; otherwise `raw/4095 * 3.1 V` is explicitly labeled **approximate**. Known incompatible device metadata rejects connection instead of assuming compatible timing/scaling.

The browser/parser/firmware share service UUID `9d2f0001-7d9a-4b6f-8c20-1a5d3e700001`; notify and metadata UUIDs replace `0001` with `0002` and `0003`. Exact notification payload:

| Bytes | Meaning |
| --- | --- |
| 0–1 | First sample sequence, uint16 little-endian |
| 2 | Sample count, 1–4 |
| 3 | Reserved flags, 0 |
| 4 onward | Count × uint16 little-endian raw readings |

Sequence position determines sample time, including wrap and missing slots. Gaps never receive invented samples. Duplicate, late, overlapping and malformed packets are handled explicitly. Gap events cannot uniquely identify lost notification counts; firmware acquisition overruns can also cause gaps. After an outage of at least 32,768 sample slots (~328 seconds), reconnect because ordering becomes ambiguous.

Hardware green lines guide between adjacent received estimates; they do not measure the continuous signal between samples. Stale input freezes. A latest-value display hold lasts at most one four-sample batch. Error/RMS comparisons use received held estimates and omit unknown gaps; they are not bench accuracy measurements. Browser reconstruction is software output, separate from optional physical GPIO25 output.

## Validation and limits

```sh
npm test
npm run typecheck
npm run build
```

The dependency-free Node suite covers signal generation, sampling/buffering, ADC/binary/clipping, DAC/filter/errors, shared frame ordering, BLE parsing/GATT lifecycle and hardware-source isolation. No lint tool/script is configured; whitespace can be checked with `git diff --check`.

With the dev server running, `npm run test:browser` runs headless Chrome/Edge checks for the controls, plots, math, responsiveness, bounded memory and **explicitly mocked** BLE. Set `BIOSCOPE_CHROME` to a browser executable or `BIOSCOPE_BASE_URL` to another local URL if needed. It uses debugger port 9336 and saves screenshots under `.qa/final-browser/`.

Samples and three reconstruction buffers have fixed capacity (20,002 records); source history is time-pruned and capped. One acquisition-first animation scheduler keeps all panels aligned, caches grids and stops on pause; readouts refresh around 10 Hz. Rendering targets ~60 FPS on capable hardware. Dense 20,000-point/filter/comparison views and background tabs can reduce refresh; sampling remains timestamp-based. Extrema and RMS are numerical estimates, not exact analytical or laboratory measurements.

Both firmware variants compile with Arduino-ESP32 3.3.11; details are in the hardware guide. **No physical ESP32 was connected or tested.** BLE radio operation, actual sampling jitter, voltage accuracy and GPIO25 output require the intended board and measurement equipment. No medical-use accuracy is claimed.

## Source layout

- `src/components/`: instrument UI, Canvas rendering, ADC/DAC education, hardware panel and controls.
- `src/core/signal/`, `src/core/adc/`, `src/core/dac/`: reusable signal/timing, quantization and reconstruction mathematics.
- `src/services/bluetooth/`: strict packet/calibration parser and typed GATT transport.
- `src/hooks/`, `src/utils/`: acquisition/readout lifecycles and shared frame scheduler.
- `src/types/`, `src/config/`: shared contracts and defaults.
- `tests/`, `firmware/`: automated checks and classic ESP32 reference sketch.
