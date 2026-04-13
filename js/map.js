/**
 * map.js — Peta interaktif Sulawesi Selatan menggunakan Leaflet.js
 * Color-coded berdasarkan risiko banjir per kabupaten/kota
 */
const SC_DEBUG = window.SC_DEBUG === true;
const debugLog = (...args) => { if (SC_DEBUG) console.log(...args); };

let map = null;
let kabupatenLayers = new Map(); // id → Leaflet layer
let markerLayers = new Map();   // id → Leaflet marker
let pulseLayers = new Map();    // id → Leaflet pulse marker
let selectedKabId = null;

/**
 * Inisialisasi peta Leaflet
 */
function initMap() {
  if (map) return map;

  map = L.map('sc-map', {
    center: [-3.6687, 119.9741],
    zoom: 7,
    minZoom: 6,
    maxZoom: 13,
    zoomControl: true,
    attributionControl: true
  });

  // Base layer — dark tile dari CartoDB
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  debugLog('[Map] Leaflet peta diinisialisasi');
  return map;
}

/**
 * Render kabupaten sebagai marker lingkaran (circle marker)
 * karena kita tidak memerlukan GeoJSON polyon yang berat
 * @param {Array} kabupatenList - Dari config
 * @param {Map} weatherMap - Dari BMKGService
 * @param {Map} riskMap - Dari ScoringService
 * @param {Function} onKabClick - Callback klik kabupaten
 */
function renderKabupatenMarkers(kabupatenList, weatherMap, riskMap, onKabClick) {
  if (!map) initMap();

  // Hapus marker lama
  markerLayers.forEach(marker => map.removeLayer(marker));
  markerLayers.clear();
  // Hapus pulse lama agar tidak menumpuk di setiap refresh
  pulseLayers.forEach(pulse => map.removeLayer(pulse));
  pulseLayers.clear();

  kabupatenList.forEach(kab => {
    if (!kab.lat || !kab.lng) return;

    const weather = weatherMap.get(kab.id) || {};
    const risk = riskMap.get(kab.id) || { id: 'AMAN', color: '#22c55e', label: 'AMAN' };
    const mapColors = window.ScoringService.getMapColors(risk.id);

    // Circle marker untuk setiap kabupaten
    const radius = kab.priority ? 18 : 14;

    const circleMarker = L.circleMarker([kab.lat, kab.lng], {
      radius,
      fillColor: mapColors.fillColor,
      color: risk.id === 'BAHAYA' || risk.id === 'WASPADA' ? '#fff' : '#1e293b',
      weight: risk.id === 'BAHAYA' || risk.id === 'WASPADA' ? 2.5 : 1.5,
      fillOpacity: 0.85,
      opacity: 1
    });

    // Tooltip
    circleMarker.bindTooltip(
      `<div class="map-tooltip">
        <strong>${kab.name}</strong>
        <span class="tooltip-status" style="color: ${risk.color}">${risk.icon || ''} ${risk.label}</span>
        <span class="tooltip-weather">${weather.weather_desc || 'N/A'}</span>
        ${weather.t ? `<span>🌡️ ${weather.t.toFixed(0)}°C</span>` : ''}
        ${kab.priority ? '<span class="tooltip-priority">⭐ Prioritas</span>' : ''}
      </div>`,
      {
        permanent: false,
        direction: 'top',
        className: 'sc-tooltip',
        offset: [0, -radius]
      }
    );

    // Popup saat klik
    circleMarker.on('click', () => {
      selectedKabId = kab.id;
      highlightKab(kab.id);
      if (onKabClick) onKabClick(kab.id, kab, weather, risk);
    });

    // Pulse animation untuk BAHAYA/WASPADA
    if (risk.id === 'BAHAYA' || risk.id === 'WASPADA') {
      const pulseMarker = addPulseEffect(kab.lat, kab.lng, risk.color, map);
      pulseLayers.set(kab.id, pulseMarker);
    }

    circleMarker.addTo(map);
    markerLayers.set(kab.id, circleMarker);
  });
}

/**
 * Tambahkan efek pulse untuk wilayah berisiko tinggi
 */
function addPulseEffect(lat, lng, color, targetMap) {
  const pulseIcon = L.divIcon({
    className: 'pulse-marker',
    html: `<div class="pulse-ring" style="--pulse-color: ${color}"></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });

  const pulseMarker = L.marker([lat, lng], {
    icon: pulseIcon,
    interactive: false,
    zIndexOffset: -100
  }).addTo(targetMap);

  return pulseMarker;
}

/**
 * Highlight kabupaten yang dipilih
 * @param {string} id
 */
function highlightKab(id) {
  // Reset semua marker ke style normal
  markerLayers.forEach((marker, markerId) => {
    const currentStyle = marker.options;
    if (markerId === id) {
      marker.setStyle({ weight: 4, color: '#ffffff', fillOpacity: 1 });
      marker.bringToFront();
    } else {
      marker.setStyle({ weight: currentStyle.weight > 3 ? 2.5 : 1.5, fillOpacity: 0.85 });
    }
  });
}

/**
 * Update warna marker berdasarkan data terbaru
 * @param {Map} riskMap - adm3 → risk object
 */
function updateMarkerColors(riskMap) {
  markerLayers.forEach((marker, id) => {
    const risk = riskMap.get(id);
    if (!risk) return;

    const mapColors = window.ScoringService.getMapColors(risk.id);
    marker.setStyle({
      fillColor: mapColors.fillColor,
      color: risk.id === 'BAHAYA' || risk.id === 'WASPADA' ? '#fff' : '#1e293b',
      weight: risk.id === 'BAHAYA' || risk.id === 'WASPADA' ? 2.5 : 1.5,
    });
  });
}

/**
 * Fly to kabupaten tertentu
 * @param {string} id
 * @param {Object} kab - Kabupaten config object
 */
function flyToKab(id, kab) {
  if (!map || !kab.lat || !kab.lng) return;
  map.flyTo([kab.lat, kab.lng], 10, { duration: 1.2, easing: 'linear' });
  highlightKab(id);
}

/**
 * Reset view ke Sulawesi Selatan
 */
function resetMapView() {
  if (!map) return;
  map.flyTo([-3.6687, 119.9741], 7, { duration: 1.0 });
  selectedKabId = null;

  // Reset semua highlight
  markerLayers.forEach(marker => {
    marker.setStyle({ weight: 1.5, fillOpacity: 0.85 });
  });
}

/**
 * Tambahkan legend ke peta
 */
function addMapLegend() {
  if (!map) return;

  const legend = L.control({ position: 'bottomleft' });

  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div class="legend-title">🗺️ Status Risiko</div>
      <div class="legend-item"><span class="legend-dot" style="background:#ef4444"></span> BAHAYA</div>
      <div class="legend-item"><span class="legend-dot" style="background:#f97316"></span> WASPADA</div>
      <div class="legend-item"><span class="legend-dot" style="background:#eab308"></span> SIAGA</div>
      <div class="legend-item"><span class="legend-dot" style="background:#22c55e"></span> AMAN</div>
    `;
    return div;
  };

  legend.addTo(map);
}

/**
 * Tambahkan scale control
 */
function addScaleControl() {
  if (!map) return;
  L.control.scale({ imperial: false, metric: true }).addTo(map);
}

/**
 * Init lengkap peta dengan semua fitur
 * @param {Object} options
 */
function initFullMap(options = {}) {
  initMap();
  addMapLegend();
  addScaleControl();
  return map;
}

// Export
window.MapService = {
  initMap,
  initFullMap,
  renderKabupatenMarkers,
  updateMarkerColors,
  flyToKab,
  resetMapView,
  highlightKab,
  getMap: () => map
};
