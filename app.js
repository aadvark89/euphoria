/* ── Data ─────────────────────────────────────────────── */
// Garman-Klass hourly vol (%) — 6-year average 2018-2024, sourced from Amberdata research
const HOURLY_VOL = [
  0.038,0.041,0.034,0.031,0.029,0.033,
  0.042,0.051,0.058,0.062,0.067,0.072,
  0.081,0.089,0.091,0.087,0.082,0.075,
  0.068,0.059,0.055,0.052,0.048,0.043
];

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAY_MULT = [1.05, 1.02, 1.08, 1.10, 1.12, 0.82, 0.73];

const WINDOWS = [
  { label:'02:00–06:00', start:2, end:6, tier:'best', tierLabel:'Prime window', desc:'Lowest GK volatility across all 6 years. No major session overlap, minimal retail activity.', avgVol:0.031, drift:'Negligible', score:91 },
  { label:'06:00–08:00', start:6, end:8, tier:'best', tierLabel:'Secondary', desc:'Pre-London open. Still quiet — slight uptick as EU traders wake up.', avgVol:0.038, drift:'Very low', score:79 },
  { label:'21:00–23:00', start:21, end:23, tier:'good', tierLabel:'Late-night', desc:'Post-US session fade. Generally calm but can spike on unexpected news.', avgVol:0.046, drift:'Low', score:65 },
  { label:'08:00–10:00', start:8, end:10, tier:'good', tierLabel:'Early EU', desc:'London market open brings a mild but measurable pickup in activity.', avgVol:0.055, drift:'Moderate', score:52 },
  { label:'10:00–13:00', start:10, end:13, tier:'risky', tierLabel:'EU session', desc:'Rising volatility ahead of US open. Directional moves common. Shorten bet windows.', avgVol:0.072, drift:'Moderate-high', score:31 },
  { label:'13:00–17:00', start:13, end:17, tier:'risky', tierLabel:'Danger zone', desc:'US open + EU overlap. Highest volatility of the entire day. Avoid straight-line bets.', avgVol:0.089, drift:'High', score:8 },
];

/* ── Helpers ──────────────────────────────────────────── */
let tzOffset = 7;

function stabilityScore(vol) {
  const t = (vol - 0.025) / (0.095 - 0.025);
  return Math.round((1 - Math.min(1, Math.max(0, t))) * 100);
}

function meterClass(risk) {
  return risk < 35 ? '' : risk < 65 ? 'm-caution' : 'm-danger';
}

function scoreClass(score) {
  return score >= 65 ? 'sp-safe' : score >= 35 ? 'sp-caution' : 'sp-danger';
}

function volToColor(v) {
  const t = Math.min(1, Math.max(0, (v - 0.025) / (0.095 - 0.025)));
  if (t < 0.35) return { r:29, g:92, b:62 };
  if (t < 0.65) { const p=(t-0.35)/0.30; return { r:Math.round(29+p*95), g:Math.round(92-p*42), b:62-Math.round(p*52) }; }
  const p=(t-0.65)/0.35; return { r:Math.round(124+p*3), g:Math.round(50-p*21), b:Math.round(10) };
}

function rgbStr(v, a=1) {
  const c = volToColor(v);
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

/* ── Clock ────────────────────────────────────────────── */
function updateClock() {
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const el = document.getElementById('utc-clock-header');
  if (el) el.textContent = `${String(utcH).padStart(2,'0')}:${String(utcM).padStart(2,'0')} UTC`;

  const localH = ((utcH + tzOffset) % 24 + 24) % 24;
  const lh = Math.floor(localH), lm = utcM;
  const verdictEl = document.getElementById('risk-verdict-sub');
  const session = utcH>=13&&utcH<22?'US session':utcH>=7&&utcH<13?'EU session':utcH>=2&&utcH<7?'Safe window':'Low activity';
  if (verdictEl) verdictEl.textContent = `UTC ${String(utcH).padStart(2,'0')}:${String(utcM).padStart(2,'0')} · ${session}`;

  const bestStart = ((2 + tzOffset) % 24 + 24) % 24;
  const bestEnd = ((6 + tzOffset) % 24 + 24) % 24;
  const lwEl = document.getElementById('local-window-val');
  if (lwEl) lwEl.textContent = `${String(bestStart).padStart(2,'0')}:00 – ${String(bestEnd).padStart(2,'0')}:00`;
}

function updateTZ() {
  tzOffset = parseFloat(document.getElementById('tz-select').value);
  updateClock();
}

/* ── Risk Computation ─────────────────────────────────── */
function getVolRisk(h) {
  return Math.round((HOURLY_VOL[h] - 0.025) / (0.095 - 0.025) * 100);
}
function getSessionRisk(h) {
  if (h>=13&&h<17) return 95;
  if (h>=17&&h<22) return 70;
  if (h>=7&&h<13) return 55;
  if (h>=0&&h<2) return 45;
  if (h>=2&&h<6) return 15;
  return 30;
}
function getFundingRisk(h) {
  if ([0,8,16].includes(h)) return 80;
  if ([23,7,15].includes(h)) return 55;
  return 18;
}
function getMacroRisk(h) {
  if (h>=12&&h<15) return 72;
  if (h>=7&&h<10) return 48;
  return 18;
}

function setMeter(valId, fillId, risk) {
  const el = document.getElementById(valId);
  const fill = document.getElementById(fillId);
  if (el) el.textContent = risk + '%';
  if (fill) {
    fill.style.width = risk + '%';
    fill.className = 'meter-fill ' + meterClass(risk);
  }
}

function computeRisk() {
  const now = new Date();
  const h = now.getUTCHours();
  const vr = getVolRisk(h);
  const sr = getSessionRisk(h);
  const fr = getFundingRisk(h);
  const mr = getMacroRisk(h);
  const composite = Math.round(vr*0.4 + sr*0.3 + mr*0.15 + fr*0.15);

  setMeter('vol-val','vol-fill', vr);
  setMeter('session-val','session-fill', sr);
  setMeter('funding-val','funding-fill', fr);
  setMeter('macro-val','macro-fill', mr);

  const compFill = document.getElementById('composite-fill');
  const compVal = document.getElementById('composite-val');
  if (compFill) {
    compFill.style.width = composite + '%';
    compFill.className = 'composite-fill ' + meterClass(composite);
  }
  if (compVal) {
    compVal.textContent = composite + '/100';
    compVal.className = 'composite-val ' + meterClass(composite);
  }

  const badge = document.getElementById('risk-badge');
  const label = document.getElementById('risk-verdict-label');
  const dot = document.getElementById('pulse-dot');
  const ring = document.getElementById('pulse-ring');

  let safeClass, badgeText, labelText;
  if (composite < 35) {
    safeClass = ''; badgeText = '✓ Safe to bet';
    labelText = 'Conditions are stable — good window for straight-line bets';
  } else if (composite < 65) {
    safeClass = 'caution'; badgeText = '⚠ Use caution';
    labelText = 'Moderate volatility — shorten bet duration and reduce size';
  } else {
    safeClass = 'danger'; badgeText = '✗ Avoid bets';
    labelText = 'High volatility window — wait for a safer session';
  }

  if (badge) { badge.className = 'risk-badge ' + safeClass; badge.textContent = badgeText; }
  if (label) label.textContent = labelText;

  const color = composite < 35 ? 'var(--safe)' : composite < 65 ? 'var(--caution)' : 'var(--danger)';
  if (dot) dot.style.background = color;
  if (ring) ring.style.borderColor = color;

  return { h, vr, sr, fr, mr, composite };
}

/* ── AI Assessment ────────────────────────────────────── */
async function runRiskAssessment() {
  const btn = document.getElementById('refresh-btn');
  const aiBody = document.getElementById('ai-body');
  if (btn) btn.classList.add('spinning');
  if (aiBody) { aiBody.className = 'ai-body loading'; aiBody.innerHTML = '<p>Analyzing current conditions...</p>'; }

  const risk = computeRisk();
  const verdict = risk.composite < 35 ? 'SAFE' : risk.composite < 65 ? 'CAUTION' : 'AVOID';
  const volPct = (HOURLY_VOL[risk.h] * 100).toFixed(3);

  const prompt = `You are a quant risk analyst for Euphoria Finance tap trading. Traders place straight-line bets on ETH price direction for 1-5 minutes. The goal is periods where price is most predictable.

Current UTC hour: ${risk.h}:00
Garman-Klass volatility at this hour: ${volPct}% (6yr avg)
Hourly volatility risk: ${risk.vr}/100
Session activity risk: ${risk.sr}/100
Funding rate pressure: ${risk.fr}/100
Macro event risk: ${risk.mr}/100
Composite risk score: ${risk.composite}/100
Verdict: ${verdict}

Write exactly 3 short sentences: (1) whether this is a good time to tap-trade ETH and why, quantifying the risk score, (2) the specific risk factor most elevated right now, (3) when the next optimal window opens if they should wait. Be blunt and data-driven. No preamble.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || fallbackText(risk, verdict, volPct);
    if (aiBody) { aiBody.className = 'ai-body'; aiBody.innerHTML = `<p>${text}</p>`; }
  } catch (e) {
    if (aiBody) { aiBody.className = 'ai-body'; aiBody.innerHTML = `<p>${fallbackText(risk, verdict, volPct)}</p>`; }
  }
  if (btn) btn.classList.remove('spinning');
}

function fallbackText(risk, verdict, volPct) {
  if (verdict === 'SAFE') return `Composite risk ${risk.composite}/100 — conditions are favorable for straight-line tap bets. Historical GK volatility at ${risk.h}:00 UTC is just ${volPct}%, among the lowest in the 24h cycle. This is the prime window; take your bets now.`;
  if (verdict === 'CAUTION') return `Composite risk ${risk.composite}/100 — moderate conditions, proceed carefully. Volatility at ${risk.h}:00 UTC averages ${volPct}%, elevated relative to the 02-06 UTC baseline. Consider shortening bet duration to under 2 minutes; next safer window opens around 02:00 UTC.`;
  return `Composite risk ${risk.composite}/100 — avoid straight-line bets right now. At ${risk.h}:00 UTC the historical GK volatility hits ${volPct}%, near the 24h maximum. Wait for the 02:00–06:00 UTC window when volatility drops ~65%.`;
}

/* ── Hero Chart ───────────────────────────────────────── */
function buildHeroChart() {
  const canvas = document.getElementById('hero-chart');
  if (!canvas) return;
  const scores = HOURLY_VOL.map(stabilityScore);
  const labels = Array.from({length:24}, (_,i) => String(i).padStart(2,'0'));

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: scores,
        borderColor: 'rgba(0,212,170,0.7)',
        backgroundColor: 'rgba(0,212,170,0.04)',
        borderWidth: 2,
        fill: true,
        tension: 0.45,
        pointRadius: 4,
        pointBackgroundColor: scores.map(s => s>=65?'#4ade80':s>=35?'#fb923c':'#f87171'),
        pointBorderColor: 'transparent',
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display:false }, tooltip: { callbacks: { label: c => `Stability: ${c.raw}/100` } } },
      scales: {
        x: { ticks:{ color:'#3d5166', font:{size:10}, maxRotation:0, autoSkip:true, maxTicksLimit:8 }, grid:{ color:'rgba(255,255,255,0.03)' }, border:{color:'rgba(255,255,255,0.06)'} },
        y: { min:0, max:100, ticks:{ color:'#3d5166', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.03)' }, border:{color:'rgba(255,255,255,0.06)'} }
      }
    }
  });
}

/* ── Heatmap ──────────────────────────────────────────── */
function buildHeatmap() {
  const hourLabels = document.getElementById('hm-hour-labels');
  const rows = document.getElementById('hm-rows');
  if (!hourLabels || !rows) return;

  let hlHtml = '';
  for (let h=0; h<24; h++) {
    hlHtml += `<div class="hml">${h%3===0?String(h).padStart(2,'0'):''}h</div>`;
  }
  hourLabels.innerHTML = hlHtml;

  let rowsHtml = '';
  DAYS.forEach((d, di) => {
    rowsHtml += `<div class="hm-row"><div class="hm-day">${d}</div>`;
    for (let h=0; h<24; h++) {
      const v = HOURLY_VOL[h] * DAY_MULT[di];
      const color = rgbStr(v, 0.95);
      const tip = `${d} ${String(h).padStart(2,'0')}:00 UTC — vol ${(v*100).toFixed(3)}%`;
      rowsHtml += `<div class="hm-cell" style="background:${color};" data-tip="${tip}"></div>`;
    }
    rowsHtml += '</div>';
  });
  rows.innerHTML = rowsHtml;
}

/* ── Bar Chart ────────────────────────────────────────── */
function buildBarChart() {
  const canvas = document.getElementById('vol-bar-chart');
  if (!canvas) return;

  const colors = HOURLY_VOL.map(v => {
    const t = (v-0.025)/(0.095-0.025);
    return t<0.35?'rgba(74,222,128,0.7)':t<0.65?'rgba(251,146,60,0.7)':'rgba(248,113,113,0.7)';
  });

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: Array.from({length:24}, (_,i) => String(i).padStart(2,'0')+':00'),
      datasets: [{
        label: 'Hourly vol %',
        data: HOURLY_VOL.map(v => parseFloat((v*100).toFixed(4))),
        backgroundColor: colors,
        borderRadius: 3,
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend:{ display:false }, tooltip:{ callbacks:{ label: c => `Vol: ${c.raw}%` } } },
      scales: {
        x: { ticks:{ color:'#3d5166', font:{size:10}, maxRotation:0, autoSkip:true, maxTicksLimit:12 }, grid:{ display:false }, border:{color:'rgba(255,255,255,0.06)'} },
        y: { ticks:{ color:'#3d5166', font:{size:10}, callback: v=>`${v}%` }, grid:{ color:'rgba(255,255,255,0.04)' }, border:{color:'rgba(255,255,255,0.06)'} }
      }
    }
  });
}

/* ── Stability Chart ──────────────────────────────────── */
function buildStabilityChart() {
  const canvas = document.getElementById('stability-chart');
  if (!canvas) return;
  const scores = HOURLY_VOL.map(stabilityScore);
  const now = new Date();
  const currentH = now.getUTCHours();

  const pointColors = scores.map((s,i) => {
    if (i===currentH) return '#00d4aa';
    return s>=65?'#4ade80':s>=35?'#fb923c':'#f87171';
  });
  const pointRadius = scores.map((_,i) => i===currentH ? 7 : 4);

  // Background zones
  const safePlugin = {
    id: 'zones',
    beforeDraw(chart) {
      const {ctx, chartArea:{top,bottom,left,right}, scales:{x,y}} = chart;
      const drawBand = (min, max, color) => {
        const y1 = y.getPixelForValue(max);
        const y2 = y.getPixelForValue(min);
        ctx.fillStyle = color;
        ctx.fillRect(left, y1, right-left, y2-y1);
      };
      drawBand(65, 100, 'rgba(74,222,128,0.04)');
      drawBand(0, 35, 'rgba(248,113,113,0.04)');
    }
  };

  new Chart(canvas, {
    type: 'line',
    plugins: [safePlugin],
    data: {
      labels: Array.from({length:24}, (_,i) => String(i).padStart(2,'0')+':00'),
      datasets: [{
        label: 'Stability score',
        data: scores,
        borderColor: '#7a8fa3',
        borderWidth: 2,
        tension: 0.4,
        fill: false,
        pointRadius,
        pointBackgroundColor: pointColors,
        pointBorderColor: scores.map((_,i) => i===currentH ? '#00d4aa' : 'transparent'),
        pointBorderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display:false },
        tooltip: { callbacks: { label: c => `Stability: ${c.raw}/100${c.dataIndex===currentH?' ← now':''}` } }
      },
      scales: {
        x: { ticks:{ color:'#3d5166', font:{size:10}, maxRotation:0, autoSkip:true, maxTicksLimit:12 }, grid:{ color:'rgba(255,255,255,0.03)' }, border:{color:'rgba(255,255,255,0.06)'} },
        y: { min:0, max:100, ticks:{ color:'#3d5166', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.04)' }, border:{color:'rgba(255,255,255,0.06)'} }
      }
    }
  });
}

/* ── Windows ──────────────────────────────────────────── */
function buildWindows() {
  const cards = document.getElementById('windows-cards');
  const tbody = document.getElementById('windows-tbody');
  if (!cards || !tbody) return;

  cards.innerHTML = WINDOWS.map(w => `
    <div class="window-card tier-${w.tier}">
      <div class="wc-time">${w.label} UTC</div>
      <div class="wc-tier ${w.tier}">${w.tierLabel}</div>
      <div class="wc-vol">${(w.avgVol*100).toFixed(3)}%</div>
      <div class="wc-desc">${w.desc}</div>
    </div>
  `).join('');

  tbody.innerHTML = WINDOWS.map(w => {
    const sc = scoreClass(w.score);
    const vs = w.score>=65 ? `−${Math.round((1-w.avgVol/0.089)*100)}%` : `+${Math.round((w.avgVol/0.031-1)*100)}%`;
    const vc = w.score>=65?'verdict-safe':w.score>=35?'verdict-caution':'verdict-danger';
    const vt = w.score>=65?'Safe to bet':w.score>=35?'Use caution':'Avoid';
    return `<tr>
      <td>${w.label}</td>
      <td>${(w.avgVol*100).toFixed(3)}%</td>
      <td>${vs} vs mean</td>
      <td>${w.drift}</td>
      <td><span class="score-pill ${sc}">${w.score}/100</span></td>
      <td class="${vc}">${vt}</td>
    </tr>`;
  }).join('');
}

/* ── Init ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  buildHeatmap();
  buildWindows();
  updateClock();
  computeRisk();
  runRiskAssessment();

  // Charts need a small delay for layout
  setTimeout(() => {
    buildHeroChart();
    buildBarChart();
    buildStabilityChart();
  }, 100);

  setInterval(() => {
    updateClock();
    computeRisk();
  }, 30000);
});
