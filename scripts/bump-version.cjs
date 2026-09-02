/**
 * Aloy Ecosystem Version Bump Script
 * Usage:
 *   node scripts/bump-version.cjs patch
 *   node scripts/bump-version.cjs minor
 *   node scripts/bump-version.cjs major
 *   node scripts/bump-version.cjs 2.1.0
 */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const VERSION_FILE = path.join(ROOT_DIR, 'version.json');
const ROOT_PKG = path.join(ROOT_DIR, 'package.json');
const DESKTOP_PKG = path.join(ROOT_DIR, 'apps', 'desktop', 'package.json');
const MOBILE_PKG = path.join(ROOT_DIR, 'apps', 'mobile', 'package.json');
const ANDROID_GRADLE = path.join(ROOT_DIR, 'apps', 'mobile', 'android', 'app', 'build.gradle');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function parseSemver(v) {
  const clean = v.replace(/^v/, '');
  const parts = clean.split('.').map(n => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver version: ${v}`);
  }
  return parts; // [major, minor, patch]
}

function computeNextVersion(current, bumpType) {
  const [major, minor, patch] = parseSemver(current);
  switch (bumpType.toLowerCase()) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      // Treat as explicit version
      parseSemver(bumpType);
      return bumpType.replace(/^v/, '');
  }
}

function main() {
  const arg = process.argv[2] || 'patch';

  const versionData = fs.existsSync(VERSION_FILE)
    ? loadJson(VERSION_FILE)
    : { version: '2.0.0', versionCode: 200, codename: 'Focus' };

  const oldVersion = versionData.version || '2.0.0';
  const newVersion = computeNextVersion(oldVersion, arg);
  const newVersionCode = (versionData.versionCode || 200) + 1;

  console.log(`\n📦 Aloy Version Bump: v${oldVersion} -> v${newVersion} (Code: ${newVersionCode})\n`);

  // 1. Update version.json
  versionData.version = newVersion;
  versionData.versionCode = newVersionCode;
  versionData.updatedAt = new Date().toISOString();
  saveJson(VERSION_FILE, versionData);
  console.log(`  ✓ Updated version.json`);

  // 2. Update Root package.json
  if (fs.existsSync(ROOT_PKG)) {
    const rootPkg = loadJson(ROOT_PKG);
    rootPkg.version = newVersion;
    saveJson(ROOT_PKG, rootPkg);
    console.log(`  ✓ Updated root package.json`);
  }

  // 3. Update Desktop package.json
  if (fs.existsSync(DESKTOP_PKG)) {
    const desktopPkg = loadJson(DESKTOP_PKG);
    desktopPkg.version = newVersion;
    saveJson(DESKTOP_PKG, desktopPkg);
    console.log(`  ✓ Updated apps/desktop/package.json`);
  }

  // 4. Update Mobile package.json
  if (fs.existsSync(MOBILE_PKG)) {
    const mobilePkg = loadJson(MOBILE_PKG);
    mobilePkg.version = newVersion;
    saveJson(MOBILE_PKG, mobilePkg);
    console.log(`  ✓ Updated apps/mobile/package.json`);
  }

  // 5. Update Android build.gradle
  if (fs.existsSync(ANDROID_GRADLE)) {
    let gradleContent = fs.readFileSync(ANDROID_GRADLE, 'utf8');
    gradleContent = gradleContent.replace(/versionCode\s+\d+/, `versionCode ${newVersionCode}`);
    gradleContent = gradleContent.replace(/versionName\s+"[^"]+"/, `versionName "${newVersion}"`);
    fs.writeFileSync(ANDROID_GRADLE, gradleContent, 'utf8');
    console.log(`  ✓ Updated apps/mobile/android/app/build.gradle (versionCode: ${newVersionCode}, versionName: "${newVersion}")`);
  }

  console.log(`\n✨ Successfully bumped Aloy ecosystem to v${newVersion}!`);
  console.log(`\nNext step tag (if using git):\n  git add -A && git commit -m "chore: bump version to v${newVersion}" && git tag -a v${newVersion} -m "Release v${newVersion}"\n`);
}

main();
