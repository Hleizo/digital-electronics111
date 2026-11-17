# BioScope ESP32 BLE reference firmware

Target: **classic/original ESP32 DevKit (ESP32-WROOM-32 class)**, not an ESP32-S2, S3, C3, C6, or another variant. The sketch deliberately rejects a different SoC at compile time. It uses the Espressif Arduino core's bundled BLE GATT library, not Bluetooth Classic Serial or an extra BLE dependency.

## Wiring

Use a safe educational potentiometer, for example 10 kΩ:

| Potentiometer terminal | Connect to |
| --- | --- |
| One outer terminal | Board 3.3 V |
| Other outer terminal | Board GND |
| Wiper | GPIO34 / ADC1 channel 6 |

Never connect 5 V directly to an ESP32 GPIO. Follow the actual board's ADC electrical limits. The 3.3 V supply connection does **not** promise that the ADC accurately measures the entire potentiometer travel: the high end can saturate, and the low end has limitations. Do not connect this prototype directly to a patient or medical electrodes.

## Build and upload

Open `BioScopeESP32/BioScopeESP32.ino` in Arduino IDE. Install **esp32 by Espressif Systems**, select **ESP32 Dev Module**, and choose the serial port belonging to the original ESP32 board. No external Arduino libraries are required. Reference core: **Arduino-ESP32 3.3.11**.

With Arduino CLI and that core installed, from the project directory:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 --build-path firmware/.build/default firmware/BioScopeESP32
arduino-cli upload --fqbn esp32:esp32:esp32 --port YOUR_SERIAL_PORT firmware/BioScopeESP32
arduino-cli monitor --port YOUR_SERIAL_PORT --config baudrate=115200
```

Select ESP32 mode in BioScope and press **Connect ESP32** in a supported browser. Choose **BioScope-ESP32**. The browser must subscribe to notifications to receive samples. On BLE disconnect the board restarts advertising; reconnect from the browser's explicit connection button.

## Sampling and packet protocol

ADC1 GPIO34 is read at a nominal **100 samples/s**, 12-bit raw counts **0–4095**, with Arduino `ADC_11db` attenuation (the corresponding current IDF enum is `ADC_ATTEN_DB_12`). Sampling uses `micros()` deadlines. Up to four contiguous readings are batched, so normal transmission is **25 notification requests/s**, at most 12 bytes each; a partial batch can be sent before a scheduler gap. Browser refresh rate is a separate quantity.

| Bytes | Type | Meaning |
| --- | --- | --- |
| 0–1 | uint16 little-endian | First sample sequence number |
| 2 | uint8 | Number of readings, 1–4 |
| 3 | uint8 | Reserved flags; currently 0 |
| 4 onward | uint16 little-endian per reading | Actual raw 12-bit ADC count |

Each reading increments the uint16 sequence, wrapping 65535 → 0. A connection starts a new sequence epoch. If acquisition misses a 10 ms slot, the firmware advances the sequence and sends no invented replacement reading. Packet-loss diagnostics in the browser can therefore include actual acquisition gaps as well as missed BLE data. Notifications are unacknowledged; the firmware's serial `notifyCalls` count is not a delivery guarantee. All data fits the default BLE notification payload; no large-MTU assumption is needed.

The UUID constants match the browser:

- Service: `9d2f0001-7d9a-4b6f-8c20-1a5d3e700001`
- Notify data: `9d2f0002-7d9a-4b6f-8c20-1a5d3e700001`
- Read-only calibration metadata: `9d2f0003-7d9a-4b6f-8c20-1a5d3e700001`

## Calibration and voltage estimates

The original ESP32's internal ADC reference is nominally around **1.1 V**, varies between chips, and is distinct from the input range after attenuation. It is not a 3.3 V reference. Espressif's Arduino ADC documentation lists an approximate measurable range of **150–3100 mV** for the original ESP32 at 11 dB; this is not a pin-safety rating or a guarantee of linear accuracy throughout that range. See the [Arduino ADC API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html).

When eFuse two-point or Vref calibration exists, the sketch creates an ESP-IDF line-fitting calibration handle for ADC1, the configured attenuation and 12-bit width. It produces 17 raw-to-millivolt knots with `adc_cali_raw_to_voltage()` and exposes them in the read-only metadata characteristic. The browser interpolates these knots. This conversion characterizes the **same raw reading**; it never pairs a second ADC measurement with a different raw sample. Factory calibration and knot interpolation still have noise, nonlinearity, attenuation and endpoint limitations; they are not laboratory calibration. See [Espressif's ADC calibration driver](https://docs.espressif.com/projects/esp-idf/en/v5.5.2/esp32/api-reference/peripherals/adc_calibration.html).

If usable eFuse calibration is absent, metadata explicitly sets `calibrated:false`. The approximate fallback is `raw / 4095 × 3.1 V`, labelled approximate in the browser. The sketch does not falsely mark a guessed 1.1 V default reference as factory calibration.

Metadata is UTF-8 JSON, at most 512 bytes:

```json
{"version":1,"sampleRateHz":100,"rawBits":12,"adcPin":34,"attenuationDb":11,"calibrated":false,"source":"Approximate 11dB raw scaling","points":[]}
```

For calibrated devices `points` contains 17 `[raw,millivolts]` pairs, monotonically increasing raw coordinates from 0 to 4095. The original raw value remains available for diagnostics, separately from BioScope's educational 4-bit or 8-bit encoding.

## Optional physical DAC output

Default: **OFF**. On this original ESP32 only, compile with `BIOSCOPE_ENABLE_PHYSICAL_DAC=1` to send `raw >> 4` to its native 8-bit GPIO25 DAC on each real acquisition update. Example:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 --build-property "build.extra_flags=-DBIOSCOPE_ENABLE_PHYSICAL_DAC=1" --build-path firmware/.build/physical-dac firmware/BioScopeESP32
```

Connect GPIO25 only to an appropriate **high-impedance measurement input**, with common GND. Do not drive a speaker, actuator, low-impedance load, or patient connection directly. Output is the board's actual native DAC voltage, within its supported range, with real offset/gain/load limitations. The browser's endpoint-mapped DAC and RC reconstruction are **calculated software waveforms**, not measurements of GPIO25 and not commands sent back to that pin. GPIO25 output is unavailable on many ESP32 variants; this sketch's original-ESP32 and DAC-capability guards prevent silently substituting an incompatible board. See the [Espressif Arduino DAC API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/dac.html).

## Verification boundary

Both configurations compiled successfully with **Arduino CLI 1.5.1**, **Arduino-ESP32 3.3.11**, target **`esp32:esp32:esp32`** (ESP32 Dev Module, default 4 MB flash/partition settings):

| Configuration | Program storage | Global variables |
| --- | --- | --- |
| Default, physical DAC OFF | 1,105,395 / 1,310,720 bytes (84%) | 41,444 / 327,680 bytes (12%) |
| `BIOSCOPE_ENABLE_PHYSICAL_DAC=1` | 1,132,871 / 1,310,720 bytes (86%) | 41,524 / 327,680 bytes (12%) |

The exact compile commands are shown above. Build artifacts remain ignored under `firmware/.build/`. **No physical ESP32 was connected, uploaded to, or tested.** BLE radio connectivity, actual sampling jitter, ADC voltage accuracy, and physical GPIO25 voltage still require the intended board and measurement equipment.
