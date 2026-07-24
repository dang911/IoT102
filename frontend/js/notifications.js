(function createNotificationCenter(window, document) {
    'use strict';

    const state = {
        activeConditions: new Map(),
        api: null,
        cooldownMs: 60000,
        lastRaised: new Map(),
        loading: false,
        localItems: [],
        pendingLocal: [],
        serverAvailable: null,
        serverItems: []
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function number(value) {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function booleanValue(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value !== 'string') return null;
        const normalized = value.trim().toUpperCase();
        if (['TRUE', 'ON', 'ONLINE', 'OK', '1'].includes(normalized)) return true;
        if (['FALSE', 'OFF', 'OFFLINE', 'ERROR', '0'].includes(normalized)) return false;
        return null;
    }

    function unwrapStatus(payload) {
        if (!payload || typeof payload !== 'object') return {};
        if (payload.data && typeof payload.data === 'object') return payload.data;
        if (payload.current && typeof payload.current === 'object') return payload.current;
        return payload;
    }

    function normalizeNotification(item, index, origin = 'server') {
        const timestamp = item.timestamp || item.createdAt || item.time || new Date().toISOString();
        return {
            id: String(item.id ?? `${origin}-${timestamp}-${index}`),
            origin,
            type: String(item.type || item.category || 'SYSTEM').toUpperCase(),
            severity: String(item.severity || item.level || item.type || 'info').toLowerCase(),
            title: String(item.title || item.type || 'Environment notification'),
            message: String(item.message || item.content || item.description || ''),
            value: item.value,
            threshold: item.threshold,
            timestamp,
            read: Boolean(item.read ?? item.isRead),
            source: String(item.source || (origin === 'local' ? 'browser-session' : 'backend'))
        };
    }

    function normalizeItems(payload) {
        const items = Array.isArray(payload)
            ? payload
            : payload?.items || payload?.notifications || payload?.data || [];
        return Array.isArray(items)
            ? items.map((item, index) => normalizeNotification(item, index))
            : [];
    }

    function severityClass(severity) {
        const normalized = String(severity).toLowerCase();
        if (['danger', 'dangerous', 'critical', 'error'].includes(normalized)) return 'danger';
        if (['warning', 'warn', 'moderate', 'high'].includes(normalized)) return 'warning';
        if (['success', 'normal', 'resolved'].includes(normalized)) return 'success';
        return 'info';
    }

    function formatTimestamp(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value || 'Unknown time');
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date);
    }

    function createMetadata(item) {
        const parts = [formatTimestamp(item.timestamp), item.source];
        if (item.value !== undefined && item.value !== null) parts.push(`Value: ${item.value}`);
        if (item.threshold !== undefined && item.threshold !== null) parts.push(`Threshold: ${item.threshold}`);
        return parts.join(' · ');
    }

    function mergedItems() {
        const seen = new Set();
        return [...state.localItems, ...state.serverItems]
            .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
            .filter((item) => {
                const key = `${item.origin}:${item.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, 60);
    }

    function updateUnreadCount(items) {
        const count = items.filter((item) => !item.read).length;
        const text = `${count} unread`;
        const heading = byId('notification-unread');
        const nav = byId('nav-unread-count');
        if (heading) heading.textContent = text;
        if (nav) {
            nav.textContent = String(count);
            nav.hidden = count === 0;
        }
    }

    function render() {
        const list = byId('notification-list');
        const empty = byId('notification-empty');
        if (!list) return;
        const items = mergedItems();
        list.replaceChildren();

        items.forEach((item) => {
            const row = document.createElement('li');
            row.className = `notification-item ${severityClass(item.severity)}${item.read ? ' is-read' : ''}`;

            const icon = document.createElement('span');
            icon.className = 'notification-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = severityClass(item.severity) === 'success' ? '✓' : severityClass(item.severity) === 'info' ? 'i' : '!';

            const content = document.createElement('div');
            content.className = 'notification-content';
            const heading = document.createElement('div');
            heading.className = 'notification-heading';
            const title = document.createElement('strong');
            title.textContent = item.title;
            const type = document.createElement('span');
            type.className = 'notification-type';
            type.textContent = item.type;
            heading.append(title, type);

            const message = document.createElement('p');
            message.textContent = item.message || 'No additional detail.';
            const metadata = document.createElement('small');
            metadata.textContent = createMetadata(item);
            content.append(heading, message, metadata);
            row.append(icon, content);

            if (!item.read) {
                const readButton = document.createElement('button');
                readButton.type = 'button';
                readButton.className = 'mark-read-button';
                readButton.textContent = 'Mark read';
                readButton.dataset.notificationId = item.id;
                readButton.dataset.origin = item.origin;
                readButton.setAttribute('aria-label', `Mark ${item.title} as read`);
                row.append(readButton);
            }
            list.append(row);
        });

        if (empty) empty.hidden = items.length !== 0;
        updateUnreadCount(items);
    }

    function updatePermissionButton() {
        const button = byId('notification-permission');
        if (!button) return;
        if (!('Notification' in window)) {
            button.textContent = 'Browser alerts unavailable';
            button.disabled = true;
        } else if (window.Notification.permission === 'granted') {
            button.textContent = 'Browser alerts enabled';
            button.disabled = true;
        } else if (window.Notification.permission === 'denied') {
            button.textContent = 'Browser alerts blocked';
            button.disabled = true;
        } else {
            button.textContent = 'Enable browser alerts';
            button.disabled = false;
        }
    }

    async function requestPermission() {
        if (!('Notification' in window) || window.Notification.permission !== 'default') return;
        try {
            await window.Notification.requestPermission();
        } finally {
            updatePermissionButton();
        }
    }

    function sendBrowserNotification(item) {
        if (!('Notification' in window) || window.Notification.permission !== 'granted') return;
        try {
            const notification = new window.Notification(item.title, {
                body: item.message,
                tag: item.type,
                renotify: false
            });
            window.setTimeout(() => notification.close(), 10000);
        } catch (_error) {
            // The in-dashboard Notification Center remains the fallback.
        }
    }

    function addLocal(item) {
        state.localItems.unshift(normalizeNotification({
            ...item,
            id: item.id || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`
        }, 0, 'local'));
        state.localItems = state.localItems.slice(0, 50);
        render();
    }

    function raiseCondition(key, active, notification, options = {}) {
        const previouslyActive = state.activeConditions.get(key) === true;
        state.activeConditions.set(key, Boolean(active));
        if (!active) return;

        const now = Date.now();
        const lastRaised = state.lastRaised.get(key) || 0;
        if (previouslyActive && now - lastRaised < state.cooldownMs) return;
        state.lastRaised.set(key, now);

        const item = normalizeNotification({
            ...notification,
            id: `local-${key}-${now}`,
            timestamp: new Date(now).toISOString(),
            read: false
        }, 0, 'local');
        sendBrowserNotification(item);
        if (options.forceLocal || state.serverAvailable === false) addLocal(item);
        else if (state.serverAvailable === null) state.pendingLocal.push(item);
    }

    function ingestStatus(payload) {
        const data = unwrapStatus(payload);
        const temperature = number(data.temperature ?? data.temp);
        const light = number(data.lightLevel ?? data.light ?? data.ldr);
        const alerts = data.alerts || {};
        const temperatureHigh = booleanValue(alerts.temperatureHigh) === true;
        const lowLight = booleanValue(alerts.lowLight) === true;
        const intruderDetected = booleanValue(
            alerts.intruderDetected ?? data.motionDetected ?? data.presenceDetected
        ) === true;

        raiseCondition('intruder-detected', intruderDetected, {
            type: 'INTRUDER_DETECTED',
            severity: 'critical',
            title: 'Cảnh báo có người lạ vào nhà',
            message: 'Cảm biến chuyển động phát hiện có người trong nhà. Hãy kiểm tra ngay.',
            value: true,
            source: data.source || 'controller'
        });

        raiseCondition('temperature-high', temperatureHigh, {
            type: 'TEMPERATURE_HIGH',
            severity: 'danger',
            title: 'High temperature detected',
            message: temperature === null ? 'The temperature threshold was exceeded.' : `Temperature reached ${temperature.toFixed(1)}°C.`,
            value: temperature,
            threshold: data.thresholds?.temperature,
            source: data.source || 'controller'
        });
        raiseCondition('low-light', lowLight, {
            type: 'LOW_LIGHT',
            severity: 'warning',
            title: 'Low light detected',
            message: light === null ? 'Ambient light is below the configured threshold.' : `Ambient light dropped to ${Math.round(light)} Lux.`,
            value: light,
            threshold: data.thresholds?.dark,
            source: data.source || 'controller'
        });
    }

    function setConnection(connected, detail = '') {
        raiseCondition('connection-lost', !connected, {
            type: 'CONNECTION_LOST',
            severity: 'danger',
            title: 'Controller connection lost',
            message: detail || 'The dashboard cannot reach the ESP32 or backend.',
            source: 'dashboard'
        }, { forceLocal: true });
        if (!connected && state.pendingLocal.length) {
            state.pendingLocal.splice(0).forEach(addLocal);
        }
    }

    async function markRead(id, origin, button) {
        if (button) button.disabled = true;
        const collection = origin === 'local' ? state.localItems : state.serverItems;
        const item = collection.find((candidate) => candidate.id === id);
        try {
            if (origin === 'server' && state.serverAvailable) {
                await state.api.markNotificationRead(id);
            }
            if (item) item.read = true;
            render();
        } catch (error) {
            const status = byId('notification-api-status');
            if (status) {
                status.textContent = state.api.describeError(error);
                status.className = 'section-status error-text';
            }
            if (button) button.disabled = false;
        }
    }

    async function load() {
        if (!state.api || state.loading) return;
        state.loading = true;
        const status = byId('notification-api-status');
        if (status) {
            status.textContent = 'Loading saved notifications…';
            status.className = 'section-status';
        }
        try {
            const payload = await state.api.getNotifications(50);
            state.serverAvailable = true;
            state.serverItems = normalizeItems(payload);
            state.pendingLocal = [];
            if (status) {
                const total = number(payload?.total) ?? state.serverItems.length;
                status.textContent = `${total} saved notification${total === 1 ? '' : 's'} from the API.`;
            }
            return true;
        } catch (error) {
            state.serverAvailable = false;
            state.serverItems = [];
            state.pendingLocal.splice(0).forEach(addLocal);
            if (status) {
                status.textContent = error.endpointUnavailable
                    ? 'Notification API is unavailable on this device; showing live browser-session alerts.'
                    : `${state.api.describeError(error)} Live browser-session alerts remain available.`;
                status.className = 'section-status warning-text';
            }
            return false;
        } finally {
            state.loading = false;
            render();
        }
    }

    function setCooldown(milliseconds) {
        const parsed = number(milliseconds);
        if (parsed !== null && parsed >= 0) state.cooldownMs = parsed;
    }

    function init(api) {
        state.api = api;
        updatePermissionButton();
        const permission = byId('notification-permission');
        const refresh = byId('notifications-refresh');
        const list = byId('notification-list');
        if (permission) permission.addEventListener('click', requestPermission);
        if (refresh) refresh.addEventListener('click', load);
        if (list) {
            list.addEventListener('click', (event) => {
                const button = event.target.closest('[data-notification-id]');
                if (!button) return;
                markRead(button.dataset.notificationId, button.dataset.origin, button);
            });
        }
        render();
    }

    window.notificationCenter = Object.freeze({
        ingestStatus,
        init,
        load,
        setConnection,
        setCooldown
    });
})(window, document);
