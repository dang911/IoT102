# IoT102 Smart Home System - Complete Setup Guide

## 🏗️ Kiến trúc Hệ thống

```
┌──────────────────┐         ┌──────────────┐        ┌─────────────┐
│   Web Browser    │         │   ESP32      │        │  Arduino    │
│   (Frontend)     │◄───────►│  (Gateway)   │◄──────►│   UNO       │
│                  │  WiFi   │              │ Serial │ (Sensors)   │
└──────────────────┘         └──────────────┘        └─────────────┘
   Hiển thị dữ liệu       API + Web Server       Đọc cảm biến
   Điều khiển LED                               LM35 + LDR
```

### Thành phần:

1. **Frontend** (Web Browser)
   - Dashboard hiển thị nhiệt độ, ánh sáng
   - Nút điều khiển mode & LED
   - Cảnh báo hệ thống
   - Tự động fetch dữ liệu mỗi 2 giây

2. **ESP32 Backend**
   - Chạy Web Server trên WiFi
   - Nhận dữ liệu từ Arduino qua Serial
   - Cung cấp REST API cho frontend
   - WiFi Manager để setup dễ dàng

3. **Arduino Sensor Module**
   - Đọc LM35 (nhiệt độ)
   - Đọc LDR (ánh sáng)
   - Điều khiển LED
   - Gửi dữ liệu về ESP32

---

## 📋 Danh sách Hardware

| Linh kiện | Chức năng | Ghép nối |
|-----------|----------|---------|
| **Arduino UNO** | Đọc cảm biến | Serial RX/TX → ESP32 |
| **ESP32 Dev Board** | Web Server + Gateway | Nhận dữ liệu Arduino + WiFi |
| **LM35** | Cảm biến nhiệt độ | A0 (Arduino) |
| **LDR** | Cảm biến ánh sáng | A1 (Arduino) |
| **LED** | Điều khiển ánh sáng | Pin 7 (Arduino) |
| **Resistors** | Mạch chia áp | Tuỳ chỉnh LDR, Voltage divider RX |

---

## 🚀 Bước 1: Setup Arduino UNO

### 1.1 Cài Arduino IDE
- Download: https://www.arduino.cc/en/software

### 1.2 Kết nối Hardware

```
LM35 (Temperature Sensor)
├─ +5V → Arduino +5V
├─ GND → Arduino GND
└─ OUT → Arduino A0

LDR (Light Sensor) + 10kΩ Resistor (Pull-down)
├─ +5V → LDR
├─ LDR → 10kΩ → GND
└─ (LDR GND node) → Arduino A1

LED Control
├─ +5V → LED Anode (qua current limiting resistor 220Ω)
├─ LED Cathode → Arduino Pin 7
└─ Arduino GND → GND

Serial to ESP32
├─ Arduino TX (Pin 1) → ESP32 RX (GPIO 16)
├─ Arduino RX (Pin 0) → ESP32 TX (GPIO 17) + Voltage Divider
└─ Arduino GND → ESP32 GND
```

> **Lưu ý Voltage Divider:** ESP32 RX là 3.3V logic, Arduino TX là 5V. Cần chia áp:
> ```
> Arduino TX ──[1kΩ]──┬──[2kΩ]──GND
>                     │
>                    ESP32 RX
> ```

### 1.3 Upload Code Arduino

1. Mở Arduino IDE
2. File > Open > `arduino-sensors/sensor_module.ino`
3. Tools > Board > Arduino UNO
4. Tools > Port > COM3 (or your port)
5. Upload (Ctrl+U)
6. Serial Monitor (115200 baud) để xem output

**Expected Output:**
```
Arduino UNO Sensor Module Started
TEMP:25.4,LIGHT:350,LED:ON,MODE:AUTO
TEMP:25.5,LIGHT:352,LED:ON,MODE:AUTO
```

---

## 🚀 Bước 2: Setup ESP32

### 2.1 Cài Arduino IDE ESP32 Support

1. File > Preferences
2. Thêm Board Manager URL:
   ```
   https://dl.espressif.com/dl/package_esp32_index.json
   ```
3. Tools > Board > Boards Manager
4. Tìm "esp32" → Install

### 2.2 Cài Libraries

Sketch > Include Library > Manage Libraries

Tìm & Install:
- **WiFiManager** (by tzapu) - v0.16.0+
- **ArduinoJson** (by Benoit Blanchon) - v6.x

### 2.3 Upload Code ESP32

1. Mở: `esp32-firmware/main.ino`
2. Tools > Board > ESP32 > **ESP32 Dev Module**
3. Tools > Port > COM4 (or your port)
4. Upload
5. Serial Monitor (115200 baud)

**Expected Output:**
```
ESP32 IoT Gateway Starting...
WiFi Connected!
IP Address: 192.168.1.100
SSID: Your-WiFi-SSID
Web Server started on port 80
Arduino Data: TEMP:25.4,LIGHT:350,LED:ON,MODE:AUTO
```

---

## 🚀 Bước 3: WiFi Setup (Lần Đầu)

**Sau lần đầu upload ESP32:**

1. **Tìm WiFi Access Point:** `SmartHome-Setup`
2. **Connect từ laptop/phone**
3. **Mở browser:** `192.168.4.1`
4. **Chọn WiFi nhà:** Chọn SSID, nhập password
5. **ESP32 tự động kết nối và restart**

---

## 🚀 Bước 4: Test API

### 4.1 Lấy dữ liệu cảm biến

```bash
curl http://192.168.1.100/api/status
```

**Response:**
```json
{
  "temperature": 25.4,
  "lightLevel": 350,
  "lightStatus": true,
  "mode": "AUTO",
  "temperatureStatus": "NORMAL",
  "lightEnvironment": "BRIGHT",
  "timestamp": 12345
}
```

### 4.2 Bật LED

```bash
curl -X POST http://192.168.1.100/api/light \
  -H "Content-Type: application/json" \
  -d '{"status":"ON"}'
```

### 4.3 Tắt LED

```bash
curl -X POST http://192.168.1.100/api/light \
  -H "Content-Type: application/json" \
  -d '{"status":"OFF"}'
```

### 4.4 Chế độ AUTO

```bash
curl -X POST http://192.168.1.100/api/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"AUTO"}'
```

### 4.5 Chế độ MANUAL

```bash
curl -X POST http://192.168.1.100/api/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"MANUAL"}'
```

---

## 🚀 Bước 5: Frontend Web

### 5.1 Chỉnh sửa IP (nếu cần)

**File:** `frontend/js/api.js`

Dòng 1:
```javascript
const API = "http://192.168.1.100";  // Đổi IP nếu khác
```

### 5.2 Chạy Frontend

**Cách 1: File local**
- Mở `frontend/index.html` trực tiếp trong browser

**Cách 2: Web Server (tránh CORS issue)**
```bash
# Sử dụng Python
python -m http.server 8000

# hoặc Node.js
npx http-server frontend

# hoặc Live Server (VS Code)
```

Truy cập: `http://localhost:8000/frontend/`

### 5.3 Test Dashboard

- Xem dữ liệu nhiệt độ, ánh sáng cập nhật
- Click nút bật/tắt đèn
- Chuyển chế độ AUTO/MANUAL
- Xem Alert Center cập nhật

---

## 🔧 Troubleshooting

### Arduino không kết nối

1. **Kiểm tra Driver:**
   - Cài CH340 driver (nếu cần)
   - Kiểm tra Device Manager

2. **Kiểm tra Baud Rate:**
   - Arduino code: `115200`
   - Serial Monitor: `115200`

3. **Kiểm tra Cổng:**
   - Tools > Port > Chọn COM port đúng

### ESP32 không upload

1. **Giữ nút BOOT + RESET** khi upload
2. **Kiểm tra Driver CH340**
3. **Thử Port khác** (COM4, COM5, ...)

### Frontend không kết nối ESP32

1. **Kiểm tra IP đúng:**
   ```bash
   ping 192.168.1.100
   ```

2. **Kiểm tra WiFi:**
   - ESP32 Serial Monitor hiển thị "WiFi Connected"
   - IP address được gán

3. **Kiểm tra CORS:**
   - Backend đã set header: `Access-Control-Allow-Origin: *`

4. **Network Policy:**
   - Nếu dùng Web Server, đảm bảo same-origin hoặc CORS hỗ trợ

### Dữ liệu cảm biến không đúng

1. **LM35 calibration:**
   ```
   Temperature (°C) = (Voltage * 100)
   Voltage = ADC_Value * (5V / 1023)
   ```

2. **LDR calibration:**
   - Map từ 0-1023 → 0-1000 Lux (tuỳ LDR)
   - Điều chỉnh trong `sensor_module.ino` dòng `lightLevel = map(...)`

---

## 📊 Data Flow

```
1. Arduino UNO
   ├─ Đọc LM35 & LDR
   ├─ Gửi: "TEMP:25.4,LIGHT:350,LED:ON,MODE:AUTO\n"
   └─ Mỗi 2 giây

2. ESP32
   ├─ Nhận Serial từ Arduino
   ├─ Parse JSON: { temperature, lightLevel, lightStatus, mode, ... }
   ├─ Lưu vào memory
   └─ Frontend gọi /api/status → trả JSON

3. Frontend
   ├─ Fetch /api/status mỗi 2 giây
   ├─ Cập nhật UI
   ├─ User click button
   ├─ POST /api/light hoặc /api/mode
   └─ ESP32 gửi lệnh về Arduino qua Serial

4. Arduino
   ├─ Nhận lệnh: "LED:ON" hoặc "MODE:AUTO"
   ├─ Thực hiện: digitalWrite(PIN, HIGH/LOW)
   └─ Gửi dữ liệu cập nhật về ESP32
```

---

## 📝 API Reference

### GET /api/status
**Lấy dữ liệu cảm biến hiện tại**

**Response (200 OK):**
```json
{
  "temperature": 29.4,
  "lightLevel": 420,
  "lightStatus": true,
  "mode": "AUTO",
  "temperatureStatus": "NORMAL",
  "lightEnvironment": "BRIGHT",
  "timestamp": 123456789
}
```

### POST /api/light
**Điều khiển LED**

**Body:**
```json
{"status": "ON"}  // hoặc "OFF"
```

**Response:**
```json
{"status": "Light updated"}
```

### POST /api/mode
**Đặt chế độ**

**Body:**
```json
{"mode": "AUTO"}  // hoặc "MANUAL"
```

**Response:**
```json
{"status": "Mode updated"}
```

---

## 📌 Checklist Hoàn thành

- [ ] Arduino UNO upload thành công
- [ ] ESP32 upload thành công
- [ ] ESP32 kết nối WiFi (Serial Monitor hiển thị IP)
- [ ] Arduino gửi dữ liệu (Serial Monitor hiển thị dữ liệu)
- [ ] curl test /api/status thành công
- [ ] curl test /api/light thành công
- [ ] curl test /api/mode thành công
- [ ] Frontend load index.html
- [ ] Frontend hiển thị dữ liệu từ /api/status
- [ ] Click nút LED trên dashboard → LED bật/tắt
- [ ] Chuyển mode → mode đổi

---

## 🔗 File tham khảo

```
IoT102/
├── frontend/
│   ├── index.html          # Giao diện chính
│   ├── css/                # Styling
│   └── js/
│       ├── api.js          # API client
│       ├── dashboard.js    # Dashboard logic
│       └── app.js          # Main app
│
├── esp32-firmware/
│   ├── main.ino            # ESP32 firmware
│   └── README.md           # Setup guide
│
└── arduino-sensors/
    └── sensor_module.ino   # Arduino UNO code
```

---

## 💡 Tips

- **Debug**: Mở Serial Monitor trên Arduino & ESP32 cùng lúc để xem giao tiếp
- **WiFi Scan**: Sửa lần đầu setup bằng: `wifiManager.resetSettings();`
- **API Test**: Dùng Postman hoặc curl để test
- **Mobile Access**: Frontend cũng chạy được trên phone (cùng WiFi)

---

## 🐛 Liên hệ & Support

Nếu gặp vấn đề:
1. Kiểm tra Serial Monitor (Arduino & ESP32)
2. Xem TROUBLESHOOTING section
3. Kiểm tra GitHub Issues
4. Test API bằng curl trước khi test frontend

---

**Version:** 1.0  
**Last Updated:** 2026-06-19  
**Status:** ✅ Ready to Deploy
