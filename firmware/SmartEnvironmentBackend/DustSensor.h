#pragma once

#include <Arduino.h>

struct DustCalibration {
  float zeroVoltage;
  float sensitivityVoltsPerUgM3;
  float factor;
  float offsetUgM3;
  bool calibrated;
};

struct DustRawReading {
  uint16_t rawAdc;
  float adcVoltage;
  float sensorVoltage;
  uint32_t sampledAtUs;
  bool timingValid;
};

struct DustSensorState {
  uint16_t rawAdc;
  float adcVoltage;
  float voltage;
  float density;
  bool sensorOnline;
  bool abnormal;
  bool saturated;
  bool calibrated;
  uint32_t lastUpdateMs;
  uint32_t lastAttemptMs;
  uint32_t validReadings;
  uint32_t invalidReadings;
};

extern DustSensorState dustSensorState;

void initializeDustSensor();
DustRawReading readDustVoltage();
float calculateDustDensity(float sensorVoltage);
bool validateDustReading(const DustRawReading& reading);
void updateDustSensor();
void setDustCalibration(const DustCalibration& calibration);
const DustCalibration& getDustCalibration();
