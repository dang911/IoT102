#include <Arduino.h>
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
bool lcdOnline = false;
float temperatureC = 0.0f;
int lightLevel = 0;
bool lightStatus = false;
String operatingMode = "AUTO";
uint32_t lastSensorReadMs = 0;
uint32_t lastLcdRefreshMs = 0;

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
    if (lightLevel < DEFAULT_DARK_THRESHOLD) {
      setLight(true);
    } else if (lightLevel >= DEFAULT_BRIGHT_THRESHOLD) {
      setLight(false);
    }
  }
}

String statusJson() {
  const bool temperatureHigh =
      temperatureC > DEFAULT_TEMPERATURE_THRESHOLD_C;
  const bool lowLight = lightLevel < DEFAULT_DARK_THRESHOLD;
  String json;
  json.reserve(600);
  json += "{\"temperature\":" + String(temperatureC, 1);
  json += ",\"lightLevel\":" + String(lightLevel);
  json += ",\"lightStatus\":";
  json += lightStatus ? "true" : "false";
  json += ",\"mode\":\"" + operatingMode + "\"";
  json += ",\"temperatureStatus\":\"";
  json += temperatureHigh ? "HIGH" : "NORMAL";
  json += "\",\"lightEnvironment\":\"";
  json += lowLight ? "DARK" : "BRIGHT";
  json += "\",\"dataSource\":\"REAL_SENSOR\"";
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
  server.send(code, "application/json; charset=utf-8", json);
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

  pinMode(LIGHT_LED_PIN, OUTPUT);
  setLight(false);

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
  updateLcd();
  printReadings();
  delay(10);
}
