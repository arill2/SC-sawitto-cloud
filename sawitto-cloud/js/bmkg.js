/**
 * bmkg.js — Fetch data cuaca dari BMKG Open API
 * Endpoint: https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4={kode}
 */

const BMKG_BASE_URL = 'https://api.bmkg.go.id/publik/prakiraan-cuaca';
var SC_DEBUG = window.SC_DEBUG === true;
var debugLog = (...args) => { if (SC_DEBUG) console.log(...args); };

/**
 * Fetch data cuaca untuk satu kabupaten/kota dengan strategi discovery
 * @param {string} locationCode - Kode ADM4 sample, e.g. "73.15.01.2001"
 * @param {string} id - ID internal (adm2), e.g. "73.15"
 * @param {string} [bmkgAdm2=id] - Kode adm2 untuk BMKG (bisa berbeda dari adm2 Kemendagri)
 * @returns {Promise<Object>} Data cuaca yang diparse
 */
async function fetchWeatherByAdm(locationCode, id, bmkgAdm2 = id) {
  // 1. Coba fetch dengan kode yang diberikan di config
  let data = await attemptFetch(locationCode, id);
  if (data && data.success) return data;

  // 2. Jika gagal, jalankan strategi discovery (fallback)
  debugLog(`[BMKG] Discovery mode untuk ${id} (karena ${locationCode} gagal)`);
  
  // Kandidat umum: {adm2}.{kec}.{desa}
  // .01.2001 (Kec 01, Desa 2001 - biasanya desa pertama)
  // .01.1001 (Kec 01, Kelurahan 1001 - biasanya ibukota kab)
  const candidates = [
    `${bmkgAdm2}.01.2001`,
    `${bmkgAdm2}.01.1001`,
    `${bmkgAdm2}.02.2001`,
    `${bmkgAdm2}.02.1001`,
    `${bmkgAdm2}.03.2001`,
    `${bmkgAdm2}.04.2001`,
  ];

  for (const candidate of candidates) {
    if (candidate === locationCode) continue;
    
    // Tunggu sebentar antar percobaan untuk menghindari rate limit
    await new Promise(r => setTimeout(r, 300));
    
    const result = await attemptFetch(candidate, id);
    if (result && result.success) {
      debugLog(`[BMKG] Found valid ADM4 for ${id}: ${candidate}`);
      return result;
    }
  }

  return getDefaultWeatherData(id);
}

/**
 * Single fetch attempt
 */
async function attemptFetch(code, id) {
  const url = `${BMKG_BASE_URL}?adm4=${code}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s per attempt

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const json = await response.json();
    const parsed = parseBMKGResponse(json, id);
    
    return parsed.success ? parsed : null;

  } catch (err) {
    return null;
  }
}

/**
 * Parse response BMKG ke format internal yang konsisten
 * @param {Object} json - Raw response dari BMKG
 * @param {string} id - ID kabupaten
 * @returns {Object} Normalized weather data
 */
function parseBMKGResponse(json, id) {
  try {
    const dataArr = json?.data;
    if (!dataArr || !Array.isArray(dataArr) || dataArr.length === 0) {
      return getDefaultWeatherData(id);
    }

    const firstLocation = dataArr[0];
    const cuacaBlocks = firstLocation?.cuaca;

    if (!cuacaBlocks || cuacaBlocks.length === 0) {
      return getDefaultWeatherData(id);
    }

    const allForecasts = cuacaBlocks.flat();
    const withDate = allForecasts.filter(f => f.local_datetime);
    const now = new Date();

    // Gunakan data paling baru (timestamp terbesar) sebagai kondisi utama wilayah.
    let nearest = withDate.sort((a, b) => new Date(b.local_datetime) - new Date(a.local_datetime))[0] || allForecasts[0];

    if (!nearest) return getDefaultWeatherData(id);

    const upcomingForecasts = allForecasts
      .filter(f => f.local_datetime && new Date(f.local_datetime) >= now)
      .slice(0, 8)
      .map(f => ({
        time: f.local_datetime,
        weather_desc: f.weather_desc || f.weather_desc_en || 'Tidak Diketahui',
        tp: parseFloat(f.tp) || 0,
        hu: parseFloat(f.hu) || 0,
        ws: parseFloat(f.ws) || 0,
        t: parseFloat(f.t) || 0,
        wd_to: f.wd_to || '-'
      }));

    return {
      admId: id,
      success: true,
      weather_desc: nearest.weather_desc || nearest.weather_desc_en || 'Tidak Diketahui',
      tp: parseFloat(nearest.tp) || 0,
      hu: parseFloat(nearest.hu) || 0,
      ws: parseFloat(nearest.ws) || 0,
      t: parseFloat(nearest.t) || 0,
      wd_to: nearest.wd_to || '-',
      local_datetime: nearest.local_datetime || new Date().toISOString(),
      location_name: firstLocation?.lokasi?.desa ||
                     firstLocation?.lokasi?.kecamatan ||
                     firstLocation?.lokasi?.kabupaten || id,
      forecasts: upcomingForecasts,
      raw_forecasts_count: allForecasts.length
    };

  } catch (parseErr) {
    console.error(`[BMKG] Parse error ${id}:`, parseErr);
    return getDefaultWeatherData(id);
  }
}

/**
 * Data default jika fetch gagal
 */
function getDefaultWeatherData(id) {
  return {
    admId: id,
    success: false,
    weather_desc: 'Data Tidak Tersedia',
    tp: 0,
    hu: 0,
    ws: 0,
    t: 0,
    wd_to: '-',
    local_datetime: new Date().toISOString(),
    location_name: id,
    forecasts: [],
    raw_forecasts_count: 0
  };
}

/**
 * Fetch semua 24 kabupaten/kota dari BMKG dengan pembatasan concurrency (chunking)
 * untuk mencegah browser hang atau rate limiting API.
 */
async function fetchAllWeatherData(kabupatenList, onProgress = null) {
  debugLog(`[BMKG] Membersihkan data & memulai fetch ${kabupatenList.length} wilayah...`);
  const startTime = performance.now();
  const weatherMap = new Map();
  let completed = 0;

  // Ukuran chunk (misal: 4 kabupaten sekaligus)
  const CHUNK_SIZE = 4;
  const kabupatenChunks = [];
  
  for (let i = 0; i < kabupatenList.length; i += CHUNK_SIZE) {
    kabupatenChunks.push(kabupatenList.slice(i, i + CHUNK_SIZE));
  }

  for (const chunk of kabupatenChunks) {
    const chunkPromises = chunk.map(async (kab) => {
      try {
        const bmkgCode = kab.adm2_bmkg || kab.adm2;
        const data = await fetchWeatherByAdm(kab.adm4_sample, kab.id, bmkgCode);
        
        completed++;
        if (onProgress) onProgress(completed, kabupatenList.length, kab.name);
        
        return { key: kab.id, data };
      } catch (err) {
        completed++;
        console.error(`[BMKG] Fatal error fetching ${kab.name}:`, err);
        return { key: kab.id, data: getDefaultWeatherData(kab.id) };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    chunkResults.forEach(res => weatherMap.set(res.key, res.data));
    
    // Delay kecil antar chunk (200ms) untuk stabilitas
    if (completed < kabupatenList.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  debugLog(`[BMKG] Selesai dalam ${elapsed}s. ${weatherMap.size}/${kabupatenList.length} berhasil.`);

  return weatherMap;
}

// Export untuk digunakan modul lain
window.BMKGService = {
  fetchAllWeatherData,
  fetchWeatherByAdm,
  parseBMKGResponse,
  getDefaultWeatherData
};
