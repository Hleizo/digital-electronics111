/* BioScope reference hardware: original/classic ESP32 DevKit only.
 * Arduino-ESP32 3.3.11, BLE GATT notifications, ADC1 GPIO34, 100 samples/s.
 * No Bluetooth Classic Serial, Wi-Fi, backend, or patient-connected input.
 */
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <atomic>
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "soc/soc_caps.h"

#if !CONFIG_IDF_TARGET_ESP32
#error "BioScope reference firmware requires the original ESP32 chip, not ESP32-S2/S3/C3/etc."
#endif

// Optional physical GPIO25 output. Leave OFF unless the intended original
// ESP32 board supports this DAC and a suitable high-impedance load is attached.
#ifndef BIOSCOPE_ENABLE_PHYSICAL_DAC
#define BIOSCOPE_ENABLE_PHYSICAL_DAC 0
#endif
#if BIOSCOPE_ENABLE_PHYSICAL_DAC && (!SOC_DAC_SUPPORTED || SOC_DAC_CHAN_NUM < 1)
#error "Physical DAC output requested on an incompatible SoC."
#endif

namespace BioScope {
constexpr char DEVICE_NAME[] = "BioScope-ESP32";
constexpr char SERVICE_UUID[] = "9d2f0001-7d9a-4b6f-8c20-1a5d3e700001";
constexpr char DATA_UUID[] = "9d2f0002-7d9a-4b6f-8c20-1a5d3e700001";
constexpr char METADATA_UUID[] = "9d2f0003-7d9a-4b6f-8c20-1a5d3e700001";
constexpr uint8_t ADC_PIN = 34;  // ADC1 channel 6 on the original ESP32.
constexpr uint8_t DAC_PIN = 25;  // Native DAC channel 1, original ESP32 only.
constexpr uint16_t RAW_MAX = 4095;
constexpr uint32_t SAMPLE_RATE_HZ = 100;
constexpr uint32_t SAMPLE_INTERVAL_US = 1000000UL / SAMPLE_RATE_HZ;
constexpr uint8_t BATCH_SIZE = 4;

BLECharacteristic *dataCharacteristic = nullptr;
adc_cali_handle_t calibration = nullptr;
bool hasEfuseCalibration = false;
const char *calibrationSource = "Approximate 11dB raw scaling";
std::atomic<bool> connected{false};
std::atomic<bool> connectPending{false};
std::atomic<bool> disconnectPending{false};
uint32_t nextSampleAt = 0;
uint16_t nextSequence = 0;
uint16_t batchFirstSequence = 0;
uint16_t batch[BATCH_SIZE] = {};
uint8_t batchCount = 0;
uint16_t lastRaw = 0;
uint32_t acquired = 0;
uint32_t notificationCalls = 0;
uint32_t skippedSlots = 0;
uint32_t lastDiagnosticAt = 0;
uint32_t restartAdvertisingAt = 0;
bool advertisingRestartScheduled = false;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    connected.store(true);
    connectPending.store(true);
  }
  void onDisconnect(BLEServer *) override {
    connected.store(false);
    disconnectPending.store(true);
  }
};

// Convert THIS raw ADC count through the eFuse characterization; do not take a
// second analogReadMilliVolts() sample and pair it with a different raw reading.
int millivoltsForRaw(uint16_t raw) {
  if (hasEfuseCalibration) {
    int millivolts = 0;
    if (adc_cali_raw_to_voltage(calibration, raw, &millivolts) == ESP_OK) {
      return max(0, millivolts);
    }
  }
  // Deliberately approximate attenuation-dependent input scaling, NOT the
  // ESP32's internal ADC Vref and NOT a claim of a 3.3 V full-scale ADC.
  return static_cast<int>((static_cast<uint32_t>(raw) * 3100UL + RAW_MAX / 2) / RAW_MAX);
}

void initializeCalibration() {
  adc_cali_line_fitting_efuse_val_t value;
  const esp_err_t checked = adc_cali_scheme_line_fitting_check_efuse(&value);
  if (checked != ESP_OK || value == ADC_CALI_LINE_FITTING_EFUSE_VAL_DEFAULT_VREF) {
    Serial.println("No usable factory eFuse calibration: browser voltage is APPROXIMATE.");
    return;
  }
  adc_cali_line_fitting_config_t config = {};
  config.unit_id = ADC_UNIT_1;
  config.atten = ADC_ATTEN_DB_12; // Current IDF name; Arduino ADC_11db maps here.
  config.bitwidth = ADC_BITWIDTH_12;
  config.default_vref = 0; // We do not mark a guessed default reference calibrated.
  if (adc_cali_create_scheme_line_fitting(&config, &calibration) != ESP_OK) {
    Serial.println("Calibration handle unavailable: browser voltage is APPROXIMATE.");
    return;
  }
  hasEfuseCalibration = true;
  calibrationSource = value == ADC_CALI_LINE_FITTING_EFUSE_VAL_EFUSE_TP
    ? "eFuse two-point LUT" : "eFuse Vref LUT";
  Serial.printf("Factory ADC calibration: %s (17-knot interpolation in browser).\n", calibrationSource);
}

String calibrationMetadata() {
  String metadata;
  metadata.reserve(500);
  metadata = "{\"version\":1,\"sampleRateHz\":100,\"rawBits\":12,\"adcPin\":34,\"attenuationDb\":11,\"calibrated\":";
  metadata += hasEfuseCalibration ? "true" : "false";
  metadata += ",\"source\":\"";
  metadata += calibrationSource;
  metadata += "\",\"points\":[";
  if (hasEfuseCalibration) {
    // Compact monotonic raw coordinates, covering the entire raw code space.
    // Voltage accuracy still has ADC/calibration/LUT/attenuation limitations.
    for (uint8_t i = 0; i <= 16; i++) {
      const uint16_t raw = static_cast<uint32_t>(i) * RAW_MAX / 16;
      int millivolts = 0;
      if (adc_cali_raw_to_voltage(calibration, raw, &millivolts) != ESP_OK) {
        hasEfuseCalibration = false;
        calibrationSource = "Approximate 11dB raw scaling";
        Serial.println("Calibration conversion failed; publishing approximate metadata instead.");
        return calibrationMetadata();
      }
      if (i) metadata += ',';
      metadata += '[';
      metadata += raw;
      metadata += ',';
      metadata += max(0, millivolts);
      metadata += ']';
    }
  }
  metadata += "]}";
  // GATT characteristic values cannot exceed 512 bytes. The fixed schema and
  // 17 knots fit; fail honestly rather than publishing truncated calibration.
  if (metadata.length() > 512) {
    Serial.println("Metadata overflow: falling back to raw-only voltage estimates.");
    hasEfuseCalibration = false;
    calibrationSource = "Approximate 11dB raw scaling";
    return calibrationMetadata();
  }
  return metadata;
}

void sendBatch() {
  if (batchCount == 0) return;
  if (connected.load()) {
    uint8_t packet[4 + 2 * BATCH_SIZE];
    packet[0] = static_cast<uint8_t>(batchFirstSequence & 0xff);
    packet[1] = static_cast<uint8_t>(batchFirstSequence >> 8);
    packet[2] = batchCount;
    packet[3] = 0; // All flags reserved. Raw values always remain raw uint16 LE.
    for (uint8_t i = 0; i < batchCount; i++) {
      packet[4 + 2 * i] = static_cast<uint8_t>(batch[i] & 0xff);
      packet[5 + 2 * i] = static_cast<uint8_t>(batch[i] >> 8);
    }
    dataCharacteristic->setValue(packet, 4 + 2 * batchCount);
    dataCharacteristic->notify();
    notificationCalls++; // Notification request, not an over-the-air ACK.
  }
  batchCount = 0;
}

void sampleIfDue() {
  const uint32_t now = micros();
  if (static_cast<int32_t>(now - nextSampleAt) < 0) return;
  const uint32_t lateSlots = (now - nextSampleAt) / SAMPLE_INTERVAL_US;
  if (lateSlots > 0) {
    // Do not manufacture readings to catch up. Flush a contiguous partial batch
    // and leave sequence-number gaps for slots missed by the actual scheduler.
    sendBatch();
    nextSequence = static_cast<uint16_t>(nextSequence + lateSlots);
    skippedSlots += lateSlots;
    nextSampleAt += lateSlots * SAMPLE_INTERVAL_US;
  }
  lastRaw = min(static_cast<uint16_t>(analogRead(ADC_PIN)), RAW_MAX);
  if (batchCount == 0) batchFirstSequence = nextSequence;
  batch[batchCount++] = lastRaw;
  nextSequence++; // uint16 rollover is part of the browser/firmware protocol.
  nextSampleAt += SAMPLE_INTERVAL_US;
  acquired++;
#if BIOSCOPE_ENABLE_PHYSICAL_DAC
  // Native 8-bit DAC: floor(raw/4096 * 256) == raw >> 4. This physical transfer
  // is not the browser's endpoint-mapped ideal DAC voltage or its RC filter.
  dacWrite(DAC_PIN, static_cast<uint8_t>(lastRaw >> 4));
#endif
  if (batchCount == BATCH_SIZE) sendBatch();
}
} // namespace BioScope

void setup() {
  using namespace BioScope;
  Serial.begin(115200);
  Serial.println("\nBioScope original-ESP32 BLE ADC reference firmware");
  Serial.println("GPIO34 ADC1, raw12-bit, 100 samples/s, 4 samples/notification.");
  pinMode(ADC_PIN, INPUT);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  initializeCalibration();

  BLEDevice::init(DEVICE_NAME);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService *service = server->createService(SERVICE_UUID);
  dataCharacteristic = service->createCharacteristic(DATA_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  dataCharacteristic->addDescriptor(new BLE2902());
  BLECharacteristic *metadata = service->createCharacteristic(METADATA_UUID, BLECharacteristic::PROPERTY_READ);
  const String metadataValue = calibrationMetadata();
  metadata->setValue(metadataValue);
  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true); // Service UUID and recognizable name fit across ADV/scan response.
  BLEDevice::startAdvertising();
  nextSampleAt = micros() + SAMPLE_INTERVAL_US;
  Serial.printf("Advertising %s. Calibration metadata: %u bytes.\n", DEVICE_NAME, metadataValue.length());
  Serial.println(BIOSCOPE_ENABLE_PHYSICAL_DAC ? "Physical GPIO25 DAC ENABLED." : "Physical GPIO25 DAC disabled (browser DAC remains calculated software).");
}

void loop() {
  using namespace BioScope;
  if (disconnectPending.exchange(false)) {
    batchCount = 0;
    restartAdvertisingAt = millis() + 100;
    advertisingRestartScheduled = true;
    Serial.println("BLE disconnected; restarting advertising without a blocking delay.");
  }
  if (connectPending.exchange(false) && connected.load()) {
    batchCount = 0;
    nextSequence = 0;
    nextSampleAt = micros() + SAMPLE_INTERVAL_US;
    advertisingRestartScheduled = false;
    Serial.println("BLE client connected; new sample-sequence epoch starts at zero.");
  }
  if (advertisingRestartScheduled && !connected.load() && static_cast<int32_t>(millis() - restartAdvertisingAt) >= 0) {
    BLEDevice::startAdvertising();
    advertisingRestartScheduled = false;
    Serial.println("Advertising BioScope-ESP32 again.");
  }
  sampleIfDue();
  const uint32_t now = millis();
  if (now - lastDiagnosticAt >= 1000) {
    lastDiagnosticAt = now;
    Serial.printf("BLE=%s raw=%u estimate=%d mV (%s) samples=%lu notifyCalls=%lu skippedSlots=%lu\n",
      connected.load() ? "connected" : "disconnected", lastRaw, millivoltsForRaw(lastRaw),
      hasEfuseCalibration ? calibrationSource : "APPROXIMATE", static_cast<unsigned long>(acquired),
      static_cast<unsigned long>(notificationCalls), static_cast<unsigned long>(skippedSlots));
  }
  // A single RTOS tick yields CPU to BLE/idle tasks; sample deadlines are set by
  // micros(), not by a per-sample sleep or by notification/render frequency.
  vTaskDelay(1);
}
