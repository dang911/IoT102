const path = require('node:path');

const { createApp } = require('./src/app');
const { DEFAULT_CONFIG } = require('./src/domain');

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function envBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

const rootDir = path.resolve(__dirname, '..');
const port = envNumber('PORT', 3000);
const host = process.env.HOST || '0.0.0.0';
const esp32BaseUrl = process.env.ESP32_BASE_URL || '';
const app = createApp({
  rootDir,
  dataFile: process.env.DATA_FILE || path.join(rootDir, 'backend', 'data', 'state.json'),
  esp32BaseUrl,
  esp32TimeoutMs: envNumber('ESP32_TIMEOUT_MS', 2500),
  syncFromEsp32: envBoolean('SYNC_FROM_ESP32', Boolean(esp32BaseUrl)),
  config: {
    temperatureThreshold: envNumber(
      'TEMPERATURE_THRESHOLD',
      DEFAULT_CONFIG.temperatureThreshold
    ),
    darkThreshold: envNumber('DARK_THRESHOLD', DEFAULT_CONFIG.darkThreshold),
    brightThreshold: envNumber('BRIGHT_THRESHOLD', DEFAULT_CONFIG.brightThreshold),
    historyLimit: envNumber('HISTORY_LIMIT', DEFAULT_CONFIG.historyLimit),
    notificationLimit: envNumber(
      'NOTIFICATION_LIMIT',
      DEFAULT_CONFIG.notificationLimit
    ),
    notificationCooldownMs: envNumber(
      'NOTIFICATION_COOLDOWN_MS',
      DEFAULT_CONFIG.notificationCooldownMs
    ),
    sensorOfflineTimeoutMs: envNumber(
      'SENSOR_OFFLINE_TIMEOUT_MS',
      DEFAULT_CONFIG.sensorOfflineTimeoutMs
    ),
    forecastWindowSize: envNumber(
      'FORECAST_WINDOW_SIZE',
      DEFAULT_CONFIG.forecastWindowSize
    ),
    forecastMinSamples: envNumber(
      'FORECAST_MIN_SAMPLES',
      DEFAULT_CONFIG.forecastMinSamples
    ),
    forecastHorizonMinutes: envNumber(
      'FORECAST_HORIZON_MINUTES',
      DEFAULT_CONFIG.forecastHorizonMinutes
    )
  }
});

app.listen(port, host, () => {
  console.log(`Smart Environment backend running at http://localhost:${port}`);
});
