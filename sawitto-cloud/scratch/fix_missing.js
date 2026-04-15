const fs = require('fs');

/**
 * Script perbaikan untuk menemukan ADM4 yang belum ketemu
 */

const missing = [
  { id: "73.19", name: "Kab. Luwu Utara", adm2_bmkg: "73.22" },
  { id: "73.20", name: "Kab. Luwu Timur", adm2_bmkg: "73.24" },
  { id: "73.21", name: "Kab. Toraja Utara", adm2_bmkg: "73.26" }
];

const BMKG_BASE_URL = 'https://api.bmkg.go.id/publik/prakiraan-cuaca';

async function testCode(adm4) {
    try {
        const res = await fetch(`${BMKG_BASE_URL}?adm4=${adm4}`);
        if (!res.ok) return false;
        const data = await res.json();
        return !!(data && data.data && data.data.length > 0);
    } catch (e) {
        return false;
    }
}

async function fixMissing() {
    console.log('--- Rescuing Missing Districts ---');
    const fixed = {};

    for (const kab of missing) {
        console.log(`Searching for ${kab.name}...`);
        let found = null;
        
        // Coba kecamatan 01 s/d 15
        const bmkgAdm2 = kab.adm2_bmkg || kab.id;

        for (let kec = 1; kec <= 15; kec++) {
            const kecStr = String(kec).padStart(2, '0');
            const variants = [`${bmkgAdm2}.${kecStr}.1001`, `${bmkgAdm2}.${kecStr}.2001`, `${bmkgAdm2}.${kecStr}.2002` ];
            
            for (const cand of variants) {
                console.log(`  Trying ${cand}...`);
                const ok = await testCode(cand);
                if (ok) {
                    found = cand;
                    console.log(`  ✅ MATCH FOUND: ${found}`);
                    break;
                }
                await new Promise(r => setTimeout(r, 100));
            }
            if (found) break;
        }
        fixed[kab.id] = found;
    }

    console.log('Found so far:', fixed);
    
    // Update results.json
    const resultsPath = 'scratch/results.json';
    const currentResults = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
    
    const updated = currentResults.map(item => {
        if (fixed[item.id]) {
            return { ...item, adm4_valid: fixed[item.id] };
        }
        return item;
    });
    
    fs.writeFileSync(resultsPath, JSON.stringify(updated, null, 2));
    console.log('Results updated.');
}

fixMissing();
