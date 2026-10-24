// test/full_project_test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

console.log('====================================================');
console.log('   BLOOD BRIDGE FULL SYSTEM AUTOMATED TEST SUITE    ');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertTest(name, condition, errorMsg = '') {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  [PASS] ${name}`);
    } else {
        failedTests++;
        console.error(`  [FAIL] ${name} ${errorMsg ? `-> ${errorMsg}` : ''}`);
    }
}

// ----------------------------------------------------
// TEST GROUP 1: JavaScript Syntax Checks
// ----------------------------------------------------
console.log('1. Checking JavaScript Syntax Across All Controller & Service Files:');
const jsFiles = [
    'frontend/js/supabase.js',
    'frontend/js/map-service.js',
    'frontend/js/data-helpers.js',
    'frontend/js/auth.js',
    'frontend/js/auth-guard.js',
    'frontend/js/dashboard.js',
    'frontend/js/hospital-dashboard.js',
    'frontend/js/admin-dashboard.js',
    'frontend/js/requests.js',
    'frontend/js/nearby-requests.js',
    'frontend/js/find-donors.js',
    'frontend/js/donation-history.js',
    'frontend/js/notifications.js',
    'frontend/js/settings.js',
    'frontend/js/help-support.js',
    'frontend/js/profile.js',
    'frontend/js/profile-sync.js',
    'frontend/js/index.js',
    'backend/server.js',
    'backend/controllers/donorController.js',
    'backend/controllers/requestController.js',
    'backend/controllers/hospitalController.js',
    'backend/routes/donorRoutes.js',
    'backend/routes/requestRoutes.js',
    'backend/routes/hospitalRoutes.js'
];

jsFiles.forEach(file => {
    try {
        execSync(`node -c "${file}"`, { stdio: 'pipe' });
        assertTest(`Syntax valid: ${file}`, true);
    } catch (e) {
        assertTest(`Syntax valid: ${file}`, false, e.message);
    }
});

// ----------------------------------------------------
// TEST GROUP 2: Security & Isolation Checks
// ----------------------------------------------------
console.log('\n2. Security, Keys & Origin Integrity Checks:');
const frontendDir = path.resolve(__dirname, '../frontend');
const frontendSource = fs.readdirSync(frontendDir, { recursive: true })
    .filter(f => f.endsWith('.html') || f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(frontendDir, f), 'utf8'))
    .join('\n');

assertTest(
    'No SUPABASE_SERVICE_ROLE_KEY exposed in frontend files',
    !/service_role|SUPABASE_SERVICE_ROLE/i.test(frontendSource)
);

assertTest(
    'No hardcoded localhost origins in frontend code',
    !/http:\/\/localhost:\d+/i.test(frontendSource)
);

// ----------------------------------------------------
// TEST GROUP 3: Database Migrations Integrity
// ----------------------------------------------------
console.log('\n3. Database Migrations & Schema Files:');
const migrationDir = path.resolve(__dirname, '../supabase/migrations');
const expectedMigrations = [
    '20261011_phase2_security_hardening.sql',
    '20261011_phase3_request_lifecycle.sql',
    '20261011_phase4_notifications.sql',
    '20261011_phase5_location_truth.sql',
    '20261011_phase6_hospital_inventory.sql',
    '20261011_phase7_remaining_pages.sql',
    '20261011_phase8_completion_fixes.sql'
];

expectedMigrations.forEach(migration => {
    const exists = fs.existsSync(path.join(migrationDir, migration));
    assertTest(`Migration present: ${migration}`, exists);
});

assertTest('database/schema.sql exists and is non-empty', fs.statSync('database/schema.sql').size > 1000);

// ----------------------------------------------------
// TEST GROUP 4: HTTP Endpoint Availability Check
// ----------------------------------------------------
console.log('\n4. Live HTTP Endpoint Tests (http://127.0.0.1:3000):');
const endpoints = [
    '/',
    '/index.html',
    '/auth.html',
    '/auth-simple.html',
    '/reset-password.html',
    '/dashboard.html',
    '/hospital-dashboard.html',
    '/admin-dashboard.html',
    '/blood-request.html',
    '/nearby-request.html',
    '/find-donors.html',
    '/donation-history.html',
    '/my-profile.html',
    '/notifications.html',
    '/settings.html',
    '/help-support.html',
    '/terms.html',
    '/privacy.html',
    '/api/donors',
    '/api/requests',
    '/api/hospitals/stats'
];

function testHttpEndpoint(urlPath) {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:3000${urlPath}`, (res) => {
            const isOk = res.statusCode >= 200 && res.statusCode < 400;
            assertTest(`HTTP ${res.statusCode} for ${urlPath}`, isOk, `Status code: ${res.statusCode}`);
            res.resume();
            resolve();
        });
        req.on('error', (err) => {
            assertTest(`HTTP connection for ${urlPath}`, false, err.message);
            resolve();
        });
        req.setTimeout(3000, () => {
            req.destroy();
            assertTest(`HTTP timeout for ${urlPath}`, false, 'Timed out');
            resolve();
        });
    });
}

(async () => {
    for (const ep of endpoints) {
        await testHttpEndpoint(ep);
    }

    // ----------------------------------------------------
    // TEST GROUP 5: HTML Script & Asset References
    // ----------------------------------------------------
    console.log('\n5. Script & Asset Reference Validation in HTML Files:');
    const htmlFiles = fs.readdirSync(frontendDir).filter(f => f.endsWith('.html'));

    for (const hFile of htmlFiles) {
        const content = fs.readFileSync(path.join(frontendDir, hFile), 'utf8');
        const scriptTags = [...content.matchAll(/<script\s+[^>]*src=["']([^"']+)["']/gi)].map(m => m[1]);

        for (const src of scriptTags) {
            if (src.startsWith('http://') || src.startsWith('https://')) {
                continue; // External CDN
            }
            const cleanSrc = src.split('?')[0];
            const assetPath = path.resolve(frontendDir, cleanSrc);
            const exists = fs.existsSync(assetPath);
            assertTest(`${hFile} -> script "${cleanSrc}" exists`, exists);
        }
    }

    // ----------------------------------------------------
    // TEST GROUP 6: Backend Controller Validation
    // ----------------------------------------------------
    console.log('\n6. Backend Unit & Validation Checks:');
    const requestController = require('../backend/controllers/requestController');
    function mockResponse() {
        return {
            statusCode: 200,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(data) { this.body = data; return this; }
        };
    }

    const res1 = mockResponse();
    await requestController.createRequest({ body: {} }, res1);
    assertTest('requestController.createRequest rejects empty payload with 400', res1.statusCode === 400);

    const res2 = mockResponse();
    await requestController.updateRequestStatus({ params: { id: 'test' }, body: { status: 'invalid_status' } }, res2);
    assertTest('requestController.updateRequestStatus rejects invalid status with 400', res2.statusCode === 400);

    console.log('\n====================================================');
    console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
    console.log('====================================================');

    process.exit(failedTests > 0 ? 1 : 0);
})();
