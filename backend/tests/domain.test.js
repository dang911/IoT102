const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStatus,
  createConfig,
  normalizeConfigPatch,
  normalizeReading
} = require('../src/domain');
const { initialState } = require('../src/jsonStore');

test('sensor payload contains temperature and light only', () => {
  assert.deepEqual(normalizeReading({ temperature: 28.4, lightLevel: 350 }), {
    temperature: 28.4,
    lightLevel: 350
  });
});

test('configuration validates light hysteresis', () => {
  assert.throws(
    () => normalizeConfigPatch({ darkThreshold: 300, brightThreshold: 200 }),
    /brightThreshold/
  );
});

test('configuration accepts an alert recipient and rejects invalid email', () => {
  assert.equal(
    normalizeConfigPatch({ alertEmail: 'user@example.com' }).alertEmail,
    'user@example.com'
  );
  assert.throws(
    () => normalizeConfigPatch({ alertEmail: 'not-an-email' }),
    /alertEmail/
  );
});

test('status exposes temperature, light and motion without dust fields', () => {
  const now = '2026-07-23T10:00:00.000Z';
  const state = initialState(createConfig(), now);
  state.latest.motionDetected = true;
  const status = buildStatus(state, now);

  assert.equal(status.motionDetected, true);
  assert.equal(status.alerts.intruderDetected, true);
  assert.ok(status.sensors.temperature);
  assert.ok(status.sensors.light);
  assert.equal(Object.hasOwn(status, 'dust'), false);
  assert.equal(Object.hasOwn(status.sensors, 'dust'), false);
});
