const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../backend/server');
const requestController = require('../backend/controllers/requestController');

const requiredFiles = [
  'frontend/index.html',
  'frontend/auth.html',
  'frontend/dashboard.html',
  'frontend/blood-request.html',
  'frontend/css/global.css',
  'frontend/js/supabase.js',
  'frontend/js/auth.js',
  'frontend/js/requests.js',
  'database/schema.sql'
];

for (const file of requiredFiles) {
  assert.equal(fs.existsSync(path.resolve(__dirname, '..', file)), true, `${file} is missing`);
}

assert.equal(typeof app, 'function', 'Express app failed to load');

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
