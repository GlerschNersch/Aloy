// Lightweight statistical anomaly detection — plain z-score / frequency
// checks, no model training involved. Unlike LLM fine-tuning (which needs
// hundreds of examples to generalize instead of memorize), these need only
// a handful of prior data points per category/entity to be useful.

const MIN_SPENDING_SAMPLES = 3;
const SPENDING_Z_SCORE_THRESHOLD = 2.5;

// Flags an expense that's a statistical outlier vs. that category's own
// history. Returns null until there's enough history to judge against, or
// when the new transaction isn't actually unusual.
export function detectSpendingAnomaly(transaction, allTransactions) {
  if (transaction.type !== 'expense') return null;

  const priorAmounts = allTransactions
    .filter(t => t.type === 'expense' && t.category === transaction.category && t.id !== transaction.id)
    .map(t => t.amount);

  if (priorAmounts.length < MIN_SPENDING_SAMPLES) return null;

  const mean = priorAmounts.reduce((sum, a) => sum + a, 0) / priorAmounts.length;
  const variance = priorAmounts.reduce((sum, a) => sum + (a - mean) ** 2, 0) / priorAmounts.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return null;

  const zScore = (transaction.amount - mean) / stddev;
  if (zScore < SPENDING_Z_SCORE_THRESHOLD) return null;

  return {
    type: 'spending',
    category: transaction.category,
    message: `📈 Unusual spending: $${transaction.amount.toFixed(2)} in ${transaction.category} is well above your typical $${mean.toFixed(2)} for that category.`
  };
}

const MIN_LOCK_HISTORY = 10;
const RARE_HOUR_FREQUENCY_THRESHOLD = 0.05;
const LOCK_HISTORY_CAP = 500;

// Appends an unlock event (entity + hour-of-day) to the rolling history,
// capped so it doesn't grow unbounded in localStorage.
export function recordUnlockEvent(entityId, history) {
  const event = { entityId, hour: new Date().getHours(), timestamp: new Date().toISOString() };
  return [...history, event].slice(-LOCK_HISTORY_CAP);
}

// Flags an unlock at an hour this entity has rarely or never unlocked at
// before. Returns null until enough history exists for this entity to judge
// what's "normal" for it.
export function detectUnusualUnlock(entityId, history) {
  const priorForEntity = history.filter(e => e.entityId === entityId);
  if (priorForEntity.length < MIN_LOCK_HISTORY) return null;

  const hour = new Date().getHours();
  const sameHourCount = priorForEntity.filter(e => e.hour === hour).length;
  const frequency = sameHourCount / priorForEntity.length;
  if (frequency > RARE_HOUR_FREQUENCY_THRESHOLD) return null;

  const label = entityId.split('.').pop().replace(/_/g, ' ');
  return {
    type: 'unlock',
    entityId,
    message: `🔓 Unusual: ${label} unlocked at ${hour}:00 — no established pattern of unlocking at this hour.`
  };
}
