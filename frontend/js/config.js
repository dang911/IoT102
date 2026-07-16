(function createConfigPanel(window, document) {
    'use strict';

    const state = { api: null, available: false, loading: false, saving: false };

    function byId(id) {
        return document.getElementById(id);
    }

    function number(value) {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function first(...values) {
        return values.find((value) => value !== undefined && value !== null && value !== '');
    }

    function unwrapConfig(payload) {
        if (!payload || typeof payload !== 'object') return {};
        if (payload.config && typeof payload.config === 'object') return payload.config;
        if (payload.data && typeof payload.data === 'object') return payload.data;
        return payload;
    }

    function setInput(id, value) {
        const input = byId(id);
        if (input) input.value = value === undefined || value === null ? '' : String(value);
    }

    function populate(payload) {
        const config = unwrapConfig(payload);
        const thresholds = config.thresholds || {};
        const dustThresholds = config.dustThresholds || thresholds.dust || config.dust?.thresholds || {};
        const calibration = config.dustCalibration || config.calibration?.dust || config.dust?.calibration || {};

        setInput('config-temperature', first(config.temperatureThreshold, thresholds.temperature));
        setInput('config-dark', first(config.darkThreshold, thresholds.dark));
        setInput('config-bright', first(config.brightThreshold, thresholds.bright));
        setInput('config-history-limit', config.historyLimit);
        setInput('config-dust-moderate', first(dustThresholds.moderate, config.dustModerateThreshold));
        setInput('config-dust-high', first(dustThresholds.high, config.dustHighThreshold));
        setInput('config-dust-dangerous', first(dustThresholds.dangerous, config.dustDangerousThreshold));
        setInput('config-dust-baseline', first(calibration.cleanAirVoltage, calibration.baselineVoltage, config.dustBaselineVoltage));
        setInput('config-dust-factor', first(calibration.calibrationFactor, config.dustCalibrationFactor));
        setInput('config-dust-sensitivity', calibration.sensitivity);
        setInput('config-adc-reference', calibration.adcReferenceVoltage);
        const cooldownMs = number(first(config.notificationCooldownMs, config.notifications?.cooldownMs));
        setInput('config-cooldown', cooldownMs === null ? '' : cooldownMs / 1000);
        const calibrated = byId('config-dust-calibrated');
        if (calibrated) calibrated.checked = Boolean(first(calibration.calibrated, config.dustCalibrated, false));

        if (window.notificationCenter && cooldownMs !== null) {
            window.notificationCenter.setCooldown(cooldownMs);
        }
    }

    function setFormEnabled(enabled) {
        const form = byId('config-form');
        if (!form) return;
        form.querySelectorAll('input').forEach((input) => {
            input.disabled = !enabled || state.loading || state.saving;
        });
        const submit = byId('config-submit');
        if (submit) submit.disabled = !enabled || state.loading || state.saving;
        const refresh = byId('config-refresh');
        if (refresh) refresh.disabled = state.loading || state.saving;
    }

    function setStatus(message, type = '') {
        const status = byId('config-status');
        if (!status) return;
        status.textContent = message;
        status.className = `inline-feedback${type ? ` ${type}-text` : ''}`;
    }

    function readInput(id) {
        const input = byId(id);
        return input ? number(input.value) : null;
    }

    function requireValue(id, label) {
        const value = readInput(id);
        if (value === null) throw new Error(`${label} is required.`);
        return value;
    }

    function buildPayload() {
        const temperatureThreshold = requireValue('config-temperature', 'High temperature threshold');
        const darkThreshold = requireValue('config-dark', 'Dark threshold');
        const brightThreshold = requireValue('config-bright', 'Bright threshold');
        if (brightThreshold <= darkThreshold) {
            throw new Error('Bright threshold must be greater than dark threshold.');
        }

        const payload = { temperatureThreshold, darkThreshold, brightThreshold };
        const historyLimit = readInput('config-history-limit');
        if (historyLimit !== null) payload.historyLimit = Math.round(historyLimit);

        const dustValues = [
            readInput('config-dust-moderate'),
            readInput('config-dust-high'),
            readInput('config-dust-dangerous')
        ];
        if (dustValues.some((value) => value !== null)) {
            if (dustValues.some((value) => value === null)) {
                throw new Error('Complete all three internal dust thresholds.');
            }
            const [moderate, high, dangerous] = dustValues;
            if (!(moderate < high && high < dangerous)) {
                throw new Error('Dust thresholds must increase: moderate < high < dangerous.');
            }
            payload.dustThresholds = { moderate, high, dangerous };
        }

        const baseline = readInput('config-dust-baseline');
        const factor = readInput('config-dust-factor');
        const sensitivity = readInput('config-dust-sensitivity');
        const adcReference = readInput('config-adc-reference');
        if ([baseline, factor, sensitivity, adcReference].some((value) => value !== null)) {
            if (baseline === null || factor === null) {
                throw new Error('Clean-air baseline and calibration factor are both required for dust calibration.');
            }
            if (factor <= 0) throw new Error('Calibration factor must be greater than zero.');
            payload.dustCalibration = {
                cleanAirVoltage: baseline,
                calibrationFactor: factor,
                calibrated: Boolean(byId('config-dust-calibrated')?.checked)
            };
            if (sensitivity !== null) payload.dustCalibration.sensitivity = sensitivity;
            if (adcReference !== null) payload.dustCalibration.adcReferenceVoltage = adcReference;
        }

        const cooldownSeconds = readInput('config-cooldown');
        if (cooldownSeconds !== null) payload.notificationCooldownMs = Math.round(cooldownSeconds * 1000);
        return payload;
    }

    async function load() {
        if (!state.api || state.loading || state.saving) return;
        state.loading = true;
        setStatus('Loading controller configuration…');
        setFormEnabled(false);
        try {
            const payload = await state.api.getConfig();
            populate(payload);
            state.available = true;
            setStatus('Configuration loaded. Values are controller settings, not official AQI thresholds.', 'success');
        } catch (error) {
            state.available = false;
            setStatus(
                error.endpointUnavailable
                    ? 'Configuration is unavailable on this connected device/API.'
                    : state.api.describeError(error),
                'error'
            );
        } finally {
            state.loading = false;
            setFormEnabled(state.available);
        }
    }

    async function save(event) {
        event.preventDefault();
        if (!state.available || state.saving) return;
        let payload;
        try {
            payload = buildPayload();
        } catch (error) {
            setStatus(error.message, 'error');
            return;
        }

        state.saving = true;
        setFormEnabled(false);
        setStatus('Saving configuration…');
        try {
            const response = await state.api.updateConfig(payload);
            if (window.notificationCenter && payload.notificationCooldownMs !== undefined) {
                window.notificationCenter.setCooldown(payload.notificationCooldownMs);
            }
            document.dispatchEvent(new CustomEvent('dashboard:configsaved', { detail: response }));
            const refreshed = await state.api.getConfig();
            populate(refreshed);
            setStatus('Configuration saved successfully.', 'success');
            if (window.dashboard) window.dashboard.showToast('Controller configuration saved.', 'success');
        } catch (error) {
            setStatus(state.api.describeError(error), 'error');
        } finally {
            state.saving = false;
            setFormEnabled(state.available);
        }
    }

    function init(api) {
        state.api = api;
        const form = byId('config-form');
        const refresh = byId('config-refresh');
        if (form) form.addEventListener('submit', save);
        if (refresh) refresh.addEventListener('click', load);
        setFormEnabled(false);
    }

    window.configPanel = Object.freeze({ init, load });
})(window, document);
