const assert = require('node:assert/strict');
const test = require('node:test');

const { createConfig } = require('../src/domain');
const { buildForecast } = require('../src/forecast');

function sample(timestamp, temperature, density = null) {
  return {
    timestamp,
    temperature,
    lightLevel: 400,
    dust: density === null
      ? null
      : { density, valid: true }
  };
}

test('forecast reports increasing trends when enough history is available', () => {
  const config = createConfig({
    forecastWindowSize: 4,
    forecastMinSamples: 4,
    forecastHorizonMinutes: 5
  });
  const history = [
    sample('2026-07-15T09:45:00.000Z', 20, 40),
    sample('2026-07-15T09:50:00.000Z', 21, 50),
    sample('2026-07-15T09:55:00.000Z', 22, 60),
    sample('2026-07-15T10:00:00.000Z', 23, 70)
  ];
  const forecast = buildForecast(
    history,
    config,
    '2026-07-15T10:00:00.000Z'
  );

  assert.equal(forecast.insufficientData, false);
  assert.equal(forecast.temperature.trend, 'INCREASING');
  assert.equal(forecast.dust.trend, 'INCREASING');
  assert.equal(forecast.environmentTrend, 'DEGRADING');
  assert.equal(forecast.temperature.predictedValue, 24);
  assert.equal(forecast.dust.predictedValue, 80);
  assert.equal(forecast.temperature.samplesUsed, 4);
  assert.equal(forecast.temperature.confidence, 'HIGH');
  assert.match(forecast.disclaimer, /chỉ mang tính tham khảo/);
});

test('forecast explicitly reports insufficient temperature and dust data', () => {
  const config = createConfig({
    forecastWindowSize: 6,
    forecastMinSamples: 4
  });
  const forecast = buildForecast(
    [
      sample('2026-07-15T09:55:00.000Z', 28),
      sample('2026-07-15T10:00:00.000Z', 29)
    ],
    config,
    '2026-07-15T10:00:00.000Z'
  );

  assert.equal(forecast.insufficientData, true);
  assert.equal(forecast.temperature.insufficientData, true);
  assert.equal(forecast.dust.insufficientData, true);
  assert.equal(forecast.temperature.predictedValue, null);
  assert.equal(forecast.environmentTrend, 'INSUFFICIENT_DATA');
});

test('an available temperature forecast is not hidden when only dust is missing', () => {
  const config = createConfig({
    forecastWindowSize: 4,
    forecastMinSamples: 4
  });
  const forecast = buildForecast([
    sample('2026-07-15T09:45:00.000Z', 25),
    sample('2026-07-15T09:50:00.000Z', 26),
    sample('2026-07-15T09:55:00.000Z', 27),
    sample('2026-07-15T10:00:00.000Z', 28)
  ], config, '2026-07-15T10:00:00.000Z');

  assert.equal(forecast.insufficientData, false);
  assert.equal(forecast.partialData, true);
  assert.equal(forecast.temperature.insufficientData, false);
  assert.equal(forecast.dust.insufficientData, true);
});
