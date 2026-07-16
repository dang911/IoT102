/*
  Smart Environment Monitoring & Lighting Control System

  Primary architecture: one ESP32 reads LM35, LDR and GP2Y1014AU0F directly,
  drives the room LED and dust-sensor optical LED, updates LCD1602 I2C, and
  serves both the REST API and embedded dashboard.

  GP2Y density is an uncalibrated estimate until calibrated against a reference
  instrument. It is not an official AQI measurement.
*/

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <Wire.h>
#include <time.h>

#include "Config.h"
#include "DashboardPage.h"
#include "DustSensor.h"
#include "Lcd1602I2C.h"

using namespace ProjectConfig;

namespace {

constexpr const char* FIRMWARE_VERSION = "2.0.0";
constexpr size_t MAX_JSON_BODY_BYTES = 1024;

struct RuntimeConfig {
  float temperatureThreshold;
  int darkThreshold;
  int brightThreshold;
  float dustModerateThreshold;
  float dustHighThreshold;
  float dustDangerousThreshold;
  DustCalibration dustCalibration;
};

struct AnalogSensorHealth {
  bool online;
  bool abnormal;
  uint32_t lastUpdateMs;
  uint16_t rawAdc;
};

RuntimeConfig runtimeConfig = {
    DEFAULT_TEMPERATURE_THRESHOLD_C,
    DEFAULT_DARK_THRESHOLD,
    DEFAULT_BRIGHT_THRESHOLD,
    DEFAULT_DUST_MODERATE_UG_M3,
    DEFAULT_DUST_HIGH_UG_M3,
    DEFAULT_DUST_DANGEROUS_UG_M3,
    {DEFAULT_DUST_ZERO_VOLTAGE,
     DEFAULT_DUST_SENSITIVITY_V_PER_UG_M3,
     DEFAULT_DUST_CALIBRATION_FACTOR,
     DEFAULT_DUST_CALIBRATION_OFFSET_UG_M3,
     DEFAULT_DUST_CALIBRATED},
};

WebServer server(80);
Preferences preferences;
Lcd1602I2C lcd;

String mode = "AUTO";
bool lightStatus = false;
float temperatureC = 0.0f;
int lightLevel = 0;
AnalogSensorHealth temperatureSensor = {};
AnalogSensorHealth lightSensor = {};

bool lcdOnline = false;
bool fallbackApActive = false;
bool ntpConfigured = false;
uint32_t lastEnvironmentReadMs = 0;
uint32_t lastWifiRetryMs = 0;
uint32_t lastLcdRefreshMs = 0;
uint32_t lastLcdPageChangeMs = 0;
uint8_t lcdPage = 0;
String lastLcdLine1;
String lastLcdLine2;

bool isConfiguredWifi() {
  return String(WIFI_SSID).length() > 0 &&
         String(WIFI_SSID) != "YOUR_WIFI_NAME";
}

void writeLightLed(bool enabled) {
  const uint8_t activeLevel = LIGHT_LED_ACTIVE_HIGH ? HIGH : LOW;
  digitalWrite(LIGHT_LED_PIN, enabled ? activeLevel : !activeLevel);
}

String temperatureStatus() {
  if (!temperatureSensor.online) {
    return "OFFLINE";
  }
  if (temperatureC > runtimeConfig.temperatureThreshold) {
    return "HIGH";
  }
  if (temperatureC < 10.0f) {
    return "LOW";
  }
  return "NORMAL";
}

String lightEnvironment() {
  if (!lightSensor.online) {
    return "OFFLINE";
  }
  return lightLevel < runtimeConfig.darkThreshold ? "DARK" : "BRIGHT";
}

String dustLevel() {
  if (!dustSensorState.sensorOnline) {
    return "UNKNOWN";
  }
  if (dustSensorState.density >= runtimeConfig.dustDangerousThreshold) {
    return "DANGEROUS";
  }
  if (dustSensorState.density >= runtimeConfig.dustHighThreshold) {
    return "HIGH";
  }
  if (dustSensorState.density >= runtimeConfig.dustModerateThreshold) {
    return "MODERATE";
  }
  return "CLEAN";
}

String overallStatus() {
  const String dust = dustLevel();
  if (dust == "DANGEROUS") {
    return "DANGEROUS";
  }
  if (!dustSensorState.sensorOnline || temperatureStatus() == "HIGH" ||
      dust == "HIGH") {
    return "WARNING";
  }
  return "NORMAL";
}

void applyAutoLighting() {
  if (mode != "AUTO" || !lightSensor.online) {
    return;
  }
  if (lightLevel < runtimeConfig.darkThreshold) {
    lightStatus = true;
  } else if (lightLevel >= runtimeConfig.brightThreshold) {
    lightStatus = false;
  }
  writeLightLed(lightStatus);
}

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

void readEnvironmentSensors(bool force = false) {
  const uint32_t nowMs = millis();
  if (!force &&
      static_cast<uint32_t>(nowMs - lastEnvironmentReadMs) <
          ENVIRONMENT_SENSOR_INTERVAL_MS) {
    return;
  }
  lastEnvironmentReadMs = nowMs;

  const uint32_t lm35MilliVolts = averageMilliVolts(LM35_PIN);
  temperatureC = static_cast<float>(lm35MilliVolts) / 10.0f;
  temperatureSensor.rawAdc = averageRawAdc(LM35_PIN);
  temperatureSensor.online =
      lm35MilliVolts > 4 && temperatureC >= 0.0f && temperatureC <= 150.0f;
  temperatureSensor.abnormal = !temperatureSensor.online;
  temperatureSensor.lastUpdateMs = nowMs;

  const uint16_t rawLdr = averageRawAdc(LDR_PIN);
  lightSensor.rawAdc = rawLdr;
  lightLevel = map(rawLdr, 0, ADC_MAX_RAW, 0, 1000);
  lightSensor.online = rawLdr > 2 && rawLdr < (ADC_MAX_RAW - 2);
  lightSensor.abnormal = !lightSensor.online;
  lightSensor.lastUpdateMs = nowMs;

  applyAutoLighting();
}

bool clockIsSynchronized() {
  return time(nullptr) > 1700000000;
}

String isoTimestampForUptime(uint32_t eventUptimeMs) {
  if (eventUptimeMs == 0 || !clockIsSynchronized()) {
    return String();
  }
  const uint32_t ageSeconds =
      static_cast<uint32_t>(millis() - eventUptimeMs) / 1000UL;
  time_t timestamp = time(nullptr) - ageSeconds;
  struct tm utcTime;
  if (gmtime_r(&timestamp, &utcTime) == nullptr) {
    return String();
  }
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utcTime);
  return String(buffer);
}

String currentIsoTimestamp() {
  if (!clockIsSynchronized()) {
    return String();
  }
  const time_t now = time(nullptr);
  struct tm utcTime;
  if (gmtime_r(&now, &utcTime) == nullptr) {
    return String();
  }
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utcTime);
  return String(buffer);
}

void loadRuntimeConfig() {
  if (!preferences.begin("smartenv", true)) {
    setDustCalibration(runtimeConfig.dustCalibration);
    return;
  }
  runtimeConfig.temperatureThreshold =
      preferences.getFloat("tempHigh", runtimeConfig.temperatureThreshold);
  runtimeConfig.darkThreshold =
      preferences.getInt("dark", runtimeConfig.darkThreshold);
  runtimeConfig.brightThreshold =
      preferences.getInt("bright", runtimeConfig.brightThreshold);
  runtimeConfig.dustModerateThreshold =
      preferences.getFloat("dustMod", runtimeConfig.dustModerateThreshold);
  runtimeConfig.dustHighThreshold =
      preferences.getFloat("dustHigh", runtimeConfig.dustHighThreshold);
  runtimeConfig.dustDangerousThreshold =
      preferences.getFloat("dustDanger", runtimeConfig.dustDangerousThreshold);
  runtimeConfig.dustCalibration.zeroVoltage =
      preferences.getFloat("dustZero", runtimeConfig.dustCalibration.zeroVoltage);
  runtimeConfig.dustCalibration.sensitivityVoltsPerUgM3 = preferences.getFloat(
      "dustSens", runtimeConfig.dustCalibration.sensitivityVoltsPerUgM3);
  runtimeConfig.dustCalibration.factor =
      preferences.getFloat("dustFactor", runtimeConfig.dustCalibration.factor);
  runtimeConfig.dustCalibration.offsetUgM3 =
      preferences.getFloat("dustOffset", runtimeConfig.dustCalibration.offsetUgM3);
  runtimeConfig.dustCalibration.calibrated = preferences.getBool(
      "dustCal", runtimeConfig.dustCalibration.calibrated);
  preferences.end();
  setDustCalibration(runtimeConfig.dustCalibration);
}

bool saveRuntimeConfig() {
  if (!preferences.begin("smartenv", false)) {
    return false;
  }
  bool ok = true;
  ok &= preferences.putFloat("tempHigh", runtimeConfig.temperatureThreshold) > 0;
  ok &= preferences.putInt("dark", runtimeConfig.darkThreshold) > 0;
  ok &= preferences.putInt("bright", runtimeConfig.brightThreshold) > 0;
  ok &= preferences.putFloat("dustMod", runtimeConfig.dustModerateThreshold) > 0;
  ok &= preferences.putFloat("dustHigh", runtimeConfig.dustHighThreshold) > 0;
  ok &= preferences.putFloat("dustDanger", runtimeConfig.dustDangerousThreshold) > 0;
  ok &= preferences.putFloat("dustZero", runtimeConfig.dustCalibration.zeroVoltage) > 0;
  ok &= preferences.putFloat(
            "dustSens", runtimeConfig.dustCalibration.sensitivityVoltsPerUgM3) > 0;
  ok &= preferences.putFloat("dustFactor", runtimeConfig.dustCalibration.factor) > 0;
  ok &= preferences.putFloat("dustOffset", runtimeConfig.dustCalibration.offsetUgM3) > 0;
  ok &= preferences.putBool("dustCal", runtimeConfig.dustCalibration.calibrated) > 0;
  preferences.end();
  return ok;
}

void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
}

void sendDocument(int code, JsonDocument& document) {
  String payload;
  payload.reserve(2300);
  serializeJson(document, payload);
  addCorsHeaders();
  server.send(code, "application/json", payload);
}

void sendError(int code, const String& message) {
  JsonDocument response;
  response["error"] = message;
  sendDocument(code, response);
}

void setNullableTimestamp(JsonVariant target, const String& value) {
  if (value.length() > 0) {
    target.set(value);
  } else {
    target.set(nullptr);
  }
}

void populateStatusDocument(JsonDocument& document) {
  const String tempState = temperatureStatus();
  const String environment = lightEnvironment();
  const String dustState = dustLevel();
  const bool temperatureHigh =
      temperatureSensor.online &&
      temperatureC > runtimeConfig.temperatureThreshold;
  const bool lowLight =
      lightSensor.online && lightLevel < runtimeConfig.darkThreshold;
  const bool dustHigh =
      dustSensorState.sensorOnline &&
      dustSensorState.density >= runtimeConfig.dustHighThreshold;

  // Legacy top-level fields remain unchanged for existing clients.
  document["temperature"] = serialized(String(temperatureC, 1));
  document["lightLevel"] = lightLevel;
  document["lightStatus"] = lightStatus;
  document["mode"] = mode;
  document["temperatureStatus"] = tempState;
  document["lightEnvironment"] = environment;
  document["timestamp"] = millis();

  document["firmwareVersion"] = FIRMWARE_VERSION;
  document["dataSource"] = "REAL_SENSOR";
  document["dataMode"] = "REAL";
  document["source"] = "esp32";
  document["simulated"] = false;
  document["overallStatus"] = overallStatus();
  setNullableTimestamp(document["generatedAt"], currentIsoTimestamp());

  JsonObject status = document["status"].to<JsonObject>();
  status["temperature"] = tempState;
  status["environment"] = environment;
  status["dust"] = dustState;
  status["overall"] = overallStatus();

  JsonObject sensors = document["sensors"].to<JsonObject>();
  JsonObject temperature = sensors["temperature"].to<JsonObject>();
  temperature["type"] = "LM35";
  temperature["online"] = temperatureSensor.online;
  temperature["abnormal"] = temperatureSensor.abnormal;
  temperature["rawAdc"] = temperatureSensor.rawAdc;
  temperature["lastUpdateMs"] = temperatureSensor.lastUpdateMs;
  setNullableTimestamp(temperature["lastUpdate"],
                       isoTimestampForUptime(temperatureSensor.lastUpdateMs));

  JsonObject light = sensors["light"].to<JsonObject>();
  light["type"] = "LDR";
  light["online"] = lightSensor.online;
  light["abnormal"] = lightSensor.abnormal;
  light["rawAdc"] = lightSensor.rawAdc;
  light["lastUpdateMs"] = lightSensor.lastUpdateMs;
  setNullableTimestamp(light["lastUpdate"],
                       isoTimestampForUptime(lightSensor.lastUpdateMs));

  JsonObject dust = document["dust"].to<JsonObject>();
  dust["sensor"] = "GP2Y1014AU0F";
  dust["source"] = "REAL_SENSOR";
  dust["rawAdc"] = dustSensorState.rawAdc;
  dust["adcVoltage"] = serialized(String(dustSensorState.adcVoltage, 3));
  dust["voltage"] = serialized(String(dustSensorState.voltage, 3));
  dust["density"] = serialized(String(dustSensorState.density, 1));
  dust["unit"] = "ug/m3";
  dust["level"] = dustState;
  dust["sensorOnline"] = dustSensorState.sensorOnline;
  dust["valid"] = dustSensorState.sensorOnline && !dustSensorState.abnormal;
  dust["abnormal"] = dustSensorState.abnormal;
  dust["saturated"] = dustSensorState.saturated;
  if (dustSensorState.sensorOnline && !dustSensorState.abnormal) {
    dust["error"] = nullptr;
  } else if (dustSensorState.saturated) {
    dust["error"] = "ADC_SATURATED";
  } else if (dustSensorState.lastUpdateMs == 0) {
    dust["error"] = "NO_VALID_DATA";
  } else {
    dust["error"] = "STALE_OR_INVALID";
  }
  dust["calibrated"] = dustSensorState.calibrated;
  dust["lastUpdateMs"] = dustSensorState.lastUpdateMs;
  dust["lastAttemptMs"] = dustSensorState.lastAttemptMs;
  setNullableTimestamp(dust["lastUpdate"],
                       isoTimestampForUptime(dustSensorState.lastUpdateMs));
  dust["validReadings"] = dustSensorState.validReadings;
  dust["invalidReadings"] = dustSensorState.invalidReadings;
  dust["disclaimer"] =
      "Estimated dust density for learning and trend monitoring only; not official AQI.";

  JsonObject alerts = document["alerts"].to<JsonObject>();
  alerts["temperatureHigh"] = temperatureHigh;
  alerts["lowLight"] = lowLight;
  alerts["dustHigh"] = dustHigh;
  alerts["dustSensorOffline"] = !dustSensorState.sensorOnline;
  alerts["sensorAbnormal"] = temperatureSensor.abnormal ||
                               lightSensor.abnormal ||
                               dustSensorState.abnormal;

  JsonObject thresholds = document["thresholds"].to<JsonObject>();
  thresholds["temperature"] = runtimeConfig.temperatureThreshold;
  thresholds["dark"] = runtimeConfig.darkThreshold;
  thresholds["bright"] = runtimeConfig.brightThreshold;
  thresholds["dustModerate"] = runtimeConfig.dustModerateThreshold;
  thresholds["dustHigh"] = runtimeConfig.dustHighThreshold;
  thresholds["dustDangerous"] = runtimeConfig.dustDangerousThreshold;
  thresholds["classification"] = "INTERNAL_PROJECT_THRESHOLDS_NOT_AQI";
}

void sendStatus(int code = 200) {
  readEnvironmentSensors();
  updateDustSensor();
  JsonDocument response;
  populateStatusDocument(response);
  sendDocument(code, response);
}

bool parseJsonBody(JsonDocument& document, String& error) {
  if (!server.hasArg("plain")) {
    error = "JSON body is required";
    return false;
  }
  const String body = server.arg("plain");
  if (body.length() == 0 || body.length() > MAX_JSON_BODY_BYTES) {
    error = "JSON body is empty or too large";
    return false;
  }
  const DeserializationError parseError = deserializeJson(document, body);
  if (parseError) {
    error = String("Invalid JSON: ") + parseError.c_str();
    return false;
  }
  if (!document.is<JsonObject>()) {
    error = "JSON body must be an object";
    return false;
  }
  return true;
}

bool readOptionalNumber(JsonObjectConst object, const char* key, float& target,
                        String& error) {
  JsonVariantConst value = object[key];
  if (value.isNull()) {
    return true;
  }
  if (!(value.is<float>() || value.is<double>() || value.is<int>() ||
        value.is<long>() || value.is<unsigned int>() ||
        value.is<unsigned long>())) {
    error = String(key) + " must be numeric";
    return false;
  }
  target = value.as<float>();
  return isfinite(target);
}

bool readOptionalInteger(JsonObjectConst object, const char* key, int& target,
                         String& error) {
  float numeric = static_cast<float>(target);
  if (!readOptionalNumber(object, key, numeric, error)) {
    return false;
  }
  if (!object[key].isNull()) {
    target = static_cast<int>(roundf(numeric));
  }
  return true;
}

bool validateRuntimeConfig(const RuntimeConfig& candidate, String& error) {
  if (!isfinite(candidate.temperatureThreshold) ||
      candidate.temperatureThreshold < -20.0f ||
      candidate.temperatureThreshold > 100.0f) {
    error = "temperatureThreshold must be between -20 and 100";
    return false;
  }
  if (candidate.darkThreshold < 0 || candidate.brightThreshold > 1000 ||
      candidate.brightThreshold <= candidate.darkThreshold) {
    error = "brightThreshold must be greater than darkThreshold (0..1000)";
    return false;
  }
  if (candidate.dustModerateThreshold < 0.0f ||
      candidate.dustHighThreshold <= candidate.dustModerateThreshold ||
      candidate.dustDangerousThreshold <= candidate.dustHighThreshold) {
    error = "dust thresholds must increase: moderate < high < dangerous";
    return false;
  }
  if (candidate.dustDangerousThreshold > 5000.0f) {
    error = "dustDangerousThreshold must not exceed 5000 ug/m3";
    return false;
  }
  const DustCalibration& calibration = candidate.dustCalibration;
  if (!isfinite(calibration.zeroVoltage) || calibration.zeroVoltage < 0.0f ||
      calibration.zeroVoltage > DUST_SENSOR_MAX_VALID_VOLTAGE) {
    error = "dustZeroVoltage is outside the sensor voltage range";
    return false;
  }
  if (!isfinite(calibration.sensitivityVoltsPerUgM3) ||
      calibration.sensitivityVoltsPerUgM3 < 0.000001f ||
      calibration.sensitivityVoltsPerUgM3 > 1.0f) {
    error = "dustSensitivity must be between 0.000001 and 1 V/(ug/m3)";
    return false;
  }
  if (!isfinite(calibration.factor) || calibration.factor <= 0.0f ||
      calibration.factor > 20.0f || !isfinite(calibration.offsetUgM3) ||
      calibration.offsetUgM3 < -5000.0f ||
      calibration.offsetUgM3 > 5000.0f) {
    error = "dust calibration factor/offset is outside the allowed range";
    return false;
  }
  return true;
}

void populateConfigDocument(JsonDocument& document) {
  document["temperatureThreshold"] = runtimeConfig.temperatureThreshold;
  document["darkThreshold"] = runtimeConfig.darkThreshold;
  document["brightThreshold"] = runtimeConfig.brightThreshold;
  document["dustModerateThreshold"] = runtimeConfig.dustModerateThreshold;
  document["dustHighThreshold"] = runtimeConfig.dustHighThreshold;
  document["dustDangerousThreshold"] = runtimeConfig.dustDangerousThreshold;
  document["dustZeroVoltage"] = runtimeConfig.dustCalibration.zeroVoltage;
  document["dustSensitivity"] =
      runtimeConfig.dustCalibration.sensitivityVoltsPerUgM3;
  document["dustCalibrationFactor"] = runtimeConfig.dustCalibration.factor;
  document["dustCalibrationOffset"] = runtimeConfig.dustCalibration.offsetUgM3;
  document["dustCalibrated"] = runtimeConfig.dustCalibration.calibrated;
  document["persistent"] = true;
  document["classification"] = "INTERNAL_PROJECT_THRESHOLDS_NOT_AQI";

  JsonObject dustThresholds = document["dustThresholds"].to<JsonObject>();
  dustThresholds["moderate"] = runtimeConfig.dustModerateThreshold;
  dustThresholds["high"] = runtimeConfig.dustHighThreshold;
  dustThresholds["dangerous"] = runtimeConfig.dustDangerousThreshold;

  JsonObject dustCalibration = document["dustCalibration"].to<JsonObject>();
  dustCalibration["cleanAirVoltage"] =
      runtimeConfig.dustCalibration.zeroVoltage;
  dustCalibration["sensitivity"] =
      runtimeConfig.dustCalibration.sensitivityVoltsPerUgM3;
  dustCalibration["calibrationFactor"] =
      runtimeConfig.dustCalibration.factor;
  dustCalibration["offsetUgM3"] =
      runtimeConfig.dustCalibration.offsetUgM3;
  dustCalibration["calibrated"] =
      runtimeConfig.dustCalibration.calibrated;
  dustCalibration["adcReferenceVoltage"] = ADC_FULL_SCALE_VOLTAGE;
  dustCalibration["adcMax"] = ADC_MAX_RAW;
  dustCalibration["sensitivityUnit"] = "V/(ug/m3)";

  JsonObject wiring = document["dustWiring"].to<JsonObject>();
  wiring["voPin"] = DUST_ANALOG_PIN;
  wiring["ledPin"] = DUST_LED_PIN;
  wiring["dividerTopOhm"] = DUST_DIVIDER_TOP_OHM;
  wiring["dividerBottomOhm"] = DUST_DIVIDER_BOTTOM_OHM;
  wiring["dividerRatio"] = DUST_DIVIDER_RATIO;
}

void handleDashboard() {
  server.sendHeader("Cache-Control", "no-store");
  server.send_P(200, "text/html; charset=utf-8", DASHBOARD_HTML);
}

void handleHealth() {
  JsonDocument response;
  response["ok"] = true;
  response["service"] = "esp32-smart-environment";
  response["firmwareVersion"] = FIRMWARE_VERSION;
  response["wifiConnected"] = WiFi.status() == WL_CONNECTED;
  response["fallbackAp"] = fallbackApActive;
  response["ip"] = WiFi.status() == WL_CONNECTED
                       ? WiFi.localIP().toString()
                       : WiFi.softAPIP().toString();
  response["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  response["uptimeMs"] = millis();
  response["lcdOnline"] = lcdOnline && lcd.isOnline();
  response["dustSensorOnline"] = dustSensorState.sensorOnline;
  response["dataSource"] = "REAL_SENSOR";
  sendDocument(200, response);
}

void handleMode() {
  JsonDocument body;
  String error;
  if (!parseJsonBody(body, error)) {
    sendError(400, error);
    return;
  }
  JsonVariantConst value = body["mode"];
  if (!value.is<const char*>()) {
    sendError(400, "mode must be AUTO or MANUAL");
    return;
  }
  String requestedMode = value.as<String>();
  requestedMode.toUpperCase();
  if (requestedMode != "AUTO" && requestedMode != "MANUAL") {
    sendError(400, "mode must be AUTO or MANUAL");
    return;
  }
  mode = requestedMode;
  applyAutoLighting();
  sendStatus();
}

void setManualLight(bool enabled) {
  mode = "MANUAL";
  lightStatus = enabled;
  writeLightLed(lightStatus);
}

void handleLight() {
  JsonDocument body;
  String error;
  if (!parseJsonBody(body, error)) {
    sendError(400, error);
    return;
  }

  JsonVariantConst value = body["status"];
  bool enabled = false;
  if (value.is<bool>()) {
    enabled = value.as<bool>();
  } else if (value.is<const char*>()) {
    String status = value.as<String>();
    status.toUpperCase();
    if (status == "ON") {
      enabled = true;
    } else if (status == "OFF") {
      enabled = false;
    } else {
      sendError(400, "status must be ON, OFF, true, or false");
      return;
    }
  } else {
    sendError(400, "status must be ON, OFF, true, or false");
    return;
  }

  setManualLight(enabled);
  sendStatus();
}

void handleModeAutoAlias() {
  mode = "AUTO";
  applyAutoLighting();
  sendStatus();
}

void handleModeManualAlias() {
  mode = "MANUAL";
  sendStatus();
}

void handleLightOnAlias() {
  setManualLight(true);
  sendStatus();
}

void handleLightOffAlias() {
  setManualLight(false);
  sendStatus();
}

void handleGetConfig() {
  JsonDocument response;
  populateConfigDocument(response);
  sendDocument(200, response);
}

void handlePatchConfig() {
  JsonDocument body;
  String error;
  if (!parseJsonBody(body, error)) {
    sendError(400, error);
    return;
  }
  JsonObjectConst object = body.as<JsonObjectConst>();
  RuntimeConfig candidate = runtimeConfig;

  if (!readOptionalNumber(object, "temperatureThreshold",
                          candidate.temperatureThreshold, error) ||
      !readOptionalInteger(object, "darkThreshold", candidate.darkThreshold,
                           error) ||
      !readOptionalInteger(object, "brightThreshold", candidate.brightThreshold,
                           error) ||
      !readOptionalNumber(object, "dustModerateThreshold",
                          candidate.dustModerateThreshold, error) ||
      !readOptionalNumber(object, "dustHighThreshold",
                          candidate.dustHighThreshold, error) ||
      !readOptionalNumber(object, "dustDangerousThreshold",
                          candidate.dustDangerousThreshold, error) ||
      !readOptionalNumber(object, "dustZeroVoltage",
                          candidate.dustCalibration.zeroVoltage, error) ||
      !readOptionalNumber(object, "dustSensitivity",
                          candidate.dustCalibration.sensitivityVoltsPerUgM3,
                          error) ||
      !readOptionalNumber(object, "dustCalibrationFactor",
                          candidate.dustCalibration.factor, error) ||
      !readOptionalNumber(object, "dustCalibrationOffset",
                          candidate.dustCalibration.offsetUgM3, error)) {
    sendError(400, error);
    return;
  }

  // Backend-compatible top-level aliases.
  if (!readOptionalNumber(object, "cleanAirVoltage",
                          candidate.dustCalibration.zeroVoltage, error) ||
      !readOptionalNumber(object, "calibrationFactor",
                          candidate.dustCalibration.factor, error)) {
    sendError(400, error);
    return;
  }

  JsonVariantConst thresholdPatch = object["dustThresholds"];
  if (!thresholdPatch.isNull()) {
    if (!thresholdPatch.is<JsonObjectConst>()) {
      sendError(400, "dustThresholds must be an object");
      return;
    }
    JsonObjectConst thresholds = thresholdPatch.as<JsonObjectConst>();
    if (!readOptionalNumber(thresholds, "moderate",
                            candidate.dustModerateThreshold, error) ||
        !readOptionalNumber(thresholds, "high",
                            candidate.dustHighThreshold, error) ||
        !readOptionalNumber(thresholds, "dangerous",
                            candidate.dustDangerousThreshold, error)) {
      sendError(400, error);
      return;
    }
  }

  JsonVariantConst calibrationPatch = object["dustCalibration"];
  if (!calibrationPatch.isNull()) {
    if (!calibrationPatch.is<JsonObjectConst>()) {
      sendError(400, "dustCalibration must be an object");
      return;
    }
    JsonObjectConst calibrationObject = calibrationPatch.as<JsonObjectConst>();
    if (!readOptionalNumber(calibrationObject, "cleanAirVoltage",
                            candidate.dustCalibration.zeroVoltage, error) ||
        !readOptionalNumber(calibrationObject, "sensitivity",
                            candidate.dustCalibration.sensitivityVoltsPerUgM3,
                            error) ||
        !readOptionalNumber(calibrationObject, "calibrationFactor",
                            candidate.dustCalibration.factor, error) ||
        !readOptionalNumber(calibrationObject, "offsetUgM3",
                            candidate.dustCalibration.offsetUgM3, error)) {
      sendError(400, error);
      return;
    }
    JsonVariantConst nestedCalibrated = calibrationObject["calibrated"];
    if (!nestedCalibrated.isNull()) {
      if (!nestedCalibrated.is<bool>()) {
        sendError(400, "dustCalibration.calibrated must be boolean");
        return;
      }
      candidate.dustCalibration.calibrated = nestedCalibrated.as<bool>();
    }
  }

  JsonVariantConst calibrated = object["dustCalibrated"];
  if (!calibrated.isNull()) {
    if (!calibrated.is<bool>()) {
      sendError(400, "dustCalibrated must be boolean");
      return;
    }
    candidate.dustCalibration.calibrated = calibrated.as<bool>();
  }

  if (!validateRuntimeConfig(candidate, error)) {
    sendError(400, error);
    return;
  }

  runtimeConfig = candidate;
  setDustCalibration(runtimeConfig.dustCalibration);
  applyAutoLighting();
  if (!saveRuntimeConfig()) {
    sendError(500, "configuration changed in RAM but could not be saved to NVS");
    return;
  }

  JsonDocument response;
  populateConfigDocument(response);
  sendDocument(200, response);
}

void handleOptions() {
  addCorsHeaders();
  server.send(204, "text/plain", "");
}

void handleNotFound() {
  if (server.method() == HTTP_OPTIONS) {
    handleOptions();
    return;
  }
  sendError(404, "endpoint not found");
}

void setupRoutes() {
  server.on("/", HTTP_GET, handleDashboard);
  server.on("/index.html", HTTP_GET, handleDashboard);
  server.on("/api/health", HTTP_GET, handleHealth);
  server.on("/api/status", HTTP_GET, []() { sendStatus(); });
  server.on("/api/mode", HTTP_POST, handleMode);
  server.on("/api/light", HTTP_POST, handleLight);
  server.on("/api/config", HTTP_GET, handleGetConfig);
  server.on("/api/config", HTTP_PATCH, handlePatchConfig);

  // Legacy gateway aliases retained for older clients and SETUP_GUIDE examples.
  server.on("/api/light/on", HTTP_POST, handleLightOnAlias);
  server.on("/api/light/off", HTTP_POST, handleLightOffAlias);
  server.on("/api/mode/auto", HTTP_POST, handleModeAutoAlias);
  server.on("/api/mode/manual", HTTP_POST, handleModeManualAlias);
  server.onNotFound(handleNotFound);
}

void startFallbackAp() {
  if (fallbackApActive) {
    return;
  }
  if (isConfiguredWifi()) {
    WiFi.mode(WIFI_AP_STA);
  } else {
    WiFi.mode(WIFI_AP);
  }
  fallbackApActive = WiFi.softAP(FALLBACK_AP_SSID);
  Serial.print("Fallback dashboard: http://");
  Serial.println(WiFi.softAPIP());
}

void configureNtpIfNeeded() {
  if (!ntpConfigured && WiFi.status() == WL_CONNECTED) {
    configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);
    ntpConfigured = true;
  }
}

void connectWifi() {
  if (!isConfiguredWifi()) {
    Serial.println("WiFi credentials are placeholders; starting fallback AP.");
    startFallbackAp();
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const uint32_t startedMs = millis();
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED &&
         static_cast<uint32_t>(millis() - startedMs) <
             WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Dashboard: http://");
    Serial.println(WiFi.localIP());
    configureNtpIfNeeded();
  } else {
    Serial.println("Station connection timed out.");
    startFallbackAp();
  }
}

void reconnectWifiIfNeeded() {
  if (!isConfiguredWifi() || WiFi.status() == WL_CONNECTED) {
    configureNtpIfNeeded();
    return;
  }
  const uint32_t nowMs = millis();
  if (static_cast<uint32_t>(nowMs - lastWifiRetryMs) <
      WIFI_RETRY_INTERVAL_MS) {
    return;
  }
  lastWifiRetryMs = nowMs;
  Serial.println("WiFi disconnected; retrying station connection.");
  if (fallbackApActive) {
    WiFi.mode(WIFI_AP_STA);
  } else {
    WiFi.mode(WIFI_STA);
  }
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

String fixedLcdText(const String& text) {
  if (text.length() <= LCD_COLUMNS) {
    return text;
  }
  return text.substring(0, LCD_COLUMNS);
}

void renderLcdLines(const String& line1, const String& line2) {
  if (!lcdOnline || !lcd.isOnline()) {
    lcdOnline = false;
    return;
  }
  const String first = fixedLcdText(line1);
  const String second = fixedLcdText(line2);
  if (first != lastLcdLine1) {
    lcd.setLine(0, first);
    lastLcdLine1 = first;
  }
  if (second != lastLcdLine2) {
    lcd.setLine(1, second);
    lastLcdLine2 = second;
  }
}

void updateLcd(bool force = false) {
  if (!lcdOnline) {
    return;
  }
  const uint32_t nowMs = millis();
  if (!force &&
      static_cast<uint32_t>(nowMs - lastLcdRefreshMs) < LCD_REFRESH_MS) {
    return;
  }
  lastLcdRefreshMs = nowMs;

  if (force ||
      static_cast<uint32_t>(nowMs - lastLcdPageChangeMs) >= LCD_PAGE_MS) {
    if (!force) {
      lcdPage = (lcdPage + 1) % 3;
    }
    lastLcdPageChangeMs = nowMs;
  }

  if (lcdPage == 0) {
    renderLcdLines("T:" + String(temperatureC, 1) + "C L:" + String(lightLevel),
                   "T:" + String(temperatureSensor.online ? "OK" : "ERR") +
                       " L:" + String(lightSensor.online ? "OK" : "ERR"));
    return;
  }
  if (lcdPage == 1) {
    if (!dustSensorState.sensorOnline) {
      renderLcdLines("DUST ERROR", "CHECK SENSOR");
    } else {
      renderLcdLines("D:" + String(dustSensorState.density, 0) + " ug/m3",
                     dustLevel());
    }
    return;
  }
  renderLcdLines("MODE:" + mode,
                 "LED:" + String(lightStatus ? "ON" : "OFF") + " REAL");
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println();
  Serial.println("Smart Environment ESP32 firmware starting");

  loadRuntimeConfig();

  pinMode(LIGHT_LED_PIN, OUTPUT);
  writeLightLed(false);
  analogReadResolution(12);
  analogSetPinAttenuation(LM35_PIN, ADC_6db);
  analogSetPinAttenuation(LDR_PIN, ADC_11db);
  analogSetPinAttenuation(DUST_ANALOG_PIN, ADC_11db);
  initializeDustSensor();

  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
  lcdOnline =
      lcd.begin(Wire, LCD_I2C_ADDRESS, LCD_COLUMNS, LCD_ROWS);
  if (!lcdOnline) {
    Serial.println("LCD1602 not detected at configured I2C address.");
  }

  readEnvironmentSensors(true);
  updateDustSensor();
  updateLcd(true);
  connectWifi();
  setupRoutes();
  server.begin();

  Serial.println("HTTP server started on port 80.");
  Serial.println("GP2Y Vo divider: 10k top / 12k bottom; GPIO32 is ADC1.");
  Serial.println("Dust values are estimates until reference calibration.");
}

void loop() {
  server.handleClient();
  updateDustSensor();
  readEnvironmentSensors();
  updateLcd();
  reconnectWifiIfNeeded();
  delay(1);
}
