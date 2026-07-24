#include <Arduino.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <Wire.h>

#include "Config.h"
#include "DashboardPage.h"
#include "Lcd1602I2C.h"

using namespace ProjectConfig;

namespace {

Lcd1602I2C lcd;
WebServer server(80);
Preferences preferences;
bool lcdOnline = false;
float temperatureC = 0.0f;
int lightLevel = 0;
bool lightStatus = false;
bool buzzerStatus = false;
String operatingMode = "AUTO";
float temperatureThresholdC = DEFAULT_TEMPERATURE_THRESHOLD_C;
int darkThreshold = DEFAULT_DARK_THRESHOLD;
int brightThreshold = DEFAULT_BRIGHT_THRESHOLD;
uint32_t lastSensorReadMs = 0;
uint32_t lastLcdRefreshMs = 0;
uint32_t lastBuzzerToggleMs = 0;

uint16_t averageRawAdc(uint8_t pin) {
  uint32_t total = 0;
  for (uint8_t index = 0; index < ENVIRONMENT_AVERAGE_SAMPLES; ++index) {
    total += analogRead(pin);
  }
  return static_cast<uint16_t>(total / ENVIRONMENT_AVERAGE_SAMPLES);
}

uint32_t averageMilliVolts(uint8_t pin) {
  uint32_t total = 0;
  for (uint8_t index = 0; index < ENVIRONMENT_AVERAGE_SAMPLES; ++index) {
    total += analogReadMilliVolts(pin);
  }
  return total / ENVIRONMENT_AVERAGE_SAMPLES;
}

void setLight(bool enabled) {
  lightStatus = enabled;
  const uint8_t activeLevel = LIGHT_LED_ACTIVE_HIGH ? HIGH : LOW;
  digitalWrite(LIGHT_LED_PIN, enabled ? activeLevel : !activeLevel);
}

void setBuzzer(bool enabled) {
  buzzerStatus = enabled;
  const uint8_t activeLevel = BUZZER_ACTIVE_HIGH ? HIGH : LOW;
  digitalWrite(BUZZER_PIN, enabled ? activeLevel : !activeLevel);
}

void updateOverheatBuzzer() {
  const bool overheat =
      OVERHEAT_BUZZER_ENABLED &&
      temperatureC >= temperatureThresholdC;
  if (!overheat) {
    setBuzzer(false);
    return;
  }

  const uint32_t nowMs = millis();
  if (static_cast<uint32_t>(nowMs - lastBuzzerToggleMs) >=
      BUZZER_TEMPERATURE_TOGGLE_MS) {
    lastBuzzerToggleMs = nowMs;
    setBuzzer(!buzzerStatus);
  }
}

void readSensors(bool force = false) {
  const uint32_t nowMs = millis();
  if (!force &&
      static_cast<uint32_t>(nowMs - lastSensorReadMs) <
          ENVIRONMENT_SENSOR_INTERVAL_MS) {
    return;
  }
  lastSensorReadMs = nowMs;

  temperatureC =
      static_cast<float>(averageMilliVolts(LM35_PIN)) / 10.0f +
      LM35_TEMPERATURE_OFFSET_C;
  lightLevel = map(averageRawAdc(LDR_PIN), 0, ADC_MAX_RAW, 0, 1000);

  if (operatingMode == "AUTO") {
    if (lightLevel < darkThreshold) {
      setLight(true);
    } else if (lightLevel >= brightThreshold) {
      setLight(false);
    }
  }
}

String statusJson() {
  const bool temperatureHigh =
      temperatureC > temperatureThresholdC;
  const bool lowLight = lightLevel < darkThreshold;
  String json;
  json.reserve(600);
  json += "{\"temperature\":" + String(temperatureC, 1);
  json += ",\"lightLevel\":" + String(lightLevel);
  json += ",\"lightStatus\":";
  json += lightStatus ? "true" : "false";
  json += ",\"buzzerStatus\":";
  json += buzzerStatus ? "true" : "false";
  json += ",\"mode\":\"" + operatingMode + "\"";
  json += ",\"temperatureStatus\":\"";
  json += temperatureHigh ? "HIGH" : "NORMAL";
  json += "\",\"lightEnvironment\":\"";
  json += lowLight ? "DARK" : "BRIGHT";
  json += "\",\"dataSource\":\"REAL_SENSOR\"";
  json += ",\"thresholds\":{\"temperature\":";
  json += String(temperatureThresholdC, 1);
  json += ",\"dark\":" + String(darkThreshold);
  json += ",\"bright\":" + String(brightThreshold) + "}";
  json += ",\"sensors\":{\"temperature\":{\"online\":true},";
  json += "\"light\":{\"online\":true}},\"alerts\":{";
  json += "\"temperatureHigh\":";
  json += temperatureHigh ? "true" : "false";
  json += ",\"lowLight\":";
  json += lowLight ? "true" : "false";
  json += "},\"timestamp\":" + String(millis()) + "}";
  return json;
}

void sendJson(int code, const String& json) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  server.send(code, "application/json; charset=utf-8", json);
}

void sendOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  server.send(204, "text/plain", "");
}

String configJson() {
  String json = "{\"temperatureThreshold\":";
  json += String(temperatureThresholdC, 1);
  json += ",\"darkThreshold\":" + String(darkThreshold);
  json += ",\"brightThreshold\":" + String(brightThreshold);
  json += ",\"persistent\":true}";
  return json;
}

bool readJsonNumber(const String& body, const char* key, float& value) {
  const String token = String("\"") + key + "\"";
  int start = body.indexOf(token);
  if (start < 0) return false;
  start = body.indexOf(':', start + token.length());
  if (start < 0) return false;
  ++start;
  int end = body.indexOf(',', start);
  const int objectEnd = body.indexOf('}', start);
  if (end < 0 || (objectEnd >= 0 && objectEnd < end)) end = objectEnd;
  if (end < 0) return false;
  String numeric = body.substring(start, end);
  numeric.trim();
  if (numeric.length() == 0) return false;
  value = numeric.toFloat();
  return isfinite(value);
}

void loadRuntimeConfig() {
  if (!preferences.begin("smartenv", true)) return;
  temperatureThresholdC =
      preferences.getFloat("tempHigh", DEFAULT_TEMPERATURE_THRESHOLD_C);
  darkThreshold = preferences.getInt("dark", DEFAULT_DARK_THRESHOLD);
  brightThreshold = preferences.getInt("bright", DEFAULT_BRIGHT_THRESHOLD);
  preferences.end();
}

bool saveRuntimeConfig() {
  if (!preferences.begin("smartenv", false)) return false;
  bool ok = preferences.putFloat("tempHigh", temperatureThresholdC) > 0;
  ok &= preferences.putInt("dark", darkThreshold) > 0;
  ok &= preferences.putInt("bright", brightThreshold) > 0;
  preferences.end();
  return ok;
}

void handleConfigUpdate() {
  const String body = server.arg("plain");
  float requestedTemperature;
  float requestedDark;
  float requestedBright;
  if (!readJsonNumber(body, "temperatureThreshold", requestedTemperature) ||
      !readJsonNumber(body, "darkThreshold", requestedDark) ||
      !readJsonNumber(body, "brightThreshold", requestedBright)) {
    sendJson(400, "{\"error\":\"three numeric thresholds are required\"}");
    return;
  }

  const int requestedDarkInt = static_cast<int>(roundf(requestedDark));
  const int requestedBrightInt = static_cast<int>(roundf(requestedBright));
  if (requestedTemperature < -20.0f || requestedTemperature > 100.0f ||
      requestedDarkInt < 0 || requestedBrightInt > 1000 ||
      requestedBrightInt <= requestedDarkInt) {
    sendJson(400, "{\"error\":\"invalid threshold range\"}");
    return;
  }

  temperatureThresholdC = requestedTemperature;
  darkThreshold = requestedDarkInt;
  brightThreshold = requestedBrightInt;
  if (!saveRuntimeConfig()) {
    sendJson(500, "{\"error\":\"could not save configuration\"}");
    return;
  }
  sendJson(200, configJson());
}

void sendStatus() {
  readSensors(true);
  sendJson(200, statusJson());
}

void setupWebServer() {
  server.on("/", HTTP_GET, []() {
    server.send_P(200, "text/html; charset=utf-8", DASHBOARD_HTML);
  });
  server.on("/index.html", HTTP_GET, []() {
    server.send_P(200, "text/html; charset=utf-8", DASHBOARD_HTML);
  });
  server.on("/api/status", HTTP_GET, sendStatus);
  server.on("/api/health", HTTP_GET, []() {
    sendJson(200, "{\"ok\":true}");
  });
  server.on("/api/config", HTTP_GET, []() {
    sendJson(200, configJson());
  });
  server.on("/api/config", HTTP_PATCH, handleConfigUpdate);
  server.on("/api/mode", HTTP_POST, []() {
    const String body = server.arg("plain");
    if (body.indexOf("AUTO") >= 0) {
      operatingMode = "AUTO";
    } else if (body.indexOf("MANUAL") >= 0) {
      operatingMode = "MANUAL";
    } else {
      sendJson(400, "{\"error\":\"mode must be AUTO or MANUAL\"}");
      return;
    }
    sendStatus();
  });
  server.on("/api/light", HTTP_POST, []() {
    const String body = server.arg("plain");
    operatingMode = "MANUAL";
    if (body.indexOf("ON") >= 0) {
      setLight(true);
    } else if (body.indexOf("OFF") >= 0) {
      setLight(false);
    } else {
      sendJson(400, "{\"error\":\"status must be ON or OFF\"}");
      return;
    }
    sendStatus();
  });
  server.onNotFound([]() {
    if (server.method() == HTTP_OPTIONS) {
      sendOptions();
      return;
    }
    sendJson(404, "{\"error\":\"endpoint not found\"}");
  });
  server.begin();
  Serial.println("Web server da khoi dong.");
}

void updateLcd(bool force = false) {
  if (!lcdOnline || !lcd.isOnline()) {
    return;
  }
  const uint32_t nowMs = millis();
  if (!force &&
      static_cast<uint32_t>(nowMs - lastLcdRefreshMs) < LCD_REFRESH_MS) {
    return;
  }
  lastLcdRefreshMs = nowMs;

  lcd.setLine(0, "Nhiet do:" + String(temperatureC, 1) + "C");
  lcd.setLine(1, "Anh sang:" + String(lightLevel));
}

void printReadings() {
  static uint32_t lastPrintMs = 0;
  const uint32_t nowMs = millis();
  if (static_cast<uint32_t>(nowMs - lastPrintMs) <
      SERIAL_MONITOR_INTERVAL_MS) {
    return;
  }
  lastPrintMs = nowMs;
  Serial.print("Nhiet do: ");
  Serial.print(temperatureC, 1);
  Serial.print(" C | Anh sang: ");
  Serial.print(lightLevel);
  Serial.print(" | LED: ");
  Serial.println(lightStatus ? "ON" : "OFF");
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println();
  Serial.println("Smart Environment ESP32 firmware starting");

  loadRuntimeConfig();

  pinMode(LIGHT_LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  setLight(false);
  setBuzzer(false);

  analogReadResolution(12);
  analogSetPinAttenuation(LM35_PIN, ADC_6db);
  analogSetPinAttenuation(LDR_PIN, ADC_11db);

  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
  lcdOnline = lcd.begin(
      Wire, LCD_I2C_ADDRESS, LCD_COLUMNS, LCD_ROWS);

  if (lcdOnline) {
    lcd.setBacklight(true);
    Serial.print("LCD da ket noi tai dia chi 0x");
    Serial.println(LCD_I2C_ADDRESS, HEX);
  } else {
    Serial.print("Khong tim thay LCD tai dia chi 0x");
    Serial.println(LCD_I2C_ADDRESS, HEX);
    Serial.println("Thu doi LCD_I2C_ADDRESS trong Config.h thanh 0x3F.");
  }

  WiFi.mode(WIFI_AP);
  if (WiFi.softAP(FALLBACK_AP_SSID)) {
    Serial.print("WiFi AP: ");
    Serial.println(FALLBACK_AP_SSID);
    Serial.print("Dia chi IP: ");
    Serial.println(WiFi.softAPIP());
  } else {
    Serial.println("Khong the khoi tao WiFi AP.");
  }

  readSensors(true);
  updateLcd(true);
  setupWebServer();
}

void loop() {
  server.handleClient();
  readSensors();
  updateOverheatBuzzer();
  updateLcd();
  printReadings();
  delay(10);
}
