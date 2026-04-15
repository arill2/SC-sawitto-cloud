/**
 * groq.js — Integrasi Groq AI untuk rekomendasi mitigasi banjir
 * Endpoint: https://api.groq.com/openai/v1/chat/completions
 * Model: llama-3.3-70b-versatile
 */

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_PROXY_ENDPOINT = window.SC_GROQ_PROXY_ENDPOINT || null;
const IS_LOCALHOST = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const ALLOW_CLIENT_GROQ = window.SC_ALLOW_CLIENT_GROQ === true;

/**
 * Ambil API key hanya dari runtime memory/localStorage.
 * Meta tag sengaja tidak dipakai untuk mencegah hardcoded key di frontend deploy.
 */
function getGroqApiKey() {
  return window.GROQ_API_KEY ||
         localStorage.getItem('sc_groq_api_key') ||
         null;
}

/**
 * Set API key secara runtime (dari UI settings)
 * @param {string} key
 */
function setGroqApiKey(key) {
  window.GROQ_API_KEY = key;
  localStorage.setItem('sc_groq_api_key', key);
}

/**
 * Build prompt mitigasi untuk Groq
 * @param {Object} params
 * @returns {Array} messages array
 */
function buildMitigationPrompt({ kabName, status, weather_desc, tp, hu, ws }) {
  const systemPrompt = `Kamu adalah ahli mitigasi bencana banjir Indonesia. 
Berikan rekomendasi yang spesifik, praktis, dan mudah dipahami masyarakat awam.
Format responmu menggunakan markdown yang rapi dengan emoji yang relevan.
Selalu gunakan bahasa Indonesia yang baik dan mudah dipahami.`;

  const userPrompt = `Wilayah ${kabName}, Sulawesi Selatan saat ini berstatus ${status} dengan kondisi ${weather_desc}. 
Curah hujan: ${tp.toFixed(1)}mm, Kelembapan: ${hu.toFixed(0)}%, Kecepatan angin: ${ws.toFixed(0)} km/jam.

Berikan rekomendasi mitigasi dalam 3 bagian yang jelas:

## 🏠 1. Untuk Warga
(langkah evakuasi & keselamatan yang harus dilakukan segera)

## 🚨 2. Untuk Petugas BPBD
(koordinasi, logistik, dan prosedur operasi standar)

## ⚠️ 3. Area & Rute yang Dihindari
(lokasi berbahaya, jalur evakuasi yang aman, titik kumpul)

Berikan juga perkiraan durasi waspada berdasarkan kondisi saat ini.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}

/**
 * Fetch rekomendasi mitigasi dari Groq AI dengan streaming
 * @param {Object} params - { kabName, status, weather_desc, tp, hu, ws }
 * @param {Function} onChunk - Callback untuk setiap chunk streaming
 * @param {Function} onComplete - Callback ketika selesai
 * @param {Function} onError - Callback ketika error
 */
async function fetchMitigationAdvice(params, onChunk, onComplete, onError) {
  const messages = buildMitigationPrompt(params);

  try {
    // Mode production direkomendasikan melalui proxy backend agar API key tidak terekspos.
    if (GROQ_PROXY_ENDPOINT) {
      const response = await fetch(GROQ_PROXY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GROQ_MODEL, messages, stream: true })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `HTTP ${response.status}`;
        onError(`Proxy AI Error: ${errMsg}`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onChunk(delta, fullText);
            }
          } catch {
            // Skip malformed chunk
          }
        }
      }

      onComplete(fullText);
      return;
    }

    if (!IS_LOCALHOST && !ALLOW_CLIENT_GROQ) {
      onError('AI mode direct dari browser dinonaktifkan di production. Konfigurasikan SC_GROQ_PROXY_ENDPOINT di server deploy Anda.');
      return;
    }

    const apiKey = getGroqApiKey();
    if (!apiKey) {
      onError('API Key Groq belum dikonfigurasi. Silakan atur API key di panel pengaturan.');
      return;
    }

    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 1200,
        stream: true
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP ${response.status}`;

      if (response.status === 401) {
        onError('API Key Groq tidak valid. Periksa kembali key Anda.');
      } else if (response.status === 429) {
        onError('Batas penggunaan Groq API tercapai. Coba lagi dalam beberapa menit.');
      } else {
        onError(`Groq API Error: ${errMsg}`);
      }
      return;
    }

    // Handle streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Simpan baris yang belum lengkap

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const jsonStr = trimmed.slice(6);
            const parsed = JSON.parse(jsonStr);
            const delta = parsed?.choices?.[0]?.delta?.content;

            if (delta) {
              fullText += delta;
              onChunk(delta, fullText);
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    }

    onComplete(fullText);

  } catch (err) {
    if (err.name === 'AbortError') {
      onError('Request dibatalkan.');
    } else if (err.message.includes('fetch')) {
      onError('Tidak dapat terhubung ke Groq API. Periksa koneksi internet Anda.');
    } else {
      onError(`Error: ${err.message}`);
    }
  }
}

/**
 * Cache untuk menghindari request berulang dalam waktu singkat
 */
const mitigationCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 menit

/**
 * Fetch mitigasi dengan cache
 * @param {Object} params
 * @param {Function} onChunk
 * @param {Function} onComplete
 * @param {Function} onError
 */
async function fetchMitigationWithCache(params, onChunk, onComplete, onError) {
  const cacheKey = `${params.kabName}_${params.status}`;
  const cached = mitigationCache.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
    // Simulasi streaming dari cache
    const words = cached.text.split(' ');
    let accumulated = '';
    for (const word of words) {
      accumulated += (accumulated ? ' ' : '') + word;
      onChunk(word + ' ', accumulated);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    onComplete(cached.text);
    return;
  }

  await fetchMitigationAdvice(
    params,
    onChunk,
    (fullText) => {
      mitigationCache.set(cacheKey, { text: fullText, timestamp: Date.now() });
      onComplete(fullText);
    },
    onError
  );
}

/**
 * Clear cache mitigasi
 */
function clearMitigationCache() {
  mitigationCache.clear();
}

// Export
window.GroqService = {
  fetchMitigationAdvice,
  fetchMitigationWithCache,
  getGroqApiKey,
  setGroqApiKey,
  clearMitigationCache,
  GROQ_MODEL
};
