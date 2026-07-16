const assert = require('node:assert/strict');
const test = require('node:test');

const { createConfig } = require('../src/domain');
const {
  buildReport,
  calculateLedDurations,
  reportToCsv
} = require('../src/reports');

function historyItem(timestamp, temperature, lightLevel, density, lightStatus) {
  return {
    timestamp,
    temperature,
    lightLevel,
    dust: {
      density,
      valid: true,
      sensorOnline: true
    },
    lightStatus,
    mode: 'AUTO',
    dataMode: 'REAL'
  };
}

function reportState() {
  return {
    config: createConfig(),
    history: [
      historyItem('2026-07-13T10:00:00.000Z', 50, 50, 500, false),
      historyItem('2026-07-15T09:00:00.000Z', 30, 400, 100, false),
      historyItem('2026-07-15T09:30:00.000Z', 37, 100, 200, true)
    ],
    notifications: [
      {
        id: 'notification-000001',
        timestamp: '2026-07-15T09:31:00.000Z',
        read: false
      }
    ],
    lightStatus: true,
    lightEvents: [
      { timestamp: '2026-07-15T08:00:00.000Z', status: false },
      { timestamp: '2026-07-15T09:00:00.000Z', status: true }
    ],
    system: {
      startedAt: '2026-07-15T08:00:00.000Z',
      disconnectCount: 1
    }
  };
}

test('daily report aggregates all sensors, alerts, notifications, and LED time', () => {
  const report = buildReport(
    reportState(),
    'daily',
    '2026-07-15T10:00:00.000Z'
  );

  assert.equal(report.sampleCount, 2);
  assert.deepEqual(report.statistics.temperature, {
    min: 30,
    max: 37,
    average: 33.5,
    sampleCount: 2
  });
  assert.equal(report.statistics.light.average, 250);
  assert.equal(report.statistics.dust.average, 150);
  assert.equal(report.thresholdExceedances.temperature, 1);
  assert.equal(report.thresholdExceedances.dust, 1);
  assert.equal(report.highestDustPeriod.density, 200);
  assert.equal(report.notifications.total, 1);
  assert.equal(report.led.onRatio, 0.5);
  assert.equal(report.led.offRatio, 0.5);
  assert.equal(report.system.disconnectCount, 1);
  assert.ok(report.recommendations.length > 0);
  assert.match(report.disclaimer, /Mật độ bụi ước tính/);
});

test('weekly report includes older samples excluded by the daily report', () => {
  const state = reportState();
  const daily = buildReport(state, 'daily', '2026-07-15T10:00:00.000Z');
  const weekly = buildReport(state, 'weekly', '2026-07-15T10:00:00.000Z');

  assert.equal(daily.sampleCount, 2);
  assert.equal(weekly.sampleCount, 3);
  assert.equal(weekly.statistics.dust.max, 500);
});

test('report CSV is escaped and contains the primary measurements', () => {
  const report = buildReport(
    reportState(),
    'daily',
    '2026-07-15T10:00:00.000Z'
  );
  const csv = reportToCsv(report);

  assert.match(csv, /^"section","metric","value","unit"/);
  assert.match(csv, /"temperature","average","33.5","°C"/);
  assert.match(csv, /"dust","average","150","ug\/m3"/);
  assert.match(csv, /"report","recommendations"/);
});

test('LED duration helper calculates exact time ratios from control events', () => {
  const result = calculateLedDurations(
    [
      { timestamp: '2026-07-15T08:00:00.000Z', status: false },
      { timestamp: '2026-07-15T08:15:00.000Z', status: true },
      { timestamp: '2026-07-15T08:45:00.000Z', status: false }
    ],
    Date.parse('2026-07-15T08:00:00.000Z'),
    Date.parse('2026-07-15T09:00:00.000Z'),
    false
  );

  assert.equal(result.onMs, 30 * 60 * 1000);
  assert.equal(result.offMs, 30 * 60 * 1000);
  assert.equal(result.onRatio, 0.5);
});
