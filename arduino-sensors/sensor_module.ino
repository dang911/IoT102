/*
 * Arduino UNO - Sensor & Control Module
 *
 * Đọc cảm biến nhiệt độ (LM35) & ánh sáng (LDR)
 * Điều khiển LED
 * Gửi dữ liệu đến ESP32 qua Serial UART
 *
 * Kết nối:
 * - LM35 (Temperature)  → A0
 * - LDR  (Light)        → A1
 * - LED  (Control)      → Pin 7
 * - TX   (to ESP32 RX)  → Pin 1 (TX)
 * - RX   (to ESP32 TX)  → Pin 0 (RX) + voltage divider
 */

#define TEMP_PIN A0
#define LIGHT_PIN A1
#define LED_PIN 7

// Calibration values (tuỳ theo cảm biến thực tế)
#define TEMP_MAX 40.0
#define LIGHT_MAX 1000  // Max Lux

// Global variables
float temperature = 25.0;
int lightLevel = 400;
bool ledStatus = true;
String mode = "AUTO";

unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL = 2000; // Gửi mỗi 2 giây

void setup() {
  // Initialize Serial (đến ESP32)
  Serial.begin(115200);

  // Initialize pins
  pinMode(TEMP_PIN, INPUT);
  pinMode(LIGHT_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);

  delay(100);
  Serial.println("Arduino UNO Sensor Module Started");

  // Initial LED state
  digitalWrite(LED_PIN, ledStatus ? HIGH : LOW);
}

void loop() {
  // Read sensors
  readTemperature();
  readLightLevel();

  // Send data to ESP32 every SEND_INTERVAL
  if (millis() - lastSendTime >= SEND_INTERVAL) {
    sendDataToESP32();
    lastSendTime = millis();
  }

  // Check for commands from ESP32
  checkSerialCommand();

  // Auto mode logic (đèn tự động bật/tắt theo ánh sáng)
  if (mode == "AUTO") {
    handleAutoMode();
  }

  delay(10);
}

// ==================== SENSOR READING ====================
void readTemperature() {
  int rawValue = analogRead(TEMP_PIN);

  // LM35: 10mV per °C
  // ADC: 0-1023 for 0-5V
  temperature = (rawValue * 5.0 / 1023.0) * 100.0;

  // Smoothing (tuỳ chọn - lấy trung bình)
  // temperature = (temperature + prevTemp) / 2.0;
}

void readLightLevel() {
  int rawValue = analogRead(LIGHT_PIN);

  // Map từ 0-1023 (ADC) thành 0-1000 (Lux)
  // Tuỳ theo LDR calibration
  lightLevel = map(rawValue, 0, 1023, 0, 1000);

  // Hoặc direct raw value: lightLevel = rawValue;
}

// ==================== DATA TRANSMISSION ====================
void sendDataToESP32() {
  // Format: TEMP:29.4,LIGHT:420,LED:ON,MODE:AUTO\n

  Serial.print("TEMP:");
  Serial.print(temperature, 1);  // 1 decimal

  Serial.print(",LIGHT:");
  Serial.print(lightLevel);

  Serial.print(",LED:");
  Serial.print(ledStatus ? "ON" : "OFF");

  Serial.print(",MODE:");
  Serial.println(mode);
}

// ==================== COMMAND HANDLING ====================
void checkSerialCommand() {
  static String commandBuffer = "";

  while (Serial.available()) {
    char c = Serial.read();

    if (c == '\n' || c == '\r') {
      if (commandBuffer.length() > 0) {
        processCommand(commandBuffer);
        commandBuffer = "";
      }
    } else {
      commandBuffer += c;
    }
  }
}

void processCommand(String command) {
  command.trim();

  Serial.print("[Command] ");
  Serial.println(command);

  if (command == "LED:ON") {
    ledStatus = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println("LED turned ON");
  }
  else if (command == "LED:OFF") {
    ledStatus = false;
    digitalWrite(LED_PIN, LOW);
    Serial.println("LED turned OFF");
  }
  else if (command == "MODE:AUTO") {
    mode = "AUTO";
    Serial.println("Mode set to AUTO");
  }
  else if (command == "MODE:MANUAL") {
    mode = "MANUAL";
    Serial.println("Mode set to MANUAL");
  }
}

// ==================== AUTO MODE LOGIC ====================
void handleAutoMode() {
  // Nếu ánh sáng < 300 Lux, bật LED tự động
  if (lightLevel < 300) {
    if (!ledStatus) {
      ledStatus = true;
      digitalWrite(LED_PIN, HIGH);
      Serial.println("[AUTO] Light low, LED ON");
    }
  }
  // Nếu ánh sáng >= 600 Lux, tắt LED
  else if (lightLevel >= 600) {
    if (ledStatus) {
      ledStatus = false;
      digitalWrite(LED_PIN, LOW);
      Serial.println("[AUTO] Light high, LED OFF");
    }
  }
}

// ==================== DEBUG HELPERS ====================
void printStatus() {
  Serial.print("Temp: ");
  Serial.print(temperature);
  Serial.print("°C | Light: ");
  Serial.print(lightLevel);
  Serial.print(" Lux | LED: ");
  Serial.print(ledStatus ? "ON" : "OFF");
  Serial.print(" | Mode: ");
  Serial.println(mode);
}
