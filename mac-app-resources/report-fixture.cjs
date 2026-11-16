const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { findPlaces, getForecast } = require('./weather');

module.exports = (win, output) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      fs.mkdirSync(output, { recursive: true });
      let forecast;
      try {
        const places = await findPlaces('Berlin');
        const berlin = places.find(place => place.region.includes('Германия')) || places[0];
        if (!berlin) throw new Error('Berlin search returned no results');
        forecast = await getForecast(berlin);
        fs.writeFileSync(path.join(output, 'forecast-api.txt'), 'Open-Meteo search and forecast passed');
      } catch (error) {
        fs.writeFileSync(path.join(output, 'forecast-api.txt'), error.message);
        forecast = { city: 'Берлин', symbol: '☁', title: '7° · Облачно', details: 'Сегодня 4…8° · Осадки до 20%' };
      }
      const exec = code => win.webContents.executeJavaScript(code);
      await exec(`
        env = { ...env, notchHeight: 34, settings: { ...env.settings,
          weatherPlace: { name: "Берлин", latitude: 52.52, longitude: 13.41 } } };
        const sampleForecast = ${JSON.stringify(forecast)};
        const sampleTrack = { player: "music", title: "Ночной эфир", artist: "Тестовый трек", playing: true };
        const sampleState = { ...state, weather: sampleForecast };
      `);
      const cases = [
        ['01-clock', 'state = { ...sampleState, track: null }; page = "main"; render()'],
        ['02-music', 'state = { ...sampleState, track: sampleTrack }; render()'],
        ['03-collapsed', '$("clock").click()'],
        ['04-soundcloud', 'collapsed = false; state = { ...sampleState, track: { ...sampleTrack, player: "soundcloud", brand: "soundcloud" } }; render()'],
        ['05-notification', '$("menu").click(); $("demoNotif").click()'],
        ['06-incoming-call', 'nextNotif(); $("menu").click(); $("demoCall").click()'],
        ['07-settings', 'endCall(); $("menu").click()'],
        ['08-weather', '$("openWeather").click()'],
        ['09-weather-banner', 'page = "main"; pushNotif({ app: "Погода", weather: true, title: sampleForecast.city + " · " + sampleForecast.title, body: sampleForecast.details, symbol: sampleForecast.symbol }); render()'],
        ['10-permissions', 'nextNotif(); $("menu").click(); $("openPermissions").click()']
      ];
      for (const [name, code] of cases) {
        await exec(code);
        await new Promise(resolve => setTimeout(resolve, 280));
        const image = await win.webContents.capturePage();
        if (image.isEmpty() || image.getSize().width < 100) throw new Error('Blank capture: ' + name);
        fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
      }
      await exec('$("permissionsBack").click(); $("openWeather").click(); $("weatherQuery").focus()');
      if (!await exec('document.activeElement === $("weatherQuery")')) {
        throw new Error('Weather city field did not receive focus');
      }
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
};
