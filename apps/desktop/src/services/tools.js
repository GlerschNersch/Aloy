// Tool/function-calling registry. Each tool is fully self-contained: its
// Ollama function schema, whether it needs explicit user confirmation before
// running, and its executor. Read-only tools (query current state) run
// immediately and silently, matching how context injection already worked.
// Write tools (change state) ALWAYS require confirmation — regardless of how
// low-stakes a given call looks — because the request to call them can be
// shaped by untrusted content reaching the model's context (RAG documents,
// web search, calendar data), the same reasoning already applied to the
// OS-command and lock-domain confirmation gates elsewhere in this app.
//
// `execute(args, ctx)` receives the parsed call arguments and a `ctx` object
// assembled by the caller (App.jsx) with whatever live data/handlers a tool
// needs. It must return a JSON-serializable result (fed back to the model as
// a `role: 'tool'` message).

import { formatFinanceContext } from './financeTracker.js';
import { calculateWorkoutStreak, formatWorkoutHistoryContext } from './workouts.js';
import {
  formatSmartHomeContext, fetchAutomationConfigs, formatAutomationsContext, fetchDashboardConfigs, formatDashboardsContext,
  fetchLLMVisionTimeline, formatLLMVisionContext, fetchHealthData, formatHealthContext,
  getBatteryHealthOverview, getApplianceOverview, getPresenceOverview, getEnvironmentalOverview, getWeatherOverview, formatExtendedSmartHomeContext
} from './homeassistant.js';
import { fetchProjectStatus, formatProjectStatusContext } from './projectMonitor.js';
import { answerVisualQuestion } from './ambientObserver.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { apiJson, apiFetch } from './aloyApi.js';

// Home Assistant domain.service combos considered low-risk enough to execute
// straight from a chat/voice command with no confirmation prompt. Deliberately
// an ALLOWLIST — an unlisted domain (lock, cover, alarm_control_panel,
// climate, script, automation, ...) always falls through to "ask first".
// Kept intentionally narrow: every entry here is trivially reversible by
// issuing the opposite command, which is what makes skipping the prompt safe.
const LOW_RISK_HA_SERVICES = {
  light: ['turn_on', 'turn_off', 'toggle'],
  switch: ['turn_on', 'turn_off', 'toggle'],
  fan: ['turn_on', 'turn_off', 'toggle'],
  input_boolean: ['turn_on', 'turn_off', 'toggle'],
  scene: ['turn_on'],
  media_player: ['turn_on', 'turn_off', 'media_play', 'media_pause', 'media_stop', 'volume_up', 'volume_down']
};

export function isLowRiskHaAction(args) {
  const domain = typeof args?.domain === 'string' ? args.domain.toLowerCase() : '';
  const service = typeof args?.service === 'string' ? args.service.toLowerCase() : '';
  // A malformed/missing entity_id can't be judged safe — fail closed to the
  // confirmation prompt rather than auto-running something unparseable.
  const entityId = typeof args?.entity_id === 'string' ? args.entity_id.toLowerCase() : '';
  if (!domain || !service || !entityId) return false;
  // entity_id must actually belong to the claimed domain, so a `light`
  // domain can't smuggle through a `lock.front_door` entity.
  if (!entityId.startsWith(`${domain}.`)) return false;
  return (LOW_RISK_HA_SERVICES[domain] || []).includes(service);
}

// `requiresConfirmation` may be a boolean OR a predicate over the call's
// arguments (see control_smart_home_device). Every consumer must go through
// this resolver rather than reading the property directly — a bare truthiness
// check on a function would treat EVERY call as needing confirmation.
export function toolRequiresConfirmation(tool, args) {
  if (!tool) return false;
  const rc = tool.requiresConfirmation;
  if (typeof rc === 'function') {
    try {
      return !!rc(args || {});
    } catch {
      return true; // predicate blew up — fail closed to asking the user
    }
  }
  return !!rc;
}

// Whether a tool mutates state / takes a real-world action, INDEPENDENT of
// whether this particular call happened to skip the prompt. Used to exclude
// write sequences from skill synthesis: an auto-approved "turn off the light"
// is still a write, and mining it into an auto-suggested skill would nudge the
// model toward repeating a physical action unprompted.
export function isWriteTool(tool) {
  if (!tool) return false;
  return tool.requiresConfirmation === true || typeof tool.requiresConfirmation === 'function';
}

export const TOOLS = [
  {
    name: 'get_finance_summary',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_finance_summary',
        description: "Get this month's income, expenses, spending by category, budget status, and recent transactions. Use this whenever the user asks about spending, budgets, or finances.",
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      return formatFinanceContext(ctx.transactions, ctx.budgets) || 'No finance data recorded yet.';
    }
  },

  {
    name: 'get_stock_portfolio_status',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_stock_portfolio_status',
        description: "Get live prices and today's change for the user's tracked stock/ETF holdings (Hermes). Use this whenever they ask how their stocks/portfolio are doing, or about a specific ticker.",
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      if (!ctx.onGetPortfolioSnapshot) return 'Portfolio tracking is not available in this context.';
      const snap = await ctx.onGetPortfolioSnapshot();
      if (!snap.hasData) return snap.message || 'No stock symbols configured yet.';
      const lines = snap.holdings.map(h => {
        if (h.ok === false && !h.price) return `${h.symbol}: unavailable (${h.error || h.staleReason})`;
        const sign = h.changePercent > 0 ? '+' : '';
        const staleTag = h.stale ? ' [STALE — last known price, live fetch failed]' : '';
        const valueTag = h.value != null ? `, ${h.shares} sh = $${h.value}` : '';
        return `${h.symbol} (${h.name}): $${h.price} ${sign}${h.changePercent}% today${valueTag}${staleTag}`;
      });
      const totalLine = snap.totalValue != null
        ? `\nTotal position value: $${snap.totalValue}${snap.totalValueIsPartial ? ' (partial — some quotes stale/unavailable)' : ''}`
        : '';
      return `Portfolio as of ${snap.checkedAt} — ${snap.gainers} up, ${snap.decliners} down:\n` + lines.join('\n') + totalLine;
    }
  },

  {
    name: 'get_smart_home_status',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_smart_home_status',
        description: 'Get live status of lights, locks, climate, and pending updates for the smart home. Use this when the user asks about the state of their home.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      if (!ctx.haCategories?.lights || !ctx.smartHomeStats) return 'Smart home data is not available right now.';
      return formatSmartHomeContext(ctx.haCategories, ctx.smartHomeStats);
    }
  },

  {
    name: 'get_battery_status',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_battery_status',
        description: 'Check battery levels across all smart home sensors, door locks, and wireless devices. Highlights critical (<15%) and low (<25%) battery levels.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      const rawStates = ctx.rawHaStates || (ctx.onFetchRawHaStates ? await ctx.onFetchRawHaStates() : null);
      if (!rawStates) return 'Battery telemetry is not available right now.';
      const res = getBatteryHealthOverview(rawStates);
      if (res.all.length === 0) return 'No battery sensors found in Home Assistant.';
      let out = `🔋 **Smart Home Battery Status (${res.all.length} Devices)**:\n`;
      if (res.critical.length > 0) {
        out += `\n🚨 **Critical Batteries (<=15%):**\n` + res.critical.map(b => `- ${b.name}: **${b.level}%**`).join('\n');
      }
      if (res.low.length > 0) {
        out += `\n⚠️ **Low Batteries (<=25%):**\n` + res.low.map(b => `- ${b.name}: **${b.level}%**`).join('\n');
      }
      out += `\n\nAll Devices:\n` + res.all.map(b => `- ${b.name}: ${b.level}%`).join('\n');
      return out;
    }
  },

  {
    name: 'get_appliance_status',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_appliance_status',
        description: 'Check real-time status of household appliances: Washer & Dryer cycle progress, and Roborock robot vacuum status, battery, water levels, and brush consumable wear.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      const rawStates = ctx.rawHaStates || (ctx.onFetchRawHaStates ? await ctx.onFetchRawHaStates() : null);
      if (!rawStates) return 'Appliance telemetry is not available right now.';
      const app = getApplianceOverview(rawStates);
      let out = `🧺 **Household Appliance Status**:\n`;
      if (app.washer) {
        out += `- **Washer**: ${app.washer.running ? '🔄 Running (' + app.washer.powerWatts + 'W)' : app.washer.done ? '✅ Cycle Finished (Clean laundry ready)' : 'Idle'}\n`;
      }
      if (app.dryer) {
        out += `- **Dryer**: ${app.dryer.running ? '🔄 Running' : app.dryer.done ? '✅ Cycle Finished (Dry laundry ready)' : 'Idle'}\n`;
      }
      if (app.vacuum) {
        out += `- **Roborock Qrevo Pro Vacuum**: ${app.vacuum.state.toUpperCase()} (Battery: ${app.vacuum.battery})\n`;
        if (app.vacuum.waterShortage) out += `  ⚠️ Water tank needs refill!\n`;
        if (app.vacuum.dirtyWaterBox) out += `  ⚠️ Dirty water tank needs emptying!\n`;
        out += `  Consumables: Side brush: ${app.vacuum.consumables.sideBrushHours}h, Main brush: ${app.vacuum.consumables.mainBrushHours}h, Filter: ${app.vacuum.consumables.filterHours}h\n`;
      }
      return out;
    }
  },

  {
    name: 'get_family_presence',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_family_presence',
        description: 'Get current location and presence status for family members and vehicles (e.g. Home, Work, School, Away).',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      const rawStates = ctx.rawHaStates || (ctx.onFetchRawHaStates ? await ctx.onFetchRawHaStates() : null);
      if (!rawStates) return 'Presence telemetry is not available right now.';
      const list = getPresenceOverview(rawStates);
      if (list.length === 0) return 'No presence trackers found.';
      return `📍 **Family & Vehicle Presence**:\n` + list.map(p => `- **${p.name}**: ${p.location}`).join('\n');
    }
  },

  {
    name: 'get_home_environment',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_home_environment',
        description: 'Check room-by-room temperatures, open doors/windows, and carbon monoxide / safety alarms.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      const rawStates = ctx.rawHaStates || (ctx.onFetchRawHaStates ? await ctx.onFetchRawHaStates() : null);
      if (!rawStates) return 'Environmental telemetry is not available right now.';
      const env = getEnvironmentalOverview(rawStates);
      let out = `🌡️ **Home Environment & Safety**:\n`;
      if (env.rooms.length > 0) {
        out += `\nRoom Temperatures:\n` + env.rooms.map(r => `- ${r.name}: ${r.temp}`).join('\n');
      }
      out += `\n\nSecurity & Doors/Windows:\n`;
      if (env.openWindows.length > 0) {
        out += `- 🚪 Open (${env.openWindows.length}): ${env.openWindows.join(', ')}\n`;
      } else {
        out += `- All monitored doors and windows are closed.\n`;
      }
      out += `- Carbon Monoxide / Safety Alarms: ${env.alarmsOk ? '✅ Normal (No alarms)' : '🚨 ALARM TRIGGERED'}\n`;
      return out;
    }
  },

  {
    name: 'get_weather_forecast',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_weather_forecast',
        description: 'Get local outdoor weather conditions, temperature, humidity, and sun position (sunrise/sunset).',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      const rawStates = ctx.rawHaStates || (ctx.onFetchRawHaStates ? await ctx.onFetchRawHaStates() : null);
      if (!rawStates) return 'Weather data is not available right now.';
      const w = getWeatherOverview(rawStates);
      if (!w) return 'No weather station found in Home Assistant.';
      return `🌤️ **Local Weather**: ${w.state}, ${w.temperature || 'N/A'} (Humidity: ${w.humidity || 'N/A'}, Sun: ${w.sun})`;
    }
  },

  {
    name: 'get_project_status',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_project_status',
        description: "Get the live status/progress of a tracked local project (from the Projects & Builds panel), e.g. a build or long-running local process. Use this when the user asks how a tracked project or process is going.",
        parameters: {
          type: 'object',
          properties: {
            project_name: { type: 'string', description: 'Name of the tracked project, as shown in the Projects & Builds panel' }
          },
          required: ['project_name']
        }
      }
    },
    execute: async (args, ctx) => {
      const project = (ctx.trackedProjects || []).find(p =>
        p.name.toLowerCase().includes((args.project_name || '').toLowerCase())
      );
      if (!project) return `No tracked project matching "${args.project_name}" was found.`;
      if (!project.statusUrl) return `"${project.name}" has no live Status URL configured, so no real-time status is available for it.`;
      const statusData = await fetchProjectStatus(project.statusUrl);
      if (!statusData) return `Could not reach the status endpoint for "${project.name}" right now.`;
      return formatProjectStatusContext(project.name, statusData);
    }
  },

  {
    name: 'search_media_library',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'search_media_library',
        description: 'Search the local movie (346 movies on P:\\Movies) and TV show (The Simpsons on P:\\TV Shows) library. Use this whenever the user asks if a movie or show is available or wants to find media to play.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Movie title, show name, or episode search term (e.g. "Drunken Master", "The Simpsons Cape Feare", "Dragon Ball")' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      try {
        const q = encodeURIComponent(args.query || '');
        const data = await apiJson(`/api/media/library?query=${q}`);
        const items = data.results || [];
        if (items.length === 0) return `No media matching "${args.query || ''}" found in the library.`;
        return `Found ${items.length} media items:\n` + items.slice(0, 10).map(m => `- ${m.title} (${m.category}${m.year ? `, ${m.year}` : ''}) [${(m.sizeBytes / (1024*1024*1024)).toFixed(2)} GB] -> Path: ${m.filePath}`).join('\n');
      } catch (err) {
        return `Failed to search media library: ${err.message}`;
      }
    }
  },

  {
    name: 'list_playback_targets',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'list_playback_targets',
        description: 'List all available media playback destinations across the local network: "local" (This PC Desktop), "bazzite" (Bazzite Gaming Station), "lenny" (Lenny Server), active Jellyfin client sessions, and Home Assistant Cast players.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    execute: async () => {
      try {
        const data = await apiJson('/api/media/targets');
        const targets = data.targets || [];
        return `Available Playback Targets:\n` + targets.map(t => `- **${t.name}** [ID: \`${t.id}\`] (${t.status}) — ${t.description}`).join('\n');
      } catch (err) {
        return `Failed to list playback targets: ${err.message}`;
      }
    }
  },

  {
    name: 'play_media',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'play_media',
        description: 'Dispatch and play a movie or TV show episode from the local library to any target destination: "all" (Party / Broadcast mode to all devices simultaneously), "bazzite" (Bazzite Gaming Station), "lenny" (Lenny Server), "local" (This PC Desktop), or a connected Jellyfin / Smart TV client. Use this whenever the user asks to play, watch, put on, or cast a movie or show on any or all devices.',
        parameters: {
          type: 'object',
          properties: {
            media_title: { type: 'string', description: 'The title of the movie or TV show episode to play (e.g. "Drunken Master", "The Simpsons S05E02", "Dragon Ball Z Battle of Gods")' },
            target: { type: 'string', description: 'Destination target: "all", "everywhere", "bazzite", "lenny", "local", "living_room_tv", or "jellyfin"' }
          },
          required: ['media_title']
        }
      }
    },
    execute: async (args) => {
      try {
        const target = String(args.target || 'local').toLowerCase();
        let targetId = 'local';
        if (target.includes('all') || target.includes('everywhere') || target.includes('broadcast') || target.includes('party')) targetId = 'all';
        else if (target.includes('bazzite')) targetId = 'machine:bazzite';
        else if (target.includes('lenny')) targetId = 'machine:lenny';
        else if (target.includes('local') || target.includes('pc') || target.includes('desktop')) targetId = 'local';
        else if (target.includes('jellyfin')) targetId = 'jellyfin:active';
        else if (target.includes('tv') || target.includes('cast')) targetId = `ha:${target}`;

        const data = await apiJson('/api/media/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetId,
            mediaTitle: args.media_title
          }),
          timeoutMs: 12000
        });
        if (!data.success) {
          return `Playback dispatch failed: ${data.error || 'Unknown error'}`;
        }
        return `🎬 **Playback Started**: ${data.message || `Playing "${args.media_title}" on ${targetId}`}`;
      } catch (err) {
        return `Failed to dispatch playback: ${err.message}`;
      }
    }
  },

  {
    name: 'network_traceroute',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'network_traceroute',
        description: 'Run an intelligent traceroute probe to an IP or domain with real-time BGP ASN, GeoIP, and IXP peering telemetry (NextTrace-style). Use when the user asks about network path, latency, packet loss, or routing to a server.',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Target hostname or IP address (e.g. 1.1.1.1, github.com, 8.8.8.8)' },
            protocol: { type: 'string', enum: ['ICMP', 'TCP', 'UDP'], description: 'Probe protocol (defaults to ICMP)' }
          },
          required: ['target']
        }
      }
    },
    execute: async (args) => {
      try {
        const target = encodeURIComponent(String(args.target || '1.1.1.1').trim());
        const proto = encodeURIComponent(String(args.protocol || 'ICMP'));
        const data = await apiJson(`/api/network/trace?target=${target}&protocol=${proto}&maxHops=15`, {
          timeoutMs: 38000
        });

        if (!data || !data.success || !Array.isArray(data.hops)) {
          return `Network trace failed: ${data?.error || 'No route data returned'}`;
        }

        let out = `🌐 **Route Intelligence Trace for \`${data.target}\`** (${data.protocol})\n`;
        out += `* Total Hops: ${data.totalHops} | Final Latency: ${data.finalRtt} ms\n\n`;
        out += '| Hop | IP | Node Type | Location | AS / Provider | Latency |\n';
        out += '|---|---|---|---|---|---|\n';

        for (const h of data.hops) {
          const loc = h.location ? `${h.location.flag || ''} ${h.location.city || ''}, ${h.location.country || ''}`.trim() : 'Unknown';
          const as = h.as ? `${h.as} (${h.org || ''})` : (h.org || 'Local');
          out += `| ${h.hop} | \`${h.ip}\` | ${h.type || 'TRANSIT'} | ${loc} | ${as} | ${h.avgRtt} ms |\n`;
        }

        return out;
      } catch (err) {
        return `Failed to execute network trace: ${err.message}`;
      }
    }
  },

  {
    name: 'add_transaction',
    requiresConfirmation: true,
    confirmLabel: (args) => {
      const amt = Number(args.amount) || 0;
      const verb = args.type === 'income' ? 'Log income' : 'Log expense';
      return `${verb} of $${amt.toFixed(2)} in "${args.category || 'Other'}"${args.description ? ` — ${args.description}` : ''}?`;
    },
    definition: {
      type: 'function',
      function: {
        name: 'add_transaction',
        description: 'Log a new expense or income transaction in the Finances tracker. Use this when the user mentions a purchase or income they want recorded (e.g. "I just spent $40 on groceries").',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['expense', 'income'], description: 'Whether this is money spent or received' },
            amount: { type: 'number', description: 'Dollar amount, positive' },
            category: { type: 'string', description: 'Spending/income category, e.g. Groceries, Dining, Income' },
            description: { type: 'string', description: 'Optional short note about the transaction' }
          },
          required: ['type', 'amount', 'category']
        }
      }
    },
    execute: async (args, ctx) => {
      const transaction = {
        id: `tx-${Date.now()}`,
        type: args.type === 'income' ? 'income' : 'expense',
        amount: Number(args.amount) || 0,
        category: args.category || 'Other',
        description: args.description || '',
        date: new Date().toISOString()
      };
      ctx.onAddTransaction(transaction);
      return JSON.stringify({ success: true, transaction });
    }
  },

  {
    name: 'set_budget',
    requiresConfirmation: true,
    confirmLabel: (args) => `Set the monthly budget for "${args.category}" to $${(Number(args.limit) || 0).toFixed(2)}?`,
    definition: {
      type: 'function',
      function: {
        name: 'set_budget',
        description: 'Set (or update) a monthly spending budget limit for a category in the Finances tracker.',
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Spending category to budget, e.g. Groceries' },
            limit: { type: 'number', description: 'Monthly dollar limit, positive' }
          },
          required: ['category', 'limit']
        }
      }
    },
    execute: async (args, ctx) => {
      const category = args.category || 'Other';
      const limit = Number(args.limit) || 0;
      ctx.onSetBudget({ category, limit });
      return JSON.stringify({ success: true, category, limit });
    }
  },

  {
    name: 'get_smart_home_automations',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_smart_home_automations',
        description: "Get the user's existing Home Assistant automations and scripts, including their trigger/condition/action logic. ALWAYS use this before recommending a new automation, so you don't suggest something that already exists.",
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      if (!ctx.haCategories?.automations) return 'Smart home data is not available right now.';
      const detailedConfigs = await fetchAutomationConfigs(ctx.haCategories.automations);
      return formatAutomationsContext(ctx.haCategories.automations, detailedConfigs, ctx.haCategories.scripts || []);
    }
  },

  {
    name: 'get_dashboard_config',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_dashboard_config',
        description: "Get the user's actual Home Assistant dashboard/Lovelace configuration — which card types, custom cards (e.g. button-card, calendar-card-pro), templates, and entities are used on each dashboard. Call with no dashboard_name first to see what dashboards exist, then call again with a specific dashboard_name for full card/template detail. ALWAYS use this before answering any question about the user's dashboards, cards, or Lovelace YAML — do not guess or assume standard/default cards, since these are custom-built and specific to this setup.",
        parameters: {
          type: 'object',
          properties: {
            dashboard_name: { type: 'string', description: "Optional. The dashboard's title (e.g. 'Lights', 'TVs') to get full card/template detail for. Omit to list all dashboards first." }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      const dashboards = await fetchDashboardConfigs();
      if (dashboards === null) return 'Could not reach Home Assistant to fetch dashboard config right now.';
      return formatDashboardsContext(dashboards, args.dashboard_name);
    }
  },

  {
    name: 'get_llm_vision_activity',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_llm_vision_activity',
        description: "Get recent activity from the user's 5 local-Ollama camera/vision automations (front door doorbell, driveway Amazon-driver detection, game room gaming detection, backyard/behind-garage person descriptions) — what each analysis actually found, and when. Use this for any question about the doorbell, driveway deliveries, whether the kids were gaming, or who/what a backyard camera saw.",
        parameters: {
          type: 'object',
          properties: {
            hours: { type: 'number', description: 'How many hours back to look. Defaults to 24.' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      const hours = Number(args.hours) || 24;
      const events = await fetchLLMVisionTimeline(hours);
      return formatLLMVisionContext(events, hours);
    }
  },

  {
    name: 'get_health_status',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_health_status',
        description: "Get the user's live health/fitness data from his Zepp/Amazfit smartwatch (the \"Dad's Watch\" view on the Family HA dashboard) — heart rate, blood oxygen, skin temperature, stress, today's steps/calories/activity, and last night's sleep. Use this whenever the user asks for a health status report, how he's doing, his vitals, sleep, or activity today.",
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async () => {
      const data = await fetchHealthData();
      return formatHealthContext(data);
    }
  },

  {
    name: 'list_home_assistant_entities',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'list_home_assistant_entities',
        description: "List Home Assistant entities in a specific domain (e.g. 'person', 'device_tracker', 'zone', 'sensor', 'binary_sensor', 'media_player', 'cover', 'fan') with their current state. Use 'person' or 'device_tracker' when the user asks where a family member (e.g. Mom, Dad, kids) is located.",
        parameters: {
          type: 'object',
          properties: {
            domain: { type: 'string', description: "HA domain to list, e.g. 'person', 'device_tracker', 'zone', 'sensor', 'binary_sensor'" }
          },
          required: ['domain']
        }
      }
    },
    execute: async (args, ctx) => {
      const domain = (args.domain || '').toLowerCase().trim();
      if (!domain) return 'No domain specified.';
      const allEntities = Object.values(ctx.haCategories || {}).flat();
      const matches = allEntities.filter(e => e.entity_id.startsWith(`${domain}.`));
      if (matches.length === 0) return `No entities found in domain "${domain}".`;
      const lines = matches.slice(0, 60).map(e => `- ${e.name} (${e.entity_id}): ${e.state}`);
      const suffix = matches.length > 60 ? `\n...and ${matches.length - 60} more.` : '';
      return `[${matches.length} "${domain}" ENTITIES]:\n${lines.join('\n')}${suffix}`;
    }
  },

  {
    name: 'jellyfin_now_playing',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'jellyfin_now_playing',
        description: 'Check active media playback across all Jellyfin devices in the house in real time. Returns what movie, episode, or track is currently playing, who is watching/listening, the device/room name, current progress percentage, and paused/playing state.',
        parameters: {
          type: 'object',
          properties: {
            device_name: { type: 'string', description: 'Optional device name to filter by (e.g. "Living Room TV", "Ultra", "OnePlus", "Chrome")' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      try {
        const sessRes = await apiFetch('/api/jellyfin/sessions', {}, 15000);
        const sessData = await sessRes.json();
        let sessions = sessData.sessions || [];

        if (args?.device_name) {
          const filter = args.device_name.toLowerCase();
          sessions = sessions.filter(s =>
            (s.deviceName && s.deviceName.toLowerCase().includes(filter)) ||
            (s.client && s.client.toLowerCase().includes(filter)) ||
            (s.userName && s.userName.toLowerCase().includes(filter))
          );
        }

        if (sessions.length === 0) {
          return args?.device_name
            ? `No active Jellyfin sessions matching "${args.device_name}".`
            : 'No active devices or streams connected to Jellyfin right now.';
        }

        const activeStreams = sessions.filter(s => s.nowPlaying != null);
        const idleDevices = sessions.filter(s => s.nowPlaying == null);

        const formatTicks = (ticks) => {
          if (!ticks) return '0:00';
          const totalSec = Math.floor(ticks / 10000000);
          const hrs = Math.floor(totalSec / 3600);
          const mins = Math.floor((totalSec % 3600) / 60);
          const secs = totalSec % 60;
          if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
          }
          return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        const streamLines = activeStreams.map(s => {
          const np = s.nowPlaying;
          const status = np.isPaused ? '⏸️ PAUSED' : '▶️ PLAYING';
          const title = np.seriesName
            ? `${np.seriesName} — ${np.name}${np.seasonNumber != null && np.episodeNumber != null ? ` (S${np.seasonNumber}E${np.episodeNumber})` : ''}`
            : np.name;
          const duration = np.runTimeTicks ? ` [${formatTicks(np.positionTicks)} / ${formatTicks(np.runTimeTicks)} (${np.playbackPercent}%)]` : ` [${np.playbackPercent}%]`;
          const userDev = `User: ${s.userName} on ${s.deviceName || s.client}`;
          const transcode = s.transcodingInfo && (!s.transcodingInfo.isVideoDirect || !s.transcodingInfo.isAudioDirect)
            ? ` (Transcoding: ${s.transcodingInfo.videoCodec || ''}/${s.transcodingInfo.audioCodec || ''})`
            : ' (Direct Play)';
          return `• ${status} ${title}${duration}\n  ${userDev}${transcode} (Session ID: ${s.id})`;
        });

        const idleLines = idleDevices.map(d => `• ${d.userName} on ${d.deviceName || d.client} (${d.client} v${d.applicationVersion || ''}) [IDLE]`);

        let output = '';
        if (activeStreams.length > 0) {
          output += `[JELLYFIN ACTIVE PLAYBACK STREAMS (${activeStreams.length})]:\n${streamLines.join('\n\n')}\n\n`;
        } else {
          output += 'No media is currently playing on Jellyfin.\n\n';
        }

        if (idleDevices.length > 0) {
          output += `[CONNECTED IDLE DEVICES (${idleDevices.length})]:\n${idleLines.join('\n')}`;
        }

        return output.trim();
      } catch (err) {
        return `Jellyfin now playing query error: ${err.message}`;
      }
    }
  },

  {
    name: 'jellyfin_control',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'jellyfin_control',
        description: 'Control media playback on connected Jellyfin devices (TV, Roku, Shield, Phone, Tablet, Web player). Commands: Play, Pause, Unpause, PlayPause, Stop, NextTrack, PreviousTrack, SetVolume, Seek, Mute, Unmute.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Playback command: Play, Pause, Unpause, PlayPause, Stop, NextTrack, PreviousTrack, SetVolume, Seek, Mute, Unmute',
              enum: ['Play', 'Pause', 'Unpause', 'PlayPause', 'Stop', 'NextTrack', 'PreviousTrack', 'SetVolume', 'Seek', 'Mute', 'Unmute']
            },
            deviceName: { type: 'string', description: 'Name of the device or user to control (e.g. "Living Room TV", "Roku", "Kids Room"). Optional if only one device is active.' },
            sessionId: { type: 'string', description: 'Exact session ID if known.' },
            volume: { type: 'number', description: 'Volume level (0-100) for SetVolume command.' },
            positionSeconds: { type: 'number', description: 'Seek position in seconds.' }
          },
          required: ['command']
        }
      }
    },
    execute: async (args) => {
      try {
        const sessRes = await apiFetch('/api/jellyfin/sessions', {}, 15000);
        const sessData = await sessRes.json();
        const sessions = sessData.sessions || [];

        if (sessions.length === 0) {
          return 'No active Jellyfin client devices are currently connected or streaming.';
        }

        let target = null;
        if (args.sessionId) {
          target = sessions.find(s => s.id === args.sessionId);
        }

        if (!target && args.deviceName) {
          const filter = args.deviceName.toLowerCase();
          // First check active playing streams matching device/user
          target = sessions.find(s =>
            s.nowPlaying && (
              (s.deviceName && s.deviceName.toLowerCase().includes(filter)) ||
              (s.userName && s.userName.toLowerCase().includes(filter)) ||
              (s.client && s.client.toLowerCase().includes(filter))
            )
          );
          // Fallback to any connected session matching
          if (!target) {
            target = sessions.find(s =>
              (s.deviceName && s.deviceName.toLowerCase().includes(filter)) ||
              (s.userName && s.userName.toLowerCase().includes(filter)) ||
              (s.client && s.client.toLowerCase().includes(filter))
            );
          }
        }

        // Default to first playing session, or first session overall
        if (!target) {
          target = sessions.find(s => s.nowPlaying != null) || sessions[0];
        }

        const params = {};
        if (args.volume != null) params.volume = args.volume;
        if (args.positionSeconds != null) params.positionTicks = args.positionSeconds * 10000000;

        const ctrlRes = await apiFetch('/api/jellyfin/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: target.id,
            command: args.command,
            params
          })
        }, 15000);

        const ctrlData = await ctrlRes.json();
        if (ctrlData.success) {
          const streamInfo = target.nowPlaying ? ` ("${target.nowPlaying.seriesName ? `${target.nowPlaying.seriesName} - ` : ''}${target.nowPlaying.name}")` : '';
          return `Successfully dispatched "${args.command}" command to Jellyfin device "${target.deviceName || target.client}" (${target.userName})${streamInfo}.`;
        }
        return `Failed to send command: ${ctrlData.error || 'Unknown error'}`;
      } catch (err) {
        return `Jellyfin control error: ${err.message}`;
      }
    }
  },

  {
    name: 'jellyfin_search',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'jellyfin_search',
        description: 'Search the local Jellyfin media library for movies, TV shows, and episodes. Use this when the user asks what movies or shows are available on Jellyfin or wants recommendations.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term or title (e.g. "Interstellar", "Star Trek", "Comedy")' },
            limit: { type: 'number', description: 'Maximum number of items to return. Defaults to 10.' }
          },
          required: ['query']
        }
      }
    },
    execute: async (args) => {
      try {
        const res = await apiFetch(`/api/jellyfin/search?q=${encodeURIComponent(args.query)}&limit=${args.limit || 10}`, {}, 15000);
        const data = await res.json();
        const results = data.results || [];
        if (results.length === 0) {
          return `No media found matching "${args.query}" in Jellyfin library.`;
        }
        const lines = results.map(r => `- ${r.name} (${r.type}${r.year ? `, ${r.year}` : ''}${r.series ? ` - ${r.series}` : ''})`);
        return `[JELLYFIN LIBRARY RESULTS for "${args.query}"]:\n${lines.join('\n')}`;
      } catch (err) {
        return `Jellyfin search error: ${err.message}`;
      }
    }
  },

  {
    name: 'jellyfin_refresh',
    requiresConfirmation: true,
    confirmLabel: () => 'Trigger Jellyfin library rescan to index new movies and TV shows?',
    definition: {
      type: 'function',
      function: {
        name: 'jellyfin_refresh',
        description: 'Trigger a Jellyfin media library refresh to scan for newly ripped or added movies and episodes.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async () => {
      try {
        const res = await apiFetch('/api/jellyfin/refresh', { method: 'POST' }, 30000);
        const data = await res.json();
        if (data.success) {
          return 'Successfully initiated Jellyfin library scan.';
        }
        return `Jellyfin library refresh returned: ${JSON.stringify(data)}`;
      } catch (err) {
        return `Jellyfin refresh error: ${err.message}`;
      }
    }
  },

  {
    name: 'jellyfin_manage',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'jellyfin_manage',
        description: 'Manage the local Jellyfin media server lifecycle (start, stop, restart, or diagnose errors and port conflicts). Use when the user asks to start/restart Jellyfin or check why it is offline.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              description: 'Action to perform: start, restart, stop, or diagnose',
              enum: ['start', 'restart', 'stop', 'diagnose']
            }
          },
          required: ['action']
        }
      }
    },
    execute: async (args) => {
      try {
        const action = args.action || 'diagnose';
        if (action === 'diagnose') {
          const res = await apiFetch('/api/jellyfin/diagnostics', {}, 30000);
          const data = await res.json();
          if (data.success && data.report) {
            const r = data.report;
            return `[JELLYFIN DIAGNOSTIC REPORT]\nStatus: ${r.healthy ? 'HEALTHY' : 'OFFLINE'}\nSummary: ${r.summary}\n${r.suggestedFix ? `Suggested Fix: ${r.suggestedFix}\n` : ''}${r.recentErrors && r.recentErrors.length > 0 ? `Recent Log Errors:\n${r.recentErrors.join('\n')}` : ''}`;
          }
          return `Diagnostic returned: ${JSON.stringify(data)}`;
        }

        const endpoint = `http://localhost:7890/api/jellyfin/${action}`;
        const res = await fetchWithTimeout(endpoint, { method: 'POST' }, 30000);
        const data = await res.json();
        if (data.success) {
          return `Successfully dispatched "${action}" command for Jellyfin media server.`;
        }
        return `Failed to execute ${action}: ${data.error || JSON.stringify(data)}`;
      } catch (err) {
        return `Jellyfin management error: ${err.message}`;
      }
    }
  },

  {
    name: 'arr_search_media',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'arr_search_media',
        description: 'Search for movies and TV series across Radarr and Sonarr to check metadata, release status, or whether they are already in the library.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Movie or TV series title to search for (e.g. "Severance", "Dune Part Two")' },
            type: { type: 'string', enum: ['all', 'movie', 'series'], description: 'Media type to search for. Defaults to "all".' }
          },
          required: ['query']
        }
      }
    },
    execute: async (args) => {
      try {
        const type = args.type || 'all';
        const res = await apiFetch(`/api/arr/search?q=${encodeURIComponent(args.query)}&type=${type}`, {}, 15000);
        const data = await res.json();
        if (!data.success) {
          return `Error searching Radarr/Sonarr: ${data.error || 'Unknown error'}`;
        }
        const lines = [];
        if (data.movies && data.movies.length > 0) {
          lines.push('--- Movies (Radarr) ---');
          for (const m of data.movies.slice(0, 5)) {
            lines.push(`• ${m.title} (${m.year || 'N/A'}) [TMDb: ${m.tmdbId}] - ${m.inLibrary ? '✓ In Library' : 'Not in Library'}${m.monitored ? ' (Monitored)' : ''}`);
          }
        }
        if (data.series && data.series.length > 0) {
          lines.push('--- TV Series (Sonarr) ---');
          for (const s of data.series.slice(0, 5)) {
            lines.push(`• ${s.title} (${s.year || 'N/A'}) [TVDb: ${s.tvdbId}] - ${s.inLibrary ? '✓ In Library' : 'Not in Library'} (${s.seasonCount} seasons)`);
          }
        }
        if (lines.length === 0) {
          return `No media found matching "${args.query}" in Radarr or Sonarr lookup.`;
        }
        return `[RADARR / SONARR LOOKUP RESULTS for "${args.query}"]:\n${lines.join('\n')}`;
      } catch (err) {
        return `Arr search error: ${err.message}`;
      }
    }
  },

  {
    name: 'arr_add_media',
    requiresConfirmation: true,
    confirmLabel: (args) => `Add and monitor ${args.type === 'series' ? 'TV series' : 'movie'} "${args.title}" in ${args.type === 'series' ? 'Sonarr' : 'Radarr'} and start automated download search?`,
    definition: {
      type: 'function',
      function: {
        name: 'arr_add_media',
        description: 'Add a new movie to Radarr or TV series to Sonarr to monitor and trigger an automatic search/download.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the movie or series' },
            type: { type: 'string', enum: ['movie', 'series'], description: 'Whether this is a movie (Radarr) or series (Sonarr)' },
            tmdbId: { type: 'number', description: 'TMDb ID (for movies)' },
            tvdbId: { type: 'number', description: 'TVDb ID (for TV series)' },
            searchNow: { type: 'boolean', description: 'Whether to immediately trigger download search. Defaults to true.' }
          },
          required: ['title', 'type']
        }
      }
    },
    execute: async (args) => {
      try {
        const isSeries = args.type === 'series';
        const endpoint = isSeries ? '/api/arr/series' : '/api/arr/movie';
        const payload = isSeries
          ? { title: args.title, tvdbId: args.tvdbId, searchForMissingEpisodes: args.searchNow !== false }
          : { title: args.title, tmdbId: args.tmdbId, searchForMovie: args.searchNow !== false };

        const res = await apiFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }, 30000);
        const data = await res.json();
        if (data.success || data.statusCode === 201 || data.id) {
          return `Successfully added "${args.title}" to ${isSeries ? 'Sonarr (TV)' : 'Radarr (Movies)'}. Monitoring and search initiated.`;
        }
        return `Failed to add ${args.title}: ${data.error || JSON.stringify(data)}`;
      } catch (err) {
        return `Arr add error: ${err.message}`;
      }
    }
  },

  {
    name: 'arr_queue_status',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'arr_queue_status',
        description: 'Check active downloading queue and progress across Radarr (Movies) and Sonarr (TV shows), or upcoming release calendar.',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['queue', 'calendar'], description: 'Whether to inspect active download queue or upcoming release calendar. Defaults to queue.' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      try {
        const mode = args.mode || 'queue';
        if (mode === 'calendar') {
          const res = await apiFetch('/api/arr/calendar?days=14', {}, 15000);
          const data = await res.json();
          if (!data.success || !data.events || data.events.length === 0) {
            return 'No upcoming movie releases or TV airings found in the next 14 days.';
          }
          const lines = data.events.slice(0, 10).map(e => {
            const date = (e.airDateUtc || e.releaseDate || '').split('T')[0];
            if (e.type === 'episode') return `• [${date}] ${e.seriesTitle} - S${String(e.seasonNumber).padStart(2,'0')}E${String(e.episodeNumber).padStart(2,'0')} "${e.episodeTitle}"`;
            return `• [${date}] Movie: ${e.title}`;
          });
          return `[UPCOMING MEDIA CALENDAR]:\n${lines.join('\n')}`;
        }

        const res = await apiFetch('/api/arr/queue', {}, 15000);
        const data = await res.json();
        if (!data.success || !data.queue || data.queue.length === 0) {
          return 'No active downloads currently in Radarr or Sonarr queue.';
        }
        const lines = data.queue.map(q => {
          const progress = q.size > 0 ? `${Math.round(((q.size - q.sizeleft) / q.size) * 100)}%` : '0%';
          const time = q.timeleft ? ` (${q.timeleft} left)` : '';
          return `• [${q.service.toUpperCase()}] ${q.title} - ${progress}${time} via ${q.downloadClient} [Status: ${q.status}]`;
        });
        return `[ACTIVE DOWNLOAD QUEUE (${data.total} items)]:\n${lines.join('\n')}`;
      } catch (err) {
        return `Arr queue error: ${err.message}`;
      }
    }
  },

  {
    name: 'arr_stack_status',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'arr_stack_status',
        description: 'Check whether Prowlarr, Radarr, Sonarr, Lidarr, SABnzbd, and RetroArr (the Media Stack) are online or offline. Use this when the user asks if the media stack, or a specific service like Sonarr or Lidarr, is up/down/offline before deciding whether to restart it.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async () => {
      try {
        const res = await apiFetch('/api/arr/status', {}, 15000);
        const data = await res.json();
        if (!data.success || !data.status) {
          return `Could not retrieve Media Stack status: ${data.error || JSON.stringify(data)}`;
        }
        const lines = Object.entries(data.status).map(([key, s]) => {
          const label = s.online ? 'ONLINE' : 'OFFLINE';
          const extra = s.online ? (s.version ? ` (v${s.version})` : '') : ` — ${s.error || 'not reachable'}`;
          return `• ${s.appName || key}: ${label}${extra}`;
        });
        return `[MEDIA STACK STATUS]:\n${lines.join('\n')}`;
      } catch (err) {
        return `Arr status error: ${err.message}`;
      }
    }
  },

  {
    name: 'arr_stack_control',
    requiresConfirmation: true,
    confirmLabel: (args) => {
      const action = args.action || 'restart';
      const scope = !args.service || args.service === 'all' ? 'the entire Media Stack' : args.service;
      return `${action.charAt(0).toUpperCase()}${action.slice(1)} ${scope}?`;
    },
    definition: {
      type: 'function',
      function: {
        name: 'arr_stack_control',
        description: 'Start, stop, or restart the Media Stack — either a single service (Prowlarr, Radarr, Sonarr, Lidarr, SABnzbd, RetroArr) or the whole stack at once. Use this when the user asks to bring an offline service back up or restart something in the media stack. Check arr_stack_status first when you need to know which services are actually down.',
        parameters: {
          type: 'object',
          properties: {
            service: { type: 'string', enum: ['all', 'prowlarr', 'radarr', 'sonarr', 'lidarr', 'sabnzbd', 'retroarr'], description: 'Which service to act on, or "all" for the whole stack. Defaults to "all".' },
            action: { type: 'string', enum: ['start', 'stop', 'restart'], description: 'What to do to it. Defaults to "restart".' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      try {
        const service = args.service || 'all';
        const action = args.action || 'restart';
        const endpoint = service === 'all' ? `/api/arr/stack/${action}` : `/api/arr/service/${service}/${action}`;
        const res = await apiFetch(endpoint, { method: 'POST' }, 30000);
        const data = await res.json();
        if (data.success === false) {
          return `Failed to ${action} ${service === 'all' ? 'Media Stack' : service}: ${data.error || JSON.stringify(data)}`;
        }
        return `${action.charAt(0).toUpperCase()}${action.slice(1)} dispatched for ${service === 'all' ? 'the entire Media Stack' : service}. Give it a few seconds, then use arr_stack_status to confirm it came back online.`;
      } catch (err) {
        return `Arr control error: ${err.message}`;
      }
    }
  },

  {
    name: 'add_reminder',
    requiresConfirmation: true,
    confirmLabel: (args) => `Add reminder: "${args.text}"${args.due_at ? ` due ${new Date(args.due_at).toLocaleString()}` : ''}?`,
    definition: {
      type: 'function',
      function: {
        name: 'add_reminder',
        description: 'Add a reminder or task for the user, to be surfaced later (and via a desktop notification if it has a due time). Use this when the user asks to be reminded of something or wants to track a task/to-do.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'What to remind the user about' },
            due_at: { type: 'string', description: 'ISO 8601 datetime this is due, e.g. 2026-07-30T17:00:00. Omit for an undated task.' }
          },
          required: ['text']
        }
      }
    },
    execute: async (args, ctx) => {
      ctx.onAddReminder(args.text, args.due_at || null);
      return JSON.stringify({ success: true, text: args.text, due_at: args.due_at || null });
    }
  },

  {
    name: 'complete_reminder',
    requiresConfirmation: true,
    confirmLabel: (args) => `Mark reminder matching "${args.text_match}" as done?`,
    definition: {
      type: 'function',
      function: {
        name: 'complete_reminder',
        description: 'Mark a pending reminder/task as completed.',
        parameters: {
          type: 'object',
          properties: {
            text_match: { type: 'string', description: 'Text (or partial text) identifying which pending reminder to complete' }
          },
          required: ['text_match']
        }
      }
    },
    execute: async (args, ctx) => {
      const success = ctx.onCompleteReminder(args.text_match);
      return JSON.stringify({ success });
    }
  },

  {
    name: 'log_workout',
    requiresConfirmation: true,
    confirmLabel: (args) => `Log workout: ${(args.exercises || []).map((e) => e.name).join(', ')}?`,
    definition: {
      type: 'function',
      function: {
        name: 'log_workout',
        description: 'Log a completed workout session — one or more exercises with sets/reps/weight. Use this when the user says they just worked out or wants to record a training session.',
        parameters: {
          type: 'object',
          properties: {
            exercises: {
              type: 'array',
              description: 'Exercises performed in this session',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Exercise name, e.g. "Bench Press"' },
                  sets: { type: 'number', description: 'Number of sets' },
                  reps: { type: 'number', description: 'Reps per set' },
                  weight: { type: 'number', description: 'Weight used (in whatever unit the user stated)' }
                },
                required: ['name']
              }
            },
            notes: { type: 'string', description: 'Optional free-text notes about the session' }
          },
          required: ['exercises']
        }
      }
    },
    execute: async (args, ctx) => {
      ctx.onAddWorkout(args.exercises, args.notes);
      return JSON.stringify({ success: true, exercises: args.exercises });
    }
  },

  {
    name: 'get_workout_history',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_workout_history',
        description: 'Get the user\'s recent logged workout history, including the current daily workout streak.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      const workouts = ctx.onGetWorkoutHistory ? ctx.onGetWorkoutHistory() : [];
      return JSON.stringify({
        streak: calculateWorkoutStreak(workouts),
        history: formatWorkoutHistoryContext(workouts)
      });
    }
  },

  {
    name: 'create_obsidian_note',
    requiresConfirmation: true,
    confirmLabel: (args) => `Create Obsidian note "${args.title}"?`,
    definition: {
      type: 'function',
      function: {
        name: 'create_obsidian_note',
        description: "Create a new note in the user's Obsidian vault — use this only when the user explicitly asks to save, note down, or remember something in Obsidian.",
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Note title (used as the filename, without .md)' },
            content: { type: 'string', description: 'Markdown content of the note' }
          },
          required: ['title', 'content']
        }
      }
    },
    execute: async (args, ctx) => {
      const result = await ctx.onCreateNote(args.title, args.content);
      return JSON.stringify(result);
    }
  },

  {
    name: 'control_smart_home_device',
    // Risk-tiered confirmation (added 2026-08-18): low-risk, trivially
    // reversible actions (turning a light/switch/fan on or off, activating a
    // scene, basic media transport) run WITHOUT a confirmation prompt so a
    // spoken "turn off the office light" actually just happens — a
    // confirmation dialog is unusable hands-free, and re-issuing the
    // opposite command is a complete undo.
    //
    // Everything NOT on this allowlist still prompts — locks, covers/garage,
    // alarm panels, climate setpoints, and any script/automation the model
    // might invent a call for. Two reasons this stays strict:
    //   1. The chat tool path calls ctx.onExecuteHAService directly and does
    //      NOT run securityGuard.validateSmartHomeAction (that guard is on
    //      the direct /api/smarthome/execute route), so for an LLM-chosen
    //      lock action this prompt is the ONLY gate standing in front of it.
    //   2. These are the actions where a wrong entity_id is expensive
    //      (unlocking the wrong door) rather than merely annoying.
    // Allowlist, not denylist, so a domain nobody thought about defaults to
    // "ask" instead of silently executing.
    requiresConfirmation: (args) => !isLowRiskHaAction(args),
    confirmLabel: (args) => `Run Home Assistant action ${args?.domain}.${args?.service} on "${args?.entity_id}"?`,
    definition: {
      type: 'function',
      function: {
        name: 'control_smart_home_device',
        description: 'Control a Home Assistant device (lights, switches, locks, etc.) by calling a domain.service on a specific entity. The entity_id MUST be copied exactly from the live Smart Home status or a list_home_assistant_entities/get_dashboard_config result — never guess or shorten one (e.g. "light.kitchen" does not exist; the real id is longer, like "light.kitchen_main_lights").',
        parameters: {
          type: 'object',
          properties: {
            domain: { type: 'string', description: 'Home Assistant domain, e.g. light, switch, lock' },
            service: { type: 'string', description: 'Service to call, e.g. turn_on, turn_off, lock, unlock' },
            entity_id: { type: 'string', description: 'The exact entity_id as it appears in live Home Assistant data — do not abbreviate or invent one.' }
          },
          required: ['domain', 'service', 'entity_id']
        }
      }
    },
    execute: async (args, ctx) => {
      // HA's service-call endpoint returns HTTP 200 even when entity_id
      // matches nothing — confirmed live 2026-08-03: a guessed entity_id
      // ("light.kitchen" instead of the real "light.kitchen_main_lights")
      // came back {success:true} and the model confidently reported the
      // light was on, while nothing had actually happened. Validate against
      // the live entity list BEFORE calling the service so a bad entity_id
      // surfaces as a clear error instead of a false success.
      const allEntities = Object.values(ctx.haCategories || {}).flat();
      const known = allEntities.some((e) => e.entity_id === args.entity_id);
      if (!known) {
        const domainMatches = allEntities.filter((e) => e.entity_id.startsWith(`${args.domain}.`)).map((e) => e.entity_id);
        return JSON.stringify({
          success: false,
          error: `"${args.entity_id}" is not a real entity — nothing was changed. Use the exact entity_id from live data instead of guessing.`,
          didYouMean: domainMatches.slice(0, 20)
        });
      }
      const success = await ctx.onExecuteHAService(args.domain, args.service, args.entity_id);
      return JSON.stringify({ success });
    }
  },

  {
    name: 'research_topic',
    // Read-only — calls Claude with web search enabled and returns a draft
    // summary + sources into the chat. Nothing is saved yet; see
    // save_researched_knowledge below for the confirmed write, kept as a
    // SEPARATE tool specifically so this one never needs confirmation gating
    // (added 2026-08-04, see the daily-check-in/PIN-lock discussion this
    // session for why silent auto-commit into a bank injected into every
    // future prompt is the wrong default).
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'research_topic',
        description: "Research a topic using real web search (via Claude) and return a sourced draft summary. Use this when the user explicitly asks Aloy to research, look into, or learn about something it doesn't already know. This does NOT save anything — present the draft to the user and only call save_researched_knowledge if they confirm they want it kept.",
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'The topic or question to research, as specific as possible' }
          },
          required: ['topic']
        }
      }
    },
    execute: async (args, ctx) => {
      try {
        const result = await ctx.onResearchTopic(args.topic);
        return JSON.stringify({ success: true, ...result });
      } catch (err) {
        return JSON.stringify({ success: false, error: err.message });
      }
    }
  },

  {
    name: 'save_researched_knowledge',
    requiresConfirmation: true,
    confirmLabel: (args) => `Save researched knowledge on "${args.topic}" to Aloy's permanent knowledge base?`,
    definition: {
      type: 'function',
      function: {
        name: 'save_researched_knowledge',
        description: 'Save a previously researched (via research_topic) summary as a permanent knowledge entry. Only call this after research_topic returned a draft AND the user explicitly confirmed they want it saved — never call this on its own.',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'The topic, matching what was researched' },
            summary: { type: 'string', description: 'The summary text to save, from the research_topic result' },
            sources: {
              type: 'array',
              description: 'The sources list from the research_topic result',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' }
                }
              }
            }
          },
          required: ['topic', 'summary']
        }
      }
    },
    execute: async (args, ctx) => {
      const entry = {
        id: `knowledge-${Date.now()}`,
        topic: args.topic,
        summary: args.summary,
        sources: args.sources || [],
        savedAt: new Date().toISOString()
      };
      await ctx.onSaveLearnedKnowledge(entry);
      return JSON.stringify({ success: true });
    }
  },

  {
    name: 'save_lesson',
    requiresConfirmation: true,
    confirmLabel: (args) => `Remember this correction: "${args.topic}"?`,
    // Distinct from save_researched_knowledge: this is for when the USER
    // directly corrects Aloy or states a fact it should treat as maximum-
    // trust going forward (e.g. "no, actually my NVENC quality is 22, not
    // 20 — remember that"), not something Aloy looked up itself. Lessons
    // always override conflicting auto-researched knowledge on the same
    // topic — see runNightlyAutoTeaching's conflict check in
    // skillsDashboard.cjs.
    definition: {
      type: 'function',
      function: {
        name: 'save_lesson',
        description: "Save an explicit correction or fact the user directly told you to remember, prioritized above anything auto-researched. Call this when the user corrects something you said wrong, or explicitly says to remember/note a fact — always confirm with them first (this tool itself requires confirmation, so just call it once they've made the correction clear).",
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Short topic label for the correction, e.g. "NVENC H.265 quality setting"' },
            correction: { type: 'string', description: 'The corrected fact, in the user\'s own terms as closely as possible' }
          },
          required: ['topic', 'correction']
        }
      }
    },
    execute: async (args, ctx) => {
      const entry = {
        id: `lesson-${Date.now()}`,
        topic: args.topic,
        correction: args.correction,
        createdAt: new Date().toISOString()
      };
      await ctx.onSaveLesson(entry);
      return JSON.stringify({ success: true });
    }
  },

  {
    name: 'save_user_memory',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'save_user_memory',
        description: "Save a permanent personal fact, habit, preference, routine, workflow, or detail about the user that you learned during conversation. Call this WHENEVER the user mentions a preference (food/drink, work style, schedule, tools, likes/dislikes), answers questions about themselves, or tells you something personal so you remember it forever across all future sessions. NEVER call this with a document's contents, a Q&A transcript, or a research answer — those go through save_researched_knowledge (for looked-up info) or get referenced directly from the conversation, not copied here verbatim. A fact belongs here only if you could write it fresh, from memory, in one sentence without quoting anything.",
        parameters: {
          type: 'object',
          properties: {
            fact: {
              type: 'string',
              description: 'One short, self-written sentence about the user in third-person, under 200 characters — e.g. "User prefers dark mode and minimal UI layouts", "User works late at night", "User likes black coffee in the morning". Never a pasted document excerpt, quoted answer, or transcript.'
            },
            category: {
              type: 'string',
              enum: ['preference', 'habit', 'work_style', 'tooling', 'schedule', 'personal', 'project'],
              description: 'Category of the learned personal memory.'
            }
          },
          required: ['fact']
        }
      }
    },
    execute: async (args, ctx) => {
      const fact = (args.fact || '').trim();
      if (!fact) return 'No fact provided.';
      // Hard backstop, not just prompt guidance: this tool has no
      // confirmation gate (requiresConfirmation: false), so a model that
      // ignores the description's "one short sentence" instruction can
      // silently pollute the user's permanent memory bank with pasted document
      // contents or full Q&A transcripts — this actually happened (a resume
      // and several research answers got saved verbatim, thousands of
      // characters each, mixed in with real facts). Reject rather than
      // truncate, so the caller gets a clear signal instead of a silently
      // mangled half-fact.
      const FACT_MAX_LENGTH = 200;
      if (fact.length > FACT_MAX_LENGTH) {
        return JSON.stringify({
          success: false,
          error: `Fact too long (${fact.length} chars, max ${FACT_MAX_LENGTH}). This tool is for one short self-written sentence about the user, not a pasted document, quoted answer, or transcript — use save_researched_knowledge for looked-up information, or just answer directly without saving.`
        });
      }
      if (ctx.onAddMemory) {
        ctx.onAddMemory(fact);
      }
      return JSON.stringify({ success: true, savedMemory: fact, status: 'Added to User\'s Persistent Memory Bank.' });
    }
  },

  {
    name: 'update_user_profile',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'update_user_profile',
        description: "Update the user's core profile settings (such as preferred AI communication style or personal guidelines) when instructed how they want you to speak, format answers, or act.",
        parameters: {
          type: 'object',
          properties: {
            style: {
              type: 'string',
              description: 'Updated communication style, e.g. "Concise, direct, highly technical, bulleted format."'
            },
            instructions: {
              type: 'string',
              description: 'Updated personal instructions or guidelines for Aloy.'
            }
          },
          required: []
        }
      }
    },
    execute: async (args, ctx) => {
      const patch = {};
      if (args.style) patch.style = args.style.trim();
      if (args.instructions) patch.instructions = args.instructions.trim();
      if (Object.keys(patch).length === 0) return 'No profile changes provided.';
      if (ctx.onSaveProfile) {
        ctx.onSaveProfile(patch);
      }
      return JSON.stringify({ success: true, updatedFields: patch, status: 'User profile updated successfully.' });
    }
  },

  {
    name: 'get_skills_dashboard',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_skills_dashboard',
        description: "Get Aloy's own skills dashboard — a self-assessment of which topic categories it has open gaps in (questions that needed Claude's help) vs. confirmed/reinforced knowledge, plus overall proficiency. Call with no category first for the overview, then call again with a specific category name (exactly as listed in the overview) for that category's actual gap questions and confirmed topics. Use this when the user asks Aloy about its own skill gaps, proficiency, what it's weak at, or what needs review — this reflects real logged data, don't guess.",
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string', description: "Optional. A category name from the overview (e.g. 'Smart Home & Automations', 'Dashboards & Lovelace') to see its specific gap questions and confirmed topics. Omit for the overview." }
          },
          required: []
        }
      }
    },
    execute: async (args, ctx) => {
      const dashboard = await ctx.onGetSkillsDashboard();
      if (!dashboard) return 'Could not load the skills dashboard right now.';

      if (!args.category) {
        const lines = dashboard.categories.map((c) =>
          `- ${c.name}: ${c.proficiencyScore}% (${c.proficiencyLabel}) — ${c.confirmedCount} confirmed, ${c.gapCount} open gap(s)${c.needsReviewCount ? `, ${c.needsReviewCount} needing review` : ''}`
        );
        return [
          `Overall proficiency: ${dashboard.overallProficiencyScore}%${dashboard.needsReviewCount ? ` (${dashboard.needsReviewCount} item(s) awaiting review)` : ''}`,
          dashboard.lastAutoTeachingRun ? `Last auto-teaching run: ${dashboard.lastAutoTeachingRun}` : 'No auto-teaching run has completed yet.',
          '',
          'By category:',
          ...lines,
          '',
          'Call again with a category name for its specific gap questions and confirmed topics.'
        ].join('\n');
      }

      const cat = dashboard.categories.find((c) => c.name.toLowerCase() === args.category.toLowerCase());
      if (!cat) return `No category matching "${args.category}". Valid categories: ${dashboard.categories.map((c) => c.name).join(', ')}.`;

      // Relabel teachingStatus for display — the raw value 'error' trips the
      // app's generic tool-result error-sniffing heuristic (formatToolResultContent
      // in aloyServer.cjs / its App.jsx equivalent, regex /\b(error|failed|exception)\b/i
      // over the WHOLE result string), which wrongly appended a "tool encountered
      // an issue, self-correct" system hint to this tool's perfectly valid output
      // during live verification — confirmed via a real /api/chat call. Avoid the
      // trigger words entirely rather than fixing the shared heuristic, since that
      // heuristic is relied on by every other tool in this file.
      const gapStatusLabel = { error: 'auto-teaching issue', needs_review: 'needs review', pending: 'pending' };
      const gapLines = cat.recentGaps.length
        ? cat.recentGaps.map((g) => `- [${gapStatusLabel[g.teachingStatus] || g.teachingStatus}] ${g.question}`).join('\n')
        : '(none)';
      const confirmedLines = cat.recentConfirmed.length
        ? cat.recentConfirmed.map((k) => `- ${k.topic}${k.autoGenerated ? ' (auto-researched)' : ''}`).join('\n')
        : '(none)';
      return `${cat.name}: ${cat.proficiencyScore}% (${cat.proficiencyLabel})\n\nOpen gaps:\n${gapLines}\n\nConfirmed knowledge:\n${confirmedLines}`;
    }
  },

  {
    name: 'get_autorip_status',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_autorip_status',
        description: 'Get live status, recent completed disc rips/encodes, and encoder settings of AutoRipManager (the automated DVD/Blu-ray ripping pipeline). Use this specifically when the user asks about disc ripping progress or encoder jobs. To list or count movies on drive P:, use mcp__filesystem__list_directory with path "P:\\Movies".',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      if (ctx.onGetAutoRipStatus) {
        return await ctx.onGetAutoRipStatus();
      }
      return 'AutoRip status is not available in this context.';
    }
  },

  {
    name: 'audit_media_library',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'audit_media_library',
        description: 'Audit media files and directories in P:\\TV Shows and P:\\Movies for Plex/Jellyfin naming convention compliance, missing release years, non-standard season/episode folders, tracker junk, or filesystem errors. Use this when the user asks to check or verify if media files are formatted correctly.',
        parameters: {
          type: 'object',
          properties: {
            tv_path: { type: 'string', description: 'Optional custom path for TV Shows library (defaults to P:\\TV Shows)' },
            movies_path: { type: 'string', description: 'Optional custom path for Movies library (defaults to P:\\Movies)' }
          },
          required: []
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx.onAuditMediaLibrary) {
        const report = await ctx.onAuditMediaLibrary(args || {});
        return typeof report === 'string' ? report : JSON.stringify(report, null, 2);
      }
      return 'Media library audit is not available in this context.';
    }
  },

  {
    name: 'format_media_library',
    requiresConfirmation: true,
    confirmLabel: (args) => `Format and standardize media library files in "${args.target || 'all'}" on drive P:?`,
    definition: {
      type: 'function',
      function: {
        name: 'format_media_library',
        description: 'Standardize and format TV show and Movie files on drive P: (removes tracker junk, standardizes season/episode naming to SxxExx, cleans scene release tags, and normalizes movie folders and files to Plex standards).',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', enum: ['all', 'tv', 'movies'], description: 'Which media library to format (defaults to "all")' },
            dry_run: { type: 'boolean', description: 'If true, performs a preview without renaming or deleting files (defaults to false)' },
            tv_path: { type: 'string', description: 'Optional custom path for TV Shows library (defaults to P:\\TV Shows)' },
            movies_path: { type: 'string', description: 'Optional custom path for Movies library (defaults to P:\\Movies)' }
          },
          required: []
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx.onFormatMediaLibrary) {
        const result = await ctx.onFormatMediaLibrary(args || {});
        return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      }
      return 'Media library formatting is not available in this context.';
    }
  },

  {
    name: 'get_tech_news',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_tech_news',
        description: 'Get the current relevance-filtered Tech News feed — articles and YouTube videos scraped from the user\'s configured sources (server/newsScraper.cjs), already filtered against their stated interests. Use this when the user asks about tech news, a specific headline, or a video they saw in the feed. Do not guess at feed contents — call this first.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    // Formatted here (not in the ctx handler) so desktop and mobile share
    // one formatting pass — both platforms' onGetTechNews just returns the
    // same raw relevant-articles array, same shape store.cjs already keeps.
    execute: async (_args, ctx) => {
      const articles = (ctx.onGetTechNews ? await ctx.onGetTechNews() : null) || [];
      if (articles.length === 0) {
        return 'No relevant tech news right now — either no sources are configured yet, or nothing has scored as relevant against the current interest profile.';
      }
      return articles.slice(0, 20).map((a) => (
        `- [${a.sourceType === 'youtube' ? 'Video' : 'Article'}] "${a.title}" (${a.sourceName})${a.relevanceReason ? ` — ${a.relevanceReason}` : ''} — ${a.url}`
      )).join('\n');
    }
  },

  // Self-modification (Tier 2 — propose, human applies): these only touch
  // this app's own src/ tree, scoped and path-validated on the main-process
  // side (electron.cjs), and only work when running the dev build. Reading
  // is unrestricted (requiresConfirmation: false) like every other read-only
  // tool here; writing always requires confirmation, same as every other
  // write tool — the fact that the request itself is model-generated
  // content is exactly the case this app's confirmation gate exists for.
  {
    name: 'read_own_ui_source',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'read_own_ui_source',
        description: "Read the current content of one of your own UI source files, path relative to this app's src/ folder (e.g. 'components/Sidebar.jsx'). Always call this before propose_ui_change so the change is based on the real current code, not a guess. Only works when the desktop app is running in dev mode (npm run dev) — if it fails, tell the user this feature needs the dev build running.",
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: "Path relative to src/, e.g. 'components/Sidebar.jsx'" }
          },
          required: ['file_path']
        }
      }
    },
    execute: async (args, ctx) => {
      return await ctx.onReadOwnUiSource(args.file_path);
    }
  },

  {
    name: 'propose_ui_change',
    requiresConfirmation: true,
    confirmLabel: (args) => `Change src/${args.file_path}? (${args.reason || 'no reason given'})`,
    definition: {
      type: 'function',
      function: {
        name: 'propose_ui_change',
        description: "Propose a small, targeted change to your own UI source code — e.g. when the user asks you to tweak your own appearance or layout. Give the EXACT current text to find (old_string, copied verbatim from read_own_ui_source's output — it must match only once in the file) and its replacement (new_string). This does NOT go live automatically: it only writes the source file, stays inert until the app is rebuilt and reinstalled, and the previous version is backed up. Only propose focused, minimal changes — never rewrite a whole file. Only works when the desktop app is running in dev mode.",
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: "Path relative to src/, e.g. 'components/Sidebar.jsx'" },
            old_string: { type: 'string', description: 'Exact current text to replace, verbatim, matching only one location in the file' },
            new_string: { type: 'string', description: 'The replacement text' },
            reason: { type: 'string', description: 'One-sentence description of what changed and why' }
          },
          required: ['file_path', 'old_string', 'new_string', 'reason']
        }
      }
    },
    execute: async (args, ctx) => {
      const result = await ctx.onProposeUiChange({
        filePath: args.file_path,
        oldString: args.old_string,
        newString: args.new_string,
        reason: args.reason
      });
      return JSON.stringify(result);
    }
  },

  {
    name: 'suggest_ui_change',
    requiresConfirmation: false,
    // No confirmation gate, unlike propose_ui_change — this only appends a
    // note to the Dev Workspace backlog (src/App.jsx's onSuggestUiChange),
    // it never touches a source file, so there's nothing destructive to
    // approve. Turning a suggestion into a real change still requires the
    // full read_own_ui_source -> propose_ui_change -> confirm flow later.
    definition: {
      type: 'function',
      function: {
        name: 'suggest_ui_change',
        description: "Log an idea for a future UI change to the Dev Workspace backlog, WITHOUT making any change yet. Use this when the user asks you to note/remember/suggest a UI idea for later. You may also use it — sparingly — if you notice real friction with your own UI during a conversation (e.g. the user seems confused by something), but don't use it as a substitute for propose_ui_change when the user wants something changed right now.",
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short title for the idea' },
            description: { type: 'string', description: 'What should change and why' },
            target_file: { type: 'string', description: "Optional, path relative to src/ if known, e.g. 'components/Sidebar.jsx'" }
          },
          required: ['title', 'description']
        }
      }
    },
    execute: async (args, ctx) => {
      const result = await ctx.onSuggestUiChange({
        title: args.title,
        description: args.description,
        targetFile: args.target_file,
        source: 'aloy'
      });
      return JSON.stringify(result);
    }
  },

  {
    name: 'search_cli_tools',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'search_cli_tools',
        description: 'Search the CLI-Anything / CLI-Hub ecosystem for available agent-native CLI tools (e.g. "obsidian", "calibre", "video", "gimp", "mesh", "audio", "n8n"). Use this when the user asks for a capability outside your built-in tools.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term, keyword, or category to look up in the CLI-Hub registry' }
          },
          required: ['query']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx.onSearchCliTools) {
        return JSON.stringify(await ctx.onSearchCliTools(args.query));
      }
      return JSON.stringify({ status: 'error', message: 'CLI-Hub search is not available in this context.' });
    }
  },

  {
    name: 'get_cli_tool_info',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_cli_tool_info',
        description: 'Get detailed metadata, requirements, and skill documentation for a specific CLI-Anything tool from the CLI-Hub registry.',
        parameters: {
          type: 'object',
          properties: {
            tool_name: { type: 'string', description: 'Name of the CLI tool to inspect (e.g. "obsidian", "calibre", "gimp")' }
          },
          required: ['tool_name']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx.onGetCliToolInfo) {
        return JSON.stringify(await ctx.onGetCliToolInfo(args.tool_name));
      }
      return JSON.stringify({ status: 'error', message: 'CLI-Hub info is not available in this context.' });
    }
  },

  {
    name: 'run_cli_tool',
    requiresConfirmation: true,
    confirmLabel: (args) => `Run CLI-Anything tool "${args.tool_name}" with arguments: ${(args.args || []).join(' ')}?`,
    definition: {
      type: 'function',
      function: {
        name: 'run_cli_tool',
        description: 'Execute an installed CLI-Anything harness or tool from the CLI-Hub ecosystem with structured JSON output.',
        parameters: {
          type: 'object',
          properties: {
            tool_name: { type: 'string', description: 'Name of the CLI tool to run (e.g. "obsidian", "calibre")' },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Command line arguments/flags to pass to the CLI tool'
            }
          },
          required: ['tool_name']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx.onRunCliTool) {
        return JSON.stringify(await ctx.onRunCliTool(args.tool_name, args.args || []));
      }
      return JSON.stringify({ status: 'error', message: 'CLI-Hub runner is not available in this context.' });
    }
  },

  {
    name: 'search_knowledge_graph',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'search_knowledge_graph',
        description: "Search Aloy's unified knowledge graph — a BM25-ranked index over live Home Assistant entities plus stored personal memories and auto-researched learned knowledge, with connected-entity context (e.g. which category a device belongs to). Use this for broad/fuzzy lookups spanning multiple data sources at once (\"what do I know about the office\", \"anything related to the garage\") rather than a single-domain question that has its own dedicated tool.",
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search terms — entity names, topics, rooms, categories, etc.' }
          },
          required: ['query']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx.onSearchKnowledgeGraph) {
        return await ctx.onSearchKnowledgeGraph(args.query);
      }
      return 'Knowledge graph search is not available in this context.';
    }
  },

  {
    name: 'look_at_webcam',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'look_at_webcam',
        description: "Take a live snapshot from the user's own desk webcam right now and answer a specific question about what's in view — e.g. \"what am I holding\", \"what does my desk look like\", \"am I wearing headphones\". This is a live, on-demand look, not the passive ambient-commentary loop or the separate get_llm_vision_activity tool (which covers the house's Home Assistant cameras, not this PC's webcam). Only call this when the user is actually asking you to look at something right now — desktop app only.",
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: "What to look for / answer about, in the user's own words" }
          },
          required: ['question']
        }
      }
    },
    execute: async (args) => {
      const result = await answerVisualQuestion(args.question);
      if (!result) {
        return "Couldn't access the webcam right now — it may be in use by another app, or this isn't the desktop app.";
      }
      return result.text || "I looked, but couldn't come up with a clear answer.";
    }
  },

  {
    name: 'forge_create_task',
    requiresConfirmation: true,
    confirmLabel: (args) => `Dispatch coding task "${args.title}" to HEPHAESTUS (Heph) in isolated Cauldron staging?`,
    definition: {
      type: 'function',
      function: {
        name: 'forge_create_task',
        description: "Delegate a software engineering, coding, tool creation, bugfix, or refactoring task to HEPHAESTUS (Heph), Aloy's dedicated AI coding sub-agent. Hephaestus will work inside an isolated sandbox, execute syntax and unit tests, and prepare a verified diff for review without risking Aloy's runtime.",
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Concise title of the engineering task' },
            description: { type: 'string', description: 'Detailed technical specification and goals for Hephaestus' },
            category: { type: 'string', enum: ['feature', 'bugfix', 'refactor', 'mcp_tool', 'ui'], description: 'Category of engineering work' },
            target_files: { type: 'array', items: { type: 'string' }, description: 'List of target file paths to modify or create' },
            requirements: { type: 'array', items: { type: 'string' }, description: 'List of acceptance criteria or technical constraints' }
          },
          required: ['title', 'description']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx?.onCreateForgeTask) {
        const task = await ctx.onCreateForgeTask({
          title: args.title,
          description: args.description,
          category: args.category || 'feature',
          targetFiles: args.target_files || [],
          requirements: args.requirements || [],
          requestedBy: 'aloy'
        });
        return `Task "${task.title}" (ID: ${task.id}) has been created in The Cauldron. HEPHAESTUS is now analyzing the codebase on branch ${task.branch}.`;
      }
      return 'HEPHAESTUS Cauldron bridge is not available in this context.';
    }
  },

  {
    name: 'heph_explain_diff',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'heph_explain_diff',
        description: 'Inspect and explain staged code diffs for a HEPHAESTUS task in plain language.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The task ID to explain' }
          },
          required: ['task_id']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx?.onGetForgeTask) {
        const task = await ctx.onGetForgeTask(args.task_id);
        if (!task) return `No task found with ID ${args.task_id}`;
        const diffs = (task.stagedChanges || []).map(sc => `File: ${sc.filePath} (+${sc.additions}/-${sc.deletions})`).join('\n');
        return `Task ${task.title} (${task.category}):\n${diffs || 'No staged modifications'}\nAI Verdict: ${task.aiReview?.verdict || 'Pending'}`;
      }
      return 'HEPHAESTUS inspector bridge unavailable.';
    }
  },
  {
    name: 'forge_check_task',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'forge_check_task',
        description: "Check the status, test results, syntax validation, and staged diff of an engineering task assigned to HEPHAESTUS.",
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The Hephaestus task ID (e.g. heph-xxx)' }
          },
          required: ['task_id']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx?.onGetForgeTask) {
        const task = await ctx.onGetForgeTask(args.task_id);
        if (!task) return `No HEPHAESTUS task found with ID ${args.task_id}.`;
        const diffSummary = task.stagedChanges.map(c => `${c.relativePath || c.filePath}: +${c.additions}/-${c.deletions}`).join(', ');
        return `HEPHAESTUS Task ${task.id} (${task.title}): Status=${task.status}. Branch=${task.branch}. Staged files: [${diffSummary || 'None'}]. Tests: ${task.testResults?.passed ? 'PASSED' : task.testResults?.passed === false ? 'FAILED' : 'Pending'}.`;
      }
      return 'HEPHAESTUS Cauldron bridge is not available in this context.';
    }
  },

  {
    name: 'athena_dispatch_research',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'athena_dispatch_research',
        description: 'Dispatch a long-running, autonomous deep research mission to ATHENA (The Autonomous Research Scout). Use this when the user asks for in-depth technical comparisons, multi-source web investigation, market research, or comprehensive intelligence dossiers.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The topic, question, or technology to research deeply.' },
            depth: { type: 'string', enum: ['quick', 'standard', 'deep_dive'], description: 'Research depth. quick=1-2 min executive brief, standard=3-5 min balanced report, deep_dive=exhaustive technical dossier with data comparisons.' },
            focus_areas: { type: 'array', items: { type: 'string' }, description: 'Specific angles or questions to prioritize (e.g. ["Cost", "Safety", "LFP vs NMC"]).' }
          },
          required: ['query']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx.onDispatchAthenaResearch) {
        const task = await ctx.onDispatchAthenaResearch({
          query: args.query,
          depth: args.depth || 'standard',
          focusAreas: args.focus_areas || [],
          requestedBy: 'aloy_chat'
        });
        return `Athena research mission dispatched! (ID: ${task.id}). Athena is now scouring sources and compiling a structured dossier in the background. You can check status anytime with athena_get_research_report or view it in the Athena Research workspace.`;
      }
      return 'Athena Research Scout bridge is not available in this context.';
    }
  },

  {
    name: 'athena_get_research_report',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'athena_get_research_report',
        description: 'Retrieve the status, findings, or completed markdown report of an ATHENA research mission.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'The Athena mission ID (e.g. athena-xxx). If omitted, retrieves the most recent research mission.' }
          },
          required: []
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx.onGetAthenaTask) {
        const task = await ctx.onGetAthenaTask(args.task_id);
        if (!task) return args.task_id ? `No Athena research mission found with ID ${args.task_id}.` : 'No research missions found.';
        if (task.status === 'completed' && task.reportMarkdown) {
          return `ATHENA DOSSIER [${task.id}] — "${task.query}" (Completed ${new Date(task.completedAt).toLocaleTimeString()}):\n\n${task.reportMarkdown}`;
        }
        return `ATHENA MISSION [${task.id}] — "${task.query}": Status=${task.status.toUpperCase()} (${task.progress}%). Message: ${task.statusMessage}`;
      }
      return 'Athena Research Scout bridge is not available in this context.';
    }
  },

  // APOLLO — Document Intelligence & Vault Curator Tools
  {
    name: 'apollo_curate_document',
    requiresConfirmation: true,
    confirmLabel: (args) => `Curate and index document "${args.title}" into Apollo's knowledge bank?`,
    definition: {
      type: 'function',
      function: {
        name: 'apollo_curate_document',
        description: 'Dispatch document curation, entity extraction, and knowledge synthesis to APOLLO.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title of the document or note' },
            raw_content: { type: 'string', description: 'Raw document or research text' },
            category: { type: 'string', description: 'Category e.g. Technical, Architecture, Research' }
          },
          required: ['title', 'raw_content']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx?.onDelegateApollo) {
        const task = await ctx.onDelegateApollo({ title: args.title, rawContent: args.raw_content, category: args.category });
        return `Apollo Document Task created (ID: ${task.id}). Apollo is analyzing and indexing key entities into your Knowledge Bank.`;
      }
      return 'Apollo Document Intelligence bridge is unavailable.';
    }
  },
  {
    name: 'apollo_garden_memories',
    requiresConfirmation: true,
    confirmLabel: () => 'Trigger Apollo memory gardening (prune duplicate/stale memories and consolidate facts)?',
    definition: {
      type: 'function',
      function: {
        name: 'apollo_garden_memories',
        description: 'Trigger APOLLO to clean, deduplicate, and organize your Persistent Memory Bank.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      if (ctx?.onGardenMemories) {
        const res = await ctx.onGardenMemories();
        return `Apollo memory gardening complete: ${res.finalCount} unique facts retained (pruned ${res.prunedCount} duplicates).`;
      }
      return 'Apollo memory gardening bridge is unavailable.';
    }
  },
  {
    name: 'apollo_sync_vault',
    requiresConfirmation: true,
    confirmLabel: () => 'Synchronize all memories, learned knowledge, and skills to your Obsidian Vault?',
    definition: {
      type: 'function',
      function: {
        name: 'apollo_sync_vault',
        description: 'Trigger APOLLO to synchronize all memories, learned knowledge, and skills into your Obsidian Vault.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      if (ctx?.onSyncVault) {
        await ctx.onSyncVault();
        return 'Apollo has synchronized all knowledge banks into your Obsidian Vault.';
      }
      return 'Apollo vault sync bridge is unavailable.';
    }
  },

  // MINERVA — Smart Home Sentinel & Health Watchdog Tools
  {
    name: 'minerva_system_health',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'minerva_system_health',
        description: 'Ask MINERVA to run an infrastructure scan of all local sidecars (Ollama, Whisper, Kokoro, Jellyfin, Mindwalk, Drives, Cloud Keys).',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      if (ctx?.onMinervaHealthScan) {
        const rep = await ctx.onMinervaHealthScan();
        const off = rep.offlineServices?.length > 0 ? `Issues: [${rep.offlineServices.join(', ')}]` : 'All sidecars operational';
        return `MINERVA SENTINEL: System status is ${rep.status.toUpperCase()}. ${off}.`;
      }
      return 'Minerva Sentinel bridge is unavailable.';
    }
  },

  // HERMES — Logistics & Daily Briefing Tools
  {
    name: 'hermes_get_daily_brief',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'hermes_get_daily_brief',
        description: 'Ask HERMES to compile your executive daily operations brief (reminders, finances, projects, and morning pulse).',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      if (ctx?.onHermesDailyBrief) {
        const brief = await ctx.onHermesDailyBrief();
        return brief.markdown || 'Hermes daily brief generated.';
      }
      return 'Hermes operations bridge is unavailable.';
    }
  },
  {
    name: 'hermes_check_budget',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'hermes_check_budget',
        description: 'Ask HERMES to evaluate recent spending vs budget limits.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async (_args, ctx) => {
      if (ctx?.onHermesBudgetHealth) {
        const h = await ctx.onHermesBudgetHealth();
        if (h.budgetAlerts?.length > 0) {
          return `HERMES FINANCIAL ALERT: ${h.budgetAlerts.map(a => `${a.category}: $${a.spent}/$${a.limit} (${a.percent}%)`).join(', ')}`;
        }
        return 'HERMES: All spending categories are within healthy budget limits.';
      }
      return 'Hermes finance bridge is unavailable.';
    }
  },
  {
    name: 'hermes_run_pipeline',
    requiresConfirmation: true,
    confirmLabel: (args) => `Execute Hermes zero-context tool pipeline script (${(args.script || '').slice(0, 40)}...)?`,
    definition: {
      type: 'function',
      function: {
        name: 'hermes_run_pipeline',
        description: 'Execute a multi-tool JavaScript pipeline script locally via Hermes RPC, collapsing multi-step workflows into a single zero-context-cost turn.',
        parameters: {
          type: 'object',
          properties: {
            script: { type: 'string', description: 'Async JavaScript code that calls aloy.callTool(name, args) and returns final data.' },
            context: { type: 'object', description: 'Optional key-value parameters passed into the script via aloy.context' }
          },
          required: ['script']
        }
      }
    },
    execute: async (args, ctx) => {
      if (window.electronAPI?.hermesRunPipeline) {
        const res = await window.electronAPI.hermesRunPipeline(args.script, args.context || {});
        return JSON.stringify(res);
      }
      return 'Hermes Script Pipeline bridge is unavailable.';
    }
  },
  {
    name: 'hermes_fts_search',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'hermes_fts_search',
        description: 'Search cross-session conversation transcripts and memories using Hermes BM25 full-text keyword indexing.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Keyword or search query to find in past sessions or memories' },
            limit: { type: 'number', description: 'Maximum number of results to return (default 8)' }
          },
          required: ['query']
        }
      }
    },
    execute: async (args, ctx) => {
      if (window.electronAPI?.hermesSearchMemory) {
        const hits = await window.electronAPI.hermesSearchMemory(args.query, args.limit || 8);
        return JSON.stringify(hits);
      }
      return 'Hermes cross-session search is unavailable.';
    }
  },
  {
    name: 'hermes_evolve_skill',
    requiresConfirmation: true,
    confirmLabel: (args) => `Evolve skill "${args.skill_name}" with Genetic-Pareto optimization (GEPA)?`,
    definition: {
      type: 'function',
      function: {
        name: 'hermes_evolve_skill',
        description: 'Mutate and optimize a skill prompt or schema using Hermes Genetic-Pareto Prompt Evolution (GEPA).',
        parameters: {
          type: 'object',
          properties: {
            skill_name: { type: 'string', description: 'Name of the skill to evolve' },
            reason: { type: 'string', description: 'Reason for evolution (e.g. error mitigation, latency optimization)' },
            feedback: { type: 'string', description: 'Specific failure trace or user feedback to guard against' }
          },
          required: ['skill_name']
        }
      }
    },
    execute: async (args, ctx) => {
      if (window.electronAPI?.hermesEvolveSkill) {
        const evolved = await window.electronAPI.hermesEvolveSkill(args.skill_name, args.reason || 'optimization', args.feedback || '');
        return `Skill "${args.skill_name}" successfully evolved to Gen ${evolved?.metrics?.evolutionGen || 2} (v${evolved?.version || '1.2.0'}).`;
      }
      return 'Hermes skill evolution bridge is unavailable.';
    }
  },
  {
    name: 'hermes_get_user_model',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'hermes_get_user_model',
        description: 'Retrieve the Honcho dialectic user model (communication style, top priorities, friction points, working habits).',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    },
    execute: async (_args, ctx) => {
      if (window.electronAPI?.hermesGetUserModel) {
        const model = await window.electronAPI.hermesGetUserModel();
        return JSON.stringify(model);
      }
      return 'Hermes dialectic user model is unavailable.';
    }
  },

  // GOOGLE ADK (Agent Development Kit) WORKFLOW TOOLS
  {
    name: 'adk_run_sequential_workflow',
    requiresConfirmation: true,
    confirmLabel: (args) => `Execute Google ADK sequential workflow "${args.pipeline_name || 'sequential_pipeline'}" with ${args.steps?.length || 0} chained steps?`,
    definition: {
      type: 'function',
      function: {
        name: 'adk_run_sequential_workflow',
        description: 'Execute a deterministic multi-agent sequential pipeline where each subagent output is passed forward into the next step.',
        parameters: {
          type: 'object',
          properties: {
            pipeline_name: { type: 'string', description: 'Descriptive name for the pipeline' },
            initial_input: { type: 'string', description: 'Starting task or query prompt' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  agent_name: { type: 'string', description: 'Target agent (e.g. athena, hephaestus, apollo, minerva, hermes)' },
                  input_template: { type: 'string', description: 'Prompt template with {input} or {state_key} interpolation' },
                  output_key: { type: 'string', description: 'Key to store output in session.state' }
                },
                required: ['agent_name']
              },
              description: 'Ordered list of pipeline steps to execute'
            }
          },
          required: ['steps']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx?.onRunSequentialPipeline) {
        return JSON.stringify(await ctx.onRunSequentialPipeline(args));
      }
      return JSON.stringify({ status: 'error', message: 'ADK Sequential Pipeline runner is unavailable.' });
    }
  },

  {
    name: 'adk_run_parallel_workflow',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'adk_run_parallel_workflow',
        description: 'Dispatch concurrent inquiries to multiple subagents simultaneously and merge their results.',
        parameters: {
          type: 'object',
          properties: {
            dispatch_name: { type: 'string', description: 'Descriptive name for the parallel dispatch' },
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  agent_name: { type: 'string', description: 'Target agent name (e.g. minerva, apollo, hermes, athena)' },
                  task: { type: 'string', description: 'Task prompt for this agent' },
                  output_key: { type: 'string', description: 'Key to store in session.state' }
                },
                required: ['agent_name', 'task']
              }
            }
          },
          required: ['tasks']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx?.onRunParallelDispatch) {
        return JSON.stringify(await ctx.onRunParallelDispatch(args));
      }
      return JSON.stringify({ status: 'error', message: 'ADK Parallel Dispatch runner is unavailable.' });
    }
  },

  {
    name: 'adk_transfer_to_agent',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'adk_transfer_to_agent',
        description: 'Transfer conversational focus and control to a specialized subagent (Athena for research, Hephaestus for coding, Apollo for memory/vault, Hermes for finances, Minerva for health).',
        parameters: {
          type: 'object',
          properties: {
            target_agent: { type: 'string', enum: ['athena', 'hephaestus', 'apollo', 'hermes', 'minerva'], description: 'Specialized agent to hand off to' },
            reason: { type: 'string', description: 'Why the conversation is being transferred' }
          },
          required: ['target_agent']
        }
      }
    },
    execute: async (args, ctx) => {
      if (ctx?.onTransferToAgent) {
        return JSON.stringify(ctx.onTransferToAgent(args.target_agent, args.reason));
      }
      return `Transferred conversation focus to ${args.target_agent.toUpperCase()}.`;
    }
  },

  {
    name: 'get_bazzite_status',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_bazzite_status',
        description: 'Get real-time hardware telemetry, online status, OS/kernel version, CPU/GPU temperatures, memory, and disk usage for the Bazzite gaming machine (bazzite.local).',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI?.remoteGetMachineStatus) {
          const res = await window.electronAPI.remoteGetMachineStatus('bazzite');
          return JSON.stringify(res, null, 2);
        }
        const { apiJson } = await import('./aloyApi.js');
        const res = await apiJson('/api/remote-machines/bazzite/status');
        return JSON.stringify(res.status || res, null, 2);
      } catch (err) {
        return JSON.stringify({ error: err.message || 'Failed to query Bazzite' });
      }
    }
  },

  {
    name: 'get_remote_machines_status',
    requiresConfirmation: false,
    definition: {
      type: 'function',
      function: {
        name: 'get_remote_machines_status',
        description: 'Get real-time status and hardware telemetry for all configured remote network machines (Bazzite gaming PC and Lenny server).',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI?.remoteGetMachinesStatus) {
          const res = await window.electronAPI.remoteGetMachinesStatus();
          return JSON.stringify(res, null, 2);
        }
        const { apiJson } = await import('./aloyApi.js');
        const res = await apiJson('/api/remote-machines/status');
        return JSON.stringify(res, null, 2);
      } catch (err) {
        return JSON.stringify({ error: err.message || 'Failed to query remote machines' });
      }
    }
  },

  {
    name: 'execute_bazzite_command',
    requiresConfirmation: true,
    confirmLabel: (args) => `Execute remote command on Bazzite gaming machine: "${args?.command}"?`,
    definition: {
      type: 'function',
      function: {
        name: 'execute_bazzite_command',
        description: 'Execute a shell command remotely over SSH on the Bazzite machine (e.g. ujust update, sensors, rpm-ostree status, flatpak update).',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute on Bazzite' }
          },
          required: ['command']
        }
      }
    },
    execute: async (args) => {
      if (!args?.command) return JSON.stringify({ error: 'Command required' });
      try {
        if (typeof window !== 'undefined' && window.electronAPI?.remoteExec) {
          const res = await window.electronAPI.remoteExec('bazzite', args.command);
          return JSON.stringify(res, null, 2);
        }
        const { apiFetch } = await import('./aloyApi.js');
        const fetchRes = await apiFetch('/api/remote-machines/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineId: 'bazzite', command: args.command })
        });
        const res = await fetchRes.json();
        return JSON.stringify(res, null, 2);
      } catch (err) {
        return JSON.stringify({ error: err.message || 'Execution failed' });
      }
    }
  },

  {
    name: 'execute_remote_machine_command',
    requiresConfirmation: true,
    confirmLabel: (args) => `Execute remote command on ${args?.machine || 'remote machine'}: "${args?.command}"?`,
    definition: {
      type: 'function',
      function: {
        name: 'execute_remote_machine_command',
        description: 'Execute a shell command remotely over SSH on a specific machine ("bazzite" or "lenny").',
        parameters: {
          type: 'object',
          properties: {
            machine: { type: 'string', enum: ['bazzite', 'lenny'], description: 'Target machine identifier' },
            command: { type: 'string', description: 'Shell command to execute' }
          },
          required: ['machine', 'command']
        }
      }
    },
    execute: async (args) => {
      if (!args?.command) return JSON.stringify({ error: 'Command required' });
      const targetMachine = args.machine || 'bazzite';
      try {
        if (typeof window !== 'undefined' && window.electronAPI?.remoteExec) {
          const res = await window.electronAPI.remoteExec(targetMachine, args.command);
          return JSON.stringify(res, null, 2);
        }
        const { apiFetch } = await import('./aloyApi.js');
        const fetchRes = await apiFetch('/api/remote-machines/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineId: targetMachine, command: args.command })
        });
        const res = await fetchRes.json();
        return JSON.stringify(res, null, 2);
      } catch (err) {
        return JSON.stringify({ error: err.message || 'Execution failed' });
      }
    }
  }
];

// MCP-sourced tools (see server/mcpClient.cjs) are discovered at runtime,
// not known statically like TOOLS above — registerMcpTools() is called once
// per environment this module runs in (see below). Wrapping each as the
// same {name, requiresConfirmation, confirmLabel, definition, execute} shape
// as a local tool means the rest of the app (the tool-call loop in App.jsx /
// aloyServer.cjs, the confirm/deny UI in ChatArea.jsx) needs no MCP-specific
// code at all.
//
// This module loads as two SEPARATE instances with independent state: once
// bundled into the renderer (via Vite), and once dynamically imported by
// aloyServer.cjs in the main process for the mobile/API path. Each side
// calls registerMcpTools() itself with its own way of actually invoking a
// tool (IPC for the renderer, a direct function call for the server, which
// shares a process with mcpClient.cjs) — hence callTool being injected
// rather than hardcoded to window.electronAPI.
let mcpToolEntries = [];

const MCP_READ_ONLY_OPERATIONS = new Set([
  'list_directory',
  'read_text_file',
  'read_file',
  'read_media_file',
  'get_file_info',
  'list_allowed_directories',
  'search_files',
  'directory_tree',
  'fetch',
  'git_status',
  'git_log',
  'git_diff',
  'git_show',
  'status',
  'log',
  'diff',
  'show'
]);

function isMcpToolReadOnly(toolName) {
  const shortName = (toolName || '').split('__').pop();
  return MCP_READ_ONLY_OPERATIONS.has(shortName);
}

export function registerMcpTools(mcpToolDefs, callTool) {
  mcpToolEntries = (mcpToolDefs || []).map(t => {
    const isReadOnly = isMcpToolReadOnly(t.name);
    return {
      name: t.name,
      serverName: t.serverName,
      // Read-only tools execute automatically for high responsiveness;
      // Write / state-changing tools always require confirmation.
      requiresConfirmation: !isReadOnly,
      confirmLabel: (args) => `Run MCP tool "${t.name}" (${t.serverName}) with ${JSON.stringify(args)}?`,
      definition: {
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.inputSchema || { type: 'object', properties: {} }
        }
      },
      execute: async (args) => {
        const res = await callTool(t.name, args);
        return res.success ? res.result : JSON.stringify({ error: res.error });
      }
    };
  });
}

// For a small "MCP: N servers connected" status line in the UI — see
// Sidebar.jsx's footer.
export function getMcpStatus() {
  return {
    serverCount: new Set(mcpToolEntries.map(t => t.serverName)).size,
    toolCount: mcpToolEntries.length
  };
}

// Spawning MCP servers can take several real seconds (esp. a Python server
// via uvx). A mount-effect-only fetch loses the race if the user sends a
// message before it resolves, silently omitting MCP tools from that turn.
// ensureMcpToolsLoaded() is a memoized promise runModelTurn awaits before
// building the tool list, so the very first message is always correct —
// with no added latency once the (one-time) fetch has already resolved.
// Renderer-only (uses window.electronAPI's IPC bridge) — aloyServer.cjs
// registers its own MCP tools directly, see server/aloyServer.cjs.
let mcpToolsLoadPromise = null;

export function ensureMcpToolsLoaded() {
  if (!mcpToolsLoadPromise) {
    mcpToolsLoadPromise = (typeof window !== 'undefined' && window.electronAPI?.isElectron)
      ? window.electronAPI.mcpListTools().then((res) => {
          if (res?.success) registerMcpTools(res.tools, (name, args) => window.electronAPI.mcpCallTool(name, args));
        }).catch((err) => console.error('Failed to load MCP tools:', err))
      : Promise.resolve();
  }
  return mcpToolsLoadPromise;
}

export function getToolDefinitions(userQuery = '') {
  const allTools = [...TOOLS, ...mcpToolEntries];
  if (!userQuery || typeof userQuery !== 'string' || userQuery.trim().length === 0) {
    return allTools.map(t => t.definition);
  }

  const query = userQuery.toLowerCase();

  // Keyword domain classifiers
  const isCodeQuery = /code|bug|feature|refactor|pull request|pr|deploy|rollback|patch|git|repo|hephaestus|function|script|error|syntax|compile|ast|diff|work order/i.test(query);
  const isResearchQuery = /research|investigate|compare|benchmark|scout|dossier|study|deep dive|analyze|market|specs|pros and cons|athena/i.test(query);
  const isSmartHomeQuery = /light|lock|door|switch|fan|climate|temp|thermostat|ac|heat|room|home|kitchen|bedroom|living|office|garage|camera|vision|presence|see|look|motion|automation|turn on|turn off|battery|batteries|appliance|washer|dryer|vacuum|roborock|who is home|where is|window|weather|sun|air quality|co2/i.test(query);
  const isMediaQuery = /movie|film|disc|rip|transcode|handbrake|bluray|4k|dvd|plex|video|stream|audio|media|autorip|jellyfin|tv|episode|season|show|format|audit|playing|watching|listen|playback|pause|unpause|resume|cast|radarr|sonarr|arr|download|torrent|usenet|grab|queue/i.test(query);
  const isNotesQuery = /note|obsidian|vault|markdown|document|summary|journal|log|write down|remember|apollo|curate|memory graph|knowledge graph/i.test(query);
  const isFinanceQuery = /money|spent|spend|cost|dollar|\$|budget|finance|expense|income|transaction|hermes|stock|stocks|portfolio|shares|ticker|invest/i.test(query);
  const isWorkflowQuery = /workflow|pipeline|adk|agent|delegate|transfer|sequential|parallel|chain|subagent|pantheon/i.test(query);
  const isRemoteMachineQuery = /bazzite|lenny|remote|server|gaming pc|steam deck|gaming station|linux machine/i.test(query);

  const filtered = allTools.filter(tool => {
    const name = tool.name.toLowerCase();

    // 0. Google ADK Multi-Agent Workflow Tools
    if (name.startsWith('adk_')) {
      return isWorkflowQuery || isCodeQuery || isResearchQuery;
    }

    // 0b. Remote Machine Tools (Bazzite & Lenny)
    if (name.includes('bazzite') || name.includes('remote_machine')) {
      return isRemoteMachineQuery || isCodeQuery;
    }

    // 1. Smart home control & status & extended domains
    if (/control_smart_home_device|get_smart_home_status|list_home_assistant_entities|get_battery_status|get_appliance_status|get_family_presence|get_home_environment|get_weather_forecast/.test(name)) {
      return isSmartHomeQuery;
    }

    // 2. Smart home automation & vision
    if (/automation|dashboard|health|vision|ambient|minerva_system_health/.test(name)) {
      return isSmartHomeQuery;
    }

    // 3. Finance & Budget
    if (name.includes('finance') || name.includes('transaction') || name.includes('budget') || name.includes('hermes') || name.includes('portfolio') || name.includes('stock')) {
      return isFinanceQuery;
    }

    // 4. Hephaestus Code Forge
    if (name.startsWith('hephaestus_') || name.startsWith('forge_') || name.startsWith('heph_') || name.includes('ui_change') || name === 'read_own_ui_source') {
      return isCodeQuery;
    }

    // 5. Athena Research Scout
    if (name.startsWith('athena_') || name === 'research_topic') {
      return isResearchQuery;
    }

    // 6. Media & AutoRip & Jellyfin & Media Dispatcher & Arr
    if (/project_status|media|autorip|auto_rip|jellyfin|arr_|radarr|sonarr|audit_media|format_media|play_media|search_media_library|list_playback_targets/.test(name)) {
      return isMediaQuery || isRemoteMachineQuery;
    }

    // 7. Obsidian, Vault, Memory & Notes
    if (/obsidian|vault|apollo_|knowledge_graph/.test(name)) {
      return isNotesQuery;
    }

    // 9. Reminders, User Memory & Profile updates (Always available for general conversation)
    if (/current_time|create_reminder|add_reminder|complete_reminder|save_lesson|save_researched_knowledge|save_user_memory|update_user_profile|get_skills_dashboard|log_workout|get_workout_history/.test(name)) {
      return true;
    }

    // 10. MCP Tools
    if (name.startsWith('mcp__')) {
      if (name.includes('filesystem')) return isCodeQuery || isNotesQuery || isMediaQuery;
      if (name.includes('git')) return isCodeQuery;
      return false;
    }

    return false;
  });

  return filtered.map(t => t.definition);
}

export function getTool(name) {
  return TOOLS.find(t => t.name === name) || mcpToolEntries.find(t => t.name === name);
}

// Ollama's structured tool_calls give `arguments` as a parsed object; some
// models/versions may return a JSON string instead — handle both.
export function parseToolArguments(rawArguments) {
  if (rawArguments == null) return {};
  if (typeof rawArguments === 'object') return rawArguments;
  try {
    return JSON.parse(rawArguments);
  } catch {
    return {};
  }
}
