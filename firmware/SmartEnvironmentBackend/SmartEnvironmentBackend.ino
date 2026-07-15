/*
  Smart Environment Monitoring & Lighting Control System
  ESP32 backend firmware

  API contract:
  GET  /api/status -> current temperature, light level, LED status, mode
  POST /api/mode   -> {"mode":"AUTO"} or {"mode":"MANUAL"}
  POST /api/light  -> {"status":"ON"} or {"status":"OFF"}; switches to MANUAL
*/

#include <WiFi.h>
#include <WebServer.h>

#define USE_LCD 0
#if USE_LCD
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
#endif

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const int LM35_PIN = 34;
const int LDR_PIN = 35;
const int LED_PIN = 2;
const bool LED_ACTIVE_HIGH = true;

const float TEMPERATURE_THRESHOLD = 35.0;
const int DARK_THRESHOLD = 200;
const int BRIGHT_THRESHOLD = 260;
const unsigned long SENSOR_INTERVAL_MS = 1000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000;

WebServer server(80);

String mode = "AUTO";
bool lightStatus = false;
float temperatureC = 0.0;
int lightLevel = 0;
unsigned long lastSensorRead = 0;
unsigned long lastWifiRetry = 0;

const char DASHBOARD_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Smart Environment Dashboard</title>
  <style>
    :root {
      --bg: #f4f7fb;
      --panel: #ffffff;
      --text: #172033;
      --muted: #687286;
      --line: #dde5f0;
      --blue: #2563eb;
      --cyan: #0891b2;
      --green: #16a34a;
      --red: #dc2626;
      --amber: #d97706;
      --shadow: 0 16px 40px rgba(24, 39, 75, .10);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--text);
      background: var(--bg);
    }
    .shell {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 24px 0;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    .brand h1 {
      margin: 0;
      font-size: 26px;
      line-height: 1.2;
    }
    .brand p {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .connection {
      min-width: 190px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
      text-align: right;
      font-size: 13px;
      color: var(--muted);
    }
    .dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 6px;
      background: var(--green);
    }
    .dot.offline { background: var(--red); }
    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 16px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 18px;
    }
    .span-6 { grid-column: span 6; }
    .span-4 { grid-column: span 4; }
    .span-8 { grid-column: span 8; }
    .card h2 {
      margin: 0 0 14px;
      font-size: 16px;
    }
    .value {
      margin: 0;
      font-size: 42px;
      font-weight: 700;
      line-height: 1;
    }
    .cyan { color: var(--cyan); }
    .green { color: var(--green); }
    .red { color: var(--red); }
    .muted { color: var(--muted); }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 16px;
      color: var(--muted);
      font-size: 13px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #f8fafc;
      font-size: 13px;
      font-weight: 600;
    }
    .pill.on {
      color: #166534;
      border-color: #bbf7d0;
      background: #f0fdf4;
    }
    .pill.off {
      color: #475569;
      background: #f8fafc;
    }
    .controls {
      display: grid;
      gap: 14px;
    }
    .control-row label {
      display: block;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .button-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    button {
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #f8fafc;
      color: var(--text);
      font-weight: 700;
      cursor: pointer;
    }
    button.active {
      border-color: var(--blue);
      background: var(--blue);
      color: white;
    }
    button:disabled {
      cursor: wait;
      opacity: .72;
    }
    .alert-list {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .alert {
      padding: 12px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #f8fafc;
      color: var(--muted);
      font-size: 14px;
    }
    .alert.danger {
      border-color: #fecaca;
      background: #fef2f2;
      color: var(--red);
    }
    .alert.warning {
      border-color: #fed7aa;
      background: #fff7ed;
      color: var(--amber);
    }
    .alert.success {
      border-color: #bbf7d0;
      background: #f0fdf4;
      color: var(--green);
    }
    .history {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .stat {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #f8fafc;
    }
    .stat span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .stat strong { font-size: 20px; }
    footer {
      margin-top: 16px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }
    @media (max-width: 760px) {
      .shell { width: min(100% - 20px, 1180px); padding: 14px 0; }
      header { align-items: stretch; flex-direction: column; }
      .connection { text-align: left; }
      .span-4, .span-6, .span-8 { grid-column: 1 / -1; }
      .value { font-size: 36px; }
      .history { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand">
        <h1>Smart Environment Dashboard</h1>
        <p>ESP32 temperature monitoring and lighting control</p>
      </div>
      <div class="connection">
        <div><span id="conn-dot" class="dot"></span><strong id="conn-text">Connecting</strong></div>
        <div id="health-text">Waiting for ESP32...</div>
      </div>
    </header>

    <main class="grid">
      <section class="card span-6">
        <h2>Temperature</h2>
        <p id="temp-value" class="value cyan">--.- C</p>
        <div class="meta">
          <span>Status: <strong id="temp-status">--</strong></span>
          <span>Threshold: <strong id="temp-threshold">--</strong> C</span>
        </div>
      </section>

      <section class="card span-6">
        <h2>Light Sensor</h2>
        <p id="light-value" class="value green">--- Lux</p>
        <div class="meta">
          <span>Environment: <strong id="env-status">--</strong></span>
          <span>LED: <strong id="led-status" class="pill off">OFF</strong></span>
        </div>
      </section>

      <section class="card span-4">
        <h2>Control Panel</h2>
        <div class="controls">
          <div class="control-row">
            <label>Mode</label>
            <div class="button-row">
              <button id="mode-auto" data-mode="AUTO">AUTO</button>
              <button id="mode-manual" data-mode="MANUAL">MANUAL</button>
            </div>
          </div>
          <div class="control-row">
            <label>Light</label>
            <div class="button-row">
              <button id="light-on" data-light="ON">ON</button>
              <button id="light-off" data-light="OFF">OFF</button>
            </div>
          </div>
        </div>
      </section>

      <section class="card span-4">
        <h2>Temperature History</h2>
        <div class="history">
          <div class="stat"><span>Max</span><strong id="temp-max">--.-</strong></div>
          <div class="stat"><span>Min</span><strong id="temp-min">--.-</strong></div>
          <div class="stat"><span>Avg</span><strong id="temp-avg">--.-</strong></div>
        </div>
      </section>

      <section class="card span-4">
        <h2>Alert Center</h2>
        <ul id="alert-list" class="alert-list">
          <li class="alert">Waiting for sensor data...</li>
        </ul>
      </section>

      <section class="card span-8">
        <h2>System</h2>
        <div class="meta">
          <span>Mode: <strong id="mode-value">--</strong></span>
          <span>Dark: <strong id="dark-threshold">--</strong> Lux</span>
          <span>Bright: <strong id="bright-threshold">--</strong> Lux</span>
          <span>Last update: <strong id="last-update">--</strong></span>
        </div>
      </section>

      <section class="card span-4">
        <h2>Quick Test</h2>
        <div class="meta">
          <span>API: <strong>/api/status</strong></span>
          <span>Health: <strong>/api/health</strong></span>
        </div>
      </section>
    </main>

    <footer>Frontend and backend are served together by the ESP32.</footer>
  </div>

  <script>
    const tempSamples = [];
    const maxHistory = 120;
    const pollMs = 2000;
    let busy = false;

    const $ = (id) => document.getElementById(id);

    function setConnection(online, text, detail) {
      $("conn-dot").classList.toggle("offline", !online);
      $("conn-text").textContent = text;
      $("health-text").textContent = detail || "";
    }

    function setButtons(group, active) {
      document.querySelectorAll("[data-" + group + "]").forEach((button) => {
        button.classList.toggle("active", button.dataset[group] === active);
      });
    }

    function setBusy(value) {
      busy = value;
      document.querySelectorAll("button").forEach((button) => {
        button.disabled = value;
      });
    }

    async function requestJson(path, options) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(path, {
          ...options,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(options && options.headers ? options.headers : {})
          }
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : {};
        if (!response.ok) throw new Error(data.error || "Request failed");
        return data;
      } finally {
        clearTimeout(timeout);
      }
    }

    function updateHistory(temp) {
      if (!Number.isFinite(temp)) return;
      tempSamples.push(temp);
      if (tempSamples.length > maxHistory) tempSamples.shift();
      const sum = tempSamples.reduce((total, item) => total + item, 0);
      $("temp-max").textContent = Math.max(...tempSamples).toFixed(1);
      $("temp-min").textContent = Math.min(...tempSamples).toFixed(1);
      $("temp-avg").textContent = (sum / tempSamples.length).toFixed(1);
    }

    function renderAlerts(data) {
      const items = [];
      if (data.alerts && data.alerts.temperatureHigh) {
        items.push('<li class="alert danger">High temperature detected</li>');
      }
      if (data.alerts && data.alerts.lowLight) {
        items.push('<li class="alert warning">Low light detected</li>');
      }
      if (!items.length) {
        items.push('<li class="alert success">System normal</li>');
      }
      $("alert-list").innerHTML = items.join("");
    }

    function renderStatus(data) {
      const temp = Number(data.temperature);
      const light = Number(data.lightLevel);
      updateHistory(temp);

      $("temp-value").textContent = temp.toFixed(1) + " C";
      $("light-value").textContent = light + " Lux";
      $("temp-status").textContent = data.status ? data.status.temperature : "--";
      $("env-status").textContent = data.status ? data.status.environment : "--";
      $("mode-value").textContent = data.mode;
      $("temp-threshold").textContent = data.thresholds ? data.thresholds.temperature : "--";
      $("dark-threshold").textContent = data.thresholds ? data.thresholds.dark : "--";
      $("bright-threshold").textContent = data.thresholds ? data.thresholds.bright : "--";
      $("last-update").textContent = new Date().toLocaleTimeString();

      $("temp-value").className = "value " + ((data.alerts && data.alerts.temperatureHigh) ? "red" : "cyan");
      $("led-status").textContent = data.lightStatus ? "ON" : "OFF";
      $("led-status").className = "pill " + (data.lightStatus ? "on" : "off");

      setButtons("mode", data.mode);
      setButtons("light", data.lightStatus ? "ON" : "OFF");
      renderAlerts(data);
      setConnection(true, "Online", "ESP32 is serving dashboard and API");
    }

    async function refreshHealth() {
      try {
        const health = await requestJson("/api/health");
        setConnection(true, "Online", "IP " + health.ip + " | RSSI " + health.rssi + " dBm");
      } catch (error) {
        setConnection(false, "Offline", error.message);
      }
    }

    async function refreshStatus() {
      if (busy) return;
      try {
        const data = await requestJson("/api/status");
        renderStatus(data);
      } catch (error) {
        setConnection(false, "Offline", error.message);
      }
    }

    async function postMode(mode) {
      setBusy(true);
      try {
        renderStatus(await requestJson("/api/mode", {
          method: "POST",
          body: JSON.stringify({ mode })
        }));
      } finally {
        setBusy(false);
      }
    }

    async function postLight(status) {
      setBusy(true);
      try {
        renderStatus(await requestJson("/api/light", {
          method: "POST",
          body: JSON.stringify({ status })
        }));
      } finally {
        setBusy(false);
      }
    }

    $("mode-auto").addEventListener("click", () => postMode("AUTO"));
    $("mode-manual").addEventListener("click", () => postMode("MANUAL"));
    $("light-on").addEventListener("click", () => postLight("ON"));
    $("light-off").addEventListener("click", () => postLight("OFF"));

    refreshHealth();
    refreshStatus();
    setInterval(refreshStatus, pollMs);
    setInterval(refreshHealth, 10000);
  </script>
</body>
</html>
)rawliteral";

void writeLed(bool enabled) {
  int activeLevel = LED_ACTIVE_HIGH ? HIGH : LOW;
  digitalWrite(LED_PIN, enabled ? activeLevel : !activeLevel);
}

void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Headers", "content-type");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

void sendJson(int code, const String& payload) {
  addCorsHeaders();
  server.send(code, "application/json", payload);
}

String boolJson(bool value) {
  return value ? "true" : "false";
}

String jsonEscape(const String& value) {
  String escaped = value;
  escaped.replace("\\", "\\\\");
  escaped.replace("\"", "\\\"");
  return escaped;
}

void readSensors() {
  int lm35MilliVolts = analogReadMilliVolts(LM35_PIN);
  temperatureC = lm35MilliVolts / 10.0;

  int rawLdr = analogRead(LDR_PIN);
  lightLevel = map(rawLdr, 0, 4095, 0, 1000);
}

void applyAutoLighting() {
  if (mode != "AUTO") {
    return;
  }

  if (lightLevel < DARK_THRESHOLD) {
    lightStatus = true;
  } else if (lightLevel >= BRIGHT_THRESHOLD) {
    lightStatus = false;
  }

  writeLed(lightStatus);
}

void updateLcd() {
#if USE_LCD
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("T:");
  lcd.print(temperatureC, 1);
  lcd.print("C L:");
  lcd.print(lightLevel);
  lcd.setCursor(0, 1);
  lcd.print(mode);
  lcd.print(" LED:");
  lcd.print(lightStatus ? "ON" : "OFF");
#endif
}

void refreshSystem() {
  if (millis() - lastSensorRead < SENSOR_INTERVAL_MS) {
    return;
  }

  lastSensorRead = millis();
  readSensors();
  applyAutoLighting();
  updateLcd();
}

String buildHealthJson() {
  String json = "{";
  json += "\"ok\":true,";
  json += "\"service\":\"esp32-smart-environment\",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  json += "\"uptimeMs\":" + String(millis());
  json += "}";
  return json;
}

String buildStatusJson() {
  bool temperatureHigh = temperatureC > TEMPERATURE_THRESHOLD;
  bool lowLight = lightLevel < DARK_THRESHOLD;

  String json = "{";
  json += "\"temperature\":" + String(temperatureC, 1) + ",";
  json += "\"lightLevel\":" + String(lightLevel) + ",";
  json += "\"lightStatus\":" + boolJson(lightStatus) + ",";
  json += "\"mode\":\"" + jsonEscape(mode) + "\",";
  json += "\"status\":{";
  json += "\"temperature\":\"" + String(temperatureHigh ? "HIGH" : "NORMAL") + "\",";
  json += "\"environment\":\"" + String(lowLight ? "DARK" : "BRIGHT") + "\"";
  json += "},";
  json += "\"alerts\":{";
  json += "\"temperatureHigh\":" + boolJson(temperatureHigh) + ",";
  json += "\"lowLight\":" + boolJson(lowLight);
  json += "},";
  json += "\"thresholds\":{";
  json += "\"temperature\":" + String(TEMPERATURE_THRESHOLD, 1) + ",";
  json += "\"dark\":" + String(DARK_THRESHOLD) + ",";
  json += "\"bright\":" + String(BRIGHT_THRESHOLD);
  json += "}";
  json += "}";
  return json;
}

String requestBodyUpper() {
  String body = server.arg("plain");
  body.toUpperCase();
  return body;
}

void handleOptions() {
  addCorsHeaders();
  server.send(204);
}

void handleDashboard() {
  server.sendHeader("Cache-Control", "no-store");
  server.send_P(200, "text/html; charset=utf-8", DASHBOARD_HTML);
}

void handleStatus() {
  refreshSystem();
  sendJson(200, buildStatusJson());
}

void handleHealth() {
  sendJson(200, buildHealthJson());
}

void handleMode() {
  String body = requestBodyUpper();

  if (body.indexOf("AUTO") >= 0) {
    mode = "AUTO";
  } else if (body.indexOf("MANUAL") >= 0) {
    mode = "MANUAL";
  } else {
    sendJson(400, "{\"error\":\"mode must be AUTO or MANUAL\"}");
    return;
  }

  applyAutoLighting();
  sendJson(200, buildStatusJson());
}

void handleLight() {
  String body = requestBodyUpper();

  if (body.indexOf("ON") >= 0 || body.indexOf("TRUE") >= 0) {
    lightStatus = true;
  } else if (body.indexOf("OFF") >= 0 || body.indexOf("FALSE") >= 0) {
    lightStatus = false;
  } else {
    sendJson(400, "{\"error\":\"status must be ON or OFF\"}");
    return;
  }

  mode = "MANUAL";
  writeLed(lightStatus);
  sendJson(200, buildStatusJson());
}

void handleNotFound() {
  if (server.method() == HTTP_OPTIONS) {
    handleOptions();
    return;
  }

  sendJson(404, "{\"error\":\"endpoint not found\"}");
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("ESP32 API: http://");
  Serial.println(WiFi.localIP());
}

void reconnectWifiIfNeeded() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (millis() - lastWifiRetry < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastWifiRetry = millis();
  Serial.println("WiFi disconnected. Reconnecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setupRoutes() {
  server.on("/", HTTP_GET, handleDashboard);
  server.on("/index.html", HTTP_GET, handleDashboard);
  server.on("/api/health", HTTP_GET, handleHealth);
  server.on("/api/health", HTTP_OPTIONS, handleOptions);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/status", HTTP_OPTIONS, handleOptions);
  server.on("/api/mode", HTTP_POST, handleMode);
  server.on("/api/mode", HTTP_OPTIONS, handleOptions);
  server.on("/api/light", HTTP_POST, handleLight);
  server.on("/api/light", HTTP_OPTIONS, handleOptions);
  server.onNotFound(handleNotFound);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  writeLed(false);
  analogReadResolution(12);
  analogSetPinAttenuation(LM35_PIN, ADC_11db);
  analogSetPinAttenuation(LDR_PIN, ADC_11db);

#if USE_LCD
  lcd.init();
  lcd.backlight();
#endif

  readSensors();
  applyAutoLighting();
  connectWifi();
  setupRoutes();
  server.begin();
}

void loop() {
  server.handleClient();
  refreshSystem();
  reconnectWifiIfNeeded();
}
