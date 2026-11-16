const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WEATHER_INTERVAL, placeFrom, findPlaces, getForecast } = require('./weather');

if (!app.requestSingleInstanceLock()) { app.quit(); }
if (app.dock) app.dock.hide();

const DEFAULTS = { showTitle: true, bassColor: '#ff3b40', notchWidth: 185, openAtLogin: false, notifications: true, soundcloud: true, calls: true, weatherPlace: null, weatherNotices: true };
let settings = { ...DEFAULTS };
let win = null, tray = null, current = null, lastSent = '', lastPlayerId = null;
let permissionProblem = false, notifAccess = 'unknown', scControlHint = false;
let lastBrowser = null;
const iconCache = {};

const PLAYERS = [
  { id: 'spotify', proc: 'Spotify', app: 'Spotify', icon: '/Applications/Spotify.app' },
  { id: 'music', proc: 'Music', app: 'Music', icon: '/System/Applications/Music.app' }
];
const BROWSERS = [
  { app: 'Google Chrome', proc: 'Google Chrome', kind: 'chrome', path: '/Applications/Google Chrome.app' },
  { app: 'Arc', proc: 'Arc', kind: 'chrome', path: '/Applications/Arc.app' },
  { app: 'Brave Browser', proc: 'Brave Browser', kind: 'chrome', path: '/Applications/Brave Browser.app' },
  { app: 'Microsoft Edge', proc: 'Microsoft Edge', kind: 'chrome', path: '/Applications/Microsoft Edge.app' },
  { app: 'Safari', proc: 'Safari', kind: 'safari', path: '/Applications/Safari.app' }
];

function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch (_) {}
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch (_) {}
}

function osa(script, flagJs) {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 5000 }, (err, out, errOut) => {
      if (err) {
        const text = String(errOut) + String(err);
        if (/-1743|not authorized|не разрешено|Not authorized/i.test(text)) permissionProblem = true;
        if (flagJs && /JavaScript|Apple ?Events/i.test(text)) scControlHint = true;
        resolve(null);
      } else resolve(String(out).trim());
    });
  });
}
function isRunning(proc) {
  return new Promise((resolve) => execFile('/usr/bin/pgrep', ['-x', proc], (err) => resolve(!err)));
}

// ---------- Apple Music и Spotify ----------
async function readPlayer(p) {
  if (!(await isRunning(p.proc))) return null;
  const out = await osa(
    'tell application "' + p.app + '"\n' +
    'if player state is stopped then return ""\n' +
    'return (name of current track) & "||" & (artist of current track) & "||" & (player state as text)\n' +
    'end tell');
  if (!out) return null;
  const parts = out.split('||');
  if (parts.length < 3) return null;
  return { player: p.id, title: parts[0], artist: parts[1], playing: parts[2].trim() === 'playing' };
}

async function iconFor(p) {
  if (iconCache[p.id] !== undefined) return iconCache[p.id];
  try {
    const img = await app.getFileIcon(p.icon, { size: 'large' });
    iconCache[p.id] = img.isEmpty() ? null : img.resize({ width: 64, height: 64 }).toDataURL();
  } catch (_) { iconCache[p.id] = null; }
  return iconCache[p.id];
}

// ---------- SoundCloud в браузере ----------
function audioPlaying() {
  return new Promise((resolve) => execFile('/usr/bin/pmset', ['-g', 'assertions'], { timeout: 3000 }, (err, out) => {
    resolve(!err && /Playing audio|com\.apple\.audio\.[^\n]*prevent(user)?idle|Media Playback/i.test(String(out)));
  }));
}
function cleanSoundCloudTitle(raw) {
  let t = String(raw || '').replace(/^[▶⏸\s]+/, '').replace(/\s*\|\s*(Free Listening on )?SoundCloud\s*$/i, '').trim();
  let artist = '';
  if (/^(Stream|Discover|Home|Library|Likes|Feed|SoundCloud)\b/i.test(t)) return { title: 'SoundCloud', artist: '' };
  const i = t.lastIndexOf(' by ');
  if (i > 0) { artist = t.slice(i + 4).trim(); t = t.slice(0, i).trim(); }
  return { title: t || 'SoundCloud', artist };
}
async function readSoundCloud() {
  for (const b of BROWSERS) {
    if (!(await isRunning(b.proc))) continue;
    const titleProp = b.kind === 'safari' ? 'name' : 'title';
    const out = await osa(
      'tell application "' + b.app + '"\n' +
      'set out to ""\n' +
      'repeat with w in windows\n' +
      'repeat with t in tabs of w\n' +
      'set u to URL of t\n' +
      'if u contains "soundcloud.com" then set out to out & (' + titleProp + ' of t) & "||" & u & linefeed\n' +
      'end repeat\n' +
      'end repeat\n' +
      'return out\n' +
      'end tell');
    if (!out) continue;
    const first = out.split('\n').filter(Boolean)[0];
    if (!first) continue;
    if (!(await audioPlaying())) return null;
    lastBrowser = b;
    const c = cleanSoundCloudTitle(first.split('||')[0]);
    return { player: 'soundcloud', title: c.title, artist: c.artist, playing: true, icon: null, brand: 'soundcloud' };
  }
  return null;
}
async function controlSoundCloud(action) {
  const b = lastBrowser;
  if (!b) return;
  const sel = { prev: '.skipControl__previous', next: '.skipControl__next', toggle: '.playControl' }[action];
  if (!sel) return;
  const js = "var e=document.querySelector('" + sel + "'); if(e) e.click();";
  const run = b.kind === 'safari' ? 'do JavaScript "' + js + '" in t' : 'execute t javascript "' + js + '"';
  await osa(
    'tell application "' + b.app + '"\n' +
    'repeat with w in windows\n' +
    'repeat with t in tabs of w\n' +
    'if URL of t contains "soundcloud.com" then\n' + run + '\nreturn\nend if\n' +
    'end repeat\n' +
    'end repeat\n' +
    'end tell', true);
}

async function poll() {
  const found = [];
  for (const p of PLAYERS) {
    const t = await readPlayer(p);
    if (t) found.push(t);
  }
  let pick = found.find((t) => t.playing) || found.find((t) => t.player === lastPlayerId) || found[0] || null;
  if (pick) {
    lastPlayerId = pick.player;
    const meta = PLAYERS.find((p) => p.id === pick.player);
    pick.icon = await iconFor(meta);
  }
  if ((!pick || !pick.playing) && settings.soundcloud) {
    const sc = await readSoundCloud();
    if (sc) { pick = sc; lastPlayerId = 'soundcloud'; }
  }
  current = pick;
  pushState();
}

let weather = null, weatherError = false, weatherRequest = 0, weatherTimer;

function statePayload() { return { track: current, permissionProblem, notifAccess, scControlHint, weather, weatherError }; }

async function refreshWeather(announce = false) {
  const place = placeFrom(settings.weatherPlace);
  if (!place) return;
  const request = ++weatherRequest;
  let forecast;
  try { forecast = await getForecast(place); }
  catch (_) {
    if (request === weatherRequest) { weatherError = true; pushState(); }
    return;
  }
  if (request !== weatherRequest) return;
  weather = forecast;
  weatherError = false;
  pushState();
  if (announce && settings.weatherNotices && win && !win.isDestroyed()) {
    win.webContents.send('notif', { app: 'Погода', title: forecast.city + ' · ' + forecast.title,
      body: forecast.details, symbol: forecast.symbol, weather: true });
  }
}

function scheduleWeather() {
  clearInterval(weatherTimer);
  refreshWeather(true);
  weatherTimer = setInterval(() => refreshWeather(true), WEATHER_INTERVAL);
}
function pushState() {
  const payload = statePayload();
  const text = JSON.stringify(payload);
  if (text === lastSent) return;
  lastSent = text;
  if (win && !win.isDestroyed()) win.webContents.send('state', payload);
}

// ---------- Уведомления других программ ----------
let darwinDir = null, notifBaseline = null, notifBusy = false;
const appCache = {};
function getDarwinDir() {
  return new Promise((resolve) => execFile('/usr/bin/getconf', ['DARWIN_USER_DIR'], (e, o) => resolve(e ? null : String(o).trim())));
}
async function findNotificationDb() {
  if (!darwinDir) darwinDir = await getDarwinDir();
  const cands = [];
  if (darwinDir) cands.push(path.join(darwinDir, 'com.apple.notificationcenter', 'db2', 'db'));
  cands.push(path.join(os.homedir(), 'Library', 'Group Containers', 'group.com.apple.usernoted', 'db2', 'db'));
  let denied = false;
  for (const c of cands) {
    try { fs.accessSync(c, fs.constants.R_OK); return { path: c }; }
    catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') denied = true; }
  }
  return { denied };
}
function copyDb(src) {
  const dir = path.join(app.getPath('temp'), 'realisland-nc');
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, 'db');
  for (const suf of ['', '-wal', '-shm']) {
    try { fs.copyFileSync(src + suf, dst + suf); }
    catch (e) { if (suf === '') throw e; try { fs.rmSync(dst + suf, { force: true }); } catch (_) {} }
  }
  return dst;
}
function sql(dbFile, query) {
  return new Promise((resolve) => execFile('/usr/bin/sqlite3', ['-separator', '\t', dbFile, query],
    { timeout: 6000, maxBuffer: 16 * 1024 * 1024 }, (e, out) => resolve(e ? null : String(out))));
}
function plistToXml(buf) {
  return new Promise((resolve) => {
    const p = execFile('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', '-'], { maxBuffer: 4 * 1024 * 1024 },
      (e, out) => resolve(e ? null : String(out)));
    p.stdin.on('error', () => {});
    p.stdin.end(buf);
  });
}
function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function xmlValue(xml, key) {
  const m = xml.match(new RegExp('<key>' + key + '</key>\\s*<string>([\\s\\S]*?)</string>'));
  return m ? decodeXml(m[1]).trim() : '';
}
async function appInfo(id) {
  if (appCache[id]) return appCache[id];
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '');
  const p = await new Promise((resolve) => execFile('/usr/bin/mdfind', ['kMDItemCFBundleIdentifier == "' + safe + '"'],
    (e, o) => resolve(e ? '' : String(o).split('\n')[0].trim())));
  const info = { id, name: safe.split('.').pop(), path: p || null, icon: null };
  if (p) {
    info.name = path.basename(p).replace(/\.app$/i, '');
    try {
      const im = await app.getFileIcon(p, { size: 'large' });
      if (!im.isEmpty()) info.icon = im.resize({ width: 64, height: 64 }).toDataURL();
    } catch (_) {}
  }
  appCache[id] = info;
  return info;
}
// ---------- Звонки из мессенджеров (по уведомлениям) ----------
const CALL_APPS = new Set([
  'com.hnc.Discord', 'ru.keepcoder.Telegram', 'org.telegram.desktop', 'com.tdesktop.Telegram',
  'net.whatsapp.WhatsApp', 'desktop.WhatsApp', 'com.viber.osx', 'us.zoom.xos',
  'com.microsoft.teams2', 'com.microsoft.teams', 'com.skype.skype', 'org.whispersystems.signal-desktop',
  'com.apple.FaceTime', 'com.apple.TelephonyUtilities', 'com.facebook.archon', 'com.facebook.archon.developerID',
  'com.tinyspeck.slackmacgap', 'jp.naver.line.mac', 'com.tencent.xinWeChat'
]);
const CALL_MISSED = /missed|пропущ/i;
const CALL_ENDED = /ended|declined|завершён|завершен|окончен|отклон/i;
const CALL_WORDS = /incoming\s+(video\s+|voice\s+|audio\s+)?call|is calling|calling you|ringing|входящ\S*\s+(видео)?(звонок|вызов)|звонит|видеозвонок|вызывает|calling…|calling\.\.\./i;
function classifyCall(ident, title, sub, body) {
  const text = [title, sub, body].join(' ');
  if (CALL_MISSED.test(text) || CALL_ENDED.test(text)) return null;
  if (CALL_WORDS.test(text)) return { video: /video|видео/i.test(text) };
  if (CALL_APPS.has(ident) && /\bcall\b|звон|вызов/i.test(text)) return { video: /video|видео/i.test(text) };
  return null;
}
let activeCall = null;
function sendCall(c) { if (win && !win.isDestroyed()) win.webContents.send('call', c); }
function sendCallEnd() { activeCall = null; if (win && !win.isDestroyed()) win.webContents.send('call-end'); }

function sendNotification(n) {
  if (win && !win.isDestroyed()) win.webContents.send('notif', n);
}
async function pollNotifications() {
  if ((!settings.notifications && settings.calls === false) || notifBusy) return;
  notifBusy = true;
  try {
    const found = await findNotificationDb();
    if (!found.path) { notifAccess = found.denied ? 'denied' : 'missing'; pushState(); return; }
    let dbFile;
    try { dbFile = copyDb(found.path); }
    catch (e) { notifAccess = (e.code === 'EPERM' || e.code === 'EACCES') ? 'denied' : 'missing'; pushState(); return; }
    notifAccess = 'ok';
    if (notifBaseline === null) {
      const out = await sql(dbFile, 'select ifnull(max(rec_id),0) from record;');
      notifBaseline = parseInt(out, 10) || 0;
      pushState();
      return;
    }
    if (activeCall) {
      const alive = await sql(dbFile, 'select count(*) from record where rec_id = ' + activeCall.recId + ';');
      if (alive !== null && parseInt(alive, 10) === 0) sendCallEnd();
    }
    const out = await sql(dbFile,
      'select r.rec_id, a.identifier, hex(r.data) from record r join app a on a.app_id = r.app_id ' +
      'where r.rec_id > ' + notifBaseline + ' order by r.rec_id limit 8;');
    pushState();
    if (!out) return;
    for (const line of out.split('\n').filter(Boolean)) {
      const [id, ident, hex] = line.split('\t');
      notifBaseline = Math.max(notifBaseline, parseInt(id, 10) || 0);
      if (!ident || !hex || ident === 'com.realisland.apple') continue;
      const xml = await plistToXml(Buffer.from(hex, 'hex'));
      if (!xml) continue;
      const title = xmlValue(xml, 'titl'), sub = xmlValue(xml, 'subt'), body = xmlValue(xml, 'body');
      if (!title && !body) continue;
      const info = await appInfo(ident);
      const call = settings.calls !== false ? classifyCall(ident, title, sub, body) : null;
      if (call) {
        const generic = !title || CALL_WORDS.test(title) || title === info.name;
        const caller = generic ? (sub || (CALL_WORDS.test(body) ? '' : body) || info.name) : title;
        activeCall = { recId: parseInt(id, 10) || 0 };
        sendCall({ app: info.name, appPath: info.path, icon: info.icon, caller, video: call.video });
        continue;
      }
      if (settings.notifications === false) continue;
      sendNotification({ app: info.name, appPath: info.path, icon: info.icon, title: title || info.name, subtitle: sub, body });
    }
  } catch (_) {
    /* не мешаем работе острова */
  } finally { notifBusy = false; }
}

// ---------- Окно ----------
function envInfo() {
  const d = screen.getPrimaryDisplay();
  const inset = Math.max(0, d.workArea.y - d.bounds.y);
  const notchHeight = inset >= 30 ? Math.min(inset, 40) : 0;
  return { notchHeight, notchWidth: settings.notchWidth, settings };
}

let lastSize = { w: 300, h: 40 };
function place(w, h) {
  if (!win || win.isDestroyed()) return;
  if (w && h) lastSize = { w, h };
  const d = screen.getPrimaryDisplay();
  const cx = d.bounds.x + d.bounds.width / 2;
  win.setBounds({ x: Math.round(cx - lastSize.w / 2), y: d.bounds.y, width: lastSize.w, height: lastSize.h });
}

function createWindow() {
  win = new BrowserWindow({
    width: lastSize.w, height: lastSize.h, show: false,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, focusable: false, type: 'panel', enableLargerThanScreen: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => { place(); win.showInactive(); });
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
    img.setTemplateImage(true);
    tray = new Tray(img);
    tray.setToolTip('Real Island');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Настройки', click: () => win && win.webContents.send('open-settings') },
      { label: 'Показать / скрыть остров', click: () => { if (win) (win.isVisible() ? win.hide() : win.showInactive()); } },
      { type: 'separator' },
      { label: 'Выйти', click: () => app.quit() }
    ]));
  } catch (_) {}
}

ipcMain.handle('init', () => ({ env: envInfo(), state: statePayload() }));
ipcMain.on('resize', (_e, w, h) => place(Math.ceil(w), Math.ceil(h)));
ipcMain.on('quit', () => app.quit());
ipcMain.handle('save', (_e, patch) => {
  settings = { ...settings, ...patch };
  saveSettings();
  if ('openAtLogin' in patch) { try { app.setLoginItemSettings({ openAtLogin: !!patch.openAtLogin }); } catch (_) {} }
  if (patch.notifications === true || patch.calls === true) { notifBaseline = null; }
  if (patch.soundcloud === false && current && current.player === 'soundcloud') { current = null; pushState(); }
  const env = envInfo();
  if (win) win.webContents.send('env', env);
  return env;
});
ipcMain.handle('weather-search', (_e, query) => {
  if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) return [];
  return findPlaces(query.trim());
});
ipcMain.handle('weather-select', (_e, value) => {
  const place = placeFrom(value);
  if (!place) return envInfo();
  settings.weatherPlace = place;
  saveSettings();
  weather = null;
  weatherError = false;
  pushState();
  scheduleWeather();
  return envInfo();
});
ipcMain.handle('weather-refresh', () => refreshWeather());
ipcMain.on('weather-focus', (_e, enabled) => {
  if (!win || win.isDestroyed()) return;
  win.setFocusable(enabled === true);
  if (enabled === true) win.focus();
  else if (win.isFocused()) win.blur();
});
ipcMain.handle('open-automation', () => {
  return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation');
});
ipcMain.handle('cmd', async (_e, action) => {
  if (!current) return;
  if (current.player === 'soundcloud') { await controlSoundCloud(action); setTimeout(poll, 400); return; }
  const meta = PLAYERS.find((p) => p.id === current.player);
  if (!meta) return;
  const verb = { prev: 'previous track', toggle: 'playpause', next: 'next track' }[action];
  if (!verb) return;
  await osa('tell application "' + meta.app + '" to ' + verb);
  setTimeout(poll, 250);
});
ipcMain.handle('open-app', () => {
  if (!current) return;
  if (current.player === 'soundcloud') { if (lastBrowser) shell.openPath(lastBrowser.path); return; }
  const meta = PLAYERS.find((p) => p.id === current.player);
  if (meta) shell.openPath(meta.icon);
});
ipcMain.handle('open-path', (_e, p) => { if (p) shell.openPath(String(p)); });
ipcMain.handle('open-privacy', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'));

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  createTray();
  screen.on('display-metrics-changed', () => { place(); if (win) win.webContents.send('env', envInfo()); });
  poll();
  setInterval(poll, 1500);
  pollNotifications();
  setInterval(pollNotifications, 2000);
  win.webContents.once('did-finish-load', scheduleWeather);
});
app.on('window-all-closed', (e) => e.preventDefault());
