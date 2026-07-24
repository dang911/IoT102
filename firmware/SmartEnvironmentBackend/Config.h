#pragma once

#include <Arduino.h>

namespace ProjectConfig {

// ESP32 ESP-WROOM-32S pin assignment. All analog sensors use ADC1 so that
// Wi-Fi and ADC sampling can operate at the same time.
constexpr uint8_t LM35_PIN = 34;          // ADC1_CH6, input only
constexpr uint8_t LDR_PIN = 35;           // ADC1_CH7, input only
constexpr uint8_t LIGHT_LED_PIN = 2;
// TMB12A05 active electromagnetic buzzer (5 V, up to about 30 mA).
// GPIO26 drives an external NPN/MOSFET; never power the buzzer from the GPIO.
constexpr uint8_t BUZZER_PIN = 26;
constexpr uint8_t LCD_SDA_PIN = 21;
constexpr uint8_t LCD_SCL_PIN = 22;

constexpr bool LIGHT_LED_ACTIVE_HIGH = true;
constexpr bool BUZZER_ACTIVE_HIGH = true;
constexpr bool OVERHEAT_BUZZER_ENABLED = true;
constexpr uint32_t BUZZER_TEMPERATURE_TOGGLE_MS = 500;

// Common PCF8574 LCD1602 backpack address. Change to 0x3F if an I2C scan of
// the actual backpack reports that address.
constexpr uint8_t LCD_I2C_ADDRESS = 0x27;
constexpr uint8_t LCD_COLUMNS = 16;
constexpr uint8_t LCD_ROWS = 2;
constexpr uint32_t LCD_REFRESH_MS = 250;
constexpr uint32_t LCD_PAGE_MS = 3000;

constexpr uint16_t ADC_MAX_RAW = 4095;
constexpr float ADC_FULL_SCALE_VOLTAGE = 3.30f;

// LM35 outputs 10 mV per degree Celsius. Compare the reading with a trusted
// thermometer, then set this offset to: reference - ESP32 reading.
// Example: ESP32 reads 32 C while reference is 30 C => offset = -2.0 C.
constexpr float LM35_TEMPERATURE_OFFSET_C = -5.0f;

constexpr float DEFAULT_TEMPERATURE_THRESHOLD_C = 35.0f;
constexpr int DEFAULT_DARK_THRESHOLD = 50;
constexpr int DEFAULT_BRIGHT_THRESHOLD = 150;

// Keep light changes responsive while leaving enough time for ADC averaging
// and the synchronous HTTP server to run smoothly.
constexpr uint32_t ENVIRONMENT_SENSOR_INTERVAL_MS = 250;
constexpr uint8_t ENVIRONMENT_AVERAGE_SAMPLES = 8;
constexpr uint32_t SERIAL_MONITOR_INTERVAL_MS = 1000;
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 10000;

// Replace these two values for deployment. If they remain placeholders, the
// firmware starts a local fallback AP so the dashboard is still reachable.
constexpr const char* WIFI_SSID = "YOUR_WIFI_NAME";
constexpr const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
constexpr const char* FALLBACK_AP_SSID = "SmartEnvironment-Setup";

constexpr const char* NTP_SERVER_1 = "pool.ntp.org";
constexpr const char* NTP_SERVER_2 = "time.nist.gov";

}  // namespace ProjectConfig
