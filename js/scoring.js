/**
 * scoring.js — Logika scoring risiko banjir berdasarkan data BMKG
 * Menghasilkan level risiko: BAHAYA, WASPADA, SIAGA, AMAN
 */

/**
 * Definisi level risiko
 */
const RISK_LEVELS = {
  BAHAYA: {
    id: 'BAHAYA',
    label: 'BAHAYA',
    color: '#ef4444',
    colorBg: 'rgba(239, 68, 68, 0.15)',
    colorBorder: 'rgba(239, 68, 68, 0.5)',
    icon: '🔴',
    priority: 4,
    pulse: true
  },
  WASPADA: {
    id: 'WASPADA',
    label: 'WASPADA',
    color: '#f97316',
    colorBg: 'rgba(249, 115, 22, 0.15)',
    colorBorder: 'rgba(249, 115, 22, 0.5)',
    icon: '🟠',
    priority: 3,
    pulse: true
  },
  SIAGA: {
    id: 'SIAGA',
    label: 'SIAGA',
    color: '#eab308',
    colorBg: 'rgba(234, 179, 8, 0.15)',
    colorBorder: 'rgba(234, 179, 8, 0.5)',
    icon: '🟡',
    priority: 2,
    pulse: false
  },
  AMAN: {
    id: 'AMAN',
    label: 'AMAN',
    color: '#22c55e',
    colorBg: 'rgba(34, 197, 94, 0.15)',
    colorBorder: 'rgba(34, 197, 94, 0.5)',
    icon: '🟢',
    priority: 1,
    pulse: false
  }
};

/**
 * Keyword mapping untuk pengenalan cuaca dari BMKG
 */
const WEATHER_RISK_MAP = [
  // BAHAYA
  { keywords: ['hujan badai', 'badai', 'topan', 'siklon', 'angin ribut', 'hujan petir lebat', 'thunderstorm'], level: 'BAHAYA' },

  // WASPADA
  { keywords: ['hujan lebat', 'hujan sangat lebat', 'hujan deras', 'heavy rain', 'hujan lebat dan petir'], level: 'WASPADA' },

  // SIAGA
  { keywords: ['hujan sedang', 'hujan ringan', 'gerimis', 'hujan dengan petir', 'hujan lokal', 'drizzle', 'rain'], level: 'SIAGA' },

  // AMAN (default jika tidak cocok dengan di atas)
  { keywords: ['cerah berawan', 'berawan tebal', 'berawan', 'mostly cloudy', 'partly cloudy', 'cerah', 'clear', 'sunny', 'tidak ada awan'], level: 'AMAN' }
];

/**
 * Tentukan risiko dari deskripsi cuaca
 * @param {string} weatherDesc - Deskripsi cuaca dari BMKG
 * @returns {Object} Risk level object
 */
function getRiskFromWeatherDesc(weatherDesc) {
  if (!weatherDesc || weatherDesc === 'Data Tidak Tersedia') {
    return RISK_LEVELS.AMAN;
  }

  const desc = weatherDesc.toLowerCase().trim();

  for (const mapping of WEATHER_RISK_MAP) {
    for (const keyword of mapping.keywords) {
      if (desc.includes(keyword)) {
        return RISK_LEVELS[mapping.level];
      }
    }
  }

  // Default: AMAN jika tidak dikenali
  return RISK_LEVELS.AMAN;
}

/**
 * Hitung skor risiko banjir komprehensif berdasarkan semua parameter
 * @param {Object} weatherData - Data cuaca dari BMKG
 * @returns {Object} { level, score, factors }
 */
function getFloodRisk(weatherData) {
  const { weather_desc, success } = weatherData;
  const tp = weatherData.tp ?? 0;
  const hu = weatherData.hu ?? 0;
  const ws = weatherData.ws ?? 0;

  // Jika data tidak tersedia
  if (!success) {
    return {
      ...RISK_LEVELS.AMAN,
      score: 0,
      factors: { weather: 0, rainfall: 0, humidity: 0, wind: 0 },
      dataAvailable: false
    };
  }

  // Data parsial: sukses fetch, tapi indikator utama kosong
  if (!weather_desc && tp === 0 && hu === 0) {
    return {
      ...RISK_LEVELS.AMAN,
      score: 0,
      factors: { weather: 0, rainfall: 0, humidity: 0, wind: 0 },
      dataAvailable: false,
      weather_desc
    };
  }

  // Basis dari deskripsi cuaca (bobot tertinggi: 50%)
  const baseRisk = getRiskFromWeatherDesc(weather_desc);

  // Skor faktor tambahan (0–100 per faktor)
  let rainfallScore = 0;   // tp (mm)
  let humidityScore = 0;   // hu (%)
  let windScore = 0;       // ws (km/jam)

  // Curah hujan scoring
  if (tp >= 50) rainfallScore = 100;
  else if (tp >= 20) rainfallScore = 75;
  else if (tp >= 10) rainfallScore = 50;
  else if (tp >= 5) rainfallScore = 25;
  else rainfallScore = 0;

  // Kelembapan scoring
  if (hu >= 95) humidityScore = 100;
  else if (hu >= 85) humidityScore = 70;
  else if (hu >= 75) humidityScore = 40;
  else humidityScore = 0;

  // Kecepatan angin scoring
  if (ws >= 60) windScore = 100;
  else if (ws >= 40) windScore = 75;
  else if (ws >= 25) windScore = 50;
  else if (ws >= 15) windScore = 25;
  else windScore = 0;

  // Gabungkan skor (bobot: 50% base risk, 30% rainfall, 10% humidity, 10% wind)
  const baseScore = baseRisk.priority * 25; // 25/50/75/100 sesuai priority
  const compositeScore = Math.round(
    baseScore * 0.50 +
    rainfallScore * 0.30 +
    humidityScore * 0.10 +
    windScore * 0.10
  );

  // Tentukan level final berdasarkan composite score
  let finalLevel;
  if (compositeScore >= 75) finalLevel = RISK_LEVELS.BAHAYA;
  else if (compositeScore >= 50) finalLevel = RISK_LEVELS.WASPADA;
  else if (compositeScore >= 25) finalLevel = RISK_LEVELS.SIAGA;
  else finalLevel = RISK_LEVELS.AMAN;

  // Pastikan tidak lebih rendah dari base risk
  if (baseRisk.priority > finalLevel.priority) {
    finalLevel = baseRisk;
  }

  return {
    ...finalLevel,
    score: compositeScore,
    factors: {
      weather: baseScore,
      rainfall: rainfallScore,
      humidity: humidityScore,
      wind: windScore
    },
    dataAvailable: true,
    weather_desc
  };
}

/**
 * Cek apakah level risiko membutuhkan alert
 * @param {string} riskId
 * @returns {boolean}
 */
function isAlertLevel(riskId) {
  return riskId === 'BAHAYA' || riskId === 'WASPADA';
}

/**
 * Hitung statistik ringkasan untuk semua wilayah
 * @param {Array} allRiskData - Array dari { kabupaten, risk, weather }
 * @returns {Object} Summary statistics
 */
function calculateSummaryStats(allRiskData) {
  const counts = { BAHAYA: 0, WASPADA: 0, SIAGA: 0, AMAN: 0, NO_DATA: 0 };
  let alertAreas = [];
  let highestRisk = null;
  let highestScore = -1;

  for (const item of allRiskData) {
    const hasData = item.risk?.dataAvailable !== false;
    if (!hasData) {
      counts.NO_DATA++;
      continue;
    }

    const riskId = item.risk?.id || 'AMAN';
    if (counts.hasOwnProperty(riskId)) {
      counts[riskId]++;
    } else {
      counts.NO_DATA++;
    }

    if (isAlertLevel(riskId)) {
      alertAreas.push(item);
    }

    if (item.risk?.score > highestScore) {
      highestScore = item.risk.score;
      highestRisk = item;
    }
  }

  const totalAlert = counts.BAHAYA + counts.WASPADA;
  const overallStatus = counts.BAHAYA > 0 ? 'BAHAYA' :
                        counts.WASPADA > 0 ? 'WASPADA' :
                        counts.SIAGA > 0 ? 'SIAGA' : 'AMAN';

  return {
    counts,
    totalAlert,
    alertAreas,
    highestRisk,
    overallStatus,
    overallLevel: RISK_LEVELS[overallStatus]
  };
}

/**
 * Get warna untuk Leaflet map berdasarkan risk level
 * @param {string} riskId
 * @returns {Object} { fillColor, color, opacity }
 */
function getMapColors(riskId) {
  const level = RISK_LEVELS[riskId] || RISK_LEVELS.AMAN;
  return {
    fillColor: level.color,
    color: '#1e293b',
    fillOpacity: 0.65,
    weight: 1.5
  };
}

// Export
window.ScoringService = {
  RISK_LEVELS,
  RISK_LEVELS_ORDERED: ['BAHAYA', 'WASPADA', 'SIAGA', 'AMAN'],
  getFloodRisk,
  getRiskFromWeatherDesc,
  isAlertLevel,
  calculateSummaryStats,
  getMapColors
};
