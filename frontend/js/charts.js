(function createHistoryCharts(window, document) {
    'use strict';

    const state = {
        api: null,
        items: [],
        loading: false,
        metrics: null,
        resizeFrame: null
    };

    const definitions = [
        {
            canvasId: 'temperature-chart',
            statusId: 'temperature-chart-status',
            label: 'Temperature',
            unit: '°C',
            color: '--chart-temperature',
            value: (item) => number(item.temperature ?? item.temp)
        },
        {
            canvasId: 'light-chart',
            statusId: 'light-chart-status',
            label: 'Ambient light',
            unit: 'Lux',
            color: '--chart-light',
            value: (item) => number(item.lightLevel ?? item.light ?? item.ldr)
        }
    ];

    function byId(id) {
        return document.getElementById(id);
    }

    function number(value) {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function normalizeHistory(payload) {
        if (Array.isArray(payload)) return payload;
        if (!payload || typeof payload !== 'object') return [];
        if (Array.isArray(payload.items)) return payload.items;
        if (Array.isArray(payload.history)) return payload.history;
        if (Array.isArray(payload.data)) return payload.data;
        if (Array.isArray(payload.readings)) return payload.readings;
        return [];
    }

    function formatAxis(value, range) {
        const digits = Math.abs(range) < 10 ? 1 : 0;
        return Number(value).toFixed(digits);
    }

    function sampleTimestamp(item) {
        return item.timestamp || item.lastUpdate || item.createdAt || null;
    }

    function shortTime(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            month: 'short',
            day: 'numeric'
        }).format(date);
    }

    function cssColor(variable, fallback) {
        return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
    }

    function drawEmpty(canvas, message) {
        const context = canvas.getContext('2d');
        if (!context) return;
        const width = Math.max(canvas.parentElement?.clientWidth || 280, 240);
        const height = 230;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context.scale(ratio, ratio);
        context.clearRect(0, 0, width, height);
        context.fillStyle = cssColor('--text-muted', '#707070');
        context.font = '500 13px system-ui, sans-serif';
        context.textAlign = 'center';
        context.fillText(message, width / 2, height / 2);
    }

    function drawChart(definition) {
        const canvas = byId(definition.canvasId);
        const status = byId(definition.statusId);
        if (!canvas) return;

        const points = state.items
            .map((item) => ({ value: definition.value(item), timestamp: sampleTimestamp(item) }))
            .filter((item) => item.value !== null)
            .slice(-180);

        if (!points.length) {
            drawEmpty(canvas, `No ${definition.label.toLowerCase()} readings`);
            if (status) status.textContent = `No ${definition.label.toLowerCase()} history is available.`;
            canvas.setAttribute('aria-label', `${definition.label} history: no readings available`);
            return;
        }

        const context = canvas.getContext('2d');
        if (!context) {
            if (status) status.textContent = 'Canvas charts are not supported by this browser.';
            return;
        }

        const width = Math.max(canvas.parentElement?.clientWidth || 280, 240);
        const height = 230;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context.scale(ratio, ratio);
        context.clearRect(0, 0, width, height);

        const padding = { top: 16, right: 14, bottom: 34, left: 48 };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;
        const values = points.map((item) => item.value);
        let minimum = Math.min(...values);
        let maximum = Math.max(...values);
        if (minimum === maximum) {
            const spread = Math.max(Math.abs(minimum) * 0.1, 1);
            minimum -= spread;
            maximum += spread;
        } else {
            const spread = (maximum - minimum) * 0.1;
            minimum -= spread;
            maximum += spread;
        }
        const range = maximum - minimum;
        const lineColor = cssColor(definition.color, '#3b82f6');
        const gridColor = cssColor('--chart-grid', 'rgba(112,112,112,.2)');
        const textColor = cssColor('--text-muted', '#707070');

        context.lineWidth = 1;
        context.strokeStyle = gridColor;
        context.fillStyle = textColor;
        context.font = '11px system-ui, sans-serif';
        context.textAlign = 'right';
        context.textBaseline = 'middle';
        for (let index = 0; index <= 4; index += 1) {
            const y = padding.top + (plotHeight * index) / 4;
            const label = maximum - (range * index) / 4;
            context.beginPath();
            context.moveTo(padding.left, y);
            context.lineTo(width - padding.right, y);
            context.stroke();
            context.fillText(formatAxis(label, range), padding.left - 7, y);
        }

        const coordinate = (point, index) => ({
            x: padding.left + (points.length === 1 ? plotWidth / 2 : (plotWidth * index) / (points.length - 1)),
            y: padding.top + ((maximum - point.value) / range) * plotHeight
        });
        const coordinates = points.map(coordinate);

        const gradient = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
        gradient.addColorStop(0, `${lineColor}42`);
        gradient.addColorStop(1, `${lineColor}00`);
        context.beginPath();
        coordinates.forEach((point, index) => {
            if (index === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
        });
        context.lineTo(coordinates[coordinates.length - 1].x, height - padding.bottom);
        context.lineTo(coordinates[0].x, height - padding.bottom);
        context.closePath();
        context.fillStyle = gradient;
        context.fill();

        context.beginPath();
        coordinates.forEach((point, index) => {
            if (index === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
        });
        context.strokeStyle = lineColor;
        context.lineWidth = 2.5;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        context.stroke();

        const latest = coordinates[coordinates.length - 1];
        context.beginPath();
        context.arc(latest.x, latest.y, 4, 0, Math.PI * 2);
        context.fillStyle = lineColor;
        context.fill();
        context.strokeStyle = cssColor('--card', '#fff');
        context.lineWidth = 2;
        context.stroke();

        context.fillStyle = textColor;
        context.textBaseline = 'alphabetic';
        context.textAlign = 'left';
        context.fillText(shortTime(points[0].timestamp), padding.left, height - 8);
        context.textAlign = 'right';
        context.fillText(shortTime(points[points.length - 1].timestamp), width - padding.right, height - 8);

        const actualMinimum = Math.min(...values);
        const actualMaximum = Math.max(...values);
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        const summary = `${points.length} reading${points.length === 1 ? '' : 's'} · min ${formatAxis(actualMinimum, range)} · max ${formatAxis(actualMaximum, range)} · avg ${formatAxis(average, range)} ${definition.unit}`;
        if (status) status.textContent = summary;
        canvas.setAttribute('aria-label', `${definition.label} history. ${summary}`);
    }

    function renderAll() {
        definitions.forEach(drawChart);
    }

    function calculateTemperatureMetrics(items) {
        const values = items
            .map((item) => number(item.temperature ?? item.temp))
            .filter((value) => value !== null);
        if (!values.length) return null;
        return {
            maximum: Math.max(...values),
            minimum: Math.min(...values),
            average: values.reduce((sum, value) => sum + value, 0) / values.length,
            sampleCount: values.length
        };
    }

    function temperatureMetrics(payload) {
        const metrics = payload && payload.metrics;
        if (!metrics) return calculateTemperatureMetrics(state.items);
        if (metrics.temperature) {
            return {
                maximum: metrics.temperature.max ?? metrics.temperature.maximum,
                minimum: metrics.temperature.min ?? metrics.temperature.minimum,
                average: metrics.temperature.avg ?? metrics.temperature.average,
                sampleCount: metrics.temperature.count ?? metrics.temperature.sampleCount ?? metrics.sampleCount
            };
        }
        if (metrics.maxTemperature !== undefined) return metrics;
        return calculateTemperatureMetrics(state.items);
    }

    async function load() {
        if (!state.api || state.loading) return;
        state.loading = true;
        const overallStatus = byId('history-api-status');
        const refreshButton = byId('history-refresh');
        if (overallStatus) overallStatus.textContent = 'Loading recorded sensor history…';
        if (refreshButton) refreshButton.disabled = true;

        try {
            const payload = await state.api.getHistory(180);
            state.items = normalizeHistory(payload);
            state.metrics = temperatureMetrics(payload);
            renderAll();
            if (state.metrics && window.dashboard) {
                window.dashboard.updateTemperatureAnalytics(state.metrics, 'Stored history');
            }
            if (overallStatus) {
                overallStatus.textContent = state.items.length
                    ? `Showing the latest ${state.items.length} stored sample${state.items.length === 1 ? '' : 's'}.`
                    : 'History API is available, but it has no samples yet.';
                overallStatus.className = 'section-status';
            }
            return true;
        } catch (error) {
            state.items = [];
            renderAll();
            if (overallStatus) {
                overallStatus.textContent = error.endpointUnavailable
                    ? 'History is unavailable on this connected device/API.'
                    : state.api.describeError(error);
                overallStatus.className = 'section-status error-text';
            }
            return false;
        } finally {
            state.loading = false;
            if (refreshButton) refreshButton.disabled = false;
        }
    }

    function init(api) {
        state.api = api;
        const refresh = byId('history-refresh');
        if (refresh) refresh.addEventListener('click', load);
        document.addEventListener('dashboard:themechange', () => window.requestAnimationFrame(renderAll));

        if ('ResizeObserver' in window) {
            const observer = new ResizeObserver(() => {
                window.cancelAnimationFrame(state.resizeFrame);
                state.resizeFrame = window.requestAnimationFrame(renderAll);
            });
            definitions.forEach((definition) => {
                const canvas = byId(definition.canvasId);
                if (canvas && canvas.parentElement) observer.observe(canvas.parentElement);
            });
        } else {
            window.addEventListener('resize', () => {
                window.cancelAnimationFrame(state.resizeFrame);
                state.resizeFrame = window.requestAnimationFrame(renderAll);
            });
        }
    }

    window.historyCharts = Object.freeze({ init, load, renderAll });
})(window, document);
