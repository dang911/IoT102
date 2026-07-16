const DEFAULT_DUST_THRESHOLDS = Object.freeze({
  moderate: 50,
  high: 150,
  dangerous: 300
});

// These are project defaults, not an official AQI scale. The voltage and
// sensitivity values must be calibrated against the actual sensor and circuit.
const DEFAULT_DUST_CALIBRATION = Object.freeze({
  cleanAirVoltage: 0.9,
  sensitivity: 0.005,
  calibrationFactor: 1,
  offsetUgM3: 0,
  calibrated: false,
  adcReferenceVoltage: 3.3,
  adcMax: 4095,
  voltageDividerRatio: 12 / 22,
  maxSensorVoltage: 5.1
});

const MAX_DUST_DENSITY = 10000;
const DUST_CLASSIFICATION = 'INTERNAL_PROJECT_THRESHOLDS_NOT_AQI';
const DUST_DISCLAIMER =
  'Mật độ bụi ước tính – chỉ dùng cho mục đích học tập và theo dõi xu hướng.';

function validationError(message) {
  const error = new Error(message);
  error.name = 'HttpError';
  error.statusCode = 400;
  return error;
}

function round(value, digits = 1) {
  return Number(Number(value).toFixed(digits));
}

function numberInRange(value, field, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw validationError(`${field} must be a valid number`);
  }
  if (number < min || number > max) {
    throw validationError(`${field} must be between ${min} and ${max}`);
  }
  return number;
}

function normalizeBoolean(value, field, fallback) {
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
  throw validationError(`${field} must be a boolean`);
}

function normalizeDustThresholds(value = {}, current = DEFAULT_DUST_THRESHOLDS) {
  const next = {
    ...DEFAULT_DUST_THRESHOLDS,
    ...(current || {})
  };

  for (const key of ['moderate', 'high', 'dangerous']) {
    if (value[key] !== undefined) {
      next[key] = round(numberInRange(value[key], `dustThresholds.${key}`, 0, MAX_DUST_DENSITY), 1);
    }
  }

  if (!(next.moderate < next.high && next.high < next.dangerous)) {
    throw validationError(
      'dustThresholds must satisfy moderate < high < dangerous'
    );
  }

  return next;
}

function normalizeDustCalibration(value = {}, current = DEFAULT_DUST_CALIBRATION) {
  const next = {
    ...DEFAULT_DUST_CALIBRATION,
    ...(current || {})
  };

  if (value.cleanAirVoltage !== undefined) {
    next.cleanAirVoltage = round(
      numberInRange(value.cleanAirVoltage, 'dustCalibration.cleanAirVoltage', 0, 5),
      4
    );
  }
  if (value.sensitivity !== undefined) {
    next.sensitivity = round(
      numberInRange(value.sensitivity, 'dustCalibration.sensitivity', 0.000001, 1),
      6
    );
  }
  if (value.calibrationFactor !== undefined) {
    next.calibrationFactor = round(
      numberInRange(value.calibrationFactor, 'dustCalibration.calibrationFactor', 0.01, 100),
      4
    );
  }
  if (value.offsetUgM3 !== undefined) {
    next.offsetUgM3 = round(
      numberInRange(value.offsetUgM3, 'dustCalibration.offsetUgM3', -10000, 10000),
      2
    );
  }
  if (value.adcReferenceVoltage !== undefined) {
    next.adcReferenceVoltage = round(
      numberInRange(value.adcReferenceVoltage, 'dustCalibration.adcReferenceVoltage', 1, 5),
      4
    );
  }
  if (value.adcMax !== undefined) {
    next.adcMax = Math.round(
      numberInRange(value.adcMax, 'dustCalibration.adcMax', 255, 65535)
    );
  }
  if (value.voltageDividerRatio !== undefined) {
    next.voltageDividerRatio = round(
      numberInRange(
        value.voltageDividerRatio,
        'dustCalibration.voltageDividerRatio',
        0.01,
        1
      ),
      6
    );
  }
  if (value.maxSensorVoltage !== undefined) {
    next.maxSensorVoltage = round(
      numberInRange(
        value.maxSensorVoltage,
        'dustCalibration.maxSensorVoltage',
        1,
        10
      ),
      4
    );
  }
  if (value.calibrated !== undefined) {
    next.calibrated = normalizeBoolean(
      value.calibrated,
      'dustCalibration.calibrated',
      false
    );
  }

  if (next.cleanAirVoltage > next.maxSensorVoltage) {
    throw validationError(
      'dustCalibration.cleanAirVoltage cannot exceed maxSensorVoltage'
    );
  }

  return next;
}

function classifyDustDensity(density, thresholds = DEFAULT_DUST_THRESHOLDS) {
  if (density === null || density === undefined || !Number.isFinite(Number(density))) {
    return 'UNKNOWN';
  }

  const value = Math.max(0, Number(density));
  if (value < thresholds.moderate) {
    return 'CLEAN';
  }
  if (value < thresholds.high) {
    return 'MODERATE';
  }
  if (value < thresholds.dangerous) {
    return 'HIGH';
  }
  return 'DANGEROUS';
}

function calculateDustDensity(voltage, calibration = DEFAULT_DUST_CALIBRATION) {
  const voltageAboveBaseline = Number(voltage) - Number(calibration.cleanAirVoltage);
  const density =
    (voltageAboveBaseline / Number(calibration.sensitivity)) *
    Number(calibration.calibrationFactor) + Number(calibration.offsetUgM3 || 0);
  return round(Math.max(0, density), 1);
}

function firstDefined(object, keys) {
  for (const key of keys) {
    if (object[key] !== undefined) {
      return object[key];
    }
  }
  return undefined;
}

function extractDustPayload(payload = {}) {
  if (payload.dust !== undefined) {
    if (payload.dust === null) {
      return { sensorOnline: false, error: 'NO_DATA' };
    }
    if (typeof payload.dust === 'number' || typeof payload.dust === 'string') {
      return { density: payload.dust };
    }
    if (typeof payload.dust !== 'object' || Array.isArray(payload.dust)) {
      throw validationError('dust must be an object, number, or null');
    }
    return { ...payload.dust };
  }

  const flatFields = {
    rawAdc: firstDefined(payload, ['dustRawAdc', 'rawAdc', 'dustAdc']),
    adcVoltage: firstDefined(payload, ['dustAdcVoltage']),
    voltage: firstDefined(payload, ['dustVoltage']),
    density: firstDefined(payload, ['dustDensity']),
    sensorOnline: firstDefined(payload, ['dustSensorOnline']),
    calibrated: firstDefined(payload, ['dustCalibrated']),
    lastUpdate: firstDefined(payload, ['dustLastUpdate']),
    valid: firstDefined(payload, ['dustValid']),
    abnormal: firstDefined(payload, ['dustAbnormal']),
    saturated: firstDefined(payload, ['dustSaturated']),
    error: firstDefined(payload, ['dustError'])
  };
  const present = Object.values(flatFields).some((value) => value !== undefined);
  return present ? flatFields : null;
}

function normalizeTimestamp(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw validationError('dust.lastUpdate must be a valid date');
  }
  return timestamp.toISOString();
}

function createOfflineDust({ lastUpdate = null, error = 'NO_DATA', calibrated = false } = {}) {
  return {
    rawAdc: null,
    adcVoltage: null,
    voltage: null,
    density: null,
    unit: 'ug/m3',
    level: 'UNKNOWN',
    classification: DUST_CLASSIFICATION,
    disclaimer: DUST_DISCLAIMER,
    sensorOnline: false,
    calibrated: Boolean(calibrated),
    lastUpdate,
    valid: false,
    abnormal: false,
    saturated: false,
    error
  };
}

function normalizeDustReading(payload, config, now = new Date().toISOString()) {
  const input = extractDustPayload(payload);
  if (input === null) {
    return null;
  }

  const calibration = config.dustCalibration || DEFAULT_DUST_CALIBRATION;
  const thresholds = config.dustThresholds || DEFAULT_DUST_THRESHOLDS;
  const sensorOnline = normalizeBoolean(
    input.sensorOnline,
    'dust.sensorOnline',
    true
  );
  const reportedValid = normalizeBoolean(input.valid, 'dust.valid', sensorOnline);

  let rawAdc = null;
  if (input.rawAdc !== undefined && input.rawAdc !== null && input.rawAdc !== '') {
    rawAdc = numberInRange(
      input.rawAdc,
      'dust.rawAdc',
      0,
      calibration.adcMax
    );
    if (!Number.isInteger(rawAdc)) {
      throw validationError('dust.rawAdc must be an integer');
    }
  }
  const saturated = normalizeBoolean(input.saturated, 'dust.saturated', false) ||
    (rawAdc !== null && (rawAdc <= 4 || rawAdc >= calibration.adcMax - 4));
  const abnormal = normalizeBoolean(input.abnormal, 'dust.abnormal', false) || saturated;
  const validFlag = reportedValid && !abnormal;

  let voltage = null;
  let adcVoltage = null;
  if (
    input.adcVoltage !== undefined &&
    input.adcVoltage !== null &&
    input.adcVoltage !== ''
  ) {
    adcVoltage = round(
      numberInRange(
        input.adcVoltage,
        'dust.adcVoltage',
        0,
        calibration.adcReferenceVoltage
      ),
      4
    );
  } else if (rawAdc !== null) {
    adcVoltage = round(
      (rawAdc / calibration.adcMax) * calibration.adcReferenceVoltage,
      4
    );
  }

  if (input.voltage !== undefined && input.voltage !== null && input.voltage !== '') {
    voltage = round(
      numberInRange(
        input.voltage,
        'dust.voltage',
        0,
        calibration.maxSensorVoltage
      ),
      4
    );
  } else if (adcVoltage !== null) {
    voltage = round(
      adcVoltage / calibration.voltageDividerRatio,
      4
    );
    if (voltage > calibration.maxSensorVoltage && !saturated) {
      throw validationError(
        `dust.voltage must be between 0 and ${calibration.maxSensorVoltage}`
      );
    }
  }

  let density = null;
  if (input.density !== undefined && input.density !== null && input.density !== '') {
    density = round(
      numberInRange(input.density, 'dust.density', 0, MAX_DUST_DENSITY),
      1
    );
  } else if (voltage !== null && !saturated) {
    density = calculateDustDensity(voltage, calibration);
  }

  if (sensorOnline && validFlag && density === null) {
    throw validationError(
      'dust.density, dust.voltage, or dust.rawAdc is required when the sensor is online'
    );
  }

  const valid = Boolean(sensorOnline && validFlag && density !== null);
  const error = valid
    ? null
    : String(
      input.error ||
      (saturated ? 'ADC_SATURATED' : sensorOnline ? 'INVALID_READING' : 'OFFLINE')
    );
  const calibrated = normalizeBoolean(
    input.calibrated,
    'dust.calibrated',
    calibration.calibrated
  );

  return {
    rawAdc,
    adcVoltage,
    voltage,
    density,
    unit: 'ug/m3',
    level: valid ? classifyDustDensity(density, thresholds) : 'UNKNOWN',
    classification: DUST_CLASSIFICATION,
    disclaimer: DUST_DISCLAIMER,
    sensorOnline,
    calibrated,
    lastUpdate: normalizeTimestamp(input.lastUpdate, now),
    valid,
    abnormal,
    saturated,
    error
  };
}

function reclassifyDustReading(reading, thresholds) {
  if (!reading) {
    return createOfflineDust();
  }
  const next = { ...reading, unit: 'ug/m3' };
  next.level = next.valid && Number.isFinite(Number(next.density))
    ? classifyDustDensity(Number(next.density), thresholds)
    : 'UNKNOWN';
  return next;
}

module.exports = {
  DEFAULT_DUST_CALIBRATION,
  DEFAULT_DUST_THRESHOLDS,
  DUST_CLASSIFICATION,
  DUST_DISCLAIMER,
  MAX_DUST_DENSITY,
  calculateDustDensity,
  classifyDustDensity,
  createOfflineDust,
  extractDustPayload,
  normalizeDustCalibration,
  normalizeDustReading,
  normalizeDustThresholds,
  reclassifyDustReading
};
