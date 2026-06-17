const API = "http://192.168.1.100";

// Lấy dữ liệu
async function getStatus() {
    try {
        const res = await fetch(API + "/api/status", {
            // Adding a small timeout to not hang the dashboard if ESP is offline
            signal: AbortSignal.timeout(3000)
        });
        
        if (!res.ok) throw new Error("Network response was not ok");
        
        return await res.json();
    } catch (error) {
        // Fallback to mock data so the dashboard still works for demo without ESP32
        return {
            // Mock LM35 temperature: 20-40 degrees
            temperature: (20 + Math.random() * 20).toFixed(1),
            // Mock LDR intensity: assuming mapped to Lux (0-1000) or raw ADC (0-4095). Let's use Lux for UI readability.
            lightLevel: Math.floor(100 + Math.random() * 800),
            lightStatus: Math.random() > 0.5,
            mode: Math.random() > 0.5 ? "AUTO" : "MANUAL"
        };
    }
}

// Gửi lệnh điều khiển mode
async function setMode(mode) {
    console.log(`Setting mode to: ${mode}`);
    try {
        await fetch(API + "/api/mode", { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode }) 
        });
    } catch (error) {
        console.error("Failed to set mode (ESP32 may be offline):", error);
    }
}

// Gửi lệnh điều khiển đèn
async function setLight(status) {
    console.log(`Setting light to: ${status}`);
    try {
        await fetch(API + "/api/light", { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }) 
        });
    } catch (error) {
        console.error("Failed to set light (ESP32 may be offline):", error);
    }
}

window.api = {
    getStatus,
    setMode,
    setLight
};
