// Agentic Multi-Step Planner & Execution Kernel for Aloy.
// Implements Plan-and-Solve with dry-run verification, risk tiering, and rollback.

const { validatePathAccess, validateSmartHomeAction } = require('./securityGuard.cjs');
const { globalRollbackManager } = require('./rollbackManager.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');

/**
 * Risk tiers for plan steps.
 */
const RISK_TIERS = {
  AUTONOMOUS: 'autonomous', // Read-only, queries, listings
  CONFIRM_REQUIRED: 'confirm_required', // Writes, state toggles
  CRITICAL_2FA: 'critical_2fa' // Door unlocks, deletes, high stakes
};

class ActionPlan {
  constructor({ goal, steps = [] }) {
    this.id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.goal = goal;
    this.steps = steps.map((s, idx) => ({
      id: `step-${idx + 1}`,
      title: s.title,
      tool: s.tool,
      args: s.args || {},
      riskTier: s.riskTier || RISK_TIERS.AUTONOMOUS,
      requires2FA: !!s.requires2FA,
      status: 'pending', // 'pending' | 'dry_run_passed' | 'executing' | 'completed' | 'failed' | 'rolled_back'
      result: null,
      error: null
    }));
    this.createdAt = new Date().toISOString();
    this.status = 'created'; // 'created' | 'dry_run' | 'in_progress' | 'completed' | 'failed'
  }
}

class AgenticPlanner {
  constructor() {
    this.activePlans = new Map();
  }

  /**
   * Evaluates the risk tier of a planned tool call.
   */
  classifyStepRisk(toolName, args = {}) {
    if (toolName.includes('list_directory') || toolName.includes('read_') || toolName.includes('get_') || toolName.includes('search_')) {
      return { riskTier: RISK_TIERS.AUTONOMOUS, requires2FA: false };
    }

    if (toolName === 'control_smart_home_device') {
      const isUnlock = args.domain === 'lock' && (args.service === 'unlock' || args.service === 'open');
      if (isUnlock) {
        return { riskTier: RISK_TIERS.CRITICAL_2FA, requires2FA: true };
      }
      return { riskTier: RISK_TIERS.CONFIRM_REQUIRED, requires2FA: false };
    }

    if (toolName.includes('write_') || toolName.includes('edit_') || toolName.includes('delete_') || toolName.includes('create_')) {
      return { riskTier: RISK_TIERS.CONFIRM_REQUIRED, requires2FA: false };
    }

    return { riskTier: RISK_TIERS.AUTONOMOUS, requires2FA: false };
  }

  /**
   * Creates and risk-analyzes a structured execution plan.
   */
  createPlan(goal, rawSteps) {
    const analyzedSteps = rawSteps.map(step => {
      const { riskTier, requires2FA } = this.classifyStepRisk(step.tool, step.args);
      return {
        ...step,
        riskTier,
        requires2FA
      };
    });

    const plan = new ActionPlan({ goal, steps: analyzedSteps });
    this.activePlans.set(plan.id, plan);
    return plan;
  }

  /**
   * Performs a dry-run check on each step of the plan.
   */
  async dryRunPlan(planId) {
    const plan = this.activePlans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    plan.status = 'dry_run';
    const validationIssues = [];

    for (const step of plan.steps) {
      if (step.tool.includes('filesystem') && step.args.path) {
        const pathCheck = validatePathAccess(step.args.path, step.tool.includes('write'));
        if (!pathCheck.allowed) {
          validationIssues.push({ stepId: step.id, issue: pathCheck.reason });
          step.status = 'failed';
          step.error = pathCheck.reason;
          continue;
        }
      }

      if (step.tool === 'control_smart_home_device') {
        const check = validateSmartHomeAction({
          domain: step.args.domain,
          service: step.args.service,
          entityId: step.args.entity_id
        });
        if (check.requires2FA) {
          step.requires2FA = true;
          step.riskTier = RISK_TIERS.CRITICAL_2FA;
        }
      }

      step.status = 'dry_run_passed';
    }

    const passed = validationIssues.length === 0;
    logAuditEvent({
      category: 'system',
      action: 'planner_dry_run',
      target: plan.goal,
      status: passed ? 'success' : 'error',
      details: passed ? 'Dry-run validation succeeded for all plan steps.' : `Issues found: ${JSON.stringify(validationIssues)}`
    });

    return { passed, validationIssues, plan };
  }

  /**
   * Executes a plan step by step with error containment and rollback on failure.
   */
  async executePlan(planId, { toolExecutor, authContext = {} }) {
    const plan = this.activePlans.get(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    plan.status = 'in_progress';
    const executedStepRollbacks = [];

    for (const step of plan.steps) {
      // If critical 2FA is required and not verified, pause for approval
      if (step.riskTier === RISK_TIERS.CRITICAL_2FA && !authContext.pinVerified) {
        step.status = 'pending';
        return {
          status: 'paused_for_2fa',
          plan,
          blockingStep: step,
          reason: `Step "${step.title}" requires 2FA PIN verification.`
        };
      }

      try {
        step.status = 'executing';
        const result = await toolExecutor(step.tool, step.args);
        step.result = result;
        step.status = 'completed';

        // Register rollback for file modifications if snapshot captured
        if (step.args.path && step.tool.includes('write')) {
          const snapshotPath = globalRollbackManager.captureFileSnapshot(step.args.path);
          if (snapshotPath) {
            const rbId = globalRollbackManager.pushAction({
              type: 'file_edit',
              description: `Undo ${step.title}`,
              undoContext: { snapshotPath, originalPath: step.args.path }
            });
            executedStepRollbacks.push(rbId);
          }
        }

        logAuditEvent({
          category: 'system',
          action: 'step_completed',
          target: step.title,
          status: 'success'
        });
      } catch (err) {
        step.status = 'failed';
        step.error = err.message;
        plan.status = 'failed';

        // Roll back completed steps
        for (const rbId of executedStepRollbacks.reverse()) {
          await globalRollbackManager.rollback(rbId);
        }

        logAuditEvent({
          category: 'system',
          action: 'plan_failed_rollback',
          target: plan.goal,
          status: 'error',
          details: `Step "${step.title}" failed: ${err.message}. Rolled back prior mutations.`
        });

        return {
          status: 'failed',
          error: `Plan failed at step "${step.title}": ${err.message}. Changes rolled back.`,
          plan
        };
      }
    }

    plan.status = 'completed';
    return { status: 'completed', plan };
  }
}

const globalPlanner = new AgenticPlanner();

module.exports = {
  RISK_TIERS,
  ActionPlan,
  AgenticPlanner,
  globalPlanner
};
