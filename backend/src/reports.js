const { round, summarize } = require('./domain');

function reportWindow(period, now) {
  const endMs = Date.parse(now);
  const durationMs = period === 'weekly'
    ? 7 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  return {
    from: new Date(endMs - durationMs).toISOString(),
    to: new Date(endMs).toISOString()
  };
}

function inWindow(timestamp, fromMs, toMs) {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value >= fromMs && value <= toMs;
}

function publicSummary(values, digits) {
  const result = summarize(values, digits);
  return {
    min: result.min,
    max: result.max,
    average: result.average,
    sampleCount: result.count
  };
}

function sensorReadingValid(item, sensorName) {
  const sensor = item.sensors && item.sensors[sensorName];
  return !sensor || (sensor.online !== false && !sensor.abnormal);
}

function buildRecommendations(statistics, thresholds, disconnectCount) {
  const recommendations = [];
  if (
    statistics.temperature.max !== null &&
    statistics.temperature.max > thresholds.temperatureThreshold
  ) {
    recommendations.push('Mở cửa hoặc tăng thông gió để giảm nhiệt độ trong phòng.');
  }
  if (disconnectCount > 0) {
    recommendations.push('Kiểm tra nguồn và kết nối Wi-Fi của ESP32.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Tiếp tục theo dõi nhiệt độ và ánh sáng định kỳ.');
  }
  return recommendations;
}

function buildAssessment(statistics, thresholds) {
  if (statistics.sampleCount === 0) {
    return 'Không đủ dữ liệu trong khoảng báo cáo.';
  }
  if (
    statistics.temperature.max !== null &&
    statistics.temperature.max > thresholds.temperatureThreshold
  ) {
    return 'Điều kiện môi trường có thời điểm vượt ngưỡng cảnh báo nội bộ.';
  }
  return 'Các mẫu trong khoảng báo cáo nhìn chung nằm trong ngưỡng cảnh báo nội bộ.';
}

function calculateLedDurations(lightEvents, fromMs, toMs, fallbackStatus) {
  const events = (lightEvents || [])
    .map((item) => ({ ...item, time: Date.parse(item.timestamp) }))
    .filter((item) => Number.isFinite(item.time) && item.time <= toMs)
    .sort((a, b) => a.time - b.time);
  if (toMs <= fromMs) {
    return { durationMs: 0, onMs: 0, offMs: 0, onRatio: null, offRatio: null };
  }

  const beforeWindow = events.filter((item) => item.time <= fromMs);
  let currentStatus = beforeWindow.length
    ? Boolean(beforeWindow[beforeWindow.length - 1].status)
    : Boolean(fallbackStatus);
  let cursor = fromMs;
  let onMs = 0;
  let offMs = 0;

  for (const event of events.filter((item) => item.time > fromMs)) {
    const duration = Math.max(0, event.time - cursor);
    if (currentStatus) {
      onMs += duration;
    } else {
      offMs += duration;
    }
    cursor = event.time;
    currentStatus = Boolean(event.status);
  }

  const finalDuration = Math.max(0, toMs - cursor);
  if (currentStatus) {
    onMs += finalDuration;
  } else {
    offMs += finalDuration;
  }
  const durationMs = onMs + offMs;
  return {
    durationMs,
    onMs,
    offMs,
    onRatio: durationMs ? round(onMs / durationMs, 3) : null,
    offRatio: durationMs ? round(offMs / durationMs, 3) : null
  };
}

function buildReport(state, period, now = new Date().toISOString()) {
  const window = reportWindow(period, now);
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);
  const history = (state.history || []).filter((item) =>
    inWindow(item.timestamp, fromMs, toMs)
  );
  const notifications = (state.notifications || []).filter((item) =>
    inWindow(item.timestamp, fromMs, toMs)
  );
  const temperatureHistory = history.filter((item) =>
    sensorReadingValid(item, 'temperature')
  );
  const lightHistory = history.filter((item) =>
    sensorReadingValid(item, 'light')
  );
  const temperature = publicSummary(
    temperatureHistory.map((item) => item.temperature),
    1
  );
  const light = publicSummary(lightHistory.map((item) => item.lightLevel), 0);
  const statistics = {
    sampleCount: history.length,
    temperature,
    light
  };

  const systemStartedAt = state.system && state.system.startedAt;
  const activeFromMs = Number.isFinite(Date.parse(systemStartedAt))
    ? Math.max(fromMs, Date.parse(systemStartedAt))
    : fromMs;
  const ledDurations = calculateLedDurations(
    state.lightEvents,
    activeFromMs,
    toMs,
    state.lightStatus
  );
  const uptimeMs = Number.isFinite(Date.parse(systemStartedAt))
    ? Math.max(0, toMs - Math.max(fromMs, Date.parse(systemStartedAt)))
    : 0;
  const hasDisconnectEvents = Array.isArray(state.disconnectEvents);
  const disconnectEvents = hasDisconnectEvents
    ? state.disconnectEvents.filter((item) => inWindow(item.timestamp, fromMs, toMs))
    : [];
  const disconnectCount = hasDisconnectEvents
    ? disconnectEvents.length
    : Number(state.system && state.system.disconnectCount) || 0;
  const sensorDisconnectCount = hasDisconnectEvents
    ? disconnectEvents.filter((item) => item.source === 'sensor').length
    : Number(state.system && state.system.sensorDisconnectCount) || 0;
  const esp32DisconnectCount = hasDisconnectEvents
    ? disconnectEvents.filter((item) => item.source === 'esp32').length
    : Number(state.system && state.system.esp32DisconnectCount) || 0;
  const realSamples = history.filter((item) => item.dataMode === 'REAL').length;
  const simulatedSamples = history.filter((item) => item.dataMode === 'SIMULATED').length;

  return {
    period,
    generatedAt: now,
    from: window.from,
    to: window.to,
    sampleCount: history.length,
    dataModes: {
      realSamples,
      simulatedSamples
    },
    statistics,
    thresholdExceedances: {
      temperature: temperatureHistory.filter(
        (item) => Number(item.temperature) > state.config.temperatureThreshold
      ).length
    },
    notifications: {
      total: notifications.length,
      unread: notifications.filter((item) => !item.read).length
    },
    led: {
      ...ledDurations
    },
    system: {
      startedAt: systemStartedAt || null,
      uptimeMs,
      disconnectCount,
      sensorDisconnectCount,
      esp32DisconnectCount
    },
    assessment: buildAssessment(statistics, state.config),
    recommendations: buildRecommendations(statistics, state.config, disconnectCount)
  };
}

function escapeCsv(value) {
  const text = value === null || value === undefined
    ? ''
    : Array.isArray(value)
      ? value.join(' | ')
      : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function reportToCsv(report) {
  const rows = [
    ['section', 'metric', 'value', 'unit'],
    ['report', 'period', report.period, ''],
    ['report', 'from', report.from, ''],
    ['report', 'to', report.to, ''],
    ['report', 'sampleCount', report.sampleCount, 'samples'],
    ['temperature', 'min', report.statistics.temperature.min, '°C'],
    ['temperature', 'max', report.statistics.temperature.max, '°C'],
    ['temperature', 'average', report.statistics.temperature.average, '°C'],
    ['light', 'min', report.statistics.light.min, 'raw'],
    ['light', 'max', report.statistics.light.max, 'raw'],
    ['light', 'average', report.statistics.light.average, 'raw'],
    ['alerts', 'temperatureExceedances', report.thresholdExceedances.temperature, 'count'],
    ['notifications', 'total', report.notifications.total, 'count'],
    ['led', 'onRatio', report.led.onRatio, 'ratio'],
    ['led', 'offRatio', report.led.offRatio, 'ratio'],
    ['system', 'uptimeMs', report.system.uptimeMs, 'ms'],
    ['system', 'disconnectCount', report.system.disconnectCount, 'count'],
    ['system', 'sensorDisconnectCount', report.system.sensorDisconnectCount, 'count'],
    ['system', 'esp32DisconnectCount', report.system.esp32DisconnectCount, 'count'],
    ['report', 'assessment', report.assessment, ''],
    ['report', 'recommendations', report.recommendations, '']
  ];
  return `${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}\n`;
}

module.exports = {
  buildReport,
  calculateLedDurations,
  reportToCsv,
  reportWindow
};
