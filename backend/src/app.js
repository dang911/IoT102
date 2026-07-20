const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const { buildStatus, HttpError } = require('./domain');
const { Esp32Gateway } = require('./esp32Gateway');
const { JsonStore } = require('./jsonStore');
const { reportToCsv } = require('./reports');

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

function sendText(response, statusCode, payload, contentType, headers = {}) {
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'content-type': contentType,
    ...headers
  });
  response.end(payload);
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

function parseOptionalBoolean(searchParams, name) {
  const value = searchParams.get(name);
  if (value === null || value === '') {
    return undefined;
  }
  if (value === 'true' || value === '1') {
    return true;
  }
  if (value === 'false' || value === '0') {
    return false;
  }
  throw new HttpError(400, `${name} must be true or false`);
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

async function safeHardware(action, { onSuccess, onError } = {}) {
  try {
    const result = await action();
    if (onSuccess) {
      onSuccess(result);
    }
    return {
      synced: true,
      response: result
    };
  } catch (error) {
    if (onError) {
      onError(error);
    }
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
      config: options.config || {},
      clock: options.clock
    });
  const gateway =
    options.gateway ||
    new Esp32Gateway({
      baseUrl: options.esp32BaseUrl,
      timeoutMs: options.esp32TimeoutMs
    });
  const syncFromEsp32 = Boolean(options.syncFromEsp32);

  if (typeof store.setEsp32Enabled === 'function') {
    store.setEsp32Enabled(gateway.enabled);
  }

  async function maybeSyncFromEsp32() {
    if (!syncFromEsp32 || !gateway.enabled) {
      return;
    }

    try {
      const remoteStatus = await gateway.readStatus();
      store.mergeRemoteStatus(remoteStatus, 'esp32');
    } catch (error) {
      if (typeof store.markEsp32Offline === 'function') {
        store.markEsp32Offline(error.message);
      }
    }
  }

  const hardwareCallbacks = {
    onSuccess: () => {
      if (typeof store.markEsp32Online === 'function') {
        store.markEsp32Online();
      }
    },
    onError: (error) => {
      if (typeof store.markEsp32Offline === 'function') {
        store.markEsp32Offline(error.message);
      }
    }
  };

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
        if (typeof store.refreshNotifications === 'function') {
          store.refreshNotifications();
        }
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
          ? await safeHardware(
            () => gateway.setMode(status.mode),
            hardwareCallbacks
          )
          : null;
        sendJson(response, 200, withHardware(status, hardware));
        return;
      }

      if (url.pathname === '/api/light' && request.method === 'POST') {
        const body = await parseJsonBody(request);
        const status = store.setLightStatus(body.status ?? body.lightStatus);
        const hardware = gateway.enabled
          ? await safeHardware(
            () => gateway.setLight(status.lightStatus),
            hardwareCallbacks
          )
          : null;
        sendJson(response, 200, withHardware(status, hardware));
        return;
      }

      if (url.pathname === '/api/notifications' && request.method === 'GET') {
        store.refreshNotifications();
        const read = parseOptionalBoolean(url.searchParams, 'read');
        sendJson(
          response,
          200,
          store.notificationSummary(parseLimit(url.searchParams), read)
        );
        return;
      }

      const notificationReadMatch = url.pathname.match(
        /^\/api\/notifications\/([^/]+)\/read$/
      );
      if (notificationReadMatch && request.method === 'PATCH') {
        const id = decodeURIComponent(notificationReadMatch[1]);
        sendJson(response, 200, store.markNotificationRead(id));
        return;
      }

      if (url.pathname === '/api/forecast' && request.method === 'GET') {
        sendJson(response, 200, store.forecast());
        return;
      }

      if (url.pathname === '/api/reports' && request.method === 'GET') {
        const period = String(url.searchParams.get('period') || 'daily').toLowerCase();
        if (!['daily', 'weekly'].includes(period)) {
          throw new HttpError(400, 'period must be daily or weekly');
        }
        const report = store.report(period);
        const format = String(url.searchParams.get('format') || 'json').toLowerCase();
        if (format === 'csv') {
          sendText(response, 200, reportToCsv(report), 'text/csv; charset=utf-8', {
            'content-disposition': `attachment; filename="environment-${period}.csv"`
          });
          return;
        }
        if (format !== 'json') {
          throw new HttpError(400, 'format must be json or csv');
        }
        sendJson(response, 200, report);
        return;
      }

      if (url.pathname === '/api/config' && request.method === 'GET') {
        const config = store.snapshot().config;
        const hardware = gateway.enabled
          ? await safeHardware(() => gateway.readConfig(), hardwareCallbacks)
          : null;
        sendJson(response, 200, withHardware(config, hardware));
        return;
      }

      if (
        url.pathname === '/api/config' &&
        (request.method === 'PATCH' || request.method === 'POST')
      ) {
        const body = await parseJsonBody(request);
        const status = store.updateConfig(body);
        const hardware = gateway.enabled
          ? await safeHardware(
            () => gateway.updateConfig(body),
            hardwareCallbacks
          )
          : null;
        sendJson(response, 200, withHardware(status, hardware));
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
