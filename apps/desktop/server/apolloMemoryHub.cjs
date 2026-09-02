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

const WIKI_DIR = path.join(os.homedir(), '.aloy-server', 'vault', 'wiki');
const CODE_GRAPH_FILE = path.join(os.homedir(), '.aloy-server', 'vault', 'code_graph.json');

function ensureDirectories() {
  if (!fs.existsSync(WIKI_DIR)) {
    fs.mkdirSync(WIKI_DIR, { recursive: true });
  }
}

class ApolloMemoryHub {
  constructor() {
    ensureDirectories();
    this.initializeDefaultWiki();
    this.initializeDefaultCodeGraph();
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
      const pagePath = path.join(WIKI_DIR, `${p.slug}.md`);
      if (!fs.existsSync(pagePath)) {
        fs.writeFileSync(pagePath, p.content, 'utf8');
      }
    }
  }

  initializeDefaultCodeGraph() {
    if (!fs.existsSync(CODE_GRAPH_FILE)) {
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
      fs.writeFileSync(CODE_GRAPH_FILE, JSON.stringify(initialGraph, null, 2), 'utf8');
    }
  }

  // --- ASSET 3: LLM-WIKI ---
  getWikiPages() {
    ensureDirectories();
    const files = fs.readdirSync(WIKI_DIR).filter(f => f.endsWith('.md'));
    return files.map(file => {
      const slug = file.replace('.md', '');
      const content = fs.readFileSync(path.join(WIKI_DIR, file), 'utf8');
      const firstLine = content.split('\n')[0] || slug;
      const title = firstLine.replace(/^#+\s*/, '').trim();
      return { slug, title, content };
    });
  }

  getWikiPage(slug) {
    ensureDirectories();
    const filePath = path.join(WIKI_DIR, `${slug}.md`);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  }

  saveWikiPage(slug, title, markdownContent) {
    ensureDirectories();
    const filePath = path.join(WIKI_DIR, `${slug}.md`);
    fs.writeFileSync(filePath, markdownContent, 'utf8');
    logAuditEvent('apollo_wiki_saved', { slug, title, length: markdownContent.length });
    return { success: true, slug, filePath };
  }

  // --- ASSET 4: CODE GRAPH ---
  getCodeGraph() {
    if (!fs.existsSync(CODE_GRAPH_FILE)) this.initializeDefaultCodeGraph();
    try {
      return JSON.parse(fs.readFileSync(CODE_GRAPH_FILE, 'utf8'));
    } catch {
      return { error: 'Failed to parse code graph' };
    }
  }

  updateCodeGraph(graphData) {
    fs.writeFileSync(CODE_GRAPH_FILE, JSON.stringify(graphData, null, 2), 'utf8');
    logAuditEvent('apollo_code_graph_updated', { services: graphData.services?.length || 0 });
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
