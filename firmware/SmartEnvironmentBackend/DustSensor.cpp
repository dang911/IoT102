#include "DustSensor.h"

#include <math.h>

#include "Config.h"

using namespace ProjectConfig;

static_assert(DUST_MEDIAN_SAMPLES % 2 == 1,
              "Dust median filter requires an odd sample count");
static_assert(DUST_DIVIDER_RATIO > 0.0f && DUST_DIVIDER_RATIO < 1.0f,
              "Dust divider ratio must reduce the sensor voltage");

DustSensorState dustSensorState = {};

namespace {

DustCalibration calibration = {
    DEFAULT_DUST_ZERO_VOLTAGE,
    DEFAULT_DUST_SENSITIVITY_V_PER_UG_M3,
    DEFAULT_DUST_CALIBRATION_FACTOR,
    DEFAULT_DUST_CALIBRATION_OFFSET_UG_M3,
    DEFAULT_DUST_CALIBRATED,
};

DustRawReading sampleWindow[DUST_MEDIAN_SAMPLES] = {};
uint8_t sampleCount = 0;
uint8_t consecutiveInvalidBatches = 0;
uint32_t lastPulseStartUs = 0;

uint16_t medianRawAdc() {
  uint16_t sorted[DUST_MEDIAN_SAMPLES];
  for (uint8_t index = 0; index < DUST_MEDIAN_SAMPLES; ++index) {
    sorted[index] = sampleWindow[index].rawAdc;
  }

  for (uint8_t left = 1; left < DUST_MEDIAN_SAMPLES; ++left) {
    uint16_t value = sorted[left];
    int8_t right = left - 1;
    while (right >= 0 && sorted[right] > value) {
      sorted[right + 1] = sorted[right];
      --right;
    }
    sorted[right + 1] = value;
  }

  return sorted[DUST_MEDIAN_SAMPLES / 2];
}

DustRawReading readingFromRaw(uint16_t rawAdc, uint32_t sampledAtUs) {
  DustRawReading reading = {};
  reading.rawAdc = rawAdc;
  reading.adcVoltage =
      (static_cast<float>(rawAdc) / static_cast<float>(ADC_MAX_RAW)) *
      ADC_FULL_SCALE_VOLTAGE;
  reading.sensorVoltage = reading.adcVoltage / DUST_DIVIDER_RATIO;
  reading.sampledAtUs = sampledAtUs;
  reading.timingValid = true;
  return reading;
}

void markInvalidBatch(bool saturated) {
  ++dustSensorState.invalidReadings;
  dustSensorState.abnormal = true;
  dustSensorState.saturated = saturated;
  if (consecutiveInvalidBatches < UINT8_MAX) {
    ++consecutiveInvalidBatches;
  }
  if (dustSensorState.lastUpdateMs == 0 ||
      consecutiveInvalidBatches >= DUST_INVALID_BATCH_LIMIT) {
    dustSensorState.sensorOnline = false;
  }
}

}  // namespace

void initializeDustSensor() {
  pinMode(DUST_ANALOG_PIN, INPUT);
  pinMode(DUST_LED_PIN, OUTPUT_OPEN_DRAIN);
  // HIGH releases the open-drain output and keeps the optical LED off.
  digitalWrite(DUST_LED_PIN, HIGH);

  sampleCount = 0;
  consecutiveInvalidBatches = 0;
  lastPulseStartUs = micros() - DUST_CYCLE_US;
  dustSensorState = {};
  dustSensorState.calibrated = calibration.calibrated;
}

DustRawReading readDustVoltage() {
  DustRawReading reading = {};
  const uint32_t pulseStartedUs = micros();

  digitalWrite(DUST_LED_PIN, LOW);
  delayMicroseconds(DUST_SAMPLE_DELAY_US);

  const uint32_t sampledAtUs = micros();
  reading.rawAdc = analogRead(DUST_ANALOG_PIN);

  const uint32_t elapsedUs = micros() - pulseStartedUs;
  if (elapsedUs < DUST_LED_PULSE_US) {
    delayMicroseconds(DUST_LED_PULSE_US - elapsedUs);
  }
  digitalWrite(DUST_LED_PIN, HIGH);

  reading.adcVoltage =
      (static_cast<float>(reading.rawAdc) / static_cast<float>(ADC_MAX_RAW)) *
      ADC_FULL_SCALE_VOLTAGE;
  reading.sensorVoltage = reading.adcVoltage / DUST_DIVIDER_RATIO;
  reading.sampledAtUs = sampledAtUs;

  const uint32_t sampleOffsetUs = sampledAtUs - pulseStartedUs;
  reading.timingValid =
      sampleOffsetUs >= (DUST_SAMPLE_DELAY_US - 20) &&
      sampleOffsetUs <= (DUST_SAMPLE_DELAY_US + 60);
  return reading;
}

float calculateDustDensity(float sensorVoltage) {
  if (!isfinite(sensorVoltage) ||
      calibration.sensitivityVoltsPerUgM3 <= 0.0f) {
    return 0.0f;
  }

  const float deltaVoltage = sensorVoltage - calibration.zeroVoltage;
  float densityUgM3 = deltaVoltage / calibration.sensitivityVoltsPerUgM3;
  densityUgM3 = densityUgM3 * calibration.factor + calibration.offsetUgM3;

  if (!isfinite(densityUgM3) || densityUgM3 < 0.0f) {
    return 0.0f;
  }
  return densityUgM3;
}

bool validateDustReading(const DustRawReading& reading) {
  if (!reading.timingValid || !isfinite(reading.adcVoltage) ||
      !isfinite(reading.sensorVoltage)) {
    return false;
  }
  if (reading.rawAdc <= DUST_ADC_RAIL_LOW ||
      reading.rawAdc >= DUST_ADC_RAIL_HIGH) {
    return false;
  }
  if (reading.adcVoltage < 0.0f ||
      reading.adcVoltage > ADC_FULL_SCALE_VOLTAGE ||
      reading.sensorVoltage < 0.0f ||
      reading.sensorVoltage > DUST_SENSOR_MAX_VALID_VOLTAGE) {
    return false;
  }
  return true;
}

void updateDustSensor() {
  const uint32_t nowMs = millis();
  const uint32_t nowUs = micros();

  if (dustSensorState.sensorOnline &&
      static_cast<uint32_t>(nowMs - dustSensorState.lastUpdateMs) >
          DUST_STALE_TIMEOUT_MS) {
    dustSensorState.sensorOnline = false;
    dustSensorState.abnormal = true;
  }

  if (static_cast<uint32_t>(nowUs - lastPulseStartUs) < DUST_CYCLE_US) {
    return;
  }
  lastPulseStartUs = nowUs;

  sampleWindow[sampleCount++] = readDustVoltage();
  dustSensorState.lastAttemptMs = nowMs;
  if (sampleCount < DUST_MEDIAN_SAMPLES) {
    return;
  }

  uint8_t validSamples = 0;
  bool saturated = false;
  for (uint8_t index = 0; index < DUST_MEDIAN_SAMPLES; ++index) {
    if (validateDustReading(sampleWindow[index])) {
      ++validSamples;
    }
    if (sampleWindow[index].rawAdc <= DUST_ADC_RAIL_LOW ||
        sampleWindow[index].rawAdc >= DUST_ADC_RAIL_HIGH) {
      saturated = true;
    }
  }

  const uint16_t medianRaw = medianRawAdc();
  DustRawReading medianReading = readingFromRaw(medianRaw, nowUs);
  sampleCount = 0;

  if (validSamples < DUST_MIN_VALID_SAMPLES ||
      !validateDustReading(medianReading)) {
    markInvalidBatch(saturated);
    return;
  }

  const float density = calculateDustDensity(medianReading.sensorVoltage);
  if (!isfinite(density) || density > DUST_MAX_VALID_DENSITY_UG_M3) {
    markInvalidBatch(false);
    return;
  }

  dustSensorState.rawAdc = medianReading.rawAdc;
  dustSensorState.adcVoltage = medianReading.adcVoltage;
  dustSensorState.voltage = medianReading.sensorVoltage;
  dustSensorState.density = density;
  dustSensorState.sensorOnline = true;
  dustSensorState.abnormal = false;
  dustSensorState.saturated = false;
  dustSensorState.calibrated = calibration.calibrated;
  dustSensorState.lastUpdateMs = nowMs;
  ++dustSensorState.validReadings;
  consecutiveInvalidBatches = 0;
}

void setDustCalibration(const DustCalibration& newCalibration) {
  calibration = newCalibration;
  dustSensorState.calibrated = calibration.calibrated;
  if (dustSensorState.sensorOnline) {
    dustSensorState.density = calculateDustDensity(dustSensorState.voltage);
  }
}

const DustCalibration& getDustCalibration() {
  return calibration;
}
