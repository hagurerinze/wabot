// Cuaca dari Open-Meteo (gratis, tanpa API key). Lokasi default bisa diganti lewat .env
const LAT = process.env.WEATHER_LAT || '3.5952'
const LON = process.env.WEATHER_LON || '98.6722'
const CITY = process.env.WEATHER_CITY || 'Medan'
const TTL = 15 * 60 * 1000
let cache = { at: 0, text: '' }

const CODES = {
  0: 'cerah', 1: 'cerah berawan', 2: 'berawan sebagian', 3: 'mendung',
  45: 'berkabut', 48: 'berkabut', 51: 'gerimis ringan', 53: 'gerimis', 55: 'gerimis lebat',
  61: 'hujan ringan', 63: 'hujan sedang', 65: 'hujan lebat',
  80: 'hujan lokal ringan', 81: 'hujan lokal', 82: 'hujan lokal lebat',
  95: 'badai petir', 96: 'badai petir dan es', 99: 'badai petir dan es lebat',
}

export async function getWeather() {
  if (cache.text && Date.now() - cache.at < TTL) return cache.text
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=Asia%2FJakarta&forecast_days=1'
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`weather ${res.status}`)
  const d = await res.json()
  const c = d.current
  const day = d.daily
  const text =
    `${CITY}, per ${String(c.time).slice(11, 16)} WIB: ${CODES[c.weather_code] ?? 'tidak diketahui'}, ` +
    `${Math.round(c.temperature_2m)}°C (terasa ${Math.round(c.apparent_temperature)}°C), ` +
    `lembap ${c.relative_humidity_2m}%, angin ${Math.round(c.wind_speed_10m)} km/j. ` +
    `Hari ini ${Math.round(day.temperature_2m_min[0])}-${Math.round(day.temperature_2m_max[0])}°C, ` +
    `peluang hujan maks ${day.precipitation_probability_max[0]}%.`
  cache = { at: Date.now(), text }
  return text
}
