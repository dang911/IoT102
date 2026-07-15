const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_CONFIG,
  applyAutomation,
  buildStatus,
  normalizeConfigPatch,
  normalizeLightStatus,
  normalizeMode,
  normalizeReading
} = require('./domain');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function initialState(config = {}) {
  const now = new Date().toISOString();
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...config
  };
  const latest = {
    temperature: 28,
    lightLevel: 420,
    timestamp: now,
    source: 'seed'
  };

  return {
    mode: 'AUTO',
    lightStatus: false,
    config: mergedConfig,
    latest,
    history: [latest]
  };
}

class JsonStore {
  constructor({ dataFile, config = {} }) {
    this.dataFile = dataFile;
    this.defaultConfig = {
      ...DEFAULT_CONFIG,
      ...config
    };
    this.state = this.load();
    this.state.config = {
      ...this.defaultConfig,
      ...(this.state.config || {})
    };
    this.trimHistory();
    applyAutomation(this.state);
    this.save();
  }

  load() {
    if (!this.dataFile || !fs.existsSync(this.dataFile)) {
      return initialState(this.defaultConfig);
    }

    const raw = fs.readFileSync(this.dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    const fallback = initialState(this.defaultConfig);

    return {
      ...fallback,
      ...parsed,
      config: {
        ...fallback.config,
        ...(parsed.config || {})
      },
      latest: parsed.latest || fallback.latest,
      history: Array.isArray(parsed.history) ? parsed.history : fallback.history
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

  trimHistory() {
    const limit = this.state.config.historyLimit;
    if (this.state.history.length > limit) {
      this.state.history = this.state.history.slice(-limit);
    }
  }

  snapshot() {
    return clone(this.state);
  }

  status() {
    return buildStatus(this.snapshot());
  }

  recordReading(payload, source = 'api') {
    const reading = {
      ...normalizeReading(payload),
      timestamp: new Date().toISOString(),
      source
    };

    this.state.latest = reading;
    this.state.history.push(reading);
    this.trimHistory();
    applyAutomation(this.state);
    this.save();

    return this.status();
  }

  mergeRemoteStatus(payload, source = 'esp32') {
    if (payload.mode !== undefined) {
      this.state.mode = normalizeMode(payload.mode);
    }

    if (payload.lightStatus !== undefined || payload.status !== undefined) {
      this.state.lightStatus = normalizeLightStatus(
        payload.lightStatus ?? payload.status
      );
    }

    if (
      payload.temperature !== undefined &&
      (payload.lightLevel !== undefined ||
        payload.light !== undefined ||
        payload.ldr !== undefined)
    ) {
      const reading = {
        ...normalizeReading(payload),
        timestamp: payload.timestamp || new Date().toISOString(),
        source
      };
      this.state.latest = reading;
      this.state.history.push(reading);
      this.trimHistory();
    }

    if (payload.lightStatus === undefined && payload.status === undefined) {
      applyAutomation(this.state);
    }

    this.save();
    return this.status();
  }

  setMode(mode) {
    this.state.mode = normalizeMode(mode);
    applyAutomation(this.state);
    this.save();

    return this.status();
  }

  setLightStatus(status, { forceManual = true } = {}) {
    this.state.lightStatus = normalizeLightStatus(status);
    if (forceManual) {
      this.state.mode = 'MANUAL';
    }
    this.save();

    return this.status();
  }

  updateConfig(payload) {
    this.state.config = normalizeConfigPatch(payload, this.state.config);
    this.trimHistory();
    applyAutomation(this.state);
    this.save();

    return this.status();
  }

  history(limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 5000);
    return this.state.history.slice(-safeLimit);
  }

  clearHistory() {
    this.state.history = [this.state.latest];
    this.save();

    return this.status();
  }
}

module.exports = {
  JsonStore,
  initialState
};
