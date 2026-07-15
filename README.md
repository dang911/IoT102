# IoT102 - Smart Environment Monitoring & Lighting Control

Du an gom dashboard web va backend hop the trong firmware ESP32. Sau khi nap code, ESP32 vua doc cam bien LM35/LDR, vua dieu khien LED, vua phuc vu giao dien web tai dia chi IP cua board.

## Huong chay chinh: ESP32 hop the frontend + backend

ESP32 khong phu hop de chay Java truc tiep. Voi bo ESP32 trong mon IoT, backend phu hop nhat la firmware Arduino cho ESP32 vi no can truy cap chan GPIO, ADC, WiFi va dieu khien thiet bi truc tiep.

Firmware nam tai:

```text
firmware/SmartEnvironmentBackend/SmartEnvironmentBackend.ino
```

Cap nhat cac gia tri sau truoc khi nap:

- `WIFI_SSID`
- `WIFI_PASSWORD`
- `LM35_PIN`, mac dinh GPIO34
- `LDR_PIN`, mac dinh GPIO35
- `LED_PIN`, mac dinh GPIO2
- `LED_ACTIVE_HIGH`, doi thanh `false` neu mach LED cua ban kich muc LOW

Sau khi nap firmware, mo Serial Monitor de xem IP:

```text
ESP32 API: http://192.168.1.100
```

Mo dia chi do tren trinh duyet:

```text
http://192.168.1.100
```

Dashboard va API da nam chung trong ESP32, khong can chay them server rieng va khong can mo file `frontend/index.html` thu cong.

## Noi day goi y

| Thiet bi | Chan ESP32 mac dinh | Ghi chu |
| --- | --- | --- |
| LM35 OUT | GPIO34 | Chan ADC input-only, VCC 3.3V/5V tuy module, GND chung |
| LDR divider | GPIO35 | Tao cau phan ap voi dien tro, dau ra vao ADC |
| LED | GPIO2 | Qua dien tro han dong 220 ohm - 330 ohm |
| LCD1602 I2C | SDA/SCL | Neu dung LCD, bat `USE_LCD 1` va cai thu vien `LiquidCrystal_I2C` |

## API tren ESP32

- `GET /`: mo dashboard web.
- `GET /api/health`: kiem tra ESP32 con online, IP, RSSI, uptime.
- `GET /api/status`: lay nhiet do, anh sang, trang thai den, mode, canh bao.
- `POST /api/mode`: doi mode, body mau `{"mode":"AUTO"}` hoac `{"mode":"MANUAL"}`.
- `POST /api/light`: bat/tat den, body mau `{"status":"ON"}` hoac `{"status":"OFF"}`. Lenh nay chuyen he thong sang `MANUAL`.

Vi du test nhanh bang PowerShell:

```powershell
Invoke-RestMethod http://192.168.1.100/api/status
Invoke-RestMethod http://192.168.1.100/api/mode -Method Post -ContentType 'application/json' -Body '{"mode":"AUTO"}'
Invoke-RestMethod http://192.168.1.100/api/light -Method Post -ContentType 'application/json' -Body '{"status":"ON"}'
```

## Ban demo tren may tinh

Thu muc `frontend/` va `backend/` van duoc giu lai de demo khi chua co board ESP32. Ban nay khong thay the firmware tren thiet bi.

Chay demo local:

```powershell
node backend/server.js
```

Mo:

```text
http://localhost:3000
```

Kiem thu:

```powershell
node --test backend/tests/*.test.js
```
