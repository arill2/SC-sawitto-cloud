# 🌊 Sawitto Cloud (SC)

> **Sistem Peringatan Dini Banjir Sulawesi Selatan**  
> Real-time flood warning system for 24 districts in South Sulawesi, Indonesia.

---

## ✨ Fitur Utama

| Fitur | Deskripsi |
|-------|-----------|
| 🗺️ **Peta Interaktif** | Peta Sulawesi Selatan dengan Leaflet.js, color-coded per status risiko |
| 🌦️ **Data BMKG Real-time** | Fetch bertahap (chunked concurrency) 24 kab/kota dengan fallback discovery ADM4 |
| 🤖 **AI Mitigasi** | Rekomendasi mitigasi oleh Groq AI (LLaMA 3 70B) dengan streaming |
| 🔔 **Push Notification** | Notifikasi browser untuk status WASPADA/BAHAYA (cooldown 2 jam) |
| 📊 **Grafik Curah Hujan** | Visualisasi Chart.js curah hujan per wilayah |
| 🔄 **Auto-Refresh** | Data diperbarui otomatis setiap 30 menit |

---

## 📁 Struktur Proyek

```
sawitto-cloud/
├── index.html           # Halaman utama dashboard
├── .env.example         # Template environment variables
├── sulsel_config.json   # Konfigurasi 24 kab/kota Sul-Sel
├── README.md            # Dokumentasi ini
├── css/
│   └── style.css        # Dark glassmorphism design system
└── js/
    ├── app.js           # Orchestrator utama & auto-refresh
    ├── bmkg.js          # BMKG API service (parallel fetch)
    ├── scoring.js       # Logika scoring risiko banjir
    ├── map.js           # Leaflet.js peta interaktif
    ├── groq.js          # Groq AI mitigasi (streaming)
    └── notification.js  # Web Push Notification
```

---

## 🚀 Cara Menjalankan

### Opsi 1: Buka Langsung (Sederhana)
```
Buka file index.html di browser modern (Chrome, Firefox, Edge)
```

> ⚠️ Beberapa browser memblokir fetch ke API eksternal dari `file://`. Gunakan live server untuk development.

### Opsi 2: VS Code Live Server (Direkomendasikan)
1. Install ekstensi **Live Server** di VS Code
2. Klik kanan `index.html` → **"Open with Live Server"**
3. Browser akan membuka `http://127.0.0.1:5500`

### Opsi 3: Python HTTP Server
```bash
cd sawitto-cloud
python -m http.server 8000
# Buka: http://localhost:8000
```

### Opsi 4: Node.js http-server
```bash
npx http-server ./sawitto-cloud -p 8000
# Buka: http://localhost:8000
```

### Deploy ke Vercel (dengan AI Proxy)
1. Import repository ke Vercel.
2. Tambahkan Environment Variable:
   - `GROQ_API_KEY` = API key Groq Anda.
3. Deploy.
4. Endpoint proxy otomatis aktif di `/api/groq-stream` (file: `api/groq-stream.js`).

---

## 🔑 Konfigurasi API Key (Groq)

Fitur AI Mitigasi memerlukan Groq API Key:

1. Daftar gratis di [console.groq.com](https://console.groq.com)
2. Buat API key baru
3. Di aplikasi: klik ⚙️ Settings → masukkan API Key → Simpan

API Key tersimpan di `localStorage` browser.

> ⚠️ Untuk **production publik**, jangan gunakan direct client mode.  
> Gunakan backend proxy dan set `window.SC_GROQ_PROXY_ENDPOINT` agar API key tidak terekspos ke browser pengguna.

---

## 📡 Data Source

### BMKG Open API
- **Endpoint**: `https://api.bmkg.go.id/publik/prakiraan-cuaca`
- **Parameter**: `?adm4={kode_wilayah}`
- **Autentikasi**: Tidak diperlukan (open access)
- **Fields**: `weather_desc`, `tp` (curah hujan), `hu` (kelembapan), `ws` (kecepatan angin), `t` (suhu), `local_datetime`

### Groq AI
- **Endpoint**: `https://api.groq.com/openai/v1/chat/completions`
- **Model**: `llama3-70b-8192`
- **Mode**: Streaming real-time
- **Trigger**: Hanya status WASPADA/BAHAYA

---

## 🎨 Level Risiko Banjir

| Status | Warna | Kondisi | Push Notif |
|--------|-------|---------|------------|
| 🔴 **BAHAYA** | `#ef4444` | Hujan Badai/Topan | ✅ Ya |
| 🟠 **WASPADA** | `#f97316` | Hujan Lebat | ✅ Ya |
| 🟡 **SIAGA** | `#eab308` | Hujan Sedang/Ringan | ❌ Tidak |
| 🟢 **AMAN** | `#22c55e` | Cerah/Berawan | ❌ Tidak |

Scoring menggunakan composite score dari:
- 50% → Deskripsi cuaca BMKG
- 30% → Curah hujan (mm)
- 10% → Kelembapan (%)
- 10% → Kecepatan angin (km/jam)

---

## 🏙️ Wilayah yang Dipantau

24 Kabupaten/Kota Sulawesi Selatan (ID referensi Kemendagri `73.XX`, dengan dukungan `adm2_bmkg` untuk wilayah pemekaran):

| # | Kabupaten/Kota | ID | Prioritas |
|---|----------------|------|-----------|
| 1 | Kab. Kepulauan Selayar | 73.01 | — |
| 2 | Kab. Bulukumba | 73.02 | — |
| 3 | Kab. Bantaeng | 73.03 | — |
| 4 | Kab. Jeneponto | 73.04 | — |
| 5 | Kab. Takalar | 73.05 | — |
| 6 | Kab. Gowa | 73.06 | — |
| 7 | Kab. Sinjai | 73.07 | — |
| 8 | Kab. Bone | 73.08 | — |
| 9 | Kab. Maros | 73.09 | — |
| 10 | Kab. Pangkajene Kepulauan | 73.10 | — |
| 11 | Kab. Barru | 73.11 | — |
| 12 | Kab. Soppeng | 73.12 | — |
| 13 | Kab. Wajo | 73.13 | — |
| 14 | Kab. Sidenreng Rappang | 73.14 | — |
| 15 | **Kab. Pinrang** | **73.15** | **⭐ Prioritas** |
| 16 | Kab. Enrekang | 73.16 | — |
| 17 | Kab. Luwu | 73.17 | — |
| 18 | Kab. Tana Toraja | 73.18 | — |
| 19 | Kab. Luwu Utara | 73.19 | — |
| 20 | Kab. Luwu Timur | 73.20 | — |
| 21 | Kab. Toraja Utara | 73.21 | — |
| 22 | Kota Makassar | 73.71 | — |
| 23 | Kota Parepare | 73.72 | — |
| 24 | Kota Palopo | 73.73 | — |

---

## ⚙️ Tech Stack

| Teknologi | Kegunaan |
|-----------|----------|
| **HTML5** | Struktur semantik |
| **Vanilla CSS** | Dark glassmorphism design |
| **Vanilla JavaScript** | Logika aplikasi (no framework) |
| **Leaflet.js 1.9.4** | Peta interaktif |
| **Chart.js 4.4** | Grafik curah hujan |
| **BMKG Open API** | Data cuaca real-time |
| **Groq API** | AI mitigasi (LLaMA 3 70B) |
| **Web Push API** | Browser push notifications |

---

## 📝 Lisensi & Kredit

- Data cuaca: [BMKG](https://bmkg.go.id) (Open Data)
- AI: [Groq](https://groq.com) (LLaMA 3 70B)
- Peta: [Leaflet.js](https://leafletjs.com) + [CartoDB Tiles](https://carto.com)

> ⚠️ **Disclaimer**: Informasi pada Sawitto Cloud bersifat informatif berbasis data BMKG. Untuk keadaan darurat, selalu ikuti arahan resmi BPBD dan instansi terkait setempat.

---

*Sawitto Cloud — Melindungi Sulawesi Selatan dari Ancaman Banjir* 🌊
