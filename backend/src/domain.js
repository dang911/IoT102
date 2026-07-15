const DEFAULT_CONFIG = Object.freeze({
  temperatureThreshold: 35,
  darkThreshold: 200,
  brightThreshold: 260,
  historyLimit: 240
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

function normalizeConfigPatch(payload, currentConfig) {
  const next = { ...currentConfig };

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

  if (next.brightThreshold <= next.darkThreshold) {
    throw new HttpError(
      400,
      'brightThreshold must be greater than darkThreshold'
    );
  }

  return next;
}

function applyAutomation(state) {
  if (state.mode !== 'AUTO' || !state.latest) {
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

function calculateMetrics(history) {
  const temperatures = history
    .map((item) => Number(item.temperature))
    .filter(Number.isFinite);

  if (temperatures.length === 0) {
    return {
      sampleCount: 0,
      maxTemperature: null,
      minTemperature: null,
      avgTemperature: null
    };
  }

  const sum = temperatures.reduce((total, item) => total + item, 0);

  return {
    sampleCount: temperatures.length,
    maxTemperature: round(Math.max(...temperatures), 1),
    minTemperature: round(Math.min(...temperatures), 1),
    avgTemperature: round(sum / temperatures.length, 1)
  };
}

function buildStatus(state) {
  const latest = state.latest;
  const temperatureHigh = latest.temperature > state.config.temperatureThreshold;
  const lowLight = latest.lightLevel < state.config.darkThreshold;

  return {
    temperature: latest.temperature,
    lightLevel: latest.lightLevel,
    lightStatus: Boolean(state.lightStatus),
    mode: state.mode,
    timestamp: latest.timestamp,
    source: latest.source,
    status: {
      temperature: temperatureHigh ? 'HIGH' : 'NORMAL',
      environment: lowLight ? 'DARK' : 'BRIGHT'
    },
    alerts: {
      temperatureHigh,
      lowLight
    },
    metrics: calculateMetrics(state.history),
    thresholds: {
      temperature: state.config.temperatureThreshold,
      dark: state.config.darkThreshold,
      bright: state.config.brightThreshold
    }
  };
}

module.exports = {
  DEFAULT_CONFIG,
  HttpError,
  applyAutomation,
  buildStatus,
  calculateMetrics,
  normalizeConfigPatch,
  normalizeLightStatus,
  normalizeMode,
  normalizeReading
};
