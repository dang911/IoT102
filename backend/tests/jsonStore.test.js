const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { JsonStore, SCHEMA_VERSION } = require('../src/jsonStore');

function withTempStore(callback, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iot102-store-'));
  const dataFile = path.join(tempDir, 'state.json');
  try {
    return callback(dataFile, tempDir, options);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('legacy state is migrated without losing old sensor history', () => {
  withTempStore((dataFile) => {
    fs.writeFileSync(dataFile, JSON.stringify({
      mode: 'AUTO',
      lightStatus: false,
      config: {
        temperatureThreshold: 35,
        darkThreshold: 200,
        brightThreshold: 260,
        historyLimit: 240
      },
      latest: {
        temperature: 29,
        lightLevel: 410,
        timestamp: '2026-07-15T09:00:00.000Z',
        source: 'api'
      },
      history: [
        {
          temperature: 29,
          lightLevel: 410,
          timestamp: '2026-07-15T09:00:00.000Z',
          source: 'api'
        }
      ]
    }));

    const store = new JsonStore({
      dataFile,
      clock: () => '2026-07-15T09:00:30.000Z'
    });
    const state = store.snapshot();

    assert.equal(state.schemaVersion, SCHEMA_VERSION);
    assert.equal(state.latest.temperature, 29);
    assert.equal(state.latest.dataMode, 'REAL');
    assert.equal(state.latest.dust.sensorOnline, false);
    assert.equal(state.history[0].mode, 'AUTO');
    assert.equal(state.history[0].lightStatus, false);
    assert.ok(state.config.dustThresholds);
    assert.ok(state.config.dustCalibration);
    assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).schemaVersion, 2);
  });
});

test('old sensor payload remains valid and new dust/config state persists', () => {
  withTempStore((dataFile) => {
    let now = '2026-07-15T10:00:00.000Z';
    const clock = () => now;
    const store = new JsonStore({ dataFile, clock });

    const legacyStatus = store.recordReading({
      temp: 30,
      ldr: 350
    });
    assert.equal(legacyStatus.temperature, 30);
    assert.equal(legacyStatus.lightLevel, 350);
    assert.equal(legacyStatus.dataMode, 'REAL');
    assert.equal(legacyStatus.dust.sensorOnline, false);

    now = '2026-07-15T10:01:00.000Z';
    const dustStatus = store.recordReading({
      temperature: 36,
      lightLevel: 100,
      dust: {
        rawAdc: 1800,
        voltage: 1.5,
        density: 200,
        sensorOnline: true
      }
    }, 'esp32');
    assert.equal(dustStatus.dust.level, 'HIGH');
    assert.equal(dustStatus.alerts.dustHigh, true);
    assert.equal(dustStatus.lightStatus, true);

    store.updateConfig({
      dustThresholds: { moderate: 60, high: 180, dangerous: 350 },
      dustCalibration: { calibrationFactor: 1.2, calibrated: true }
    });
    const reloaded = new JsonStore({ dataFile, clock });
    const state = reloaded.snapshot();
    assert.equal(state.config.dustThresholds.high, 180);
    assert.equal(state.config.dustCalibration.calibrationFactor, 1.2);
    assert.equal(state.config.dustCalibration.calibrated, true);
    assert.equal(state.latest.dust.density, 200);
    assert.equal(state.latest.dust.level, 'HIGH');
  });
});

test('notifications can be listed and marked read in persistent storage', () => {
  withTempStore((dataFile) => {
    const store = new JsonStore({
      dataFile,
      clock: () => '2026-07-15T10:00:00.000Z'
    });
    store.recordReading({
      temperature: 40,
      lightLevel: 100,
      dust: { density: 250, sensorOnline: true }
    });

    const summary = store.notificationSummary(50);
    assert.ok(summary.total >= 3);
    assert.equal(summary.unreadCount, summary.total);
    const updated = store.markNotificationRead(summary.items[0].id);
    assert.equal(updated.read, true);
    assert.equal(store.notificationSummary(50).unreadCount, summary.total - 1);
    assert.throws(
      () => store.markNotificationRead('missing'),
      (error) => error.statusCode === 404
    );
  });
});

test('ESP32 connection transitions record offline state and disconnect count', () => {
  withTempStore((dataFile) => {
    let now = '2026-07-15T10:00:00.000Z';
    const store = new JsonStore({ dataFile, clock: () => now });
    store.setEsp32Enabled(true);
    store.markEsp32Online();
    now = '2026-07-15T10:01:00.000Z';
    store.markEsp32Offline('timeout');

    const status = store.status();
    assert.equal(status.connection.enabled, true);
    assert.equal(status.connection.esp32Online, false);
    assert.equal(status.connection.lastError, 'timeout');
    assert.equal(store.snapshot().system.disconnectCount, 1);
    assert.ok(
      store.notificationSummary(50).items.some(
        (item) => item.type === 'ESP32_OFFLINE'
      )
    );
  });
});

test('ESP32 millis uptime is not mistaken for a 1970 wall-clock timestamp', () => {
  withTempStore((dataFile) => {
    const now = '2026-07-15T10:00:00.000Z';
    const store = new JsonStore({ dataFile, clock: () => now });
    const status = store.mergeRemoteStatus({
      temperature: 29,
      lightLevel: 420,
      timestamp: 123456,
      status: { temperature: 'NORMAL', environment: 'BRIGHT' },
      dataMode: 'REAL',
      dust: {
        rawAdc: 1500,
        adcVoltage: 1.2,
        voltage: 2.2,
        density: 100,
        sensorOnline: true,
        valid: true,
        lastUpdate: null
      }
    });

    assert.equal(status.timestamp, now);
    assert.equal(status.dust.lastUpdate, now);
    assert.equal(status.sensors.temperature.online, true);
    assert.equal(status.connection.esp32Online, true);
  });
});

test('sensor online-to-offline transitions are counted once', () => {
  withTempStore((dataFile) => {
    let now = '2026-07-15T10:00:00.000Z';
    const store = new JsonStore({ dataFile, clock: () => now });
    store.recordReading({
      temperature: 29,
      lightLevel: 400,
      dust: { density: 80, sensorOnline: true }
    });
    now = '2026-07-15T10:00:10.000Z';
    store.recordReading({
      temperature: 29,
      lightLevel: 400,
      dust: { sensorOnline: false, error: 'DISCONNECTED' }
    });
    store.refreshNotifications();

    const system = store.snapshot().system;
    assert.equal(system.sensorDisconnectCount, 1);
    assert.equal(system.disconnectCount, 1);
  });
});
