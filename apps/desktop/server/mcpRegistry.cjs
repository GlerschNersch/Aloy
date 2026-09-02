/**
 * Community MCP Plugin & Tool Registry for Aloy.
 * Inspired by anthropics / claude-plugins-community.
 * 
 * Provides dynamic discovery, health checking, and registry management
 * for MCP servers and sidecars across Aloy's Pantheon engines.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logAuditEvent } = require('./auditLogger.cjs');

class McpRegistry {
  constructor() {
    this.communityPlugins = [
      {
        id: 'homeassistant-mcp',
        name: 'Home Assistant Core MCP',
        category: 'Smart Home & IoT',
        author: 'Aloy Core / Community',
        version: '1.4.0',
        status: 'enabled',
        tools: ['ha_get_state', 'ha_call_service', 'ha_eval_template', 'ha_list_services'],
        description: 'Complete programmatic bridge for controlling lights, thermostats, scenes, and sensor entities.'
      },
      {
        id: 'snes-emulator-bridge',
        name: 'BizHawk / SNES Memory Bridge',
        category: 'Gaming & Simulation',
        author: 'Aloy Core',
        version: '2.1.0',
        status: 'enabled',
        tools: ['bizhawk_read8', 'bizhawk_write8', 'bizhawk_press_buttons', 'bizhawk_screenshot'],
        description: 'Direct memory domain and input injection bridge for BizHawk emulator.'
      },
      {
        id: 'c700-mcp',
        name: 'SNES C700 Sound Synthesizer',
        category: 'Audio & DSP',
        author: 'Aloy Core',
        version: '1.0.2',
        status: 'enabled',
        tools: ['render_midi', 'create_simple_midi', 'list_plugins', 'get_plugin_info'],
        description: 'SPC700 audio synthesizer plugin renderer for authentic 16-bit soundscapes.'
      },
      {
        id: 'firecrawl-web-scrape',
        name: 'Firecrawl High-Res Scraper',
        category: 'Research & Search',
        author: 'Firecrawl Community',
        version: '0.9.5',
        status: 'available',
        tools: ['scrape_page_markdown', 'crawl_domain', 'pdf_inspect'],
        description: 'Fast markdown converter and PDF classification engine for Athena research missions.'
      },
      {
        id: 'git-forge-review',
        name: 'Hephaestus Git PR Reviewer',
        category: 'Development',
        author: 'Aloy Pantheon',
        version: '2.0.0',
        status: 'enabled',
        tools: ['git_diff_summary', 'run_monorepo_tests', 'synthesize_pr_review'],
        description: 'Autonomous multi-file code review and test validator for monitored repositories.'
      }
    ];
  }

  getRegistry() {
    return {
      count: this.communityPlugins.length,
      plugins: this.communityPlugins,
      totalTools: this.communityPlugins.reduce((acc, p) => acc + (p.tools ? p.tools.length : 0), 0)
    };
  }

  getPlugin(id) {
    return this.communityPlugins.find(p => p.id === id) || null;
  }

  togglePlugin(id, enable) {
    const plugin = this.getPlugin(id);
    if (!plugin) return { success: false, error: 'Plugin not found' };
    plugin.status = enable ? 'enabled' : 'disabled';
    logAuditEvent('mcp_plugin_toggled', { id, status: plugin.status });
    return { success: true, plugin };
  }
}

const mcpRegistry = new McpRegistry();

module.exports = {
  McpRegistry,
  mcpRegistry
};
