class Esp32Gateway {
  constructor({ baseUrl = '', timeoutMs = 2500 } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.timeoutMs = Number(timeoutMs) || 2500;
  }

  get enabled() {
    return this.baseUrl.length > 0;
  }

  async request(path, options = {}) {
    if (!this.enabled) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(options.headers || {})
        }
      });

      const text = await response.text();
      let data = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (error) {
          throw new Error('ESP32 returned invalid JSON');
        }
      }

      if (!response.ok) {
        throw new Error(data.error || `ESP32 returned HTTP ${response.status}`);
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  readStatus() {
    return this.request('/api/status');
  }

  setMode(mode) {
    return this.request('/api/mode', {
      method: 'POST',
      body: JSON.stringify({ mode })
    });
  }

  setLight(status) {
    return this.request('/api/light', {
      method: 'POST',
      body: JSON.stringify({ status: status ? 'ON' : 'OFF' })
    });
  }
}

module.exports = {
  Esp32Gateway
};
