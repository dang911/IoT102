# Smart Environment Monitoring & Lighting Control System

Hệ thống IoT dùng ESP32 để giám sát nhiệt độ, ánh sáng và chuyển động; điều
khiển đèn, LCD và còi; đồng thời cung cấp REST API cùng Web Dashboard.

## Chức năng

- Đọc nhiệt độ từ LM35.
- Đọc ánh sáng từ LDR.
- Điều khiển đèn theo chế độ AUTO hoặc MANUAL.
- Phát hiện chuyển động bằng PIR HC-SR501.
- Kích hoạt còi TMB12A05 khi phát hiện chuyển động hoặc quá nhiệt.
- Hiển thị trạng thái trên LCD1602 I2C và Serial Monitor.
- Lưu lịch sử nhiệt độ/ánh sáng, tạo thông báo, dự báo xu hướng và báo cáo.
- Gửi email cảnh báo quá nhiệt qua SMTP tới địa chỉ cấu hình trên Dashboard.

## Kiến trúc

```text
LM35 ─┐
LDR  ─┼── ESP32 ── LED / LCD1602 / TMB12A05
PIR  ─┘      │
             └── Wi-Fi ── REST API ── Web Dashboard
```

## Gán chân ESP32

| GPIO | Thiết bị |
|---|---|
| GPIO34 | LM35 |
| GPIO35 | LDR |
| GPIO27 | HC-SR501 OUT |
| GPIO26 | Điều khiển transistor của TMB12A05 |
| GPIO2 | LED chiếu sáng |
| GPIO21 / GPIO22 | LCD1602 I2C SDA / SCL |

Không cấp còi TMB12A05 trực tiếp từ GPIO26. Còi 5 V phải được điều khiển qua
transistor/MOSFET, có diode dập xung ngược và GND chung.

## Chạy backend

Yêu cầu Node.js 18 trở lên:

```powershell
node backend/server.js
```

Mở `http://localhost:3000`.

Chạy kiểm thử:

```powershell
node --test backend/tests/*.test.js
```

## Email cảnh báo quá nhiệt

Mở `backend/emailConfig.js` và điền tài khoản SMTP gửi email. Với Gmail, dùng
App Password 16 ký tự thay cho mật khẩu đăng nhập thông thường:

```js
user: process.env.SMTP_USER || 'email-gui@gmail.com',
password: process.env.SMTP_PASSWORD || 'APP_PASSWORD_16_KY_TU',
```

Chạy lại backend, vào **Settings → Email notifications**, nhập email người
nhận rồi lưu. Email chỉ được gửi khi cảnh báo `TEMPERATURE_HIGH` mới được tạo;
thời gian cooldown thông báo hiện tại cũng được áp dụng để tránh gửi thư rác.

## REST API chính

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/health` | Trạng thái backend/ESP32 |
| GET | `/api/status` | Trạng thái mới nhất |
| POST | `/api/sensor` | Nhận nhiệt độ, ánh sáng và chuyển động |
| GET | `/api/history?limit=240` | Lịch sử và thống kê |
| POST | `/api/mode` | Chọn AUTO/MANUAL |
| POST | `/api/light` | Điều khiển đèn |
| GET | `/api/notifications` | Notification Center |
| GET | `/api/forecast` | Dự báo nhiệt độ ngắn hạn |
| GET | `/api/reports?period=daily` | Báo cáo ngày |
| GET | `/api/reports?period=weekly` | Báo cáo tuần |
| GET/PATCH | `/api/config` | Đọc/cập nhật cấu hình |

## Cấu trúc chính

- `backend/`: API, lưu trữ, cảnh báo, dự báo và báo cáo.
- `frontend/`: Web Dashboard.
- `firmware/SmartEnvironmentBackend/`: firmware ESP32.
- `firmware/PirMonitorTest/`: test riêng HC-SR501.
- `firmware/PirBuzzerTest/`: test PIR kết hợp còi.
