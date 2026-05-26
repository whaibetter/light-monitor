const http = require('http');
const os = require('os');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 9191;

let prevNet = null;
let prevTime = Date.now();

function getNetworkTraffic() {
  try {
    const raw = execSync(
      'powershell -NoProfile -Command "Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json"',
      { encoding: 'utf8', timeout: 5000 }
    );
    let adapters = JSON.parse(raw);
    if (!Array.isArray(adapters)) adapters = [adapters];
    let rxTotal = 0, txTotal = 0;
    for (const a of adapters) {
      if (a.ReceivedBytes != null) rxTotal += Number(a.ReceivedBytes);
      if (a.SentBytes != null) txTotal += Number(a.SentBytes);
    }
    return { rx: rxTotal, tx: txTotal };
  } catch {
    return prevNet || { rx: 0, tx: 0 };
  }
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

function formatSpeed(bps) {
  if (bps < 1024) return bps.toFixed(0) + ' B/s';
  if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KB/s';
  if (bps < 1073741824) return (bps / 1048576).toFixed(2) + ' MB/s';
  return (bps / 1073741824).toFixed(2) + ' GB/s';
}

function getTopProcesses() {
  try {
    const isWin = process.platform === 'win32';
    if (isWin) {
      const { writeFileSync, unlinkSync } = require('fs');
      const tmpFile = require('path').join(require('os').tmpdir(), 'frp_procs.ps1');
      writeFileSync(tmpFile, "Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 Name,CPU,Id,@{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json");
      const raw = execSync(`powershell -NoProfile -File "${tmpFile}"`, { encoding: 'utf8', timeout: 5000 });
      try { unlinkSync(tmpFile); } catch {}
      let procs = JSON.parse(raw);
      if (!Array.isArray(procs)) procs = [procs];
      return procs.map(p => ({
        name: p.Name || '?',
        pid: p.Id || 0,
        cpu: (p.CPU || 0).toFixed(1),
        mem: p.MemMB || 0
      }));
    } else {
      const raw = execSync('ps aux --sort=-%cpu | head -6 | tail -5', { encoding: 'utf8', timeout: 5000 });
      return raw.trim().split('\n').map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          name: parts[10] || '?',
          pid: parseInt(parts[1]) || 0,
          cpu: parts[2] || '0',
          mem: Math.round((parseFloat(parts[5]) || 0) / 1024)
        };
      });
    }
  } catch {
    return [];
  }
}

function getSystemInfo() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  });
  const cpuUsage = ((1 - totalIdle / totalTick) * 100).toFixed(1);

  const uptime = os.uptime();
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const mins = Math.floor((uptime % 3600) / 60);

  const now = Date.now();
  const net = getNetworkTraffic();
  let rxSpeed = 0, txSpeed = 0;
  if (prevNet) {
    const dt = (now - prevTime) / 1000;
    if (dt > 0) {
      rxSpeed = Math.max(0, (net.rx - prevNet.rx) / dt);
      txSpeed = Math.max(0, (net.tx - prevNet.tx) / dt);
    }
  }
  prevNet = net;
  prevTime = now;

  const interfaces = os.networkInterfaces();
  const netInfo = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
    if (ipv4) netInfo.push({ name, address: ipv4.address });
  }

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    osType: os.type(),
    osRelease: os.release(),
    cpuModel: (cpus[0]?.model || 'N/A').replace(/\s+/g, ' ').trim(),
    cpuCores: cpus.length,
    cpuUsage,
    totalMem: (totalMem / 1073741824).toFixed(2),
    usedMem: (usedMem / 1073741824).toFixed(2),
    freeMem: (freeMem / 1073741824).toFixed(2),
    memUsage: ((usedMem / totalMem) * 100).toFixed(1),
    uptime: `${days}d ${hours}h ${mins}m`,
    nodeVersion: process.version,
    timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    rxTotal: formatBytes(net.rx),
    txTotal: formatBytes(net.tx),
    rxSpeed: formatSpeed(rxSpeed),
    txSpeed: formatSpeed(txSpeed),
    rxSpeedRaw: rxSpeed,
    txSpeedRaw: txSpeed,
    netInterfaces: netInfo,
    topProcesses: getTopProcesses()
  };
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="cyber">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<title>FRP NODE // MONITOR</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@300;400;600;700&family=Space+Mono:wght@400;700&family=Outfit:wght@300;400;600;800&family=Fira+Code:wght@300;400;500;700&display=swap');

/* ═══════════════════════════════════════
   THEME: CYBER (Default - Neon Terminal)
   ═══════════════════════════════════════ */
[data-theme="cyber"] {
  --font-display: 'Chakra Petch', sans-serif;
  --font-mono: 'Space Mono', monospace;
  --accent: #00f0ff;
  --accent2: #ff00aa;
  --accent3: #ffc800;
  --good: #00ff88;
  --bad: #ff3366;
  --bg: #06080f;
  --bg2: #0c1018;
  --bg3: #101820;
  --border: #1a2030;
  --text: #c8d0e0;
  --text2: #5a6580;
  --glow: 0 0 20px;
  --radius: 6px;
  --scanlines: 1;
  --grid-bg: 1;
}

/* ═══════════════════════════════════════
   THEME: BRUTAL (Industrial Raw)
   ═══════════════════════════════════════ */
[data-theme="brutal"] {
  --font-display: 'Outfit', sans-serif;
  --font-mono: 'Fira Code', monospace;
  --accent: #ff4d00;
  --accent2: #00ffaa;
  --accent3: #ffee00;
  --good: #00ffaa;
  --bad: #ff2200;
  --bg: #111110;
  --bg2: #1a1918;
  --bg3: #222120;
  --border: #333230;
  --text: #e8e4dc;
  --text2: #706b60;
  --glow: none;
  --radius: 0px;
  --scanlines: 0;
  --grid-bg: 0;
}

/* ═══════════════════════════════════════
   THEME: AURORA (Ethereal Gradient)
   ═══════════════════════════════════════ */
[data-theme="aurora"] {
  --font-display: 'Outfit', sans-serif;
  --font-mono: 'Fira Code', monospace;
  --accent: #7c6aef;
  --accent2: #f472b6;
  --accent3: #34d399;
  --good: #34d399;
  --bad: #f87171;
  --bg: #0f0e17;
  --bg2: #161425;
  --bg3: #1d1a30;
  --border: #2a2640;
  --text: #d4d0e8;
  --text2: #6b6490;
  --glow: 0 0 30px;
  --radius: 12px;
  --scanlines: 0;
  --grid-bg: 0;
}

/* ═══════════════════════════════════════
   THEME: PHOSPHOR (Retro CRT Terminal)
   ═══════════════════════════════════════ */
[data-theme="phosphor"] {
  --font-display: 'Fira Code', monospace;
  --font-mono: 'Fira Code', monospace;
  --accent: #33ff33;
  --accent2: #00cc44;
  --accent3: #66ff66;
  --good: #33ff33;
  --bad: #ff3333;
  --bg: #0a0f0a;
  --bg2: #0f1a0f;
  --bg3: #142214;
  --border: #1a3a1a;
  --text: #88cc88;
  --text2: #336633;
  --glow: 0 0 10px;
  --radius: 2px;
  --scanlines: 1;
  --grid-bg: 0;
}

/* ═══════════════════════════════════════
   BASE STYLES
   ═══════════════════════════════════════ */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font-mono);
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  overflow-x: hidden;
  transition: background 0.6s, color 0.4s;
}

/* Scanlines - conditional */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg, transparent, transparent 2px,
    rgba(255,255,255,0.012) 2px, rgba(255,255,255,0.012) 4px
  );
  pointer-events: none;
  z-index: 1000;
  opacity: var(--scanlines);
  transition: opacity 0.6s;
}

/* Grid BG - conditional */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px),
    linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: 60px 60px;
  pointer-events: none;
  z-index: -1;
  opacity: var(--grid-bg);
  transition: opacity 0.6s;
}

/* Aurora bg effect */
[data-theme="aurora"] body::after {
  content: '';
  position: fixed;
  inset: 0;
  opacity: 1;
  background:
    radial-gradient(ellipse 80% 60% at 20% 10%, rgba(124,106,239,0.12) 0%, transparent 60%),
    radial-gradient(ellipse 60% 50% at 80% 90%, rgba(244,114,182,0.1) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 50% 50%, rgba(52,211,153,0.06) 0%, transparent 60%);
  z-index: -1;
  animation: auroraShift 12s ease-in-out infinite alternate;
}

@keyframes auroraShift {
  0% { filter: hue-rotate(0deg); }
  100% { filter: hue-rotate(20deg); }
}

/* Phosphor CRT effect */
[data-theme="phosphor"] body {
  text-shadow: 0 0 4px rgba(51,255,51,0.4);
}

[data-theme="phosphor"] .card:hover {
  text-shadow: 0 0 8px rgba(51,255,51,0.6);
}

.wrap {
  max-width: 1100px;
  margin: 0 auto;
  padding: 28px 20px 60px;
}

/* ── Header ── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
  transition: border-color 0.6s;
}

.logo {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 26px;
  letter-spacing: 3px;
  color: var(--accent);
  line-height: 1;
  transition: color 0.6s;
}

[data-theme="cyber"] .logo {
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.logo-sub {
  font-size: 10px;
  color: var(--text2);
  letter-spacing: 5px;
  text-transform: uppercase;
  margin-top: 4px;
  transition: color 0.6s;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* ── Status Pill (P2: breathing animation) ── */
.status-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 14px;
  background: rgba(0,255,136,0.08);
  border: 1px solid rgba(0,255,136,0.2);
  border-radius: 20px;
  font-size: 10px;
  color: var(--good);
  letter-spacing: 1.5px;
  font-family: var(--font-mono);
  transition: background 0.6s, border-color 0.6s, color 0.6s;
}

.status-pill.loading {
  background: rgba(255,200,0,0.08);
  border-color: rgba(255,200,0,0.2);
  color: var(--accent3);
}

.status-pill.loading .status-dot {
  background: var(--accent3);
  box-shadow: none;
  animation: loadSpin 1s linear infinite;
}

.status-pill.error {
  background: rgba(255,51,102,0.08);
  border-color: rgba(255,51,102,0.3);
  color: var(--bad);
}

.status-pill.error .status-dot {
  background: var(--bad);
  box-shadow: none;
  animation: none;
}

/* ── Error Banner ── */
.error-banner {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  margin-bottom: 16px;
  background: rgba(255,51,102,0.08);
  border: 1px solid rgba(255,51,102,0.25);
  border-radius: var(--radius);
  font-size: 11px;
  color: var(--bad);
  font-family: var(--font-mono);
  letter-spacing: 0.5px;
}

.error-banner.show { display: flex; }

@keyframes loadSpin {
  0% { transform: rotate(0deg); border-radius: 50%; }
  25% { border-radius: 50% 50% 50% 20%; }
  50% { border-radius: 50%; }
  75% { border-radius: 20% 50% 50% 50%; }
  100% { transform: rotate(360deg); border-radius: 50%; }
}

.status-dot-wrap {
  position: relative;
  width: 8px;
  height: 8px;
}

.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--good);
  box-shadow: var(--glow) var(--good);
  position: relative;
  z-index: 1;
  transition: background 0.6s, box-shadow 0.6s;
}

.status-dot-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 1.5px solid var(--good);
  opacity: 0;
  animation: dotRing 2.4s ease-out infinite;
  transition: border-color 0.6s;
}

.status-dot-ring:nth-child(2) { animation-delay: 0.8s; }
.status-dot-ring:nth-child(3) { animation-delay: 1.6s; }

@keyframes dotRing {
  0% { transform: scale(0.6); opacity: 0.7; }
  100% { transform: scale(2.2); opacity: 0; }
}

.status-pulse {
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  background: var(--good);
  animation: dotPulse 2s ease-in-out infinite;
  transition: background 0.6s;
}

@keyframes dotPulse {
  0%,100% { opacity: 0.15; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(1.4); }
}

/* ── Theme Switcher ── */
.theme-switcher {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: background 0.6s, border-color 0.6s;
}

.theme-btn {
  width: 28px; height: 28px;
  border: none;
  border-radius: calc(var(--radius) - 2px);
  cursor: pointer;
  position: relative;
  transition: all 0.3s;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text2);
}

.theme-btn:hover { color: var(--text); transform: scale(1.1); }
.theme-btn.active {
  background: var(--accent);
  color: var(--bg);
  box-shadow: var(--glow) color-mix(in srgb, var(--accent) 40%, transparent);
  transition: background 0.4s, box-shadow 0.4s, color 0.2s;
}

/* ── Info Bar ── */
.info-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  font-size: 10px;
  color: var(--text2);
  letter-spacing: 1px;
  font-family: var(--font-mono);
  transition: color 0.6s;
}

.info-bar .val { color: var(--accent); transition: color 0.6s; }

/* ── Grid ── */
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
.grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 12px; }

/* ── Card (P1: micro-interactions) ── */
.card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.35s, background 0.35s, box-shadow 0.35s, transform 0.35s;
}

.card:hover {
  border-color: var(--accent);
  background: var(--bg3);
  box-shadow: var(--glow) color-mix(in srgb, var(--accent) 15%, transparent),
              0 8px 32px rgba(0,0,0,0.3);
  transform: translateY(-3px);
}

.card:hover .card-body {
  transform: scale(1.01);
}

.card-body {
  transition: transform 0.35s;
}

.card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0;
  transition: opacity 0.35s;
}

.card:hover::before { opacity: 0.8; }

/* Glow border overlay on hover */
.card::after {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: var(--radius);
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent), transparent, color-mix(in srgb, var(--accent2) 15%, transparent));
  opacity: 0;
  transition: opacity 0.35s;
  pointer-events: none;
  z-index: -1;
}

.card:hover::after { opacity: 1; }

.card-tag {
  font-size: 9px;
  color: var(--text2);
  letter-spacing: 2.5px;
  text-transform: uppercase;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  transition: color 0.6s;
}

.card-tag .dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: var(--glow) color-mix(in srgb, var(--accent) 50%, transparent);
  transition: background 0.6s, box-shadow 0.6s;
}

.card-num {
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 700;
  color: #fff;
  line-height: 1;
  transition: color 0.5s;
}

.card-num.sm {
  font-size: 18px;
  font-family: var(--font-mono);
  font-weight: 400;
}

.card-unit {
  font-size: 12px;
  color: var(--text2);
  margin-left: 3px;
  font-family: var(--font-mono);
  transition: color 0.6s;
}

.card-desc {
  font-size: 11px;
  color: var(--text2);
  margin-top: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.6s;
}

/* ── Ring Progress (P0) ── */
.ring-wrap {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 6px;
}

.ring-svg {
  width: 80px;
  height: 80px;
  flex-shrink: 0;
  transform: rotate(-90deg);
}

.ring-bg {
  fill: none;
  stroke: rgba(255,255,255,0.05);
  stroke-width: 6;
}

.ring-fg {
  fill: none;
  stroke-width: 6;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.6s;
}

.ring-pct {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  fill: #fff;
  text-anchor: middle;
  dominant-baseline: central;
  transform: rotate(90deg);
  transform-origin: center;
  transition: fill 0.5s;
}

.ring-info {
  flex: 1;
  min-width: 0;
}

.ring-info .card-num {
  font-size: 28px;
}

/* ── Warning Color Gradient (P0) ── */
.warn-good { color: var(--good) !important; }
.warn-mid { color: var(--accent3) !important; }
.warn-bad { color: var(--bad) !important; }

.ring-fg.warn-good { stroke: var(--good); }
.ring-fg.warn-mid { stroke: var(--accent3); }
.ring-fg.warn-bad { stroke: var(--bad); }

.bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1), background 0.6s;
}

.bar-cpu { background: linear-gradient(90deg, var(--accent), var(--accent2)); }
.bar-mem { background: linear-gradient(90deg, var(--accent3), var(--accent)); }

/* ── Traffic ── */
.traffic-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 22px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.35s, background 0.35s, box-shadow 0.35s, transform 0.35s;
}

.traffic-card:hover {
  border-color: var(--accent2);
  background: var(--bg3);
  box-shadow: var(--glow) color-mix(in srgb, var(--accent2) 15%, transparent),
              0 8px 32px rgba(0,0,0,0.3);
  transform: translateY(-3px);
}

.traffic-label {
  font-size: 9px;
  color: var(--text2);
  letter-spacing: 2.5px;
  text-transform: uppercase;
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  transition: color 0.6s;
}

.traffic-label .arrow { color: var(--good); font-size: 12px; transition: color 0.6s; }

.traffic-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.t-block {}

.t-dir {
  font-size: 9px;
  letter-spacing: 2px;
  margin-bottom: 6px;
  font-family: var(--font-mono);
  transition: color 0.6s;
}

.t-dir.rx { color: var(--good); }
.t-dir.tx { color: var(--accent2); }

.t-speed {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  line-height: 1.2;
}

.t-total {
  font-size: 10px;
  color: var(--text2);
  margin-top: 4px;
  font-family: var(--font-mono);
  transition: color 0.6s;
}

.spark-wrap {
  margin-top: 14px;
  height: 48px;
  position: relative;
}

.spark-wrap canvas { width: 100%; height: 100%; }

/* ── Traffic Stats Panel (P1) ── */
.traffic-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(255,255,255,0.04);
}

.stat-item {
  text-align: center;
}

.stat-label {
  font-size: 8px;
  color: var(--text2);
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin-bottom: 4px;
  font-family: var(--font-mono);
  transition: color 0.6s;
}

.stat-val {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  transition: color 0.6s;
}

.stat-val.rx-color { color: var(--good); }
.stat-val.tx-color { color: var(--accent2); }

/* ── Info Table ── */
.info-tbl { width: 100%; }

.info-tbl .row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 0;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  font-size: 11px;
}

.info-tbl .row:last-child { border: none; }

.info-tbl .k {
  color: var(--text2);
  letter-spacing: 1px;
  transition: color 0.6s;
}

.info-tbl .v { color: var(--text); text-align: right; transition: color 0.6s; }

/* ── Network Tags ── */
.net-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
  border-radius: var(--radius);
  font-size: 10px;
  margin: 3px 4px 3px 0;
  color: var(--accent);
  font-family: var(--font-mono);
  transition: background 0.6s, border-color 0.6s, color 0.6s;
}

.net-tag .addr { color: var(--text2); transition: color 0.6s; }

/* ── Footer ── */
.footer {
  text-align: center;
  margin-top: 36px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
  font-size: 9px;
  color: var(--text2);
  letter-spacing: 3px;
  font-family: var(--font-mono);
  transition: border-color 0.6s, color 0.6s;
}

.footer a {
  color: var(--accent);
  text-decoration: none;
  transition: color 0.2s;
}

.footer a:hover { color: var(--accent2); }

/* ── Process Table ── */
.proc-table { width: 100%; }

.proc-header {
  display: flex;
  padding: 0 0 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 4px;
}

.proc-col {
  font-size: 8px;
  color: var(--text2);
  letter-spacing: 1.5px;
  text-transform: uppercase;
  font-family: var(--font-mono);
}

.proc-name { flex: 3; }
.proc-pid { flex: 1; text-align: right; }
.proc-cpu { flex: 1; text-align: right; }
.proc-mem { flex: 1; text-align: right; }

.proc-row {
  display: flex;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid rgba(255,255,255,0.02);
  font-size: 11px;
  transition: background 0.2s;
}

.proc-row:hover { background: rgba(255,255,255,0.02); }
.proc-row:last-child { border: none; }

.proc-row .proc-name {
  flex: 3;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.proc-row .proc-pid { flex: 1; text-align: right; color: var(--text2); }
.proc-row .proc-cpu { flex: 1; text-align: right; color: var(--accent); font-weight: 600; }
.proc-row .proc-mem { flex: 1; text-align: right; color: var(--accent2); font-weight: 600; }

.proc-bar-wrap {
  flex: 3;
  display: flex;
  align-items: center;
  gap: 8px;
}

.proc-bar-track {
  flex: 1;
  height: 3px;
  background: rgba(255,255,255,0.04);
  border-radius: 2px;
  overflow: hidden;
}

.proc-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

/* ── Responsive ── */
@media (max-width: 900px) {
  .grid4 { grid-template-columns: repeat(2, 1fr); }
  .traffic-row { grid-template-columns: 1fr; gap: 12px; }
  .traffic-stats { grid-template-columns: repeat(2, 1fr); }
  .ring-wrap { flex-direction: column; align-items: flex-start; gap: 10px; }
  .ring-svg { width: 64px; height: 64px; }
}

@media (max-width: 520px) {
  .grid4 { grid-template-columns: 1fr; }
  .grid2 { grid-template-columns: 1fr; }
  .header { flex-direction: column; gap: 14px; align-items: flex-start; }
  .header-right { width: 100%; justify-content: space-between; }
  .logo { font-size: 20px; }
  .card-num { font-size: 24px; }
  .t-speed { font-size: 20px; }
  .traffic-stats { grid-template-columns: repeat(2, 1fr); }
}

/* ── Entrance ── */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

.card, .traffic-card {
  animation: fadeUp 0.45s ease-out both;
}

.grid4 .card:nth-child(1) { animation-delay: 0.04s; }
.grid4 .card:nth-child(2) { animation-delay: 0.08s; }
.grid4 .card:nth-child(3) { animation-delay: 0.12s; }
.grid4 .card:nth-child(4) { animation-delay: 0.16s; }

/* ── Number Count-Up (P0) ── */
.count-up {
  display: inline-block;
  will-change: transform;
}

/* ── Brutal theme overrides ── */
[data-theme="brutal"] .card { border-width: 2px; }
[data-theme="brutal"] .traffic-card { border-width: 2px; }
[data-theme="brutal"] .card::before { height: 3px; }
[data-theme="brutal"] .status-pill { border-radius: 0; }

/* ── Phosphor CRT curvature ── */
[data-theme="phosphor"] .wrap {
  max-width: 1000px;
  position: relative;
}
</style>
</head>
<body>

<div class="wrap">
  <div class="header">
    <div>
      <div class="logo">FRP NODE</div>
      <div class="logo-sub">system monitor</div>
    </div>
    <div class="header-right">
      <div class="status-pill loading" id="statusPill">
        <div class="status-dot-wrap">
          <div class="status-dot-ring"></div>
          <div class="status-dot-ring"></div>
          <div class="status-dot-ring"></div>
          <div class="status-pulse"></div>
          <div class="status-dot"></div>
        </div>
        <span id="statusText">LOADING</span>
      </div>
      <div class="theme-switcher">
        <button class="theme-btn active" data-theme="cyber" title="Cyberpunk">&#9670;</button>
        <button class="theme-btn" data-theme="brutal" title="Brutalist">&#9632;</button>
        <button class="theme-btn" data-theme="aurora" title="Aurora">&#9674;</button>
        <button class="theme-btn" data-theme="phosphor" title="Phosphor CRT">&#9679;</button>
      </div>
    </div>
  </div>

  <div class="info-bar">
    <span>SYNC <span class="val" id="ts">--</span></span>
    <span>HOST <span class="val" id="hostname">--</span></span>
  </div>

  <div class="error-banner" id="errorBanner">
    &#9888; <span id="errorMsg">无法连接到服务器，数据加载失败</span>
  </div>

  <div class="grid4">
    <div class="card">
      <div class="card-body">
        <div class="card-tag"><span class="dot"></span>CPU USAGE</div>
        <div class="ring-wrap">
          <svg class="ring-svg" viewBox="0 0 80 80">
            <circle class="ring-bg" cx="40" cy="40" r="34"></circle>
            <circle class="ring-fg" id="cpuRing" cx="40" cy="40" r="34"
              stroke-dasharray="213.628" stroke-dashoffset="213.628"></circle>
            <text class="ring-pct" id="cpuRingPct" x="40" y="40">0%</text>
          </svg>
          <div class="ring-info">
            <div><span class="card-num count-up" id="cpuVal" data-val="0">0</span><span class="card-unit">%</span></div>
            <div class="card-desc" id="cpuModel">--</div>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="card-tag"><span class="dot"></span>MEMORY</div>
        <div class="ring-wrap">
          <svg class="ring-svg" viewBox="0 0 80 80">
            <circle class="ring-bg" cx="40" cy="40" r="34"></circle>
            <circle class="ring-fg" id="memRing" cx="40" cy="40" r="34"
              stroke-dasharray="213.628" stroke-dashoffset="213.628"></circle>
            <text class="ring-pct" id="memRingPct" x="40" y="40">0%</text>
          </svg>
          <div class="ring-info">
            <div><span class="card-num count-up" id="memVal" data-val="0">0</span><span class="card-unit">%</span></div>
            <div class="card-desc" id="memSub">--</div>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="card-tag"><span class="dot"></span>UPTIME</div>
        <div class="card-num sm" id="uptime">--</div>
      </div>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="card-tag"><span class="dot"></span>CPU CORES</div>
        <div><span class="card-num count-up" id="cores" data-val="0">0</span></div>
        <div class="card-desc" id="arch">--</div>
      </div>
    </div>
  </div>

  <div class="grid2">
    <div class="traffic-card">
      <div class="traffic-label"><span class="arrow">&#9654;</span> NETWORK TRAFFIC</div>
      <div class="traffic-row">
        <div class="t-block">
          <div class="t-dir rx">&#9660; DOWNLOAD</div>
          <div class="t-speed count-up" id="rxSpeed" data-val="0">--</div>
          <div class="t-total">TOTAL <span id="rxTotal">--</span></div>
        </div>
        <div class="t-block">
          <div class="t-dir tx">&#9650; UPLOAD</div>
          <div class="t-speed count-up" id="txSpeed" data-val="0">--</div>
          <div class="t-total">TOTAL <span id="txTotal">--</span></div>
        </div>
      </div>
      <div class="spark-wrap"><canvas id="sparkAll"></canvas></div>
      <div class="traffic-stats">
        <div class="stat-item">
          <div class="stat-label">RX PEAK</div>
          <div class="stat-val rx-color" id="rxPeak">--</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">RX AVG</div>
          <div class="stat-val rx-color" id="rxAvg">--</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">TX PEAK</div>
          <div class="stat-val tx-color" id="txPeak">--</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">TX AVG</div>
          <div class="stat-val tx-color" id="txAvg">--</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <div class="card-tag"><span class="dot"></span>SYSTEM INFO</div>
        <div class="info-tbl">
          <div class="row"><span class="k">HOSTNAME</span><span class="v" id="iHost">--</span></div>
          <div class="row"><span class="k">OS</span><span class="v" id="iOS">--</span></div>
          <div class="row"><span class="k">VERSION</span><span class="v" id="iVer">--</span></div>
          <div class="row"><span class="k">ARCH</span><span class="v" id="iArch">--</span></div>
          <div class="row"><span class="k">NODE.JS</span><span class="v" id="iNode">--</span></div>
          <div class="row"><span class="k">FREE MEM</span><span class="v" id="iFree">--</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:12px">
    <div class="card-body">
      <div class="card-tag"><span class="dot"></span>NETWORK INTERFACES</div>
      <div id="netIfaces" style="margin-top:6px">--</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:0">
    <div class="card-body">
      <div class="card-tag"><span class="dot"></span>TOP PROCESSES</div>
      <div class="proc-table">
        <div class="proc-header">
          <span class="proc-col proc-name">NAME</span>
          <span class="proc-col proc-pid">PID</span>
          <span class="proc-col proc-cpu">CPU%</span>
          <span class="proc-col proc-mem">MEM(MB)</span>
        </div>
        <div id="procList"></div>
      </div>
    </div>
  </div>

  <div class="footer">
    FRP REVERSE PROXY &middot; NODE <span id="fNode">--</span>
  </div>
</div>

<script>
/* ═══════════════════════════════════════════
   Theme Switcher (P1: with transition)
   ═══════════════════════════════════════════ */
const btns = document.querySelectorAll('.theme-btn');
const root = document.documentElement;

function setTheme(t) {
  root.setAttribute('data-theme', t);
  btns.forEach(b => b.classList.toggle('active', b.dataset.theme === t));
  localStorage.setItem('frp-theme', t);
  drawSpark();
}

btns.forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme)));

const saved = localStorage.getItem('frp-theme');
if (saved && ['cyber','brutal','aurora','phosphor'].includes(saved)) setTheme(saved);

/* ═══════════════════════════════════════════
   Count-Up Animation (P0)
   ═══════════════════════════════════════════ */
function countUp(el, target, opts) {
  opts = opts || {};
  const decimals = opts.decimals || 0;
  const suffix = opts.suffix || '';
  const duration = opts.duration || 600;
  const raw = parseFloat(el.dataset.val) || 0;
  const diff = target - raw;
  if (Math.abs(diff) < (decimals > 0 ? 0.01 : 0.5)) {
    el.dataset.val = target;
    el.textContent = (decimals > 0 ? target.toFixed(decimals) : Math.round(target)) + suffix;
    return;
  }
  const start = performance.now();
  const startVal = raw;

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // ease-out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = startVal + diff * ease;
    el.dataset.val = current;
    el.textContent = (decimals > 0 ? current.toFixed(decimals) : Math.round(current)) + suffix;
    if (progress < 1) requestAnimationFrame(step);
    else {
      el.dataset.val = target;
      el.textContent = (decimals > 0 ? target.toFixed(decimals) : Math.round(target)) + suffix;
    }
  }
  requestAnimationFrame(step);
}

/* ═══════════════════════════════════════════
   Warning Color Gradient (P0)
   ═══════════════════════════════════════════ */
function getWarnClass(pct) {
  if (pct > 80) return 'warn-bad';
  if (pct > 50) return 'warn-mid';
  return 'warn-good';
}

/* ═══════════════════════════════════════════
   Ring Progress (P0)
   ═══════════════════════════════════════════ */
const RING_CIRC = 2 * Math.PI * 34; // ~213.628

function updateRing(ringEl, pctTextEl, numEl, pct) {
  const p = Math.min(Math.max(pct, 0), 100);
  const offset = RING_CIRC * (1 - p / 100);
  ringEl.style.strokeDashoffset = offset;
  pctTextEl.textContent = Math.round(p) + '%';

  // Warning colors
  const wc = getWarnClass(pct);
  ringEl.classList.remove('warn-good', 'warn-mid', 'warn-bad');
  ringEl.classList.add(wc);
  pctTextEl.classList.remove('warn-good', 'warn-mid', 'warn-bad');
  pctTextEl.classList.add(wc);
  numEl.classList.remove('warn-good', 'warn-mid', 'warn-bad');
  numEl.classList.add(wc);

  countUp(numEl, pct, { decimals: 1, suffix: '', duration: 700 });
}

/* ═══════════════════════════════════════════
   Traffic Stats (P1: session peak/avg)
   ═══════════════════════════════════════════ */
const RX_H = new Array(60).fill(0);
const TX_H = new Array(60).fill(0);
let rxPeakSpeed = 0, txPeakSpeed = 0;
let rxSumSpeed = 0, txSumSpeed = 0;
let speedSamples = 0;

function updateTrafficStats(rxRaw, txRaw) {
  if (rxRaw > rxPeakSpeed) rxPeakSpeed = rxRaw;
  if (txRaw > txPeakSpeed) txPeakSpeed = txRaw;
  rxSumSpeed += rxRaw;
  txSumSpeed += txRaw;
  speedSamples++;

  const rxAvg = speedSamples > 0 ? rxSumSpeed / speedSamples : 0;
  const txAvg = speedSamples > 0 ? txSumSpeed / speedSamples : 0;

  document.getElementById('rxPeak').textContent = formatSpeedJS(rxPeakSpeed);
  document.getElementById('rxAvg').textContent = formatSpeedJS(rxAvg);
  document.getElementById('txPeak').textContent = formatSpeedJS(txPeakSpeed);
  document.getElementById('txAvg').textContent = formatSpeedJS(txAvg);
}

function formatSpeedJS(bps) {
  if (bps < 1024) return bps.toFixed(0) + ' B/s';
  if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KB/s';
  if (bps < 1073741824) return (bps / 1048576).toFixed(2) + ' MB/s';
  return (bps / 1073741824).toFixed(2) + ' GB/s';
}

/* ═══════════════════════════════════════════
   Sparkline (P1: enhanced with peak markers & grid)
   ═══════════════════════════════════════════ */
function getThemeColors() {
  const s = getComputedStyle(root);
  return {
    rx: s.getPropertyValue('--good').trim(),
    tx: s.getPropertyValue('--accent2').trim(),
    bg: s.getPropertyValue('--bg2').trim(),
    text2: s.getPropertyValue('--text2').trim(),
    border: s.getPropertyValue('--border').trim()
  };
}

function drawSpark() {
  const canvas = document.getElementById('sparkAll');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  const c = getThemeColors();

  ctx.clearRect(0, 0, w, h);

  // Grid lines (P1)
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 4]);
  for (let i = 1; i < 4; i++) {
    const gy = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  function drawLine(data, color, peakData) {
    if (data.length < 2) return;
    const max = Math.max(...data, 1024);
    const step = w / (data.length - 1);

    // Fill gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '30');
    grad.addColorStop(1, color + '03');

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < data.length; i++) {
      const x = i * step;
      const y = h - (data[i] / max) * (h - 6) * (data[i] > 0 ? 1 : 0);
      if (i === 0) { ctx.lineTo(x, y); }
      else {
        const px = (i-1)*step, py = h - (data[i-1]/max)*(h-6)*(data[i-1]>0?1:0);
        ctx.bezierCurveTo((px+x)/2, py, (px+x)/2, y, x, y);
      }
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Stroke
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = i * step;
      const y = h - (data[i] / max) * (h - 6) * (data[i] > 0 ? 1 : 0);
      if (i === 0) { ctx.moveTo(x, y); }
      else {
        const px = (i-1)*step, py = h - (data[i-1]/max)*(h-6)*(data[i-1]>0?1:0);
        ctx.bezierCurveTo((px+x)/2, py, (px+x)/2, y, x, y);
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Peak marker (P1)
    let peakI = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i] > data[peakI]) peakI = i;
    }
    if (data[peakI] > 0) {
      const px2 = peakI * step;
      const py2 = h - (data[peakI] / max) * (h - 6);
      // Diamond marker
      ctx.beginPath();
      ctx.moveTo(px2, py2 - 4);
      ctx.lineTo(px2 + 3, py2);
      ctx.lineTo(px2, py2 + 4);
      ctx.lineTo(px2 - 3, py2);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      // Peak label
      ctx.font = '9px monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(formatSpeedJS(data[peakI]), px2, py2 - 7);
    }

    // Current dot
    const lastI = data.length - 1;
    const lx = lastI * step, ly = h - (data[lastI]/max)*(h-6)*(data[lastI]>0?1:0);
    ctx.beginPath();
    ctx.arc(lx, ly, 2.5, 0, Math.PI*2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx, ly, 6, 0, Math.PI*2);
    ctx.fillStyle = color + '20';
    ctx.fill();
  }

  drawLine(RX_H, c.rx);
  drawLine(TX_H, c.tx);
}

/* ═══════════════════════════════════════════
   Data Update
   ═══════════════════════════════════════════ */
function updateUI(d) {
  document.getElementById('ts').textContent = d.timestamp;
  document.getElementById('hostname').textContent = d.hostname;

  // CPU ring + warning (P0)
  updateRing(
    document.getElementById('cpuRing'),
    document.getElementById('cpuRingPct'),
    document.getElementById('cpuVal'),
    parseFloat(d.cpuUsage)
  );
  document.getElementById('cpuModel').textContent = d.cpuModel;

  // Memory ring + warning (P0)
  updateRing(
    document.getElementById('memRing'),
    document.getElementById('memRingPct'),
    document.getElementById('memVal'),
    parseFloat(d.memUsage)
  );
  document.getElementById('memSub').textContent = d.usedMem + ' / ' + d.totalMem + ' GB';

  // Uptime & cores with count-up (P0)
  document.getElementById('uptime').textContent = d.uptime;
  countUp(document.getElementById('cores'), parseInt(d.cpuCores), { duration: 500 });
  document.getElementById('arch').textContent = d.arch;

  // Traffic with count-up (P0) - display formatted speed
  document.getElementById('rxSpeed').textContent = d.rxSpeed;
  document.getElementById('txSpeed').textContent = d.txSpeed;
  document.getElementById('rxTotal').textContent = d.rxTotal;
  document.getElementById('txTotal').textContent = d.txTotal;

  // Sparkline data
  RX_H.push(d.rxSpeedRaw); RX_H.shift();
  TX_H.push(d.txSpeedRaw); TX_H.shift();
  drawSpark();

  // Traffic stats (P1)
  updateTrafficStats(d.rxSpeedRaw, d.txSpeedRaw);

  // System info table
  document.getElementById('iHost').textContent = d.hostname;
  document.getElementById('iOS').textContent = d.osType;
  document.getElementById('iVer').textContent = d.osRelease;
  document.getElementById('iArch').textContent = d.arch;
  document.getElementById('iNode').textContent = d.nodeVersion;
  document.getElementById('iFree').textContent = d.freeMem + ' GB';
  document.getElementById('fNode').textContent = d.nodeVersion;

  // Network interfaces
  const ie = document.getElementById('netIfaces');
  if (d.netInterfaces && d.netInterfaces.length) {
    ie.innerHTML = d.netInterfaces.map(n =>
      '<span class="net-tag"><span>' + n.name + '</span> <span class="addr">' + n.address + '</span></span>'
    ).join('');
  } else { ie.textContent = 'No interfaces'; }

  // Top processes
  const pl = document.getElementById('procList');
  if (d.topProcesses && d.topProcesses.length) {
    const maxCpu = Math.max(...d.topProcesses.map(p => parseFloat(p.cpu) || 0), 1);
    pl.innerHTML = d.topProcesses.map(p => {
      const cpuPct = Math.min((parseFloat(p.cpu) || 0) / maxCpu * 100, 100);
      return '<div class="proc-row">' +
        '<span class="proc-name">' + p.name + '</span>' +
        '<span class="proc-pid">' + p.pid + '</span>' +
        '<span class="proc-cpu">' + p.cpu + '%</span>' +
        '<span class="proc-mem">' + p.mem + '</span>' +
        '</div>';
    }).join('');
  } else { pl.innerHTML = '<div class="proc-row"><span class="proc-name">No data</span></div>'; }
}

/* ═══════════════════════════════════════════
   Polling
   ═══════════════════════════════════════════ */
let firstLoadDone = false;
let errorCount = 0;

async function poll() {
  try {
    const r = await fetch('/api/stats?v=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    updateUI(d);
    errorCount = 0;
    if (!firstLoadDone) {
      firstLoadDone = true;
      document.getElementById('statusPill').classList.remove('loading', 'error');
      document.getElementById('statusText').textContent = 'ONLINE';
      document.getElementById('errorBanner').classList.remove('show');
    }
  } catch(e) {
    console.error('Poll error:', e);
    errorCount++;
    const pill = document.getElementById('statusPill');
    const banner = document.getElementById('errorBanner');
    if (!firstLoadDone) {
      document.getElementById('statusText').textContent = 'LOADING...';
      pill.classList.add('loading');
      pill.classList.remove('error');
      document.getElementById('errorMsg').textContent = '连接服务器中... (' + errorCount + ')';
      banner.classList.add('show');
    } else {
      document.getElementById('statusText').textContent = 'RECONNECTING';
      pill.classList.add('error');
      pill.classList.remove('loading');
      document.getElementById('errorMsg').textContent = '数据连接中断，正在重试... (' + errorCount + ')';
      banner.classList.add('show');
    }
  }
}

poll();
setInterval(poll, 2000);
window.addEventListener('resize', drawSpark);
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/stats')) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(JSON.stringify(getSystemInfo()));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`FRP Node Monitor: http://localhost:${PORT}`);
});
