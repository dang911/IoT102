const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyNotificationCandidates,
  buildNotificationCandidates,
  unreadCount
} = require('../src/notifications');
const { createConfig } = require('../src/domain');

function candidate(active, stateToken = 'HIGH') {
  return {
    key: 'dustHigh',
    active,
    stateToken,
    type: 'DUST_HIGH',
    severity: 'WARNING',
    title: 'Dust high',
    message: 'Dust crossed the threshold',
    value: 200,
    threshold: 150,
    source: 'esp32'
  };
}

test('notification cooldown prevents duplicates and state transitions re-arm alerts', () => {
  const state = {
    notifications: [],
    alertStates: {},
    nextNotificationId: 1
  };
  const config = createConfig({
    notificationCooldownMs: 5 * 60 * 1000
  });

  assert.equal(
    applyNotificationCandidates(
      state,
      [candidate(true)],
      config,
      '2026-07-15T10:00:00.000Z'
    ),
    1
  );
  assert.equal(
    applyNotificationCandidates(
      state,
      [candidate(true)],
      config,
      '2026-07-15T10:01:00.000Z'
    ),
    0
  );
  applyNotificationCandidates(
    state,
    [candidate(false)],
    config,
    '2026-07-15T10:02:00.000Z'
  );
  assert.equal(
    applyNotificationCandidates(
      state,
      [candidate(true)],
      config,
      '2026-07-15T10:03:00.000Z'
    ),
    1
  );
  assert.equal(
    applyNotificationCandidates(
      state,
      [candidate(true, 'DANGEROUS')],
      config,
      '2026-07-15T10:04:00.000Z'
    ),
    1
  );
  assert.equal(
    applyNotificationCandidates(
      state,
      [candidate(true, 'DANGEROUS')],
      config,
      '2026-07-15T10:10:00.000Z'
    ),
    1
  );

  assert.equal(state.notifications.length, 4);
  assert.equal(new Set(state.notifications.map((item) => item.id)).size, 4);
  assert.equal(unreadCount(state.notifications), 4);
});

test('status is mapped to required notification types', () => {
  const config = createConfig();
  const status = {
    temperature: 38,
    lightLevel: 100,
    source: 'esp32',
    dust: {
      density: 320,
      rawAdc: 2000,
      level: 'DANGEROUS',
      valid: true,
      error: null
    },
    alerts: {
      intruderDetected: true,
      temperatureHigh: true,
      lowLight: true,
      dustHigh: true,
      dustSensorOffline: false
    },
    connection: {
      enabled: true,
      esp32Online: false,
      lastError: 'timeout'
    },
    status: {
      environmentQuality: 'DANGEROUS'
    }
  };

  const activeTypes = buildNotificationCandidates(status, config)
    .filter((item) => item.active)
    .map((item) => item.type);
  assert.deepEqual(activeTypes, [
    'INTRUDER_DETECTED',
    'TEMPERATURE_HIGH',
    'LOW_LIGHT',
    'DUST_HIGH',
    'ESP32_OFFLINE',
    'ENVIRONMENT_DEGRADED'
  ]);
});

test('active alerts without a custom state token still honor cooldown', () => {
  const state = { notifications: [], alertStates: {}, nextNotificationId: 1 };
  const config = createConfig({ notificationCooldownMs: 300000 });
  const alert = {
    key: 'temperatureHigh',
    active: true,
    type: 'TEMPERATURE_HIGH',
    severity: 'WARNING',
    title: 'High temperature',
    message: 'High temperature',
    value: 40,
    threshold: 35,
    source: 'esp32'
  };

  assert.equal(
    applyNotificationCandidates(
      state,
      [alert],
      config,
      '2026-07-15T10:00:00.000Z'
    ),
    1
  );
  assert.equal(
    applyNotificationCandidates(
      state,
      [alert],
      config,
      '2026-07-15T10:01:00.000Z'
    ),
    0
  );
});
