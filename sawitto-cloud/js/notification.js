/**
 * notification.js — Web Push Notification untuk peringatan banjir
 * Cooldown: 1x notifikasi per wilayah per 2 jam
 */

const NOTIFICATION_COOLDOWN = 2 * 60 * 60 * 1000; // 2 jam dalam ms
const STORAGE_KEY = 'sc_notification_log';
var SC_DEBUG = window.SC_DEBUG === true;
var debugLog = (...args) => { if (SC_DEBUG) console.log(...args); };

/**
 * Minta izin notifikasi dari user
 * @returns {Promise<boolean>} true jika diizinkan
 */
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('[Notification] Browser tidak mendukung Web Notifications');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    console.warn('[Notification] Izin notifikasi ditolak pengguna');
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (err) {
    console.error('[Notification] Gagal meminta izin:', err);
    return false;
  }
}

/**
 * Ambil log notifikasi dari localStorage
 * @returns {Object} Map dari kabId → timestamp terakhir notif
 */
function getNotificationLog() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Simpan log notifikasi ke localStorage
 * @param {Object} log
 */
function saveNotificationLog(log) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch (err) {
    console.warn('[Notification] Gagal menyimpan log:', err);
  }
}

/**
 * Cek apakah wilayah masih dalam cooldown
 * @param {string} kabId - ID kabupaten (adm3)
 * @returns {boolean}
 */
function isInCooldown(kabId) {
  const log = getNotificationLog();
  const lastSent = log[kabId];
  if (!lastSent) return false;
  return (Date.now() - lastSent) < NOTIFICATION_COOLDOWN;
}

/**
 * Catat notifikasi yang dikirim
 * @param {string} kabId
 */
function recordNotification(kabId) {
  const log = getNotificationLog();
  log[kabId] = Date.now();
  saveNotificationLog(log);
}

/**
 * Hitung sisa waktu cooldown dalam format HH:MM
 * @param {string} kabId
 * @returns {string}
 */
function getCooldownRemaining(kabId) {
  const log = getNotificationLog();
  const lastSent = log[kabId];
  if (!lastSent) return '00:00';

  const remaining = NOTIFICATION_COOLDOWN - (Date.now() - lastSent);
  if (remaining <= 0) return '00:00';

  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Kirim notifikasi untuk satu wilayah
 * @param {Object} params
 * @param {string} params.kabId
 * @param {string} params.kabName
 * @param {string} params.status - WASPADA atau BAHAYA
 * @param {string} params.weather_desc
 * @returns {boolean} true jika berhasil dikirim
 */
async function sendFloodAlert({ kabId, kabName, status, weather_desc }) {
  // Hanya kirim untuk WASPADA dan BAHAYA
  if (status !== 'WASPADA' && status !== 'BAHAYA') {
    return false;
  }

  // Cek cooldown
  if (isInCooldown(kabId)) {
    debugLog(`[Notification] ${kabName} dalam cooldown (sisa: ${getCooldownRemaining(kabId)})`);
    return false;
  }

  // Cek izin
  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) return false;

  const icon = status === 'BAHAYA' ? '🔴' : '🟠';
  const statusEmoji = status === 'BAHAYA' ? '⛔' : '⚠️';

  const title = `${statusEmoji} ${status} Banjir — ${kabName}`;
  const body = `${weather_desc} terdeteksi. Buka Sawitto Cloud untuk rekomendasi mitigasi.`;

  try {
    const notification = new Notification(title, {
      body,
      tag: `sc-${kabId}`, // Mencegah duplikat per wilayah
      requireInteraction: status === 'BAHAYA',
      silent: false,
      data: { kabId, kabName, status, url: window.location.href }
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
      // Trigger detail drawer
      if (window.AppController?.showKabDetail) {
        window.AppController.showKabDetail(kabId);
      }
    };

    recordNotification(kabId);
    debugLog(`[Notification] ✅ Terkirim: ${title}`);
    return true;

  } catch (err) {
    console.error('[Notification] Gagal mengirim:', err);
    return false;
  }
}

/**
 * Proses notifikasi batch untuk semua wilayah dengan status alert
 * @param {Array} alertAreas - Array dari { kabupaten, risk, weather }
 * @returns {number} Jumlah notifikasi yang berhasil dikirim
 */
async function processBatchNotifications(alertAreas) {
  if (!alertAreas || alertAreas.length === 0) return 0;

  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) return 0;

  let sentCount = 0;

  for (const area of alertAreas) {
    const success = await sendFloodAlert({
      kabId: area.kab.id,
      kabName: area.kab.name,
      status: area.risk.id,
      weather_desc: area.weather.weather_desc
    });

    if (success) sentCount++;

    // Delay kecil antara notifikasi agar tidak spam
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return sentCount;
}

/**
 * Reset log notifikasi (untuk testing)
 */
function resetNotificationLog() {
  localStorage.removeItem(STORAGE_KEY);
  debugLog('[Notification] Log direset');
}

/**
 * Cek apakah browser mendukung notifikasi
 * @returns {Object} { supported, permission }
 */
function getNotificationStatus() {
  if (!('Notification' in window)) {
    return { supported: false, permission: 'unsupported' };
  }
  return { supported: true, permission: Notification.permission };
}

// Export
window.NotificationService = {
  requestNotificationPermission,
  sendFloodAlert,
  processBatchNotifications,
  isInCooldown,
  getCooldownRemaining,
  resetNotificationLog,
  getNotificationStatus,
  getNotificationLog
};
