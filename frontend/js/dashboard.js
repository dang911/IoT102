(function createDashboard(window, document) {
    'use strict';

    const DEFAULT_TEMP_THRESHOLD = 35;
    const state = {
        commandHandlers: {},
        commandPending: false,
        connected: false,
        lastSampleKey: null,
        lastTimestamp: null,
        mode: null,
        sessionTemperatures: [],
        sourceMode: 'UNKNOWN'
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function getPath(object, path) {
        return path.split('.').reduce((value, key) => (
            value !== null && value !== undefined ? value[key] : undefined
        ), object);
    }

    function firstDefined(object, paths) {
        for (const path of paths) {
            const value = getPath(object, path);
            if (value !== undefined && value !== null && value !== '') return value;
        }
        return undefined;
    }

    function finiteNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function booleanValue(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value !== 'string') return null;
        const normalized = value.trim().toUpperCase();
        if (['TRUE', 'ON', 'ONLINE', 'OK', 'CONNECTED', '1'].includes(normalized)) return true;
        if (['FALSE', 'OFF', 'OFFLINE', 'ERROR', 'DISCONNECTED', '0'].includes(normalized)) return false;
        return null;
    }

    function formatNumber(value, digits = 1) {
        const number = finiteNumber(value);
        return number === null ? '--' : number.toFixed(digits);
    }

    function formatTimestamp(value) {
        if (!value) return 'Never';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'medium'
        }).format(date);
    }

    function unwrapStatus(payload) {
        if (!payload || typeof payload !== 'object') return null;

        if (
            payload.temperature !== undefined ||
            payload.lightLevel !== undefined ||
            payload.lightStatus !== undefined ||
            payload.mode !== undefined
        ) {
            return payload;
        }

        const candidates = [payload.data, payload.current, payload.result, payload.status];
        for (const candidate of candidates) {
            if (
                candidate &&
                typeof candidate === 'object' &&
                (
                    candidate.temperature !== undefined ||
                    candidate.lightLevel !== undefined ||
                    candidate.lightStatus !== undefined
                )
            ) {
                return candidate;
            }
        }

        if (payload.latest && typeof payload.latest === 'object') {
            return {
                ...payload,
                ...payload.latest
            };
        }
        return payload;
    }

    function sourceMode(data) {
        const explicitSimulation = booleanValue(firstDefined(data, [
            'simulated',
            'isSimulated',
            'meta.simulated',
            'simulation.enabled'
        ]));
        const source = String(firstDefined(data, [
            'dataMode',
            'dataSource',
            'source',
            'meta.source',
            'latest.source'
        ]) || '').trim();

        if (explicitSimulation === true || /mock|simulat|demo|seed|synthetic/i.test(source)) {
            return 'SIMULATED';
        }
        return 'REAL';
    }

    function setText(id, value) {
        const element = byId(id);
        if (element) element.textContent = value;
    }

    function setBadge(element, text, className) {
        if (!element) return;
        element.textContent = text;
        element.className = `badge ${className}`;
    }

    function setSensorState(prefix, explicitOnline, measurementAvailable) {
        const online = booleanValue(explicitOnline);
        const badge = byId(`${prefix}-sensor-state`);
        const health = byId(`health-${prefix === 'temp' ? 'temperature' : prefix}`);

        let label = 'Unavailable';
        let className = 'badge-neutral';
        if (online === false) {
            label = 'Offline';
            className = 'badge-danger';
        } else if (online === true || (state.connected && measurementAvailable)) {
            label = 'Online';
            className = 'badge-success';
        }

        setBadge(badge, label, className);
        if (health) {
            health.textContent = label;
            health.className = className.replace('badge-', 'text-');
        }
        return label === 'Online';
    }

    function updateTemperatureAnalytics(metrics, scope = 'Session') {
        const maximum = finiteNumber(metrics && (metrics.maximum ?? metrics.maxTemperature ?? metrics.max));
        const minimum = finiteNumber(metrics && (metrics.minimum ?? metrics.minTemperature ?? metrics.min));
        const average = finiteNumber(metrics && (metrics.average ?? metrics.avgTemperature ?? metrics.avg));
        const count = finiteNumber(metrics && (metrics.sampleCount ?? metrics.count ?? metrics.readings));

        setText('temp-max', maximum === null ? '--' : maximum.toFixed(1));
        setText('temp-min', minimum === null ? '--' : minimum.toFixed(1));
        setText('temp-avg', average === null ? '--' : average.toFixed(1));
        setText('analytics-max', maximum === null ? '--°C' : `${maximum.toFixed(1)}°C`);
        setText('analytics-min', minimum === null ? '--°C' : `${minimum.toFixed(1)}°C`);
        setText('analytics-avg', average === null ? '--°C' : `${average.toFixed(1)}°C`);
        setText('analytics-readings', count === null ? '0' : String(Math.round(count)));

        const scopeBadge = byId('stats-scope');
        if (scopeBadge) {
            setBadge(scopeBadge, count && count > 0 ? scope : 'No samples', count && count > 0 ? 'badge-info' : 'badge-neutral');
        }
    }

    function sessionMetrics() {
        if (!state.sessionTemperatures.length) return null;
        const sum = state.sessionTemperatures.reduce((total, value) => total + value, 0);
        return {
            maximum: Math.max(...state.sessionTemperatures),
            minimum: Math.min(...state.sessionTemperatures),
            average: sum / state.sessionTemperatures.length,
            sampleCount: state.sessionTemperatures.length
        };
    }

    function recordSessionTemperature(temperature, timestamp) {
        if (temperature === null) return;
        const sampleKey = `${timestamp || 'poll'}:${temperature}`;
        if (sampleKey === state.lastSampleKey) return;
        state.lastSampleKey = sampleKey;
        state.sessionTemperatures.push(temperature);
        if (state.sessionTemperatures.length > 500) state.sessionTemperatures.shift();
    }

    function normalizeTemperatureMetrics(data) {
        const metrics = data.metrics || {};
        const nested = metrics.temperature || metrics.temperatures || null;
        if (nested) {
            return {
                maximum: nested.maximum ?? nested.max,
                minimum: nested.minimum ?? nested.min,
                average: nested.average ?? nested.avg,
                sampleCount: nested.sampleCount ?? nested.count
            };
        }
        if (
            metrics.maxTemperature !== undefined ||
            metrics.minTemperature !== undefined ||
            metrics.avgTemperature !== undefined
        ) {
            return metrics;
        }
        return null;
    }

    function renderTemperature(data, timestamp) {
        const temperature = finiteNumber(firstDefined(data, [
            'temperature',
            'temp',
            'sensors.temperature.value'
        ]));
        const explicitOnline = firstDefined(data, [
            'sensors.temperature.sensorOnline',
            'sensors.temperature.online',
            'sensorStatus.temperature',
            'temperatureSensorOnline'
        ]);
        const online = setSensorState('temp', explicitOnline, temperature !== null);
        const value = byId('temp-value');
        const status = byId('temp-status');

        if (temperature === null) {
            if (value) {
                value.textContent = '--.-°C';
                value.className = 'value text-muted';
            }
            if (status) {
                status.textContent = online ? 'Invalid reading' : 'Unavailable';
                status.className = online ? 'text-warning' : 'text-muted';
            }
        } else if (!online) {
            value.textContent = `${temperature.toFixed(1)}°C`;
            value.className = 'value text-muted';
            status.textContent = 'Offline · last known value';
            status.className = 'text-warning';
        } else {
            const threshold = finiteNumber(firstDefined(data, [
                'thresholds.temperature',
                'config.temperatureThreshold'
            ])) ?? DEFAULT_TEMP_THRESHOLD;
            const explicitHigh = booleanValue(firstDefined(data, [
                'alerts.temperatureHigh',
                'status.temperatureHigh'
            ]));
            const statusText = String(firstDefined(data, ['status.temperature']) || '').toUpperCase();
            const high = explicitHigh !== null
                ? explicitHigh
                : statusText === 'HIGH' || temperature > threshold;

            value.textContent = `${temperature.toFixed(1)}°C`;
            value.className = high ? 'value text-danger' : 'value text-cyan';
            status.textContent = high ? 'High' : 'Normal';
            status.className = high ? 'text-danger' : 'text-success';
            recordSessionTemperature(temperature, timestamp);
        }

        const apiMetrics = normalizeTemperatureMetrics(data);
        const apiCount = finiteNumber(apiMetrics && (apiMetrics.sampleCount ?? apiMetrics.count));
        if (apiMetrics && apiCount !== null && apiCount > 0) {
            updateTemperatureAnalytics(apiMetrics, 'Stored history');
        } else {
            updateTemperatureAnalytics(sessionMetrics(), 'Browser session');
        }
    }

    function renderLight(data) {
        const light = finiteNumber(firstDefined(data, [
            'lightLevel',
            'light',
            'ldr',
            'sensors.light.value'
        ]));
        const explicitOnline = firstDefined(data, [
            'sensors.light.sensorOnline',
            'sensors.light.online',
            'sensorStatus.light',
            'lightSensorOnline'
        ]);
        const online = setSensorState('light', explicitOnline, light !== null);
        const value = byId('light-value');
        const environment = byId('env-status');

        if (light === null) {
            if (value) {
                value.textContent = '-- Lux';
                value.className = 'value text-muted';
            }
            if (environment) {
                environment.textContent = online ? 'Invalid reading' : 'Unavailable';
                environment.className = online ? 'text-warning' : 'text-muted';
            }
            return;
        }

        if (!online) {
            value.textContent = `${Math.round(light).toLocaleString()} Lux`;
            value.className = 'value text-muted';
            environment.textContent = 'Offline · last known value';
            environment.className = 'text-warning';
            return;
        }

        const darkThreshold = finiteNumber(firstDefined(data, [
            'thresholds.dark',
            'config.darkThreshold'
        ])) ?? 200;
        const lowLightAlert = booleanValue(firstDefined(data, ['alerts.lowLight']));
        const reportedEnvironment = String(firstDefined(data, ['status.environment']) || '').toUpperCase();
        const lowLight = lowLightAlert !== null
            ? lowLightAlert
            : reportedEnvironment === 'DARK' || light < darkThreshold;

        value.textContent = `${Math.round(light).toLocaleString()} Lux`;
        value.className = lowLight ? 'value text-warning' : 'value text-success';
        environment.textContent = lowLight ? 'Dark' : 'Bright';
        environment.className = lowLight ? 'text-warning' : 'text-success';
    }

    function updateToggleButtons(containerId, activeValue) {
        const container = byId(containerId);
        if (!container) return;
        container.querySelectorAll('.btn').forEach((button) => {
            const value = button.dataset.mode || button.dataset.light;
            const active = value === activeValue;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
    }

    function updateControlAvailability() {
        const modeButtons = document.querySelectorAll('#mode-buttons .btn');
        const lightButtons = document.querySelectorAll('#light-buttons .btn');
        modeButtons.forEach((button) => {
            button.disabled = !state.connected || state.commandPending;
        });
        const manual = state.mode === 'MANUAL';
        lightButtons.forEach((button) => {
            button.disabled = !state.connected || !manual || state.commandPending;
        });

        const hint = byId('manual-mode-hint');
        if (hint) {
            if (!state.connected) hint.textContent = 'Connect to the controller to use lighting controls.';
            else if (!manual) hint.textContent = 'Switch to MANUAL mode before sending an LED command.';
            else hint.textContent = 'Manual LED commands are enabled.';
        }
    }

    function renderLightingState(data) {
        const modeValue = firstDefined(data, ['mode', 'lighting.mode', 'control.mode']);
        const mode = modeValue ? String(modeValue).trim().toUpperCase() : null;
        state.mode = ['AUTO', 'MANUAL'].includes(mode) ? mode : null;
        updateToggleButtons('mode-buttons', state.mode);

        const ledOn = booleanValue(firstDefined(data, [
            'lightStatus',
            'ledStatus',
            'lighting.status',
            'control.lightStatus'
        ]));
        updateToggleButtons('light-buttons', ledOn === null ? null : ledOn ? 'ON' : 'OFF');
        if (ledOn === null) setBadge(byId('led-status'), 'Unknown', 'badge-neutral');
        else setBadge(byId('led-status'), ledOn ? 'ON' : 'OFF', ledOn ? 'badge-success' : 'badge-off');
        updateControlAvailability();
    }

    function applySourceState(mode) {
        state.sourceMode = mode;
        const badge = byId('data-source-badge');
        if (mode === 'SIMULATED') setBadge(badge, 'SIMULATED DATA', 'badge-warning');
        else if (mode === 'REAL') setBadge(badge, 'REAL DATA', 'badge-info');
        else if (mode === 'DISCONNECTED') setBadge(badge, 'DISCONNECTED', 'badge-danger');
        else setBadge(badge, 'SOURCE UNKNOWN', 'badge-neutral');
        document.body.dataset.dataSource = mode.toLowerCase();
    }

    function setConnectionState(connectionState, detail = '') {
        const normalized = String(connectionState).toUpperCase();
        const badge = byId('connection-badge');
        const heroStatus = byId('system-status-text');
        const dot = heroStatus && heroStatus.querySelector('.dot');

        state.connected = normalized === 'CONNECTED';
        document.body.classList.toggle('is-disconnected', normalized === 'DISCONNECTED');

        if (normalized === 'CONNECTED') {
            setBadge(badge, '● Online', 'badge-success');
            if (heroStatus) heroStatus.lastChild.textContent = state.sourceMode === 'SIMULATED' ? ' Simulation data active' : ' System connected';
            if (dot) dot.className = state.sourceMode === 'SIMULATED' ? 'dot warning' : 'dot online';
        } else if (normalized === 'DISCONNECTED') {
            setBadge(badge, '● Offline', 'badge-danger');
            applySourceState('DISCONNECTED');
            if (heroStatus) heroStatus.lastChild.textContent = detail ? ` Connection lost — ${detail}` : ' Connection lost';
            if (dot) dot.className = 'dot offline';
        } else {
            setBadge(badge, '● Connecting', 'badge-pending');
            applySourceState('UNKNOWN');
            if (heroStatus) heroStatus.lastChild.textContent = ' Connecting to system…';
            if (dot) dot.className = 'dot pending';
        }
        updateControlAvailability();
    }

    function renderStatus(payload) {
        const data = unwrapStatus(payload);
        if (!data) throw new Error('Status payload is empty');

        const mode = sourceMode(data);
        const connectionEnabled = booleanValue(firstDefined(data, ['connection.enabled']));
        const esp32Online = booleanValue(firstDefined(data, ['connection.esp32Online']));
        const controllerDisconnected = connectionEnabled === true && esp32Online === false;
        if (controllerDisconnected) {
            setConnectionState(
                'DISCONNECTED',
                String(firstDefined(data, ['connection.lastError']) || 'ESP32 gateway is offline; values may be cached.')
            );
        } else {
            applySourceState(mode);
            setConnectionState('CONNECTED');
        }

        const timestamp = firstDefined(data, [
            'timestamp',
            'lastUpdate',
            'updatedAt',
            'meta.timestamp',
            'latest.timestamp'
        ]) || new Date().toISOString();
        state.lastTimestamp = timestamp;
        const updated = byId('last-updated');
        if (updated) {
            updated.textContent = formatTimestamp(timestamp);
            updated.dateTime = timestamp;
        }

        renderTemperature(data, timestamp);
        renderLight(data);
        renderLightingState(data);
        refreshDataAge();
        return data;
    }

    function refreshDataAge() {
        const element = byId('data-age');
        if (!element) return;
        if (!state.lastTimestamp) {
            element.textContent = state.connected ? 'Timestamp unavailable' : 'Waiting for data';
            return;
        }
        const time = new Date(state.lastTimestamp).getTime();
        if (!Number.isFinite(time)) {
            element.textContent = 'Timestamp unavailable';
            return;
        }
        const ageSeconds = Math.max(0, Math.round((Date.now() - time) / 1000));
        if (ageSeconds < 5) element.textContent = 'Updated just now';
        else if (ageSeconds < 60) element.textContent = `Updated ${ageSeconds}s ago`;
        else element.textContent = `Updated ${Math.floor(ageSeconds / 60)}m ago`;
        element.classList.toggle('text-warning', ageSeconds > 15);
    }

    function setControlPending(pending, feedback = '') {
        state.commandPending = Boolean(pending);
        const spinner = byId('control-pending');
        if (spinner) spinner.hidden = !pending;
        if (feedback !== undefined) setText('control-feedback', feedback);
        updateControlAvailability();
    }

    function showControlError(message) {
        const feedback = byId('control-feedback');
        if (feedback) {
            feedback.textContent = message;
            feedback.className = 'inline-feedback error-text';
        }
        showToast(message, 'error');
    }

    let toastTimer = null;
    function showToast(message, type = 'info') {
        const toast = byId('toast');
        if (!toast) return;
        window.clearTimeout(toastTimer);
        toast.textContent = message;
        toast.className = `toast ${type}`;
        toast.hidden = false;
        toastTimer = window.setTimeout(() => {
            toast.hidden = true;
        }, 4500);
    }

    function safeStorageGet(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (_error) {
            return null;
        }
    }

    function safeStorageSet(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (_error) {
            // Theme still applies for the current page.
        }
    }

    function initializeTheme() {
        const toggle = byId('theme-toggle');
        const storedTheme = safeStorageGet('smarthome-theme');
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

        function applyTheme(theme) {
            const isDark = theme === 'dark';
            document.documentElement.classList.toggle('dark', isDark);
            document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
            if (toggle) {
                toggle.textContent = isDark ? 'Use light mode' : 'Use dark mode';
                toggle.setAttribute('aria-pressed', String(isDark));
            }
            document.dispatchEvent(new CustomEvent('dashboard:themechange'));
        }

        applyTheme(storedTheme || (prefersDark ? 'dark' : 'light'));
        if (toggle) {
            toggle.addEventListener('click', () => {
                const nextTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
                safeStorageSet('smarthome-theme', nextTheme);
                applyTheme(nextTheme);
            });
        }
    }

    function initializeNavigation() {
        const hamburger = byId('hamburger-menu');
        const sidebar = byId('sidebar');
        const overlay = byId('sidebar-overlay');
        const links = Array.from(document.querySelectorAll('.menu a[href^="#"]'));

        function setDrawer(open) {
            if (!sidebar || !hamburger || !overlay) return;
            sidebar.classList.toggle('open', open);
            overlay.classList.toggle('visible', open);
            hamburger.setAttribute('aria-expanded', String(open));
            hamburger.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
            overlay.tabIndex = open ? 0 : -1;
        }

        if (hamburger) hamburger.addEventListener('click', () => setDrawer(!sidebar.classList.contains('open')));
        if (overlay) overlay.addEventListener('click', () => setDrawer(false));
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
                setDrawer(false);
                hamburger.focus();
            }
        });

        links.forEach((link) => {
            link.addEventListener('click', (event) => {
                const target = document.querySelector(link.getAttribute('href'));
                if (!target) return;
                event.preventDefault();
                links.forEach((item) => {
                    item.classList.remove('active');
                    item.removeAttribute('aria-current');
                });
                link.classList.add('active');
                link.setAttribute('aria-current', 'page');
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                window.history.replaceState(null, '', link.getAttribute('href'));
                if (window.innerWidth <= 768) setDrawer(false);
            });
        });

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                const visible = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
                if (!visible) return;
                const link = links.find((item) => item.getAttribute('href') === `#${visible.target.id}`);
                if (!link) return;
                links.forEach((item) => {
                    item.classList.toggle('active', item === link);
                    if (item === link) item.setAttribute('aria-current', 'page');
                    else item.removeAttribute('aria-current');
                });
            }, { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.25] });
            links.forEach((link) => {
                const target = document.querySelector(link.getAttribute('href'));
                if (target) observer.observe(target);
            });
        }
    }

    function initializeControls() {
        document.querySelectorAll('#mode-buttons [data-mode]').forEach((button) => {
            button.addEventListener('click', async () => {
                if (state.commandPending || !state.commandHandlers.onMode) return;
                setControlPending(true, `Switching to ${button.dataset.mode}…`);
                try {
                    await state.commandHandlers.onMode(button.dataset.mode);
                    const feedback = byId('control-feedback');
                    if (feedback) feedback.className = 'inline-feedback success-text';
                    setText('control-feedback', `Mode changed to ${button.dataset.mode}.`);
                } catch (error) {
                    showControlError(error.message || 'Mode command failed.');
                } finally {
                    setControlPending(false);
                }
            });
        });

        document.querySelectorAll('#light-buttons [data-light]').forEach((button) => {
            button.addEventListener('click', async () => {
                if (state.commandPending || !state.commandHandlers.onLight) return;
                setControlPending(true, `Turning LED ${button.dataset.light}…`);
                try {
                    await state.commandHandlers.onLight(button.dataset.light);
                    const feedback = byId('control-feedback');
                    if (feedback) feedback.className = 'inline-feedback success-text';
                    setText('control-feedback', `LED command ${button.dataset.light} accepted.`);
                } catch (error) {
                    showControlError(error.message || 'LED command failed.');
                } finally {
                    setControlPending(false);
                }
            });
        });
    }

    function setCommandHandlers(handlers) {
        state.commandHandlers = handlers || {};
    }

    function init(options = {}) {
        setCommandHandlers(options);
        initializeTheme();
        initializeNavigation();
        initializeControls();
        setConnectionState('CONNECTING');
        setText('api-target', window.api && window.api.baseUrl ? window.api.baseUrl : 'Same origin');
        window.setInterval(refreshDataAge, 5000);
    }

    window.dashboard = Object.freeze({
        init,
        renderStatus,
        setCommandHandlers,
        setConnectionState,
        showControlError,
        showToast,
        updateTemperatureAnalytics
    });
})(window, document);
