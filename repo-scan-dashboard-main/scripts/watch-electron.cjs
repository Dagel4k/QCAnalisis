const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '../dist-electron');

function renameFiles() {
  const mainJs = path.join(distDir, 'main.js');
  const mainCjs = path.join(distDir, 'main.cjs');
  const preloadJs = path.join(distDir, 'preload.js');
  const preloadCjs = path.join(distDir, 'preload.cjs');

  if (fs.existsSync(mainJs)) {
    if (fs.existsSync(mainCjs)) fs.unlinkSync(mainCjs);
    fs.renameSync(mainJs, mainCjs);
  }
  if (fs.existsSync(preloadJs)) {
    if (fs.existsSync(preloadCjs)) fs.unlinkSync(preloadCjs);
    fs.renameSync(preloadJs, preloadCjs);
  }
}

const tsc = spawn('tsc', ['-p', 'tsconfig.electron.json', '--watch'], {
  stdio: 'inherit',
  shell: true,
});

fs.watch(distDir, { recursive: false }, (eventType, filename) => {
  if (filename && (filename.endsWith('.js') || filename.endsWith('.cjs'))) {
    setTimeout(renameFiles, 100);
  }
});

renameFiles();

tsc.on('close', (code) => {
  process.exit(code);
});
