const test = require('node:test');
const assert = require('node:assert/strict');

const { buildForecast } = require('../src/forecast');
const { createConfig } = require('../src/domain');

test('forecast uses temperature history only', () => {
  const history = [0, 1, 2, 3].map((index) => ({
    temperature: 25 + index,
    lightLevel: 400,
    timestamp: new Date(Date.UTC(2026, 6, 23, 10, index)).toISOString(),
    sensors: { temperature: { online: true, abnormal: false } }
  }));
  const forecast = buildForecast(history, createConfig(), '2026-07-23T10:04:00.000Z');

  assert.equal(forecast.temperature.trend, 'INCREASING');
  assert.equal(forecast.environmentTrend, 'DEGRADING');
  assert.equal(Object.hasOwn(forecast, 'dust'), false);
});

test('forecast reports insufficient temperature data explicitly', () => {
  const forecast = buildForecast([], createConfig());
  assert.equal(forecast.insufficientData, true);
  assert.equal(forecast.temperature.insufficientData, true);
});
