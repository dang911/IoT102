const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const { buildStatus, HttpError } = require('./domain');
const { Esp32Gateway } = require('./esp32Gateway');
const { JsonStore } = require('./jsonStore');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendNoContent(response) {
  response.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  });
  response.end();
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new HttpError(413, 'Request body is too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new HttpError(400, 'Request body must be valid JSON'));
      }
    });

    request.on('error', reject);
  });
}

function parseLimit(searchParams) {
  const limit = Number(searchParams.get('limit') || 50);
  if (!Number.isFinite(limit) || limit < 1) {
    throw new HttpError(400, 'limit must be a positive number');
  }

  return Math.min(Math.round(limit), 5000);
}

function withHardware(payload, hardwareResult) {
  if (!hardwareResult) {
    return payload;
  }

  return {
    ...payload,
    hardware: hardwareResult
  };
}

async function safeHardware(action) {
  try {
    const result = await action();
    return {
      synced: true,
      response: result
    };
  } catch (error) {
    return {
      synced: false,
      warning: error.message
    };
  }
}

function serveStatic(response, frontendDir, pathname) {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const relativePath = decodeURIComponent(normalizedPath).replace(/^\/+/, '');
  const frontendRoot = path.resolve(frontendDir);
  const filePath = path.resolve(frontendRoot, relativePath);
  const relativeToRoot = path.relative(frontendRoot, filePath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'content-type': MIME_TYPES[extension] || 'application/octet-stream'
  });
  fs.createReadStream(filePath).pipe(response);
}

function createApp(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..', '..');
  const frontendDir = options.frontendDir || path.join(rootDir, 'frontend');
  const store =
    options.store ||
    new JsonStore({
      dataFile:
        options.dataFile || path.join(rootDir, 'backend', 'data', 'state.json'),
      config: options.config || {}
    });
  const gateway =
    options.gateway ||
    new Esp32Gateway({
      baseUrl: options.esp32BaseUrl,
      timeoutMs: options.esp32TimeoutMs
    });
  const syncFromEsp32 = Boolean(options.syncFromEsp32);

  async function maybeSyncFromEsp32() {
    if (!syncFromEsp32 || !gateway.enabled) {
      return;
    }

    const remoteStatus = await gateway.readStatus();
    store.mergeRemoteStatus(remoteStatus, 'esp32');
  }

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    try {
      if (request.method === 'OPTIONS') {
        sendNoContent(response);
        return;
      }

      if (url.pathname === '/api/health' && request.method === 'GET') {
        sendJson(response, 200, {
          ok: true,
          service: 'smart-environment-backend',
          timestamp: new Date().toISOString(),
          uptime: process.uptime()
        });
        return;
      }

      if (url.pathname === '/api/status' && request.method === 'GET') {
        await maybeSyncFromEsp32();
        sendJson(response, 200, store.status());
        return;
      }

      if (
        (url.pathname === '/api/sensor' || url.pathname === '/api/readings') &&
        request.method === 'POST'
      ) {
        const body = await parseJsonBody(request);
        const status = store.recordReading(body, body.source || 'api');
        sendJson(response, 201, status);
        return;
      }

      if (url.pathname === '/api/history' && request.method === 'GET') {
        const history = store.history(parseLimit(url.searchParams));
        sendJson(response, 200, {
          items: history,
          metrics: buildStatus(store.snapshot()).metrics
        });
        return;
      }

      if (url.pathname === '/api/history' && request.method === 'DELETE') {
        sendJson(response, 200, store.clearHistory());
        return;
      }

      if (url.pathname === '/api/mode' && request.method === 'POST') {
        const body = await parseJsonBody(request);
        const status = store.setMode(body.mode);
        const hardware = gateway.enabled
          ? await safeHardware(() => gateway.setMode(status.mode))
          : null;
        sendJson(response, 200, withHardware(status, hardware));
        return;
      }

      if (url.pathname === '/api/light' && request.method === 'POST') {
        const body = await parseJsonBody(request);
        const status = store.setLightStatus(body.status ?? body.lightStatus);
        const hardware = gateway.enabled
          ? await safeHardware(() => gateway.setLight(status.lightStatus))
          : null;
        sendJson(response, 200, withHardware(status, hardware));
        return;
      }

      if (url.pathname === '/api/config' && request.method === 'GET') {
        sendJson(response, 200, store.snapshot().config);
        return;
      }

      if (
        url.pathname === '/api/config' &&
        (request.method === 'PATCH' || request.method === 'POST')
      ) {
        const body = await parseJsonBody(request);
        sendJson(response, 200, store.updateConfig(body));
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        throw new HttpError(404, 'API endpoint not found');
      }

      serveStatic(response, frontendDir, url.pathname);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      sendJson(response, statusCode, {
        error: error.message || 'Internal server error',
        details: error.details
      });
    }
  });
}

module.exports = {
  createApp,
  parseJsonBody
};
