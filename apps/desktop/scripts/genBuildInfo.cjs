#!/usr/bin/env node
// Stamps the current git identity + build time into server/buildInfo.json so a
// packaged/dev build can report exactly what code it's running, independent of
// the semver in package.json (which doesn't change build-to-build).
//
// Runs automatically before `dev`, `electron:dev`, `electron:build`, and
// `pack:asar` via npm's pre<script> hooks (see package.json).

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..'); // apps/desktop/scripts -> repo root
const OUT_PATH = path.join(__dirname, '..', 'server', 'buildInfo.json');

function git(args, fallback = null) {
  try {
    return execSync(`git ${args}`, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return fallback;
  }
}

const pkg = require('../package.json');

const gitSha = git('rev-parse --short HEAD', 'unknown');
const gitBranch = git('rev-parse --abbrev-ref HEAD', 'unknown');
const porcelain = git('status --porcelain', null);
const dirty = Boolean(porcelain);

const buildInfo = {
  version: pkg.version,
  gitSha,
  gitBranch,
  dirty,
  builtAt: new Date().toISOString()
};

fs.writeFileSync(OUT_PATH, JSON.stringify(buildInfo, null, 2) + '\n');
console.log(`[genBuildInfo] wrote ${path.relative(process.cwd(), OUT_PATH)}: ${buildInfo.version} @ ${gitSha}${dirty ? ' (dirty)' : ''}`);
