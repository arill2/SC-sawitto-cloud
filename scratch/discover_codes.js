const fs = require('fs');
const path = require('path');

/**
 * Script ini digunakan untuk menemukan kode ADM4 (desa/kelurahan) valid 
 * untuk setiap kabupaten/kota di Sulawesi Selatan guna penarikan data BMKG.
 */

const configPath = path.join(__dirname, '..', 'sulsel_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const BMKG_BASE_URL = 'https://api.bmkg.go.id/publik/prakiraan-cuaca';

async function testCode(adm4) {
    try {
        const res = await fetch(`${BMKG_BASE_URL}?adm4=${adm4}`, {
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) return false;
        const data = await res.json();
        const isValid = !!(data && data.data && data.data.length > 0);
        return isValid;
    } catch (e) {
        return false;
    }
}

async function discover() {
    console.log('--- BMKG ADM4 Discovery Started ---');
    const results = [];
    
    for (const kab of config.kabupaten) {
        console.log(`[${kab.id}] Checking ${kab.name}...`);
        
        // Gunakan kode BMKG jika tersedia (untuk kabupaten hasil pemekaran)
        const bmkgAdm2 = kab.adm2_bmkg || kab.adm2 || kab.id;

        // Kandidat default + prioritas khusus Toraja Utara (73.26)
        const candidates = kab.id === '73.21'
            ? [
                `${bmkgAdm2}.01.1001`,
                `${bmkgAdm2}.01.1002`,
                `${bmkgAdm2}.01.2001`,
                `${bmkgAdm2}.02.1001`,
                `${bmkgAdm2}.02.2001`,
                `${bmkgAdm2}.03.1001`,
                `${bmkgAdm2}.03.2001`,
                `${bmkgAdm2}.04.1001`,
                `${bmkgAdm2}.04.2001`,
            ]
            : [
                `${bmkgAdm2}.01.1001`, 
                `${bmkgAdm2}.01.2001`, 
                `${bmkgAdm2}.02.1001`,
                `${bmkgAdm2}.02.2001`,
                `${bmkgAdm2}.03.1001`,
                `${bmkgAdm2}.03.2001`,
                `${bmkgAdm2}.04.1001`,
                `${bmkgAdm2}.04.2001`,
            ];
        
        let found = null;
        for (const cand of candidates) {
            process.stdout.write(`  Trying ${cand}... `);
            const ok = await testCode(cand);
            if (ok) {
                console.log('✅ VALID');
                found = cand;
                break;
            } else {
                console.log('❌');
            }
            // Delay singkat untuk stabilitas
            await new Promise(r => setTimeout(r, 200));
        }
        
        if (!found) {
            console.log(`  ⚠️ WARNING: No valid code found for ${kab.name} in current candidates.`);
        }
        
        results.push({ id: kab.id, name: kab.name, adm4_valid: found });
    }
    
    const resultsPath = path.join(__dirname, 'results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log('\n--- Discovery Finished ---');
    console.log(`Results saved to: ${resultsPath}`);
}

discover();
