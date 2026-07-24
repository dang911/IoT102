const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReport, reportToCsv } = require('../src/reports');
const { createConfig } = require('../src/domain');

test('report aggregates temperature and light without dust metrics', () => {
  const now = '2026-07-23T12:00:00.000Z';
  const state = {
    config: createConfig(),
    history: [
      {
        temperature: 30,
        lightLevel: 300,
        timestamp: '2026-07-23T11:00:00.000Z',
        sensors: {
          temperature: { online: true, abnormal: false },
          light: { online: true, abnormal: false }
        },
        dataMode: 'REAL'
      }
    ],
    notifications: [],
    lightEvents: [],
    lightStatus: false,
    system: { startedAt: '2026-07-23T10:00:00.000Z', disconnectCount: 0 }
  };

  const report = buildReport(state, 'daily', now);
  assert.equal(report.statistics.temperature.average, 30);
  assert.equal(report.statistics.light.average, 300);
  assert.equal(Object.hasOwn(report.statistics, 'dust'), false);
  assert.doesNotMatch(reportToCsv(report), /dust/i);
});
