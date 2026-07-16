#pragma once

#include <Arduino.h>
#include <Wire.h>

// Minimal HD44780-over-PCF8574 driver for the common LCD1602 backpack wiring:
// P0=RS, P1=RW, P2=EN, P3=backlight, P4..P7=D4..D7.
// It keeps the firmware self-contained and avoids LiquidCrystal_I2C API/version
// differences. Some backpacks use another bit mapping and must be verified.
class Lcd1602I2C {
 public:
  bool begin(TwoWire& wire, uint8_t address, uint8_t columns, uint8_t rows);
  bool isOnline() const;
  void setBacklight(bool enabled);
  void setLine(uint8_t row, const String& text);

 private:
  void command(uint8_t value);
  void writeCharacter(uint8_t value);
  void send(uint8_t value, uint8_t mode);
  void write4Bits(uint8_t value);
  void pulseEnable(uint8_t value);
  bool writeExpander(uint8_t value);

  TwoWire* wire_ = nullptr;
  uint8_t address_ = 0;
  uint8_t columns_ = 16;
  uint8_t rows_ = 2;
  uint8_t backlightMask_ = 0x08;
  bool online_ = false;
};

