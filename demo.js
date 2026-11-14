const island = document.querySelector('.island');
const header = island.querySelector('.island-top');
const body = document.querySelector('#island-panel');
const panels = [...island.querySelectorAll('[data-panel]')];
const clock = island.querySelector('time');
let expandedState = 'music';

function showIsland(state) {
  if (state !== 'compact') {
    expandedState = state;
    for (const panel of panels) panel.hidden = panel.dataset.panel !== state;
  }
  island.dataset.state = state;
  const expanded = state !== 'compact';
  header.setAttribute('aria-expanded', String(expanded));
  header.setAttribute('aria-label', expanded ? 'Свернуть островок' : 'Раскрыть островок');
  body.inert = !expanded;
}

header.addEventListener('click', () => showIsland(island.dataset.state === 'compact' ? expandedState : 'compact'));
document.querySelector('#settings').addEventListener('click', () => {
  showIsland('settings');
  island.querySelector('[data-tab][aria-pressed="true"]').focus();
});
document.querySelector('#back-to-player').addEventListener('click', () => {
  showIsland('music');
  document.querySelector('#settings').focus();
});
island.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || island.dataset.state === 'compact') return;
  showIsland('compact');
  header.focus();
});

const tabs = [...island.querySelectorAll('[data-tab]')];
const pages = [...island.querySelectorAll('[data-settings-page]')];
for (const button of tabs) {
  button.addEventListener('click', () => {
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab === button));
    for (const page of pages) page.hidden = page.dataset.settingsPage !== button.dataset.tab;
  });
}
for (const button of island.querySelectorAll('.quick button')) {
  button.addEventListener('click', () => button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')));
}

const tracks = ['Ночной эфир', 'После полуночи', 'Город в огнях'];
let track = 0;
let playing = true;
const play = document.querySelector('#play');
const pause = document.querySelector('#pause');
const bars = island.querySelector('.bars');

function togglePlayback() {
  playing = !playing;
  play.textContent = playing ? 'Ⅱ' : '▶';
  const action = playing ? 'Пауза' : 'Продолжить';
  play.setAttribute('aria-label', action);
  pause.textContent = action;
  bars.classList.toggle('paused', !playing);
}
play.addEventListener('click', togglePlayback);
pause.addEventListener('click', togglePlayback);
for (const [id, direction] of [['prev', -1], ['next', 1]]) {
  document.getElementById(id).addEventListener('click', () => {
    track = (track + direction + tracks.length) % tracks.length;
    document.querySelector('#track-title').textContent = tracks[track];
    if (!playing) togglePlayback();
  });
}

const glass = document.querySelector('#glass');
glass.addEventListener('input', () => {
  island.style.setProperty('--glass', 1 - Number(glass.value) / 100);
  document.querySelector('#percent').value = glass.value + '%';
});

function updateClock() {
  const date = new Date();
  clock.textContent = date.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
  document.querySelector('#demo-date').textContent = date.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'});
}
updateClock();
setInterval(updateClock, 1000);
