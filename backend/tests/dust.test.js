const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateDustDensity,
  classifyDustDensity,
  normalizeDustReading
} = require('../src/dust');
const { createConfig, normalizeConfigPatch } = require('../src/domain');

test('dust density classification uses configurable internal thresholds', () => {
  const thresholds = { moderate: 50, high: 150, dangerous: 300 };

  assert.equal(classifyDustDensity(0, thresholds), 'CLEAN');
  assert.equal(classifyDustDensity(49.9, thresholds), 'CLEAN');
  assert.equal(classifyDustDensity(50, thresholds), 'MODERATE');
  assert.equal(classifyDustDensity(150, thresholds), 'HIGH');
  assert.equal(classifyDustDensity(300, thresholds), 'DANGEROUS');
  assert.equal(classifyDustDensity(null, thresholds), 'UNKNOWN');
});

test('valid GP2Y analog reading is normalized without inventing PM values', () => {
  const config = createConfig();
  const reading = normalizeDustReading(
    {
      dust: {
        rawAdc: 1762,
        voltage: 1.42,
        density: 85.5,
        sensorOnline: true
      }
    },
    config,
    '2026-07-15T10:00:00.000Z'
  );

  assert.deepEqual(reading, {
    rawAdc: 1762,
    adcVoltage: 1.4199,
    voltage: 1.42,
    density: 85.5,
    unit: 'ug/m3',
    level: 'MODERATE',
    classification: 'INTERNAL_PROJECT_THRESHOLDS_NOT_AQI',
    disclaimer: 'Mật độ bụi ước tính – chỉ dùng cho mục đích học tập và theo dõi xu hướng.',
    sensorOnline: true,
    calibrated: false,
    lastUpdate: '2026-07-15T10:00:00.000Z',
    valid: true,
    abnormal: false,
    saturated: false,
    error: null
  });
  assert.equal('pm1' in reading, false);
  assert.equal('pm25' in reading, false);
  assert.equal('pm10' in reading, false);
});

test('dust voltage can be converted to a non-negative estimated density', () => {
  const config = createConfig({
    dustCalibration: {
      cleanAirVoltage: 0.9,
      sensitivity: 0.005,
      calibrationFactor: 1
    }
  });

  assert.equal(calculateDustDensity(0.5, config.dustCalibration), 0);
  assert.equal(calculateDustDensity(1.4, config.dustCalibration), 100);
  assert.equal(
    normalizeDustReading({ dust: { voltage: 1.4 } }, config).density,
    100
  );
});

test('negative density and out-of-range ADC readings are rejected', () => {
  const config = createConfig();

  assert.throws(
    () => normalizeDustReading({ dust: { density: -1 } }, config),
    /dust\.density must be between 0/
  );
  assert.throws(
    () => normalizeDustReading({ dust: { rawAdc: -1 } }, config),
    /dust\.rawAdc must be between 0/
  );
  assert.throws(
    () => normalizeDustReading({ dust: { rawAdc: 4096 } }, config),
    /dust\.rawAdc must be between 0 and 4095/
  );
  assert.throws(
    () => normalizeDustReading({ dust: { rawAdc: 12.5 } }, config),
    /must be an integer/
  );
});

test('missing online data is rejected while an explicit offline sensor is accepted', () => {
  const config = createConfig();

  assert.throws(
    () => normalizeDustReading({ dust: { sensorOnline: true } }, config),
    /is required when the sensor is online/
  );
  const offline = normalizeDustReading(
    { dust: { sensorOnline: false, error: 'DISCONNECTED' } },
    config,
    '2026-07-15T10:00:00.000Z'
  );
  assert.equal(offline.sensorOnline, false);
  assert.equal(offline.valid, false);
  assert.equal(offline.error, 'DISCONNECTED');
});

test('dust config validates threshold order and calibration ranges', () => {
  const config = createConfig();

  assert.throws(
    () => normalizeConfigPatch({
      dustThresholds: { moderate: 200, high: 100 }
    }, config),
    /moderate < high < dangerous/
  );
  assert.throws(
    () => normalizeConfigPatch({
      dustCalibration: { cleanAirVoltage: 5, maxSensorVoltage: 4.9 }
    }, config),
    /cannot exceed maxSensorVoltage/
  );

  const updated = normalizeConfigPatch({
    dustHighThreshold: 180,
    dustZeroVoltage: 0.85,
    dustSensitivity: 0.006,
    dustCalibrationFactor: 1.25,
    dustCalibrationOffset: 2,
    dustCalibrated: true
  }, config);
  assert.equal(updated.dustThresholds.high, 180);
  assert.equal(updated.dustCalibration.cleanAirVoltage, 0.85);
  assert.equal(updated.dustCalibration.sensitivity, 0.006);
  assert.equal(updated.dustCalibration.calibrationFactor, 1.25);
  assert.equal(updated.dustCalibration.offsetUgM3, 2);
  assert.equal(updated.dustCalibration.calibrated, true);
});

test('sensor voltage above 3.3 V is accepted only when divided ADC voltage is safe', () => {
  const config = createConfig();
  const reading = normalizeDustReading({
    dust: {
      rawAdc: 2500,
      adcVoltage: 2.01,
      voltage: 3.685,
      density: 557,
      sensorOnline: true
    }
  }, config);

  assert.equal(reading.adcVoltage, 2.01);
  assert.equal(reading.voltage, 3.685);
  assert.equal(reading.level, 'DANGEROUS');
  assert.throws(
    () => normalizeDustReading({
      dust: { adcVoltage: 3.31, voltage: 4, density: 600 }
    }, config),
    /dust\.adcVoltage must be between 0 and 3.3/
  );
});

test('ADC rail readings are retained as abnormal saturation events', () => {
  const config = createConfig();
  const lowRail = normalizeDustReading({
    dust: { rawAdc: 0, sensorOnline: true }
  }, config);
  const highRail = normalizeDustReading({
    dust: { rawAdc: 4095, sensorOnline: true }
  }, config);

  for (const reading of [lowRail, highRail]) {
    assert.equal(reading.valid, false);
    assert.equal(reading.abnormal, true);
    assert.equal(reading.saturated, true);
    assert.equal(reading.error, 'ADC_SATURATED');
    assert.equal(reading.level, 'UNKNOWN');
  }
});
