const { round } = require('./domain');

const FORECAST_DISCLAIMER =
  'Dự báo chỉ mang tính tham khảo, không thay thế thiết bị quan trắc môi trường chuyên dụng.';

function collectSeries(history, selector, windowSize) {
  return history
    .map((item) => ({
      value: Number(selector(item)),
      timestamp: Date.parse(item.timestamp)
    }))
    .filter((item) => Number.isFinite(item.value) && Number.isFinite(item.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-windowSize);
}

function confidenceLevel(score) {
  if (score >= 0.75) {
    return 'HIGH';
  }
  if (score >= 0.45) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function insufficientMetric(unit, samplesUsed) {
  return {
    predictedValue: null,
    unit,
    trend: 'INSUFFICIENT_DATA',
    changeRate: null,
    movingAverage: null,
    samplesUsed,
    confidence: 'LOW',
    confidenceScore: 0,
    insufficientData: true
  };
}

function forecastMetric(series, {
  unit,
  horizonMinutes,
  minimumSamples,
  windowSize,
  stableRate,
  clampMinimum = null
}) {
  if (series.length < minimumSamples) {
    return insufficientMetric(unit, series.length);
  }

  const firstTimestamp = series[0].timestamp;
  let points = series.map((item) => ({
    x: (item.timestamp - firstTimestamp) / 60000,
    y: item.value
  }));
  if (points[points.length - 1].x === 0) {
    points = points.map((item, index) => ({ ...item, x: index }));
  }

  const meanX = points.reduce((sum, item) => sum + item.x, 0) / points.length;
  const meanY = points.reduce((sum, item) => sum + item.y, 0) / points.length;
  const denominator = points.reduce(
    (sum, item) => sum + (item.x - meanX) ** 2,
    0
  );
  const slope = denominator === 0
    ? 0
    : points.reduce(
      (sum, item) => sum + (item.x - meanX) * (item.y - meanY),
      0
    ) / denominator;
  const intercept = meanY - slope * meanX;
  const predictionX = points[points.length - 1].x + horizonMinutes;
  let predictedValue = intercept + slope * predictionX;
  if (clampMinimum !== null) {
    predictedValue = Math.max(clampMinimum, predictedValue);
  }

  const recentValues = points.slice(-Math.min(3, points.length)).map((item) => item.y);
  const movingAverage = recentValues.reduce((sum, value) => sum + value, 0) /
    recentValues.length;
  const totalVariance = points.reduce(
    (sum, item) => sum + (item.y - meanY) ** 2,
    0
  );
  const residualVariance = points.reduce((sum, item) => {
    const estimate = intercept + slope * item.x;
    return sum + (item.y - estimate) ** 2;
  }, 0);
  const rSquared = totalVariance === 0
    ? 1
    : Math.max(0, Math.min(1, 1 - residualVariance / totalVariance));
  const sampleCoverage = Math.min(1, points.length / windowSize);
  const confidenceScore = round(sampleCoverage * (0.5 + 0.5 * rSquared), 2);
  const trend = Math.abs(slope) <= stableRate
    ? 'STABLE'
    : slope > 0
      ? 'INCREASING'
      : 'DECREASING';

  return {
    predictedValue: round(predictedValue, 1),
    unit,
    trend,
    changeRate: round(slope, 3),
    movingAverage: round(movingAverage, 1),
    samplesUsed: points.length,
    confidence: confidenceLevel(confidenceScore),
    confidenceScore,
    insufficientData: false
  };
}

function buildForecast(history, config, now = new Date().toISOString()) {
  const windowSize = config.forecastWindowSize;
  const minimumSamples = config.forecastMinSamples;
  const horizonMinutes = config.forecastHorizonMinutes;
  const temperatureSeries = collectSeries(
    history,
    (item) => {
      const sensor = item.sensors && item.sensors.temperature;
      return sensor && (sensor.online === false || sensor.abnormal)
        ? NaN
        : item.temperature;
    },
    windowSize
  );
  const dustSeries = collectSeries(
    history,
    (item) => item.dust && item.dust.valid !== false ? item.dust.density : NaN,
    windowSize
  );
  const temperature = forecastMetric(temperatureSeries, {
    unit: '°C',
    horizonMinutes,
    minimumSamples,
    windowSize,
    stableRate: 0.02
  });
  const dust = forecastMetric(dustSeries, {
    unit: 'ug/m3',
    horizonMinutes,
    minimumSamples,
    windowSize,
    stableRate: 0.2,
    clampMinimum: 0
  });

  let environmentTrend = 'STABLE';
  if (temperature.insufficientData && dust.insufficientData) {
    environmentTrend = 'INSUFFICIENT_DATA';
  } else if (temperature.trend === 'INCREASING' || dust.trend === 'INCREASING') {
    environmentTrend = 'DEGRADING';
  } else if (
    [temperature.trend, dust.trend].some((trend) => trend === 'DECREASING')
  ) {
    environmentTrend = 'IMPROVING';
  }

  return {
    generatedAt: now,
    horizonMinutes,
    sampleCount: Math.max(temperature.samplesUsed, dust.samplesUsed),
    insufficientData: temperature.insufficientData && dust.insufficientData,
    partialData: temperature.insufficientData !== dust.insufficientData,
    temperature,
    dust,
    environmentTrend,
    disclaimer: FORECAST_DISCLAIMER
  };
}

module.exports = {
  FORECAST_DISCLAIMER,
  buildForecast,
  collectSeries,
  forecastMetric
};
