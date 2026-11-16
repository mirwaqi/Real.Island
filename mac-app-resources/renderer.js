const PRESETS = ['#ff3b40', '#ff9500', '#ffd60a', '#30d158', '#40c8e0', '#0a84ff', '#b392ff', '#ff4f94', '#ffffff'];
const SIDE = 52, ROW2 = 30, ROW3 = 16, NO_NOTCH_ROW = 24;
const $ = (id) => document.getElementById(id);
const ICON_PLAY = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#fff"><path d="M7 4.2v15.6a.8.8 0 0 0 1.2.7l12.2-7.8a.8.8 0 0 0 0-1.4L8.2 3.5A.8.8 0 0 0 7 4.2z"/></svg>';
const ICON_PAUSE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#fff"><rect x="5" y="3.5" width="5" height="17" rx="1.6"/><rect x="14" y="3.5" width="5" height="17" rx="1.6"/></svg>';

let env = { notchHeight: 0, notchWidth: 185, settings: { showTitle: true, bassColor: '#ff3b40', notchWidth: 185, openAtLogin: false, notifications: true, soundcloud: true, calls: true } };
let state = { track: null, permissionProblem: false, notifAccess: 'unknown', scControlHint: false };
let notifQueue = [], notifCurrent = null, notifTimer = null;
let callCurrent = null, callTimer = null;
const SC_LOGO = '<div class="scLogo"><i style="height:5px"></i><i style="height:9px"></i><i style="height:12px"></i><i style="height:8px"></i><i style="height:11px"></i></div>';
let page = 'main';      // 'main' | 'settings'
let collapsed = false;
let weatherFocus = false;
const levels = [0, 0, 0, 0, 0];

function pad(n) { return String(n).padStart(2, '0'); }
function timeText() { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

function render() {
  const notched = env.notchHeight > 0;
  const topH = notched ? env.notchHeight : NO_NOTCH_ROW;
  const width = notched ? env.notchWidth + 2 * SIDE : 250;
  document.documentElement.style.setProperty('--bass', env.settings.bassColor);
  const t = state.track;

  if (page === 'main' && !callCurrent && !notifCurrent && notifQueue.length) return nextNotif();
  const editingWeather = page === 'weather';
  if (editingWeather !== weatherFocus) {
    weatherFocus = editingWeather;
    window.island.weatherFocus(weatherFocus);
  }
  for (const id of ['call', 'notif', 'compact', 'player', 'settings', 'weatherPanel', 'permissionsPanel']) {
    $(id).classList.add('hidden');
  }

  if (page === 'weather') {
    $('weatherTop').style.height = (notched ? env.notchHeight : 10) + 'px';
    $('weatherPanel').classList.remove('hidden');
    $('weatherCity').textContent = env.settings.weatherPlace?.name || 'Город не выбран';
    $('weatherNow').textContent = state.weather ? state.weather.symbol + ' ' + state.weather.title :
      state.weatherError ? 'Прогноз недоступен' :
      env.settings.weatherPlace ? 'Прогноз загружается…' : 'Найди и выбери город';
    $('weatherDetails').textContent = state.weatherError ? 'Не удалось обновить прогноз.' : state.weather?.details || '';
    $('weatherNotices').checked = env.settings.weatherNotices !== false;
    $('weatherRefresh').disabled = !env.settings.weatherPlace;
  } else if (page === 'permissions') {
    $('permissionsTop').style.height = (notched ? env.notchHeight : 10) + 'px';
    $('permissionsPanel').classList.remove('hidden');
  } else if (page === 'settings') {
    $('sTop').style.height = (notched ? env.notchHeight : 10) + 'px';
    $('settings').classList.remove('hidden');
    $('swTitle').classList.toggle('on', !!env.settings.showTitle);
    $('swLogin').classList.toggle('on', !!env.settings.openAtLogin);
    $('notchW').value = env.settings.notchWidth; $('notchWv').textContent = env.settings.notchWidth;
    $('swNotif').classList.toggle('on', env.settings.notifications !== false);
    $('swSc').classList.toggle('on', env.settings.soundcloud !== false);
    $('swCalls').classList.toggle('on', env.settings.calls !== false);
    $('warn').classList.toggle('hidden', !state.permissionProblem);
    $('warnNotif').classList.toggle('hidden', !((env.settings.notifications !== false || env.settings.calls !== false) && state.notifAccess === 'denied'));
    $('warnSc').classList.toggle('hidden', !state.scControlHint);
    drawSwatches();
  } else if (callCurrent) {
    const c = callCurrent, p = $('call');
    p.classList.remove('hidden');
    p.style.width = (notched ? env.notchWidth + 2 * 72 : 300) + 'px';
    $('cr1').style.height = topH + 'px';
    $('cgap').style.width = (notched ? env.notchWidth : 0) + 'px';
    $('cApp').textContent = c.app || '';
    $('cIcon').innerHTML = c.icon ? '<img alt="" src="' + c.icon + '">' : '<span style="font-size:16px">📞</span>';
    $('cName').textContent = c.caller || c.app || '';
    $('cKind').textContent = c.video ? 'Входящий видеозвонок' : 'Входящий звонок';
  } else if (notifCurrent) {
    const n = notifCurrent, p = $('notif');
    p.classList.remove('hidden');
    p.style.width = (notched ? env.notchWidth + 2 * 72 : 300) + 'px';
    $('nr1').style.height = topH + 'px';
    $('ngap').style.width = (notched ? env.notchWidth : 0) + 'px';
    $('nApp').textContent = n.app || '';
    if (n.icon) $('nIcon').innerHTML = '<img alt="" src="' + n.icon + '">';
    else $('nIcon').textContent = n.symbol || '🔔';
    $('nTitle').textContent = n.subtitle ? n.title + ' — ' + n.subtitle : n.title;
    $('nText').textContent = n.body || '';
    $('nText').classList.toggle('hidden', !n.body);
  } else if (!t) {
    const c = $('compact');
    c.classList.remove('hidden');
    c.style.width = (notched ? env.notchWidth : 120) + 'px';
    $('cTop').style.height = (notched ? env.notchHeight : 0) + 'px';
    $('cClock').textContent = timeText();
  } else {
    const p = $('player');
    p.classList.remove('hidden');
    p.style.width = width + 'px';
    p.classList.toggle('collapsed', collapsed && t.playing);
    $('r1').style.height = topH + 'px';
    $('gap').style.width = (notched ? env.notchWidth : 0) + 'px';
    $('clock').textContent = timeText();
    const expanded = !(collapsed && t.playing);
    $('body').classList.toggle('hidden', !expanded);
    $('r3').classList.toggle('hidden', !env.settings.showTitle);
    $('toggle').innerHTML = t.playing ? ICON_PAUSE : ICON_PLAY;
    $('toggle').setAttribute('aria-label', t.playing ? 'Пауза' : 'Воспроизвести');
    $('title').textContent = t.title; $('artist').textContent = t.artist || '';
    $('src').title = t.artist ? t.title + ' — ' + t.artist : t.title;
    $('src').innerHTML = t.brand === 'soundcloud' ? SC_LOGO : t.icon ? '<img alt="" src="' + t.icon + '">' : '<span style="font-size:11px">♪</span>';
  }
  measure();
}

function drawSwatches() {
  const box = $('swatches');
  box.innerHTML = '';
  PRESETS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'sw' + (c.toLowerCase() === String(env.settings.bassColor).toLowerCase() ? ' sel' : '');
    b.style.background = c;
    b.onclick = () => save({ bassColor: c });
    box.appendChild(b);
  });
  const inp = document.createElement('input');
  inp.type = 'color'; inp.value = env.settings.bassColor; inp.title = 'Свой цвет';
  inp.onchange = () => save({ bassColor: inp.value });
  box.appendChild(inp);
}

async function save(patch) { env = await window.island.save(patch); render(); }

let lastW = 0, lastH = 0;
function measure() {
  const r = $('stage').getBoundingClientRect();
  const w = Math.ceil(r.width), h = Math.ceil(r.height);
  if (w !== lastW || h !== lastH) { lastW = w; lastH = h; window.island.resize(w, h); }
}

function showCall(c) {
  clearTimeout(callTimer);
  callCurrent = c;
  page = 'main';
  callTimer = setTimeout(endCall, 40000);
  render();
}
function endCall() { clearTimeout(callTimer); callCurrent = null; render(); }

function nextNotif() {
  clearTimeout(notifTimer);
  notifCurrent = notifQueue.shift() || null;
  if (notifCurrent) notifTimer = setTimeout(nextNotif, 6000);
  render();
}
function pushNotif(n) {
  if (n.weather ? env.settings.weatherNotices === false : env.settings.notifications === false) return;
  if (n.weather) notifQueue = notifQueue.filter(item => !item.weather);
  notifQueue.push(n);
  if (notifQueue.length > 5) notifQueue.shift();
  if (!notifCurrent && (!n.weather || (page === 'main' && !callCurrent))) nextNotif();
}

$('openWeather').onclick = () => { page = 'weather'; render(); };
$('openPermissions').onclick = () => { page = 'permissions'; render(); };
$('weatherBack').onclick = $('permissionsBack').onclick = () => { page = 'settings'; render(); };
async function openPermission(open) {
  try { await open(); $('permissionsStatus').textContent = ''; }
  catch (_) { $('permissionsStatus').textContent = 'Не удалось открыть системные настройки.'; }
}
$('allowNotifications').onclick = () => openPermission(() => window.island.openPrivacy());
$('allowAutomation').onclick = () => openPermission(() => window.island.openAutomation());
$('weatherNotices').onchange = () => save({ weatherNotices: $('weatherNotices').checked });
$('weatherRefresh').onclick = () => window.island.weatherRefresh();
$('weatherForm').onsubmit = async (event) => {
  event.preventDefault();
  const query = $('weatherQuery').value.trim();
  const results = $('weatherResults');
  const status = $('weatherStatus');
  results.replaceChildren();
  if (query.length < 2) { status.textContent = 'Введи название города или индекс.'; measure(); return; }
  $('weatherSearch').disabled = true;
  status.textContent = 'Ищу город…';
  measure();
  try {
    const places = await window.island.weatherSearch(query);
    status.textContent = places.length ? '' : 'Город не найден. Уточни название.';
    for (const place of places) {
      const button = document.createElement('button');
      button.className = 'tool';
      button.textContent = place.name;
      if (place.region) {
        const region = document.createElement('small');
        region.textContent = place.region;
        button.appendChild(region);
      }
      button.onclick = async () => {
        env = await window.island.weatherSelect(place);
        $('weatherQuery').value = '';
        results.replaceChildren();
        status.textContent = '';
        render();
      };
      results.appendChild(button);
    }
  } catch (_) { status.textContent = 'Не удалось найти город. Попробуй позже.'; }
  finally { $('weatherSearch').disabled = false; measure(); }
};

// Анимация басс-полосок (имитация, пока играет музыка)
function frame(ts) {
  const playing = state.track && state.track.playing && page === 'main';
  const bars = $('bars').children;
  const s = ts / 1000;
  const beat = Math.pow(Math.max(0, Math.sin(s * Math.PI * 2 * 2.1)), 3);
  for (let i = 0; i < 5; i++) {
    const wob = (Math.sin(s * (3.1 + i * 1.3) + i * 1.9) * 0.5 + 0.5) * 0.45;
    const punch = (i < 2 ? 0.55 : 0.28) * beat;
    const target = playing ? Math.min(1, 0.12 + wob + punch) : 0;
    levels[i] += (target - levels[i]) * 0.28;
    bars[i].style.height = (3 + levels[i] * 13).toFixed(1) + 'px';
  }
  requestAnimationFrame(frame);
}

$('clock').onclick = () => {
  if (state.track && state.track.playing) { collapsed = !collapsed; render(); }
};
$('prev').onclick = () => window.island.cmd('prev');
$('next').onclick = () => window.island.cmd('next');
$('toggle').onclick = () => {
  if (state.track) { state.track.playing = !state.track.playing; collapsed = false; render(); }
  window.island.cmd('toggle');
};
$('src').onclick = () => window.island.openApp();
$('nBody').onclick = () => { if (notifCurrent && notifCurrent.appPath) window.island.openPath(notifCurrent.appPath); nextNotif(); };
$('swNotif').onclick = () => save({ notifications: env.settings.notifications === false });
$('swSc').onclick = () => save({ soundcloud: env.settings.soundcloud === false });
$('openPrivacy').onclick = () => window.island.openPrivacy();
$('demoNotif').onclick = () => { page = 'main'; pushNotif({ app: 'Сообщения', appPath: null, icon: null, title: 'Пример', body: 'Так будет выглядеть новое сообщение на острове.' }); render(); };
$('cOpen').onclick = () => { if (callCurrent && callCurrent.appPath) window.island.openPath(callCurrent.appPath); endCall(); };
$('cHide').onclick = () => endCall();
$('swCalls').onclick = () => save({ calls: env.settings.calls === false });
$('demoCall').onclick = () => showCall({ app: 'Telegram', appPath: null, icon: null, caller: 'Анна', video: false });
$('menu').onclick = () => { page = 'settings'; render(); };
$('compact').onclick = () => { page = 'settings'; render(); };
$('done').onclick = () => { page = 'main'; render(); };
$('swTitle').onclick = () => save({ showTitle: !env.settings.showTitle });
$('swLogin').onclick = () => save({ openAtLogin: !env.settings.openAtLogin });
$('resetColor').onclick = () => save({ bassColor: '#ff3b40' });
$('notchW').oninput = (e) => { $('notchWv').textContent = e.target.value; };
$('notchW').onchange = (e) => save({ notchWidth: Number(e.target.value) });
$('quit').onclick = () => window.island.quit();

window.island.onState((s) => { state = s; if (!s.track) collapsed = false; render(); });
window.island.onNotif(pushNotif);
window.island.onCall((c) => { if (env.settings.calls !== false) showCall(c); });
window.island.onCallEnd(() => endCall());
window.island.onEnv((e) => { env = e; render(); });
window.island.onOpenSettings(() => { page = 'settings'; render(); });

(async () => {
  const init = await window.island.init();
  env = init.env; state = init.state;
  render();
  setInterval(() => {
    if (state.track && page === 'main') $('clock').textContent = timeText();
    $('cClock').textContent = timeText();
  }, 5000);
  requestAnimationFrame(frame);
})();
