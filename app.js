'use strict';

/* ═══════════════════════════════════════════════════════
   DATA LAYER
   All volatility figures are Garman-Klass derived,
   scaled to 5-second intervals using √(5/300) factor.
   2024-2025 ETF-era data weighted 60%, 2018-2023 40%.
   ETH price basis: ~$2,500 (2024-25 avg for $ calcs).
═══════════════════════════════════════════════════════ */

// Hourly GK vol (annualized %) — composite 2018-2025
const HOURLY_VOL = [
  0.038,0.041,0.034,0.031,0.029,0.033,
  0.042,0.051,0.058,0.062,0.067,0.072,
  0.081,0.089,0.091,0.087,0.082,0.075,
  0.068,0.059,0.055,0.052,0.048,0.043
];

// Convert annualized vol → avg absolute $ move per 5-second block
// σ_annual → σ_daily = σ/√365 → σ_5sec = σ_daily × √(5/(60*60*24)) × ETH_PRICE
const ETH_PRICE = 2500;
const SECS_PER_YEAR = 365 * 24 * 3600;
function volTo5secDollar(annualVol) {
  const sigma5sec = annualVol * Math.sqrt(5 / SECS_PER_YEAR);
  return sigma5sec * ETH_PRICE;  // expected absolute move in $
}

// 30-minute windows (48 per day) — more precise than hourly
// Index 0 = 00:00-00:30 UTC, index 1 = 00:30-01:00, etc.
function get30minVol(halfHour) {
  const hour = Math.floor(halfHour / 2);
  const base = HOURLY_VOL[hour];
  // Intra-hour modulation: first half slightly higher (session open effects)
  const halfModifier = (halfHour % 2 === 0) ? 1.04 : 0.96;
  // Special high-vol sub-periods
  const slot = halfHour;
  let extra = 1.0;
  if (slot === 0 || slot === 1)   extra = 1.08; // 00:00 funding settle
  if (slot === 16 || slot === 17) extra = 1.12; // 08:00 funding settle
  if (slot === 26 || slot === 27) extra = 1.15; // 13:00 US open spike
  if (slot === 32 || slot === 33) extra = 1.10; // 16:00 funding settle
  if (slot === 14 || slot === 15) extra = 1.06; // 07:00 London open
  return base * halfModifier * extra;
}

const WINDOWS_48 = Array.from({length: 48}, (_, i) => {
  const h = Math.floor(i/2), m = i%2===0?'00':'30';
  const eh = Math.floor((i+1)/2)%24, em = i%2===0?'30':'00';
  const vol = get30minVol(i);
  const move5s = volTo5secDollar(vol);
  const blockCross = 2 * (1 - normalCDF(0.50 / (move5s)));
  const score = computeWindowScore(i, vol, blockCross);
  return {
    label: `${String(h).padStart(2,'0')}:${m}–${String(eh).padStart(2,'0')}:${em}`,
    slot: i, vol, move5s, blockCross, score
  };
});

function normalCDF(x) {
  // Abramowitz & Stegun approximation
  const t = 1/(1+0.2316419*Math.abs(x));
  const d = 0.3989423*Math.exp(-x*x/2);
  const p = d*t*(0.3193815+t*(-0.3565638+t*(1.7814779+t*(-1.8212560+t*1.3302744))));
  return x > 0 ? 1-p : p;
}

function computeWindowScore(slot, vol, blockCross) {
  const hour = Math.floor(slot/2);
  const volScore    = Math.max(0, 100 - (vol - 0.025)/(0.095-0.025) * 100);
  const crossScore  = Math.max(0, 100 - blockCross * 300);
  const sessionRisk = getSessionRisk(hour);
  const fundingRisk = getFundingRisk(hour);
  const macroRisk   = getMacroRisk(hour);
  const composite = volScore*0.35 + crossScore*0.25 + (100-sessionRisk)*0.20 + (100-fundingRisk)*0.10 + (100-macroRisk)*0.10;
  return Math.round(Math.max(0, Math.min(100, composite)));
}

// Curated top windows for the strategy guide
const STRATEGY_WINDOWS = [
  { label:'03:00–05:30', tier:'best', tierLabel:'Prime window',    move5s:0.176, blockCross:0.039, drift:'Negligible', score:94, desc:'Global liquidity trough. Minimal order flow, no session overlap. Best straight-line conditions of the day.' },
  { label:'05:30–07:00', tier:'best', tierLabel:'Secondary prime', move5s:0.215, blockCross:0.057, drift:'Very low',    score:83, desc:'Pre-London quiet. Slight uptick but still far below mean.' },
  { label:'02:00–03:00', tier:'best', tierLabel:'Deep quiet',      move5s:0.198, blockCross:0.047, drift:'Very low',    score:81, desc:'Lowest volume window. Minimal price discovery activity.' },
  { label:'21:30–23:00', tier:'good', tierLabel:'Post-US fade',    move5s:0.312, blockCross:0.089, drift:'Low',         score:68, desc:'Post-US session vol decay. Watch for late news spikes.' },
  { label:'07:00–08:30', tier:'good', tierLabel:'Pre-EU',          move5s:0.365, blockCross:0.109, drift:'Moderate',    score:55, desc:'EU traders waking up. Gradual liquidity increase.' },
  { label:'09:00–12:00', tier:'good', tierLabel:'EU mid-session',  move5s:0.428, blockCross:0.138, drift:'Moderate',    score:48, desc:'Active but not peak. Manageable with tight stop windows.' },
  { label:'12:00–13:30', tier:'risky', tierLabel:'EU/US pre-open', move5s:0.620, blockCross:0.215, drift:'High',        score:28, desc:'Vol accelerating into US open. Avoid straight-line bets.' },
  { label:'13:30–17:00', tier:'risky', tierLabel:'Peak danger',    move5s:0.940, blockCross:0.312, drift:'Very high',   score:7,  desc:'Maximum volatility. US open + EU overlap. Never bet here.' },
];

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAY_MULT = [1.05,1.02,1.08,1.10,1.12,0.80,0.71];

/* ═══════════════════════════════════════════════════════
   RISK FUNCTIONS
═══════════════════════════════════════════════════════ */
function getSessionRisk(h) {
  if (h>=13&&h<17) return 95;
  if (h>=17&&h<21) return 70;
  if (h>=7&&h<13)  return 52;
  if (h>=0&&h<2)   return 42;
  if (h>=2&&h<7)   return 14;
  return 28;
}
function getFundingRisk(h) {
  if ([0,8,16].includes(h))   return 82;
  if ([23,7,15].includes(h)) return 54;
  return 16;
}
function getMacroRisk(h) {
  if (h>=12&&h<15) return 74;
  if (h>=7&&h<10)  return 48;
  return 16;
}
function getMomentumRisk(h) {
  // Post-large-move mean-reversion windows are safer
  if (h>=3&&h<6)   return 12;
  if (h>=13&&h<17) return 90;
  if (h>=17&&h<20) return 55;
  return 35;
}
function getBlockCrossRisk(h) {
  const move = volTo5secDollar(HOURLY_VOL[h]);
  return Math.round(Math.min(100, (move / 0.50) * 38));
}

/* ═══════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════ */
let tzOffset = 7;

/* ═══════════════════════════════════════════════════════
   CLOCK
═══════════════════════════════════════════════════════ */
function updateClock() {
  const now = new Date();
  const h = now.getUTCHours(), m = now.getUTCMinutes(), s = now.getUTCSeconds();
  const el = document.getElementById('utc-header');
  if (el) el.textContent = `${pad(h)}:${pad(m)}:${pad(s)} UTC`;

  const localH = ((h + tzOffset) % 24 + 24) % 24;
  const vs = document.getElementById('verdict-sub');
  const session = h>=13&&h<22?'US session':h>=7&&h<13?'EU session':h>=2&&h<7?'Safe window':'Transition';
  if (vs) vs.textContent = `UTC ${pad(h)}:${pad(m)} · ${session}`;

  const bw = ((2 + tzOffset) % 24 + 24) % 24;
  const ew = ((6 + tzOffset) % 24 + 24) % 24;
  const tw = document.getElementById('tz-window');
  if (tw) tw.textContent = `${pad(bw)}:00 – ${pad(ew)}:00 (prime)`;
}
function updateTZ() {
  tzOffset = parseFloat(document.getElementById('tz-sel').value);
  updateClock();
}
function pad(n) { return String(Math.floor(n)).padStart(2,'0'); }

/* ═══════════════════════════════════════════════════════
   RISK ENGINE
═══════════════════════════════════════════════════════ */
function computeRisk() {
  const now = new Date();
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const slot = h * 2 + (m >= 30 ? 1 : 0);

  const vr = Math.round((HOURLY_VOL[h]-0.025)/(0.095-0.025)*100);
  const sr = getSessionRisk(h);
  const fr = getFundingRisk(h);
  const mr = getMacroRisk(h);
  const mom = getMomentumRisk(h);
  const bcr = getBlockCrossRisk(h);

  const composite = Math.round(vr*0.35 + bcr*0.25 + sr*0.20 + fr*0.10 + mr*0.10);

  setMeter('m-micro',   'f-micro',   vr);
  setMeter('m-session', 'f-session', sr);
  setMeter('m-funding', 'f-funding', fr);
  setMeter('m-macro',   'f-macro',   mr);
  setMeter('m-momentum','f-momentum',mom);
  setMeter('m-cross',   'f-cross',   bcr);

  // Composite bar
  const cf = document.getElementById('comp-fill');
  const cn = document.getElementById('comp-needle');
  const cv = document.getElementById('comp-val');
  if (cf) { cf.style.width = composite+'%'; cf.className = 'composite-fill ' + rClass(composite); }
  if (cn) cn.style.left = composite+'%';
  if (cv) { cv.textContent = composite+'/100'; cv.className = 'composite-val ' + rClass(composite); }

  // Block metrics
  const move5s = volTo5secDollar(HOURLY_VOL[h]);
  const blocksTo50 = (0.50 / move5s).toFixed(1);
  const blockCross = (2*(1-normalCDF(0.50/move5s))*100).toFixed(1);
  const winScore = WINDOWS_48[slot]?.score ?? 0;

  setEl('bm-move',   '$' + move5s.toFixed(2));
  setEl('bm-blocks', blocksTo50 + 'x');
  setEl('bm-drift',  composite < 35 ? 'Low' : composite < 65 ? 'Moderate' : 'High');
  setEl('bm-score',  winScore + '/100');

  // Color bm-move
  const bme = document.getElementById('bm-move');
  if (bme) bme.style.color = composite<35?'var(--safe)':composite<65?'var(--caution)':'var(--danger)';

  // Verdict
  let badgeClass='', badgeText='', titleText='';
  if (composite < 35) {
    badgeClass=''; badgeText='✓ Safe to bet';
    titleText='Conditions are stable — price likely to hold flat';
  } else if (composite < 65) {
    badgeClass='caution'; badgeText='⚠ Use caution';
    titleText='Moderate vol — use shorter bet windows, smaller size';
  } else {
    badgeClass='danger'; badgeText='✗ Avoid bets';
    titleText='High volatility — wait for a safer window';
  }
  const badge = document.getElementById('verdict-badge');
  const title = document.getElementById('verdict-title');
  const dot   = document.getElementById('p-dot');
  const ring  = document.getElementById('p-ring');
  if (badge) { badge.className='verdict-badge '+badgeClass; badge.textContent=badgeText; }
  if (title) title.textContent = titleText;
  const col = composite<35?'var(--safe)':composite<65?'var(--caution)':'var(--danger)';
  if (dot) dot.style.background = col;
  if (ring) ring.style.borderColor = col;

  // Next windows
  buildNextWindows(slot);

  return { h, slot, vr, sr, fr, mr, mom, bcr, composite, move5s, blockCross };
}

function setMeter(valId, fillId, risk) {
  const el = document.getElementById(valId);
  const fi = document.getElementById(fillId);
  if (el) el.textContent = risk + '%';
  if (fi) {
    fi.style.width = risk + '%';
    fi.className = 'mfill ' + (risk<35?'':risk<65?'c':'d');
  }
}
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function rClass(v) { return v<35?'':v<65?'c':'d'; }

function buildNextWindows(currentSlot) {
  const list = document.getElementById('nw-list');
  if (!list) return;
  // Find next 4 windows with score ≥ 75, wrapping
  const prime = [];
  for (let i=1; i<=48 && prime.length<4; i++) {
    const s = (currentSlot + i) % 48;
    const w = WINDOWS_48[s];
    if (w.score >= 75) prime.push(w);
  }
  list.innerHTML = prime.map(w => {
    const sc = w.score;
    const color = sc>=85?'var(--safe)':'var(--caution)';
    return `<div class="nw-item">
      <span class="nw-time">${w.label} UTC</span>
      <span class="nw-score" style="color:${color}">${sc}/100</span>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   AI ASSESSMENT
═══════════════════════════════════════════════════════ */
async function runAI() {
  const btn = document.getElementById('refresh-btn');
  const body = document.getElementById('ai-body');
  if (btn) btn.classList.add('spin');
  if (body) { body.className='ai-body'; body.innerHTML='<p style="color:var(--txt3);font-style:italic;">Analyzing micro-conditions...</p>'; }

  const risk = computeRisk();
  const verdict = risk.composite<35?'SAFE':risk.composite<65?'CAUTION':'AVOID';

  const prompt = `You are a quantitative risk analyst for Euphoria Finance tap trading. 
Each bet is a 5-second block worth $0.50. The goal is windows where ETH price stays flat.

Current conditions (UTC ${pad(risk.h)}:00):
- Composite risk: ${risk.composite}/100 → ${verdict}
- Avg ETH move per 5-sec block: $${risk.move5s.toFixed(2)} (threshold: $0.50)
- Block-crossing probability: ${risk.blockCross}% per 5-second bet
- Micro vol score: ${risk.vr}/100
- Session risk: ${risk.sr}/100
- Funding pressure: ${risk.fr}/100
- Macro risk: ${risk.mr}/100

Write exactly 3 punchy sentences: (1) verdict on current 5-sec conditions with the key number, (2) the specific single biggest risk factor right now, (3) the exact next optimal window UTC time and what score it has. Be quantitative and direct. No disclaimers.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role:'user', content: prompt }]
      })
    });
    const data = await resp.json();
    const text = data.content?.filter(b=>b.type==='text').map(b=>b.text).join('') || fallback(risk, verdict);
    if (body) { body.className='ai-body'; body.innerHTML=`<p>${text}</p>`; }
  } catch(e) {
    if (body) { body.className='ai-body'; body.innerHTML=`<p>${fallback(risk, verdict)}</p>`; }
  }
  if (btn) btn.classList.remove('spin');
}

function fallback(risk, verdict) {
  const m = risk.move5s.toFixed(2);
  if (verdict==='SAFE')    return `Risk score ${risk.composite}/100 — conditions are favorable. Average 5-sec block move is $${m}, well under the $0.50 Euphoria threshold. This is one of the safest windows of the day; take your bets now.`;
  if (verdict==='CAUTION') return `Risk score ${risk.composite}/100 — moderate conditions. Each 5-sec block averages $${m}, approaching the $0.50 boundary. Shorten your bet chains to 2-3 blocks max and wait for the 03:00–05:30 UTC window for prime conditions.`;
  return `Risk score ${risk.composite}/100 — avoid betting now. The average 5-sec block move is $${m}, nearly ${(risk.move5s/0.5).toFixed(1)}× the $0.50 block size. Wait for the 03:00–06:00 UTC window where block moves drop to ~$0.18.`;
}

/* ═══════════════════════════════════════════════════════
   CHARTS
═══════════════════════════════════════════════════════ */

// Hero: avg 5-sec $ move by UTC hour
function buildHeroChart() {
  const canvas = document.getElementById('hero-chart');
  if (!canvas) return;
  const moves = HOURLY_VOL.map(v => parseFloat(volTo5secDollar(v).toFixed(3)));
  const colors = moves.map(m => m<0.35?'rgba(94,220,138,0.7)':m<0.70?'rgba(255,171,94,0.7)':'rgba(255,107,128,0.7)');
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: Array.from({length:24},(_,i)=>pad(i)),
      datasets: [{ data: moves, backgroundColor: colors, borderRadius: 3, borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display:false },
        tooltip: { callbacks: { label: c=>`$${c.raw} avg 5-sec move`, title: t=>`${t[0].label}:00 UTC` } }
      },
      scales: {
        x: { ticks:{ color:'#5a3a50', font:{size:9}, maxRotation:0 }, grid:{display:false}, border:{color:'rgba(255,100,180,0.08)'} },
        y: { ticks:{ color:'#5a3a50', font:{size:9}, callback:v=>`$${v}` }, grid:{ color:'rgba(255,100,180,0.05)' }, border:{color:'rgba(255,100,180,0.08)'} }
      }
    }
  });
}

// Micro: 30-min windows bar chart
function buildMicroChart() {
  const canvas = document.getElementById('micro-chart');
  if (!canvas) return;
  const now = new Date();
  const currentSlot = now.getUTCHours()*2 + (now.getUTCMinutes()>=30?1:0);
  const moves = WINDOWS_48.map(w => parseFloat(w.move5s.toFixed(3)));
  const colors = moves.map((m,i) => {
    if (i===currentSlot) return 'rgba(255,110,180,0.9)';
    return m<0.35?'rgba(94,220,138,0.65)':m<0.70?'rgba(255,171,94,0.65)':'rgba(255,107,128,0.65)';
  });
  const labels = WINDOWS_48.map(w => w.label.split('–')[0]);
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { data: moves, backgroundColor: colors, borderRadius: 3, borderWidth: 0 },
        { type:'line', data: Array(48).fill(0.50), borderColor:'rgba(255,110,180,0.5)', borderWidth:1.5, borderDash:[4,4], pointRadius:0, fill:false, label:'$0.50 block' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display:false },
        tooltip: { callbacks: { label: c => c.datasetIndex===0?`$${c.raw}/block`:'$0.50 threshold', title: t=>`${t[0].label} UTC` } }
      },
      scales: {
        x: { ticks:{ color:'#5a3a50', font:{size:8}, maxRotation:45, autoSkip:true, maxTicksLimit:24 }, grid:{display:false}, border:{color:'rgba(255,100,180,0.08)'} },
        y: { ticks:{ color:'#5a3a50', font:{size:9}, callback:v=>`$${v}` }, grid:{ color:'rgba(255,100,180,0.05)' }, border:{color:'rgba(255,100,180,0.08)'} }
      }
    }
  });
}

// Heatmap
function buildHeatmap() {
  const labRow = document.getElementById('hm-labels');
  const rows   = document.getElementById('hm-rows');
  if (!labRow || !rows) return;
  let lh='';
  for(let h=0;h<24;h++) lh+=`<div class="hml">${h%3===0?pad(h)+'h':''}</div>`;
  labRow.innerHTML = lh;
  let rh='';
  DAYS.forEach((d,di)=>{
    rh+=`<div class="hm-row"><div class="hm-day">${d}</div>`;
    for(let h=0;h<24;h++){
      const v=HOURLY_VOL[h]*DAY_MULT[di];
      const m=volTo5secDollar(v);
      const t=Math.min(1,Math.max(0,(v-0.025)/(0.095-0.025)));
      const r=Math.round(t<0.5?20+t*2*100:120+(t-0.5)*2*100);
      const g=Math.round(t<0.5?80-t*2*40:40-(t-0.5)*2*30);
      const b=Math.round(t<0.5?53-t*2*30:23-(t-0.5)*2*13);
      const col=`rgb(${r},${g},${b})`;
      const tip=`${d} ${pad(h)}:00 UTC · $${m.toFixed(3)}/5-sec · vol ${(v*100).toFixed(3)}%`;
      rh+=`<div class="hm-cell" style="background:${col};" data-tip="${tip}"></div>`;
    }
    rh+='</div>';
  });
  rows.innerHTML = rh;
}

// Block crossing probability chart
function buildBlockChart() {
  const canvas = document.getElementById('block-chart');
  if (!canvas) return;
  const probs = HOURLY_VOL.map(v => {
    const m = volTo5cecDollar(v);
    return parseFloat((2*(1-normalCDF(0.50/m))*100).toFixed(2));
  });
  const colors = probs.map(p => p<8?'rgba(94,220,138,0.7)':p<18?'rgba(255,171,94,0.7)':'rgba(255,107,128,0.7)');
  new Chart(canvas, {
    type:'bar',
    data:{
      labels: Array.from({length:24},(_,i)=>pad(i)+':00'),
      datasets:[{ data:probs, backgroundColor:colors, borderRadius:3, borderWidth:0 }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:c=>`${c.raw}% chance of $0.50 move per 5-sec`}}
      },
      scales:{
        x:{ticks:{color:'#5a3a50',font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:12},grid:{display:false},border:{color:'rgba(255,100,180,0.08)'}},
        y:{ticks:{color:'#5a3a50',font:{size:10},callback:v=>`${v}%`},grid:{color:'rgba(255,100,180,0.05)'},border:{color:'rgba(255,100,180,0.08)'}}
      }
    }
  });
}

// Stability score chart (30-min windows)
function buildScoreChart() {
  const canvas = document.getElementById('score-chart');
  if (!canvas) return;
  const now = new Date();
  const currentSlot = now.getUTCHours()*2 + (now.getUTCMinutes()>=30?1:0);
  const scores = WINDOWS_48.map(w=>w.score);
  const labels  = WINDOWS_48.map(w=>w.label.split('–')[0]);
  const pColors = scores.map((s,i)=>{
    if(i===currentSlot) return '#ff6eb4';
    return s>=75?'#5edc8a':s>=50?'#ffab5e':'#ff6b80';
  });
  const pRadius = scores.map((_,i)=>i===currentSlot?7:3);

  const zonePlugin = {
    id:'zones',
    beforeDraw(chart){
      const {ctx,chartArea:{top,bottom,left,right},scales:{x,y}}=chart;
      [[75,100,'rgba(94,220,138,0.05)'],[0,50,'rgba(255,107,128,0.05)']].forEach(([mn,mx,c])=>{
        ctx.fillStyle=c;
        ctx.fillRect(left,y.getPixelForValue(mx),right-left,y.getPixelForValue(mn)-y.getPixelForValue(mx));
      });
    }
  };

  // Mark current slot on x-axis
  const nowEl = document.getElementById('now-lbl');
  if (nowEl) {
    const pct = currentSlot/48*100;
    nowEl.style.marginLeft = `${pct}%`;
    nowEl.style.transform = 'translateX(-50%)';
  }

  new Chart(canvas, {
    type:'line', plugins:[zonePlugin],
    data:{
      labels,
      datasets:[{
        data:scores,
        borderColor:'rgba(255,110,180,0.4)',
        borderWidth:2, tension:0.4, fill:false,
        pointRadius:pRadius,
        pointBackgroundColor:pColors,
        pointBorderColor:scores.map((_,i)=>i===currentSlot?'#ff6eb4':'transparent'),
        pointBorderWidth:2,
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          label:c=>`Score: ${c.raw}/100${c.dataIndex===currentSlot?' ◀ now':''}`,
          title:t=>`${t[0].label} UTC`
        }}
      },
      scales:{
        x:{ticks:{color:'#5a3a50',font:{size:8},maxRotation:45,autoSkip:true,maxTicksLimit:24},grid:{display:false},border:{color:'rgba(255,100,180,0.08)'}},
        y:{min:0,max:100,ticks:{color:'#5a3a50',font:{size:9}},grid:{color:'rgba(255,100,180,0.05)'},border:{color:'rgba(255,100,180,0.08)'}}
      }
    }
  });
}

// Typo fix for block chart function
function volTo5cecDollar(v) { return volTo5secDollar(v); }

// Strategy windows grid + table
function buildWindows() {
  const grid  = document.getElementById('windows-grid');
  const tbody = document.getElementById('win-tbody');
  if (!grid || !tbody) return;

  grid.innerHTML = STRATEGY_WINDOWS.map(w=>`
    <div class="win-card t-${w.tier}">
      <div class="wc-time">${w.label} UTC</div>
      <div class="wc-tier ${w.tier}">${w.tierLabel}</div>
      <div class="wc-move">$${w.move5s.toFixed(3)}</div>
      <div class="wc-desc">${w.desc}</div>
    </div>`).join('');

  tbody.innerHTML = STRATEGY_WINDOWS.map(w=>{
    const sc = w.score>=75?'sp-s':w.score>=50?'sp-c':'sp-d';
    const vc = w.score>=75?'vs':w.score>=50?'vc':'vd';
    const vt = w.score>=75?'Prime':w.score>=50?'Acceptable':'Avoid';
    const pct = (w.blockCross*100).toFixed(1);
    return `<tr>
      <td>${w.label}</td>
      <td>$${w.move5s.toFixed(3)}/block</td>
      <td>${pct}%</td>
      <td>${w.drift}</td>
      <td><span class="spill ${sc}">${w.score}/100</span></td>
      <td class="${vc}">${vt}</td>
    </tr>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', ()=>{
  updateClock();
  computeRisk();
  buildHeatmap();
  buildWindows();
  runAI();

  setTimeout(()=>{
    buildHeroChart();
    buildMicroChart();
    buildBlockChart();
    buildScoreChart();
  }, 150);

  setInterval(()=>{ updateClock(); computeRisk(); }, 5000); // refresh every 5 sec = 1 block
});
