const tabs = [...document.querySelectorAll('[data-tab]')];
const panels = [...document.querySelectorAll('[data-panel]')];
for (const button of tabs) {
  button.addEventListener('click', () => {
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab === button));
    for (const panel of panels) panel.hidden = panel.dataset.panel !== button.dataset.tab;
  });
}
const play = document.querySelector('#play');
const bars = document.querySelector('.bars');
play.addEventListener('click', () => {
  const playing = play.getAttribute('aria-pressed') !== 'true';
  play.setAttribute('aria-pressed', String(playing));
  play.textContent = playing ? 'Ⅱ  Пауза' : '▶  Продолжить';
  bars.classList.toggle('paused', !playing);
});
const glass = document.querySelector('#glass');
glass.addEventListener('input', () => {
  document.querySelector('.island').style.setProperty('--glass', 1 - Number(glass.value) / 100);
  document.querySelector('#percent').value = glass.value + '%';
});
