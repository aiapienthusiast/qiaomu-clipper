const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function readDelivery(root) {
	const scope = JSON.parse(fs.readFileSync(path.join(root, 'test-delivery.json'), 'utf8'));
	if (scope.schema !== 1 || !Array.isArray(scope.features)) throw new Error('Invalid test delivery scope');
	const ids = new Set();
	for (const feature of scope.features) {
		if (!/^[a-z][a-z0-9-]+$/.test(feature.id) || ids.has(feature.id) || typeof feature.title !== 'string' || !feature.title.trim()
			|| !Array.isArray(feature.files) || !feature.files.length || !Array.isArray(feature.tests) || !feature.tests.length) throw new Error('Invalid or duplicate delivery feature');
		ids.add(feature.id);
		for (const file of [...feature.files, ...feature.tests]) {
			if (typeof file !== 'string' || !/^src\/[a-zA-Z0-9_./-]+$/.test(file) || file.split('/').includes('..')
				|| !fs.existsSync(path.join(root, file)) || !fs.statSync(path.join(root, file)).isFile()) throw new Error(`Missing delivery source: ${file}`);
		}
		if (feature.tests.some(file => !file.endsWith('.test.ts'))) throw new Error('Delivery checks must name regression test files');
	}
	return scope;
}

function assertCoverage(scope, previous) {
	const ids = new Set(scope.features.map(feature => feature.id));
	const missing = (previous?.features || []).filter(feature => !ids.has(feature.id));
	if (missing.length) throw new Error(`Refusing to remove tested features: ${missing.map(feature => feature.title).join(', ')}`);
}

function runDeliveryTests(root, scope) {
	if (scope.features.some(feature => feature.id === 'store-media-download')) execFileSync(process.execPath, [path.join(root, 'scripts/test-store-download.mjs')], { cwd: root, stdio: 'inherit' });
	const tests = [...new Set(scope.features.flatMap(feature => feature.tests))];
	if (tests.length) execFileSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...tests], { cwd: root, stdio: 'inherit' });
	return { ...scope, checkedAt: new Date().toISOString() };
}

module.exports = { readDelivery, assertCoverage, runDeliveryTests };
