#pragma once

#include <Arduino.h>

namespace ProjectConfig {

// ESP32 ESP-WROOM-32S pin assignment. All analog sensors use ADC1 so that
// Wi-Fi and ADC sampling can operate at the same time.
constexpr uint8_t LM35_PIN = 34;          // ADC1_CH6, input only
constexpr uint8_t LDR_PIN = 35;           // ADC1_CH7, input only
constexpr uint8_t DUST_ANALOG_PIN = 32;   // ADC1_CH4
constexpr uint8_t DUST_LED_PIN = 25;      // Open-drain, active LOW
constexpr uint8_t LIGHT_LED_PIN = 2;
constexpr uint8_t PIR_PIN = 27;           // HC-SR501 digital output
constexpr uint8_t LCD_SDA_PIN = 21;
constexpr uint8_t LCD_SCL_PIN = 22;

constexpr bool LIGHT_LED_ACTIVE_HIGH = true;

// Common PCF8574 LCD1602 backpack address. Change to 0x3F if an I2C scan of
// the actual backpack reports that address.
constexpr uint8_t LCD_I2C_ADDRESS = 0x27;
constexpr uint8_t LCD_COLUMNS = 16;
constexpr uint8_t LCD_ROWS = 2;
constexpr uint32_t LCD_REFRESH_MS = 250;
constexpr uint32_t LCD_PAGE_MS = 3000;

// GP2Y1014AU0F pulse cycle. Verify these values against the exact sensor
// datasheet/revision used by the project before hardware validation.
constexpr uint32_t DUST_CYCLE_US = 10000;
constexpr uint32_t DUST_SAMPLE_DELAY_US = 280;
constexpr uint32_t DUST_LED_PULSE_US = 320;
constexpr uint8_t DUST_MEDIAN_SAMPLES = 9;
constexpr uint8_t DUST_MIN_VALID_SAMPLES = 7;
constexpr uint32_t DUST_STALE_TIMEOUT_MS = 3000;
constexpr uint8_t DUST_INVALID_BATCH_LIMIT = 2;

// Divider wiring: GP2Y Vo -- 10 kOhm -- GPIO32 -- 12 kOhm -- GND.
constexpr float DUST_DIVIDER_TOP_OHM = 10000.0f;
constexpr float DUST_DIVIDER_BOTTOM_OHM = 12000.0f;
constexpr float DUST_DIVIDER_RATIO =
    DUST_DIVIDER_BOTTOM_OHM / (DUST_DIVIDER_TOP_OHM + DUST_DIVIDER_BOTTOM_OHM);

constexpr uint16_t ADC_MAX_RAW = 4095;
// ESP32 ADC is not a precision instrument. This value and the divider ratio
// must be checked with a multimeter and adjusted during calibration.
constexpr float ADC_FULL_SCALE_VOLTAGE = 3.30f;
constexpr uint16_t DUST_ADC_RAIL_LOW = 4;
constexpr uint16_t DUST_ADC_RAIL_HIGH = 4091;
constexpr float DUST_SENSOR_MAX_VALID_VOLTAGE = 5.10f;
constexpr float DUST_MAX_VALID_DENSITY_UG_M3 = 10000.0f;

// GP2Y defaults are deliberately marked uncalibrated. The sensitivity value
// is a project starting point only; verify the transfer curve in the exact
// GP2Y1014AU0F datasheet and calibrate against a reference instrument.
constexpr float DEFAULT_DUST_ZERO_VOLTAGE = 0.90f;
// 0.005 V per (ug/m3) is equivalent to 5 V per (mg/m3). Keeping the API in
// V/(ug/m3) matches the backend configuration contract.
constexpr float DEFAULT_DUST_SENSITIVITY_V_PER_UG_M3 = 0.005f;
constexpr float DEFAULT_DUST_CALIBRATION_FACTOR = 1.0f;
constexpr float DEFAULT_DUST_CALIBRATION_OFFSET_UG_M3 = 0.0f;
constexpr bool DEFAULT_DUST_CALIBRATED = false;

constexpr float DEFAULT_TEMPERATURE_THRESHOLD_C = 35.0f;
constexpr int DEFAULT_DARK_THRESHOLD = 200;
constexpr int DEFAULT_BRIGHT_THRESHOLD = 260;
// Internal project warning bands, not official AQI thresholds.
constexpr float DEFAULT_DUST_MODERATE_UG_M3 = 50.0f;
constexpr float DEFAULT_DUST_HIGH_UG_M3 = 150.0f;
constexpr float DEFAULT_DUST_DANGEROUS_UG_M3 = 300.0f;

constexpr uint32_t ENVIRONMENT_SENSOR_INTERVAL_MS = 1000;
constexpr uint8_t ENVIRONMENT_AVERAGE_SAMPLES = 8;
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
