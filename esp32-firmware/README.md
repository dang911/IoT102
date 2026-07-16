# ESP32 IoT Gateway Firmware

> **LEGACY:** Thư mục này mô tả kiến trúc Arduino UNO → ESP32 gateway và chỉ
> được giữ để tham khảo/tương thích. Firmware chính của dự án là
> `firmware/SmartEnvironmentBackend`, nơi ESP32 đọc cảm biến trực tiếp.

## 🔧 Cài đặt & Hướng dẫn Upload

### 1. Cài Arduino IDE
- Download: https://www.arduino.cc/en/software

### 2. Thêm ESP32 Board Support
1. File > Preferences
2. Paste URL: `https://dl.espressif.com/dl/package_esp32_index.json` vào "Additional Board Manager URLs"
3. Tools > Board > Boards Manager
4. Tìm "esp32" → Install

### 3. Chọn Board & Port
```
Tools > Board > ESP32 > ESP32 Dev Module
Tools > Port > COM3 (hoặc port của bạn)
```

### 4. Cài Required Libraries
Sketch > Include Library > Manage Libraries

Tìm & Install:
- **WiFiManager** (by tzapu) - v0.16.0+
- **ArduinoJson** (by Benoit Blanchon) - v6.x

### 5. Upload Code
- Mở file: `main.ino`
- Sketch > Upload (hoặc Ctrl+U)
- Mở Serial Monitor (115200 baud) để xem logs

---

## 📡 WiFi Setup (Lần Đầu)

Sau lần đầu upload:

1. **ESP32 sẽ mở WiFi Access Point:**
   - SSID: `SmartHome-Setup`
   - Password: (không có)

2. **Connect từ laptop/phone đến AP này**

3. **Mở browser, truy cập:** `192.168.4.1`

4. **Chọn WiFi nhà bạn, nhập password**

5. **ESP32 tự động restart & kết nối**

---

## 🔌 Kết nối Hardware

### ESP32 ↔ Arduino UNO (Serial)

```
Arduino TX (Pin 1)  ──→  ESP32 RX (GPIO 16)
Arduino RX (Pin 0)  ←──  ESP32 TX (GPIO 17)
GND                 ──→  GND
```

> **Lưu ý:** Nếu Arduino là 5V, cần voltage divider cho RX line ESP32 (3.3V tolerant)

### Arduino → Cảm biến

```
LM35 (Temperature)  → A0
LDR (Light)         → A1
LED Control         → D7
```

---

## 📡 Data Format (Arduino → ESP32)

Arduino gửi chuỗi **mỗi 2 giây:**

```
TEMP:29.4,LIGHT:420,LED:ON,MODE:AUTO\n
```

**Giải thích:**
- `TEMP:` - Nhiệt độ (°C)
- `LIGHT:` - Ánh sáng (Lux, 0-1023)
- `LED:` - Trạng thái LED (ON/OFF)
- `MODE:` - Chế độ (AUTO/MANUAL)

---

## 🌐 API Endpoints

### GET /api/status
Lấy dữ liệu cảm biến hiện tại

**Response:**
```json
{
  "temperature": 29.4,
  "lightLevel": 420,
  "lightStatus": true,
  "mode": "AUTO",
  "temperatureStatus": "NORMAL",
  "lightEnvironment": "BRIGHT",
  "timestamp": 123456
}
```

### POST /api/light/on
Bật đèn LED

### POST /api/light/off
Tắt đèn LED

### POST /api/mode/auto
Chế độ tự động

### POST /api/mode/manual
Chế độ thủ công

---

## 🐛 Debug

**Serial Monitor (115200 baud):**
```
Arduino Data: TEMP:29.4,LIGHT:420,LED:ON,MODE:AUTO
Command to Arduino: LED:ON
```

---

## 📝 Arduino Code (Mẫu)

```cpp
void setup() {
  Serial.begin(115200); // Giao tiếp với ESP32
  pinMode(A0, INPUT);   // LM35
  pinMode(A1, INPUT);   // LDR
  pinMode(7, OUTPUT);   // LED
}

void loop() {
  float temp = readLM35();      // Đọc LM35
  int light = analogRead(A1);   // Đọc LDR
  bool led = digitalRead(7);    // Trạng thái LED

  // Gửi dữ liệu về ESP32
  Serial.print("TEMP:");
  Serial.print(temp);
  Serial.print(",LIGHT:");
  Serial.print(light);
  Serial.print(",LED:");
  Serial.print(led ? "ON" : "OFF");
  Serial.println(",MODE:AUTO"); // Hoặc MANUAL

  delay(2000); // Gửi mỗi 2 giây
}

float readLM35() {
  int raw = analogRead(A0);
  // LM35: 10mV/°C, Arduino ADC 5V = 1023
  return (raw * 5.0 / 1023.0) * 100.0;
}
```

---

## 🔄 Cập nhật WiFi Settings

Để reset WiFi settings & setup lại:

1. Mở `main.ino`
2. Tìm dòng: `// wifiManager.resetSettings();`
3. Bỏ comment: `wifiManager.resetSettings();`
4. Upload
5. Comment lại & upload tiếp

---

## 📱 Frontend kết nối

Frontend sẽ tự động tìm ESP32 tại IP local.

**URL API base:** `http://192.168.1.100` (hoặc IP của ESP32)

---

## ❓ Troubleshoot

| Vấn đề | Giải pháp |
|--------|----------|
| ESP32 không upload | Kiểm tra COM port, cài driver CH340 |
| Serial monitor toàn rác | Kiểm tra baud rate (115200) |
| Không nhận data từ Arduino | Kiểm tra kết nối TX/RX, baud rate Arduino 115200 |
| Frontend không kết nối | Kiểm tra WiFi của ESP32, CORS enable |

---

## 📌 Next Steps

1. Upload code này vào ESP32
2. Setup WiFi qua AP
3. Code Arduino gửi data
4. Test API endpoints
5. Connect frontend
