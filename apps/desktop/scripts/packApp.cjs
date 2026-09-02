const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const rootDir = path.resolve(__dirname, '..');
const stagingDir = path.join(rootDir, '.staging');

const installedAppBases = [
  path.join(process.env.LOCALAPPDATA, 'Programs', 'ollama-pro-app', 'resources'),
  path.join(process.env.LOCALAPPDATA, 'Programs', 'Aloy', 'resources')
];

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    if (
      item.endsWith('.test.js') ||
      item.endsWith('.spec.js') ||
      item.endsWith('.map') ||
      item === '.git'
    ) continue;

    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function pack() {
  const startTime = Date.now();
  console.log('[packApp] Updating staging directory...');

  // 0. Clean staging directory so stale assets are removed
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  // 1. Sync latest assets into .staging
  copyDir(path.join(rootDir, 'dist'), path.join(stagingDir, 'dist'));
  copyDir(path.join(rootDir, 'server'), path.join(stagingDir, 'server'));
  copyDir(path.join(rootDir, 'src', 'services'), path.join(stagingDir, 'src', 'services'));
  fs.copyFileSync(path.join(rootDir, 'electron.cjs'), path.join(stagingDir, 'electron.cjs'));
  fs.copyFileSync(path.join(rootDir, 'preload.cjs'), path.join(stagingDir, 'preload.cjs'));
  fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(stagingDir, 'package.json'));
  if (fs.existsSync(path.join(rootDir, 'mcp-servers.json'))) {
    fs.copyFileSync(path.join(rootDir, 'mcp-servers.json'), path.join(stagingDir, 'mcp-servers.json'));
  }

  // 2. Package .staging into app.asar
  const tempAsar = path.join(rootDir, 'app.asar');
  console.log('[packApp] Creating app.asar archive...');
  await asar.createPackage(stagingDir, tempAsar);

  // 3. Deploy to installed apps
  for (const resDir of installedAppBases) {
    if (fs.existsSync(resDir)) {
      const destAsar = path.join(resDir, 'app.asar');
      console.log(`[packApp] Deploying app.asar to: ${destAsar}`);
      fs.copyFileSync(tempAsar, destAsar);

      // Deploy src/services to app.asar.unpacked for dynamic ESM imports
      copyDir(path.join(rootDir, 'src', 'services'), path.join(resDir, 'app.asar.unpacked', 'src', 'services'));

      // Clean up loose 'app' directory so Electron cleanly loads app.asar
      const looseAppDir = path.join(resDir, 'app');
      if (fs.existsSync(looseAppDir)) {
        try {
          fs.rmSync(looseAppDir, { recursive: true, force: true });
        } catch (e) {
          console.warn(`[packApp] Note cleaning loose app dir: ${e.message}`);
        }
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[packApp] Live sync complete in ${elapsed}s!`);
}

pack().catch(err => {
  console.error('[packApp] Error:', err);
  process.exit(1);
});
