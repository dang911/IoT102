param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$wdCollapseEnd = 0
$wdPageBreak = 7
$wdFormatDocumentDefault = 16
$wdAdjustNone = 0
$wdAlignParagraphLeft = 0
$wdAlignParagraphCenter = 1
$wdCellAlignVerticalCenter = 1
$wdColorAutomatic = -16777216
$wdReplaceAll = 2

$word = $null
$doc = $null

function Get-EndRange {
  $range = $script:doc.Content.Duplicate
  $range.Collapse($script:wdCollapseEnd)
  return $range
}

function Add-Paragraph {
  param(
    [string]$Text,
    [string]$Style = 'Normal',
    [double]$SpaceAfter = 6
  )

  $range = Get-EndRange
  $paragraph = $script:doc.Paragraphs.Add($range)
  $paragraph.Range.Text = $Text
  $paragraph.Range.Style = $Style
  $paragraph.Format.SpaceAfter = $SpaceAfter
  $paragraph.Range.InsertParagraphAfter()
  return $paragraph
}

function Add-Bullet {
  param([string]$Text)
  $paragraph = Add-Paragraph -Text $Text -Style 'List Bullet' -SpaceAfter 3
  return $paragraph
}

function Add-CodeBlock {
  param([string]$Text)
  $paragraph = Add-Paragraph -Text $Text -Style 'Normal' -SpaceAfter 8
  $paragraph.Range.Font.Name = 'Courier New'
  $paragraph.Range.Font.Size = 8.5
  $paragraph.Range.NoProofing = $true
  $paragraph.Format.LeftIndent = 12
  $paragraph.Format.RightIndent = 12
  $paragraph.Format.SpaceBefore = 5
  $paragraph.Range.Shading.BackgroundPatternColor = 15132390
  return $paragraph
}

function Add-PageBreak {
  $range = Get-EndRange
  $range.InsertBreak($script:wdPageBreak)
}

function Add-ReportTable {
  param(
    [string[]]$Headers,
    [object[][]]$Rows,
    [double[]]$Widths
  )

  $range = Get-EndRange
  $table = $script:doc.Tables.Add($range, $Rows.Count + 1, $Headers.Count)
  $table.Style = 'Table Grid'
  $table.AllowAutoFit = $false
  $table.Rows.Item(1).HeadingFormat = $true
  $table.Rows.Item(1).Range.Font.Bold = $true
  $table.Rows.Item(1).Range.Font.Color = 16777215
  $table.Rows.Item(1).Range.Shading.BackgroundPatternColor = 10053120
  $table.Range.Font.Name = 'Arial'
  $table.Range.Font.Size = 9
  $table.Range.ParagraphFormat.SpaceAfter = 0
  $table.Range.ParagraphFormat.SpaceBefore = 0
  $table.Range.ParagraphFormat.Alignment = $script:wdAlignParagraphLeft
  $table.TopPadding = 4
  $table.BottomPadding = 4
  $table.LeftPadding = 5
  $table.RightPadding = 5

  for ($columnIndex = 1; $columnIndex -le $Headers.Count; $columnIndex++) {
    $table.Cell(1, $columnIndex).Range.Text = $Headers[$columnIndex - 1]
    $table.Cell(1, $columnIndex).VerticalAlignment = $script:wdCellAlignVerticalCenter
    $table.Columns.Item($columnIndex).SetWidth($Widths[$columnIndex - 1], $script:wdAdjustNone)
  }

  for ($rowIndex = 0; $rowIndex -lt $Rows.Count; $rowIndex++) {
    for ($columnIndex = 0; $columnIndex -lt $Headers.Count; $columnIndex++) {
      $cell = $table.Cell($rowIndex + 2, $columnIndex + 1)
      $cell.Range.Text = [string]$Rows[$rowIndex][$columnIndex]
      $cell.VerticalAlignment = $script:wdCellAlignVerticalCenter
    }
  }

  $after = $script:doc.Range($table.Range.End, $table.Range.End)
  $after.InsertParagraphAfter()
  return $table
}

function Replace-AllText {
  param([string]$OldText, [string]$NewText)
  $range = $script:doc.Content
  $find = $range.Find
  $find.ClearFormatting()
  $find.Replacement.ClearFormatting()
  [void]$find.Execute($OldText, $false, $false, $false, $false, $false, $true, 1, $false, $NewText, $script:wdReplaceAll)
}

function Add-Application {
  param(
    [string]$Title,
    [string]$Audience,
    [string]$Problem,
    [string]$Data,
    [string]$Action,
    [string]$Benefit,
    [string]$Limitation
  )

  Add-Paragraph -Text $Title -Style 'Heading 3' -SpaceAfter 4 | Out-Null
  Add-Bullet "Đối tượng / Users: $Audience" | Out-Null
  Add-Bullet "Vấn đề / Problem: $Problem" | Out-Null
  Add-Bullet "Dữ liệu / Monitored data: $Data" | Out-Null
  Add-Bullet "Hành động / Action: $Action" | Out-Null
  Add-Bullet "Lợi ích / Benefit: $Benefit" | Out-Null
  Add-Bullet "Giới hạn / Limitation: $Limitation" | Out-Null
}

try {
  $resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
  $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
  $outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
  if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory | Out-Null
  }
  if (Test-Path -LiteralPath $resolvedOutput) {
    Remove-Item -LiteralPath $resolvedOutput -Force
  }

  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($resolvedInput, $false, $true)

  # Update the two existing BOM tables without changing their layout.
  if ($doc.Tables.Count -ge 2) {
    $doc.Tables.Item(1).Rows.Item(1).HeadingFormat = $true
    $doc.Tables.Item(2).Rows.Item(1).HeadingFormat = $true

    $row = $doc.Tables.Item(1).Rows.Add()
    $row.Cells.Item(1).Range.Text = '10'
    $row.Cells.Item(2).Range.Text = 'Sharp GP2Y1014AU0F'
    $row.Cells.Item(3).Range.Text = 'Estimates dust density from an analog voltage output'

    $row = $doc.Tables.Item(2).Rows.Add()
    $row.Cells.Item(1).Range.Text = '10'
    $row.Cells.Item(2).Range.Text = 'Sharp GP2Y1014AU0F'
    $row.Cells.Item(3).Range.Text = 'Ước tính mật độ bụi từ điện áp analog'
  }

  # Repair layout defects already present in the source report. Two overall
  # flowcharts were almost a full page tall, leaving their headings orphaned;
  # the inline flowcharts also inherited cramped paragraph geometry.
  foreach ($paragraph in $doc.Paragraphs) {
    $styleName = [string]$paragraph.Range.Style.NameLocal
    if ($styleName -match '^Heading [123]$') {
      $paragraph.Format.KeepWithNext = $true
      $paragraph.Format.KeepTogether = $true
    }
  }
  for ($shapeIndex = 1; $shapeIndex -le $doc.Shapes.Count; $shapeIndex++) {
    $shape = $doc.Shapes.Item($shapeIndex)
    if ($shape.Height -gt 640) {
      $shape.LockAspectRatio = $true
      $shape.Height = 590
      $shape.Top = 42
    }
  }
  for ($inlineIndex = 1; $inlineIndex -le $doc.InlineShapes.Count; $inlineIndex++) {
    $inlineShape = $doc.InlineShapes.Item($inlineIndex)
    if ($inlineShape.Width -gt 100 -and $inlineShape.Height -gt 100) {
      $inlineShape.Range.ParagraphFormat.LineSpacingRule = 0
      $inlineShape.Range.ParagraphFormat.SpaceBefore = 8
      $inlineShape.Range.ParagraphFormat.SpaceAfter = 8
      $inlineShape.Range.ParagraphFormat.KeepTogether = $true
    }
  }

  Replace-AllText 'The system utilizes an LM35 sensor to measure ambient temperature and a Light Dependent Resistor (LDR) to measure light intensity.' 'The system utilizes an LM35 sensor to measure ambient temperature, a Light Dependent Resistor (LDR) to measure relative light level, and a Sharp GP2Y1014AU0F analog optical sensor to estimate dust density.'
  Replace-AllText 'Hệ thống sử dụng cảm biến LM35 để đo nhiệt độ môi trường và cảm biến quang trở (LDR) để đo cường độ ánh sáng.' 'Hệ thống sử dụng LM35 để đo nhiệt độ, quang trở LDR để theo dõi mức sáng tương đối và cảm biến quang học analog Sharp GP2Y1014AU0F để ước tính mật độ bụi.'
  Replace-AllText 'Components: LM35, LDR, LED, LCD1602.' 'Components: LM35, LDR, GP2Y1014AU0F, LED, and LCD1602 I2C.'

  Add-PageBreak
  Add-Paragraph '3.8 Extended Architecture and Dust Monitoring / Kiến trúc mở rộng và giám sát bụi' 'Heading 1' 8 | Out-Null
  Add-Paragraph 'The deployment architecture uses one ESP32 ESP-WROOM-32S as the central controller. The ESP32 reads all three analog sensors through ADC1, applies filtering and validation, controls the lighting LED, updates the LCD1602, connects to Wi-Fi, exposes REST APIs, and serves the live dashboard. The Node.js backend remains an optional computer demo and persistence layer for history, notifications, forecasts, reports, CSV export, and automated tests.' | Out-Null
  Add-Paragraph 'Kiến trúc triển khai dùng một ESP32 ESP-WROOM-32S làm bộ điều khiển trung tâm. ESP32 đọc trực tiếp ba cảm biến qua ADC1, lọc và kiểm tra dữ liệu, điều khiển LED, cập nhật LCD1602, kết nối Wi-Fi, cung cấp REST API và phục vụ dashboard. Backend Node.js được giữ làm môi trường demo/lưu trữ trên máy tính cho history, notification, forecast, reports, CSV và kiểm thử tự động.' | Out-Null
  Add-CodeBlock @'
LM35 GPIO34 ─┐
LDR  GPIO35 ─┼─ ADC1 ─┐
GP2Y Vo ─ divider ─ GPIO32
GP2Y LED ───────── GPIO25
                         ▼
                 ESP32 central controller
          AUTO/MANUAL + LED + LCD + Wi-Fi/API
                         │
                 Browser / Node.js demo
'@ | Out-Null

  Add-Paragraph '3.8.1 Pin conflict and ADC review / Kiểm tra chân và ADC' 'Heading 2' 6 | Out-Null
  Add-Bullet 'GPIO32 (ADC1_CH4), GPIO34 (ADC1_CH6) và GPIO35 (ADC1_CH7) có thể đọc khi Wi-Fi hoạt động; không dùng ADC2 cho cảm biến.' | Out-Null
  Add-Bullet 'GPIO34 và GPIO35 là input-only, phù hợp cho LM35 và LDR.' | Out-Null
  Add-Bullet 'GPIO25 chỉ dùng digital open-drain để pulse LED phát của GP2Y; chức năng ADC2 của chân này không được sử dụng.' | Out-Null
  Add-Bullet 'GPIO2 được giữ cho LED chiếu sáng nhưng là chân strapping/on-board LED trên nhiều board; mạch ngoài không được kéo sai mức lúc boot.' | Out-Null

  Add-Paragraph '3.9 Wiring and Electrical Safety / Đấu dây và an toàn điện áp' 'Heading 1' 8 | Out-Null
  Add-ReportTable @('Thiết bị / Device', 'Chân thiết bị', 'Kết nối ESP32', 'Linh kiện và lưu ý an toàn') @(
    @('LM35', '+Vs / Vout / GND', '5 V / GPIO34 / GND', 'LM35 rời cần nguồn tối thiểu 4 V; Vout = 10 mV/°C.'),
    @('LDR', 'Divider node', 'GPIO35', '3.3 V → LDR → node; 10 kΩ từ node xuống GND.'),
    @('LED', 'Anode / Cathode', 'GPIO2 / GND', 'Điện trở hạn dòng 220–330 Ω; active-high.'),
    @('LCD1602 I2C', 'SDA / SCL', 'GPIO21 / GPIO22', 'Không nối pull-up 5 V trực tiếp; dùng level shifter hoặc xác nhận backpack chạy 3.3 V.'),
    @('GP2Y pin 1', 'V-LED', 'Nguồn 5 V', '5 V qua 150 Ω; tụ 220 µF từ pin 1 (+) xuống pin 2 (−).'),
    @('GP2Y pin 2', 'LED-GND', 'GND chung', 'Bắt buộc nối chung GND.'),
    @('GP2Y pin 3', 'LED', 'GPIO25', 'Open-drain, active-low; không drive push-pull HIGH.'),
    @('GP2Y pin 4', 'S-GND', 'GND chung', 'Nối chung với toàn hệ thống.'),
    @('GP2Y pin 5', 'Vo', 'GPIO32 qua divider', 'Vo → 10 kΩ → GPIO32; 12 kΩ từ GPIO32 xuống GND.'),
    @('GP2Y pin 6', 'Vcc', '5 V', 'Nguồn làm việc 5 ± 0.5 V.')
  ) @(85, 72, 96, 198) | Out-Null
  Add-Paragraph 'Voltage-divider protection / Bảo vệ ADC:' 'Heading 2' 5 | Out-Null
  Add-CodeBlock @'
Vadc = Vo × 12 / (10 + 12) = Vo × 0.54545
Vo   = Vadc × 22 / 12
At Vo = 5.5 V, Vadc ≈ 3.0 V.
'@ | Out-Null
  Add-Paragraph 'The divider is mandatory for the bare sensor because the sensor runs from approximately 5 V while the ESP32 I/O domain is 3.3 V. Use 1% resistors where possible and verify GPIO32 with the VC830L before connecting it. All grounds must be common.' | Out-Null
  Add-Paragraph 'Divider là bắt buộc với cảm biến rời do GP2Y dùng nguồn khoảng 5 V còn miền I/O ESP32 là 3,3 V. Ưu tiên điện trở 1% và đo GPIO32 bằng VC830L trước khi nối. Tất cả GND phải nối chung.' | Out-Null
  Add-Paragraph 'LCD note / Lưu ý LCD:' 'Heading 2' 5 | Out-Null
  Add-Paragraph 'A common PCF8574 backpack may pull SDA/SCL to its 5 V supply. The safe permanent solution is a bidirectional I2C level shifter. For a temporary prototype without a level shifter, power the backpack from 3.3 V only if it operates reliably and measure both bus lines before connecting the ESP32.' | Out-Null

  Add-Paragraph '3.10 GP2Y1014AU0F Sampling and Conversion / Lấy mẫu và chuyển đổi dữ liệu bụi' 'Heading 1' 8 | Out-Null
  Add-Paragraph 'The GP2Y1014AU0F is an analog optical dust sensor, not a UART particle counter. The implementation does not invent PM1.0, PM2.5, or PM10 values.' | Out-Null
  Add-ReportTable @('Thời điểm', 'Thao tác', 'Mục đích') @(
    @('0 µs', 'Kéo LED input LOW', 'Bật LED phát bên trong cảm biến.'),
    @('280 µs', 'Đọc GPIO32', 'Lấy mẫu đúng đỉnh output pulse được chỉ định.'),
    @('320 µs', 'Nhả LED input', 'Kết thúc độ rộng xung 0.32 ms.'),
    @('10 ms', 'Bắt đầu chu kỳ sau', 'Đảm bảo chu kỳ 10 ± 1 ms.')
  ) @(75, 150, 226) | Out-Null
  Add-Paragraph 'Firmware collects nine samples, rejects invalid/rail values, and uses a median filter. It converts calibrated ADC millivolts back through the divider, clamps negative density to zero, timestamps the update, and records sensorOnline. Repeated saturation, insufficient valid samples, non-finite voltage, or stale data creates an abnormal/offline state.' | Out-Null
  Add-CodeBlock @'
deltaV  = max(0, Vo - cleanAirVoltage)
density = max(0,
              deltaV / sensitivityVPer100Ug × 100 × calibrationFactor
              + densityOffset)

Nominal start values:
cleanAirVoltage = 0.60 V
sensitivityVPer100Ug = 0.50 V/(100 µg/m³)
calibrationFactor = 1.00
densityOffset = 0.00 µg/m³
'@ | Out-Null
  Add-Paragraph 'Mật độ bụi ước tính – chỉ dùng cho mục đích học tập và theo dõi xu hướng.' 'Normal' 8 | ForEach-Object { $_.Range.Font.Bold = $true; $_.Range.Font.Color = 192 }

  Add-Paragraph '3.10.1 Calibration / Hiệu chuẩn' 'Heading 2' 6 | Out-Null
  Add-Bullet 'Đặt cảm biến tránh ánh sáng trực tiếp, ngưng tụ và gió mạnh; chờ ổn định trước khi lấy mẫu.' | Out-Null
  Add-Bullet 'Thu ít nhất 100 lần cập nhật trong không khí sạch tương đối; dùng median/trimmed mean của Vo làm cleanAirVoltage.' | Out-Null
  Add-Bullet 'Đặt cảm biến và thiết bị tham chiếu cạnh nhau ở nhiều mức bụi; hồi quy tuyến tính để xác định calibrationFactor và densityOffset.' | Out-Null
  Add-Bullet 'Chỉ đặt calibrated=true sau khi có thiết bị tham chiếu; ghi ngày, vị trí, thiết bị và điều kiện hiệu chuẩn.' | Out-Null
  Add-Bullet 'Hiệu chuẩn lại khi thay vị trí, sau vệ sinh khu vực hoặc khi Voc trôi do bụi bám/lão hóa LED.' | Out-Null

  Add-Paragraph '3.10.2 Internal dust levels / Phân loại bụi nội bộ' 'Heading 2' 6 | Out-Null
  Add-ReportTable @('Mức', 'Ý nghĩa dự án', 'Ghi chú') @(
    @('CLEAN', 'Không khí tương đối sạch', 'Ngưỡng nội bộ, không phải AQI.'),
    @('MODERATE', 'Mật độ bụi trung bình', 'Theo dõi xu hướng và thông gió nếu tăng.'),
    @('HIGH', 'Mật độ bụi cao', 'Tạo cảnh báo sau transition/cooldown.'),
    @('DANGEROUS', 'Mật độ bụi rất cao', 'Cảnh báo nội bộ; kiểm tra cảm biến và môi trường ngay.')
  ) @(90, 180, 181) | Out-Null
  Add-Paragraph 'Threshold values are centralized, validated in ascending order, and can be changed through the configuration API. They are project warning thresholds, not an official environmental index.' | Out-Null

  Add-PageBreak
  Add-Paragraph '3.11 REST API and Data Provenance / API và nguồn dữ liệu' 'Heading 1' 8 | Out-Null
  Add-ReportTable @('Method', 'Endpoint', 'Chức năng / Function') @(
    @('GET', '/api/status', 'Latest temperature, light, dust, actuator, sensor and alert state.'),
    @('POST', '/api/sensor', 'Ingest temperature, light and optional dust; legacy payload remains valid.'),
    @('POST', '/api/readings', 'Backward-compatible alias for /api/sensor.'),
    @('GET', '/api/history', 'History and metrics for all sensors.'),
    @('GET', '/api/notifications', 'Notification Center with read/unread metadata.'),
    @('PATCH', '/api/notifications/:id/read', 'Mark one notification as read.'),
    @('GET', '/api/forecast', 'Short-term statistical trend and insufficient-data state.'),
    @('GET', '/api/reports?period=daily|weekly', 'Daily or weekly summary; format=csv exports CSV.'),
    @('GET', '/api/config', 'Read thresholds, cooldown and calibration settings.'),
    @('PATCH/POST', '/api/config', 'Update validated configuration; POST retained for compatibility.'),
    @('POST', '/api/mode', 'Set AUTO or MANUAL.'),
    @('POST', '/api/light', 'Set LED state and switch to MANUAL.')
  ) @(54, 150, 247) | Out-Null
  Add-CodeBlock @'
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
    "unit": "ug/m3",
    "level": "MODERATE",
    "sensorOnline": true,
    "calibrated": false,
    "lastUpdate": "2026-07-15T10:00:00.000Z"
  }
}
'@ | Out-Null
  Add-Paragraph 'The dashboard must display REAL, SIMULATED, CACHED, or DISCONNECTED explicitly. API failure never triggers unlabeled random values. Legacy top-level fields, aliases, control routes, and response codes remain available.' | Out-Null

  Add-Paragraph '3.12 Notifications, Forecasts, and Reports / Thông báo, dự báo và báo cáo' 'Heading 1' 8 | Out-Null
  Add-Paragraph 'Notification Center / Trung tâm thông báo' 'Heading 2' 5 | Out-Null
  Add-Paragraph 'Each notification contains an ID, type, title, message, measured value, threshold, timestamp, read state, and source. Events cover high temperature, low light, high dust, dust-sensor timeout, abnormal sensor values, ESP32/backend disconnection, and transitions to HIGH or DANGEROUS. A state-transition key and configurable cooldown prevent repeated alerts. Browser Notification API is optional; the in-page center remains functional when permission is denied.' | Out-Null
  Add-Paragraph 'Short-term forecast / Dự báo ngắn hạn' 'Heading 2' 5 | Out-Null
  Add-Paragraph 'Forecasts use moving averages, simple linear regression, and recent rate of change. Results include predicted temperature and dust, increasing/decreasing/stable trend, horizon, sample count, confidence, and an insufficient-data flag. This is statistical forecasting, not artificial intelligence.' | Out-Null
  Add-Paragraph 'Dự báo chỉ mang tính tham khảo, không thay thế thiết bị quan trắc môi trường chuyên dụng.' 'Normal' 8 | ForEach-Object { $_.Range.Font.Bold = $true; $_.Range.Font.Color = 192 }
  Add-Paragraph 'Daily and weekly reports / Báo cáo ngày và tuần' 'Heading 2' 5 | Out-Null
  Add-Bullet 'Min/max/average temperature, light level, and estimated dust density.' | Out-Null
  Add-Bullet 'Temperature/dust threshold event counts and the highest-dust time window.' | Out-Null
  Add-Bullet 'Notification count, LED on/off ratio, uptime, and sensor-disconnection count.' | Out-Null
  Add-Bullet 'Automatic comments and recommendations: ventilation, cleaning, reducing dust-generating activity, checking sensor placement, power, and wiring.' | Out-Null
  Add-Bullet 'CSV export is implemented; the service boundary allows PDF export to be added later.' | Out-Null

  Add-Paragraph '3.13 Dashboard and LCD / Dashboard và LCD' 'Heading 1' 8 | Out-Null
  Add-Paragraph 'The responsive dashboard retains dark mode, AUTO/MANUAL, LED control, and existing statistics. It adds estimated dust density, sensor voltage, dust level, per-sensor online state, three history charts, Notification Center, forecast, reports, CSV export, and configuration. It never presents disconnected or simulated data as live sensor data.' | Out-Null
  Add-Paragraph 'LCD1602 alternates three screens without calling lcd.clear() on every sensor update:' | Out-Null
  Add-ReportTable @('Màn hình', 'Dòng 1', 'Dòng 2') @(
    @('1', 'Temperature', 'Light level'),
    @('2', 'Dust density', 'CLEAN/MOD/HIGH/DANGER or DUST ERROR'),
    @('3', 'AUTO/MANUAL', 'LED ON/OFF')
  ) @(80, 180, 191) | Out-Null

  Add-PageBreak
  Add-Paragraph '3.14 Real-world Applications / Ứng dụng thực tế' 'Heading 1' 8 | Out-Null
  Add-Application '3.14.1 Smart home / Nhà ở thông minh' 'Hộ gia đình, người chăm sóc nhà.' 'Khó nhận biết phòng nóng, tối hoặc bụi tăng theo thời gian.' 'Nhiệt độ, mức sáng, mật độ bụi ước tính, trạng thái LED.' 'Bật/tắt đèn; đề xuất mở cửa, thông gió hoặc kiểm tra máy lọc.' 'Giám sát tập trung, tiết kiệm chiếu sáng và phản ứng sớm.' 'Dust chưa hiệu chuẩn chỉ phản ánh xu hướng, không thay máy đo chuyên dụng.'
  Add-Application '3.14.2 Classroom / Phòng học' 'Giảng viên, sinh viên, quản lý cơ sở vật chất.' 'Phòng nóng hoặc bụi cao làm giảm sự thoải mái học tập.' 'Nhiệt độ, ánh sáng, bụi, cảnh báo và lịch sử theo giờ học.' 'Bật đèn; mở cửa/tăng thông gió; vệ sinh phòng.' 'Tạo môi trường học tập dễ chịu và có dữ liệu minh họa IoT.' 'Một điểm đo không đại diện toàn bộ phòng; vị trí đặt ảnh hưởng kết quả.'
  Add-Application '3.14.3 Office / Văn phòng' 'Nhân viên và quản lý văn phòng.' 'Điều kiện làm việc xấu khó được phát hiện sớm.' 'Nhiệt độ, mức sáng, bụi, LED duty cycle và báo cáo tuần.' 'Điều chỉnh chiếu sáng; đề xuất thông gió/vệ sinh.' 'Hỗ trợ tiện nghi, theo dõi năng lượng và bảo trì.' 'Không dùng kết quả chưa hiệu chuẩn để kết luận tuân thủ sức khỏe nghề nghiệp.'
  Add-Application '3.14.4 Computer or equipment room / Phòng máy và thiết bị' 'Kỹ thuật viên, quản trị hệ thống.' 'Nhiệt và bụi có thể ảnh hưởng làm mát và tuổi thọ thiết bị.' 'Nhiệt độ, bụi, sensor uptime và disconnect events.' 'Cảnh báo kiểm tra quạt, lọc bụi, nguồn và dây cảm biến.' 'Hỗ trợ bảo trì phòng ngừa và nhận biết xu hướng bất thường.' 'Không thay cảm biến nhiệt/khói/an toàn công nghiệp được chứng nhận.'
  Add-Application '3.14.5 Warehouse / Nhà kho' 'Nhân viên kho và quản lý lưu trữ.' 'Nhiệt độ và bụi thay đổi theo vận hành, cửa kho và hàng hóa.' 'Nhiệt độ, bụi, thời điểm bụi cao nhất và báo cáo tuần.' 'Tăng thông gió, vệ sinh, kiểm tra vị trí cảm biến.' 'Có lịch sử phục vụ cải thiện quy trình lưu trữ.' 'Cần nhiều node cho kho lớn; cảm biến quang học chịu ảnh hưởng loại hạt.'
  Add-Application '3.14.6 Near construction or traffic / Gần công trình hoặc đường giao thông' 'Nhóm nghiên cứu, hộ dân, sinh viên.' 'Bụi thay đổi theo thời gian và hoạt động bên ngoài.' 'Xu hướng bụi, nhiệt độ, timestamp và forecast ngắn hạn.' 'Đóng/mở cửa hợp lý, hạn chế hoạt động tạo bụi, ghi nhận sự kiện.' 'Quan sát được thời điểm và xu hướng tăng giảm.' 'Không chống thời tiết; không phải trạm quan trắc quy chuẩn hoặc AQI.'
  Add-Application '3.14.7 Sensitive occupants / Nhà có trẻ nhỏ, người già hoặc người nhạy cảm' 'Gia đình và người chăm sóc.' 'Cần nhận biết sớm khi bụi trong phòng tăng.' 'Bụi ước tính, level, notification và sensor health.' 'Thông gió khi phù hợp; kiểm tra vệ sinh/máy lọc; giảm hoạt động tạo bụi.' 'Cảnh báo sớm và theo dõi thay đổi sau hành động.' 'Không dùng để chẩn đoán, điều trị hoặc đưa quyết định y tế.'
  Add-Application '3.14.8 Extended smart home / Smart Home mở rộng' 'Nhà phát triển IoT và nhóm đồ án.' 'Cần nền tảng để tự động hóa thêm thiết bị môi trường.' 'Ba cảm biến, alerts, mode, reports và API config.' 'Sau khi bổ sung relay/cách ly: quạt thông gió, máy lọc, HVAC.' 'Kiến trúc API cho phép mở rộng actuator và rule.' 'Tải AC cần relay, enclosure, cách ly và thiết kế an toàn riêng.'
  Add-Application '3.14.9 Education and research / Giáo dục và nghiên cứu' 'Sinh viên, giảng viên, phòng thí nghiệm học tập.' 'Cần minh họa chuỗi đầy đủ từ analog đến IoT dashboard.' 'Raw ADC, voltage, filtered density, history, notification và forecast.' 'Thay đổi ngưỡng/hệ số, chạy test và so sánh phương pháp lọc.' 'Minh họa ADC1/Wi-Fi, calibration, REST API, UI và kiểm thử.' 'Kết quả phụ thuộc prototype và không thay thiết bị nghiên cứu chuẩn hóa.'

  Add-PageBreak
  Add-Paragraph '3.15 Verification Plan and Results / Kế hoạch và kết quả kiểm thử' 'Heading 1' 8 | Out-Null
  Add-ReportTable @('Nhóm', 'Kiểm thử phần mềm/compile', 'Cần xác nhận phần cứng') @(
    @('Dust input', 'Valid, negative, ADC out of range, missing data, four levels.', 'Vo, divider ratio, saturation and unplug behavior.'),
    @('Notifications', 'Transition, cooldown, repeat after cooldown, mark-read.', 'Real disconnect and environmental transitions.'),
    @('Forecast', 'Enough/insufficient samples, trend, confidence, horizon.', 'Compare prediction with subsequent measurements.'),
    @('Reports', 'Daily/weekly aggregation, LED ratio, disconnect count, CSV.', 'Long-running uptime and real event counts.'),
    @('Configuration', 'Validation, persistence, migration and legacy API.', 'Apply thresholds/calibration and observe device behavior.'),
    @('Firmware', 'Arduino CLI compile for ESP32 target.', 'LCD address, Wi-Fi stability, timing and heap over long run.'),
    @('Electrical safety', 'Design review against datasheets.', 'VC830L measurement of GPIO32, SDA and SCL before connection.')
  ) @(90, 195, 166) | Out-Null
  Add-Paragraph 'Software tests and firmware compilation verify deterministic logic and build compatibility. They cannot verify sensor accuracy, actual wiring, optical contamination, airflow, I2C voltage levels, or long-term stability. These items remain mandatory hardware acceptance tests for the project group.' | Out-Null

  Add-Paragraph '3.16 Limitations and Future Development / Hạn chế và phát triển tiếp theo' 'Heading 1' 8 | Out-Null
  Add-Bullet 'GP2Y1014AU0F output depends on particle type, optical contamination, placement, airflow and calibration; reported density remains estimated until reference calibration.' | Out-Null
  Add-Bullet 'LDR level is relative and must not be presented as calibrated lux without a reference meter and fitted curve.' | Out-Null
  Add-Bullet 'A single node cannot represent a large room or warehouse; multi-node deployment and synchronized timestamps are future extensions.' | Out-Null
  Add-Bullet 'Future work may add authenticated API access, HTTPS through a gateway, database storage, PDF export, OTA firmware update, and relay-isolated ventilation/air-purifier control.' | Out-Null
  Add-Bullet 'Any mains-powered actuator requires independent electrical-safety design, isolation, enclosure and qualified supervision.' | Out-Null

  Add-Paragraph 'Technical references / Tài liệu kỹ thuật' 'Heading 2' 6 | Out-Null
  Add-Bullet 'Sharp Corporation, GP2Y1014AU0F specification sheet and Sharp dust-sensor product lineup.' | Out-Null
  Add-Bullet 'Sharp Corporation, GP2Y1010AU0F application note for the common 150 Ω/220 µF pulse-drive circuit and sampling guidance.' | Out-Null
  Add-Bullet 'Espressif Systems, ESP32-WROOM-32 datasheet and Arduino-ESP32 ADC documentation.' | Out-Null
  Add-Bullet 'Texas Instruments, LM35 Precision Centigrade Temperature Sensors datasheet.' | Out-Null

  foreach ($field in $doc.Fields) {
    try { [void]$field.Update() } catch { }
  }

  $doc.SaveAs2($resolvedOutput, $wdFormatDocumentDefault)
  $pages = $doc.ComputeStatistics(2)
  $paragraphs = $doc.Paragraphs.Count
  $tables = $doc.Tables.Count
  Write-Output "OUTPUT=$resolvedOutput"
  Write-Output "PAGES=$pages PARAGRAPHS=$paragraphs TABLES=$tables"
}
finally {
  if ($doc) { $doc.Close($false) }
  if ($word) { $word.Quit() }
  if ($doc) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc) }
  if ($word) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
