/**
 * Probing all 73.XX.01.1001 codes to find valid kabupaten in BMKG API
 */

const BMKG_BASE_URL = 'https://api.bmkg.go.id/publik/prakiraan-cuaca';

async function probe() {
    const validKabs = [];
    console.log('Probing 73.01 to 73.99...');
    
    for (let i = 1; i <= 99; i++) {
        const kab = '73.' + String(i).padStart(2, '0');
        const cand = `${kab}.01.1001`;
        const cand2 = `${kab}.01.2001`;
        
        process.stdout.write(`Testing ${kab}... `);
        
        let ok = false;
        try {
            const res = await fetch(`${BMKG_BASE_URL}?adm4=${cand}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.data && data.data.length > 0) {
                    ok = true;
                    console.log(`✅ FOUND (${data.data[0].lokasi.kabupaten})`);
                }
            }
            
            if (!ok) {
                const res2 = await fetch(`${BMKG_BASE_URL}?adm4=${cand2}`);
                if (res2.ok) {
                    const data2 = await res2.json();
                    if (data2 && data2.data && data2.data.length > 0) {
                        ok = true;
                        console.log(`✅ FOUND (${data2.data[0].lokasi.kabupaten})`);
                    }
                }
            }
        } catch (e) {}
        
        if (!ok) console.log('❌');
        
        if (ok) {
            validKabs.push(kab);
        }
        
        await new Promise(r => setTimeout(r, 100));
    }
    
    console.log('Summary of valid ADM2 codes for 73.XX:', validKabs);
}

probe();
