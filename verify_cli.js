
// Basic quick test to see if the CLI can run without crashing on syntax errors
const { spawnSync } = require('child_process');
const path = require('path');

const cli = path.join(__dirname, 'bin', 'review-gitlab-branches.js');

console.log('Running dry-run test of CLI...');
const res = spawnSync('node', [cli, '--help'], { encoding: 'utf-8' });

if (res.stderr && res.stderr.includes('Missing required argument')) {
    console.log('✅ CLI argument validation works (failed as expected with missing --repo)');
} else {
    console.log('❓ Unexpected output:', res.stdout, res.stderr);
}

// Check imports
try {
    require('./lib/utils');
    require('./lib/git');
    require('./lib/gitlab');
    console.log('✅ Lib modules require successful.');
} catch (e) {
    console.error('❌ Failed to require modules:', e);
}
