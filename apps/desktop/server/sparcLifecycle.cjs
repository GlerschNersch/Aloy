// SPARC 5-PHASE LIFECYCLE & QUALITY GATE ENGINE (Harvested from ruvnet/ruflo - ruflo-sparc)
// Implements the rigorous 5-phase software development methodology:
// 1. Specification -> 2. Pseudocode -> 3. Architecture -> 4. Refinement -> 5. Completion
// with deterministic quality gates, acceptance criteria verification, and traceability reports.

const crypto = require('crypto');
const defaultStore = require('./store.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');

const SPARC_PHASES = {
  SPECIFICATION: 'SPECIFICATION',
  PSEUDOCODE: 'PSEUDOCODE',
  ARCHITECTURE: 'ARCHITECTURE',
  REFINEMENT: 'REFINEMENT',
  COMPLETION: 'COMPLETION'
};

const PHASE_ORDER = [
  SPARC_PHASES.SPECIFICATION,
  SPARC_PHASES.PSEUDOCODE,
  SPARC_PHASES.ARCHITECTURE,
  SPARC_PHASES.REFINEMENT,
  SPARC_PHASES.COMPLETION
];

class SparcLifecycleEngine {
  constructor(options = {}) {
    this.store = options.store || defaultStore;
  }

  /**
   * Retrieves all SPARC workflows.
   */
  listWorkflows() {
    const data = this.store.load();
    return data.sparcWorkflows || [];
  }

  /**
   * Retrieves a specific workflow by ID.
   */
  getWorkflow(workflowId) {
    const workflows = this.listWorkflows();
    return workflows.find(w => w.id === workflowId) || null;
  }

  /**
   * Initializes a new SPARC feature workflow.
   */
  createWorkflow({ featureName, goalDescription, initialSpec = {} }) {
    if (!featureName || !goalDescription) {
      throw new Error('featureName and goalDescription are required to initialize a SPARC workflow.');
    }

    const workflows = this.listWorkflows();
    const id = `sparc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    const workflow = {
      id,
      featureName,
      goalDescription,
      currentPhase: SPARC_PHASES.SPECIFICATION,
      status: 'in_progress', // 'in_progress', 'completed', 'blocked'
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phases: {
        [SPARC_PHASES.SPECIFICATION]: {
          status: 'in_progress',
          userStory: initialSpec.userStory || `As a developer, I want ${featureName} so that ${goalDescription}`,
          acceptanceCriteria: initialSpec.acceptanceCriteria || [],
          constraints: initialSpec.constraints || [],
          edgeCases: initialSpec.edgeCases || [],
          gatePassed: false,
          gateReport: null
        },
        [SPARC_PHASES.PSEUDOCODE]: {
          status: 'pending',
          algorithmicFlow: null,
          errorHandlingPaths: [],
          complexityEstimate: null,
          gatePassed: false,
          gateReport: null
        },
        [SPARC_PHASES.ARCHITECTURE]: {
          status: 'pending',
          modules: [],
          apiContracts: [],
          fileChanges: [],
          gatePassed: false,
          gateReport: null
        },
        [SPARC_PHASES.REFINEMENT]: {
          status: 'pending',
          implementationDiffs: [],
          testsExecuted: 0,
          testsPassed: 0,
          testFailures: [],
          gatePassed: false,
          gateReport: null
        },
        [SPARC_PHASES.COMPLETION]: {
          status: 'pending',
          auditPassed: false,
          docsUpdated: false,
          signOffBy: null,
          completedAt: null
        }
      },
      gateHistory: []
    };

    workflows.push(workflow);
    this.store.save({ sparcWorkflows: workflows });
    logAuditEvent({ action: 'sparc_create_workflow', id, featureName });
    return workflow;
  }

  /**
   * Updates data for a specific phase in the workflow.
   */
  updatePhaseData(workflowId, phaseName, dataPatch) {
    const workflows = this.listWorkflows();
    const idx = workflows.findIndex(w => w.id === workflowId);
    if (idx === -1) {
      throw new Error(`SPARC workflow '${workflowId}' not found.`);
    }

    const wf = workflows[idx];
    if (!wf.phases[phaseName]) {
      throw new Error(`Invalid SPARC phase '${phaseName}'.`);
    }

    wf.phases[phaseName] = {
      ...wf.phases[phaseName],
      ...dataPatch
    };
    wf.updatedAt = new Date().toISOString();

    workflows[idx] = wf;
    this.store.save({ sparcWorkflows: workflows });
    return wf;
  }

  /**
   * Deterministic quality gate validator.
   * Checks strict phase readiness before permitting phase advancement.
   */
  evaluateQualityGate(workflow, phaseName) {
    const phase = workflow.phases[phaseName];
    const blockers = [];
    const checks = [];

    switch (phaseName) {
      case SPARC_PHASES.SPECIFICATION: {
        const acCount = (phase.acceptanceCriteria || []).length;
        const hasAc = acCount >= 3;
        checks.push({ name: 'Min 3 Acceptance Criteria', passed: hasAc, detail: `Found ${acCount} criteria` });
        if (!hasAc) blockers.push(`Specification must define at least 3 distinct acceptance criteria (current: ${acCount}).`);

        const hasConstraints = (phase.constraints || []).length >= 1;
        checks.push({ name: 'System Constraints Defined', passed: hasConstraints, detail: `Found ${(phase.constraints || []).length} constraints` });
        if (!hasConstraints) blockers.push('Specification must define at least 1 architectural/operational constraint.');
        break;
      }

      case SPARC_PHASES.PSEUDOCODE: {
        const hasFlow = typeof phase.algorithmicFlow === 'string' && phase.algorithmicFlow.trim().length >= 30;
        checks.push({ name: 'Algorithmic Flow Detailed', passed: hasFlow, detail: hasFlow ? 'Passed' : 'Flow is too brief or empty' });
        if (!hasFlow) blockers.push('Pseudocode must contain detailed step-by-step algorithmic flow (min 30 chars).');

        const hasErrorPaths = (phase.errorHandlingPaths || []).length >= 1;
        checks.push({ name: 'Explicit Error Paths', passed: hasErrorPaths, detail: `Found ${(phase.errorHandlingPaths || []).length} paths` });
        if (!hasErrorPaths) blockers.push('Pseudocode must explicitly outline at least 1 error handling / recovery path.');
        break;
      }

      case SPARC_PHASES.ARCHITECTURE: {
        const hasModules = (phase.modules || []).length >= 1;
        checks.push({ name: 'Component/Module Breakdown', passed: hasModules, detail: `Found ${(phase.modules || []).length} modules` });
        if (!hasModules) blockers.push('Architecture must define component modules.');

        const hasFiles = (phase.fileChanges || []).length >= 1;
        checks.push({ name: 'Affected Files Mapped', passed: hasFiles, detail: `Found ${(phase.fileChanges || []).length} files` });
        if (!hasFiles) blockers.push('Architecture must specify target files to create or modify.');
        break;
      }

      case SPARC_PHASES.REFINEMENT: {
        const hasDiffs = (phase.implementationDiffs || []).length >= 1;
        checks.push({ name: 'Implementation Diffs Present', passed: hasDiffs, detail: `Found ${(phase.implementationDiffs || []).length} diffs` });
        if (!hasDiffs) blockers.push('Refinement requires implementation code diffs or code changes.');

        const testsRun = Number(phase.testsExecuted || 0) > 0;
        const noFails = (phase.testFailures || []).length === 0 && Number(phase.testsPassed || 0) > 0;
        checks.push({ name: 'Test Verification Clean', passed: testsRun && noFails, detail: `${phase.testsPassed}/${phase.testsExecuted} tests passed` });
        if (!testsRun || !noFails) blockers.push(`All unit/integration tests must pass cleanly (Current: ${phase.testsPassed || 0}/${phase.testsExecuted || 0} passed).`);
        break;
      }

      case SPARC_PHASES.COMPLETION: {
        const audit = !!phase.auditPassed;
        checks.push({ name: 'Security & PII Audit Passed', passed: audit, detail: audit ? 'Clean' : 'Pending' });
        if (!audit) blockers.push('Final security, PII, and privacy audit must pass before completion.');
        break;
      }

      default:
        blockers.push(`Unknown SPARC phase: ${phaseName}`);
    }

    const passed = blockers.length === 0;
    return {
      phaseName,
      passed,
      evaluatedAt: new Date().toISOString(),
      checks,
      blockers
    };
  }

  /**
   * Attempts to advance the workflow across its quality gate to the next SPARC phase.
   */
  advancePhase(workflowId) {
    const workflows = this.listWorkflows();
    const idx = workflows.findIndex(w => w.id === workflowId);
    if (idx === -1) {
      throw new Error(`SPARC workflow '${workflowId}' not found.`);
    }

    const wf = workflows[idx];
    const currentPhase = wf.currentPhase;
    const gateEval = this.evaluateQualityGate(wf, currentPhase);

    wf.gateHistory.push(gateEval);
    wf.phases[currentPhase].gatePassed = gateEval.passed;
    wf.phases[currentPhase].gateReport = gateEval;

    if (!gateEval.passed) {
      wf.status = 'blocked';
      wf.updatedAt = new Date().toISOString();
      workflows[idx] = wf;
      this.store.save({ sparcWorkflows: workflows });

      logAuditEvent({ action: 'sparc_gate_blocked', workflowId, phase: currentPhase, blockers: gateEval.blockers });
      return {
        success: false,
        phase: currentPhase,
        advanced: false,
        gateReport: gateEval
      };
    }

    // Gate passed -> Advance to next phase
    wf.phases[currentPhase].status = 'completed';
    const currentIdx = PHASE_ORDER.indexOf(currentPhase);

    if (currentIdx === PHASE_ORDER.length - 1) {
      // Completed last phase
      wf.status = 'completed';
      wf.phases[currentPhase].completedAt = new Date().toISOString();
    } else {
      const nextPhase = PHASE_ORDER[currentIdx + 1];
      wf.currentPhase = nextPhase;
      wf.phases[nextPhase].status = 'in_progress';
      wf.status = 'in_progress';
    }

    wf.updatedAt = new Date().toISOString();
    workflows[idx] = wf;
    this.store.save({ sparcWorkflows: workflows });

    logAuditEvent({ action: 'sparc_phase_advanced', workflowId, from: currentPhase, to: wf.currentPhase });
    return {
      success: true,
      phase: wf.currentPhase,
      advanced: true,
      workflow: wf
    };
  }

  /**
   * Generates a comprehensive GFM Markdown traceability report for a SPARC workflow.
   */
  generateReport(workflowId) {
    const wf = this.getWorkflow(workflowId);
    if (!wf) {
      throw new Error(`SPARC workflow '${workflowId}' not found.`);
    }

    let md = `# 🛡️ SPARC Methodology Report: ${wf.featureName}\n\n`;
    md += `> **Workflow ID:** \`${wf.id}\` | **Status:** **${wf.status.toUpperCase()}** | **Current Phase:** **${wf.currentPhase}**\n\n`;
    md += `### 🎯 Goal Description\n${wf.goalDescription}\n\n---\n\n`;

    PHASE_ORDER.forEach((phaseKey, i) => {
      const p = wf.phases[phaseKey];
      const icon = p.status === 'completed' ? '✅' : p.status === 'in_progress' ? '🔄' : '⏳';
      md += `## Phase ${i + 1}: ${icon} ${phaseKey}\n`;
      md += `- **Status:** ${p.status}\n`;
      md += `- **Gate Passed:** ${p.gatePassed ? 'Yes' : 'No'}\n\n`;

      if (phaseKey === SPARC_PHASES.SPECIFICATION) {
        md += `#### Acceptance Criteria\n`;
        (p.acceptanceCriteria || []).forEach((ac, idx) => {
          md += `${idx + 1}. ${ac}\n`;
        });
        md += `\n#### Constraints\n`;
        (p.constraints || []).forEach(c => { md += `- ${c}\n`; });
      } else if (phaseKey === SPARC_PHASES.PSEUDOCODE) {
        md += `#### Flow Outline\n\`\`\`\n${p.algorithmicFlow || 'Pending'}\n\`\`\`\n`;
      } else if (phaseKey === SPARC_PHASES.ARCHITECTURE) {
        md += `#### Target Files\n`;
        (p.fileChanges || []).forEach(f => { md += `- \`${f}\`\n`; });
      } else if (phaseKey === SPARC_PHASES.REFINEMENT) {
        md += `#### Verification Status\n`;
        md += `- Tests: ${p.testsPassed || 0} passed / ${p.testsExecuted || 0} executed\n`;
      }
      md += `\n---\n\n`;
    });

    return md;
  }
}

module.exports = {
  SPARC_PHASES,
  PHASE_ORDER,
  SparcLifecycleEngine
};
