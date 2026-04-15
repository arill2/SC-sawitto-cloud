const BMKG_BASE_URL = 'https://api.bmkg.go.id/publik/prakiraan-cuaca';

async function checkNames() {
    const codes = ['73.19.01.2001', '73.22.01.2001', '73.24.01.1001', '73.25.01.1001' , '73.26.01.1001' ];
    for (const c of codes) {
        try {
            const res = await fetch(`${BMKG_BASE_URL}?adm4=${c}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.data && data.data.length > 0) {
                    console.log(`${c} -> ${data.data[0].lokasi.kabupaten} (${data.data[0].lokasi.kecamatan})`);
                }
            }
        } catch (e) {}
    }
}
checkNames();
