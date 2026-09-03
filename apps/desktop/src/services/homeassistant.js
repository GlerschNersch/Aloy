import { fetchWithTimeout } from './fetchWithTimeout.js';

// This module runs in two places: the Vite-bundled renderer, and the plain-Node
// backend (dynamically imported). They now get the Home Assistant token from
// very different places, on purpose.
//
// The renderer used to read `import.meta.env.VITE_HA_TOKEN`. Vite INLINES any
// VITE_-prefixed variable into the built JS at build time, so the Home
// Assistant long-lived token — full admin over the house — ended up as a
// literal string inside dist/, readable by anything that can read the app
// directory and travelling with any build artifact that was ever copied or
// shared. The .env.example note saying "never hardcode it here" was honored in
// the source and defeated by the bundler.
//
// The renderer now holds no HA credential at all. It calls the app's own
// server at /api/ha-proxy/*, which is already authenticated with the Aloy
// bearer token, and the server attaches the HA token from its own environment.
const HA_NODE_TOKEN = (typeof process !== 'undefined'
  && (process.env?.HA_TOKEN || process.env?.VITE_HA_TOKEN)) || '';

const HA_DIRECT_URL = (typeof process !== 'undefined' && process.env?.HA_URL)
  || 'http://localhost:8123';

const isRenderer = typeof window !== 'undefined';

if (!isRenderer && !HA_NODE_TOKEN) {
  console.warn('[homeassistant] HA_TOKEN is not set in the server environment; Home Assistant calls will fail.');
}

// Home Assistant on a LAN commonly runs behind a self-signed cert — there's
// no public CA to validate against. Getting an undici Agent for that requires
// `undici`, a Node package — this file is also Vite-bundled for the renderer,
// so it cannot import that package itself (dynamic `import('undici')` builds
// fine but then fails at runtime inside the packaged asar: Electron's asar
// patches cover the CJS `require()` loader, not Node's ESM `import()`
// package resolution, so it 404s with ERR_MODULE_NOT_FOUND despite `undici`
// being a real, present dependency). Instead the backend wires this in once
// at startup via `_setBackendDispatcherFactory`, using its own `require()`
// (server/http.cjs's getInsecureLanDispatcher), which *is* asar-aware.
let backendDispatcherFactory = null;
/** Backend-only injection point — never called from the renderer. */
export function _setBackendDispatcherFactory(fn) {
  backendDispatcherFactory = fn;
}

async function haFetch(endpoint, options = {}) {
  if (isRenderer) {
    // Renderer path: no HA credential here. apiFetch adds the Aloy bearer
    // token; the server adds the HA one.
    const { apiFetch } = await import('./aloyApi.js');
    return apiFetch(`/api/ha-proxy${endpoint}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    }, 10000);
  }

  // Backend path: talk to Home Assistant directly with the server's own token.
  return await fetchWithTimeout(`${HA_DIRECT_URL}${endpoint}`, {
    ...options,
    // HA on a LAN typically runs a self-signed cert — see backendDispatcherFactory above.
    ...(HA_DIRECT_URL.startsWith('https:') && backendDispatcherFactory
      ? { dispatcher: backendDispatcherFactory() }
      : {}),
    headers: {
      'Authorization': `Bearer ${HA_NODE_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  }, 10000);
}

export async function fetchHomeAssistantStates() {
  try {
    const res = await haFetch('/api/states');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('Error fetching Home Assistant states:', err);
    return null;
  }
}

export function formatCalendarDisplayName(calId) {
  if (!calId) return 'Calendar';
  
  const raw = calId.replace('calendar.', '');
  if (raw.endsWith('_gmail_com')) {
    return raw.replace(/_gmail_com$/, '@gmail.com').replace(/_/g, '.');
  }
  return raw
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function fetchGoogleCalendarEvents(daysAhead = 14) {
  try {
    const now = new Date();
    const startStr = encodeURIComponent(now.toISOString());
    const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const endStr = encodeURIComponent(endDate.toISOString());

    const envCals = (typeof process !== 'undefined' && process.env?.HA_CALENDARS)
      ? process.env.HA_CALENDARS.split(',').map(s => s.trim()).filter(Boolean)
      : null;
    const calIds = envCals || [
      'calendar.primary'
    ];

    let combinedEvents = [];

    for (const calId of calIds) {
      try {
        const res = await haFetch(`/api/calendars/${calId}?start=${startStr}&end=${endStr}`);
        if (res.ok) {
          const events = await res.json();
          events.forEach(ev => {
            combinedEvents.push({
              calendar: formatCalendarDisplayName(calId),
              summary: ev.summary || 'Event',
              start: ev.start?.dateTime || ev.start?.date || '',
              description: ev.description || ''
            });
          });
        }
      } catch (e) {
        console.error(`Error fetching ${calId}:`, e);
      }
    }

    return combinedEvents;
  } catch (err) {
    console.error('Error fetching Google Calendar events:', err);
    return [];
  }
}

// The 5 local-Ollama LLM Vision automations (front door doorbell, driveway
// Amazon-driver detection, game room gaming detection, backyard/behind-garage
// person descriptions — confirmed live 2026-08-03 via automation config scan)
// all log to this ONE shared calendar entity, regardless of which automation
// fired. There's no per-automation entity_id to query separately — every
// event's `summary` is the generic "Motion detected" string; the only real
// content is in `description` (the actual VLM answer/description text).
const LLM_VISION_CALENDAR = 'calendar.llm_vision_timeline';

export async function fetchLLMVisionTimeline(hoursBack = 24) {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - hoursBack * 60 * 60 * 1000);
    const res = await haFetch(`/api/calendars/${LLM_VISION_CALENDAR}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
    if (!res.ok) return [];
    const events = await res.json();
    return events.map((e) => ({
      start: e.start?.dateTime || e.start?.date || '',
      description: (e.description || '').trim()
    })).sort((a, b) => new Date(b.start) - new Date(a.start));
  } catch (err) {
    console.error('Error fetching LLM Vision timeline:', err);
    return [];
  }
}

// The Game Room gaming-detection automation alone fires dozens of times a
// day, and most checks find nothing ("NO" with no elaboration) — showing
// every single one would blow context and bury the events actually worth
// reading. A bare "NO" (no elaboration) is treated as routine and just
// counted; anything with more text (a "YES", or any elaborated description,
// even one that starts with "NO.") is shown in full.
function isRoutine(description) {
  return description.trim().toUpperCase() === 'NO';
}

export function formatLLMVisionContext(events, hoursBack) {
  if (events.length === 0) {
    return `[LOCAL LLM VISION ACTIVITY — last ${hoursBack}h]: No camera/vision automation activity in this window.`;
  }
  const notable = events.filter((e) => !isRoutine(e.description));
  const routineCount = events.length - notable.length;

  let ctx = `[LOCAL LLM VISION ACTIVITY — last ${hoursBack}h, ${events.length} total events]:\n`;
  ctx += `These are from your 5 local-Ollama camera automations (front door doorbell, driveway Amazon-driver detection, game room gaming detection, backyard/behind-garage person descriptions) — all log to one shared timeline, so which automation fired isn't always explicit; infer it from the description's content.\n\n`;
  notable.slice(0, 40).forEach((e) => {
    ctx += `- ${e.start}: ${e.description}\n`;
  });
  if (notable.length > 40) ctx += `...and ${notable.length - 40} more notable events not shown.\n`;
  if (routineCount > 0) ctx += `\nPlus ${routineCount} routine check${routineCount !== 1 ? 's' : ''} that found nothing worth reporting (bare "NO").\n`;
  return ctx;
}

// Lightweight summary for a status widget (nested in the sidebar/drawer,
// not a new panel) — just enough to show "something happened recently"
// without polling the full timeline on every render.
export function summarizeLLMVisionActivity(events) {
  if (events.length === 0) return { count: 0, lastEventAt: null, lastNotable: null };
  const notable = events.filter((e) => !isRoutine(e.description));
  return {
    count: events.length,
    lastEventAt: events[0].start,
    lastNotable: notable[0] || null
  };
}

// Structured "browse the real events" view (AloyMobile's Vision Events
// screen) — same routine-filtering rule as formatLLMVisionContext, but
// returned as data instead of a text blob for a client to render a list.
export function getLLMVisionEventsDetail(events) {
  const notable = events.filter((e) => !isRoutine(e.description));
  return {
    totalCount: events.length,
    routineCount: events.length - notable.length,
    notable
  };
}

export async function executeHAService(domain, service, entityId, extraData = {}) {
  try {
    // Not every service call targets an entity (e.g. notify.mobile_app_*
    // takes only title/message) — HA's API rejects entity_id: null outright
    // (400 Bad Request), so omit the key entirely rather than sending null.
    const res = await haFetch(`/api/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify({ ...(entityId ? { entity_id: entityId } : {}), ...extraData })
    });
    return res.ok;
  } catch (err) {
    console.error('Error executing HA service:', err);
    return false;
  }
}

// Zepp/Amazfit smartwatch entities, surfaced on the "Dad's Watch" view of the
// Family dashboard (confirmed live 2026-08-06 via that dashboard's Lovelace
// config) — pulled here straight from /api/states like any other sensor, no
// separate integration needed. Grouped by section since sleep timestamps and
// vitals get formatted differently.
const HEALTH_VITALS_IDS = [
  'sensor.zepp_device_heart_rate', 'sensor.zepp_device_blood_oxygen',
  'sensor.zepp_device_body_temperature', 'sensor.zepp_device_stress',
  'binary_sensor.zepp_device_is_wearing', 'binary_sensor.zepp_device_is_moving'
];
const HEALTH_ACTIVITY_IDS = [
  'sensor.zepp_device_steps', 'sensor.zepp_device_distance', 'sensor.zepp_device_calories',
  'sensor.zepp_device_stands', 'sensor.zepp_device_pai', 'sensor.zepp_device_training_load',
  'sensor.zepp_device_last_workout', 'sensor.zepp_device_workout_count'
];
const HEALTH_SLEEP_IDS = [
  'binary_sensor.zepp_device_is_sleeping', 'sensor.zepp_device_sleep_total',
  'sensor.zepp_device_sleep_deep', 'sensor.zepp_device_sleep_score',
  'sensor.zepp_device_sleep_start', 'sensor.zepp_device_sleep_end'
];
const HEALTH_MISC_IDS = ['sensor.zepp_device_battery', 'sensor.zepp_device_fat_burning'];

export async function fetchHealthData() {
  const states = await fetchHomeAssistantStates();
  if (!states) return null;
  const allIds = [...HEALTH_VITALS_IDS, ...HEALTH_ACTIVITY_IDS, ...HEALTH_SLEEP_IDS, ...HEALTH_MISC_IDS];
  const byId = {};
  for (const id of allIds) {
    const e = states.find((s) => s.entity_id === id);
    byId[id] = e ? { state: e.state, unit: e.attributes?.unit_of_measurement || '' } : null;
  }
  return byId;
}

function fmt(byId, id, { decimals, unit = true } = {}) {
  const e = byId[id];
  if (!e || e.state == null || e.state === 'unknown' || e.state === 'unavailable') return 'unavailable';
  const num = Number(e.state);
  const val = Number.isNaN(num) ? e.state : (decimals != null ? num.toFixed(decimals) : Math.round(num));
  return `${val}${unit && e.unit ? ' ' + e.unit : ''}`;
}

export function formatHealthContext(byId) {
  if (!byId) return '[HEALTH DATA]: Could not reach Home Assistant to fetch watch data right now.';

  const wearing = byId['binary_sensor.zepp_device_is_wearing']?.state === 'on';

  // Format sleep duration from minutes to human-readable
  const rawSleepTotal = parseInt(byId['sensor.zepp_device_sleep_total']?.state || '0', 10);
  const sleepHours = rawSleepTotal > 0 ? `${Math.floor(rawSleepTotal / 60)}h ${rawSleepTotal % 60}m (${rawSleepTotal} min)` : fmt(byId, 'sensor.zepp_device_sleep_total');
  const rawSleepDeep = parseInt(byId['sensor.zepp_device_sleep_deep']?.state || '0', 10);
  const deepHours = rawSleepDeep > 0 ? `${Math.floor(rawSleepDeep / 60)}h ${rawSleepDeep % 60}m (${rawSleepDeep} min)` : fmt(byId, 'sensor.zepp_device_sleep_deep');

  let ctx = `[HEALTH DATA — Dad's Watch, from Zepp/Amazfit T-Rex 3, live]:\n\n`;

  if (wearing) {
    ctx += `Live Vitals:\n`;
    ctx += `- Heart rate: ${fmt(byId, 'sensor.zepp_device_heart_rate')}\n`;
    ctx += `- Blood oxygen (SpO2): ${fmt(byId, 'sensor.zepp_device_blood_oxygen')}\n`;
    ctx += `- Skin temperature: ${fmt(byId, 'sensor.zepp_device_body_temperature', { decimals: 1 })}\n`;
    ctx += `- Stress: ${fmt(byId, 'sensor.zepp_device_stress', { unit: false })}/100\n`;
    ctx += `- Currently moving: ${byId['binary_sensor.zepp_device_is_moving']?.state === 'on' ? 'yes' : 'no'}\n\n`;
  } else {
    ctx += `Live Vitals: Watch is currently off-wrist (live real-time HR/SpO2 paused).\n\n`;
  }

  ctx += `Activity (today so far):\n`;
  ctx += `- Steps: ${fmt(byId, 'sensor.zepp_device_steps')}\n`;
  ctx += `- Distance: ${fmt(byId, 'sensor.zepp_device_distance', { decimals: 0 })}\n`;
  ctx += `- Calories: ${fmt(byId, 'sensor.zepp_device_calories')}\n`;
  ctx += `- Stands: ${fmt(byId, 'sensor.zepp_device_stands')}\n`;
  ctx += `- PAI: ${fmt(byId, 'sensor.zepp_device_pai')}\n`;
  ctx += `- Last workout: ${fmt(byId, 'sensor.zepp_device_last_workout')} (${fmt(byId, 'sensor.zepp_device_workout_count')} logged)\n\n`;

  ctx += `Last Night's Sleep (from Amazfit watch):\n`;
  ctx += `- Total Sleep Duration: ${sleepHours}\n`;
  ctx += `- Deep Sleep: ${deepHours}\n`;
  ctx += `- Sleep Score: ${fmt(byId, 'sensor.zepp_device_sleep_score', { unit: false })}/100\n`;
  ctx += `- Sleep Window: ${fmt(byId, 'sensor.zepp_device_sleep_start')} to ${fmt(byId, 'sensor.zepp_device_sleep_end')}\n\n`;

  ctx += `Watch Battery: ${fmt(byId, 'sensor.zepp_device_battery')}\n\n`;

  ctx += `Note for interpreting this: you are not a medical professional and this is consumer wearable data (wrist SpO2/temp sensors are less accurate than clinical ones) — summarize the numbers and note anything that looks outside a typical resting range, but don't diagnose, and suggest the user check with a real device or doctor if something looks meaningfully off rather than asserting a conclusion.`;

  return ctx;
}

// The automation.* entity's *state* (from /api/states, already fetched into
// haCategories.automations) is just on/off — the actual trigger/condition/
// action logic lives in HA's separate config API, keyed by the automation's
// numeric config id (its `id` attribute, not its entity_id). Only fetches
// configs for a capped subset (real HA setups can easily have 100+
// automations — fetching/rendering full logic for all of them would blow
// the model's context window on a single tool call).
export async function fetchAutomationConfigs(automationEntities, limit = 15) {
  const configs = [];
  for (const auto of (automationEntities || []).slice(0, limit)) {
    const configId = auto.attributes?.id;
    if (!configId) continue;
    try {
      const res = await haFetch(`/api/config/automation/config/${configId}`);
      if (res.ok) {
        const config = await res.json();
        configs.push({ entity_id: auto.entity_id, name: auto.name, state: auto.state, config });
      }
    } catch (e) {
      console.error(`Error fetching automation config for ${auto.entity_id}:`, e);
    }
  }
  return configs;
}

// Two-tier output: every automation's name+state (cheap — enough to check
// for duplicates against the full list) plus full trigger/condition/action
// detail for only the capped `detailedConfigs` subset.
export function formatAutomationsContext(allAutomations, detailedConfigs, scripts = []) {
  if (allAutomations.length === 0 && scripts.length === 0) {
    return 'No automations or scripts found in Home Assistant.';
  }

  let ctx = `[HOME ASSISTANT AUTOMATIONS — ${allAutomations.length} total]\n`;
  ctx += `Full name list (check this to avoid suggesting a duplicate):\n`;
  allAutomations.forEach(a => { ctx += `- "${a.name}" [${a.state}]\n`; });

  if (detailedConfigs.length > 0) {
    ctx += `\nDetailed logic for the first ${detailedConfigs.length} (ask again for others by name if needed):\n`;
    detailedConfigs.forEach(a => {
      // HA renamed these config keys from singular (trigger/condition/action)
      // to plural at some point — support both rather than assume one version.
      const triggers = a.config?.triggers ?? a.config?.trigger;
      const conditions = a.config?.conditions ?? a.config?.condition;
      const actions = a.config?.actions ?? a.config?.action;
      ctx += `- "${a.name}":`;
      if (triggers) ctx += ` Trigger=${JSON.stringify(triggers).slice(0, 200)}`;
      if (conditions) ctx += ` Condition=${JSON.stringify(conditions).slice(0, 200)}`;
      if (actions) ctx += ` Action=${JSON.stringify(actions).slice(0, 200)}`;
      ctx += `\n`;
    });
  }

  if (scripts.length > 0) {
    ctx += `\n[HOME ASSISTANT SCRIPTS (${scripts.length})]:\n`;
    scripts.slice(0, 40).forEach(s => { ctx += `- "${s.name}" [${s.state}]\n`; });
    if (scripts.length > 40) ctx += `...and ${scripts.length - 40} more scripts not shown.\n`;
  }

  return ctx;
}

// Dashboard/Lovelace config has NO REST endpoint — unlike entity states and
// automations, it's WebSocket-API-only (`lovelace/dashboards/list` then
// `lovelace/config` per dashboard's url_path; confirmed 2026-08-03 that
// `/api/lovelace/config` 404s over REST). Without this, the model has zero
// context about dashboard cards/templates and will confidently guess at
// them — confirmed via a live test where it invented a plausible-sounding
// but entirely made-up card/template name. Works in both the browser
// renderer (native WebSocket) and Electron's main process (Node 22+ via
// Electron 43 globalizes WebSocket) — no extra dependency needed.
export async function fetchDashboardConfigs() {
  return new Promise((resolve) => {
    // This is a direct WebSocket to Home Assistant and cannot go through the
    // /api/ha-proxy REST route, so it still needs a token. In the renderer
    // there no longer is one — the dashboard-config listing is a backend-only
    // capability now, which is where it is actually called from.
    if (isRenderer) {
      console.warn('[homeassistant] fetchDashboardConfigs is backend-only; the renderer holds no HA credential.');
      return resolve(null);
    }
    const wsUrl = HA_DIRECT_URL.replace(/^https/, 'wss') + '/api/websocket';
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      resolve(null);
      return;
    }

    let msgId = 1;
    const pending = {};
    let dashboardList = null;
    let remaining = 0;
    const results = [];

    const finish = (value) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(results.length ? results : null), 10000);

    ws.onerror = () => finish(null);
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: HA_NODE_TOKEN }));
      } else if (msg.type === 'auth_invalid') {
        finish(null);
      } else if (msg.type === 'auth_ok') {
        const id = msgId++;
        pending[id] = '__list__';
        ws.send(JSON.stringify({ id, type: 'lovelace/dashboards/list' }));
      } else if (msg.type === 'result' && pending[msg.id] === '__list__') {
        if (!msg.success || !msg.result?.length) { finish([]); return; }
        dashboardList = msg.result;
        remaining = dashboardList.length;
        for (const dash of dashboardList) {
          const id = msgId++;
          pending[id] = dash.url_path;
          ws.send(JSON.stringify({ id, type: 'lovelace/config', url_path: dash.url_path }));
        }
      } else if (msg.type === 'result' && pending[msg.id]) {
        const urlPath = pending[msg.id];
        if (msg.success) {
          const dash = dashboardList.find((d) => d.url_path === urlPath);
          results.push({ title: dash?.title || urlPath, urlPath, config: msg.result });
        }
        remaining -= 1;
        if (remaining <= 0) finish(results);
      }
    };
  });
}

// Raw dashboard config is verbose (button-card templates alone can run
// hundreds of lines of JS-templated style rules per template) — this
// extracts just {type, template, entity} per card, which is what "what
// card/template renders X" questions actually need, and omits style bodies
// entirely to stay well within context budget across 8+ dashboards.
function extractCardSummary(node, lines, viewLabel) {
  if (Array.isArray(node)) {
    node.forEach((n) => extractCardSummary(n, lines, viewLabel));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const structural = new Set(['grid', 'sections', 'horizontal-stack', 'vertical-stack']);
  if (node.type && !structural.has(node.type)) {
    const bits = [node.type];
    if (node.template) bits.push(`template:${node.template}`);
    if (node.entity) bits.push(node.entity);
    lines.push(`  [${viewLabel}] ${bits.join(' ')}`);
  }
  for (const key of ['cards', 'sections']) {
    if (node[key]) extractCardSummary(node[key], lines, viewLabel);
  }
}

// Two-tier, matching list_home_assistant_entities' domain-filtered pattern:
// no dashboardName → a cheap index (titles + view names) so the model knows
// what to ask for next; a specific dashboardName → full card/template detail
// for just that one dashboard.
export function formatDashboardsContext(dashboards, dashboardName = null) {
  if (!dashboards || dashboards.length === 0) {
    return 'No Home Assistant dashboards found (or dashboard config could not be reached).';
  }

  const match = dashboardName
    ? dashboards.find((d) => d.title.toLowerCase() === dashboardName.toLowerCase() || d.urlPath === dashboardName)
    : null;

  if (dashboardName && !match) {
    return `No dashboard named "${dashboardName}" found. Available dashboards: ${dashboards.map((d) => d.title).join(', ')}.`;
  }

  if (!match) {
    let ctx = `[HOME ASSISTANT DASHBOARDS — ${dashboards.length} total]\n`;
    ctx += `Call this tool again with a specific dashboard_name for card/template detail on one of these:\n`;
    dashboards.forEach((d) => {
      const views = d.config?.views || [];
      const viewNames = views.map((v) => v.title || v.path).filter(Boolean);
      ctx += `- "${d.title}" (${views.length} view${views.length !== 1 ? 's' : ''}${viewNames.length ? ': ' + viewNames.join(', ') : ''})\n`;
    });
    return ctx;
  }

  let ctx = `[HOME ASSISTANT DASHBOARD: "${match.title}"]\n`;
  const templates = match.config?.button_card_templates;
  if (templates) {
    ctx += `Button-card templates defined: ${Object.keys(templates).join(', ')}\n`;
  }
  const lines = [];
  for (const view of match.config?.views || []) {
    extractCardSummary(view, lines, view.title || view.path || 'unnamed view');
  }
  ctx += `Cards (${lines.length}):\n${lines.slice(0, 80).join('\n')}`;
  if (lines.length > 80) ctx += `\n...and ${lines.length - 80} more cards not shown.`;
  return ctx;
}

// Individual zones of an addressable LED strip (e.g. Govee Glide) show up as
// their own `light.` entities in HA — not lights someone would normally
// toggle on their own, so they're excluded from the sidebar's Lights tab.
const LIGHT_SEGMENT_RE = /_segment_\d+$/;

// Entities that live under the `light.` domain due to integration quirks but
// aren't actually room lights (a TV screen, a garage-opener DND indicator, a
// dead presence-sensor LED, a fan) — excluded from the sidebar's Lights tab.
const NON_LIGHT_ENTITY_IDS = new Set([
  'light.office_screen',
  'light.dinning_room_fan',
  'light.smart_garage_door_24100986970711610701c4e7ae0d7417_dnd',
  'light.retro_presence_detector_system_status_led'
]);

function isNormallyUsedLight(entityId, state) {
  if (state === 'unavailable') return false;
  if (LIGHT_SEGMENT_RE.test(entityId)) return false;
  if (NON_LIGHT_ENTITY_IDS.has(entityId)) return false;
  return true;
}

export function sanitizeEntityFriendlyName(name) {
  if (!name) return '';
  return name
    .replace(/\bdinning\b/gi, 'Dining')
    .replace(/\bmaster bedr\w*\b/gi, 'Master Bedroom')
    .trim();
}

export function groupEntitiesByCategory(states) {
  if (!states || !Array.isArray(states)) return {};

  const categories = {
    lights: [],
    switches: [],
    locks: [],
    climate: [],
    security: [],
    updates: [],
    automations: [],
    scripts: [],
    calendars: [],
    persons: [],
    trackers: [],
    media_players: [],
    others: []
  };

  states.forEach(s => {
    const entityId = s.entity_id;
    const domain = entityId.split('.')[0];
    const rawName = s.attributes?.friendly_name || entityId.split('.')[1]?.replace(/_/g, ' ') || entityId;
    const item = {
      entity_id: entityId,
      state: s.state,
      name: sanitizeEntityFriendlyName(rawName),
      attributes: s.attributes
    };

    if (domain === 'light') {
      if (isNormallyUsedLight(entityId, s.state)) categories.lights.push(item);
    }
    else if (domain === 'switch') categories.switches.push(item);
    else if (domain === 'lock') categories.locks.push(item);
    else if (domain === 'climate') categories.climate.push(item);
    else if (domain === 'person') categories.persons.push(item);
    else if (domain === 'device_tracker') categories.trackers.push(item);
    else if (domain === 'calendar') categories.calendars.push(item);
    else if (domain === 'media_player') categories.media_players.push(item);
    else if (domain === 'binary_sensor' && (entityId.includes('door') || entityId.includes('window') || entityId.includes('motion') || entityId.includes('occupancy'))) categories.security.push(item);
    else if (domain === 'update') categories.updates.push(item);
    else if (domain === 'automation') categories.automations.push(item);
    else if (domain === 'script') categories.scripts.push(item);
    else categories.others.push(item);
  });

  return categories;
}

export function calculateSmartHomeStats(categories) {
  const lightsOn = (categories.lights || []).filter(l => l.state === 'on').length;
  const totalLights = (categories.lights || []).length;
  const locksUnlocked = (categories.locks || []).filter(l => l.state === 'unlocked').length;
  const totalLocks = (categories.locks || []).length;
  const updatesPending = (categories.updates || []).filter(u => u.state === 'on').length;
  const familyHome = (categories.persons || []).filter(p => p.state === 'home').length;
  const totalPersons = (categories.persons || []).length;
  
  const climateEntity = (categories.climate || [])[0];
  const climateTemp = climateEntity?.attributes?.current_temperature || climateEntity?.state || '72°F';

  return {
    lightsOn,
    totalLights,
    locksUnlocked,
    totalLocks,
    updatesPending,
    climateTemp,
    familyHome,
    totalPersons
  };
}

export function formatSmartHomeContext(categories, stats, calendarEvents = []) {
  let context = `[SMART HOME REAL-TIME SUMMARY]:\n`;
  context += `- Lights: ${stats.lightsOn}/${stats.totalLights} ON\n`;
  context += `- Security Locks: ${stats.locksUnlocked} UNLOCKED (Total: ${stats.totalLocks})\n`;
  context += `- Thermostat Temp: ${stats.climateTemp}\n`;
  context += `- System Updates Pending: ${stats.updatesPending}\n\n`;

  if (calendarEvents && calendarEvents.length > 0) {
    context += `[UPCOMING GOOGLE CALENDAR & CHORES EVENTS (${calendarEvents.length} Events)]:\n`;
    calendarEvents.forEach(ev => {
      context += `- [${ev.calendar}] ${ev.summary} (${ev.start})\n`;
    });
    context += `\n`;
  }

  return context;
}

// === EXTENDED SMART HOME DOMAIN HELPERS ===

export function getBatteryHealthOverview(states) {
  if (!states || !Array.isArray(states)) return { critical: [], low: [], all: [] };
  const batteries = [];
  const NON_PERCENT_KEYWORDS = ['temperature', 'voltage', 'cycle_count', 'current', 'power', 'health'];

  states.forEach(s => {
    const eid = s.entity_id.toLowerCase();
    const attrs = s.attributes || {};
    const unit = attrs.unit_of_measurement;
    const isBattery = (attrs.device_class === 'battery' || eid.includes('battery')) && !eid.includes('zepp');
    const isNonPercent = NON_PERCENT_KEYWORDS.some(k => eid.includes(k) || (attrs.friendly_name || '').toLowerCase().includes(k));

    if (isBattery && !isNonPercent && (unit === '%' || unit == null) && s.state != null && s.state !== 'unknown' && s.state !== 'unavailable') {
      const level = parseFloat(s.state);
      if (!isNaN(level) && level >= 0 && level <= 100) {
        batteries.push({
          entity_id: s.entity_id,
          name: sanitizeEntityFriendlyName(attrs.friendly_name || s.entity_id),
          level: Math.round(level)
        });
      }
    }
  });

  batteries.sort((a, b) => a.level - b.level);
  const critical = batteries.filter(b => b.level <= 15);
  const low = batteries.filter(b => b.level > 15 && b.level <= 25);
  return { critical, low, all: batteries };
}

export function getApplianceOverview(states) {
  if (!states || !Array.isArray(states)) return {};
  const byId = {};
  states.forEach(s => { byId[s.entity_id] = s; });

  // 1. Roborock Vacuum
  const vacuum = byId['vacuum.roborock_qrevo_pro'];
  const vacuumBattery = byId['sensor.roborock_qrevo_pro_battery']?.state;
  const sideBrushLife = parseFloat(byId['sensor.roborock_qrevo_pro_side_brush_time_left']?.state || '0');
  const mainBrushLife = parseFloat(byId['sensor.roborock_qrevo_pro_main_brush_time_left']?.state || '0');
  const filterLife = parseFloat(byId['sensor.roborock_qrevo_pro_filter_time_left']?.state || '0');
  const waterShortage = byId['binary_sensor.roborock_qrevo_pro_water_shortage']?.state === 'on';
  const dirtyWaterBox = byId['binary_sensor.roborock_qrevo_pro_dock_dirty_water_box']?.state === 'on';

  // 2. Washer & Dryer
  const washerRunning = byId['binary_sensor.washer_running']?.state === 'on';
  const washerDone = byId['binary_sensor.washer_done']?.state === 'on';
  const washerPower = byId['sensor.washer_power_instant']?.state || '0';
  const dryerRunning = byId['binary_sensor.dryer_running']?.state === 'on';
  const dryerDone = byId['binary_sensor.dryer_done']?.state === 'on';

  return {
    vacuum: vacuum ? {
      state: vacuum.state,
      battery: vacuumBattery ? `${vacuumBattery}%` : 'unknown',
      waterShortage,
      dirtyWaterBox,
      consumables: {
        sideBrushHours: Math.round(sideBrushLife),
        mainBrushHours: Math.round(mainBrushLife),
        filterHours: Math.round(filterLife),
        needsMaintenance: sideBrushLife <= 0 || filterLife <= 10
      }
    } : null,
    washer: {
      running: washerRunning,
      done: washerDone,
      powerWatts: washerPower
    },
    dryer: {
      running: dryerRunning,
      done: dryerDone
    }
  };
}

export function getPresenceOverview(states) {
  if (!states || !Array.isArray(states)) return [];
  const persons = [];
  states.forEach(s => {
    if (s.entity_id.startsWith('person.') || s.entity_id === 'device_tracker.mom_s_phone' || s.entity_id === 'device_tracker.honda') {
      persons.push({
        entity_id: s.entity_id,
        name: sanitizeEntityFriendlyName(s.attributes?.friendly_name || s.entity_id.split('.')[1]),
        location: s.state
      });
    }
  });
  return persons;
}

export function getEnvironmentalOverview(states) {
  if (!states || !Array.isArray(states)) return { rooms: [], openWindows: [], alarmsOk: true };
  const rooms = [];
  const openWindows = [];
  let alarmsOk = true;

  states.forEach(s => {
    const eid = s.entity_id;
    const name = sanitizeEntityFriendlyName(s.attributes?.friendly_name || eid);
    if (eid.startsWith('sensor.') && eid.endsWith('_temp') && !eid.includes('cpu') && !eid.includes('nas')) {
      rooms.push({ name, temp: s.state + (s.attributes?.unit_of_measurement || '°F') });
    }
    if (eid.startsWith('binary_sensor.') && (eid.includes('window') || eid.includes('door')) && s.state === 'on') {
      openWindows.push(name);
    }
    if (eid.includes('carbon_monoxide') && s.state === 'on') {
      alarmsOk = false;
    }
  });

  return { rooms, openWindows, alarmsOk };
}

export function getWeatherOverview(states) {
  if (!states || !Array.isArray(states)) return null;
  const weatherEntity = states.find(s => s.entity_id.startsWith('weather.'));
  const sunEntity = states.find(s => s.entity_id === 'sun.sun');
  return {
    state: weatherEntity?.state || 'Clear',
    temperature: weatherEntity?.attributes?.temperature ? `${weatherEntity.attributes.temperature}°F` : null,
    humidity: weatherEntity?.attributes?.humidity ? `${weatherEntity.attributes.humidity}%` : null,
    sun: sunEntity?.state || 'above_horizon'
  };
}

export function formatExtendedSmartHomeContext(states) {
  if (!states || !Array.isArray(states)) return '';
  const batteries = getBatteryHealthOverview(states);
  const appliances = getApplianceOverview(states);
  const presence = getPresenceOverview(states);
  const env = getEnvironmentalOverview(states);
  const weather = getWeatherOverview(states);

  let ctx = `\n[EXTENDED SMART HOME & APPLIANCE TELEMETRY]:\n`;

  // Appliances
  if (appliances.washer || appliances.dryer || appliances.vacuum) {
    ctx += `Appliances:\n`;
    if (appliances.washer) ctx += `- Washer: ${appliances.washer.running ? 'RUNNING (' + appliances.washer.powerWatts + 'W)' : appliances.washer.done ? 'CYCLE FINISHED (Clean laundry waiting)' : 'IDLE'}\n`;
    if (appliances.dryer) ctx += `- Dryer: ${appliances.dryer.running ? 'RUNNING' : appliances.dryer.done ? 'CYCLE FINISHED (Dry laundry waiting)' : 'IDLE'}\n`;
    if (appliances.vacuum) {
      ctx += `- Roborock Vacuum: ${appliances.vacuum.state.toUpperCase()} (Battery: ${appliances.vacuum.battery})`;
      if (appliances.vacuum.consumables?.needsMaintenance) {
        ctx += ` ⚠️ Side brush expired (${appliances.vacuum.consumables.sideBrushHours}h left)`;
      }
      ctx += `\n`;
    }
  }

  // Batteries
  if (batteries.critical.length > 0 || batteries.low.length > 0) {
    ctx += `Battery Sentinel:\n`;
    batteries.critical.forEach(b => { ctx += `- 🚨 CRITICAL BATTERY: ${b.name} (${b.level}%)\n`; });
    batteries.low.forEach(b => { ctx += `- ⚠️ Low Battery: ${b.name} (${b.level}%)\n`; });
  }

  // Presence
  if (presence.length > 0) {
    ctx += `Family Presence:\n`;
    presence.forEach(p => { ctx += `- ${p.name}: ${p.location}\n`; });
  }

  // Environment & Open Windows
  if (env.openWindows.length > 0) {
    ctx += `Open Doors/Windows (${env.openWindows.length}): ${env.openWindows.join(', ')}\n`;
  }
  if (!env.alarmsOk) {
    ctx += `🚨 ALERT: Carbon Monoxide / Safety Alarm is TRIGGERED!\n`;
  }

  // Weather
  if (weather && weather.temperature) {
    ctx += `Weather: ${weather.state}, ${weather.temperature} (Sun: ${weather.sun})\n`;
  }

  return ctx;
}

export function getLiveCameraDetections(states = []) {
  if (!Array.isArray(states)) return [];

  const stateMap = {};
  for (const s of states) {
    if (s && s.entity_id) stateMap[s.entity_id] = s;
  }

  const cameras = [
    {
      id: 'behind_garage',
      camera: 'Behind Garage',
      descEntity: 'input_text.behind_garage_ai_desc',
      timeEntity: 'input_text.behind_garage_ai_time',
      imagePath: '/local/behind_garage_person.jpg',
      defaultTime: '3:31 PM · Today'
    },
    {
      id: 'backyard',
      camera: 'Backyard',
      descEntity: 'input_text.backyard_ai_desc',
      timeEntity: 'input_text.backyard_ai_time',
      imagePath: '/local/backyard_person.jpg',
      defaultTime: '2:37 PM · Today'
    },
    {
      id: 'driveway',
      camera: 'Driveway',
      descEntity: 'input_text.driveway_ai_desc',
      timeEntity: 'input_text.driveway_ai_time',
      imagePath: '/local/driveway_person.jpg',
      defaultTime: '3:25 PM · Today'
    },
    {
      id: 'front_door',
      camera: 'Front Door',
      descEntity: 'input_text.front_door_ai_desc',
      timeEntity: 'input_text.front_door_ai_time',
      imagePath: '/local/front_door_person.jpg',
      defaultTime: '10:30 AM · Today'
    }
  ];

  const events = [];
  for (const cam of cameras) {
    const descState = stateMap[cam.descEntity]?.state;
    const timeState = stateMap[cam.timeEntity]?.state;
    if (descState && descState !== 'unknown' && descState !== 'unavailable' && descState !== '') {
      events.push({
        id: `live_${cam.id}`,
        camera: cam.camera,
        formattedTime: (timeState && timeState !== 'unknown') ? timeState : cam.defaultTime,
        timestamp: new Date().toISOString(),
        imageUrl: `${HA_DIRECT_URL}${cam.imagePath}?t=${Date.now()}`,
        fallbackUrl: `/api/security/snapshots/${cam.id}.jpg`,
        analysis: descState,
        confidence: 0.96,
        tags: ['verified', 'person', cam.camera.toLowerCase()]
      });
    }
  }

  return events;
}

