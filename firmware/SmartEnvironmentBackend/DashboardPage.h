#pragma once

#include <Arduino.h>

const char DASHBOARD_HTML[] PROGMEM = R"HTML(
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Smart Environment Dashboard</title>
  <style>
    :root{color-scheme:light dark;--bg:#eef3f8;--card:#fff;--text:#172033;--muted:#667085;--line:#d9e2ec;--blue:#2563eb;--green:#15803d;--amber:#b45309;--red:#dc2626;--shadow:0 12px 30px #1f293714}
    @media(prefers-color-scheme:dark){:root{--bg:#0f172a;--card:#172033;--text:#e5edf7;--muted:#a8b3c3;--line:#334155;--blue:#60a5fa;--green:#4ade80;--amber:#fbbf24;--red:#f87171;--shadow:none}}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,Segoe UI,sans-serif}.shell{width:min(1120px,calc(100% - 28px));margin:auto;padding:24px 0}header{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:18px}h1{font-size:25px;margin:0 0 5px}p{margin:0;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}.card{grid-column:span 4;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:17px;box-shadow:var(--shadow)}.wide{grid-column:span 8}.full{grid-column:1/-1}.title{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:750}.value{font-size:37px;font-weight:800;margin:9px 0}.meta{display:flex;flex-wrap:wrap;gap:8px;color:var(--muted);font-size:13px}.badge{display:inline-flex;align-items:center;padding:5px 9px;border:1px solid var(--line);border-radius:999px;font-size:12px;font-weight:750}.ok{color:var(--green)}.warn{color:var(--amber)}.bad{color:var(--red)}.controls{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}button{min-height:41px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--text);font-weight:750;cursor:pointer}button.active{background:var(--blue);border-color:var(--blue);color:#fff}button:disabled{opacity:.55;cursor:wait}.notice{border-left:4px solid var(--amber);padding:12px 14px;background:color-mix(in srgb,var(--amber) 9%,var(--card));font-size:14px;color:var(--text)}ul{margin:10px 0 0;padding-left:20px;color:var(--muted)}#error{min-height:20px;color:var(--red);font-size:13px;margin-top:10px}@media(max-width:760px){header{align-items:flex-start;flex-direction:column}.card,.wide{grid-column:1/-1}.value{font-size:32px}}
  </style>
</head>
<body>
<div class="shell">
  <header>
    <div><h1>Smart Environment</h1><p>ESP32 giám sát môi trường và điều khiển chiếu sáng</p></div>
    <div><span id="connection" class="badge warn">Đang kết nối</span> <span id="source" class="badge">Nguồn: --</span></div>
  </header>
  <main class="grid">
    <section class="card"><div class="title">Nhiệt độ</div><div id="temperature" class="value">--.- °C</div><div class="meta"><span id="temperature-online" class="badge">LM35 --</span><span id="temperature-status">--</span></div></section>
    <section class="card"><div class="title">Ánh sáng</div><div id="light" class="value">---</div><div class="meta"><span id="light-online" class="badge">LDR --</span><span id="light-environment">--</span></div></section>
    <section class="card"><div class="title">Mật độ bụi ước tính</div><div id="dust" class="value">-- µg/m³</div><div class="meta"><span id="dust-online" class="badge">GP2Y --</span><span id="dust-level">--</span></div></section>
    <section class="card wide"><div class="title">GP2Y1014AU0F</div><div class="meta" style="margin-top:12px"><span>Vo cảm biến: <strong id="dust-voltage">-- V</strong></span><span>ADC: <strong id="dust-adc">--</strong></span><span>Hiệu chuẩn: <strong id="calibrated">--</strong></span><span>Cập nhật: <strong id="dust-updated">--</strong></span></div><ul id="alerts"><li>Đang chờ dữ liệu cảm biến.</li></ul></section>
    <section class="card"><div class="title">Điều khiển</div><div class="meta" style="margin-top:10px">Mode: <strong id="mode">--</strong> · LED: <strong id="led">--</strong></div><div class="controls"><button data-mode="AUTO">AUTO</button><button data-mode="MANUAL">MANUAL</button><button data-light="ON">LED ON</button><button data-light="OFF">LED OFF</button></div><div id="error"></div></section>
    <section class="card full notice">Mật độ bụi ước tính – chỉ dùng cho mục đích học tập và theo dõi xu hướng. Đây không phải AQI chính thức và cần hiệu chuẩn bằng thiết bị tham chiếu.</section>
  </main>
</div>
<script>
const $=id=>document.getElementById(id);let busy=false;
function badge(id,online,label){const e=$(id);e.textContent=label+' '+(online?'ONLINE':'OFFLINE');e.className='badge '+(online?'ok':'bad')}
function active(selector,value){document.querySelectorAll(selector).forEach(b=>b.classList.toggle('active',b.dataset.mode===value||b.dataset.light===value))}
async function request(path,options={}){const c=new AbortController(),t=setTimeout(()=>c.abort(),3500);try{const r=await fetch(path,{...options,signal:c.signal,headers:{'Content-Type':'application/json',...(options.headers||{})}}),x=await r.text(),d=x?JSON.parse(x):{};if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}finally{clearTimeout(t)}}
function render(d){const dust=d.dust||{},s=d.sensors||{},a=d.alerts||{};$('temperature').textContent=Number(d.temperature).toFixed(1)+' °C';$('light').textContent=String(d.lightLevel)+' / 1000';$('dust').textContent=Number(dust.density||0).toFixed(1)+' µg/m³';$('temperature-status').textContent=d.temperatureStatus||d.status?.temperature||'--';$('light-environment').textContent=d.lightEnvironment||d.status?.environment||'--';$('dust-level').textContent=dust.level||'--';$('dust-voltage').textContent=Number(dust.voltage||0).toFixed(3)+' V';$('dust-adc').textContent=String(dust.rawAdc??'--');$('calibrated').textContent=dust.calibrated?'ĐÃ HIỆU CHUẨN':'CHƯA HIỆU CHUẨN';$('dust-updated').textContent=dust.lastUpdate||('uptime '+String(dust.lastUpdateMs||0)+' ms');$('mode').textContent=d.mode;$('led').textContent=d.lightStatus?'ON':'OFF';$('source').textContent='Nguồn: '+(d.dataSource||'REAL');badge('temperature-online',s.temperature?.online!==false,'LM35');badge('light-online',s.light?.online!==false,'LDR');badge('dust-online',!!dust.sensorOnline,'GP2Y');active('[data-mode]',d.mode);active('[data-light]',d.lightStatus?'ON':'OFF');const items=[];if(a.temperatureHigh)items.push('Nhiệt độ vượt ngưỡng.');if(a.lowLight)items.push('Ánh sáng dưới ngưỡng.');if(a.dustHigh)items.push('Mật độ bụi vượt ngưỡng cảnh báo nội bộ.');if(a.dustSensorOffline)items.push('Cảm biến bụi mất dữ liệu hoặc trả dữ liệu bất thường.');$('alerts').innerHTML=(items.length?items:['Hệ thống chưa phát hiện cảnh báo.']).map(x=>'<li>'+x+'</li>').join('');$('connection').textContent='ESP32 ONLINE';$('connection').className='badge ok';$('error').textContent=''}
async function refresh(){if(busy)return;try{render(await request('/api/status'))}catch(e){$('connection').textContent='MẤT KẾT NỐI';$('connection').className='badge bad';$('error').textContent=e.message}}
async function command(path,body){busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{render(await request(path,{method:'POST',body:JSON.stringify(body)}))}catch(e){$('error').textContent=e.message}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>command('/api/mode',{mode:b.dataset.mode}));document.querySelectorAll('[data-light]').forEach(b=>b.onclick=()=>command('/api/light',{status:b.dataset.light}));refresh();setInterval(refresh,2000);
</script>
</body>
</html>
)HTML";

