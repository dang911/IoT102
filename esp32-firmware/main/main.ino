#include <WiFi.h>
#include <WebServer.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>

// Serial Communication
#define SERIAL_BAUD_RATE 115200
#define SERIAL_RX 16  // ESP32 RX pin (từ Arduino TX)
#define SERIAL_TX 17  // ESP32 TX pin (đến Arduino RX)

// Web Server
WebServer server(80);

// Current Sensor Data
struct SensorData {
  float temperature = 25.0;
  int lightLevel = 400;
  bool lightStatus = true;
  String mode = "AUTO";
  String temperatureStatus = "NORMAL";
  String lightEnvironment = "BRIGHT";
  unsigned long lastUpdate = 0;
} sensorData;

// Serial Buffer
String serialBuffer = "";

// ==================== SETUP ====================
void setup() {
  Serial.begin(SERIAL_BAUD_RATE); // Debug serial
  Serial1.begin(SERIAL_BAUD_RATE, SERIAL_8N1, SERIAL_RX, SERIAL_TX); // Arduino serial

  delay(100);
  Serial.println("\n\nESP32 IoT Gateway Starting...");

  // ===== WiFi Manager Setup =====
  WiFiManager wifiManager;

  // Reset WiFi settings (uncomment để reset, sau đó comment lại)
  // wifiManager.resetSettings();

  // Auto connect với SSID & password đã lưu, hoặc mở portal
  if (!wifiManager.autoConnect("SmartHome-Setup")) {
    Serial.println("Failed to connect WiFi");
    delay(3000);
    ESP.restart();
  }

  Serial.println("\nWiFi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
  Serial.print("SSID: ");
  Serial.println(WiFi.SSID());

  // ===== Web Server Routes =====
  server.on("/api/status", HTTP_GET, handleGetStatus);

  // Generic POST endpoints (từ frontend)
  server.on("/api/mode", HTTP_POST, handleSetMode);
  server.on("/api/light", HTTP_POST, handleSetLight);

  // Specific endpoints (optional, cho flexibility)
  server.on("/api/light/on", HTTP_POST, handleLightOn);
  server.on("/api/light/off", HTTP_POST, handleLightOff);
  server.on("/api/mode/auto", HTTP_POST, handleModeAuto);
  server.on("/api/mode/manual", HTTP_POST, handleModeManual);

  // Health check
  server.on("/", HTTP_GET, []() {
    server.send(200, "text/plain", "ESP32 IoT Gateway Running");
  });

  server.begin();
  Serial.println("Web Server started on port 80");

  // Initial sensor data
  updateSensorData();
}

// ==================== MAIN LOOP ====================
void loop() {
  server.handleClient();

  // Read Serial dari Arduino
  while (Serial1.available()) {
    char c = Serial1.read();
    if (c == '\n') {
      parseArduinoData(serialBuffer);
      serialBuffer = "";
    } else {
      serialBuffer += c;
    }
  }

  // Timeout nếu không nhận data
  if (millis() - sensorData.lastUpdate > 5000) {
    Serial.println("No sensor data received - using defaults");
  }

  delay(10);
}

// ==================== SERIAL PARSING ====================
void parseArduinoData(String data) {
  data.trim();

  Serial.print("Arduino Data: ");
  Serial.println(data);

  // Parse format: TEMP:29.4,LIGHT:420,LED:ON,MODE:AUTO
  float temp = extractValue(data, "TEMP:");
  int light = extractIntValue(data, "LIGHT:");
  String led = extractStringValue(data, "LED:");
  String mode = extractStringValue(data, "MODE:");

  if (temp > -100) sensorData.temperature = temp;
  if (light >= 0) sensorData.lightLevel = light;
  if (led != "") sensorData.lightStatus = (led == "ON" || led == "1");
  if (mode != "") sensorData.mode = mode;

  // Update status
  updateSensorStatus();
  sensorData.lastUpdate = millis();
}

float extractValue(String data, String prefix) {
  int idx = data.indexOf(prefix);
  if (idx == -1) return -999;

  idx += prefix.length();
  int endIdx = data.indexOf(',', idx);
  if (endIdx == -1) endIdx = data.length();

  return data.substring(idx, endIdx).toFloat();
}

int extractIntValue(String data, String prefix) {
  return (int)extractValue(data, prefix);
}

String extractStringValue(String data, String prefix) {
  int idx = data.indexOf(prefix);
  if (idx == -1) return "";

  idx += prefix.length();
  int endIdx = data.indexOf(',', idx);
  if (endIdx == -1) endIdx = data.length();

  return data.substring(idx, endIdx);
}

// ==================== SENSOR STATUS UPDATE ====================
void updateSensorStatus() {
  const float TEMP_THRESHOLD = 35.0;
  const int LIGHT_THRESHOLD = 200;

  // Temperature Status
  if (sensorData.temperature > TEMP_THRESHOLD) {
    sensorData.temperatureStatus = "HIGH";
  } else if (sensorData.temperature < 10) {
    sensorData.temperatureStatus = "LOW";
  } else {
    sensorData.temperatureStatus = "NORMAL";
  }

  // Light Status
  if (sensorData.lightLevel < LIGHT_THRESHOLD) {
    sensorData.lightEnvironment = "DARK";
  } else {
    sensorData.lightEnvironment = "BRIGHT";
  }
}

void updateSensorData() {
  updateSensorStatus();
}

// ==================== API HANDLERS ====================
void handleGetStatus() {
  StaticJsonDocument<256> json;

  json["temperature"] = sensorData.temperature;
  json["lightLevel"] = sensorData.lightLevel;
  json["lightStatus"] = sensorData.lightStatus;
  json["mode"] = sensorData.mode;
  json["temperatureStatus"] = sensorData.temperatureStatus;
  json["lightEnvironment"] = sensorData.lightEnvironment;
  json["timestamp"] = millis();

  String response;
  serializeJson(json, response);

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", response);
}

// POST /api/mode - Generic endpoint từ frontend
void handleSetMode() {
  if (server.hasArg("plain")) {
    StaticJsonDocument<64> json;
    deserializeJson(json, server.arg("plain"));

    String mode = json["mode"];
    if (mode == "AUTO" || mode == "MANUAL") {
      sendCommandToArduino("MODE:" + mode);
      sensorData.mode = mode;

      server.sendHeader("Access-Control-Allow-Origin", "*");
      server.send(200, "application/json", "{\"status\":\"Mode updated\"}");
    } else {
      server.send(400, "application/json", "{\"error\":\"Invalid mode\"}");
    }
  } else {
    server.send(400, "application/json", "{\"error\":\"No JSON body\"}");
  }
}

// POST /api/light - Generic endpoint từ frontend
void handleSetLight() {
  if (server.hasArg("plain")) {
    StaticJsonDocument<64> json;
    deserializeJson(json, server.arg("plain"));

    String status = json["status"];
    if (status == "ON" || status == "OFF") {
      sendCommandToArduino("LED:" + status);
      sensorData.lightStatus = (status == "ON");

      server.sendHeader("Access-Control-Allow-Origin", "*");
      server.send(200, "application/json", "{\"status\":\"Light updated\"}");
    } else {
      server.send(400, "application/json", "{\"error\":\"Invalid status\"}");
    }
  } else {
    server.send(400, "application/json", "{\"error\":\"No JSON body\"}");
  }
}

// POST /api/light/on - Specific endpoint
void handleLightOn() {
  sendCommandToArduino("LED:ON");
  sensorData.lightStatus = true;

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", "{\"status\":\"LED turned ON\"}");
}

// POST /api/light/off - Specific endpoint
void handleLightOff() {
  sendCommandToArduino("LED:OFF");
  sensorData.lightStatus = false;

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", "{\"status\":\"LED turned OFF\"}");
}

// POST /api/mode/auto - Specific endpoint
void handleModeAuto() {
  sendCommandToArduino("MODE:AUTO");
  sensorData.mode = "AUTO";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", "{\"status\":\"Mode set to AUTO\"}");
}

// POST /api/mode/manual - Specific endpoint
void handleModeManual() {
  sendCommandToArduino("MODE:MANUAL");
  sensorData.mode = "MANUAL";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", "{\"status\":\"Mode set to MANUAL\"}");
}

// ==================== ARDUINO COMMUNICATION ====================
void sendCommandToArduino(String command) {
  Serial1.println(command);
  Serial.print("Command to Arduino: ");
  Serial.println(command);
}
