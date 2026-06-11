/* ── Config ───────────────────────────────────────────── */
const DECAY_KM    = 2000;
const STORAGE_KEY = 'findaflock_guess';
const HISTORY_KEY     = 'findaflock_history';

/* ── State ────────────────────────────────────────────── */
let map, currentPuzzle;
let hasGuessed = false;
let maxScore   = 500;

/* ── Boot ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);


async function init() {
  initHeaderBirds();
  setHeaderDate();
  currentPuzzle = await loadPuzzle();
  if (!currentPuzzle) { showLoadError(); return; }
  maxScore = calcMaxScore(currentPuzzle.hull);
  const mEl = document.getElementById('modal-max-score');
  if (mEl) mEl.textContent = maxScore;
  applyDifficultyTheme();
  populateSpecies(currentPuzzle.species);
  initMap();
  loadRegionBoundary();
  setupModal();
  assignStatBirds();
  checkPreviousGuess();
  showStats();
  initTestMode();
  initMobileMapToggle();
}

/* ── Mobile open/hide map button ──────────────────────── */
function initMobileMapToggle() {
  const btn = document.getElementById('open-map-btn');
  const layout = document.getElementById('layout');
  if (!btn || !layout) return;
  btn.addEventListener('click', () => {
    const open = layout.classList.toggle('map-open');
    btn.textContent = open ? 'Hide Map' : 'Open Map';
    if (open && map) map.invalidateSize();
  });
}

/* ── Header birds + favicon ───────────────────────────── */
function initHeaderBirds() {
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = BIRD_IMAGES[18]; // Eastern Bluebird

  // BEKI, EWVI, NOYW, AMRO, SCTA
  const indices = [8, 130, 33, 4, 42];
  const container = document.getElementById('header-birds');
  if (!container) return;
  indices.forEach(idx => {
    const img = document.createElement('img');
    img.className = 'header-bird';
    img.src = BIRD_IMAGES[idx];
    img.alt = '';
    container.appendChild(img);
  });
}

/* ── Date helpers ─────────────────────────────────────── */
function getTodayStr() {
  // Allow ?date=YYYY-MM-DD override for development/testing
  const params = new URLSearchParams(window.location.search);
  if (params.has('date')) return params.get('date');
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-');
}

function setHeaderDate() {
  const dateStr = getTodayStr();
  const [y, m, d] = dateStr.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  document.getElementById('header-date').textContent = label;
}

/* ── Puzzle loading ───────────────────────────────────── */
async function loadPuzzle() {
  const dateStr = getTodayStr();
  try {
    const res = await fetch(`puzzles/${dateStr}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error('Failed to load puzzle:', e);
    return null;
  }
}

function showLoadError() {
  document.getElementById('state-prompt').innerHTML =
    '<p style="color:var(--dim);font-family:\'VT323\',monospace;font-size:1.1rem;text-align:center;padding:20px 0">No puzzle found for today.<br>Check back soon!</p>';
}

/* ── Species list ─────────────────────────────────────── */
function populateSpecies(species) {
  const ul = document.getElementById('species-list');
  species.forEach((name, i) => {
    const li = document.createElement('li');
    li.className = 'species-item';
    li.innerHTML = `<span class="species-num">${i + 1}</span><span class="species-name">${name}</span>`;
    ul.appendChild(li);
  });
}

/* ── Map ──────────────────────────────────────────────── */
function initMap() {
  map = L.map('map', {
    center: [47, -97],
    zoom: 3,
    minZoom: 2,
    maxZoom: 12,
    zoomControl: true
  });

  // CartoDB Positron — clean light base
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  map.on('click', onMapClick);

  // Scale the 256×256 Tree Swallow pixel art down to a 32×32 cursor
  const mapEl = document.getElementById('map');
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const cursorImg = new Image();
  cursorImg.onload = () => {
    ctx.drawImage(cursorImg, 0, 0, 32, 32);
    mapEl.style.cursor = `url("${canvas.toDataURL()}") 16 16, crosshair`;
  };
  cursorImg.src = BIRD_IMAGES[116];
}

async function loadRegionBoundary() {
  try {
    const res = await fetch('region.geojson');
    if (!res.ok) return;
    const data = await res.json();
    L.geoJSON(data, {
      style: {
        color: '#8a7a6a',
        weight: 1.5,
        fillOpacity: 0,
        dashArray: '6 8',
        opacity: 0.55
      },
      interactive: false
    }).addTo(map);
  } catch (_) {}
}

function onMapClick(e) {
  if (hasGuessed) return;
  handleGuess(e.latlng.lat, e.latlng.lng, false);
}

/* ── Guess logic ──────────────────────────────────────── */
function handleGuess(lat, lng, fromStorage) {
  hasGuessed = true;

  const score   = calcScore(lat, lng, currentPuzzle.hull);
  const distKm  = distToPolygon(lat, lng, currentPuzzle.hull);

  placeGuessMarker(lat, lng);
  revealPolygon(currentPuzzle.hull);
  if (distKm > 0) drawDistanceLine(lat, lng, currentPuzzle.hull);
  if (score >= maxScore) explodeBirds(lat, lng);
  if (!fromStorage) saveGuess(lat, lng, score);
  showResult(score, distKm);
  hideMapHint();
  const mapEl2 = document.getElementById('map');
  mapEl2.classList.add('guessed');
  mapEl2.style.cursor = 'default';
}

/* ── Scoring ──────────────────────────────────────────── */
function calcMaxScore(hull) {
  const areaSqKm = turf.area(turf.feature(hull)) / 1e6;
  if (areaSqKm < 200000)    return 1000;  // Very Hard
  if (areaSqKm < 500000)   return 750;   // Hard
  if (areaSqKm < 1500000)  return 500;   // Medium
  return 250;                             // Easy
}

function applyDifficultyTheme() {
  const { label, color } = difficultyInfo(maxScore);

  // Pre-guess badge
  const badge = document.getElementById('pre-guess-badge');
  if (badge) {
    badge.textContent       = `${label} · ${maxScore} MAX`;
    badge.style.color       = color;
    badge.style.borderColor = color;
    badge.classList.remove('hidden');
  }

  // Color both panel borders
  const prompt = document.getElementById('state-prompt');
  const result = document.getElementById('state-result');
  if (prompt) prompt.style.borderColor = color;
  if (result) result.style.borderColor = color;
}

function difficultyInfo(score) {
  if (score === 1000) return { label: 'VERY HARD', color: '#a83020' };
  if (score === 750)  return { label: 'HARD',      color: '#b06820' };
  if (score === 500)  return { label: 'MEDIUM',    color: '#c8a820' };
  return                     { label: 'EASY',      color: '#2a5a1a' };
}

function calcScore(lat, lng, hull) {
  const pt  = turf.point([lng, lat]);
  const poly = turf.feature(hull);
  if (turf.booleanPointInPolygon(pt, poly)) return maxScore;
  const d = distToPolygon(lat, lng, hull);
  return Math.max(0, Math.round(maxScore * Math.exp(-d / DECAY_KM)));
}

function distToPolygon(lat, lng, hull) {
  const pt   = turf.point([lng, lat]);
  const poly = turf.feature(hull);
  if (turf.booleanPointInPolygon(pt, poly)) return 0;
  const line    = turf.polygonToLine(poly);
  const nearest = turf.nearestPointOnLine(line, pt);
  return turf.distance(pt, nearest); // km
}

/* ── Map visuals ──────────────────────────────────────── */
function placeGuessMarker(lat, lng) {
  const icon = L.divIcon({
    className: '',
    html: '<div class="guess-pin-outer"><div class="guess-pin"></div></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
  L.marker([lat, lng], { icon }).addTo(map);
}

function revealPolygon(hull) {
  const { color } = difficultyInfo(maxScore);
  L.geoJSON({ type: 'Feature', geometry: hull }, {
    style: {
      fillColor: color,
      fillOpacity: 0.18,
      color: color,
      weight: 2,
      dashArray: null
    }
  }).addTo(map);
}

function drawDistanceLine(lat, lng, hull) {
  const pt      = turf.point([lng, lat]);
  const poly    = turf.feature(hull);
  const line    = turf.polygonToLine(poly);
  const nearest = turf.nearestPointOnLine(line, pt);
  const [nLng, nLat] = nearest.geometry.coordinates;

  L.polyline([[lat, lng], [nLat, nLng]], {
    color: '#9CA3AF',
    weight: 1.5,
    dashArray: '5 5'
  }).addTo(map);
}

function hideMapHint() {
  document.getElementById('map-hint').classList.add('hidden');
}

/* ── Result panel ─────────────────────────────────────── */
function showResult(score, distKm) {
  document.getElementById('state-prompt').classList.add('hidden');
  const panel = document.getElementById('state-result');
  panel.classList.remove('hidden');

  // Difficulty badge
  const diff  = difficultyInfo(maxScore);
  const badge = document.getElementById('difficulty-badge');
  if (badge) {
    badge.textContent       = `${diff.label} · ${maxScore} MAX`;
    badge.style.color       = diff.color;
    badge.style.borderColor = diff.color;
    badge.classList.remove('hidden');
  }

  // Animated score counter
  animateScore(score);
  document.getElementById('score-value').style.color = scoreColor(score);

  // Stats
  showStats();

  // Message
  document.getElementById('result-message').textContent = resultMessage(score);

  // Distance text
  const distEl = document.getElementById('distance-text');
  if (distKm === 0) {
    distEl.textContent = 'You got it!';
  } else {
    distEl.textContent = `${Math.round(distKm).toLocaleString()} km from the zone`;
  }

  // Share button
  document.getElementById('share-btn').addEventListener('click', shareResult);

  // Learn more links
  showLearnMore(currentPuzzle.species);
}

function animateScore(target) {
  const el = document.getElementById('score-value');
  const duration = 900;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(ease * target);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function scoreColor(score) {
  if (score >= maxScore * 0.9) return '#2a5a1a';
  if (score >= maxScore * 0.6) return '#c8a820';
  if (score >= maxScore * 0.3) return '#b06820';
  return '#a83020';
}

function resultMessage(score) {
  if (score >= maxScore)        return 'Nailed it';
  if (score >= maxScore * 0.8)  return 'So close!';
  if (score >= maxScore * 0.56) return 'Close-ish';
  if (score >= maxScore * 0.3)  return 'Not there!';
  if (score >= maxScore * 0.1)  return '...darn';
  return 'for flocks sake...';
}

/* ── Stat birds ───────────────────────────────────────── */
function assignStatBirds() {
  // Great Horned Owl, Osprey, Western Bluebird, Scarlet Tanager
  const indices = [22, 34, 95, 42];
  document.querySelectorAll('.stat-bird').forEach((img, i) => {
    img.src = BIRD_IMAGES[indices[i]];
  });
}

/* ── Bird explosion ───────────────────────────────────── */
function explodeBirds(lat, lng) {
  const wrapper = document.getElementById('map-wrapper');
  const pt      = map.latLngToContainerPoint([lat, lng]);
  const count   = 20;

  // Pick 20 random (non-repeating where possible) bird images
  const shuffled = [...BIRD_IMAGES].sort(() => Math.random() - 0.5);

  for (let i = 0; i < count; i++) {
    const img    = document.createElement('img');
    img.className = 'bird-particle';
    img.src       = shuffled[i % shuffled.length];

    const angle = (i / count) * 360 + (Math.random() - 0.5) * 25;
    const dist  = 60 + Math.random() * 100;
    const dx    = Math.cos(angle * Math.PI / 180) * dist;
    const dy    = Math.sin(angle * Math.PI / 180) * dist;

    img.style.left   = pt.x + 'px';
    img.style.top    = pt.y + 'px';
    img.style.setProperty('--dx', dx + 'px');
    img.style.setProperty('--dy', dy + 'px');
    img.style.animationDelay = (Math.random() * 100) + 'ms';

    wrapper.appendChild(img);
    setTimeout(() => img.remove(), 2400);
  }
}

/* ── Learn more ───────────────────────────────────────── */
function showLearnMore(species) {
  const section = document.getElementById('learn-more');
  const ul      = document.getElementById('learn-more-list');
  ul.innerHTML  = '';

  species.forEach(name => {
    const slug = name.replace(/'/g, '').replace(/ /g, '_');
    const url  = `https://www.allaboutbirds.org/guide/${slug}/overview`;
    const li   = document.createElement('li');
    li.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>`;
    ul.appendChild(li);
  });

  section.classList.remove('hidden');
}

/* ── Share ────────────────────────────────────────────── */
const SHARE_PHRASES = [
  "If you're not flockin', you ain't rockin'.",
  "Flock it like it's hot.",
  "Tick-Tock, time to flock.",
  "If u talk the talk, u gotta flock the flock.",
  "Meet the Flockers.",
  "Stop squawking, start flocking.",
  "Bird brain activated.",
  "These flocks aren't gonna find themselves!",
  "Flock around and find out (where these birds overlap).",
  "This game will knock your flocks off!",
  "I need a flocktail after that score...",
  "Twist it, pull it, flick it, flock it."
];

function shareResult() {
  const score   = parseInt(document.getElementById('score-value').textContent, 10);
  const dateStr = getTodayStr();
  const emoji   = score >= maxScore ? '🟢' : score >= maxScore * 0.6 ? '🟡' : score >= maxScore * 0.3 ? '🟠' : '🔴';
  const phrase  = SHARE_PHRASES[Math.floor(Math.random() * SHARE_PHRASES.length)];
  const text    = `Find-A-Flock — ${dateStr}\n${emoji} ${score}/${maxScore} pts\n\n🐦 ${phrase}\nfind-a-flock.com`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
  } else {
    showToast('Copy this:\n' + text);
  }
}

/* ── LocalStorage ─────────────────────────────────────── */
function saveGuess(lat, lng, score) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    date: getTodayStr(), lat, lng, score
  }));
  saveHistory(score);
}

function saveHistory(score) {
  const history = loadHistory();
  const today   = getTodayStr();
  const idx     = history.findIndex(e => e.date === today);
  if (idx >= 0) { history[idx].score = score; history[idx].maxScore = maxScore; }
  else history.push({ date: today, score, maxScore });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}

function calcStreak(entries) {
  const today     = getTodayStr();
  const yesterday = offsetDate(today, -1);
  const dateSet   = new Set(entries.map(e => e.date));
  const start     = dateSet.has(today) ? today : dateSet.has(yesterday) ? yesterday : null;
  if (!start) return 0;
  let n = 0, d = start;
  while (dateSet.has(d)) { n++; d = offsetDate(d, -1); }
  return n;
}

function showStats() {
  const history = loadHistory();
  if (history.length === 0) return;
  const totalScore    = history.reduce((s, e) => s + e.score, 0);
  const streak        = calcStreak(history);
  const perfectFlocks = history.filter(e => e.score === (e.maxScore ?? 500)).length;
  const perfectStreak = calcStreak(history.filter(e => e.score === (e.maxScore ?? 500)));

  document.getElementById('stat-total').textContent   = totalScore.toLocaleString();
  document.getElementById('stat-streak').textContent  = streak;
  document.getElementById('stat-perfect').textContent = perfectFlocks;
  document.getElementById('stat-pstreak').textContent = perfectStreak;
  document.getElementById('stats-grid').classList.remove('hidden');
  renderHistoryBars(history);
}

function tierColor(ms) {
  if (ms >= 1000) return '#a83020'; // Very Hard — red
  if (ms >= 750)  return '#b06820'; // Hard — orange
  if (ms >= 500)  return '#2a4a8a'; // Medium — blue
  return '#2a5a1a';                 // Easy — green
}

function renderHistoryBars(history) {
  const container = document.getElementById('history-bars');
  if (!container) return;
  container.innerHTML = '<p class="history-heading">HISTORY</p>';
  container.classList.remove('hidden');

  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  sorted.forEach(entry => {
    const ms  = entry.maxScore ?? 500;
    const pct = Math.round((entry.score / ms) * 100);

    const row  = document.createElement('div');
    row.className = 'history-bar-row';
    row.title = `${entry.date}: ${entry.score}/${ms} pts`;

    const fill = document.createElement('div');
    fill.className = 'history-bar';
    fill.style.background = tierColor(ms);
    fill.style.width = '0%';
    row.appendChild(fill);
    container.appendChild(row);

    // Animate fill after paint
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.width = pct + '%';
    }));
  });
}

function checkPreviousGuess() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.date === getTodayStr()) {
      handleGuess(saved.lat, saved.lng, true);
    }
  } catch (_) { /* ignore corrupt storage */ }
}

/* ── Modal ────────────────────────────────────────────── */
const HIDE_MODAL_KEY = 'findaflock_hide_howtoplay';

function setupModal() {
  const overlay  = document.getElementById('modal-overlay');
  const checkbox = document.getElementById('dont-show-again');

  // Auto-show on first visit
  if (localStorage.getItem(HIDE_MODAL_KEY) !== 'true') {
    overlay.classList.remove('hidden');
  }

  // Reflect saved preference in checkbox
  checkbox.checked = localStorage.getItem(HIDE_MODAL_KEY) === 'true';

  // Save preference immediately when toggled
  checkbox.addEventListener('change', () => {
    localStorage.setItem(HIDE_MODAL_KEY, checkbox.checked ? 'true' : 'false');
  });

  document.getElementById('how-to-play-btn').addEventListener('click', () => overlay.classList.remove('hidden'));
  document.getElementById('modal-close').addEventListener('click',      () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
}

/* ── Test mode ────────────────────────────────────────── */
function initTestMode() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('test')) return;

  const dateStr = getTodayStr();

  const bar = document.createElement('div');
  bar.id = 'test-bar';
  bar.innerHTML = `
    <span class="test-label">🧪 TEST</span>
    <button id="test-prev" title="Previous day">◄</button>
    <span id="test-date">${dateStr}</span>
    <button id="test-next" title="Next day">►</button>
    <button id="test-reset" title="Reset today's guess so you can replay">RESET DAY</button>
  `;
  document.body.appendChild(bar);

  document.getElementById('test-prev').addEventListener('click', () => {
    navigate(offsetDate(dateStr, -1));
  });
  document.getElementById('test-next').addEventListener('click', () => {
    navigate(offsetDate(dateStr, 1));
  });
  document.getElementById('test-reset').addEventListener('click', () => {
    // Remove today's guess and history entry so the day can be replayed
    localStorage.removeItem(STORAGE_KEY);
    const history = loadHistory().filter(e => e.date !== dateStr);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    location.reload();
  });

  function navigate(date) {
    window.location.href = `?test=1&date=${date}`;
  }
}

/* ── Toast ────────────────────────────────────────────── */
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 2400);
}
