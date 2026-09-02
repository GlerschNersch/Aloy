// Free, keyless weather via Open-Meteo. Location is auto-detected from Home
// Assistant's zone.home entity (already fetched for other features) rather
// than asking the user to configure coordinates separately.
import { fetchWithTimeout } from './fetchWithTimeout.js';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

const WEATHER_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail'
};

export function getHomeCoordinates(haStates) {
  const zone = (haStates || []).find(e => e.entity_id === 'zone.home');
  const lat = zone?.attributes?.latitude;
  const lon = zone?.attributes?.longitude;
  if (lat == null || lon == null) return null;
  return { lat, lon };
}

export async function fetchWeather(coords) {
  if (!coords) return null;
  try {
    const params = new URLSearchParams({
      latitude: coords.lat,
      longitude: coords.lon,
      current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
      daily: 'temperature_2m_max,temperature_2m_min,weather_code',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      timezone: 'auto',
      forecast_days: '3'
    });
    const res = await fetchWithTimeout(`${OPEN_METEO_URL}?${params}`, {}, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Weather fetch error:', err);
    return null;
  }
}

export function formatWeatherContext(weather) {
  if (!weather?.current) return null;
  const cur = weather.current;
  const desc = WEATHER_CODES[cur.weather_code] || 'Unknown conditions';

  let ctx = `[LIVE WEATHER]: ${desc}, ${Math.round(cur.temperature_2m)}°F, humidity ${cur.relative_humidity_2m}%, wind ${Math.round(cur.wind_speed_10m)} mph.\n`;

  if (weather.daily?.time) {
    ctx += `3-Day Forecast:\n`;
    weather.daily.time.forEach((date, i) => {
      const d = WEATHER_CODES[weather.daily.weather_code[i]] || 'Unknown';
      ctx += `- ${date}: ${d}, High ${Math.round(weather.daily.temperature_2m_max[i])}°F / Low ${Math.round(weather.daily.temperature_2m_min[i])}°F\n`;
    });
  }

  return ctx;
}
