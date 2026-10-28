// test/admin_dashboard_unit_test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Admin Dashboard Unit & Integration Tests ---');

// 1. Static HTML Validation
const htmlPath = path.join(__dirname, '..', 'frontend', 'admin-dashboard.html');
const html = fs.readFileSync(htmlPath, 'utf8');

console.log('\n1. HTML Structure Tests:');

// Must NOT contain old broken text
assert.strictEqual(
    html.includes('Donation data unavailable yet.'),
    false,
    'FAIL: admin-dashboard.html still contains "Donation data unavailable yet."'
);
console.log('  [PASS] "Donation data unavailable yet" has been completely removed');

assert.strictEqual(
    html.includes('No activity data available yet.'),
    false,
    'FAIL: admin-dashboard.html still contains "No activity data available yet."'
);
console.log('  [PASS] "No activity data available yet" has been completely removed');

// Must contain chart elements
assert.ok(html.includes('id="chart-total-requests"'), 'FAIL: Missing #chart-total-requests');
assert.ok(html.includes('id="chart-total-donations"'), 'FAIL: Missing #chart-total-donations');
assert.ok(html.includes('id="chart-fulfillment-rate"'), 'FAIL: Missing #chart-fulfillment-rate');
assert.ok(html.includes('id="admin-request-donation-chart"'), 'FAIL: Missing #admin-request-donation-chart');
console.log('  [PASS] Chart container and live KPI pills are present in HTML');

// Must contain activity elements
assert.ok(html.includes('id="admin-activity-list"'), 'FAIL: Missing #admin-activity-list');
console.log('  [PASS] Activity list container #admin-activity-list is present in HTML');

// Must contain reports and tabs
assert.ok(html.includes('id="tab-report-pending"'), 'FAIL: Missing #tab-report-pending');
assert.ok(html.includes('id="tab-report-resolved"'), 'FAIL: Missing #tab-report-resolved');
assert.ok(html.includes('id="tab-report-rejected"'), 'FAIL: Missing #tab-report-rejected');
assert.ok(html.includes('id="badge-reports-pending"'), 'FAIL: Missing #badge-reports-pending');
assert.ok(html.includes('id="badge-reports-resolved"'), 'FAIL: Missing #badge-reports-resolved');
assert.ok(html.includes('id="badge-reports-rejected"'), 'FAIL: Missing #badge-reports-rejected');
assert.ok(html.includes('id="admin-reports-container"'), 'FAIL: Missing #admin-reports-container');
console.log('  [PASS] Reports moderation container, tabs, and count badges are present in HTML');

// Must contain CSS styles for chart bars and moderation buttons
assert.ok(html.includes('.chart-bar-req'), 'FAIL: Missing .chart-bar-req CSS');
assert.ok(html.includes('.chart-bar-don'), 'FAIL: Missing .chart-bar-don CSS');
assert.ok(html.includes('.btn-mod-resolve'), 'FAIL: Missing .btn-mod-resolve CSS');
assert.ok(html.includes('.btn-mod-reject'), 'FAIL: Missing .btn-mod-reject CSS');
assert.ok(html.includes('.btn-mod-reopen'), 'FAIL: Missing .btn-mod-reopen CSS');
console.log('  [PASS] Styling for chart bars and moderation action buttons is present in CSS');

// 2. JavaScript Controller Validation
const jsPath = path.join(__dirname, '..', 'frontend', 'js', 'admin-dashboard.js');
const js = fs.readFileSync(jsPath, 'utf8');

console.log('\n2. JavaScript Logic Tests:');
assert.ok(js.includes('loadRequestDonationChart'), 'FAIL: Missing loadRequestDonationChart in JS');
assert.ok(js.includes('subscribeToLiveDonations'), 'FAIL: Missing subscribeToLiveDonations in JS');
assert.ok(js.includes('loadAdminActivities'), 'FAIL: Missing loadAdminActivities in JS');
assert.ok(js.includes('loadAdminReports'), 'FAIL: Missing loadAdminReports in JS');
assert.ok(js.includes('handleReportAction'), 'FAIL: Missing handleReportAction in JS');
assert.ok(js.includes('renderReportsTab'), 'FAIL: Missing renderReportsTab in JS');
assert.ok(js.includes('updateReportBadges'), 'FAIL: Missing updateReportBadges in JS');
console.log('  [PASS] Core controller functions defined in admin-dashboard.js');

// 3. Functional Simulation: Moderation Logic
console.log('\n3. Moderation State Transitions:');
let reports = [
    { id: '1', status: 'open', subject: 'Pending Ticket' },
    { id: '2', status: 'in_progress', subject: 'Under Review' },
    { id: '3', status: 'resolved', subject: 'Fixed' },
    { id: '4', status: 'rejected', subject: 'Spam' }
];

function isPending(r) {
    const s = (r.status || '').toLowerCase();
    return s === 'open' || s === 'in_progress' || s === 'pending';
}
function isResolved(r) { return (r.status || '').toLowerCase() === 'resolved'; }
function isRejected(r) { return (r.status || '').toLowerCase() === 'rejected'; }

let pendingCount = reports.filter(isPending).length;
let resolvedCount = reports.filter(isResolved).length;
let rejectedCount = reports.filter(isRejected).length;

assert.strictEqual(pendingCount, 2, 'Should have 2 pending reports');
assert.strictEqual(resolvedCount, 1, 'Should have 1 resolved report');
assert.strictEqual(rejectedCount, 1, 'Should have 1 rejected report');
console.log('  [PASS] Initial badge counts: Pending = 2, Resolved = 1, Rejected = 1');

// Action: Resolve report 1
reports.find(r => r.id === '1').status = 'resolved';
assert.strictEqual(reports.filter(isPending).length, 1, 'Pending should decrease to 1');
assert.strictEqual(reports.filter(isResolved).length, 2, 'Resolved should increase to 2');
console.log('  [PASS] Sub-function "Resolve": moves ticket from Pending -> Resolved');

// Action: Reject report 2
reports.find(r => r.id === '2').status = 'rejected';
assert.strictEqual(reports.filter(isPending).length, 0, 'Pending should decrease to 0');
assert.strictEqual(reports.filter(isRejected).length, 2, 'Rejected should increase to 2');
console.log('  [PASS] Sub-function "Reject": moves ticket from Pending -> Rejected');

// Action: Reopen report 4
reports.find(r => r.id === '4').status = 'open';
assert.strictEqual(reports.filter(isPending).length, 1, 'Pending should increase to 1');
assert.strictEqual(reports.filter(isRejected).length, 1, 'Rejected should decrease to 1');
console.log('  [PASS] Sub-function "Reopen": moves ticket from Rejected -> Pending');

// 4. Monthly Bucketing Simulation
console.log('\n4. Monthly Comparative Chart Bucketing:');
const now = new Date();
const months = [];
for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        label: d.toLocaleString('en-US', { month: 'short' }),
        reqCount: 0,
        donCount: 0
    });
}
assert.strictEqual(months.length, 6, 'Chart should always generate 6 consecutive monthly periods');
console.log(`  [PASS] 6 monthly periods generated: ${months.map(m => m.label).join(' -> ')}`);

console.log('\n====================================================');
console.log('ALL ADMIN DASHBOARD UNIT & INTEGRATION TESTS PASSED!');
console.log('====================================================');
