# Hướng dẫn lắp đặt Smart Environment Monitoring & Lighting Control System

Tài liệu này mô tả kiến trúc triển khai chính: **ESP32 đọc trực tiếp toàn bộ cảm biến và làm bộ điều khiển trung tâm**. Không cần Arduino UNO hoặc đường UART gateway để vận hành hệ thống.

## 1. Phạm vi và giới hạn

Hệ thống thực hiện:

- Đọc LM35, LDR và cảm biến bụi analog Sharp GP2Y1014AU0F.
- Điều khiển LED ở AUTO/MANUAL.
- Hiển thị luân phiên trên LCD1602 I2C.
- Kết nối Wi-Fi, phục vụ REST API và dashboard.
- Phát cảnh báo nhiệt độ, thiếu sáng, bụi cao, cảm biến lỗi/mất dữ liệu và phát hiện người đi vào bằng PIR.
- Dùng backend Node.js tùy chọn để lưu history, notification, forecast, reports và CSV.

Mật độ bụi là giá trị ước tính. Khi chưa hiệu chuẩn bằng thiết bị tham chiếu, chỉ dùng cho học tập và theo dõi xu hướng; không gọi là AQI và không suy diễn PM1.0/PM2.5/PM10.

## 2. Thiết bị

| STT | Thiết bị | Số lượng | Vai trò |
| ---: | --- | ---: | --- |
| 1 | ESP32 ESP-WROOM-32S | 1 | Bộ điều khiển, Wi-Fi, API, dashboard |
| 2 | LM35 | 1 | Nhiệt độ analog |
| 3 | LDR | 1 | Mức ánh sáng tương đối |
| 4 | Sharp GP2Y1014AU0F | 1 | Điện áp analog tỷ lệ với bụi |
| 5 | LED | 1 | Mô phỏng đèn chiếu sáng |
| 6 | LCD1602 + backpack I2C | 1 | Hiển thị tại thiết bị |
| 7 | PIR HC-SR501 | 1 | Phát hiện chuyển động/người đi vào khu vực giám sát |
| 8 | Còi chip TMB12A05 active 5 V | 1 | Báo quá nhiệt và phát hiện người đi vào |
| 9 | Breadboard, jumper | 1 bộ | Lắp prototype |
| 10 | Điện trở | nhiều | Hạn dòng, divider, pull-up/down |
| 11 | Tụ điện | theo mạch | 220 µF cho V-LED; 100 nF tùy chọn cho ADC/decoupling |
| 12 | USB 5 V và cáp Micro USB | 1 | Cấp nguồn/nạp firmware |
| 13 | VC830L | 1 | Kiểm tra điện áp trước khi nối ESP32 |

Level shifter I2C hai chiều và transistor/MOSFET không có trong danh sách ban đầu. Phần 5 nêu rõ khi nào cần bổ sung và cách thử prototype an toàn khi chưa có chúng.

## 3. Kiểm tra phân công chân

| Chân | Chức năng | Khả năng ESP32 | Kết luận |
| --- | --- | --- | --- |
| GPIO34 | LM35 OUT | ADC1_CH6, input-only | Hợp lệ với Wi-Fi |
| GPIO35 | LDR node | ADC1_CH7, input-only | Hợp lệ với Wi-Fi |
| GPIO32 | GP2Y Vo qua divider | ADC1_CH4, input/output | Hợp lệ với Wi-Fi |
| GPIO25 | GP2Y LED control | Digital output; ADC2 nếu dùng analog | Chỉ dùng digital nên không xung đột Wi-Fi |
| GPIO26 | Active buzzer signal | Digital output | Dùng còi module hoặc mạch transistor nếu dòng lớn |
| GPIO2 | LED chiếu sáng | Digital, strapping trên ESP32 | Giữ mặc định; tránh mạch kéo sai mức boot |
| GPIO27 | PIR HC-SR501 OUT | Digital input | Hợp lệ; tín hiệu OUT danh định khoảng 3,3 V |
| GPIO21 | I2C SDA | Digital I/O | Hợp lệ |
| GPIO22 | I2C SCL | Digital I/O | Hợp lệ |

Không dùng ADC2 để đọc cảm biến khi Wi-Fi hoạt động. GPIO32/34/35 thuộc ADC1 nên đáp ứng yêu cầu này.

## 4. Quy tắc an toàn trước khi lắp

1. Ngắt USB và nguồn 5 V khi thay dây.
2. Không đưa 5 V trực tiếp vào bất kỳ GPIO/ADC ESP32 nào.
3. Nối chung GND giữa ESP32, LM35, LDR, LCD và cả hai GND của GP2Y.
4. Kiểm tra đúng pinout của LM35 theo package đang có; không đoán chỉ dựa vào hình dáng.
5. Phân biệt GP2Y cảm biến rời sáu chân với module có sẵn R/C/driver/divider.
6. Đo nút GPIO32, SDA và SCL bằng VC830L trước khi cắm vào ESP32.
7. Tụ điện phân 220 µF phải đúng cực: cực dương về V-LED, cực âm về LED-GND.

## 5. Đấu dây

### 5.1 LM35

Với LM35 TO-92 tiêu chuẩn, khi nhìn mặt phẳng và chân hướng xuống, pin thường là `+Vs`, `Vout`, `GND` từ trái sang phải; vẫn phải đối chiếu marking/package thực tế.

```text
ESP32/nguồn 5V ───── LM35 +Vs
GPIO34        ───── LM35 Vout
GND chung     ───── LM35 GND
```

LM35 chuẩn có nguồn vận hành khuyến nghị 4–30 V và hệ số 10 mV/°C. Vì vậy cấp 5 V cho IC rời; điện áp OUT ở dải nhiệt độ phòng thấp hơn nhiều 3,3 V và có thể đưa vào GPIO34. Có thể đặt tụ 100 nF gần Vs/GND nếu dây dài hoặc nguồn nhiễu.

### 5.2 LDR

```text
3.3V ── LDR ──┬── GPIO35
               │
             10 kΩ
               │
              GND
```

Cách mắc này cho số ADC tăng khi sáng tăng. Không gọi giá trị map 0–1000 là lux chính xác trước khi hiệu chuẩn bằng lux meter.

Nếu thực tế mắc LDR và 10 kΩ đảo vị trí, cực tính sẽ đảo; cần đổi cấu hình/logic thay vì tự đảo dây khi hệ thống đang cấp nguồn.

### 5.3 LED chiếu sáng

```text
GPIO2 ── 220 Ω đến 330 Ω ──|>|── GND
                            LED
```

Firmware mặc định active-high. Nếu board có LED tích hợp active-low hoặc mạch ngoài dùng transistor đảo, đổi hằng số cấu hình thay vì bỏ điện trở hạn dòng.

### 5.4 LCD1602 I2C

```text
LCD GND ───── GND chung
LCD SDA ───── GPIO21
LCD SCL ───── GPIO22
LCD VCC ───── 3.3V khi thử trực tiếp, hoặc 5V qua level shifter I2C
```

Nhiều backpack PCF8574 có điện trở kéo SDA/SCL lên chính VCC. Nếu cấp backpack 5 V và nối trực tiếp SDA/SCL, ESP32 có thể nhận 5 V và hỏng.

Phương án theo thứ tự ưu tiên:

1. Dùng level shifter I2C hai chiều: phía LV 3,3 V nối ESP32; phía HV 5 V nối LCD.
2. Chuyển pull-up của backpack về 3,3 V nếu người thực hiện hiểu rõ PCB.
3. Cho prototype, thử cấp toàn bộ backpack ở 3,3 V, chỉnh biến trở tương phản và xác nhận LCD hoạt động.

Trước khi nối GPIO21/22, bật riêng LCD rồi đo SDA/SCL so với GND. Chỉ nối trực tiếp khi hai đường không vượt 3,3 V.

Địa chỉ mặc định firmware là `0x27`; module có thể dùng `0x3F`. Dùng I2C scanner nếu LCD không hiển thị.

### 5.5 GP2Y1014AU0F cảm biến rời

Pinout theo specification sheet:

| Pin | Tên | Kết nối |
| ---: | --- | --- |
| 1 | V-LED | 5 V qua 150 Ω |
| 2 | LED-GND | GND chung |
| 3 | LED | GPIO25 open-drain active-low |
| 4 | S-GND | GND chung |
| 5 | Vo | Divider bảo vệ rồi tới GPIO32 |
| 6 | Vcc | 5 V |

Mạch LED phát:

```text
5V ── 150 Ω ──┬── pin 1 V-LED
               │ +
             220 µF
               │ -
GND ───────────┴── pin 2 LED-GND

GPIO25 open-drain ── pin 3 LED
```

Mạch Vo:

```text
pin 5 Vo ── 10 kΩ ──┬── GPIO32
                     │
                   12 kΩ
                     │
                    GND
```

Có thể thêm 100 nF từ GPIO32 xuống GND nếu đường dây nhiễu; tụ này phải được xác nhận không làm méo thời điểm lấy mẫu xung. Bắt đầu không gắn hoặc dùng giá trị nhỏ, so sánh waveform/độ ổn định thực tế.

Tỷ lệ divider:

```text
ratio = 12 / (10 + 12) = 0.54545
Vadc  = Vo × ratio
Vo    = Vadc / ratio = Vadc × 22 / 12
```

Nguồn GP2Y được phép 5 ± 0,5 V. Trong trường hợp Vo tiến gần 5,5 V, Vadc xấp xỉ 3,0 V, nằm trong vùng đo danh định 11 dB của ESP32.

Chân LED là input open-drain và active-low. ESP32 có thể kéo trực tiếp ở chế độ `OUTPUT_OPEN_DRAIN` cho prototype; specification cho dòng LED điển hình 10 mA, cực đại 20 mA. Đối với mạch cố định, nên dùng NPN/MOSFET open-collector để giảm tải và cách ly GPIO. Nếu dùng transistor, cần đổi cực tính điều khiển tương ứng trong cấu hình.

### 5.6 Nếu GP2Y là module

Không áp dụng mù quáng sơ đồ sáu chân lên module. Kiểm tra:

- Module đã có 150 Ω và 220 µF chưa.
- Chân LED đã qua transistor/logic đảo chưa.
- AOUT có divider về 3,3 V chưa.
- VCC module yêu cầu 5 V hay 3,3 V.
- DOUT, nếu có, chỉ là comparator; dự án vẫn dùng AOUT analog và không giả lập UART.

Đo AOUT ở điều kiện sạch và nhiều bụi nhẹ trước khi nối. Nếu AOUT có thể vượt 3,3 V, vẫn phải dùng divider.

### 5.7 PIR HC-SR501 phát hiện người đi vào

```text
ESP32/nguồn 5V ───── PIR VCC
GPIO27         ───── PIR OUT
GND chung      ───── PIR GND
```

OUT của HC-SR501 thường ở mức khoảng 3,3 V khi phát hiện chuyển động nên có thể đưa vào GPIO27. Vẫn phải kiểm tra đúng nhãn chân trên module thực tế và không đưa 5 V trực tiếp vào GPIO27.

- Đặt jumper trigger ở chế độ `H` nếu muốn tín hiệu tiếp tục giữ HIGH khi vẫn còn chuyển động; chế độ `L` chỉ tạo một chu kỳ rồi chờ hết thời gian khóa.
- Biến trở `TIME` chỉnh thời gian OUT giữ HIGH. Khi thử nên vặn gần mức thấp để cảnh báo trở về bình thường nhanh hơn.
- Biến trở `SENS` chỉnh phạm vi phát hiện. Bắt đầu ở mức giữa rồi tăng dần; tránh hướng cảm biến vào cửa sổ nắng, máy lạnh, quạt hoặc nguồn nhiệt.
- Sau khi cấp nguồn, chờ PIR ổn định khoảng 30–60 giây. Trong thời gian này OUT có thể thay đổi và tạo cảnh báo thử.
- PIR chỉ phát hiện chuyển động của vật thể có bức xạ hồng ngoại; nó không nhận dạng danh tính. Cảnh báo “người lạ” trong dự án có nghĩa là có chuyển động trong vùng giám sát.

### 5.8 Lắp còi chip TMB12A05

Tài liệu kỹ thuật tra được dùng mã **TMB12A05**: còi điện từ chủ động hai chân, điện áp định mức 5 V, dải hoạt động 4–8 V và dòng tối đa khoảng 30 mA. Nếu chữ trên linh kiện thực tế là `TMB12A50`, cần kiểm tra lại ảnh/nhãn hoặc datasheet của nhà cung cấp vì không nên mặc định hai mã có cùng thông số. Firmware điều khiển transistor bằng GPIO26: HIGH thì còi kêu, LOW thì còi tắt.

#### Sơ đồ lắp qua transistor NPN C828

Nhận biết chân:

- Chân có dấu `+` hoặc chân dài hơn là cực dương.
- Chân có dấu `-` hoặc chân ngắn hơn là cực âm.
- TMB12A05 là active buzzer nên chỉ cần cấp DC đúng cực để phát âm liên tục.

Không cấp còi trực tiếp từ GPIO26. Dùng transistor NPN **C828 (2SC828)** làm khóa đóng/cắt phía GND:

```text
ESP32 5V ───────────────────── TMB12A05 (+)
                                  TMB12A05 (-) ─── Collector (C) C828
ESP32 GPIO26 ─── 1 kΩ ───────── Base (B) C828
                                Emitter (E) C828 ─── GND chung
ESP32 GPIO26 ─── 10 kΩ ───────── GND chung (pull-down, khuyến nghị)
```

Phải tra datasheet hoặc đo để xác định đúng các chân `E-B-C` của chiếc C828 đang dùng; không suy đoán thứ tự chân chỉ theo mặt phẳng của vỏ transistor vì pinout có thể khác theo package/nhà sản xuất. Nối chung GND của nguồn 5 V và ESP32. Vì TMB12A05 là còi điện từ, nên mắc diode 1N4148/1N4007 song song ngược cực với còi: cathode về `+5V`, anode về Collector (C) của C828.

Không nối TMB12A05 trực tiếp giữa GPIO26 và GND: dòng định mức có thể vượt khả năng cấp dòng an toàn của GPIO. Firmware mặc định đúng cho active buzzer và không cần tạo PWM/tone 2,3 kHz; mạch dao động đã nằm bên trong còi.

Còi hoạt động theo hai mẫu không chặn chương trình:

- Phát hiện chuyển động: bật/tắt mỗi 150 ms, nhịp cảnh báo nhanh và được ưu tiên.
- Nhiệt độ cao hơn `temperatureThreshold`: bật/tắt mỗi 500 ms, nhịp cảnh báo chậm.
- Không còn chuyển động và nhiệt độ không vượt ngưỡng: còi tự tắt.

Có thể đổi chân, cực tính và tốc độ trong `firmware/SmartEnvironmentBackend/Config.h` qua `BUZZER_PIN`, `BUZZER_ACTIVE_HIGH`, `BUZZER_INTRUDER_TOGGLE_MS` và `BUZZER_TEMPERATURE_TOGGLE_MS`.

## 6. Cách firmware đọc bụi

Mỗi mẫu tuân theo timing:

```text
t = 0 µs       kéo LED LOW, LED phát bật
t = 280 µs     lấy mẫu ADC GPIO32
t = 320 µs     nhả LED HIGH/open-drain, LED tắt
t = 10 ms      bắt đầu chu kỳ tiếp theo
```

Firmware lấy chín mẫu và dùng trung vị để giảm spike. `analogReadMilliVolts()` cho điện áp tại chân ADC đã hiệu chỉnh theo eFuse khi có; sau đó hoàn nguyên divider để có `Vo` phía cảm biến.

Các điều kiện lỗi gồm:

- Raw ADC ngoài 0–4095 hoặc sát rail trong nhiều mẫu.
- Điện áp không hữu hạn/ngoài phạm vi vật lý.
- Không đủ mẫu hợp lệ.
- Quá thời gian không có cập nhật.
- Dữ liệu ingest backend có density âm hoặc ADC ngoài phạm vi.

Một ADC hở có thể trôi ngẫu nhiên, vì vậy `sensorOnline=false` là phát hiện heuristic chứ không phải chẩn đoán điện chính xác tuyệt đối.

## 7. Công thức và hiệu chuẩn

### 7.1 Công thức ban đầu

```text
deltaV  = max(0, Vo - cleanAirVoltage)
density = max(0,
              deltaV / sensitivityVPer100Ug × 100 × calibrationFactor
              + densityOffset)
```

Giá trị khởi đầu:

| Tham số | Mặc định | Ý nghĩa |
| --- | ---: | --- |
| `cleanAirVoltage` | 0,60 V | Voc điển hình; phải đo lại |
| `sensitivityVPer100Ug` | 0,50 V | Độ nhạy danh định trên 100 µg/m³ |
| `calibrationFactor` | 1,00 | Hệ số scale tham chiếu |
| `densityOffset` | 0,00 µg/m³ | Offset sau scale |
| `calibrated` | false | Chỉ true sau hiệu chuẩn tham chiếu |

### 7.2 Hiệu chuẩn Voc không khí sạch

1. Đặt cảm biến đúng hướng, tránh ánh sáng chiếu vào lỗ đo, tránh gió mạnh và ngưng tụ.
2. Làm nóng ít nhất một phút; specification cho thời gian sẵn sàng dưới một giây nhưng thời gian dài hơn giúp ổn định prototype.
3. Thu ít nhất 100 lần cập nhật đã lọc trong môi trường sạch tương đối.
4. Dùng median hoặc trimmed mean của `dust.voltage` làm `cleanAirVoltage`.
5. Cập nhật bằng API config, nhưng vẫn để `calibrated=false` nếu chưa có thiết bị tham chiếu.

### 7.3 Hiệu chuẩn bằng thiết bị tham chiếu

1. Đặt cảm biến Sharp và máy tham chiếu cạnh nhau, cùng luồng khí.
2. Ghi nhiều điểm từ sạch đến mức bụi vừa; không cố tạo khói nguy hiểm trong phòng kín.
3. Hồi quy tuyến tính giá trị dự án theo thiết bị tham chiếu để tìm scale/offset.
4. Cập nhật `calibrationFactor`, `densityOffset` hoặc độ nhạy.
5. Đặt `calibrated=true`, lưu ngày, thiết bị và điều kiện hiệu chuẩn trong nhật ký nhóm.
6. Kiểm tra lại định kỳ vì bụi bám, vị trí và lão hóa LED làm Voc trôi.

## 8. Cài môi trường Arduino

### 8.1 Arduino IDE và ESP32 core

1. Cài Arduino IDE 2.x.
2. Trong Board Manager, cài `esp32 by Espressif Systems`.
3. Chọn `ESP32 Dev Module`.
4. Chọn đúng cổng COM.

Firmware chính:

```text
firmware/SmartEnvironmentBackend/SmartEnvironmentBackend.ino
```

Nếu firmware dùng thư viện LCD, cài đúng package được nêu trong log compile/README của sketch. `WiFi.h`, `WebServer.h` và `Wire.h` đi cùng ESP32 core.

### 8.2 Cấu hình

Trước khi nạp, kiểm tra các giá trị tập trung:

- Wi-Fi SSID/password.
- Pins 34, 35, 32, 25, 26, 27, 2, 21, 22.
- `LED_ACTIVE_HIGH` và cực tính chân LED bụi.
- Địa chỉ LCD `0x27` hoặc `0x3F`.
- Divider 10 kΩ/12 kΩ.
- Voc, sensitivity, calibration factor/offset.
- Các ngưỡng nhiệt độ, ánh sáng, bụi và cooldown.

Không commit mật khẩu Wi-Fi thật lên repository công khai.

### 8.3 Nạp và kiểm tra

1. Ngắt GP2Y Vo, SDA và SCL khỏi ESP32; cấp nguồn mạch và đo điện áp trước.
2. Tắt nguồn, nối lại các đường đã an toàn.
3. Nạp firmware.
4. Mở Serial Monitor 115200 baud.
5. Ghi lại IP được cấp.
6. Kiểm tra LCD luân phiên ba màn hình và không nhấp nháy do clear liên tục.
7. Mở dashboard tại IP ESP32.

Firmware in kết quả đo mỗi giây trên một dòng:

```text
[SENSORS] temp=29.5C rawTemp=366 light=420 rawLight=1720 dust=85.5ug/m3 dustAdc=1234 dustAdcV=0.775V dustVo=1.421V motion=NO mode=AUTO led=OFF buzzer=OFF
```

`ERROR` xuất hiện thay cho giá trị khi firmware đánh dấu cảm biến offline/bất thường. Có thể thay chu kỳ log bằng `SERIAL_MONITOR_INTERVAL_MS` trong `Config.h`.

## 9. LCD1602

Ba màn hình luân phiên:

```text
Màn 1: TEMP và LIGHT
Màn 2: DUST và CLEAN/MOD/HIGH/DANGER
Màn 3: AUTO/MANUAL và LED ON/OFF
```

Khi dust invalid/offline, dòng liên quan hiển thị `DUST ERROR`. Firmware chỉ ghi lại 16 ký tự khi nội dung/màn hình thay đổi, không gọi `lcd.clear()` theo chu kỳ đọc cảm biến.

## 10. Test API ESP32

Thay IP bằng địa chỉ Serial Monitor:

```powershell
$base='http://192.168.1.100'
Invoke-RestMethod "$base/api/health"
Invoke-RestMethod "$base/api/status"
Invoke-RestMethod "$base/api/mode" -Method Post -ContentType 'application/json' -Body '{"mode":"AUTO"}'
Invoke-RestMethod "$base/api/light" -Method Post -ContentType 'application/json' -Body '{"status":"ON"}'
Invoke-RestMethod "$base/api/config"
```

`POST /api/light` phải chuyển hệ thống sang MANUAL. Khi trở lại AUTO, LED tuân theo dark/bright hysteresis.

Status dust tối thiểu:

```json
{
  "rawAdc": 1234,
  "adcVoltage": 0.775,
  "voltage": 1.421,
  "density": 85.5,
  "unit": "ug/m3",
  "level": "MODERATE",
  "sensorOnline": true,
  "calibrated": false,
  "lastUpdate": "2026-07-15T10:00:00.000Z"
}
```

## 11. Chạy backend Node.js

Yêu cầu Node.js 18+:

```powershell
npm.cmd start
```

Dashboard:

```text
http://localhost:3000
```

Kết nối backend tới ESP32:

```powershell
$env:ESP32_BASE_URL='http://192.168.1.100'
$env:SYNC_FROM_ESP32='true'
npm.cmd start
```

Hoặc thiết bị/script có thể push dữ liệu vào `POST /api/sensor`. Payload cũ chỉ có temperature/light vẫn được chấp nhận; dust sẽ được ghi offline/missing thay vì làm hỏng client cũ.

## 12. API backend mở rộng

| Method | Endpoint | Kết quả |
| --- | --- | --- |
| GET | `/api/status` | Latest + sensor/connection/alert state |
| POST | `/api/sensor`, `/api/readings` | Ingest dữ liệu thật/mô phỏng có nhãn |
| GET | `/api/history?limit=...` | Items + metrics ba cảm biến |
| GET | `/api/notifications` | Notification Center |
| PATCH | `/api/notifications/:id/read` | Read/unread persistence |
| GET | `/api/forecast` | Moving average/regression/trend |
| GET | `/api/reports?period=daily|weekly` | Báo cáo thống kê |
| GET | `/api/reports?period=daily&format=csv` | CSV UTF-8 |
| GET | `/api/config` | Ngưỡng/cooldown/calibration |
| PATCH/POST | `/api/config` | Cập nhật và validate cấu hình |

Notification có ID, type, title, message, measured value, threshold, timestamp, read state và source. Backend chỉ tạo lại khi trạng thái chuyển hoặc cooldown đã hết.

Forecast là thống kê ngắn hạn, không phải AI và không thay thế thiết bị quan trắc chuyên dụng.

## 13. Dashboard

Dashboard có:

- Nhiệt độ, ánh sáng và bụi hiện tại.
- Điện áp GP2Y, dust level và nhãn chưa hiệu chuẩn.
- Online/offline từng cảm biến và kết nối ESP32/backend.
- Nguồn `REAL`, `SIMULATED`, `CACHED` hoặc `DISCONNECTED`.
- AUTO/MANUAL, LED control, dark mode và responsive mobile.
- Ba history charts.
- Notification Center và Web Notification tùy quyền trình duyệt.
- Forecast, reports ngày/tuần, CSV và trang config.

Nếu API lỗi, dashboard hiển thị mất kết nối; không tạo số ngẫu nhiên để giả dữ liệu thật.

### 13.1 Thiết lập cảnh báo khi có người đi vào

1. Đấu HC-SR501 theo mục 5.7 và nạp firmware `firmware/SmartEnvironmentBackend/SmartEnvironmentBackend.ino`.
2. Chờ PIR ổn định 30–60 giây sau khi ESP32 khởi động.
3. Mở API trạng thái của ESP32 và đi ngang trước cảm biến (thay IP bằng địa chỉ trên Serial Monitor):

   ```powershell
   $base='http://192.168.1.100'
   Invoke-RestMethod "$base/api/status" | ConvertTo-Json -Depth 6
   ```

4. Khi phát hiện chuyển động, kiểm tra hai trường:

   ```json
   {
     "motionDetected": true,
     "alerts": {
       "intruderDetected": true
     }
   }
   ```

5. Chạy backend với đúng IP ESP32, sau đó mở dashboard:

   ```powershell
   $env:ESP32_BASE_URL='http://192.168.1.100'
   npm.cmd start
   ```

6. Vào **Notification Center**, bấm nút cấp quyền thông báo và chọn **Allow**. Khi PIR chuyển từ không phát hiện sang phát hiện, backend tạo notification `INTRUDER_DETECTED` mức `CRITICAL`. Cảnh báo vẫn xuất hiện trong Notification Center nếu người dùng không cấp quyền Web Notification.
7. Đi ngang vùng quan sát để thử. Sau đó đứng yên, chờ hết thời gian `TIME` và kiểm tra `motionDetected` trở về `false`.

8. Xác nhận còi ở GPIO26 kêu nhịp nhanh khi `motionDetected=true`. Để thử cảnh báo nhiệt mà không hơ nóng cảm biến, có thể tạm giảm `temperatureThreshold` trên trang Configuration xuống thấp hơn nhiệt độ hiện tại; xác nhận còi kêu nhịp chậm rồi trả ngưỡng về giá trị an toàn ban đầu.

Web Notification thường yêu cầu `localhost` hoặc HTTPS. Khi mở dashboard bằng địa chỉ LAN dạng `http://192.168.x.x:3000`, một số trình duyệt có thể không cho gửi thông báo hệ thống; Notification Center bên trong trang vẫn hoạt động.

## 14. Kiểm thử phần mềm

```powershell
npm.cmd test
```

Các nhóm kiểm thử:

- Dust hợp lệ, âm, ngoài ADC, thiếu/offline.
- Boundary CLEAN/MODERATE/HIGH/DANGEROUS.
- Notification transition, cooldown, mark-read.
- Forecast đủ mẫu/thiếu mẫu và trend.
- Daily/weekly reports, LED ratio, disconnect và CSV.
- PATCH config, persistence và migration.
- API legacy aliases/fields/status code.
- ESP32 offline nhưng backend vẫn trả cache có nhãn rõ.

Compile firmware bằng Arduino CLI/Arduino IDE không thay thế test phần cứng.

## 15. Checklist xác nhận phần cứng

- [ ] GND của toàn bộ mạch đã nối chung.
- [ ] LM35 đúng pinout và được cấp 5 V.
- [ ] LDR divider dùng 3,3 V, không phải 5 V.
- [ ] LED có điện trở 220–330 Ω.
- [ ] GP2Y pin 1 có 150 Ω và 220 µF đúng cực.
- [ ] GP2Y pin 3 dùng open-drain/driver, không push-pull 5 V.
- [ ] GPIO32 không vượt 3,1 V khi GP2Y được cấp 5,5 V giả lập/kiểm tra.
- [ ] SDA/SCL không vượt 3,3 V ở trạng thái idle.
- [ ] LCD đúng địa chỉ và không nhấp nháy.
- [ ] PIR OUT nối GPIO27, đã chờ ổn định và trả `motionDetected: true` khi có chuyển động.
- [ ] Active buzzer nối GPIO26 qua module/driver phù hợp, kêu nhanh khi có chuyển động và kêu chậm khi quá nhiệt.
- [ ] Raw ADC không bị kẹt 0/4095.
- [ ] Dust `lastUpdate` thay đổi và `sensorOnline` phản ánh lỗi tháo dây.
- [ ] AUTO hysteresis không làm LED chớp liên tục gần ngưỡng.
- [ ] Dashboard phân biệt dữ liệu thật, mô phỏng, cache và mất kết nối.
- [ ] Đã ghi Voc sạch; `calibrated` vẫn false nếu chưa có máy tham chiếu.

## 16. Troubleshooting

| Hiện tượng | Kiểm tra |
| --- | --- |
| ESP32 không boot | Tháo LED ngoài GPIO2, kiểm tra short/nguồn, giữ BOOT khi nạp |
| LM35 sai cao | Pinout/cấp nguồn, GND, nhiễu ADC, công thức 10 mV/°C |
| LDR đảo chiều | Vị trí LDR/10 kΩ và cực tính cấu hình |
| Dust luôn 0 | Vo thấp hơn Voc, LED không được pulse, sai pin 1/2/3, chưa chung GND |
| Dust luôn rất cao | Divider/config ratio sai, Voc sai, ánh sáng lọt, bụi bám, ADC saturation |
| Dust offline | Đo Vo/ADC, kiểm tra open-drain GPIO25, 150 Ω/220 µF và timeout |
| LCD không sáng | VCC, GND, contrast, địa chỉ 0x27/0x3F |
| LCD sáng nhưng rác | Level logic, SDA/SCL đảo, pull-up 5 V, library/mapping backpack |
| Wi-Fi mất | SSID/password, RSSI, nguồn USB, reconnect log |
| Backend có dữ liệu nhưng ghi SIMULATED | Chưa ingest ESP32 với `source=esp32`, hoặc đang dùng seed |
| Không có Web Notification | Quyền trình duyệt bị từ chối; Notification Center trong trang vẫn hoạt động |
| PIR luôn báo có người | Chờ ổn định sau khi cấp nguồn, giảm TIME/SENS, tránh nguồn nhiệt và kiểm tra jumper H/L |
| PIR không phát hiện | Kiểm tra VCC/GND/OUT, GPIO27, tăng SENS và đo OUT khi đi ngang trước cảm biến |
| Còi không kêu | Kiểm tra nguồn 5 V, cực `+/-` TMB12A05, transistor, diode, GND chung và tín hiệu GPIO26 |
| Còi kêu liên tục | Kiểm tra `motionDetected`, nhiệt độ/ngưỡng, PIR TIME/SENS và transistor có bị đấu đảo/chập không |

## 17. Nhánh legacy

`arduino-sensors/` và `esp32-firmware/main/` được giữ để tham khảo lịch sử dự án. Không đấu UART UNO theo hướng dẫn cũ cho bản triển khai này. Nếu nhóm muốn demo lại kiến trúc legacy, phải tách riêng wiring, sửa vấn đề level-shifting UNO TX 5 V → ESP32 RX và không dùng nó làm kiến trúc báo cáo chính.

## 18. Nguồn kỹ thuật

- [Sharp GP2Y1014AU0F product family](https://global.sharp/products/device/lineup/selection/opto/dust/index.html)
- [Sharp GP2Y1014AU0F specification sheet](https://www.socle-tech.com/doc/IC%20Channel%20Product/SHARP_GP2Y1014AU0F.pdf)
- [Sharp application note: R=150 Ω, C=220 µF và timing](https://global.sharp/products/device/lineup/data/pdf/datasheet/gp2y1010au_appl_e.pdf)
- [Espressif ESP32-WROOM-32 datasheet](https://documentation.espressif.com/esp32-wroom-32_datasheet_en.pdf)
- [Espressif ADC API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html)
- [TI LM35 datasheet](https://www.ti.com/lit/ds/symlink/lm35.pdf)
