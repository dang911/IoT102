(function bootstrapApplication(window, document) {
    'use strict';

    const STATUS_POLL_MS = 750;
    const BACKGROUND_POLL_MS = 10000;
    let pollTimer = null;
    let statusRequest = null;

    function hasStatusFields(payload) {
        if (!payload || typeof payload !== 'object') return false;
        if (
            payload.temperature !== undefined ||
            payload.lightLevel !== undefined ||
            payload.lightStatus !== undefined ||
            payload.mode !== undefined ||
            payload.dust !== undefined
        ) return true;
        return [payload.data, payload.current, payload.result, payload.status]
            .some((candidate) => candidate && candidate !== payload && hasStatusFields(candidate));
    }

    function errorMessage(error) {
        if (window.api && typeof window.api.describeError === 'function') {
            return window.api.describeError(error);
        }
        return error?.message || 'Unexpected dashboard error';
    }

    function processStatus(payload) {
        if (!hasStatusFields(payload)) throw new Error('API status response does not contain sensor or controller fields.');
        const normalized = window.dashboard.renderStatus(payload);
        window.notificationCenter.ingestStatus(normalized);
        const gatewayDisconnected = normalized.connection?.enabled === true && normalized.connection?.esp32Online === false;
        window.notificationCenter.setConnection(
            !gatewayDisconnected,
            gatewayDisconnected ? normalized.connection.lastError || 'The configured ESP32 gateway is offline.' : ''
        );
        return normalized;
    }

    function schedulePoll(delay = document.hidden ? BACKGROUND_POLL_MS : STATUS_POLL_MS) {
        window.clearTimeout(pollTimer);
        pollTimer = window.setTimeout(() => {
            refreshStatus().catch(() => {
                // The next scheduled poll will retry after the connection error is rendered.
            });
        }, delay);
    }

    async function refreshStatus(options = {}) {
        const { reschedule = true } = options;
        window.clearTimeout(pollTimer);
        if (statusRequest) return statusRequest;

        statusRequest = (async () => {
            try {
                const payload = await window.api.getStatus();
                return processStatus(payload);
            } catch (error) {
                const message = errorMessage(error);
                window.dashboard.setConnectionState('DISCONNECTED', message);
                window.notificationCenter.setConnection(false, message);
                throw error;
            } finally {
                statusRequest = null;
                if (reschedule) schedulePoll();
            }
        })();

        return statusRequest;
    }

    function surfaceHardwareWarning(response) {
        if (response?.hardware && response.hardware.synced === false) {
            window.dashboard.showToast(
                response.hardware.warning || 'Backend state changed, but the ESP32 did not confirm the command.',
                'warning'
            );
        }
    }

    async function applyCommand(command) {
        const response = await command();
        surfaceHardwareWarning(response);
        if (hasStatusFields(response)) {
            processStatus(response);
        } else {
            await refreshStatus({ reschedule: false });
        }
        schedulePoll();
        return response;
    }

    function initializeFeatureRefresh() {
        window.historyCharts.load().then((available) => {
            if (available) window.setInterval(() => window.historyCharts.load(), 15000);
        });
        window.notificationCenter.load().then((available) => {
            if (available) window.setInterval(() => window.notificationCenter.load(), 10000);
        });
        window.forecastPanel.load().then((available) => {
            if (available) window.setInterval(() => window.forecastPanel.load(), 60000);
        });
        window.reportsPanel.load('daily');
        window.configPanel.load();
    }

    document.addEventListener('DOMContentLoaded', () => {
        const required = [
            'api',
            'dashboard',
            'historyCharts',
            'notificationCenter',
            'forecastPanel',
            'reportsPanel',
            'configPanel'
        ];
        const missing = required.filter((name) => !window[name]);
        if (missing.length) {
            console.error(`Dashboard modules missing: ${missing.join(', ')}`);
            return;
        }

        window.notificationCenter.init(window.api);
        window.historyCharts.init(window.api);
        window.forecastPanel.init(window.api);
        window.reportsPanel.init(window.api);
        window.configPanel.init(window.api);
        window.dashboard.init({
            onMode: (mode) => applyCommand(() => window.api.setMode(mode)),
            onLight: (status) => applyCommand(() => window.api.setLight(status))
        });

        refreshStatus().catch(() => {
            // Connection state and the Notification Center already surface this failure.
        });
        initializeFeatureRefresh();

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                refreshStatus().catch(() => {});
                window.historyCharts.load();
            } else {
                schedulePoll(BACKGROUND_POLL_MS);
            }
        });

        window.addEventListener('offline', () => {
            window.dashboard.setConnectionState('DISCONNECTED', 'Browser is offline.');
            window.notificationCenter.setConnection(false, 'The browser lost its network connection.');
        });
        window.addEventListener('online', () => {
            window.dashboard.setConnectionState('CONNECTING');
            refreshStatus().catch(() => {});
        });

        document.addEventListener('dashboard:configsaved', (event) => {
            if (hasStatusFields(event.detail)) processStatus(event.detail);
            window.historyCharts.load();
            window.forecastPanel.load();
        });
    });
})(window, document);
