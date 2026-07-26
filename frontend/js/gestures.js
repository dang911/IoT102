(function createGestureControl(window, document) {
    'use strict';

    const MEDIAPIPE_MODULE_URL =
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const MEDIAPIPE_WASM_URL =
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
    const GESTURE_MODEL_URL =
        'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
    const MIN_CONFIDENCE = 0.7;
    const REQUIRED_STABLE_FRAMES = 6;

    const LABELS = Object.freeze({
        Pointing_Up: '☝️ Pointing up',
        Victory: '✌️ Victory',
        Open_Palm: '🖐️ Open palm',
        Closed_Fist: '✊ Closed fist'
    });

    const state = {
        running: false,
        recognizer: null,
        stream: null,
        animationFrame: 0,
        lastVideoTime: -1,
        candidate: 'None',
        stableFrames: 0,
        lastCommandGesture: null,
        emptyFrames: 0
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function setStatus(message, type = '') {
        const result = byId('gesture-result');
        if (!result) return;
        result.textContent = message;
        result.className = `inline-feedback${type ? ` ${type}-text` : ''}`;
    }

    function setRunningUi(running) {
        const start = byId('gesture-start');
        const stop = byId('gesture-stop');
        const badge = byId('gesture-badge');
        const placeholder = byId('gesture-camera-placeholder');
        if (start) start.disabled = running;
        if (stop) stop.disabled = !running;
        if (badge) {
            badge.textContent = running ? 'ACTIVE' : 'OFF';
            badge.className = `badge ${running ? 'badge-success' : 'badge-neutral'}`;
        }
        if (placeholder) placeholder.hidden = running;
    }

    function pressed(selector) {
        return document.querySelector(`${selector}[aria-pressed="true"]`);
    }

    function demoModeEnabled() {
        return byId('gesture-demo-mode')?.checked === true;
    }

    function applyDemoControl(button, expectedValue) {
        const group = button.closest('.toggle-buttons');
        group?.querySelectorAll('.btn').forEach((candidate) => {
            candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false');
        });
        setStatus(`Demo command: ${expectedValue}. No API request was sent.`, 'success');
        if (window.dashboard?.showToast) {
            window.dashboard.showToast(`Gesture demo: ${expectedValue}.`, 'success');
        }
        return true;
    }

    function clickControl(selector, expectedValue) {
        const button = document.querySelector(selector);
        if (!button) {
            setStatus('Controller is not ready for gesture commands.', 'warning');
            return false;
        }
        if (demoModeEnabled()) return applyDemoControl(button, expectedValue);
        if (button.disabled) {
            setStatus('Controller is not ready. Enable Demo without API to test locally.', 'warning');
            return false;
        }
        if (button.getAttribute('aria-pressed') === 'true') {
            setStatus(`${expectedValue} is already active.`, 'success');
            return true;
        }
        button.click();
        setStatus(`Gesture command sent: ${expectedValue}.`, 'success');
        return true;
    }

    function executeGesture(gesture) {
        if (gesture === 'Pointing_Up') {
            return clickControl('#mode-buttons [data-mode="AUTO"]', 'AUTO mode');
        }
        if (gesture === 'Victory') {
            return clickControl('#mode-buttons [data-mode="MANUAL"]', 'MANUAL mode');
        }

        const manualMode = pressed('#mode-buttons [data-mode="MANUAL"]');
        if (!manualMode) {
            setStatus('Use ✌️ to enable MANUAL mode before controlling the light.', 'warning');
            return false;
        }
        if (gesture === 'Open_Palm') {
            return clickControl('#light-buttons [data-light="ON"]', 'light ON');
        }
        if (gesture === 'Closed_Fist') {
            return clickControl('#light-buttons [data-light="OFF"]', 'light OFF');
        }
        return false;
    }

    function consumeResult(result) {
        const category = result?.gestures?.[0]?.[0];
        const gesture = category && category.score >= MIN_CONFIDENCE
            ? category.categoryName
            : 'None';

        if (!LABELS[gesture]) {
            state.emptyFrames += 1;
            state.candidate = 'None';
            state.stableFrames = 0;
            if (state.emptyFrames >= REQUIRED_STABLE_FRAMES) {
                state.lastCommandGesture = null;
                setStatus('Show a supported hand gesture to the camera.');
            }
            return;
        }

        state.emptyFrames = 0;
        if (gesture === state.candidate) state.stableFrames += 1;
        else {
            state.candidate = gesture;
            state.stableFrames = 1;
        }

        const confidence = Math.round(category.score * 100);
        setStatus(`Recognizing ${LABELS[gesture]} (${confidence}%)…`);
        if (
            state.stableFrames >= REQUIRED_STABLE_FRAMES &&
            gesture !== state.lastCommandGesture
        ) {
            state.lastCommandGesture = gesture;
            executeGesture(gesture);
        }
    }

    function predict() {
        if (!state.running) return;
        const video = byId('gesture-video');
        if (video && video.readyState >= 2 && video.currentTime !== state.lastVideoTime) {
            state.lastVideoTime = video.currentTime;
            try {
                consumeResult(state.recognizer.recognizeForVideo(video, performance.now()));
            } catch (error) {
                setStatus(`Gesture recognition error: ${error.message}`, 'error');
            }
        }
        state.animationFrame = window.requestAnimationFrame(predict);
    }

    async function loadRecognizer() {
        if (state.recognizer) return state.recognizer;
        setStatus('Loading gesture recognition model…');
        const vision = await import(MEDIAPIPE_MODULE_URL);
        const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
        state.recognizer = await vision.GestureRecognizer.createFromOptions(fileset, {
            baseOptions: {
                modelAssetPath: GESTURE_MODEL_URL,
                delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.6
        });
        return state.recognizer;
    }

    async function start() {
        if (state.running) return;
        const startButton = byId('gesture-start');
        if (startButton) startButton.disabled = true;
        try {
            if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
                throw new Error('Webcam requires localhost or an HTTPS page.');
            }
            await loadRecognizer();
            state.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
                audio: false
            });
            const video = byId('gesture-video');
            video.srcObject = state.stream;
            await video.play();
            state.running = true;
            state.lastVideoTime = -1;
            state.lastCommandGesture = null;
            setRunningUi(true);
            setStatus('Webcam active. Show a supported gesture.', 'success');
            predict();
        } catch (error) {
            setRunningUi(false);
            setStatus(`Cannot start webcam: ${error.message}`, 'error');
        }
    }

    function stop() {
        state.running = false;
        window.cancelAnimationFrame(state.animationFrame);
        if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
        state.stream = null;
        const video = byId('gesture-video');
        if (video) video.srcObject = null;
        setRunningUi(false);
        setStatus('Webcam is off.');
    }

    function init() {
        byId('gesture-start')?.addEventListener('click', start);
        byId('gesture-stop')?.addEventListener('click', stop);
        byId('gesture-demo-mode')?.addEventListener('change', (event) => {
            state.lastCommandGesture = null;
            if (event.target.checked) {
                const manual = document.querySelector('#mode-buttons [data-mode="MANUAL"]');
                if (!pressed('#mode-buttons [data-mode]') && manual) {
                    applyDemoControl(manual, 'MANUAL mode');
                }
                setStatus('Demo mode enabled. Gesture commands stay in this browser.', 'warning');
            } else {
                setStatus('Demo mode disabled. Commands will use the API.');
            }
        });
        window.addEventListener('pagehide', stop);
        setRunningUi(false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})(window, document);
