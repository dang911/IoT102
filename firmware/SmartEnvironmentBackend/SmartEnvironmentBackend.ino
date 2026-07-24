#include <Arduino.h>
#include <Wire.h>

#include "Config.h"
#include "Lcd1602I2C.h"

using namespace ProjectConfig;

namespace {

Lcd1602I2C lcd;
bool lcdOnline = false;
float temperatureC = 0.0f;
int lightLevel = 0;
bool lightStatus = false;
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

  temperatureC = static_cast<float>(averageMilliVolts(LM35_PIN)) / 10.0f;
  lightLevel = map(averageRawAdc(LDR_PIN), 0, ADC_MAX_RAW, 0, 1000);

  if (lightLevel < DEFAULT_DARK_THRESHOLD) {
    setLight(true);
  } else if (lightLevel >= DEFAULT_BRIGHT_THRESHOLD) {
    setLight(false);
  }
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

  readSensors(true);
  updateLcd(true);
}

void loop() {
  readSensors();
  updateLcd();
  printReadings();
  delay(10);
}
