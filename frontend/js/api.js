(function createApiClient(window) {
    'use strict';

    const urlParams = new URLSearchParams(window.location.search);

    function readStorage(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (_error) {
            return null;
        }
    }

    function writeStorage(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (_error) {
            // Storage can be unavailable in private browsing or an embedded WebView.
        }
    }

    const queryApi = urlParams.get('api');
    if (queryApi) writeStorage('API_BASE_URL', queryApi);

    const configuredApi =
        queryApi ||
        window.API_BASE_URL ||
        readStorage('API_BASE_URL') ||
        '';
    const API_BASE_URL = String(configuredApi).replace(/\/+$/, '');

    class ApiError extends Error {
        constructor(message, details = {}) {
            super(message);
            this.name = 'ApiError';
            this.status = details.status || 0;
            this.path = details.path || '';
            this.code = details.code || 'API_ERROR';
            this.payload = details.payload;
            this.cause = details.cause;
        }

        get endpointUnavailable() {
            return this.status === 404 || this.status === 405 || this.status === 501;
        }

        get connectionFailure() {
            return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
        }
    }

    function apiUrl(path, query = undefined) {
        const url = `${API_BASE_URL}${path}`;
        if (!query) return url;

        const params = new URLSearchParams();
        Object.entries(query).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                params.set(key, String(value));
            }
        });
        const suffix = params.toString();
        return suffix ? `${url}?${suffix}` : url;
    }

    async function request(path, options = {}) {
        const {
            timeoutMs = 5000,
            query,
            responseType = 'json',
            headers = {},
            ...fetchOptions
        } = options;
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

        try {
            let response;
            try {
                response = await window.fetch(apiUrl(path, query), {
                    ...fetchOptions,
                    signal: controller.signal,
                    headers: {
                        Accept: responseType === 'text' ? 'text/plain, text/csv, application/json' : 'application/json',
                        ...(fetchOptions.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                        ...headers
                    }
                });
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    throw new ApiError(`Request timed out after ${timeoutMs} ms`, {
                        path,
                        code: 'TIMEOUT',
                        cause: error
                    });
                }
                throw new ApiError('Cannot connect to the API', {
                    path,
                    code: 'NETWORK_ERROR',
                    cause: error
                });
            }

            const raw = response.status === 204 ? '' : await response.text();
            let payload = null;
            if (raw) {
                const contentType = response.headers.get('content-type') || '';
                if (responseType === 'text' && !contentType.includes('application/json')) {
                    payload = raw;
                } else {
                    try {
                        payload = JSON.parse(raw);
                    } catch (error) {
                        if (response.ok && responseType === 'text') {
                            payload = raw;
                        } else {
                            throw new ApiError('API returned invalid JSON', {
                                path,
                                status: response.status,
                                code: 'INVALID_RESPONSE',
                                cause: error
                            });
                        }
                    }
                }
            }

            if (!response.ok) {
                const message =
                    (payload && (payload.error || payload.message)) ||
                    `Request failed with HTTP ${response.status}`;
                throw new ApiError(message, {
                    path,
                    status: response.status,
                    code: 'HTTP_ERROR',
                    payload
                });
            }

            return payload;
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    function getStatus() {
        return request('/api/status', { timeoutMs: 4000 });
    }

    function setMode(mode) {
        return request('/api/mode', {
            method: 'POST',
            body: JSON.stringify({ mode }),
            timeoutMs: 5000
        });
    }

    function setLight(status) {
        return request('/api/light', {
            method: 'POST',
            body: JSON.stringify({ status }),
            timeoutMs: 5000
        });
    }

    function getHistory(limit = 180) {
        return request('/api/history', {
            query: { limit },
            timeoutMs: 7000
        });
    }

    function getNotifications(limit = 50) {
        return request('/api/notifications', {
            query: { limit },
            timeoutMs: 6000
        });
    }

    function markNotificationRead(id) {
        return request(`/api/notifications/${encodeURIComponent(id)}/read`, {
            method: 'PATCH',
            body: JSON.stringify({ read: true }),
            timeoutMs: 5000
        });
    }

    function getForecast() {
        return request('/api/forecast', { timeoutMs: 7000 });
    }

    function getReport(period = 'daily') {
        return request('/api/reports', {
            query: { period },
            timeoutMs: 10000
        });
    }

    function getReportCsv(period = 'daily') {
        return request('/api/reports', {
            query: { period, format: 'csv' },
            responseType: 'text',
            timeoutMs: 10000,
            headers: { Accept: 'text/csv, text/plain, application/json' }
        });
    }

    function getConfig() {
        return request('/api/config', { timeoutMs: 5000 });
    }

    function updateConfig(config) {
        return request('/api/config', {
            method: 'PATCH',
            body: JSON.stringify(config),
            timeoutMs: 7000
        });
    }

    function describeError(error) {
        if (!(error instanceof ApiError)) return 'Unexpected dashboard error';
        if (error.endpointUnavailable) return 'This API endpoint is not available on the connected device.';
        if (error.code === 'TIMEOUT') return 'The API did not respond in time.';
        if (error.code === 'NETWORK_ERROR') return 'The dashboard cannot reach the API.';
        return error.message;
    }

    window.api = Object.freeze({
        ApiError,
        baseUrl: API_BASE_URL,
        describeError,
        getConfig,
        getForecast,
        getHistory,
        getNotifications,
        getReport,
        getReportCsv,
        getStatus,
        markNotificationRead,
        request,
        setLight,
        setMode,
        updateConfig
    });
})(window);
