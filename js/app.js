/**
 * app.js — Logic utama Sawitto Cloud & auto-refresh
 * Orchestrator semua module: BMKG, Scoring, Map, Groq, Notification
 */
var SC_DEBUG = window.SC_DEBUG === true;
var debugLog = (...args) => { if (SC_DEBUG) console.log(...args); };
const AUTO_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 menit
let refreshTimer = null;
let kabupatenConfig = [];
let currentWeatherMap = new Map();
let currentRiskMap = new Map();
let currentAllRiskData = [];
let isLoading = false;
let rainfallChart = null;

// ============================================================
// INIT
// ============================================================

/**
 * Entry point utama aplikasi
 */
async function initApp() {
  debugLog('[SC] 🌊 Sawitto Cloud - Memulai inisialisasi...');

  // Load konfigurasi kabupaten
  await loadConfig();

  // Init peta
  window.MapService.initFullMap();

  // Minta izin notifikasi
  await window.NotificationService.requestNotificationPermission();

  // Fetch data pertama kali
  await refreshData();

  // Setup auto-refresh
  setupAutoRefresh();

  // Setup event listeners UI
  setupUIEventListeners();

  debugLog('[SC] ✅ Inisialisasi selesai');
}

/**
 * Load konfigurasi dari window.SULSEL_CONFIG_DATA (js/config.js)
 */
async function loadConfig() {
  if (window.SULSEL_CONFIG_DATA) {
    kabupatenConfig = window.SULSEL_CONFIG_DATA.kabupaten;
    debugLog(`[SC] Config loaded: ${kabupatenConfig.length} kabupaten/kota`);
  } else {
    console.error('[SC] window.SULSEL_CONFIG_DATA tidak ditemukan! Menggunakan fallback.');
    // Fallback minimal
    kabupatenConfig = [{ id: '73.15', name: 'Kab. Pinrang', adm3: '73.15', priority: true, lat: -3.7915, lng: 119.6522 }];
  }
}

// ============================================================
// DATA REFRESH
// ============================================================

/**
 * Refresh semua data cuaca dari BMKG
 */
async function refreshData() {
  if (isLoading) {
    debugLog('[SC] Sudah ada proses refresh berjalan, skip.');
    return;
  }

  try {
    const refreshStart = performance.now();
    const stages = [];
    const markStage = (name, start) => {
      stages.push({ stage: name, ms: Math.round(performance.now() - start) });
    };

    isLoading = true;
    showLoadingOverlay(true);
    updateLoadingStatus('Menghubungi BMKG API...');

    // Fetch semua data paralel
    let stageStart = performance.now();
    currentWeatherMap = await window.BMKGService.fetchAllWeatherData(
      kabupatenConfig,
      (done, total, name) => {
        updateLoadingStatus(`Fetching ${name}... (${done}/${total})`);
        updateLoadingProgress(done, total);
      }
    );
    markStage('fetchAllWeatherData', stageStart);

    updateLoadingStatus('Menghitung risiko banjir...');

    // Hitung risiko untuk setiap kabupaten
    stageStart = performance.now();
    currentRiskMap = new Map();
    currentAllRiskData = [];

    for (const kab of kabupatenConfig) {
      const weather = currentWeatherMap.get(kab.id) || window.BMKGService.getDefaultWeatherData(kab.id);
      const risk = window.ScoringService.getFloodRisk(weather);
      currentRiskMap.set(kab.id, risk);
      currentAllRiskData.push({ kab, weather, risk });
    }
    markStage('calculateRisk', stageStart);

    // Summary stats
    stageStart = performance.now();
    const stats = window.ScoringService.calculateSummaryStats(currentAllRiskData);
    markStage('calculateSummaryStats', stageStart);

    // Update UI
    updateLoadingStatus('Memperbarui tampilan...');
    stageStart = performance.now();
    renderDashboard(stats);
    renderStatusCards();
    renderMap();
    updateHeader();
    updateAlertBanner(stats);
    markStage('renderMainUI', stageStart);

    // Render grafik curah hujan
    stageStart = performance.now();
    renderRainfallChart();
    markStage('renderRainfallChart', stageStart);

    // Kirim notifikasi untuk area berisiko
    if (stats.alertAreas.length > 0) {
      stageStart = performance.now();
      await window.NotificationService.processBatchNotifications(
        stats.alertAreas.map(item => ({
          kab: item.kab,
          risk: item.risk,
          weather: item.weather
        }))
      );
      markStage('notifications', stageStart);
    }

    debugLog(`[SC] ✅ Data diperbarui. Stats:`, stats.counts);
    if (SC_DEBUG) console.table(stages);
    debugLog(`[SC][PERF] Total refresh ${Math.round(performance.now() - refreshStart)}ms`);
    updateLastRefreshTime();

  } catch (err) {
    console.error('[SC] Error refresh data:', err);
    showToast('Terjadi kesalahan saat memperbarui data. Coba lagi.', 'error');
  } finally {
    isLoading = false;
    showLoadingOverlay(false);
  }
}

// ============================================================
// RENDER FUNCTIONS
// ============================================================

/**
 * Render summary dashboard stats
 */
function renderDashboard(stats) {
  const el = document.getElementById('stats-summary');
  if (!el) return;

  el.innerHTML = `
    <div class="stat-card stat-bahaya">
      <div class="stat-icon">🔴</div>
      <div class="stat-number">${stats.counts.BAHAYA}</div>
      <div class="stat-label">BAHAYA</div>
    </div>
    <div class="stat-card stat-waspada">
      <div class="stat-icon">🟠</div>
      <div class="stat-number">${stats.counts.WASPADA}</div>
      <div class="stat-label">WASPADA</div>
    </div>
    <div class="stat-card stat-siaga">
      <div class="stat-icon">🟡</div>
      <div class="stat-number">${stats.counts.SIAGA}</div>
      <div class="stat-label">SIAGA</div>
    </div>
    <div class="stat-card stat-aman">
      <div class="stat-icon">🟢</div>
      <div class="stat-number">${stats.counts.AMAN}</div>
      <div class="stat-label">AMAN</div>
    </div>
  `;
}

/**
 * Render grid status cards semua 24 kabupaten/kota
 */
function renderStatusCards() {
  const grid = document.getElementById('kab-grid');
  if (!grid) return;

  // Sort: bahaya/waspada dulu, lalu priority, lalu alphabetical
  const sorted = [...currentAllRiskData].sort((a, b) => {
    const rPriority = (b.risk?.priority || 1) - (a.risk?.priority || 1);
    if (rPriority !== 0) return rPriority;
    if (a.kab.priority !== b.kab.priority) return a.kab.priority ? -1 : 1;
    return a.kab.name.localeCompare(b.kab.name);
  });

  grid.innerHTML = sorted.map(({ kab, weather, risk }) => {
    const isAlert = window.ScoringService.isAlertLevel(risk.id);
    return `
      <div class="kab-card ${isAlert ? 'kab-card--alert' : ''} ${kab.priority ? 'kab-card--priority' : ''}"
           data-id="${kab.id}"
           onclick="window.AppController.handleKabClick('${kab.id}')"
           style="--risk-color: ${risk.color}; --risk-bg: ${risk.colorBg}; --risk-border: ${risk.colorBorder}">
        <div class="card-header">
          <h3 class="card-name">${kab.priority ? '⭐ ' : ''}${kab.name.replace('Kab. ', '').replace('Kota ', '')}</h3>
          <span class="card-type">${kab.name.startsWith('Kota') ? 'Kota' : 'Kab.'}</span>
          <span class="risk-badge risk-badge--${risk.id.toLowerCase()}">${risk.icon || ''} ${risk.label}</span>
        </div>
        <div class="card-weather">
          <div class="weather-icon">${getWeatherEmoji(weather.weather_desc)}</div>
          <div class="weather-info">
            <div class="weather-desc">${weather.weather_desc || 'N/A'}</div>
            <div class="weather-details">
              ${weather.t ? `🌡️ ${weather.t.toFixed(0)}°C` : ''}
              ${weather.hu ? `💧 ${weather.hu.toFixed(0)}%` : ''}
              ${weather.ws ? `💨 ${weather.ws.toFixed(0)} km/j` : ''}
              ${weather.tp ? `🌧️ ${weather.tp.toFixed(1)}mm` : ''}
            </div>
          </div>
        </div>
        ${!weather.success ? '<div class="card-no-data">⚠️ Data tidak tersedia</div>' : ''}
        <div class="card-footer">
          <span class="card-time">${formatDateTime(weather.local_datetime)}</span>
          ${isAlert ? '<span class="view-detail-btn">Lihat Detail →</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render peta dengan marker kabupaten
 */
function renderMap() {
  window.MapService.renderKabupatenMarkers(
    kabupatenConfig,
    currentWeatherMap,
    currentRiskMap,
    (id, kab, weather, risk) => {
      handleKabClick(id);
    }
  );
}

/**
 * Update alert banner di atas halaman
 */
function updateAlertBanner(stats) {
  const banner = document.getElementById('alert-banner');
  if (!banner) return;

  if (stats.alertAreas.length === 0) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  banner.classList.remove('hidden');
  const level = stats.overallLevel;
  const alertNames = stats.alertAreas
    .slice(0, 5)
    .map(a => a.kab.name.replace('Kab. ', '').replace('Kota ', ''))
    .join(', ');
  const more = stats.alertAreas.length > 5 ? ` +${stats.alertAreas.length - 5} lainnya` : '';

  banner.style.background = `linear-gradient(135deg, ${level.color}22, ${level.color}11)`;
  banner.style.borderColor = level.color;
  banner.innerHTML = `
    <div class="banner-content">
      <div class="banner-icon">${level.icon} <span class="banner-status">${level.label}</span></div>
      <div class="banner-text">
        <strong>${stats.alertAreas.length} wilayah</strong> berstatus ${level.label}:
        <span class="banner-areas">${alertNames}${more}</span>
      </div>
      <div class="banner-actions">
        <button onclick="window.AppController.scrollToCard()" class="btn-banner-jump">📍 Lihat Semua</button>
        <button onclick="document.getElementById('alert-banner').classList.add('hidden')" class="btn-banner-close">✕</button>
      </div>
    </div>
  `;
}

/**
 * Render grafik curah hujan menggunakan Chart.js
 */
function renderRainfallChart() {
  const canvas = document.getElementById('rainfall-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  // Ambil data dari 5 wilayah dengan curah hujan tertinggi
  const topRainfall = currentAllRiskData
    .filter(d => d.weather.success)
    .sort((a, b) => b.weather.tp - a.weather.tp)
    .slice(0, 8);

  const labels = topRainfall.map(d => d.kab.name.replace('Kab. ', '').replace('Kota ', ''));
  const rainfallData = topRainfall.map(d => d.weather.tp || 0);
  const backgroundColors = topRainfall.map(d => d.risk.colorBg.replace('0.15', '0.7'));
  const borderColors = topRainfall.map(d => d.risk.color);

  if (!rainfallChart) {
    rainfallChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Curah Hujan (mm)',
          data: rainfallData,
          backgroundColor: backgroundColors,
          borderColor: borderColors,
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#94a3b8',
            bodyColor: '#e2e8f0',
            borderColor: '#1e40af',
            borderWidth: 1,
            callbacks: {
              label: ctx => `💧 ${ctx.raw.toFixed(1)} mm`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 11 } },
            grid: { color: 'rgba(148, 163, 184, 0.05)' }
          },
          y: {
            ticks: { color: '#64748b' },
            grid: { color: 'rgba(148, 163, 184, 0.1)' },
            title: { display: true, text: 'mm', color: '#64748b' }
          }
        }
      }
    });
    return;
  }

  rainfallChart.data.labels = labels;
  rainfallChart.data.datasets[0].data = rainfallData;
  rainfallChart.data.datasets[0].backgroundColor = backgroundColors;
  rainfallChart.data.datasets[0].borderColor = borderColors;
  rainfallChart.update('none');
}

// ============================================================
// DETAIL MODAL
// ============================================================

/**
 * Handle klik pada kabupaten (dari card maupun peta)
 * @param {string} adm3
 */
function handleKabClick(id) {
  const item = currentAllRiskData.find(d => d.kab.id === id);
  if (!item) return;

  // Fly ke lokasi di peta
  window.MapService.flyToKab(id, item.kab);

  // Tampilkan detail modal
  showKabDetail(id);

  // Scroll ke peta di mobile
  if (window.innerWidth < 768) {
    document.getElementById('sc-map')?.scrollIntoView({ behavior: 'smooth' });
  }
}

/**
 * Tampilkan modal detail kabupaten
 */
function showKabDetail(id) {
  const item = currentAllRiskData.find(d => d.kab.id === id);
  if (!item) return;

  const { kab, weather, risk } = item;
  const modal = document.getElementById('detail-modal');
  const modalContent = document.getElementById('detail-content');

  if (!modal || !modalContent) return;

  // Render konten detail
  modalContent.innerHTML = buildDetailHTML(kab, weather, risk);

  // Tampilkan modal
  modal.classList.remove('hidden');
  modal.classList.add('visible');

  // Trigger AI mitigasi jika status alert
  if (window.ScoringService.isAlertLevel(risk.id)) {
    // Update panel AI di sidebar
    loadAIMitigation(kab, weather, risk);
    triggerDetailAI(kab, weather, risk);
  } else {
    const aiSection = document.getElementById('detail-ai');
    if (aiSection) {
      aiSection.innerHTML = `<div class="ai-no-alert">✅ Status ${risk.label} — tidak memerlukan rekomendasi mitigasi darurat.</div>`;
    }
  }
}

/**
 * Build HTML konten detail modal
 */
function buildDetailHTML(kab, weather, risk) {
  const forecasts = weather.forecasts || [];

  return `
    <div class="detail-header" style="border-left: 4px solid ${risk.color}">
      <div class="detail-title-row">
        <h2 class="detail-kab-name">${kab.name}</h2>
        <span class="risk-badge risk-badge--${risk.id.toLowerCase()} risk-badge--lg">
          ${risk.icon} ${risk.label}
        </span>
      </div>
      <p class="detail-subtitle">Sulawesi Selatan · ID ${kab.id} ${kab.priority ? '· ⭐ Prioritas' : ''}</p>
    </div>

    <div class="detail-stats-grid">
      <div class="detail-stat">
        <div class="ds-icon">🌤️</div>
        <div class="ds-value">${weather.weather_desc || 'N/A'}</div>
        <div class="ds-label">Kondisi</div>
      </div>
      <div class="detail-stat">
        <div class="ds-icon">🌡️</div>
        <div class="ds-value">${weather.t ? weather.t.toFixed(0) + '°C' : 'N/A'}</div>
        <div class="ds-label">Suhu</div>
      </div>
      <div class="detail-stat">
        <div class="ds-icon">💧</div>
        <div class="ds-value">${weather.hu ? weather.hu.toFixed(0) + '%' : 'N/A'}</div>
        <div class="ds-label">Kelembapan</div>
      </div>
      <div class="detail-stat">
        <div class="ds-icon">🌧️</div>
        <div class="ds-value">${weather.tp ? weather.tp.toFixed(1) + ' mm' : 'N/A'}</div>
        <div class="ds-label">Curah Hujan</div>
      </div>
      <div class="detail-stat">
        <div class="ds-icon">💨</div>
        <div class="ds-value">${weather.ws ? weather.ws.toFixed(0) + ' km/j' : 'N/A'}</div>
        <div class="ds-label">Angin</div>
      </div>
      <div class="detail-stat">
        <div class="ds-icon">🧭</div>
        <div class="ds-value">${weather.wd_to || 'N/A'}</div>
        <div class="ds-label">Arah Angin</div>
      </div>
    </div>

    ${forecasts.length > 0 ? `
    <div class="detail-forecast">
      <h3 class="section-title">📅 Prakiraan ke Depan</h3>
      <div class="forecast-scroll">
        ${forecasts.map(f => `
          <div class="forecast-item">
            <div class="fi-time">${formatTimeOnly(f.time)}</div>
            <div class="fi-icon">${getWeatherEmoji(f.weather_desc)}</div>
            <div class="fi-desc">${f.weather_desc}</div>
            <div class="fi-rain">${f.tp.toFixed(1)}mm</div>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <div class="detail-ai-section" id="detail-ai">
      <div class="ai-loading">
        <div class="ai-spinner"></div>
        <span>Menghubungi AI Mitigasi...</span>
      </div>
    </div>
  `;
}

/**
 * Trigger AI mitigasi di dalam modal detail
 */
function triggerDetailAI(kab, weather, risk) {
  const aiSection = document.getElementById('detail-ai');
  if (!aiSection) return;

  aiSection.innerHTML = `
    <h3 class="section-title">🤖 Rekomendasi AI Mitigasi</h3>
    <div class="ai-content" id="detail-ai-content">
      <div class="ai-loading-row">
        <div class="ai-spinner"></div>
        <span>Groq AI sedang menganalisis kondisi ${kab.name}...</span>
      </div>
    </div>
  `;

  const contentEl = document.getElementById('detail-ai-content');

  window.GroqService.fetchMitigationWithCache(
    {
      kabName: kab.name,
      status: risk.id,
      weather_desc: weather.weather_desc,
      tp: weather.tp || 0,
      hu: weather.hu || 0,
      ws: weather.ws || 0
    },
    (chunk, fullText) => {
      if (contentEl) contentEl.innerHTML = renderMarkdown(fullText) + '<span class="cursor-blink">|</span>';
    },
    (fullText) => {
      if (contentEl) contentEl.innerHTML = renderMarkdown(fullText);
    },
    (errMsg) => {
      if (contentEl) {
        contentEl.innerHTML = `
          <div class="ai-error">
            <div>⚠️ ${errMsg}</div>
            ${!window.GroqService.getGroqApiKey() ? `
              <div class="ai-key-prompt">
                <p>Masukkan Groq API Key untuk mengaktifkan rekomendasi AI:</p>
                <div class="ai-key-form">
                  <input type="password" id="groq-key-input" placeholder="gsk_..." class="api-key-input" />
                  <button onclick="window.AppController.saveGroqKey()" class="btn-save-key">Simpan & Coba Lagi</button>
                </div>
              </div>
            ` : ''}
          </div>
        `;
      }
    }
  );
}

/**
 * Load AI mitigasi ke panel sidebar
 */
function loadAIMitigation(kab, weather, risk) {
  const panel = document.getElementById('ai-panel');
  const content = document.getElementById('ai-panel-content');
  if (!panel || !content) return;

  panel.classList.remove('hidden');
  content.innerHTML = `
    <div class="ai-panel-header">
      <div class="ai-area-badge" style="color: ${risk.color}">
        ${risk.icon} ${kab.name} — ${risk.label}
      </div>
    </div>
    <div id="ai-panel-text" class="ai-panel-text">
      <div class="ai-loading-row">
        <div class="ai-spinner"></div>
        <span>Menganalisis...</span>
      </div>
    </div>
  `;

  const textEl = document.getElementById('ai-panel-text');

  window.GroqService.fetchMitigationWithCache(
    { kabName: kab.name, status: risk.id, weather_desc: weather.weather_desc, tp: weather.tp || 0, hu: weather.hu || 0, ws: weather.ws || 0 },
    (chunk, fullText) => { if (textEl) textEl.innerHTML = renderMarkdown(fullText) + '<span class="cursor-blink">|</span>'; },
    (fullText) => { if (textEl) textEl.innerHTML = renderMarkdown(fullText); },
    (errMsg) => { if (textEl) textEl.innerHTML = `<div class="ai-error">⚠️ ${errMsg}</div>`; }
  );
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function updateHeader() {
  const el = document.getElementById('last-update');
  if (el) el.textContent = `Update: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })} WITA`;
}

function updateLastRefreshTime() {
  const el = document.getElementById('next-refresh');
  if (el) {
    let countdown = 30 * 60;
    clearInterval(window._countdownTimer);
    window._countdownTimer = setInterval(() => {
      countdown--;
      if (countdown <= 0) { clearInterval(window._countdownTimer); return; }
      const m = Math.floor(countdown / 60).toString().padStart(2, '0');
      const s = (countdown % 60).toString().padStart(2, '0');
      el.textContent = `Refresh dalam ${m}:${s}`;
    }, 1000);
  }
}

function formatDateTime(isoString) {
  if (!isoString) return '-';
  try {
    return new Date(isoString).toLocaleString('id-ID', {
      timeZone: 'Asia/Makassar',
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: 'short'
    }) + ' WITA';
  } catch { return isoString; }
}

function formatTimeOnly(isoString) {
  if (!isoString) return '-';
  try {
    return new Date(isoString).toLocaleString('id-ID', {
      timeZone: 'Asia/Makassar',
      hour: '2-digit', minute: '2-digit',
      weekday: 'short'
    });
  } catch { return '-'; }
}

function getWeatherEmoji(desc) {
  if (!desc) return '🌤️';
  const d = desc.toLowerCase();
  if (d.includes('badai') || d.includes('topan')) return '🌪️';
  if (d.includes('hujan lebat') || d.includes('sangat lebat')) return '⛈️';
  if (d.includes('hujan sedang')) return '🌧️';
  if (d.includes('hujan ringan') || d.includes('gerimis')) return '🌦️';
  if (d.includes('hujan')) return '🌧️';
  if (d.includes('petir')) return '⛈️';
  if (d.includes('berawan')) return '☁️';
  if (d.includes('cerah')) return '☀️';
  return '🌤️';
}

/**
 * Simple markdown renderer (headings, bold, lists)
 */
function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul class="md-list">${m}</ul>`)
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p class="md-p">')
    .replace(/\n/g, '<br>');
}

function showLoadingOverlay(show) {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  if (show) {
    overlay.classList.remove('hidden');
    overlay.classList.add('visible');
  } else {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.classList.add('hidden'), 500);
  }
}

function updateLoadingStatus(msg) {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = msg;
}

function updateLoadingProgress(done, total) {
  const bar = document.getElementById('loading-bar');
  if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add('toast--visible'), 10);
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}

function setupAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    debugLog('[SC] Auto-refresh dimulai...');
    await refreshData();
  }, AUTO_REFRESH_INTERVAL);
}

function setupUIEventListeners() {
  // Tombol refresh manual
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    refreshData();
  });

  // Tutup modal
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('detail-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'detail-modal') closeModal();
  });

  // Reset map view
  document.getElementById('btn-reset-map')?.addEventListener('click', () => {
    window.MapService.resetMapView();
  });

  // Settings panel toggle
  document.getElementById('btn-settings')?.addEventListener('click', toggleSettings);
  document.getElementById('settings-close')?.addEventListener('click', toggleSettings);

  // Save Groq key dari settings
  document.getElementById('btn-save-groq-key')?.addEventListener('click', () => {
    const input = document.getElementById('groq-key-setting');
    if (input?.value.trim()) {
      window.GroqService.setGroqApiKey(input.value.trim());
      showToast('✅ Groq API Key tersimpan!', 'success');
      toggleSettings();
      window.GroqService.clearMitigationCache();
    }
  });

  // Filter cards
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      filterCards(filter);
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Keyboard shortcut: Escape menutup modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function closeModal() {
  const modal = document.getElementById('detail-modal');
  modal?.classList.remove('visible');
  setTimeout(() => modal?.classList.add('hidden'), 300);
}

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  panel?.classList.toggle('hidden');
  panel?.classList.toggle('visible');
}

function filterCards(filter) {
  const cards = document.querySelectorAll('.kab-card');
  cards.forEach(card => {
    const id = card.dataset.id;
    const risk = currentRiskMap.get(id);
    if (filter === 'all' || !filter) {
      card.style.display = '';
    } else {
      card.style.display = risk?.id === filter.toUpperCase() ? '' : 'none';
    }
  });
}

function scrollToCard() {
  document.getElementById('kab-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveGroqKey() {
  const input = document.getElementById('groq-key-input');
  if (input?.value.trim()) {
    window.GroqService.setGroqApiKey(input.value.trim());
    showToast('✅ API Key tersimpan! Memuat ulang rekomendasi...', 'success');
    // Reload modal AI
    const modal = document.getElementById('detail-modal');
    if (modal?.classList.contains('visible')) {
      const id = document.querySelector('.kab-card[data-id]')?.dataset?.id;
      if (id) showKabDetail(id);
    }
  }
}

// Export controller
window.AppController = {
  handleKabClick,
  showKabDetail,
  scrollToCard,
  saveGroqKey,
  refreshData,
  filterCards
};

// Start app
document.addEventListener('DOMContentLoaded', initApp);
