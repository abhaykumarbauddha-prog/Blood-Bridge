const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../backend/server');
const requestController = require('../backend/controllers/requestController');

const requiredFiles = [
  'frontend/index.html',
  'frontend/auth.html',
  'frontend/reset-password.html',
  'frontend/terms.html',
  'frontend/privacy.html',
  'frontend/dashboard.html',
  'frontend/blood-request.html',
  'frontend/donation-history.html',
  'frontend/help-support.html',
  'frontend/settings.html',
  'frontend/css/global.css',
  'frontend/js/supabase.js',
  'frontend/js/auth.js',
  'frontend/js/donation-history.js',
  'frontend/js/help-support.js',
  'frontend/js/settings.js',
  'frontend/js/admin-management.js',
  'frontend/js/requests.js',
  'database/schema.sql'
];

for (const file of requiredFiles) {
  assert.equal(fs.existsSync(path.resolve(__dirname, '..', file)), true, `${file} is missing`);
}

assert.equal(typeof app, 'function', 'Express app failed to load');

const migrationDir = path.resolve(__dirname, '..', 'supabase/migrations');
for (const migration of [
  '20261011_phase2_security_hardening.sql',
  '20261011_phase3_request_lifecycle.sql',
  '20261011_phase4_notifications.sql',
  '20261011_phase5_location_truth.sql',
  '20261011_phase6_hospital_inventory.sql',
  '20261011_phase7_remaining_pages.sql',
  '20261011_phase8_completion_fixes.sql'
  , '20261026_admin_dashboard_security.sql'
  , '20261026_admin_management.sql'
]) {
  assert.equal(fs.existsSync(path.join(migrationDir, migration)), true, `${migration} is missing`);
}

const frontendRoot = path.resolve(__dirname, '..', 'frontend');
const frontendSource = fs.readdirSync(frontendRoot, { recursive: true })
  .filter((file) => file.endsWith('.html') || file.endsWith('.js'))
  .map((file) => fs.readFileSync(path.join(frontendRoot, file), 'utf8'))
  .join('\n');
assert.equal(/service_role|SUPABASE_SERVICE_ROLE/i.test(frontendSource), false, 'A service-role secret was found in frontend files');
assert.match(fs.readFileSync(path.join(frontendRoot, 'auth.html'), 'utf8'), /reset-password\.html/);
assert.match(fs.readFileSync(path.join(frontendRoot, 'auth.html'), 'utf8'), /terms\.html/);
assert.match(fs.readFileSync(path.join(frontendRoot, 'auth.html'), 'utf8'), /privacy\.html/);
assert.match(fs.readFileSync(path.join(frontendRoot, 'js/auth.js'), 'utf8'), /signInWithOAuth/);
assert.match(fs.readFileSync(path.join(frontendRoot, 'js/help-support.js'), 'utf8'), /support_messages/);

function responseMock() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

(async () => {
  const missingRequestResponse = responseMock();
  await requestController.createRequest({ body: {} }, missingRequestResponse);
  assert.equal(missingRequestResponse.statusCode, 400);
  assert.match(missingRequestResponse.body.error, /patient_name is required/i);

  const invalidStatusResponse = responseMock();
  await requestController.updateRequestStatus(
    { params: { id: 'example' }, body: { status: 'Invalid' } },
    invalidStatusResponse
  );
  assert.equal(invalidStatusResponse.statusCode, 400);

  console.log('Smoke tests passed');
})();
