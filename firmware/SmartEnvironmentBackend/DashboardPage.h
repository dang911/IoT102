#pragma once

#include <Arduino.h>

const char DASHBOARD_HTML[] PROGMEM = R"HTML(
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Smart Environment</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#eef3f8;color:#172033;font-family:Arial,sans-serif}
    main{width:min(760px,calc(100% - 28px));margin:28px auto}h1{margin-bottom:6px}
    .sub{color:#667085;margin:0 0 20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .card{background:#fff;border:1px solid #d9e2ec;border-radius:14px;padding:18px;box-shadow:0 8px 24px #1f293712}
    .wide{grid-column:1/-1}.label{color:#667085;font-size:13px;text-transform:uppercase;font-weight:bold}
    .value{font-size:36px;font-weight:bold;margin:10px 0}.status{color:#15803d}
    button{padding:11px 16px;margin:8px 5px 0 0;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:bold}
    #error{color:#dc2626;margin-top:12px}@media(max-width:600px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}
  </style>
</head>
<body>
<main>
  <h1>Smart Environment</h1>
  <p class="sub">ESP32 giám sát nhiệt độ, ánh sáng và điều khiển đèn</p>
  <div class="grid">
    <section class="card"><div class="label">Nhiệt độ</div><div id="temperature" class="value">--.- °C</div><div id="temperatureStatus">--</div></section>
    <section class="card"><div class="label">Ánh sáng</div><div id="light" class="value">---</div><div id="lightStatus">--</div></section>
    <section class="card wide">
      <div class="label">Điều khiển</div>
      <p>Chế độ: <strong id="mode">--</strong> · LED: <strong id="led">--</strong></p>
      <button onclick="command('/api/mode',{mode:'AUTO'})">AUTO</button>
      <button onclick="command('/api/mode',{mode:'MANUAL'})">MANUAL</button>
      <button onclick="command('/api/light',{status:'ON'})">BẬT LED</button>
      <button onclick="command('/api/light',{status:'OFF'})">TẮT LED</button>
      <div id="error"></div>
    </section>
    <section class="card wide">Kết nối: <strong id="connection">Đang kết nối...</strong></section>
  </div>
</main>
<script>
const byId=id=>document.getElementById(id);
function render(data){
  byId('temperature').textContent=Number(data.temperature).toFixed(1)+' °C';
  byId('temperatureStatus').textContent=data.temperatureStatus||'--';
  byId('light').textContent=data.lightLevel+' / 1000';
  byId('lightStatus').textContent=data.lightEnvironment||'--';
  byId('mode').textContent=data.mode;
  byId('led').textContent=data.lightStatus?'ON':'OFF';
  byId('connection').textContent='ESP32 ONLINE';
  byId('connection').className='status';
  byId('error').textContent='';
}
async function refresh(){
  try{
    const response=await fetch('/api/status');
    if(!response.ok)throw new Error('HTTP '+response.status);
    render(await response.json());
  }catch(error){
    byId('connection').textContent='MẤT KẾT NỐI';
    byId('error').textContent=error.message;
  }
}
async function command(path,body){
  try{
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Lệnh thất bại');
    render(data);
  }catch(error){byId('error').textContent=error.message}
}
refresh();
setInterval(refresh,2000);
</script>
</body>
</html>
)HTML";
