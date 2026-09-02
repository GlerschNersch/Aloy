#!/usr/bin/env node
// Aloy boot smoke test — verifies the ASSEMBLED system, not individual units.
//
// Every check here exists because a real bug shipped that unit tests could not
// catch. Unit tests mock their dependencies, so they pass happily while the
// wiring between modules is broken. These are the four failures from the
// 2026-08-17..19 window and the check that would have caught each:
//
//   missing `const os = require('os')`  -> server crashed on boot  -> CHECK 1/5
//   runEvaluation -> runRobustEvaluation rename, caller not updated -> CHECK 3
//   sidecarWatchdog.cjs written but never imported (dead code)      -> CHECK 2
//   raw fetch()/https.get with no timeout (wedged Athena 2 days)    -> CHECK 4
//
// Run: npm run smoke      (exit 0 = pass, 1 = fail)
//
// Runs against a THROWAWAY HOME so requiring modules can't mutate the real
// ~/.aloy-server — several engines construct singletons at module scope that
// write to disk (AthenaEngine's constructor now sweeps stale tasks, for one).

const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVER_DIR = path.join(__dirname, '..', 'server');
const SRC_SERVICES_DIR = path.join(__dirname, '..', 'src', 'services');

// Isolate side effects BEFORE anything is required.
const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aloy-smoke-'));
process.env.HOME = SANDBOX_HOME;
process.env.USERPROFILE = SANDBOX_HOME;

const failures = [];
const warnings = [];
let checksRun = 0;

function fail(check, detail) { failures.push(`[${check}] ${detail}`); }
function warn(check, detail) { warnings.push(`[${check}] ${detail}`); }
function section(n, title) { checksRun++; console.log(`\n── CHECK ${n}: ${title}`); }

const serverFiles = fs.readdirSync(SERVER_DIR)
  .filter(f => f.endsWith('.cjs'))
  .map(f => path.join(SERVER_DIR, f));

const readSafe = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// Blank out comments and string/template literals, preserving offsets so
// reported line numbers stay accurate. Without this, scanning for code
// patterns matches prose in comments and text inside string literals — e.g.
// hephReviewer's `code.includes('child_process.exec(')` guard, or this file's
// own header describing the patterns it looks for.
function stripNonCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && c2 === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c; out += ' '; i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += ' '; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
section(1, 'Every server module loads without throwing');
// Catches: missing requires, bad syntax, module-scope crashes. `node --check`
// only parses — it does NOT catch a missing `const os = require('os')`.
const loaded = new Map();
for (const file of serverFiles) {
  const name = path.basename(file);
  try {
    loaded.set(name, require(file));
    process.stdout.write('.');
  } catch (err) {
    // Distinguish "npm install hasn't run" (environmental) from "this module
    // imports something that doesn't exist" (a real, shipped bug). Only the
    // latter should fail the build.
    const missing = /Cannot find module '([^']+)'/.exec(err.message)?.[1];
    const isLocal = missing && (missing.startsWith('.') || missing.startsWith('/'));
    if (missing && !isLocal) {
      warn('deps', `${name} needs "${missing}" — run npm install (not a code defect)`);
      process.stdout.write('~');
    } else {
      fail('load', `${name} threw on require: ${err.message.split('\n')[0]}`);
      process.stdout.write('x');
    }
  }
}
console.log(` ${loaded.size}/${serverFiles.length} loaded`);

// ───────────────────────────────────────────────────────────────────────────
section(2, 'No orphaned modules (everything is reachable)');
// Catches: sidecarWatchdog.cjs — written, tested by eye, never imported, never ran.
const ENTRYPOINTS = new Set(['aloyServer.cjs']);
const allSource = [...serverFiles, ...(fs.existsSync(SRC_SERVICES_DIR)
  ? fs.readdirSync(SRC_SERVICES_DIR).filter(f => f.endsWith('.js')).map(f => path.join(SRC_SERVICES_DIR, f))
  : [])];
const electronFile = path.join(__dirname, '..', 'electron.cjs');
if (fs.existsSync(electronFile)) allSource.push(electronFile);

const corpus = allSource
  .filter(f => !f.endsWith('.test.js') && !f.endsWith('.test.cjs'))
  .map(f => ({ file: f, src: readSafe(f) }));

for (const file of serverFiles) {
  const base = path.basename(file);
  if (ENTRYPOINTS.has(base)) continue;
  if (base.endsWith('.test.cjs')) continue;
  const stem = base.replace(/\.cjs$/, '');
  const referenced = corpus.some(({ file: f, src }) =>
    f !== file && (src.includes(`/${stem}.cjs`) || src.includes(`'./${stem}'`) || src.includes(`"./${stem}"`))
  );
  const testExists = fs.existsSync(path.join(SERVER_DIR, `${stem}.test.js`));
  if (!referenced) {
    if (testExists) warn('orphan', `${base} is only referenced by its test — is it wired into the app?`);
    else fail('orphan', `${base} is never required by any module (dead code — it will never run)`);
    continue;
  }

  // Imported is not the same as USED. A bare `const { x } = require('./mod')`
  // silences the reachability check above while the module still does nothing
  // — which is exactly what happened when modelRouter, http and sidecarWatchdog
  // were "wired" by adding import lines and never calling anything. For each
  // importer, check that at least one imported binding is referenced somewhere
  // other than the import statement itself.
  const importers = corpus.filter(({ file: f, src }) =>
    f !== file && (src.includes(`/${stem}.cjs`) || src.includes(`'./${stem}'`) || src.includes(`"./${stem}"`))
  );
  let usedSomewhere = false;
  for (const { src } of importers) {
    const destructure = new RegExp(`(?:const|let|var)\\s*\\{([^}]+)\\}\\s*=\\s*require\\(['"][^'"]*${stem}(?:\\.cjs)?['"]\\)`).exec(src);
    const nsImport = new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*require\\(['"][^'"]*${stem}(?:\\.cjs)?['"]\\)`).exec(src);
    const names = destructure
      ? destructure[1].split(',').map(x => x.split(':').pop().trim()).filter(Boolean)
      : (nsImport ? [nsImport[1]] : []);
    if (names.length === 0) { usedSomewhere = true; break; } // bare require() for side effects
    for (const n of names) {
      // Count references outside the require line itself.
      const total = (src.match(new RegExp(`\\b${n}\\b`, 'g')) || []).length;
      if (total > 1) { usedSomewhere = true; break; }
    }
    if (usedSomewhere) break;
  }
  if (!usedSomewhere) {
    fail('imported-unused', `${base} is imported but nothing it exports is ever called — the import alone does not wire it in`);
  }
}
console.log(`   scanned ${serverFiles.length} modules`);

// ───────────────────────────────────────────────────────────────────────────
section(3, 'Cross-module calls resolve to methods that exist');
// Catches: aloyServer calling globalEvalHarness.runEvaluation() after the
// method was renamed to runRobustEvaluation — a TypeError on every request,
// invisible until someone hits the route.
let callsChecked = 0;
for (const { file, src } of corpus) {
  if (!file.endsWith('.cjs')) continue;
  // const { a, b } = require('./mod.cjs')
  const destructured = [...src.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\(['"]\.\/([\w./-]+?)(?:\.cjs)?['"]\)/g)];
  for (const m of destructured) {
    const names = m[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean);
    const modPath = path.join(path.dirname(file), `${m[2]}.cjs`);
    const mod = loaded.get(path.basename(modPath));
    if (!mod) continue;
    for (const n of names) {
      if (!(n in mod)) {
        fail('exports', `${path.basename(file)} destructures "${n}" from ${path.basename(modPath)}, which does not export it`);
      } else {
        // For each imported binding, verify the methods called on it exist.
        const val = mod[n];
        if (val && typeof val === 'object') {
          const methodCalls = new Set([...src.matchAll(new RegExp(`\\b${n}\\.(\\w+)\\s*\\(`, 'g'))].map(x => x[1]));
          for (const meth of methodCalls) {
            callsChecked++;
            if (typeof val[meth] !== 'function') {
              fail('api-drift', `${path.basename(file)} calls ${n}.${meth}() but ${path.basename(modPath)} exposes no such method`);
            }
          }
        }
      }
    }
  }
}
console.log(`   verified ${callsChecked} cross-module method calls`);

// ───────────────────────────────────────────────────────────────────────────
section(4, 'No unbounded network calls');
// Catches: the Athena hang class. Every network call must go through
// server/http.cjs (mandatory timeout) or carry its own signal/timeout.
const NET_EXEMPT = new Set(['http.cjs']);
let unguarded = 0;
for (const { file, src } of corpus) {
  const base = path.basename(file);
  if (NET_EXEMPT.has(base)) continue;
  const netCode = stripNonCode(src);
  for (const m of netCode.matchAll(/(?<![.\w$])(?:await\s+)?fetch\s*\(|(?<![.\w$])https?\.(?:get|request)\s*\(/g)) {
    // https.get/request attach their 'timeout' handler AFTER the response
    // callback body, which can be dozens of lines below the call — a 600ch
    // window reported athena.cjs's correctly-guarded search as unbounded.
    // fetch() carries its signal inline, so it keeps the tight window.
    const isNodeHttp = /https?\.(?:get|request)/.test(netCode.slice(m.index, m.index + 20));
    const window = src.slice(m.index, m.index + (isNodeHttp ? 2500 : 600));
    const guarded = /AbortSignal|signal:\s*|on\('timeout'|timeoutMs|withDeadline/.test(window);
    if (!guarded) {
      unguarded++;
      const line = src.slice(0, m.index).split('\n').length;
      warn('unbounded-net', `${base}:${line} network call with no timeout/abort — can hang forever`);
    }
  }
}
console.log(`   ${unguarded === 0 ? 'all network calls bounded' : unguarded + ' unbounded call(s) found'}`);

// ───────────────────────────────────────────────────────────────────────────
section(5, 'Node builtins are required before use');
// Catches: aloyServer.cjs calling os.homedir() with no `const os = require('os')`.
// The module still LOADS (the call sits inside a function), so CHECK 1 passes —
// it only dies when startAloyServer actually runs, i.e. on every boot. Static
// analysis catches it without needing to boot.
const BUILTINS = ['os', 'fs', 'path', 'http', 'https', 'crypto', 'child_process', 'zlib', 'net', 'url', 'util'];
let builtinUses = 0;
for (const { file, src } of corpus) {
  if (!file.endsWith('.cjs')) continue;
  const base = path.basename(file);
  const code = stripNonCode(src);
  for (const b of BUILTINS) {
    // Used as a namespace: `os.homedir(`, `path.join(`. The negative lookbehind
    // excludes member chains like `req.url.startsWith(` — that's a property,
    // not the `url` module.
    const used = new RegExp(`(?<![.\\w$])${b}\\.\\w+\\s*\\(`).test(code);
    if (!used) continue;
    builtinUses++;
    const required = new RegExp(`(?:const|let|var)\\s+(?:\\{[^}]*\\}|${b})\\s*=\\s*require\\(`).test(src) && new RegExp(`require\\(['\"](?:node:)?${b}['\"]\\)`).test(src);
    // A local declaration of the same name also satisfies it (e.g. `const os = require('os')` inside a function).
    // Declarations are searched in the RAW source, not the stripped copy.
    // stripNonCode is a naive scanner: a regex literal containing a quote
    // (e.g. /href="([^"]+)"/) opens a phantom string and blanks real code
    // after it — which made jobRadar.cjs's `let url = ''` invisible and
    // produced a false positive. Searching raw source can only cause a false
    // NEGATIVE (a declaration mentioned in a comment), which is far safer for
    // a build gate than crying wolf on correct code.
    const localDecl = new RegExp(`(?:const|let|var|function)\\s+${b}\\b`).test(src)
      || new RegExp(`[(,]\\s*${b}\\s*[,)=]`).test(src);
    if (!required && !localDecl) {
      fail('missing-require', `${base} uses ${b}.* but never requires '${b}' — will throw ReferenceError at runtime`);
    }
  }
}
console.log(`   checked ${builtinUses} builtin namespace usages`);

// ───────────────────────────────────────────────────────────────────────────
section(6, 'Server assembles and serves /api/health');
// Catches boot-time crashes that only happen when startAloyServer actually
// runs (e.g. os.homedir() with `os` never required — the module loads fine,
// then dies on call).
(async () => {
  let server = null;
  try {
    const { startAloyServer } = require(path.join(SERVER_DIR, 'aloyServer.cjs'));
    if (typeof startAloyServer !== 'function') {
      fail('boot', 'aloyServer.cjs does not export startAloyServer');
    } else if (process.env.ALOY_SMOKE_BOOT === '1') {
      // Opt-in: a real boot spawns MCP subprocesses and polls Home Assistant,
      // so it is slow and needs network. Off by default; on in CI.
      const port = 7899;
      await Promise.race([
        startAloyServer(port),
        new Promise((_, rej) => setTimeout(() => rej(new Error('startAloyServer did not return within 30s')), 30000))
      ]);
      const { getOrCreateToken } = require(path.join(SERVER_DIR, 'auth.cjs'));
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { Authorization: `Bearer ${getOrCreateToken()}` },
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) fail('boot', `/api/health returned ${res.status}`);
      else console.log('   server booted and /api/health responded 200');
    } else {
      console.log('   skipped full boot (set ALOY_SMOKE_BOOT=1 to enable)');
    }
  } catch (err) {
    fail('boot', `server failed to start: ${err.message}`);
  } finally {
    if (server?.close) try { server.close(); } catch {}
  }

  // ─────────────────────────────────────────────────────────────────────────
  section(7, 'Behavioural invariants still present');
  // CHECKS 1-6 catch code that is BROKEN. This one catches code that is GONE.
  //
  // Every entry below is a guard whose absence breaks nothing visible: the app
  // still boots, every other check still passes, and the failure it prevents
  // only appears under conditions that have not happened yet. That makes them
  // read as dead weight to anyone refactoring the file, and several have been
  // silently deleted and re-added more than once. A comment saying "important"
  // has now demonstrably failed to protect them twice; a red build is the only
  // thing that has worked.
  //
  // Each entry carries a `why` that is printed on failure. Write it as an
  // instruction to whoever hits it, not a label — because a failing gate tells
  // you THAT something is wrong, not what the correct fix is, and "make the
  // check pass" is always the easier path. That is precisely how the
  // callHaService bypass came back: this suite flagged an orphaned caller, and
  // the caller got "fixed" by restoring the unguarded method it called.
  //
  // Add a row here whenever you fix something whose value is preventative.
  const REQUIRED = [
    // ── added 2026-08-29, after a pass that found a reproduced RCE, a
    // committed credential, and ~20 places rendering invented data ─────────
    { file: 'server/hermesScriptPipeline.cjs', pattern: /is disabled: vm\.createContext is not a sandbox/,
      why: 'The vm "sandbox" is a verified RCE: host intrinsics in the context hand back the host Function constructor, and the timeout bounds only synchronous code. This guard disables the surface. Do not re-enable without an out-of-process runner or a real isolate — filtering script text does not work.' },
    { file: 'server/aloyServer.cjs', pattern: /const pendingToolCalls = new Map\(\)/,
      why: 'Server-side pending-call store. Without it /api/chat/resolve executes whatever name+args the CLIENT sends, so every requiresConfirmation in the codebase becomes advisory and a token holder can run any tool unprompted.' },
    { file: 'server/aloyServer.cjs', pattern: /rememberPendingCalls\(pending\)/,
      why: 'Records what was actually pended. Without this call the store stays empty and every resolve is refused.' },
    { file: 'server/aloyServer.cjs', pattern: /const filePath = resolveStreamPath\(req\.query\.file\)/,
      why: '/api/media/stream is the ONLY route registered above requireAuth — Roku and smart-TV players fetch it themselves and cannot send a bearer token. Without this containment check req.query.file goes straight to createReadStream, which is an arbitrary read of the whole machine over Tailscale: ?file=~/.aloy-server/auth-token.txt returns the token guarding the other 149 routes, and ?file=~/.aloy-server/.env returns every API key. Keep BOTH gates (real path inside a media root, extension in STREAMABLE_TYPES); either one alone is bypassable.' },
    { file: 'server/browserAgent.cjs', pattern: /function isPrivateHostname/,
      why: 'Real private-range SSRF check. It replaced a five-literal blocklist that missed ::1, decimal/octal IP forms, all of 10/8 and 172.16/12, 169.254.169.254 and every *.local name.' },
    { file: 'server/browserAgent.cjs', pattern: /extractInteractiveElements\(safeMarkdown\)/,
      why: 'Interactive elements must be extracted from the SANITISED markdown. The sanitiser was applied to the page body but the element extractor was still handed scrapeResult.markdown, so attacker-authored link labels and button text reached the model with no sanitisation at all — the one part of a scraped page most likely to carry an injection, on the exact path that then acts on it.' },
    { file: 'server/scraplingEngine.cjs', pattern: /redirectCount > 5/,
      why: 'Redirect cap. redirectCount was incremented and never read, so a self-redirecting server recursed until the stack blew, and only the first hop was ever SSRF-checked.' },
    { file: 'server/adkOrchestrator.cjs', pattern: /const globalHandoffManager = new AgentHandoffManager\(\)/,
      why: 'One handoff manager for the process. aloyServer constructed a fresh AgentHandoffManager per request, so the agent stack was empty on arrival every time: transfers appeared to work, returns had nothing to return to, and the active agent silently reset to aloy_primary between turns. If you need isolation, scope by conversation inside this instance — do not go back to constructing one per call.' },
    { file: 'server/bazziteBridge.cjs', pattern: /sudoPassEnv/,
      why: 'Server-side sudo password lookup. The password was previously inlined in BazziteRemoteCard.jsx, so it shipped in the renderer bundle and was echoed into the on-screen command log.' },
    { file: 'src/services/homeassistant.js', pattern: /apiFetch\(`\/api\/ha-proxy/,
      why: 'The renderer must reach Home Assistant through the server proxy. Reading a VITE_-prefixed token instead inlines the HA admin credential into dist/ at build time.' },
    { file: 'server/zeppSyncEngine.cjs', pattern: /skippedEntities/,
      why: 'Null-state publishes are skipped. Invented fallbacks here (battery 85, HR 68, sleep 88) carry state_class, so Home Assistant writes them into long-term statistics and real vitals become indistinguishable from synthetic ones.' },
    { file: 'server/healthBridge.cjs', pattern: /readinessScore: null/,
      why: 'Readiness must be null with no measurements. It previously started at a literal 85/Optimal and was fed to the model under a [LIVE TELEMETRY] header, so Aloy asserted the user was recovered when no watch had ever synced.' },
    { file: 'server/aloyServer.cjs', pattern: /call\.wasWrite\s*=\s*true/,
      why: 'Producer for the skill-mining write guard. Its consumer (calls.some(c => c.wasWrite)) stays behind, so deleting this silently mines write sequences into auto-runnable skills. Restore the assignment; do not delete the consumer.' },
    { file: 'server/aloyServer.cjs', pattern: /calls\.some\(\s*\(?c\)?\s*=>\s*c\.wasWrite\s*\)/,
      why: 'Consumer for the skill-mining write guard. Without it every chain reads as read-only and write sequences become skills.' },
    { file: 'server/athena.cjs', pattern: /req\.on\('timeout'/,
      why: "Node's https.get `timeout:` option does NOT abort the request on its own — it only emits this event. Removing the handler is what wedged Athena for two days with 7 tasks stuck at 25%. Keep one handler per https request." },
    { file: 'server/conclave.cjs', pattern: /_dispatchHephTaskOnce/,
      why: 'Dedup guard on Hephaestus dispatch. Without it the weekly council queues the same task multiple times per run.' },
    { file: 'server/jobRadar.cjs', pattern: /parserSuspect/,
      why: 'Parser-health signal. Without it a scraper broken by a site redesign reports zero results as a successful scan, indefinitely.' },
    { file: 'server/minerva.cjs', pattern: /verifyCloudModels/,
      why: 'Cloud model-ID validation in the health scan. A valid API key with a retired or misspelled model 404s inside a catch block and the feature dies silently — checking the key alone does not catch it.' },
    { file: 'server/minerva.cjs', pattern: /DELIBERATELY ABSENT/,
      why: 'The note explaining why callHaService must not exist. It has been deleted and the unguarded HA bypass re-added twice. If Minerva needs to act on a device, route it through securityGuard.validateSmartHomeAction then executeHAService.' },
    { file: 'server/models.cjs', pattern: /GEMINI_VERIFIER/,
      why: 'Keeps the knowledge-store verifier model separate from the general Gemini fallback. Collapsing them means upgrading the fallback silently changes what decides which knowledge is true enough to save.' },
    { file: 'server/hephaestus.cjs', pattern: /pruneTaskHistory/,
      why: 'Bounds the task ledger. Without it the file grows without limit (it reached 3.48MB before this was added) and every read of it gets slower.' },
    { file: 'src/services/tools.js', pattern: /export function isWriteTool/,
      why: 'Single definition of "this tool mutates something", used by both the confirmation gate and the skill-mining guard. Inlining it anywhere lets the two drift apart.' }
  ];

  // Patterns that must NOT come back.
  const FORBIDDEN = [
    { file: 'src/components/dashboard/BazziteRemoteCard.jsx', pattern: /sudo -S/,
      why: 'A sudo password inlined in the renderer ships in the bundle and is rendered on screen by the command echo. Pass { elevated: true } and let the server attach it from BAZZITE_SUDO_PASS / LENNY_SUDO_PASS.' },
    { file: 'electron.cjs', pattern: /webSecurity:\s*false/,
      why: 'Same-origin policy off in a renderer that displays model output and scraped web content. Home Assistant is reachable via /api/ha-proxy, so this is no longer needed.' },
    { file: 'server/aloyServer.cjs', pattern: /Public snapshot route/,
      why: 'A camera-snapshot route above requireAuth serves security footage of the house to anything that can reach the port. Use components/common/AuthedImage.jsx, which fetches through apiFetch and renders a blob.' },
    { file: 'server/minerva.cjs', pattern: /^\s*async\s+callHaService\s*\(/m,
      why: 'Executes an arbitrary Home Assistant domain.service with no securityGuard validation and no 2FA — lock.unlock on an exterior door went through unchecked. Removed twice. Use /api/smarthome/execute.' },
    { file: 'server/aloyServer.cjs', pattern: /setHeader\(\s*'Access-Control-Allow-Origin'\s*,\s*'\*'/,
      why: 'Wildcard CORS on this server. It was added to /api/media/stream to make Roku work, but native players (Roku, VLC, MPV, smart TVs) do not implement CORS and gain nothing from it. What it grants is permission for any web page the user visits to call these routes from his browser AND read the responses — on the one route that is deliberately unauthenticated. If a browser client genuinely needs cross-origin access, name the origin; never use *.' },
    { file: 'server/aloyServer.cjs', pattern: /new\s+AgentHandoffManager\s*\(/,
      why: 'Per-call construction of the handoff manager. Import globalHandoffManager from server/adkOrchestrator.cjs instead; constructing one here resets the agent stack on every request and makes transfer/return a no-op that still reports success.' },
    { file: 'server/browserAgent.cjs', pattern: /extractInteractiveElements\(scrapeResult\.markdown\)/,
      why: 'Raw, unsanitised scraped markdown going into element extraction. Use safeMarkdown — link labels and button text are attacker-authored and land in the model prompt.' },
    { file: 'preload.cjs', pattern: /^\s*minervaHaCall\s*:/m,
      why: 'IPC bridge to the deleted minerva:haCall handler. Leaving it exposed makes the missing handler look like a bug to fix by restoring the bypass.' }
  ];

  let invariantsChecked = 0;
  for (const { file, pattern, why } of REQUIRED) {
    const full = path.join(__dirname, '..', file);
    if (!fs.existsSync(full)) { fail('invariant', `${file} is missing entirely — expected ${pattern}`); continue; }
    invariantsChecked++;
    if (!pattern.test(readSafe(full))) fail('invariant', `${file}: ${pattern} is GONE.\n      -> ${why}`);
  }
  for (const { file, pattern, why } of FORBIDDEN) {
    const full = path.join(__dirname, '..', file);
    if (!fs.existsSync(full)) continue;
    invariantsChecked++;
    if (pattern.test(readSafe(full))) fail('invariant', `${file}: ${pattern} is BACK.\n      -> ${why}`);
  }
  console.log(`   checked ${invariantsChecked} invariants (${REQUIRED.length} required, ${FORBIDDEN.length} forbidden)`);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(64));
  if (warnings.length) {
    console.log(`\n${warnings.length} WARNING(S):`);
    warnings.forEach(w => console.log('  ! ' + w));
  }
  if (failures.length) {
    console.log(`\n${failures.length} FAILURE(S):`);
    failures.forEach(f => console.log('  x ' + f));
    console.log(`\nSMOKE FAILED (${checksRun} checks run)`);
    process.exitCode = 1;
  } else {
    console.log(`\nSMOKE PASSED (${checksRun} checks, ${warnings.length} warning(s))`);
    process.exitCode = 0;
  }
  try { fs.rmSync(SANDBOX_HOME, { recursive: true, force: true }); } catch {}
})();
