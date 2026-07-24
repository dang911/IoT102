const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNotificationCandidates } = require('../src/notifications');
const { createConfig } = require('../src/domain');

test('notification candidates cover temperature, light, motion and connection', () => {
  const status = {
    temperature: 40,
    lightLevel: 100,
    source: 'test',
    sensors: {
      temperature: { abnormal: false },
      light: { abnormal: false }
    },
    alerts: {
      intruderDetected: true,
      temperatureHigh: true,
      lowLight: true,
      sensorAbnormal: false
    },
    connection: { enabled: true, esp32Online: false, lastError: 'offline' },
    status: { environmentQuality: 'POOR' }
  };

  const types = buildNotificationCandidates(status, createConfig())
    .filter((item) => item.active)
    .map((item) => item.type);

  assert.deepEqual(types, [
    'INTRUDER_DETECTED',
    'TEMPERATURE_HIGH',
    'LOW_LIGHT',
    'ESP32_OFFLINE',
    'ENVIRONMENT_DEGRADED'
  ]);
});
