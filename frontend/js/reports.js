(function createReportsPanel(window, document) {
    'use strict';

    const state = {
        api: null,
        current: null,
        loading: false,
        period: 'daily'
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function number(value) {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function first(object, keys) {
        for (const key of keys) {
            if (object && object[key] !== undefined && object[key] !== null) return object[key];
        }
        return null;
    }

    function formatNumber(value, unit = '', digits = 1) {
        const parsed = number(value);
        return parsed === null ? 'Unavailable' : `${parsed.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
    }

    function formatPercent(value) {
        const parsed = number(value);
        if (parsed === null) return 'Unavailable';
        const percentage = Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
        return `${percentage.toFixed(1)}%`;
    }

    function formatDuration(milliseconds) {
        const parsed = number(milliseconds);
        if (parsed === null) return 'Unavailable';
        let remaining = Math.max(0, Math.round(parsed / 1000));
        const days = Math.floor(remaining / 86400);
        remaining %= 86400;
        const hours = Math.floor(remaining / 3600);
        remaining %= 3600;
        const minutes = Math.floor(remaining / 60);
        const parts = [];
        if (days) parts.push(`${days}d`);
        if (hours || days) parts.push(`${hours}h`);
        parts.push(`${minutes}m`);
        return parts.join(' ');
    }

    function formatTime(value) {
        if (!value) return 'Unavailable';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date);
    }

    function statisticsSummary(stats, unit) {
        if (!stats || typeof stats !== 'object') return { value: 'Unavailable', detail: 'No recorded samples' };
        const minimum = first(stats, ['min', 'minimum']);
        const maximum = first(stats, ['max', 'maximum']);
        const average = first(stats, ['avg', 'average', 'mean']);
        return {
            value: formatNumber(average, unit),
            detail: `Min ${formatNumber(minimum, unit)} · Max ${formatNumber(maximum, unit)}`
        };
    }

    function createMetric(title, value, detail) {
        const card = document.createElement('div');
        card.className = 'report-metric';
        const label = document.createElement('span');
        label.textContent = title;
        const strong = document.createElement('strong');
        strong.textContent = value;
        const small = document.createElement('small');
        small.textContent = detail || '';
        card.append(label, strong, small);
        return card;
    }

    function stringList(value, fallback) {
        if (Array.isArray(value)) {
            return value.map((item) => typeof item === 'string' ? item : item.message || item.text || JSON.stringify(item));
        }
        if (typeof value === 'string' && value.trim()) return [value];
        if (value && typeof value === 'object') return Object.values(value).map(String);
        return [fallback];
    }

    function renderList(id, values) {
        const list = byId(id);
        if (!list) return;
        list.replaceChildren();
        values.forEach((value) => {
            const item = document.createElement('li');
            item.textContent = value;
            list.append(item);
        });
    }

    function render(payload) {
        const report = payload?.report || payload?.data || payload || {};
        state.current = report;
        const statistics = report.statistics || report.stats || {};
        const temperature = statisticsSummary(statistics.temperature, '°C');
        const light = statisticsSummary(statistics.light || statistics.lightLevel, 'Lux');
        const exceedances = report.thresholdExceedances || report.exceedances || {};
        const notifications = report.notifications || {};
        const led = report.led || report.lightStatus || {};
        const system = report.system || {};
        const sampleCount = number(report.sampleCount ?? statistics.sampleCount);
        const temperatureExceedances = number(exceedances.temperature ?? exceedances.temperatureHigh);
        const notificationTotal = number(notifications.total ?? report.totalNotifications);
        const unread = number(notifications.unread);
        const disconnects = number(system.disconnectCount ?? report.sensorDisconnects);

        const grid = byId('report-grid');
        if (grid) {
            grid.replaceChildren(
                createMetric('Samples', sampleCount === null ? 'Unavailable' : String(Math.round(sampleCount)), `${formatTime(report.from)} – ${formatTime(report.to)}`),
                createMetric('Average temperature', temperature.value, temperature.detail),
                createMetric('Average light', light.value, light.detail),
                createMetric('Temperature exceedances', temperatureExceedances === null ? 'Unavailable' : String(Math.round(temperatureExceedances)), 'Configured high-temperature threshold'),
                createMetric('Notifications', notificationTotal === null ? 'Unavailable' : String(Math.round(notificationTotal)), unread === null ? 'Unread count unavailable' : `${Math.round(unread)} unread`),
                createMetric('LED on ratio', formatPercent(led.onRatio ?? report.ledOnRatio), `Off ${formatPercent(led.offRatio ?? report.ledOffRatio)}`),
                createMetric('System uptime', formatDuration(system.uptimeMs ?? report.uptimeMs), 'Recorded during this report period'),
                createMetric('Sensor disconnects', disconnects === null ? 'Unavailable' : String(Math.round(disconnects)), 'Offline events recorded')
            );
        }

        renderList('report-comments', stringList(report.assessment || report.comments, 'No automatic assessment is available.'));
        renderList('report-recommendations', stringList(report.recommendations, 'No recommendation is available.'));
    }

    function updatePeriodButtons() {
        document.querySelectorAll('[data-period]').forEach((button) => {
            const active = button.dataset.period === state.period;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
    }

    async function load(period = state.period) {
        if (!state.api || state.loading) return;
        state.period = ['daily', 'weekly'].includes(period) ? period : 'daily';
        state.loading = true;
        state.current = null;
        updatePeriodButtons();
        const status = byId('report-status');
        const exportButton = byId('report-export');
        if (status) {
            status.textContent = `Loading ${state.period} report…`;
            status.className = 'section-status';
        }
        if (exportButton) exportButton.disabled = true;

        try {
            const payload = await state.api.getReport(state.period);
            render(payload);
            const report = payload?.report || payload?.data || payload || {};
            if (status) {
                const generated = report.generatedAt ? ` · generated ${formatTime(report.generatedAt)}` : '';
                status.textContent = `${state.period[0].toUpperCase()}${state.period.slice(1)} report ready${generated}.`;
                status.className = 'section-status success-text';
            }
            if (exportButton) exportButton.disabled = false;
        } catch (error) {
            const grid = byId('report-grid');
            if (grid) grid.replaceChildren();
            renderList('report-comments', ['No report loaded.']);
            renderList('report-recommendations', ['No recommendations loaded.']);
            if (status) {
                status.textContent = error.endpointUnavailable
                    ? 'Reports are unavailable on this connected device/API.'
                    : state.api.describeError(error);
                status.className = 'section-status error-text';
            }
        } finally {
            state.loading = false;
        }
    }

    function flatten(object, prefix = '', rows = []) {
        Object.entries(object || {}).forEach(([key, value]) => {
            const path = prefix ? `${prefix}.${key}` : key;
            if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, rows);
            else rows.push([path, Array.isArray(value) ? value.join(' | ') : value ?? '']);
        });
        return rows;
    }

    function quoteCsv(value) {
        const string = String(value ?? '');
        return `"${string.replace(/"/g, '""')}"`;
    }

    function clientCsv(report) {
        return ['field,value', ...flatten(report).map(([key, value]) => `${quoteCsv(key)},${quoteCsv(value)}`)].join('\r\n');
    }

    function downloadCsv(content) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `smart-environment-${state.period}-report.csv`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    async function exportCsv() {
        if (!state.current) return;
        const button = byId('report-export');
        const status = byId('report-status');
        if (button) button.disabled = true;
        try {
            let content;
            try {
                const response = await state.api.getReportCsv(state.period);
                content = typeof response === 'string' ? response : clientCsv(response || state.current);
            } catch (error) {
                if (!error.endpointUnavailable) throw error;
                content = clientCsv(state.current);
            }
            downloadCsv(content);
            if (status) {
                status.textContent = 'CSV report prepared successfully.';
                status.className = 'section-status success-text';
            }
        } catch (error) {
            if (status) {
                status.textContent = state.api.describeError(error);
                status.className = 'section-status error-text';
            }
        } finally {
            if (button) button.disabled = false;
        }
    }

    function init(api) {
        state.api = api;
        document.querySelectorAll('[data-period]').forEach((button) => {
            button.addEventListener('click', () => load(button.dataset.period));
        });
        const exportButton = byId('report-export');
        if (exportButton) exportButton.addEventListener('click', exportCsv);
    }

    window.reportsPanel = Object.freeze({ init, load });
})(window, document);
