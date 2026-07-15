const path = require('node:path');

const { createApp } = require('./src/app');

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const rootDir = path.resolve(__dirname, '..');
const port = envNumber('PORT', 3000);
const host = process.env.HOST || '0.0.0.0';
const app = createApp({
  rootDir,
  dataFile: process.env.DATA_FILE || path.join(rootDir, 'backend', 'data', 'state.json'),
  esp32BaseUrl: process.env.ESP32_BASE_URL || '',
  esp32TimeoutMs: envNumber('ESP32_TIMEOUT_MS', 2500),
  syncFromEsp32: process.env.SYNC_FROM_ESP32 === 'true',
  config: {
    temperatureThreshold: envNumber('TEMPERATURE_THRESHOLD', 35),
    darkThreshold: envNumber('DARK_THRESHOLD', 200),
    brightThreshold: envNumber('BRIGHT_THRESHOLD', 260),
    historyLimit: envNumber('HISTORY_LIMIT', 240)
  }
});

app.listen(port, host, () => {
  console.log(`Smart Environment backend running at http://localhost:${port}`);
});
