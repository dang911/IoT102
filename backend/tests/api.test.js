const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createApp } = require('../src/app');

async function withServer(callback, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iot102-backend-'));
  const dataFile = path.join(tempDir, 'state.json');
  const server = createApp({
    rootDir: path.resolve(__dirname, '..', '..'),
    ...options,
    dataFile
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function requestRaw(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, options);
  return {
    status: response.status,
    headers: response.headers,
    text: await response.text()
  };
}

async function request(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json();

  return {
    status: response.status,
    data
  };
}

test('GET /api/status returns dashboard state', async () => {
  await withServer(async (baseUrl) => {
    const response = await request(baseUrl, '/api/status');

    assert.equal(response.status, 200);
    assert.equal(response.data.mode, 'AUTO');
    assert.equal(typeof response.data.temperature, 'number');
    assert.equal(typeof response.data.lightLevel, 'number');
    assert.equal(typeof response.data.lightStatus, 'boolean');
    assert.equal(response.data.metrics.sampleCount, 1);
    assert.equal(response.data.dataMode, 'SIMULATED');
    assert.equal(response.data.dust.unit, 'ug/m3');
    assert.equal(typeof response.data.alerts.dustHigh, 'boolean');
    assert.equal(typeof response.data.alerts.dustSensorOffline, 'boolean');
    assert.ok(response.data.sensors.temperature);
    assert.ok(response.data.connection);
  });
});

test('POST /api/sensor records readings and applies auto lighting', async () => {
  await withServer(async (baseUrl) => {
    const response = await request(baseUrl, '/api/sensor', {
      method: 'POST',
      body: JSON.stringify({
        temperature: 37.24,
        lightLevel: 120
      })
    });

    assert.equal(response.status, 201);
    assert.equal(response.data.temperature, 37.2);
    assert.equal(response.data.lightStatus, true);
    assert.equal(response.data.alerts.temperatureHigh, true);
    assert.equal(response.data.alerts.lowLight, true);
    assert.equal(response.data.metrics.sampleCount, 2);
  });
});

test('POST /api/light switches to manual mode', async () => {
  await withServer(async (baseUrl) => {
    const response = await request(baseUrl, '/api/light', {
      method: 'POST',
      body: JSON.stringify({
        status: 'ON'
      })
    });

    assert.equal(response.status, 200);
    assert.equal(response.data.lightStatus, true);
    assert.equal(response.data.mode, 'MANUAL');
  });
});

test('PATCH /api/config validates threshold relationship', async () => {
  await withServer(async (baseUrl) => {
    const response = await request(baseUrl, '/api/config', {
      method: 'PATCH',
      body: JSON.stringify({
        darkThreshold: 500,
        brightThreshold: 400
      })
    });

    assert.equal(response.status, 400);
    assert.match(response.data.error, /brightThreshold/);
  });
});

test('POST /api/sensor accepts and returns a complete dust reading', async () => {
  await withServer(async (baseUrl) => {
    const response = await request(baseUrl, '/api/sensor', {
      method: 'POST',
      body: JSON.stringify({
        temperature: 29.4,
        lightLevel: 420,
        source: 'esp32',
        dust: {
          rawAdc: 1234,
          voltage: 1.42,
          density: 85.5,
          sensorOnline: true,
          calibrated: false
        }
      })
    });

    assert.equal(response.status, 201);
    assert.equal(response.data.dataMode, 'REAL');
    assert.equal(response.data.dust.rawAdc, 1234);
    assert.equal(response.data.dust.voltage, 1.42);
    assert.equal(response.data.dust.density, 85.5);
    assert.equal(response.data.dust.level, 'MODERATE');
    assert.equal(response.data.dust.sensorOnline, true);
    assert.equal(response.data.dust.calibrated, false);
    assert.match(response.data.dust.lastUpdate, /^\d{4}-\d{2}-\d{2}T/);

    const history = await request(baseUrl, '/api/history?limit=1');
    assert.equal(history.status, 200);
    assert.equal(history.data.items[0].dust.density, 85.5);
    assert.equal(history.data.items[0].mode, 'AUTO');
    assert.equal(typeof history.data.items[0].lightStatus, 'boolean');
  });
});

test('POST /api/sensor rejects negative density and ADC overflow', async () => {
  await withServer(async (baseUrl) => {
    const negative = await request(baseUrl, '/api/sensor', {
      method: 'POST',
      body: JSON.stringify({
        temperature: 29,
        lightLevel: 420,
        dust: { density: -0.1 }
      })
    });
    assert.equal(negative.status, 400);
    assert.match(negative.data.error, /dust\.density/);

    const overflow = await request(baseUrl, '/api/sensor', {
      method: 'POST',
      body: JSON.stringify({
        temperature: 29,
        lightLevel: 420,
        dust: { rawAdc: 4096 }
      })
    });
    assert.equal(overflow.status, 400);
    assert.match(overflow.data.error, /dust\.rawAdc/);
  });
});

test('legacy readings alias and payload fields remain compatible without dust', async () => {
  await withServer(async (baseUrl) => {
    const response = await request(baseUrl, '/api/readings', {
      method: 'POST',
      body: JSON.stringify({
        temp: 31.2,
        ldr: 230
      })
    });

    assert.equal(response.status, 201);
    assert.equal(response.data.temperature, 31.2);
    assert.equal(response.data.lightLevel, 230);
    assert.equal(response.data.dust.sensorOnline, false);
    assert.ok(response.data.status.temperature);
    assert.ok(response.data.status.environment);
    assert.equal(typeof response.data.metrics.maxTemperature, 'number');
    assert.equal(response.data.thresholds.temperature, 35);
  });
});

test('notification center lists alerts and PATCH marks one as read', async () => {
  await withServer(async (baseUrl) => {
    await request(baseUrl, '/api/sensor', {
      method: 'POST',
      body: JSON.stringify({
        temperature: 40,
        lightLevel: 100,
        dust: { density: 250, sensorOnline: true }
      })
    });

    const list = await request(baseUrl, '/api/notifications');
    assert.equal(list.status, 200);
    assert.ok(list.data.total >= 3);
    assert.equal(list.data.unreadCount, list.data.total);
    const dustAlert = list.data.items.find((item) => item.type === 'DUST_HIGH');
    assert.ok(dustAlert);
    for (const field of [
      'id',
      'type',
      'title',
      'message',
      'value',
      'threshold',
      'timestamp',
      'read',
      'source'
    ]) {
      assert.equal(field in dustAlert, true);
    }

    const updated = await request(
      baseUrl,
      `/api/notifications/${encodeURIComponent(dustAlert.id)}/read`,
      { method: 'PATCH' }
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.data.read, true);

    const unread = await request(baseUrl, '/api/notifications?read=false');
    assert.equal(
      unread.data.items.some((item) => item.id === dustAlert.id),
      false
    );
  });
});

test('dust thresholds and calibration can be updated and read through config API', async () => {
  await withServer(async (baseUrl) => {
    const update = await request(baseUrl, '/api/config', {
      method: 'PATCH',
      body: JSON.stringify({
        dustThresholds: {
          moderate: 60,
          high: 180,
          dangerous: 350
        },
        dustCalibration: {
          cleanAirVoltage: 0.82,
          calibrationFactor: 1.15,
          calibrated: true
        },
        notificationCooldownMs: 120000
      })
    });
    assert.equal(update.status, 200);
    assert.equal(update.data.mode, 'AUTO');
    assert.equal(update.data.thresholds.dust.high, 180);

    const config = await request(baseUrl, '/api/config');
    assert.equal(config.status, 200);
    assert.equal(config.data.temperatureThreshold, 35);
    assert.equal(config.data.dustThresholds.high, 180);
    assert.equal(config.data.dustCalibration.cleanAirVoltage, 0.82);
    assert.equal(config.data.dustCalibration.calibrationFactor, 1.15);
    assert.equal(config.data.dustCalibration.calibrated, true);
    assert.equal(config.data.notificationCooldownMs, 120000);
  });
});

test('forecast and daily/weekly report APIs return explicit statistical metadata', async () => {
  await withServer(async (baseUrl) => {
    await request(baseUrl, '/api/sensor', {
      method: 'POST',
      body: JSON.stringify({
        temperature: 30,
        lightLevel: 300,
        dust: { density: 80 }
      })
    });

    const forecast = await request(baseUrl, '/api/forecast');
    assert.equal(forecast.status, 200);
    assert.equal(typeof forecast.data.insufficientData, 'boolean');
    assert.ok(forecast.data.temperature);
    assert.ok(forecast.data.dust);
    assert.match(forecast.data.disclaimer, /tham khảo/);

    for (const period of ['daily', 'weekly']) {
      const report = await request(baseUrl, `/api/reports?period=${period}`);
      assert.equal(report.status, 200);
      assert.equal(report.data.period, period);
      assert.ok(report.data.statistics.temperature);
      assert.ok(report.data.statistics.light);
      assert.ok(report.data.statistics.dust);
      assert.ok(report.data.thresholdExceedances);
      assert.ok(report.data.led);
      assert.ok(report.data.system);
      assert.ok(Array.isArray(report.data.recommendations));
    }

    const csv = await requestRaw(
      baseUrl,
      '/api/reports?period=daily&format=csv'
    );
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.text, /"temperature","average"/);

    const invalid = await request(baseUrl, '/api/reports?period=monthly');
    assert.equal(invalid.status, 400);
  });
});

test('ESP32 sync failure falls back to cached status with offline metadata', async () => {
  const gateway = {
    enabled: true,
    async readStatus() {
      throw new Error('connection timeout');
    }
  };

  await withServer(async (baseUrl) => {
    const status = await request(baseUrl, '/api/status');
    assert.equal(status.status, 200);
    assert.equal(status.data.temperature, 28);
    assert.equal(status.data.connection.enabled, true);
    assert.equal(status.data.connection.esp32Online, false);
    assert.match(status.data.connection.lastError, /timeout/);

    const notifications = await request(baseUrl, '/api/notifications');
    assert.ok(
      notifications.data.items.some((item) => item.type === 'ESP32_OFFLINE')
    );
  }, {
    gateway,
    syncFromEsp32: true
  });
});

test('ESP32 firmware status with uptime timestamp and divided dust voltage syncs successfully', async () => {
  const gateway = {
    enabled: true,
    async readStatus() {
      return {
        temperature: '29.5',
        lightLevel: 410,
        lightStatus: false,
        mode: 'AUTO',
        timestamp: 123456,
        dataMode: 'REAL',
        source: 'esp32',
        dust: {
          rawAdc: 2500,
          adcVoltage: '2.010',
          voltage: '3.685',
          density: '557.0',
          sensorOnline: true,
          valid: true,
          calibrated: false,
          lastUpdate: null
        }
      };
    }
  };

  await withServer(async (baseUrl) => {
    const response = await request(baseUrl, '/api/status');
    assert.equal(response.status, 200);
    assert.equal(response.data.temperature, 29.5);
    assert.equal(response.data.dust.adcVoltage, 2.01);
    assert.equal(response.data.dust.voltage, 3.685);
    assert.equal(response.data.dust.density, 557);
    assert.equal(response.data.connection.esp32Online, true);
    assert.equal(response.data.sensors.temperature.online, true);
  }, {
    gateway,
    syncFromEsp32: true
  });
});
