(function createForecastPanel(window, document) {
    'use strict';

    const state = { api: null, loading: false };

    function byId(id) {
        return document.getElementById(id);
    }

    function number(value) {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function normalizedTrend(value) {
        const trend = String(value || 'STABLE').trim().toUpperCase();
        if (['INCREASING', 'UP', 'RISING', 'INCREASE'].includes(trend)) return 'INCREASING';
        if (['DECREASING', 'DOWN', 'FALLING', 'DECREASE'].includes(trend)) return 'DECREASING';
        if (['STABLE', 'STEADY', 'UNCHANGED'].includes(trend)) return 'STABLE';
        return trend;
    }

    function trendIcon(trend) {
        if (trend === 'INCREASING') return '↗';
        if (trend === 'DECREASING') return '↘';
        return '→';
    }

    function confidenceText(metric) {
        const label = metric.confidence;
        const score = number(metric.confidenceScore);
        if (label && score !== null) {
            const percentage = score <= 1 ? score * 100 : score;
            return `${String(label)} (${Math.round(percentage)}%)`;
        }
        if (label) return String(label);
        if (score !== null) {
            const percentage = score <= 1 ? score * 100 : score;
            return `${Math.round(percentage)}%`;
        }
        return 'Not available';
    }

    function addDetail(list, label, value) {
        const row = document.createElement('li');
        const name = document.createElement('span');
        const content = document.createElement('strong');
        name.textContent = label;
        content.textContent = value;
        row.append(name, content);
        list.append(row);
    }

    function createMetricCard(title, metric, root) {
        const card = document.createElement('article');
        card.className = 'forecast-card';
        const heading = document.createElement('div');
        heading.className = 'forecast-heading';
        const name = document.createElement('h3');
        name.textContent = title;
        const trend = normalizedTrend(metric?.trend);
        const trendBadge = document.createElement('span');
        trendBadge.className = `trend-badge trend-${trend.toLowerCase()}`;
        trendBadge.textContent = `${trendIcon(trend)} ${trend}`;
        heading.append(name, trendBadge);

        const insufficient = Boolean(root.insufficientData || metric?.insufficientData);
        const predicted = number(metric?.predictedValue ?? metric?.value);
        const value = document.createElement('strong');
        value.className = 'forecast-value';
        value.textContent = insufficient || predicted === null
            ? 'Insufficient data'
            : `${predicted.toFixed(1)} ${metric?.unit || ''}`.trim();

        const details = document.createElement('ul');
        details.className = 'forecast-details';
        const horizon = number(metric?.horizonMinutes ?? root.horizonMinutes);
        const samples = number(metric?.samplesUsed ?? root.sampleCount);
        const movingAverage = number(metric?.movingAverage);
        const changeRate = number(metric?.changeRate);
        addDetail(details, 'Horizon', horizon === null ? 'Not available' : `${Math.round(horizon)} minutes`);
        addDetail(details, 'Samples used', samples === null ? 'Not available' : String(Math.round(samples)));
        addDetail(details, 'Confidence', confidenceText(metric || {}));
        if (movingAverage !== null) addDetail(details, 'Moving average', `${movingAverage.toFixed(1)} ${metric?.unit || ''}`.trim());
        if (changeRate !== null) addDetail(details, 'Change rate', `${changeRate.toFixed(3)} / sample`);

        if (insufficient) card.classList.add('is-unavailable');
        card.append(heading, value, details);
        return card;
    }

    function createEnvironmentCard(environmentTrend, root) {
        const metric = typeof environmentTrend === 'object' ? environmentTrend : { trend: environmentTrend };
        const card = document.createElement('article');
        card.className = 'forecast-card environment-forecast-card';
        const heading = document.createElement('div');
        heading.className = 'forecast-heading';
        const title = document.createElement('h3');
        title.textContent = 'Environment quality';
        const badge = document.createElement('span');
        const trend = normalizedTrend(metric.trend || metric.direction || metric.level);
        badge.className = `trend-badge trend-${trend.toLowerCase()}`;
        badge.textContent = `${trendIcon(trend)} ${trend}`;
        heading.append(title, badge);
        const description = document.createElement('p');
        description.className = 'forecast-environment-text';
        description.textContent = root.insufficientData
            ? 'There are not enough stored samples to estimate an environment trend.'
            : String(metric.message || metric.description || `Short-term environment trend: ${trend.toLowerCase()}.`);
        card.append(heading, description);
        return card;
    }

    function render(payload) {
        const root = payload?.forecast || payload?.data || payload || {};
        const grid = byId('forecast-grid');
        if (!grid) return;
        grid.replaceChildren(
            createMetricCard('Temperature', root.temperature || {}, root),
            createEnvironmentCard(root.environmentTrend || root.environment || 'STABLE', root)
        );
    }

    function formatGeneratedAt(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date);
    }

    async function load() {
        if (!state.api || state.loading) return;
        state.loading = true;
        const status = byId('forecast-status');
        const refresh = byId('forecast-refresh');
        if (status) {
            status.textContent = 'Calculating forecast from stored readings…';
            status.className = 'section-status';
        }
        if (refresh) refresh.disabled = true;

        try {
            const payload = await state.api.getForecast();
            render(payload);
            const root = payload?.forecast || payload?.data || payload || {};
            if (status) {
                const generated = formatGeneratedAt(root.generatedAt);
                status.textContent = root.insufficientData
                    ? 'Insufficient stored data for a reliable forecast.'
                    : `Statistical forecast ready${generated ? ` · generated ${generated}` : ''}.`;
                status.className = root.insufficientData ? 'section-status warning-text' : 'section-status success-text';
            }
            return true;
        } catch (error) {
            const grid = byId('forecast-grid');
            if (grid) grid.replaceChildren();
            if (status) {
                status.textContent = error.endpointUnavailable
                    ? 'Forecast is unavailable on this connected device/API.'
                    : state.api.describeError(error);
                status.className = 'section-status error-text';
            }
            return false;
        } finally {
            state.loading = false;
            if (refresh) refresh.disabled = false;
        }
    }

    function init(api) {
        state.api = api;
        const refresh = byId('forecast-refresh');
        if (refresh) refresh.addEventListener('click', load);
    }

    window.forecastPanel = Object.freeze({ init, load });
})(window, document);
