# Smart Environment Monitoring & Lighting Control System

Hệ thống IoT dùng **một ESP32 ESP-WROOM-32S làm bộ điều khiển trung tâm**: đọc trực tiếp LM35, LDR và cảm biến bụi analog Sharp GP2Y1014AU0F; điều khiển LED; hiển thị LCD1602 I2C; cung cấp REST API và Web Dashboard qua Wi-Fi.

Backend Node.js được giữ làm môi trường demo trên máy tính, lưu lịch sử, tạo Notification Center, dự báo thống kê ngắn hạn, báo cáo ngày/tuần và xuất CSV. Arduino UNO + ESP32 Gateway chỉ là mã legacy tham khảo, không phải kiến trúc triển khai chính.

> **Giới hạn quan trọng:** mật độ bụi là giá trị ước tính để học tập và theo dõi xu hướng cho đến khi cảm biến được hiệu chuẩn bằng thiết bị tham chiếu. Hệ thống không tạo PM1.0/PM2.5/PM10 và không công bố AQI chính thức.

## Kiến trúc

```text
LM35 GPIO34 ─┐
LDR  GPIO35 ─┼─ ADC1 ─┐
GP2Y Vo ─ divider ─ GPIO32
GP2Y LED ───────── GPIO25
                         ▼
                 ESP32 ESP-WROOM-32S
          lọc + kiểm tra + AUTO/MANUAL
          LED GPIO2 + LCD I2C 21/22
          Wi-Fi + REST API + Dashboard
                         │
                 Browser trong LAN
                         │ tùy chọn
                         ▼
                  Node.js demo backend
        history + notifications + forecast + reports/CSV
```

GPIO32, GPIO34 và GPIO35 đều thuộc ADC1 nên có thể đọc trong khi Wi-Fi hoạt động. GPIO34/35 là input-only, phù hợp với hai cảm biến analog. GPIO2 được giữ theo thiết kế hiện tại nhưng là chân strapping/on-board LED trên nhiều board; không dùng điện trở kéo mạnh làm sai mức lúc khởi động.

## Cấu trúc dự án

```text
firmware/SmartEnvironmentBackend/  Firmware ESP32 chính
frontend/                          Dashboard dùng cho ESP32/Node demo
backend/                           Backend Node.js và kiểm thử
esp32-firmware/                    Gateway ESP32 legacy, không dùng làm chính
arduino-sensors/                   Module Arduino UNO legacy
SETUP_GUIDE.md                     Hướng dẫn đấu dây, nạp và hiệu chuẩn
```

## Bảng chân chính

| Chức năng | Chân ESP32 | Ghi chú |
| --- | --- | --- |
| LM35 OUT | GPIO34 / ADC1_CH6 | LM35 rời cấp 5 V, OUT danh định 10 mV/°C |
| LDR divider | GPIO35 / ADC1_CH7 | Divider phải dùng 3,3 V để bảo vệ ADC |
| GP2Y1014AU0F Vo | GPIO32 / ADC1_CH4 | Qua divider 10 kΩ/12 kΩ trước ADC |
| GP2Y LED control | GPIO25 | Open-drain, active-low |
| LED chiếu sáng | GPIO2 | Qua điện trở 220–330 Ω |
| LCD1602 I2C SDA | GPIO21 | Không để pull-up lên 5 V trực tiếp vào ESP32 |
| LCD1602 I2C SCL | GPIO22 | Dùng level shifter hoặc xác nhận vận hành 3,3 V |

Tất cả cảm biến, nguồn và ESP32 **phải nối chung GND**. Xem sơ đồ chi tiết và checklist đo điện áp trong [SETUP_GUIDE.md](SETUP_GUIDE.md).

## Mạch GP2Y1014AU0F rời

| Pin GP2Y | Tên | Kết nối |
| --- | --- | --- |
| 1 | V-LED | 5 V qua 150 Ω; tụ 220 µF từ pin 1 (+) xuống pin 2 (−) |
| 2 | LED-GND | GND chung |
| 3 | LED | GPIO25 open-drain, active-low |
| 4 | S-GND | GND chung |
| 5 | Vo | Qua 10 kΩ tới GPIO32; 12 kΩ từ GPIO32 xuống GND |
| 6 | Vcc | 5 V |

Divider có tỷ lệ:

```text
Vadc = Vo × 12 / (10 + 12) = Vo × 0,54545
Vo   = Vadc × 22 / 12
```

Với nguồn cực đại 5,5 V, nút ADC xấp xỉ 3,0 V. Ưu tiên điện trở 1%; nếu dùng điện trở sai số 5%, phải đo lại bằng VC830L trước khi nối GPIO32.

Datasheet quy định chu kỳ LED 10 ± 1 ms, độ rộng xung 0,32 ± 0,02 ms và lấy mẫu Vo tại khoảng 0,28 ms sau khi bật LED. Firmware lấy nhiều mẫu, lọc trung vị, phát hiện ADC sát rail, dữ liệu bất thường và timeout.

## Công thức mật độ bụi ước tính

Độ nhạy danh định của GP2Y1014AU0F là 0,5 V trên mỗi 100 µg/m³. Firmware dùng:

```text
deltaV  = max(0, Vo - cleanAirVoltage)
density = max(0,
              deltaV / sensitivityVPer100Ug × 100 × calibrationFactor
              + densityOffset)
```

Giá trị khởi đầu `cleanAirVoltage = 0,6 V`, `sensitivityVPer100Ug = 0,5 V`, `calibrationFactor = 1,0` chỉ là giá trị danh định. `calibrated` chỉ được đặt `true` sau khi so sánh với thiết bị tham chiếu.

Các mức `CLEAN`, `MODERATE`, `HIGH`, `DANGEROUS` là **ngưỡng cảnh báo nội bộ của dự án**, có thể đổi qua `PATCH /api/config`; chúng không phải thang AQI chính thức.

## Chạy firmware ESP32

1. Cài Arduino IDE và ESP32 board package.
2. Mở `firmware/SmartEnvironmentBackend/SmartEnvironmentBackend.ino`.
3. Cập nhật Wi-Fi, địa chỉ LCD và các hệ số hiệu chuẩn tập trung trong firmware.
4. Chọn `ESP32 Dev Module`, nạp sketch và mở Serial Monitor 115200 baud.
5. Truy cập địa chỉ IP được in ra, ví dụ `http://192.168.1.100`.

ESP32 phục vụ dashboard live, đọc cảm biến, AUTO/MANUAL, LED, LCD, cảnh báo và API trạng thái. Phần lưu lịch sử dài hạn, báo cáo và dự báo được thực hiện đầy đủ ở backend Node.js để phù hợp bộ nhớ của máy tính demo.

## Chạy backend demo

Yêu cầu Node.js 18 trở lên:

```powershell
npm.cmd start
```

Mở:

```text
http://localhost:3000
```

Mặc định dữ liệu seed/demo được gắn nhãn `SIMULATED`. Có thể cấu hình backend lấy trạng thái ESP32:

```powershell
$env:ESP32_BASE_URL='http://192.168.1.100'
$env:SYNC_FROM_ESP32='true'
npm.cmd start
```

Khi ESP32 mất kết nối, backend giữ cache nhưng trả metadata offline; dashboard không biến dữ liệu cache hoặc mô phỏng thành dữ liệu thật.

## REST API

| Method | Endpoint | Chức năng |
| --- | --- | --- |
| GET | `/api/health` | Health backend/ESP32 |
| POST | `/api/sensor` | Nhận nhiệt độ, ánh sáng, bụi; payload cũ không có bụi vẫn hợp lệ |
| POST | `/api/readings` | Alias tương thích của `/api/sensor` |
| GET | `/api/status` | Trạng thái mới nhất và cảnh báo |
| GET | `/api/history?limit=240` | Lịch sử và metrics ba cảm biến |
| DELETE | `/api/history` | Xóa lịch sử demo |
| POST | `/api/mode` | Chọn `AUTO` hoặc `MANUAL` |
| POST | `/api/light` | Bật/tắt LED và chuyển sang MANUAL |
| GET | `/api/notifications` | Danh sách Notification Center |
| PATCH | `/api/notifications/:id/read` | Đánh dấu đã đọc |
| GET | `/api/forecast` | Dự báo xu hướng thống kê ngắn hạn |
| GET | `/api/reports?period=daily` | Báo cáo ngày |
| GET | `/api/reports?period=weekly` | Báo cáo tuần |
| GET | `/api/reports?period=daily&format=csv` | Xuất CSV |
| GET | `/api/config` | Lấy ngưỡng và hệ số hiệu chuẩn |
| PATCH/POST | `/api/config` | Cập nhật cấu hình; POST được giữ để tương thích |

Ví dụ gửi dữ liệu đầy đủ:

```json
{
  "temperature": 29.4,
  "lightLevel": 420,
  "lightStatus": true,
  "mode": "AUTO",
  "source": "esp32",
  "dataMode": "REAL",
  "dust": {
    "rawAdc": 1234,
    "adcVoltage": 0.775,
    "voltage": 1.421,
    "density": 85.5,
    "sensorOnline": true,
    "calibrated": false
  }
}
```

## Dashboard

Dashboard giữ dark mode, responsive, AUTO/MANUAL, điều khiển LED và thống kê cũ; đồng thời bổ sung:

- Nhiệt độ, mức sáng, điện áp/mật độ/mức bụi và trạng thái từng cảm biến.
- Nhãn nguồn `REAL`, `SIMULATED` hoặc `DISCONNECTED`.
- Ba biểu đồ lịch sử không tạo mẫu giả khi API lỗi.
- Notification Center có cooldown, read/unread và Web Notification tùy quyền trình duyệt.
- Dự báo dùng moving average, hồi quy tuyến tính và tốc độ thay đổi; không gọi là AI.
- Báo cáo ngày/tuần, khuyến nghị và CSV.
- Cấu hình ngưỡng bụi, nhiệt độ, ánh sáng và hệ số hiệu chuẩn.

## Kiểm thử

```powershell
npm.cmd test
```

Bộ test bao phủ dữ liệu bụi hợp lệ/âm/ngoài ADC/mất dữ liệu, phân loại, notification cooldown, forecast đủ/thiếu mẫu, report ngày/tuần, config, migration và tương thích API cũ.

Việc compile firmware chỉ xác nhận cú pháp và liên kết thư viện. Nhóm vẫn phải xác nhận trên phần cứng: mức điện áp, địa chỉ I2C, cực tính LDR, chất lượng ADC khi Wi-Fi chạy, Voc không khí sạch và hệ số hiệu chuẩn thực tế.

## Ứng dụng thực tế

Hệ thống phù hợp cho demo/giáo dục và theo dõi xu hướng tại nhà ở thông minh, phòng học, văn phòng, phòng máy, kho, khu vực gần đường/công trình và không gian có người nhạy cảm với bụi. Có thể mở rộng relay để điều khiển quạt thông gió hoặc máy lọc không khí sau khi bổ sung cách ly điện và thiết kế an toàn tải.

## Tài liệu kỹ thuật tham khảo

- [Sharp Dust Sensor product lineup](https://global.sharp/products/device/lineup/selection/opto/dust/index.html)
- [Sharp GP2Y1014AU0F specification sheet](https://www.socle-tech.com/doc/IC%20Channel%20Product/SHARP_GP2Y1014AU0F.pdf)
- [Sharp GP2Y1010AU0F application note về mạch và timing cùng họ](https://global.sharp/products/device/lineup/data/pdf/datasheet/gp2y1010au_appl_e.pdf)
- [Espressif ESP32-WROOM-32 datasheet](https://documentation.espressif.com/esp32-wroom-32_datasheet_en.pdf)
- [Espressif Arduino-ESP32 ADC API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html)
- [Texas Instruments LM35 datasheet](https://www.ti.com/lit/ds/symlink/lm35.pdf)
