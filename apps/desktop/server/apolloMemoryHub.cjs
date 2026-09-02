/**
 * 4-Asset Memory & LLM-Wiki Hub for Apollo.
 * Inspired by TencentDB-Agent-Memory & OpenViking.
 *
 * 4 Reusable Memory Assets:
 * 1. Chat Memory (Episodic conversational recall & facts)
 * 2. Skills Registry (Learned procedural tools & macros)
 * 3. LLM-Wiki (Living, structured Markdown domain encyclopedias)
 * 4. Code-Graph (Monorepo codebase topology & component maps)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logAuditEvent } = require('./auditLogger.cjs');

const DEFAULT_WIKI_DIR = path.join(os.homedir(), '.aloy-server', 'vault', 'wiki');
const DEFAULT_CODE_GRAPH_FILE = path.join(os.homedir(), '.aloy-server', 'vault', 'code_graph.json');

// Wiki slugs reach this module straight from an Express route param
// (GET/POST /api/apollo/wiki/:slug) with nothing in between validating them.
// `path.join(wikiDir, slug + '.md')` does NOT stop '..' segments from
// escaping wikiDir — a slug like '../../../../some/other/file' resolves
// outside it, giving arbitrary-file read (getWikiPage) and write
// (saveWikiPage) to anyone holding the server's bearer token. Fixed two
// ways, deliberately redundant: an allow-list on the slug's shape (so a
// legitimate slug never even needs to think about traversal), AND a
// resolved-path containment check (so a mistake in the allow-list, or a
// future caller that bypasses it, still can't escape wikiDir).
const SAFE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;

function resolveWikiPath(wikiDir, slug) {
  if (typeof slug !== 'string' || !SAFE_SLUG_RE.test(slug)) return null;
  const filePath = path.join(wikiDir, `${slug}.md`);
  const resolved = path.resolve(filePath);
  const base = path.resolve(wikiDir) + path.sep;
  if (!resolved.startsWith(base)) return null; // defense in depth
  return filePath;
}

class ApolloMemoryHub {
  // customWikiDir/customCodeGraphFile let tests point this at a temp
  // sandbox instead of the real ~/.aloy-server/vault — mirrors the same
  // constructor-injection pattern ApolloEngine uses for its tasks file.
  constructor(customWikiDir = null, customCodeGraphFile = null) {
    this.wikiDir = customWikiDir || DEFAULT_WIKI_DIR;
    this.codeGraphFile = customCodeGraphFile || DEFAULT_CODE_GRAPH_FILE;
    this.ensureDirectories();
    this.initializeDefaultWiki();
    this.initializeDefaultCodeGraph();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.wikiDir)) {
      fs.mkdirSync(this.wikiDir, { recursive: true });
    }
  }

  initializeDefaultWiki() {
    const defaultPages = [
      {
        slug: 'smart-home',
        title: 'Smart Home & Environmental Topology',
        tags: ['minerva', 'homeassistant', 'climate'],
        content: `# Smart Home & Environmental Topology\n\n- **Controller**: Home Assistant LAN Integration\n- **Monitored Zones**: Office, Living Room, Bedroom, Climate Thermostats, Smart Locks.\n- **Automation Guardian**: Minerva Sentinel monitors anomaly triggers and offline entity states.`
      },
      {
        slug: 'media-stack',
        title: 'Universal Media & Casting Stack',
        tags: ['jellyfin', 'roku', 'bazzite'],
        content: `# Universal Media & Casting Stack\n\n- **Storage Volume**: P:\\TV Shows, P:\\Movies\n- **Dispatcher**: Multi-target cast router (Lenny, Bazzite Remote, Roku Living Room).\n- **Jellyfin**: Auto-syncing library and realpath secure media streaming.`
      },
      {
        slug: 'agent-pantheon',
        title: 'Autonomous Pantheon Subagents',
        tags: ['athena', 'apollo', 'hermes', 'hephaestus', 'minerva', 'conclave'],
        content: `# Autonomous Pantheon Subagents\n\n- **Hermes**: Morning briefs, finance radar, daily operations.\n- **Hephaestus**: Autonomous development, git PR review, code forge.\n- **Athena**: Deep web research, dossier compilation.\n- **Apollo**: 4-asset memory hub, episodic recall, LLM-Wiki.\n- **Minerva**: Vision triage, security sentinel, smart home.\n- **Conclave**: Multi-agent consensus & deliberation.`
      }
    ];

    for (const p of defaultPages) {
      const pagePath = path.join(this.wikiDir, `${p.slug}.md`);
      if (!fs.existsSync(pagePath)) {
        fs.writeFileSync(pagePath, p.content, 'utf8');
      }
    }
  }

  initializeDefaultCodeGraph() {
    if (!fs.existsSync(this.codeGraphFile)) {
      const initialGraph = {
        name: 'Aloy Monorepo',
        root: path.resolve(__dirname, '../../..'),
        services: [
          { name: 'aloy-server', port: 7890, type: 'core_backend', file: 'apps/desktop/server/aloyServer.cjs' },
          { name: 'aloy-desktop', port: 5173, type: 'electron_ui', root: 'apps/desktop' },
          { name: 'aloy-mobile', platform: 'react-native', root: 'apps/mobile' },
          { name: 'aloy-docs', port: 7890, route: '/docs', root: 'apps/docs' }
        ],
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(this.codeGraphFile, JSON.stringify(initialGraph, null, 2), 'utf8');
    }
  }

  // --- ASSET 3: LLM-WIKI ---
  getWikiPages() {
    this.ensureDirectories();
    const files = fs.readdirSync(this.wikiDir).filter(f => f.endsWith('.md'));
    return files.map(file => {
      const slug = file.replace('.md', '');
      const content = fs.readFileSync(path.join(this.wikiDir, file), 'utf8');
      const firstLine = content.split('\n')[0] || slug;
      const title = firstLine.replace(/^#+\s*/, '').trim();
      return { slug, title, content };
    });
  }

  getWikiPage(slug) {
    this.ensureDirectories();
    const filePath = resolveWikiPath(this.wikiDir, slug);
    if (!filePath) return null; // invalid slug — same as "not found" to callers
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  }

  saveWikiPage(slug, title, markdownContent) {
    this.ensureDirectories();
    const filePath = resolveWikiPath(this.wikiDir, slug);
    if (!filePath) {
      logAuditEvent({
        category: 'security', action: 'apollo_wiki_slug_rejected', status: 'denied',
        target: String(slug), details: 'Wiki slug failed validation (invalid shape or path escaped wikiDir).'
      });
      return { success: false, error: 'Invalid wiki slug — use letters, numbers, and hyphens only.' };
    }
    fs.writeFileSync(filePath, markdownContent, 'utf8');
    logAuditEvent({
      category: 'system', action: 'apollo_wiki_saved', target: slug,
      payload: { title, length: markdownContent.length }
    });
    return { success: true, slug, filePath };
  }

  // --- ASSET 4: CODE GRAPH ---
  getCodeGraph() {
    if (!fs.existsSync(this.codeGraphFile)) this.initializeDefaultCodeGraph();
    try {
      return JSON.parse(fs.readFileSync(this.codeGraphFile, 'utf8'));
    } catch {
      return { error: 'Failed to parse code graph' };
    }
  }

  updateCodeGraph(graphData) {
    if (!graphData || typeof graphData !== 'object' || Array.isArray(graphData)) {
      return { success: false, error: 'graphData must be a JSON object' };
    }
    fs.writeFileSync(this.codeGraphFile, JSON.stringify(graphData, null, 2), 'utf8');
    logAuditEvent({
      category: 'system', action: 'apollo_code_graph_updated',
      payload: { services: graphData.services?.length || 0 }
    });
    return { success: true };
  }

  // --- UNIFIED 4-ASSET SUMMARY ---
  getHubOverview() {
    const wikiPages = this.getWikiPages();
    const codeGraph = this.getCodeGraph();

    return {
      assets: {
        chatMemory: { status: 'active', engine: 'apolloMemoryEngine.cjs' },
        skillsRegistry: { status: 'active', engine: 'skillsDashboard.cjs' },
        llmWiki: { status: 'active', pageCount: wikiPages.length, pages: wikiPages.map(p => ({ slug: p.slug, title: p.title })) },
        codeGraph: { status: 'active', serviceCount: codeGraph.services?.length || 0, updatedAt: codeGraph.updatedAt }
      }
    };
  }
}

const memoryHub = new ApolloMemoryHub();

module.exports = {
  ApolloMemoryHub,
  memoryHub
};
