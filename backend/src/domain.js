const {
  DEFAULT_DUST_CALIBRATION,
  DEFAULT_DUST_THRESHOLDS,
  normalizeDustCalibration,
  normalizeDustThresholds,
  reclassifyDustReading
} = require('./dust');

const DEFAULT_CONFIG = Object.freeze({
  temperatureThreshold: 35,
  darkThreshold: 200,
  brightThreshold: 260,
  historyLimit: 240,
  notificationLimit: 500,
  notificationCooldownMs: 5 * 60 * 1000,
  sensorOfflineTimeoutMs: 60 * 1000,
  forecastWindowSize: 12,
  forecastMinSamples: 4,
  forecastHorizonMinutes: 15,
  dustThresholds: DEFAULT_DUST_THRESHOLDS,
  dustCalibration: DEFAULT_DUST_CALIBRATION
});

class HttpError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function round(value, digits = 1) {
  return Number(Number(value).toFixed(digits));
}

function toNumber(value, field, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new HttpError(400, `${field} must be a valid number`);
  }

  if (number < min || number > max) {
    throw new HttpError(400, `${field} must be between ${min} and ${max}`);
  }

  return number;
}

function normalizeMode(value) {
  const mode = String(value ?? '').trim().toUpperCase();
  if (mode !== 'AUTO' && mode !== 'MANUAL') {
    throw new HttpError(400, 'mode must be AUTO or MANUAL');
  }

  return mode;
}

function normalizeLightStatus(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const status = String(value ?? '').trim().toUpperCase();
  if (['ON', 'TRUE', '1'].includes(status)) {
    return true;
  }

  if (['OFF', 'FALSE', '0'].includes(status)) {
    return false;
  }

  throw new HttpError(400, 'status must be ON, OFF, true, or false');
}

function normalizeDataMode(value, source = '') {
  if (value === undefined || value === null || value === '') {
    const normalizedSource = String(source).trim().toLowerCase();
    return ['seed', 'simulation', 'simulated', 'demo'].includes(normalizedSource)
      ? 'SIMULATED'
      : 'REAL';
  }

  const mode = String(value).trim().toUpperCase();
  if (['REAL_SENSOR', 'HARDWARE', 'LIVE'].includes(mode)) {
    return 'REAL';
  }
  if (['SIMULATION', 'DEMO', 'SEED'].includes(mode)) {
    return 'SIMULATED';
  }
  if (!['REAL', 'SIMULATED'].includes(mode)) {
    throw new HttpError(400, 'dataMode must be REAL or SIMULATED');
  }
  return mode;
}

function normalizeReading(payload) {
  const temperature = toNumber(
    payload.temperature ?? payload.temp,
    'temperature',
    -55,
    150
  );
  const lightLevel = toNumber(
    payload.lightLevel ?? payload.light ?? payload.ldr,
    'lightLevel',
    0,
    100000
  );

  return {
    temperature: round(temperature, 1),
    lightLevel: Math.round(lightLevel)
  };
}

function normalizeMotionDetected(payload = {}, fallback = false) {
  const value = payload.motionDetected ?? payload.presenceDetected ??
    payload.intruderDetected ?? payload.alerts?.intruderDetected;
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'motion'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', 'clear'].includes(normalized)) return false;
  throw new HttpError(400, 'motionDetected must be a boolean');
}

function cloneDefaultConfig() {
  return {
    ...DEFAULT_CONFIG,
    dustThresholds: { ...DEFAULT_DUST_THRESHOLDS },
    dustCalibration: { ...DEFAULT_DUST_CALIBRATION }
  };
}

function normalizeConfigPatch(payload = {}, currentConfig = cloneDefaultConfig()) {
  if (payload.dustThresholds !== undefined && (
    !payload.dustThresholds ||
    typeof payload.dustThresholds !== 'object' ||
    Array.isArray(payload.dustThresholds)
  )) {
    throw new HttpError(400, 'dustThresholds must be an object');
  }
  if (payload.dustCalibration !== undefined && (
    !payload.dustCalibration ||
    typeof payload.dustCalibration !== 'object' ||
    Array.isArray(payload.dustCalibration)
  )) {
    throw new HttpError(400, 'dustCalibration must be an object');
  }
  const next = {
    ...cloneDefaultConfig(),
    ...(currentConfig || {}),
    dustThresholds: {
      ...DEFAULT_DUST_THRESHOLDS,
      ...((currentConfig && currentConfig.dustThresholds) || {})
    },
    dustCalibration: {
      ...DEFAULT_DUST_CALIBRATION,
      ...((currentConfig && currentConfig.dustCalibration) || {})
    }
  };

  if (payload.temperatureThreshold !== undefined) {
    next.temperatureThreshold = round(
      toNumber(payload.temperatureThreshold, 'temperatureThreshold', -55, 150),
      1
    );
  }

  if (payload.darkThreshold !== undefined) {
    next.darkThreshold = Math.round(
      toNumber(payload.darkThreshold, 'darkThreshold', 0, 100000)
    );
  }

  if (payload.brightThreshold !== undefined) {
    next.brightThreshold = Math.round(
      toNumber(payload.brightThreshold, 'brightThreshold', 0, 100000)
    );
  }

  if (payload.historyLimit !== undefined) {
    next.historyLimit = Math.round(
      toNumber(payload.historyLimit, 'historyLimit', 1, 5000)
    );
  }

  if (payload.notificationLimit !== undefined) {
    next.notificationLimit = Math.round(
      toNumber(payload.notificationLimit, 'notificationLimit', 1, 5000)
    );
  }

  if (payload.notificationCooldownMs !== undefined) {
    next.notificationCooldownMs = Math.round(
      toNumber(payload.notificationCooldownMs, 'notificationCooldownMs', 0, 86400000)
    );
  }

  if (payload.sensorOfflineTimeoutMs !== undefined) {
    next.sensorOfflineTimeoutMs = Math.round(
      toNumber(payload.sensorOfflineTimeoutMs, 'sensorOfflineTimeoutMs', 100, 604800000)
    );
  }

  if (payload.forecastWindowSize !== undefined) {
    next.forecastWindowSize = Math.round(
      toNumber(payload.forecastWindowSize, 'forecastWindowSize', 2, 1000)
    );
  }

  if (payload.forecastMinSamples !== undefined) {
    next.forecastMinSamples = Math.round(
      toNumber(payload.forecastMinSamples, 'forecastMinSamples', 2, 1000)
    );
  }

  if (payload.forecastHorizonMinutes !== undefined) {
    next.forecastHorizonMinutes = Math.round(
      toNumber(payload.forecastHorizonMinutes, 'forecastHorizonMinutes', 1, 1440)
    );
  }

  const thresholdPatch = {
    ...(payload.dustThresholds || {})
  };
  if (payload.dustModerateThreshold !== undefined) {
    thresholdPatch.moderate = payload.dustModerateThreshold;
  }
  if (payload.dustHighThreshold !== undefined) {
    thresholdPatch.high = payload.dustHighThreshold;
  }
  if (payload.dustDangerousThreshold !== undefined) {
    thresholdPatch.dangerous = payload.dustDangerousThreshold;
  }
  next.dustThresholds = normalizeDustThresholds(
    thresholdPatch,
    next.dustThresholds
  );

  const calibrationPatch = {
    ...(payload.dustCalibration || {})
  };
  if (payload.cleanAirVoltage !== undefined) {
    calibrationPatch.cleanAirVoltage = payload.cleanAirVoltage;
  }
  if (payload.dustZeroVoltage !== undefined) {
    calibrationPatch.cleanAirVoltage = payload.dustZeroVoltage;
  }
  if (payload.dustSensitivity !== undefined) {
    calibrationPatch.sensitivity = payload.dustSensitivity;
  }
  if (payload.calibrationFactor !== undefined) {
    calibrationPatch.calibrationFactor = payload.calibrationFactor;
  }
  if (payload.dustCalibrationFactor !== undefined) {
    calibrationPatch.calibrationFactor = payload.dustCalibrationFactor;
  }
  if (payload.dustCalibrationOffset !== undefined) {
    calibrationPatch.offsetUgM3 = payload.dustCalibrationOffset;
  }
  if (payload.dustCalibrated !== undefined) {
    calibrationPatch.calibrated = payload.dustCalibrated;
  }
  next.dustCalibration = normalizeDustCalibration(
    calibrationPatch,
    next.dustCalibration
  );

  if (next.brightThreshold <= next.darkThreshold) {
    throw new HttpError(
      400,
      'brightThreshold must be greater than darkThreshold'
    );
  }

  if (next.forecastMinSamples > next.forecastWindowSize) {
    throw new HttpError(
      400,
      'forecastMinSamples cannot be greater than forecastWindowSize'
    );
  }

  return next;
}

function createConfig(overrides = {}) {
  return normalizeConfigPatch(overrides, cloneDefaultConfig());
}

function applyAutomation(state) {
  if (state.mode !== 'AUTO' || !state.latest) {
    return false;
  }
  const lightSensor = state.latest.sensors && state.latest.sensors.light;
  if (lightSensor && (lightSensor.online === false || lightSensor.abnormal)) {
    return false;
  }

  const before = state.lightStatus;
  const lightLevel = Number(state.latest.lightLevel);

  if (lightLevel < state.config.darkThreshold) {
    state.lightStatus = true;
  } else if (lightLevel >= state.config.brightThreshold) {
    state.lightStatus = false;
  }

  return before !== state.lightStatus;
}

function summarize(values, digits = 1) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (numbers.length === 0) {
    return { count: 0, min: null, max: null, average: null };
  }
  const sum = numbers.reduce((total, item) => total + item, 0);
  return {
    count: numbers.length,
    min: round(Math.min(...numbers), digits),
    max: round(Math.max(...numbers), digits),
    average: round(sum / numbers.length, digits)
  };
}

function calculateMetrics(history) {
  const temperature = summarize(history.map((item) => {
    const sensor = item.sensors && item.sensors.temperature;
    return sensor && (sensor.online === false || sensor.abnormal)
      ? NaN
      : item.temperature;
  }), 1);
  const light = summarize(history.map((item) => {
    const sensor = item.sensors && item.sensors.light;
    return sensor && (sensor.online === false || sensor.abnormal)
      ? NaN
      : item.lightLevel;
  }), 0);
  const dust = summarize(
    history.map((item) =>
      item.dust && item.dust.valid !== false ? item.dust.density : NaN
    ),
    1
  );

  return {
    sampleCount: temperature.count,
    maxTemperature: temperature.max,
    minTemperature: temperature.min,
    avgTemperature: temperature.average,
    maxLightLevel: light.max,
    minLightLevel: light.min,
    avgLightLevel: light.average,
    dustSampleCount: dust.count,
    maxDustDensity: dust.max,
    minDustDensity: dust.min,
    avgDustDensity: dust.average
  };
}

function timestampIsFresh(timestamp, nowMs, timeoutMs) {
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  return nowMs - timestampMs <= timeoutMs;
}

function buildStatus(state, now = new Date().toISOString()) {
  const latest = state.latest || {};
  const nowMs = Date.parse(now);
  const timeoutMs = state.config.sensorOfflineTimeoutMs;
  const temperatureMetadata =
    (latest.sensors && latest.sensors.temperature) || {};
  const lightMetadata = (latest.sensors && latest.sensors.light) || {};
  const temperatureLastUpdate =
    temperatureMetadata.lastUpdate || latest.timestamp || null;
  const lightLastUpdate = lightMetadata.lastUpdate || latest.timestamp || null;
  const temperature = Number(latest.temperature);
  const lightLevel = Number(latest.lightLevel);

  const dust = reclassifyDustReading(
    latest.dust,
    state.config.dustThresholds
  );
  const dustFresh = timestampIsFresh(dust.lastUpdate, nowMs, timeoutMs);
  dust.sensorOnline = Boolean(dust.sensorOnline && dust.valid && dustFresh);
  if (!dust.sensorOnline && dust.valid && !dustFresh) {
    dust.error = 'STALE_DATA';
  }
  const dustHigh = dust.sensorOnline &&
    Number(dust.density) >= state.config.dustThresholds.high;
  const dustSensorOffline = !dust.sensorOnline;
  const temperatureAbnormal = Boolean(temperatureMetadata.abnormal);
  const lightAbnormal = Boolean(lightMetadata.abnormal);
  const temperatureOnline =
    Number.isFinite(temperature) &&
    temperatureMetadata.online !== false &&
    !temperatureAbnormal &&
    timestampIsFresh(temperatureLastUpdate, nowMs, timeoutMs);
  const lightOnline =
    Number.isFinite(lightLevel) &&
    lightMetadata.online !== false &&
    !lightAbnormal &&
    timestampIsFresh(lightLastUpdate, nowMs, timeoutMs);
  const temperatureHigh = temperatureOnline &&
    temperature > state.config.temperatureThreshold;
  const lowLight = lightOnline && lightLevel < state.config.darkThreshold;
  const sensorAbnormal = temperatureAbnormal || lightAbnormal || Boolean(dust.abnormal);
  const motionDetected = Boolean(latest.motionDetected);

  let environmentQuality = 'NORMAL';
  if (dust.level === 'DANGEROUS') {
    environmentQuality = 'DANGEROUS';
  } else if (dustHigh || temperatureHigh) {
    environmentQuality = 'POOR';
  } else if (dust.level === 'MODERATE') {
    environmentQuality = 'MODERATE';
  }

  return {
    temperature: Number.isFinite(temperature) ? temperature : null,
    lightLevel: Number.isFinite(lightLevel) ? lightLevel : null,
    lightStatus: Boolean(state.lightStatus),
    mode: state.mode,
    timestamp: latest.timestamp || null,
    source: latest.source || 'unknown',
    dataMode: latest.dataMode || normalizeDataMode(undefined, latest.source),
    motionDetected,
    dust,
    sensors: {
      temperature: {
        online: temperatureOnline,
        abnormal: temperatureAbnormal,
        lastUpdate: temperatureLastUpdate,
        error: temperatureMetadata.error || null
      },
      light: {
        online: lightOnline,
        abnormal: lightAbnormal,
        lastUpdate: lightLastUpdate,
        error: lightMetadata.error || null
      },
      dust: {
        online: dust.sensorOnline,
        abnormal: Boolean(dust.abnormal),
        lastUpdate: dust.lastUpdate,
        error: dust.error
      }
    },
    connection: {
      enabled: Boolean(state.connection && state.connection.enabled),
      esp32Online:
        state.connection && state.connection.enabled
          ? Boolean(state.connection.esp32Online)
          : null,
      lastSeen: (state.connection && state.connection.lastSeen) || null,
      lastError: (state.connection && state.connection.lastError) || null
    },
    status: {
      temperature: temperatureHigh ? 'HIGH' : 'NORMAL',
      environment: lowLight ? 'DARK' : 'BRIGHT',
      dust: dust.level,
      environmentQuality
    },
    alerts: {
      temperatureHigh,
      lowLight,
      dustHigh,
      dustSensorOffline,
      sensorAbnormal,
      intruderDetected: motionDetected
    },
    metrics: calculateMetrics(state.history || []),
    thresholds: {
      temperature: state.config.temperatureThreshold,
      dark: state.config.darkThreshold,
      bright: state.config.brightThreshold,
      dust: { ...state.config.dustThresholds }
    }
  };
}

module.exports = {
  DEFAULT_CONFIG,
  HttpError,
  applyAutomation,
  buildStatus,
  calculateMetrics,
  createConfig,
  normalizeConfigPatch,
  normalizeDataMode,
  normalizeLightStatus,
  normalizeMotionDetected,
  normalizeMode,
  normalizeReading,
  round,
  summarize
};
