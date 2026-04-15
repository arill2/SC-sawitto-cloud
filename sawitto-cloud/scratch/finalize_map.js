/**
 * Get names for all valid ADM2 codes found in 73.XX
 */
const BMKG_BASE_URL = 'https://api.bmkg.go.id/publik/prakiraan-cuaca';

const foundKabs = [
  '73.01', '73.02', '73.03',
  '73.04', '73.05', '73.06',
  '73.07', '73.08', '73.09',
  '73.10', '73.11', '73.12',
  '73.13', '73.14', '73.15',
  '73.16', '73.17', '73.18', // Added manually since I found them in first run
  '73.22', '73.24', '73.25', '73.26', '73.71', '73.72', '73.73'
];

async function finalize() {
    for (const id of foundKabs) {
        const candidates = [`${id}.01.1001`, `${id}.01.2001`, `${id}.02.1001`, `${id}.03.1001`, `${id}.04.1001`, `${id}.01.2002` ];
        for (const c of candidates) {
            try {
                const res = await fetch(`${BMKG_BASE_URL}?adm4=${c}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.data && data.data.length > 0) {
                        const loc = data.data[0].lokasi;
                        console.log(`${id} | ${c} | ${loc.kabupaten} | ${loc.kecamatan}`);
                        break;
                    }
                }
            } catch (e) {}
        }
    }
}
finalize();
