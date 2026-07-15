const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createApp } = require('../src/app');

async function withServer(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iot102-backend-'));
  const dataFile = path.join(tempDir, 'state.json');
  const server = createApp({
    rootDir: path.resolve(__dirname, '..', '..'),
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
