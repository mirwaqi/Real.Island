const WEATHER_INTERVAL = 40 * 60 * 1000;

function placeFrom(value) {
  if (!value || typeof value.name !== 'string' || !value.name.trim() ||
      !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
      !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) return null;
  return {
    name: value.name.trim().slice(0, 100),
    region: typeof value.region === 'string' ? value.region.trim().slice(0, 100) : '',
    latitude: value.latitude,
    longitude: value.longitude
  };
}

async function request(base, params) {
  const url = new URL(base);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Weather request failed: ' + response.status);
  return response.json();
}

async function findPlaces(name) {
  const result = await request('https://geocoding-api.open-meteo.com/v1/search', {
    name, count: '5', language: 'ru', format: 'json'
  });
  return (result.results || []).map(item => placeFrom({
    ...item, region: [item.admin1, item.country].filter(Boolean).join(', ')
  })).filter(Boolean);
}

function condition(code) {
  if (code === 0) return ['☀', 'Ясно'];
  if (code <= 2) return ['⛅', 'Переменная облачность'];
  if (code === 3) return ['☁', 'Облачно'];
  if (code === 45 || code === 48) return ['🌫', 'Туман'];
  if (code >= 95) return ['⛈', 'Гроза'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['❄', 'Снег'];
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return ['🌧', 'Дождь'];
  return ['☁', 'Погода'];
}

async function getForecast(place) {
  const result = await request('https://api.open-meteo.com/v1/forecast', {
    latitude: String(place.latitude), longitude: String(place.longitude), timezone: 'auto',
    current: 'temperature_2m,weather_code,wind_speed_10m',
    daily: 'temperature_2m_min,temperature_2m_max,precipitation_probability_max',
    forecast_days: '1'
  });
  const current = result.current || {};
  if (!Number.isFinite(current.temperature_2m) || !Number.isFinite(current.weather_code)) {
    throw new Error('Incomplete forecast');
  }
  const [symbol, description] = condition(current.weather_code);
  const daily = result.daily || {};
  const min = daily.temperature_2m_min?.[0];
  const max = daily.temperature_2m_max?.[0];
  const rain = daily.precipitation_probability_max?.[0];
  const details = [];
  if (Number.isFinite(min) && Number.isFinite(max)) details.push('Сегодня ' + Math.round(min) + '…' + Math.round(max) + '°');
  if (Number.isFinite(rain)) details.push('Осадки до ' + Math.round(rain) + '%');
  if (Number.isFinite(current.wind_speed_10m)) details.push('Ветер ' + Math.round(current.wind_speed_10m) + ' км/ч');
  return { city: place.name, symbol, title: Math.round(current.temperature_2m) + '° · ' + description, details: details.join(' · ') };
}

module.exports = { WEATHER_INTERVAL, placeFrom, findPlaces, getForecast };
