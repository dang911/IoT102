#include "Lcd1602I2C.h"

namespace {
constexpr uint8_t LCD_RS = 0x01;
constexpr uint8_t LCD_ENABLE = 0x04;
constexpr uint8_t LCD_FUNCTION_SET = 0x20;
constexpr uint8_t LCD_4_BIT_MODE = 0x00;
constexpr uint8_t LCD_2_LINE = 0x08;
constexpr uint8_t LCD_5X8_DOTS = 0x00;
constexpr uint8_t LCD_DISPLAY_CONTROL = 0x08;
constexpr uint8_t LCD_DISPLAY_ON = 0x04;
constexpr uint8_t LCD_ENTRY_MODE_SET = 0x04;
constexpr uint8_t LCD_ENTRY_LEFT = 0x02;
constexpr uint8_t LCD_CLEAR_DISPLAY = 0x01;
constexpr uint8_t LCD_SET_DDRAM_ADDR = 0x80;
}  // namespace

bool Lcd1602I2C::begin(TwoWire& wire, uint8_t address, uint8_t columns,
                       uint8_t rows) {
  wire_ = &wire;
  address_ = address;
  columns_ = columns;
  rows_ = rows;

  wire_->beginTransmission(address_);
  online_ = wire_->endTransmission() == 0;
  if (!online_) {
    return false;
  }

  delay(50);
  writeExpander(backlightMask_);
  delay(1000);

  write4Bits(0x30);
  delayMicroseconds(4500);
  write4Bits(0x30);
  delayMicroseconds(4500);
  write4Bits(0x30);
  delayMicroseconds(150);
  write4Bits(0x20);

  command(LCD_FUNCTION_SET | LCD_4_BIT_MODE | LCD_2_LINE | LCD_5X8_DOTS);
  command(LCD_DISPLAY_CONTROL);
  command(LCD_CLEAR_DISPLAY);
  delayMicroseconds(2000);
  command(LCD_ENTRY_MODE_SET | LCD_ENTRY_LEFT);
  command(LCD_DISPLAY_CONTROL | LCD_DISPLAY_ON);
  return online_;
}

bool Lcd1602I2C::isOnline() const {
  return online_;
}

void Lcd1602I2C::setBacklight(bool enabled) {
  backlightMask_ = enabled ? 0x08 : 0x00;
  if (online_) {
    writeExpander(0);
  }
}

void Lcd1602I2C::setLine(uint8_t row, const String& text) {
  if (!online_ || row >= rows_) {
    return;
  }

  static const uint8_t rowOffsets[] = {0x00, 0x40, 0x14, 0x54};
  command(LCD_SET_DDRAM_ADDR | rowOffsets[row]);
  for (uint8_t column = 0; column < columns_; ++column) {
    const char character = column < text.length() ? text[column] : ' ';
    writeCharacter(static_cast<uint8_t>(character));
  }
}

void Lcd1602I2C::command(uint8_t value) {
  send(value, 0);
}

void Lcd1602I2C::writeCharacter(uint8_t value) {
  send(value, LCD_RS);
}

void Lcd1602I2C::send(uint8_t value, uint8_t mode) {
  write4Bits((value & 0xF0) | mode);
  write4Bits(((value << 4) & 0xF0) | mode);
}

void Lcd1602I2C::write4Bits(uint8_t value) {
  writeExpander(value);
  pulseEnable(value);
}

void Lcd1602I2C::pulseEnable(uint8_t value) {
  writeExpander(value | LCD_ENABLE);
  delayMicroseconds(1);
  writeExpander(value & ~LCD_ENABLE);
  delayMicroseconds(50);
}

bool Lcd1602I2C::writeExpander(uint8_t value) {
  if (!wire_) {
    online_ = false;
    return false;
  }
  wire_->beginTransmission(address_);
  wire_->write(value | backlightMask_);
  online_ = wire_->endTransmission() == 0;
  return online_;
}

