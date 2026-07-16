function buildNotificationCandidates(status, config) {
  const abnormalSensors = Object.entries(status.sensors || {})
    .filter(([, sensor]) => sensor && sensor.abnormal)
    .map(([name]) => name);
  if (status.dust && status.dust.abnormal && !abnormalSensors.includes('dust')) {
    abnormalSensors.push('dust');
  }
  const candidates = [
    {
      key: 'temperatureHigh',
      active: status.alerts.temperatureHigh,
      type: 'TEMPERATURE_HIGH',
      severity: 'WARNING',
      title: 'Nhiệt độ cao',
      message: `Nhiệt độ ${status.temperature} °C đã vượt ngưỡng cấu hình.`,
      value: status.temperature,
      threshold: config.temperatureThreshold,
      source: status.source
    },
    {
      key: 'lowLight',
      active: status.alerts.lowLight,
      type: 'LOW_LIGHT',
      severity: 'INFO',
      title: 'Ánh sáng thấp',
      message: `Mức ánh sáng ${status.lightLevel} thấp hơn ngưỡng cấu hình.`,
      value: status.lightLevel,
      threshold: config.darkThreshold,
      source: status.source
    },
    {
      key: 'dustHigh',
      active: status.alerts.dustHigh,
      stateToken: status.dust.level,
      type: 'DUST_HIGH',
      severity: status.dust.level === 'DANGEROUS' ? 'CRITICAL' : 'WARNING',
      title: 'Mật độ bụi cao',
      message: `Mật độ bụi ước tính ${status.dust.density} ug/m3 đang ở mức ${status.dust.level}.`,
      value: status.dust.density,
      threshold: config.dustThresholds.high,
      source: status.source
    },
    {
      key: 'dustSensorOffline',
      active: status.alerts.dustSensorOffline,
      stateToken: status.dust.error || 'OFFLINE',
      type: 'DUST_SENSOR_OFFLINE',
      severity: 'WARNING',
      title: 'Cảm biến bụi mất dữ liệu',
      message: 'Không nhận được dữ liệu hợp lệ mới từ cảm biến bụi.',
      value: null,
      threshold: config.sensorOfflineTimeoutMs,
      source: 'backend'
    },
    {
      key: 'sensorAbnormal',
      active: Boolean(status.alerts.sensorAbnormal) || abnormalSensors.length > 0,
      stateToken: abnormalSensors.join(',') || status.dust.error || 'INVALID_READING',
      type: 'SENSOR_ABNORMAL',
      severity: 'WARNING',
      title: 'Dữ liệu cảm biến bất thường',
      message: abnormalSensors.length
        ? `Cảm biến báo dữ liệu bất thường: ${abnormalSensors.join(', ')}.`
        : `Cảm biến báo dữ liệu bất thường: ${status.dust.error || 'INVALID_READING'}.`,
      value: abnormalSensors.join(', ') || status.dust.rawAdc,
      threshold: null,
      source: status.source
    },
    {
      key: 'esp32Offline',
      active: status.connection.enabled && !status.connection.esp32Online,
      stateToken: status.connection.lastError || 'OFFLINE',
      type: 'ESP32_OFFLINE',
      severity: 'CRITICAL',
      title: 'Mất kết nối ESP32',
      message: status.connection.lastError
        ? `Không thể kết nối ESP32: ${status.connection.lastError}`
        : 'Không thể kết nối ESP32.',
      value: null,
      threshold: null,
      source: 'backend'
    },
    {
      key: 'environmentDegraded',
      active: ['POOR', 'DANGEROUS'].includes(status.status.environmentQuality),
      stateToken: status.status.environmentQuality,
      type: 'ENVIRONMENT_DEGRADED',
      severity:
        status.status.environmentQuality === 'DANGEROUS' ? 'CRITICAL' : 'WARNING',
      title: 'Chất lượng môi trường suy giảm',
      message: `Chất lượng môi trường chuyển sang mức ${status.status.environmentQuality}.`,
      value: status.status.environmentQuality,
      threshold: 'POOR',
      source: status.source
    }
  ];

  return candidates;
}

function createNotification(state, candidate, timestamp) {
  const sequence = Math.max(1, Number(state.nextNotificationId) || 1);
  state.nextNotificationId = sequence + 1;
  return {
    id: `notification-${String(sequence).padStart(6, '0')}`,
    type: candidate.type,
    severity: candidate.severity,
    title: candidate.title,
    message: candidate.message,
    value: candidate.value ?? null,
    threshold: candidate.threshold ?? null,
    timestamp,
    read: false,
    source: candidate.source || 'backend'
  };
}

function applyNotificationCandidates(state, candidates, config, now) {
  state.notifications = Array.isArray(state.notifications)
    ? state.notifications
    : [];
  state.alertStates = state.alertStates && typeof state.alertStates === 'object'
    ? state.alertStates
    : {};

  const nowMs = Date.parse(now);
  let created = 0;

  for (const candidate of candidates) {
    const previous = state.alertStates[candidate.key] || {
      active: false,
      stateToken: null,
      lastNotificationAt: null
    };
    const currentStateToken = candidate.stateToken ?? true;
    const stateChanged =
      Boolean(candidate.active) !== Boolean(previous.active) ||
      (candidate.active && currentStateToken !== previous.stateToken);
    const lastMs = Date.parse(previous.lastNotificationAt);
    const cooldownElapsed =
      !Number.isFinite(lastMs) || nowMs - lastMs >= config.notificationCooldownMs;

    if (candidate.active && (stateChanged || cooldownElapsed)) {
      state.notifications.push(createNotification(state, candidate, now));
      previous.lastNotificationAt = now;
      created += 1;
    }

    previous.active = Boolean(candidate.active);
    previous.stateToken = candidate.active ? currentStateToken : null;
    previous.lastEvaluatedAt = now;
    state.alertStates[candidate.key] = previous;
  }

  if (state.notifications.length > config.notificationLimit) {
    state.notifications = state.notifications.slice(-config.notificationLimit);
  }

  return created;
}

function unreadCount(notifications) {
  return notifications.filter((item) => !item.read).length;
}

module.exports = {
  applyNotificationCandidates,
  buildNotificationCandidates,
  unreadCount
};
