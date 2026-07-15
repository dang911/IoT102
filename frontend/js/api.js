const urlParams = new URLSearchParams(window.location.search);
const configuredApi =
    window.API_BASE_URL ||
    urlParams.get("api") ||
    localStorage.getItem("API_BASE_URL") ||
    "";

if (urlParams.get("api")) {
    localStorage.setItem("API_BASE_URL", urlParams.get("api"));
}

const API = configuredApi.replace(/\/+$/, "");

function apiUrl(path) {
    return `${API}${path}`;
}

function createTimeoutSignal(timeoutMs = 3000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    return {
        signal: controller.signal,
        clear: () => clearTimeout(timeout)
    };
}

function mockStatus() {
    const lightLevel = Math.floor(100 + Math.random() * 800);
    const temperature = Number((20 + Math.random() * 20).toFixed(1));
    const lowLight = lightLevel < 200;
    const temperatureHigh = temperature > 35;

    return {
        temperature,
        lightLevel,
        lightStatus: Math.random() > 0.5,
        mode: Math.random() > 0.5 ? "AUTO" : "MANUAL",
        status: {
            temperature: temperatureHigh ? "HIGH" : "NORMAL",
            environment: lowLight ? "DARK" : "BRIGHT"
        },
        alerts: {
            temperatureHigh,
            lowLight
        },
        thresholds: {
            temperature: 35,
            dark: 200,
            bright: 260
        }
    };
}

async function requestJson(path, options = {}) {
    const timeout = createTimeoutSignal(options.timeoutMs);

    try {
        const res = await fetch(apiUrl(path), {
            ...options,
            signal: timeout.signal,
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            }
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText || "Network response was not ok");
        }

        return await res.json();
    } finally {
        timeout.clear();
    }
}

// Lấy dữ liệu
async function getStatus() {
    try {
        return await requestJson("/api/status", { timeoutMs: 3000 });
    } catch (error) {
        // Fallback to mock data so the dashboard still works for demo without ESP32
        console.warn("Using mock dashboard data:", error.message);
        return mockStatus();
    }
}

// Gửi lệnh điều khiển mode
async function setMode(mode) {
    console.log(`Setting mode to: ${mode}`);
    try {
        return await requestJson("/api/mode", {
            method: "POST",
            body: JSON.stringify({ mode }),
            timeoutMs: 3000
        });
    } catch (error) {
        console.error("Failed to set mode:", error);
        return null;
    }
}

// Gửi lệnh điều khiển đèn
async function setLight(status) {
    console.log(`Setting light to: ${status}`);
    try {
        return await requestJson("/api/light", {
            method: "POST",
            body: JSON.stringify({ status }),
            timeoutMs: 3000
        });
    } catch (error) {
        console.error("Failed to set light:", error);
        return null;
    }
}

window.api = {
    getStatus,
    setMode,
    setLight
};
