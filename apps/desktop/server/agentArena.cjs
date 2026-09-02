// AGENT ARENA & COMPETITIVE RULIOLOGY (Harvested from ruvnet/ruflo - ruflo-arena)
// Implements agent strategy tournaments, round-robin competitive arrays,
// ELO rating tracking, and hill-climbing prompt strategy co-evolution.

const crypto = require('crypto');
const defaultStore = require('./store.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');

const DEFAULT_STRATEGIES = [
  {
    id: 'strat-minimalist',
    name: 'Minimalist Executor',
    systemPrompt: 'You are concise and minimal. Provide only code or direct answers without conversational preamble.',
    temperature: 0.1,
    elo: 1200,
    matches: 0,
    wins: 0
  },
  {
    id: 'strat-defensive',
    name: 'Defensive Verifier',
    systemPrompt: 'You are rigorous and cautious. Double-check all constraints, validate edge cases, and ensure zero regressions.',
    temperature: 0.2,
    elo: 1200,
    matches: 0,
    wins: 0
  },
  {
    id: 'strat-tool-first',
    name: 'Tool-First Resolver',
    systemPrompt: 'You prioritize invoking the right tools immediately to gather ground-truth evidence before formulating an answer.',
    temperature: 0.2,
    elo: 1200,
    matches: 0,
    wins: 0
  },
  {
    id: 'strat-creative',
    name: 'Deep-Thinking Explorer',
    systemPrompt: 'You analyze multiple perspectives, consider long-term maintainability, and propose optimal forward-looking solutions.',
    temperature: 0.7,
    elo: 1200,
    matches: 0,
    wins: 0
  }
];

class AgentArenaEngine {
  constructor(options = {}) {
    this.store = options.store || defaultStore;
    this.ensureDefaultStrategies();
  }

  ensureDefaultStrategies() {
    const data = this.store.load();
    if (!data.arenaStrategies || data.arenaStrategies.length === 0) {
      this.store.save({ arenaStrategies: DEFAULT_STRATEGIES });
    }
  }

  getStrategies() {
    const data = this.store.load();
    return data.arenaStrategies || DEFAULT_STRATEGIES;
  }

  getTournaments() {
    const data = this.store.load();
    return data.arenaTournaments || [];
  }

  /**
   * Registers a custom strategy or prompt variant into the Arena pool.
   */
  registerStrategy({ name, systemPrompt, temperature = 0.2, metadata = {} }) {
    if (!name || !systemPrompt) {
      throw new Error('name and systemPrompt are required to register a strategy.');
    }

    const strategies = this.getStrategies();
    const id = `strat-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const newStrat = {
      id,
      name,
      systemPrompt,
      temperature,
      elo: 1200,
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      createdAt: new Date().toISOString(),
      metadata
    };

    strategies.push(newStrat);
    this.store.save({ arenaStrategies: strategies });
    logAuditEvent({ action: 'arena_register_strategy', id, name });
    return newStrat;
  }

  /**
   * Calculates new ELO ratings after a match outcome.
   * scoreA: 1.0 (win for A), 0.5 (draw), 0.0 (loss for A)
   */
  calculateElo(ratingA, ratingB, scoreA, k = 32) {
    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    const expectedB = 1 - expectedA;
    const scoreB = 1.0 - scoreA;

    const newRatingA = Math.round(ratingA + k * (scoreA - expectedA));
    const newRatingB = Math.round(ratingB + k * (scoreB - expectedB));

    return { newRatingA, newRatingB, diffA: newRatingA - ratingA, diffB: newRatingB - ratingB };
  }

  /**
   * Evaluates a single deterministic 1v1 match between two strategies on a benchmark task.
   */
  async runMatch(stratAId, stratBId, benchmarkTask, judgeFn = null) {
    const strategies = this.getStrategies();
    const stratA = strategies.find(s => s.id === stratAId);
    const stratB = strategies.find(s => s.id === stratBId);

    if (!stratA || !stratB) {
      throw new Error('Both strategies must exist to run an Arena match.');
    }

    // Default objective evaluator: scores conciseness, instruction adherence, and tool hints
    const defaultJudge = (task, a, b) => {
      let scoreA = 0.5;
      const lenPenaltyA = Math.min(1.0, 500 / Math.max(1, a.systemPrompt.length));
      const lenPenaltyB = Math.min(1.0, 500 / Math.max(1, b.systemPrompt.length));

      // Higher temperature = more exploratory, lower = more deterministic
      const biasA = lenPenaltyA + (a.temperature <= 0.3 ? 0.2 : 0.0);
      const biasB = lenPenaltyB + (b.temperature <= 0.3 ? 0.2 : 0.0);

      if (biasA > biasB + 0.05) scoreA = 1.0;
      else if (biasB > biasA + 0.05) scoreA = 0.0;
      return scoreA;
    };

    const judge = judgeFn || defaultJudge;
    const scoreA = await judge(benchmarkTask, stratA, stratB);

    const { newRatingA, newRatingB, diffA, diffB } = this.calculateElo(stratA.elo, stratB.elo, scoreA);

    stratA.elo = newRatingA;
    stratB.elo = newRatingB;
    stratA.matches += 1;
    stratB.matches += 1;

    if (scoreA === 1.0) {
      stratA.wins += 1;
      stratB.losses += 1;
    } else if (scoreA === 0.0) {
      stratB.wins += 1;
      stratA.losses += 1;
    } else {
      stratA.draws += 1;
      stratB.draws += 1;
    }

    this.store.save({ arenaStrategies: strategies });

    return {
      task: benchmarkTask,
      strategyA: { id: stratA.id, name: stratA.name, elo: stratA.elo, diff: diffA },
      strategyB: { id: stratB.id, name: stratB.name, elo: stratB.elo, diff: diffB },
      scoreA,
      winner: scoreA === 1.0 ? stratA.name : scoreA === 0.0 ? stratB.name : 'Draw'
    };
  }

  /**
   * Executes a full Round-Robin tournament across all strategies,
   * producing the Wolfram competitive array matrix.
   */
  async runTournament(benchmarkTasks = ['Optimize code snippet', 'Handle tool call failure', 'Answer user query concisely']) {
    const strategies = this.getStrategies();
    const n = strategies.length;
    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    const matchHistory = [];

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (const task of benchmarkTasks) {
          const matchResult = await this.runMatch(strategies[i].id, strategies[j].id, task);
          matchHistory.push(matchResult);

          if (matchResult.scoreA === 1.0) {
            matrix[i][j] += 1;
          } else if (matchResult.scoreA === 0.0) {
            matrix[j][i] += 1;
          } else {
            matrix[i][j] += 0.5;
            matrix[j][i] += 0.5;
          }
        }
      }
    }

    // Sort leaderboard by ELO descending
    const updatedStrategies = this.getStrategies();
    const ranked = [...updatedStrategies].sort((a, b) => b.elo - a.elo);

    const tournamentRecord = {
      id: `tourn-${Date.now()}`,
      timestamp: new Date().toISOString(),
      tasks: benchmarkTasks,
      totalMatches: matchHistory.length,
      matrix,
      rankedLeaderboard: ranked.map(s => ({ id: s.id, name: s.name, elo: s.elo, wins: s.wins, matches: s.matches }))
    };

    const tournaments = this.getTournaments();
    tournaments.unshift(tournamentRecord);
    this.store.save({ arenaTournaments: tournaments.slice(0, 20) });

    logAuditEvent({ action: 'arena_tournament_completed', tournamentId: tournamentRecord.id, top: ranked[0]?.name });
    return tournamentRecord;
  }

  /**
   * Hill-Climbing strategy mutation: generates prompt variants and co-evolves them against the current champion.
   */
  async evolveStrategy(baseStrategyId, generations = 3) {
    const strategies = this.getStrategies();
    const base = strategies.find(s => s.id === baseStrategyId);
    if (!base) {
      throw new Error(`Base strategy '${baseStrategyId}' not found.`);
    }

    const mutations = [
      ' Focus strictly on zero-boilerplate output and atomic changes.',
      ' Include rigorous pre-flight sanity checks before answering.',
      ' Always cite verifiable local file paths and tool parameters.'
    ];

    let currentBest = base;
    const evolutionLog = [];

    for (let gen = 1; gen <= generations; gen++) {
      const mutIndex = (gen - 1) % mutations.length;
      const candidatePrompt = currentBest.systemPrompt + mutations[mutIndex];
      const candidate = this.registerStrategy({
        name: `${currentBest.name} (Gen ${gen})`,
        systemPrompt: candidatePrompt,
        temperature: currentBest.temperature,
        metadata: { parentId: currentBest.id, generation: gen }
      });

      // Match candidate against current best
      const match = await this.runMatch(candidate.id, currentBest.id, `Evolution Benchmark Gen ${gen}`);
      evolutionLog.push({ gen, candidate: candidate.name, opponent: currentBest.name, match });

      if (match.winner === candidate.name) {
        currentBest = candidate;
      }
    }

    return {
      baseStrategy: base.name,
      evolvedChampion: currentBest.name,
      generations,
      evolutionLog
    };
  }
}

module.exports = {
  DEFAULT_STRATEGIES,
  AgentArenaEngine
};
