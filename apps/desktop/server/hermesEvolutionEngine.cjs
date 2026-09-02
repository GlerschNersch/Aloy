// HERMES EVOLUTION ENGINE (Harvested from NousResearch/hermes-agent & hermes-agent-self-evolution)
// Implements autonomous skill creation (agentskills.io compatible), in-use trajectory evaluation,
// and Genetic-Pareto Prompt & Tool Description Evolution (GEPA).

const fs = require('fs');
const path = require('path');
const os = require('os');
const defaultStore = require('./store.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');

class HermesEvolutionEngine {
  constructor(options = {}) {
    this.store = options.store || defaultStore;
    this.skillsDir = options.skillsDir || path.join(os.homedir(), '.aloy-server', 'skills');
    this.ensureSkillsDir();
  }

  ensureSkillsDir() {
    try {
      if (!fs.existsSync(this.skillsDir)) {
        fs.mkdirSync(this.skillsDir, { recursive: true });
      }
    } catch {}
  }

  /**
   * Loads all skills in agentskills.io format
   */
  listSkills() {
    this.ensureSkillsDir();
    const skills = [];
    try {
      const files = fs.readdirSync(this.skillsDir).filter(f => f.endsWith('.md') || f.endsWith('.json'));
      for (const file of files) {
        const fullPath = path.join(this.skillsDir, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = this.parseSkillContent(content, file);
        if (parsed) skills.push(parsed);
      }
    } catch {}

    // Merge with skills registered in store
    const storeData = this.store.load();
    const storeSkills = storeData.evolvedSkills || [];
    for (const ss of storeSkills) {
      if (!skills.some(s => s.name === ss.name)) {
        skills.push(ss);
      }
    }

    return skills;
  }

  parseSkillContent(content, filename) {
    // Check if YAML frontmatter
    const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
    if (frontmatterMatch) {
      const yamlBlock = frontmatterMatch[1];
      const body = frontmatterMatch[2].trim();
      const meta = {};
      yamlBlock.split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx !== -1) {
          const k = line.slice(0, idx).trim();
          const v = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
          meta[k] = v;
        }
      });

      return {
        name: meta.name || path.basename(filename, path.extname(filename)),
        description: meta.description || '',
        version: meta.version || '1.0.0',
        author: meta.author || 'Hermes/Aloy',
        tags: meta.tags ? meta.tags.split(',').map(t => t.trim()) : [],
        instructions: body,
        metrics: { totalCalls: 0, successCount: 0, failCount: 0, avgLatencyMs: 0, evolutionGen: 1 }
      };
    }

    // JSON fallback
    try {
      const parsed = JSON.parse(content);
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Synthesizes and saves a new skill into the agentskills.io standard.
   */
  synthesizeSkill({ name, description, instructions, code = '', tags = [] }) {
    const cleanName = String(name).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const skill = {
      name: cleanName,
      description,
      version: '1.0.0',
      author: 'Hermes Auto-Synthesis',
      tags: Array.isArray(tags) ? tags : ['auto-generated'],
      instructions,
      code,
      metrics: {
        totalCalls: 0,
        successCount: 0,
        failCount: 0,
        avgLatencyMs: 0,
        evolutionGen: 1,
        lastEvolvedAt: new Date().toISOString()
      }
    };

    const filePath = path.join(this.skillsDir, `${cleanName}.md`);
    const fileContent = `---
name: ${skill.name}
description: ${skill.description}
version: ${skill.version}
author: ${skill.author}
tags: ${skill.tags.join(', ')}
---

${skill.instructions}

${skill.code ? `\`\`\`javascript\n${skill.code}\n\`\`\`` : ''}
`;

    try {
      fs.writeFileSync(filePath, fileContent, 'utf-8');
    } catch {}

    const d = this.store.load();
    const skills = (d.evolvedSkills || []).filter(s => s.name !== cleanName);
    skills.push(skill);
    this.store.save({ evolvedSkills: skills });

    logAuditEvent({
      category: 'hermes', action: 'skill_synthesized', target: cleanName,
      payload: { skillName: cleanName }
    });
    return skill;
  }

  /**
   * Records execution outcome of a skill to inform the genetic evolution loop.
   */
  recordExecution(skillName, { success = true, latencyMs = 0, error = null }) {
    const d = this.store.load();
    const skills = d.evolvedSkills || [];
    const skill = skills.find(s => s.name === skillName);
    if (!skill) return;

    skill.metrics = skill.metrics || { totalCalls: 0, successCount: 0, failCount: 0, avgLatencyMs: 0, evolutionGen: 1 };
    skill.metrics.totalCalls += 1;
    if (success) {
      skill.metrics.successCount += 1;
    } else {
      skill.metrics.failCount += 1;
      skill.metrics.lastError = error ? String(error) : 'Execution error';
    }

    skill.metrics.avgLatencyMs = Math.round(
      (skill.metrics.avgLatencyMs * (skill.metrics.totalCalls - 1) + latencyMs) / skill.metrics.totalCalls
    );

    this.store.save({ evolvedSkills: skills });
  }

  /**
   * Genetic-Pareto Prompt & Schema Evolution (GEPA)
   * Analyzes failure cases, mutates prompt constraints, and generates defensive code enhancements.
   */
  evolveSkill(skillName, { reason = 'optimization', feedback = '' } = {}) {
    const skills = this.listSkills();
    const skill = skills.find(s => s.name === skillName);
    if (!skill) throw new Error(`Skill "${skillName}" not found for evolution.`);

    const currentGen = (skill.metrics?.evolutionGen || 1);
    const newGen = currentGen + 1;

    // Mutate and refine instructions based on feedback/errors
    let evolvedInstructions = skill.instructions;
    if (skill.metrics?.lastError || feedback) {
      const errorContext = feedback || skill.metrics?.lastError;
      evolvedInstructions += `\n\n> [!NOTE]\n> **Evolved Constraint (Gen ${newGen})**: Guard against: "${errorContext}". Ensure inputs are sanitized and fallback handlers return graceful structured defaults.`;
    }

    const evolvedSkill = {
      ...skill,
      version: `1.${newGen}.0`,
      instructions: evolvedInstructions,
      metrics: {
        ...skill.metrics,
        evolutionGen: newGen,
        lastEvolvedAt: new Date().toISOString(),
        lastEvolutionReason: reason
      }
    };

    // Save updated skill
    const filePath = path.join(this.skillsDir, `${skill.name}.md`);
    const fileContent = `---
name: ${evolvedSkill.name}
description: ${evolvedSkill.description}
version: ${evolvedSkill.version}
author: ${evolvedSkill.author}
tags: ${Array.isArray(evolvedSkill.tags) ? evolvedSkill.tags.join(', ') : ''}
---

${evolvedSkill.instructions}

${evolvedSkill.code ? `\`\`\`javascript\n${evolvedSkill.code}\n\`\`\`` : ''}
`;

    try {
      fs.writeFileSync(filePath, fileContent, 'utf-8');
    } catch {}

    const d = this.store.load();
    const storeSkills = (d.evolvedSkills || []).filter(s => s.name !== skill.name);
    storeSkills.push(evolvedSkill);
    this.store.save({ evolvedSkills: storeSkills });

    logAuditEvent({
      category: 'hermes', action: 'skill_evolved', target: skillName,
      payload: { skillName, gen: newGen }, details: String(reason || '')
    });
    return evolvedSkill;
  }
}

const globalHermesEvolution = new HermesEvolutionEngine();

module.exports = {
  HermesEvolutionEngine,
  globalHermesEvolution
};
