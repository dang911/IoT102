const fs = require('node:fs');
const path = require('node:path');

const {
  HttpError,
  applyAutomation,
  buildStatus,
  createConfig,
  normalizeConfigPatch,
  normalizeDataMode,
  normalizeLightStatus,
  normalizeMotionDetected,
  normalizeMode,
  normalizeReading
} = require('./domain');
const {
  createOfflineDust,
  extractDustPayload,
  normalizeDustReading,
  reclassifyDustReading
} = require('./dust');
const { buildForecast } = require('./forecast');
const {
  applyNotificationCandidates,
  buildNotificationCandidates,
  unreadCount
} = require('./notifications');
const { buildReport } = require('./reports');

const SCHEMA_VERSION = 2;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validTimestamp(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numericValue = Number(value);
  if (
    Number.isFinite(numericValue) &&
    String(value).trim() !== '' &&
    numericValue < 1000000000000
  ) {
    // ESP32 commonly reports millis() here. It is uptime, not Unix time.
    return fallback;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function resolveNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('clock must return a valid Date or timestamp');
  }
  return date.toISOString();
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function sensorMetadata(payload, sensorName, timestamp) {
  const nested =
    payload && payload.sensors && payload.sensors[sensorName]
      ? payload.sensors[sensorName]
      : {};
  const prefix = sensorName === 'temperature' ? 'temperature' : 'light';
  const online = booleanValue(
    nested.online ?? payload[`${prefix}SensorOnline`] ?? payload[`${prefix}Online`],
    true
  );
  const abnormal = booleanValue(
    nested.abnormal ?? payload[`${prefix}SensorAbnormal`] ?? payload[`${prefix}Abnormal`],
    false
  );
  return {
    online,
    abnormal,
    lastUpdate: validTimestamp(nested.lastUpdate, timestamp),
    error: nested.error ? String(nested.error) : abnormal ? 'ABNORMAL_READING' : null
  };
}

function readingSensorMetadata(payload, timestamp) {
  return {
    temperature: sensorMetadata(payload || {}, 'temperature', timestamp),
    light: sensorMetadata(payload || {}, 'light', timestamp)
  };
}

function initialState(config = {}, now = new Date().toISOString()) {
  const mergedConfig = createConfig(config);
  const latest = {
    temperature: 28,
    lightLevel: 420,
    motionDetected: false,
    dust: createOfflineDust({
      calibrated: mergedConfig.dustCalibration.calibrated
    }),
    sensors: readingSensorMetadata({}, now),
    timestamp: now,
    source: 'simulation',
    dataMode: 'SIMULATED'
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    mode: 'AUTO',
    lightStatus: false,
    config: mergedConfig,
    latest,
    history: [
      {
        ...latest,
        mode: 'AUTO',
        lightStatus: false
      }
    ],
    notifications: [],
    alertStates: {},
    nextNotificationId: 1,
    connection: {
      enabled: false,
      esp32Online: null,
      lastSeen: null,
      lastError: null
    },
    system: {
      startedAt: now,
      disconnectCount: 0,
      sensorDisconnectCount: 0,
      esp32DisconnectCount: 0
    },
    sensorConnectionStates: {},
    disconnectEvents: [],
    lightEvents: [
      {
        timestamp: now,
        status: false,
        source: 'simulation'
      }
    ]
  };
}

class JsonStore {
  constructor({ dataFile, config = {}, clock = () => new Date() }) {
    this.dataFile = dataFile;
    this.clock = clock;
    this.defaultConfig = createConfig(config);
    this.loadWarning = null;
    const now = this.now();
    this.state = this.migrate(this.load(), now);
    this.trimCollections();
    applyAutomation(this.state);
    this.save();
  }

  now() {
    return resolveNow(this.clock);
  }

  load() {
    if (!this.dataFile || !fs.existsSync(this.dataFile)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(this.dataFile, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      this.loadWarning = `State file could not be loaded: ${error.message}`;
      return null;
    }
  }

  migrateDust(entry, config, timestamp) {
    try {
      const extracted = extractDustPayload(entry || {});
      if (extracted === null) {
        return createOfflineDust({
          calibrated: config.dustCalibration.calibrated
        });
      }
      return normalizeDustReading(
        { dust: extracted },
        config,
        timestamp
      );
    } catch (error) {
      return createOfflineDust({
        lastUpdate: timestamp,
        error: 'MIGRATION_INVALID_DATA',
        calibrated: config.dustCalibration.calibrated
      });
    }
  }

  migrateReading(entry, fallback, config, mode, lightStatus, now) {
    const source = String((entry && entry.source) || fallback.source || 'simulation');
    const timestamp = validTimestamp(
      entry && entry.timestamp,
      fallback.timestamp || now
    );
    let dataMode;
    try {
      dataMode = normalizeDataMode(
        entry && entry.simulated === true
          ? 'SIMULATED'
          : entry && (entry.dataMode ?? entry.dataSource),
        source
      );
    } catch (error) {
      dataMode = normalizeDataMode(undefined, source);
    }
    const temperature = Number(entry && entry.temperature);
    const lightLevel = Number(entry && entry.lightLevel);
    const migrated = {
      temperature: Number.isFinite(temperature)
        ? temperature
        : Number(fallback.temperature),
      lightLevel: Number.isFinite(lightLevel)
        ? lightLevel
        : Number(fallback.lightLevel),
      motionDetected: normalizeMotionDetected(entry || {}, fallback.motionDetected),
      dust: this.migrateDust(entry, config, timestamp),
      sensors: readingSensorMetadata(entry || {}, timestamp),
      timestamp,
      source,
      dataMode,
      mode: (() => {
        try {
          return normalizeMode((entry && entry.mode) || mode);
        } catch (error) {
          return mode;
        }
      })(),
      lightStatus:
        typeof (entry && entry.lightStatus) === 'boolean'
          ? entry.lightStatus
          : Boolean(lightStatus)
    };
    return migrated;
  }

  migrate(parsed, now) {
    const fallback = initialState(this.defaultConfig, now);
    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }

    let config;
    try {
      config = createConfig({
        ...this.defaultConfig,
        ...(parsed.config || {}),
        dustThresholds: {
          ...this.defaultConfig.dustThresholds,
          ...((parsed.config && parsed.config.dustThresholds) || {})
        },
        dustCalibration: {
          ...this.defaultConfig.dustCalibration,
          ...((parsed.config && parsed.config.dustCalibration) || {})
        }
      });
    } catch (error) {
      config = this.defaultConfig;
      this.loadWarning = `Invalid persisted config was replaced: ${error.message}`;
    }

    let mode = 'AUTO';
    try {
      mode = normalizeMode(parsed.mode || fallback.mode);
    } catch (error) {
      mode = fallback.mode;
    }
    let lightStatus = false;
    try {
      lightStatus = normalizeLightStatus(
        parsed.lightStatus === undefined ? fallback.lightStatus : parsed.lightStatus
      );
    } catch (error) {
      lightStatus = fallback.lightStatus;
    }

    const latestSource = parsed.latest || fallback.latest;
    const latestWithMetadata = this.migrateReading(
      latestSource,
      fallback.latest,
      config,
      mode,
      lightStatus,
      now
    );
    const latest = {
      temperature: latestWithMetadata.temperature,
      lightLevel: latestWithMetadata.lightLevel,
      motionDetected: latestWithMetadata.motionDetected,
      dust: latestWithMetadata.dust,
      sensors: latestWithMetadata.sensors,
      timestamp: latestWithMetadata.timestamp,
      source: latestWithMetadata.source,
      dataMode: latestWithMetadata.dataMode
    };
    const sourceHistory = Array.isArray(parsed.history) && parsed.history.length
      ? parsed.history
      : [latestSource];
    const history = sourceHistory.map((item) =>
      this.migrateReading(
        item,
        latest,
        config,
        mode,
        lightStatus,
        now
      )
    );
    const notifications = Array.isArray(parsed.notifications)
      ? parsed.notifications.filter((item) => item && typeof item.id === 'string')
        .map((item) => ({
          id: item.id,
          type: String(item.type || 'SYSTEM'),
          severity: String(item.severity || 'INFO'),
          title: String(item.title || ''),
          message: String(item.message || ''),
          value: item.value ?? null,
          threshold: item.threshold ?? null,
          timestamp: validTimestamp(item.timestamp, now),
          read: Boolean(item.read),
          source: String(item.source || 'backend')
        }))
      : [];
    const parsedConnection = parsed.connection || {};
    const enabled = Boolean(parsedConnection.enabled);
    const parsedSystem = parsed.system || {};
    const lightEvents = Array.isArray(parsed.lightEvents) && parsed.lightEvents.length
      ? parsed.lightEvents
        .filter((item) => item && typeof item.status === 'boolean')
        .map((item) => ({
          timestamp: validTimestamp(item.timestamp, now),
          status: item.status,
          source: String(item.source || 'backend')
        }))
      : fallback.lightEvents;

    return {
      schemaVersion: SCHEMA_VERSION,
      mode,
      lightStatus,
      config,
      latest,
      history,
      notifications,
      alertStates:
        parsed.alertStates && typeof parsed.alertStates === 'object'
          ? parsed.alertStates
          : {},
      nextNotificationId: Math.max(
        Number(parsed.nextNotificationId) || 1,
        notifications.reduce((maximum, item) => {
          const match = item.id.match(/^notification-(\d+)$/);
          return match ? Math.max(maximum, Number(match[1]) + 1) : maximum;
        }, 1)
      ),
      connection: {
        enabled,
        esp32Online: enabled ? Boolean(parsedConnection.esp32Online) : null,
        lastSeen: parsedConnection.lastSeen
          ? validTimestamp(parsedConnection.lastSeen, null)
          : null,
        lastError: parsedConnection.lastError
          ? String(parsedConnection.lastError)
          : null
      },
      system: {
        startedAt: validTimestamp(parsedSystem.startedAt, now),
        disconnectCount: Math.max(0, Number(parsedSystem.disconnectCount) || 0),
        sensorDisconnectCount: Math.max(
          0,
          Number(parsedSystem.sensorDisconnectCount) || 0
        ),
        esp32DisconnectCount: Math.max(
          0,
          Number(parsedSystem.esp32DisconnectCount) || 0
        )
      },
      sensorConnectionStates:
        parsed.sensorConnectionStates &&
        typeof parsed.sensorConnectionStates === 'object'
          ? parsed.sensorConnectionStates
          : {},
      disconnectEvents: Array.isArray(parsed.disconnectEvents)
        ? parsed.disconnectEvents
          .filter((item) => item && item.timestamp)
          .map((item) => ({
            timestamp: validTimestamp(item.timestamp, now),
            source: String(item.source || 'sensor'),
            sensor: item.sensor ? String(item.sensor) : null
          }))
        : [],
      lightEvents
    };
  }

  save() {
    if (!this.dataFile) {
      return;
    }

    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    const tempFile = `${this.dataFile}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(this.state, null, 2)}\n`);
    fs.renameSync(tempFile, this.dataFile);
  }

  trimCollections() {
    const historyLimit = this.state.config.historyLimit;
    if (this.state.history.length > historyLimit) {
      this.state.history = this.state.history.slice(-historyLimit);
    }
    if (this.state.notifications.length > this.state.config.notificationLimit) {
      this.state.notifications = this.state.notifications.slice(
        -this.state.config.notificationLimit
      );
    }
    const eventLimit = Math.max(historyLimit * 2, 100);
    if (this.state.lightEvents.length > eventLimit) {
      this.state.lightEvents = this.state.lightEvents.slice(-eventLimit);
    }
    if (this.state.disconnectEvents.length > eventLimit) {
      this.state.disconnectEvents = this.state.disconnectEvents.slice(-eventLimit);
    }
  }

  snapshot() {
    return clone(this.state);
  }

  status(now = this.now()) {
    return buildStatus(this.snapshot(), now);
  }

  refreshNotifications(now = this.now(), { save = true } = {}) {
    const status = buildStatus(this.snapshot(), now);
    for (const [name, sensor] of Object.entries(status.sensors)) {
      const previous = this.state.sensorConnectionStates[name];
      if (previous === true && !sensor.online) {
        this.state.system.sensorDisconnectCount += 1;
        this.state.system.disconnectCount += 1;
        this.state.disconnectEvents.push({
          timestamp: now,
          source: 'sensor',
          sensor: name
        });
      }
      this.state.sensorConnectionStates[name] = Boolean(sensor.online);
    }
    const candidates = buildNotificationCandidates(status, this.state.config);
    const created = applyNotificationCandidates(
      this.state,
      candidates,
      this.state.config,
      now
    );
    this.trimCollections();
    if (save) {
      this.save();
    }
    return created;
  }

  recordLightEventIfChanged(before, source, now) {
    if (Boolean(before) === Boolean(this.state.lightStatus)) {
      return;
    }
    this.state.lightEvents.push({
      timestamp: now,
      status: Boolean(this.state.lightStatus),
      source
    });
  }

  recordReading(payload, source = 'api') {
    const now = this.now();
    const normalizedDust = normalizeDustReading(payload, this.state.config, now);
    const reading = {
      ...normalizeReading(payload),
      motionDetected: normalizeMotionDetected(payload, false),
      dust: normalizedDust || clone(this.state.latest.dust),
      sensors: readingSensorMetadata(payload, now),
      timestamp: now,
      source: String(source || 'api'),
      dataMode: normalizeDataMode(
        payload.simulated === true
          ? 'SIMULATED'
          : payload.dataMode ?? payload.dataSource,
        source
      )
    };

    this.state.latest = reading;
    const before = this.state.lightStatus;
    applyAutomation(this.state);
    this.recordLightEventIfChanged(before, 'automation', now);
    this.state.history.push({
      ...clone(reading),
      mode: this.state.mode,
      lightStatus: Boolean(this.state.lightStatus)
    });
    this.trimCollections();
    this.refreshNotifications(now, { save: false });
    this.save();

    return this.status(now);
  }

  mergeRemoteStatus(payload, source = 'esp32') {
    const now = this.now();
    const beforeLight = this.state.lightStatus;
    if (payload.mode !== undefined) {
      this.state.mode = normalizeMode(payload.mode);
    }

    const legacyStatusAlias =
      payload.status !== null && typeof payload.status !== 'object'
        ? payload.status
        : undefined;
    const hasRemoteLightStatus =
      payload.lightStatus !== undefined || legacyStatusAlias !== undefined;
    if (hasRemoteLightStatus) {
      this.state.lightStatus = normalizeLightStatus(
        payload.lightStatus ?? legacyStatusAlias
      );
    }

    const hasTemperatureAndLight =
      payload.temperature !== undefined &&
      (payload.lightLevel !== undefined ||
        payload.light !== undefined ||
        payload.ldr !== undefined);
    const hasDust = extractDustPayload(payload) !== null;
    if (hasTemperatureAndLight || hasDust) {
      const sensorValues = hasTemperatureAndLight
        ? normalizeReading(payload)
        : {
          temperature: this.state.latest.temperature,
          lightLevel: this.state.latest.lightLevel
        };
      const timestamp = validTimestamp(
        payload.generatedAt || payload.timestamp,
        now
      );
      const dust = hasDust
        ? normalizeDustReading(payload, this.state.config, timestamp)
        : clone(this.state.latest.dust);
      const reading = {
        ...sensorValues,
        motionDetected: normalizeMotionDetected(
          payload,
          this.state.latest.motionDetected
        ),
        dust,
        sensors: readingSensorMetadata(payload, timestamp),
        timestamp,
        source,
        dataMode: normalizeDataMode(
          payload.simulated === true
            ? 'SIMULATED'
            : payload.dataMode ?? payload.dataSource,
          source
        )
      };
      this.state.latest = reading;
      if (!hasRemoteLightStatus) {
        applyAutomation(this.state);
      }
      this.state.history.push({
        ...clone(reading),
        mode: this.state.mode,
        lightStatus: Boolean(this.state.lightStatus)
      });
    } else if (!hasRemoteLightStatus) {
      applyAutomation(this.state);
    }

    this.recordLightEventIfChanged(beforeLight, source, now);
    this.state.connection.enabled = true;
    this.state.connection.esp32Online = true;
    this.state.connection.lastSeen = now;
    this.state.connection.lastError = null;
    this.trimCollections();
    this.refreshNotifications(now, { save: false });
    this.save();
    return this.status(now);
  }

  setEsp32Enabled(enabled) {
    const value = Boolean(enabled);
    this.state.connection.enabled = value;
    if (!value) {
      this.state.connection.esp32Online = null;
      this.state.connection.lastError = null;
    } else if (this.state.connection.esp32Online === null) {
      this.state.connection.esp32Online = false;
    }
    this.save();
  }

  markEsp32Online() {
    const now = this.now();
    this.state.connection.enabled = true;
    this.state.connection.esp32Online = true;
    this.state.connection.lastSeen = now;
    this.state.connection.lastError = null;
    this.refreshNotifications(now, { save: false });
    this.save();
  }

  markEsp32Offline(error) {
    const now = this.now();
    const wasOnline = this.state.connection.esp32Online === true;
    this.state.connection.enabled = true;
    this.state.connection.esp32Online = false;
    this.state.connection.lastError = String(error || 'ESP32 is unavailable');
    if (wasOnline) {
      this.state.system.esp32DisconnectCount += 1;
      this.state.system.disconnectCount += 1;
      this.state.disconnectEvents.push({
        timestamp: now,
        source: 'esp32',
        sensor: null
      });
    }
    this.refreshNotifications(now, { save: false });
    this.save();
  }

  setMode(mode) {
    const now = this.now();
    this.state.mode = normalizeMode(mode);
    const before = this.state.lightStatus;
    applyAutomation(this.state);
    this.recordLightEventIfChanged(before, 'mode', now);
    this.refreshNotifications(now, { save: false });
    this.save();

    return this.status(now);
  }

  setLightStatus(status, { forceManual = true } = {}) {
    const now = this.now();
    const before = this.state.lightStatus;
    this.state.lightStatus = normalizeLightStatus(status);
    if (forceManual) {
      this.state.mode = 'MANUAL';
    }
    this.recordLightEventIfChanged(before, 'manual', now);
    this.refreshNotifications(now, { save: false });
    this.save();

    return this.status(now);
  }

  updateConfig(payload) {
    const now = this.now();
    this.state.config = normalizeConfigPatch(payload, this.state.config);
    this.state.latest.dust = reclassifyDustReading(
      this.state.latest.dust,
      this.state.config.dustThresholds
    );
    this.state.history = this.state.history.map((item) => ({
      ...item,
      dust: reclassifyDustReading(item.dust, this.state.config.dustThresholds)
    }));
    const before = this.state.lightStatus;
    applyAutomation(this.state);
    this.recordLightEventIfChanged(before, 'config', now);
    this.trimCollections();
    this.refreshNotifications(now, { save: false });
    this.save();

    return this.status(now);
  }

  history(limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 5000);
    return clone(this.state.history.slice(-safeLimit));
  }

  clearHistory() {
    const now = this.now();
    this.state.history = [
      {
        ...clone(this.state.latest),
        mode: this.state.mode,
        lightStatus: Boolean(this.state.lightStatus)
      }
    ];
    this.save();

    return this.status(now);
  }

  listNotifications(limit = 50, read = undefined) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 5000);
    let items = [...this.state.notifications].reverse();
    if (read !== undefined) {
      items = items.filter((item) => item.read === read);
    }
    return clone(items.slice(0, safeLimit));
  }

  notificationSummary(limit = 50, read = undefined) {
    const items = this.listNotifications(limit, read);
    return {
      items,
      unreadCount: unreadCount(this.state.notifications),
      total: this.state.notifications.length
    };
  }

  markNotificationRead(id) {
    const notification = this.state.notifications.find((item) => item.id === id);
    if (!notification) {
      throw new HttpError(404, 'Notification not found');
    }
    notification.read = true;
    this.save();
    return clone(notification);
  }

  forecast() {
    return buildForecast(this.state.history, this.state.config, this.now());
  }

  report(period) {
    return buildReport(this.snapshot(), period, this.now());
  }
}

module.exports = {
  JsonStore,
  SCHEMA_VERSION,
  initialState
};
