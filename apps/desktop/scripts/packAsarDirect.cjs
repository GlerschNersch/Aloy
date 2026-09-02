const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const asar = require('@electron/asar');

const rootDir = path.resolve(__dirname, '..');
const stagingDir = path.join(rootDir, '.staging');
const targetAsar = path.join(rootDir, 'app.asar');
const installedAsar = path.join(process.env.LOCALAPPDATA, 'Programs', 'Aloy', 'resources', 'app.asar');
const installedAppDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Aloy', 'resources', 'app');

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

async function main() {
  const t0 = Date.now();
  console.log('[packAsarDirect] Cleaning old staging directory...');
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  console.log('[packAsarDirect] Staging dist, server, services, root files...');
  copyDir(path.join(rootDir, 'dist'), path.join(stagingDir, 'dist'));
  copyDir(path.join(rootDir, 'server'), path.join(stagingDir, 'server'));
  copyDir(path.join(rootDir, 'src', 'services'), path.join(stagingDir, 'src', 'services'));
  fs.copyFileSync(path.join(rootDir, 'electron.cjs'), path.join(stagingDir, 'electron.cjs'));
  fs.copyFileSync(path.join(rootDir, 'preload.cjs'), path.join(stagingDir, 'preload.cjs'));
  fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(stagingDir, 'package.json'));
  if (fs.existsSync(path.join(rootDir, 'mcp-servers.json'))) {
    fs.copyFileSync(path.join(rootDir, 'mcp-servers.json'), path.join(stagingDir, 'mcp-servers.json'));
  }

  console.log('[packAsarDirect] Copying production node_modules from installed app...');
  const prodNodeModules = path.join(installedAppDir, 'node_modules');
  if (fs.existsSync(prodNodeModules)) {
    copyDir(prodNodeModules, path.join(stagingDir, 'node_modules'));
  } else {
    copyDir(path.join(rootDir, 'node_modules'), path.join(stagingDir, 'node_modules'));
  }

  console.log('[packAsarDirect] Packing app.asar with @electron/asar...');
  await asar.createPackage(stagingDir, targetAsar);

  if (fs.existsSync(path.dirname(installedAsar))) {
    console.log(`[packAsarDirect] Overwriting installed app.asar at: ${installedAsar}`);
    fs.copyFileSync(targetAsar, installedAsar);
  }

  // Also update installed app folder as backup
  if (fs.existsSync(installedAppDir)) {
    console.log(`[packAsarDirect] Syncing installed app directory...`);
    copyDir(path.join(rootDir, 'dist'), path.join(installedAppDir, 'dist'));
    copyDir(path.join(rootDir, 'server'), path.join(installedAppDir, 'server'));
    copyDir(path.join(rootDir, 'src', 'services'), path.join(installedAppDir, 'src', 'services'));
    fs.copyFileSync(path.join(rootDir, 'electron.cjs'), path.join(installedAppDir, 'electron.cjs'));
    fs.copyFileSync(path.join(rootDir, 'preload.cjs'), path.join(installedAppDir, 'preload.cjs'));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[packAsarDirect] Done in ${elapsed}s!`);
}

main().catch(err => {
  console.error('[packAsarDirect] Error:', err);
  process.exit(1);
});
