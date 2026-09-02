// Vault Sync module (harvested from memU's 3-Layer Markdown Memory architecture)
// Automatically exports Aloy's learned knowledge, user lessons, personal memories,
// and synthesized skills into human-readable, inspectable Markdown files in the Vault.
const fs = require('fs');
const path = require('path');
const store = require('./store.cjs');

function getVaultMemoryDir() {
  const d = store.load();
  const baseVault = d.vaultDir || path.join(require('os').homedir(), 'Documents', 'Vault Notes');
  return path.join(baseVault, 'Aloy Brain');
}

function ensureVaultDirExists(memoryDir) {
  try {
    fs.mkdirSync(memoryDir, { recursive: true });
  } catch (err) {
    console.warn('[vault-sync] Error creating directory:', err.message);
  }
}

function formatDate(isoStr) {
  if (!isoStr) return 'N/A';
  try {
    return new Date(isoStr).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return isoStr;
  }
}

async function syncToVault() {
  const d = store.load();
  const memoryDir = getVaultMemoryDir();
  ensureVaultDirExists(memoryDir);

  const syncTime = new Date().toISOString();
  const formattedSyncTime = formatDate(syncTime);

  // 1. Generate Learned_Knowledge.md
  const learned = d.learnedKnowledge || [];
  const categorizedKnowledge = {};
  for (const entry of learned) {
    const cat = entry.category || 'General Knowledge';
    if (!categorizedKnowledge[cat]) categorizedKnowledge[cat] = [];
    categorizedKnowledge[cat].push(entry);
  }

  let learnedMd = `# 🧠 Aloy - Learned Knowledge Bank\n\n`;
  learnedMd += `> *Auto-researched and verified facts retained by Aloy.*\n`;
  learnedMd += `> **Last Updated:** ${formattedSyncTime} | **Total Entries:** ${learned.length}\n\n`;

  if (learned.length === 0) {
    learnedMd += `*No auto-researched knowledge entries saved yet.*\n`;
  } else {
    for (const [catName, entries] of Object.entries(categorizedKnowledge)) {
      learnedMd += `## 📁 ${catName}\n\n`;
      for (const item of entries) {
        learnedMd += `### ${item.topic || 'Untitled Fact'}\n`;
        learnedMd += `- **ID:** \`${item.id}\` | **Saved:** ${formatDate(item.savedAt)} | **Verified By:** ${item.verifiedBy || 'N/A'}\n`;
        if (item.summary) {
          learnedMd += `\n${item.summary}\n`;
        }
        if (item.sources && item.sources.length > 0) {
          learnedMd += `\n**Sources:**\n`;
          for (const s of item.sources) {
            learnedMd += `- [${s.title || s.url}](${s.url})\n`;
          }
        }
        learnedMd += `\n---\n\n`;
      }
    }
  }

  // 2. Generate User_Lessons_&_Corrections.md
  const lessons = d.lessons || [];
  let lessonsMd = `# ⚡ Aloy - Explicit User Lessons & Corrections\n\n`;
  lessonsMd += `> *Direct corrections and strict user rules. These take top priority in every system prompt.*\n`;
  lessonsMd += `> **Last Updated:** ${formattedSyncTime} | **Total Lessons:** ${lessons.length}\n\n`;

  if (lessons.length === 0) {
    lessonsMd += `*No explicit user corrections recorded yet.*\n`;
  } else {
    for (const l of lessons) {
      lessonsMd += `### 📌 ${l.topic || 'User Lesson'}\n`;
      lessonsMd += `- **Recorded:** ${formatDate(l.createdAt)}\n`;
      lessonsMd += `- **Rule / Correction:** ${l.correction}\n\n`;
      lessonsMd += `---\n\n`;
    }
  }

  // 3. Generate Personal_Memories.md
  const memories = d.memories || [];
  let memoriesMd = `# 💾 Aloy - Personal Memories & Profile\n\n`;
  memoriesMd += `> *User preferences, environment specs, and personal assistant memory items.*\n`;
  memoriesMd += `> **Last Updated:** ${formattedSyncTime} | **Total Memories:** ${memories.length}\n\n`;

  if (memories.length === 0) {
    memoriesMd += `*No personal memories stored.*\n`;
  } else {
    memories.forEach((m, idx) => {
      if (typeof m === 'string') {
        memoriesMd += `${idx + 1}. ${m}\n`;
      } else if (typeof m === 'object') {
        memoriesMd += `### ${m.category || `Memory #${idx + 1}`}\n`;
        memoriesMd += `- **Recorded:** ${formatDate(m.createdAt)}\n`;
        memoriesMd += `${m.content}\n\n`;
      }
    });
  }

  // 4. Generate Synthesized_Skills.md
  const skills = d.skills || [];
  let skillsMd = `# 🛠️ Aloy - Synthesized Reusable Skills\n\n`;
  skillsMd += `> *Auto-discovered tool invocation sequences optimized for common tasks.*\n`;
  skillsMd += `> **Last Updated:** ${formattedSyncTime} | **Active Skills:** ${skills.length}\n\n`;

  if (skills.length === 0) {
    skillsMd += `*No synthesized tool skills created yet.*\n`;
  } else {
    for (const s of skills) {
      skillsMd += `### 🔧 ${s.category || 'Tool Skill'}\n`;
      skillsMd += `- **Pattern:** \`${(s.toolSequence || []).join(' → ')}\`\n`;
      skillsMd += `- **Occurrences:** ${s.occurrences || 1} | **Created:** ${formatDate(s.createdAt)}\n`;
      if (s.exampleQuestion) {
        skillsMd += `- **Example Query:** *"${s.exampleQuestion}"*\n`;
      }
      skillsMd += `\n---\n\n`;
    }
  }

  // 5. Generate Harvested_Repositories.md
  const harvestedList = [
    {
      name: 'google/adk-python',
      url: 'https://github.com/google/adk-python',
      domain: 'Multi-Agent Orchestrator',
      description: 'SessionStateStore ({key} template interpolation), AgentAsTool wrapper, SequentialPipeline (A->B->C), ParallelDispatch, and AgentHandoffManager (transfer_to_agent).',
      files: ['apps/desktop/server/adkOrchestrator.cjs', 'apps/desktop/src/services/tools.js']
    },
    {
      name: 'DietrichGebert/ponytail',
      url: 'https://github.com/DietrichGebert/ponytail',
      domain: 'Coding Philosophy',
      description: 'The 7-step Ponytail Decision Ladder for minimal, unbloated code (YAGNI -> Reuse -> Stdlib -> Native -> Deps -> One-Liner -> Minimal).',
      files: ['rules.md']
    },
    {
      name: 'HKUDS/CLI-Anything & CLI-Hub',
      url: 'https://github.com/HKUDS/CLI-Anything',
      domain: 'Agent-Native CLI & Skills',
      description: 'Structured tool output envelopes (wrapToolSuccess / wrapToolError), didYouMean recovery candidates, and automated SKILL.md card synthesis.',
      files: ['apps/desktop/server/cliHubRunner.cjs', 'apps/desktop/server/toolEnvelope.cjs', 'apps/desktop/server/skillSynthesis.cjs']
    },
    {
      name: 'memU (3-Layer Memory)',
      url: 'https://github.com/NevaMind-AI/memU',
      domain: 'Persistent Memory',
      description: '3-layer persistent Markdown memory architecture synchronizing Store memories, learned knowledge, and user lessons into an Obsidian Vault.',
      files: ['apps/desktop/server/vaultSync.cjs']
    },
    {
      name: 'opendatalab/MinerU',
      url: 'https://github.com/opendatalab/MinerU',
      domain: 'Document Normalization',
      description: 'Header hierarchy normalization, multi-column tab-to-GFM markdown tables, and page artifact stripping for uploaded documents.',
      files: ['apps/desktop/server/mineruNormalizer.cjs', 'apps/desktop/server/documentProofread.cjs']
    },
    {
      name: 'OpenHarness',
      url: 'https://github.com/openharness/openharness',
      domain: 'Self-Correction Loop',
      description: 'Automated injection of [SYSTEM HINT] error guidance when tool calls fail, enabling prompt self-healing and recovery.',
      files: ['apps/desktop/server/toolEnvelope.cjs']
    },
    {
      name: 'firecrawl/anydoc',
      url: 'https://github.com/firecrawl/anydoc',
      domain: 'Document Extraction',
      description: 'Structural document parsing across PDF, DOCX, and raw text attachments.',
      files: ['apps/desktop/src/services/fileparser.js']
    },
    {
      name: 'norrdev/OpenGym',
      url: 'https://github.com/norrdev/OpenGym',
      domain: 'Fitness Tracking',
      description: 'Workout logging data model, exercise tracking, and streak calculation.',
      files: ['apps/desktop/src/services/workouts.js']
    },
    {
      name: 'TASVideos/BizHawk',
      url: 'https://github.com/TASVideos/BizHawk',
      domain: 'Gaming & Emulation Bridge',
      description: 'SNES memory domain reading/writing, frame advance, and hazard memory mapping.',
      files: ['apps/desktop/server/bizhawkAutoPlay.cjs']
    },
    {
      name: 'AutoRip / Plex / Jellyfin',
      url: 'https://github.com/automatic-ripping-machine/automatic-ripping-machine',
      domain: 'Media Standardization',
      description: 'Standard TV and Movie folder/episode naming conventions, optical disc ripping state machine, and sidecar media management.',
      files: ['apps/desktop/server/mediaFormatterService.cjs', 'apps/desktop/server/autoRipBridge.cjs', 'apps/desktop/server/jellyfinService.cjs']
    },
    {
      name: 'NousResearch/hermes-agent',
      url: 'https://github.com/NousResearch/hermes-agent',
      domain: 'Autonomous Learning & Zero-Context Pipeline',
      description: 'Zero-context RPC script tool execution pipelines, Genetic-Pareto skill & prompt evolution (GEPA), FTS5 cross-session recall, Honcho dialectic user modeling, and universal messaging gateway.',
      files: ['apps/desktop/server/hermesScriptPipeline.cjs', 'apps/desktop/server/hermesEvolutionEngine.cjs', 'apps/desktop/server/hermesDialecticMemory.cjs', 'apps/desktop/server/hermesGateway.cjs']
    }
  ];

  let harvestedMd = `# 🌾 Aloy - Harvested Open-Source Frameworks & Repositories\n\n`;
  harvestedMd += `> *Open-source architectures, design patterns, and capabilities integrated into Aloy.*\n`;
  harvestedMd += `> **Last Synchronized:** ${formattedSyncTime} | **Total Harvested:** ${harvestedList.length}\n\n`;
  harvestedMd += `| # | Repository | Domain | Key Harvested Capabilities | Files in Aloy |\n`;
  harvestedMd += `| :---: | :--- | :--- | :--- | :--- |\n`;
  harvestedList.forEach((h, idx) => {
    harvestedMd += `| **${idx + 1}** | [${h.name}](${h.url}) | **${h.domain}** | ${h.description} | \`${h.files.join('`, `')}\` |\n`;
  });
  harvestedMd += `\n---\n`;

  // 6. Generate Overview README.md
  let readmeMd = `# 🏛️ Aloy Brain - Memory Vault\n\n`;
  readmeMd += `Welcome to Aloy's persistent Markdown memory bank. This folder is automatically synchronized from Aloy's server data store.\n\n`;
  readmeMd += `## 📊 Quick Overview\n\n`;
  readmeMd += `| Memory Layer | Item Count | File Link |\n`;
  readmeMd += `| :--- | :--- | :--- |\n`;
  readmeMd += `| **Learned Knowledge** | ${learned.length} entries | [[Learned_Knowledge]] |\n`;
  readmeMd += `| **User Lessons & Rules** | ${lessons.length} rules | [[User_Lessons_&_Corrections]] |\n`;
  readmeMd += `| **Personal Memories** | ${memories.length} facts | [[Personal_Memories]] |\n`;
  readmeMd += `| **Synthesized Tool Skills** | ${skills.length} skills | [[Synthesized_Skills]] |\n`;
  readmeMd += `| **Harvested Repositories** | ${harvestedList.length} repos | [[Harvested_Repositories]] |\n\n`;
  readmeMd += `*Last synchronized on: ${formattedSyncTime}*\n`;

  // Write files safely
  try {
    fs.writeFileSync(path.join(memoryDir, 'README.md'), readmeMd, 'utf-8');
    fs.writeFileSync(path.join(memoryDir, 'Learned_Knowledge.md'), learnedMd, 'utf-8');
    fs.writeFileSync(path.join(memoryDir, 'User_Lessons_&_Corrections.md'), lessonsMd, 'utf-8');
    fs.writeFileSync(path.join(memoryDir, 'Personal_Memories.md'), memoriesMd, 'utf-8');
    fs.writeFileSync(path.join(memoryDir, 'Synthesized_Skills.md'), skillsMd, 'utf-8');
    fs.writeFileSync(path.join(memoryDir, 'Harvested_Repositories.md'), harvestedMd, 'utf-8');
    console.log(`[vault-sync] Successfully synchronized Aloy Brain to: ${memoryDir}`);
    return { success: true, syncTime, memoryDir };
  } catch (err) {
    console.error('[vault-sync] Failed to write files to vault:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { syncToVault, getVaultMemoryDir };
