// Personal finance tracking — 100% local (localStorage), no external bank
// connections or third-party financial APIs. Pure data/formatting helpers;
// state itself lives in App.jsx like everything else in this app.

export const DEFAULT_CATEGORIES = [
  'Groceries', 'Dining', 'Transport', 'Housing', 'Utilities',
  'Entertainment', 'Health', 'Shopping', 'Income', 'Other'
];

export function getMonthKey(dateStr) {
  return (dateStr || new Date().toISOString()).slice(0, 7); // 'YYYY-MM'
}

export function getCurrentMonthKey() {
  return getMonthKey(new Date().toISOString());
}

export function filterByMonth(transactions, monthKey) {
  return transactions.filter(t => getMonthKey(t.date) === monthKey);
}

export function calculateSummary(transactions, monthKey = getCurrentMonthKey()) {
  const monthTx = filterByMonth(transactions, monthKey);
  const income = monthTx.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const expenses = monthTx.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  return { income, expenses, net: income - expenses };
}

export function calculateCategoryTotals(transactions, monthKey = getCurrentMonthKey()) {
  const totals = {};
  filterByMonth(transactions, monthKey)
    .filter(t => t.type === 'expense')
    .forEach(t => {
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    });
  return totals;
}

// Returns budget health per category with a budget set: 'ok' (<80%),
// 'warning' (80-100%), 'over' (>100%).
export function calculateBudgetStatus(budgets, transactions, monthKey = getCurrentMonthKey()) {
  const totals = calculateCategoryTotals(transactions, monthKey);
  return budgets.map(b => {
    const spent = totals[b.category] || 0;
    const pct = b.limit > 0 ? (spent / b.limit) * 100 : 0;
    const status = pct >= 100 ? 'over' : pct >= 80 ? 'warning' : 'ok';
    return { ...b, spent, pct: Math.min(pct, 999), status };
  });
}

// Formats a compact finance summary for the AI prompt context — mirrors the
// pattern used for Smart Home / Project Status: only injected when the
// user's message actually asks about finances (see App.jsx).
export function formatFinanceContext(transactions, budgets) {
  const monthKey = getCurrentMonthKey();
  const { income, expenses, net } = calculateSummary(transactions, monthKey);
  const categoryTotals = calculateCategoryTotals(transactions, monthKey);
  const budgetStatus = calculateBudgetStatus(budgets, transactions, monthKey);

  let ctx = `[LIVE FINANCE SUMMARY — ${monthKey}]\n`;
  ctx += `Income: $${income.toFixed(2)} | Expenses: $${expenses.toFixed(2)} | Net: $${net.toFixed(2)}\n`;

  if (Object.keys(categoryTotals).length > 0) {
    ctx += `Spending by category this month:\n`;
    Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, amt]) => { ctx += `- ${cat}: $${amt.toFixed(2)}\n`; });
  }

  if (budgetStatus.length > 0) {
    ctx += `Budget status:\n`;
    budgetStatus.forEach(b => {
      ctx += `- ${b.category}: $${b.spent.toFixed(2)} / $${b.limit.toFixed(2)} (${b.pct.toFixed(0)}%, ${b.status.toUpperCase()})\n`;
    });
  }

  const recent = [...transactions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);
  if (recent.length > 0) {
    ctx += `Recent transactions:\n`;
    recent.forEach(t => {
      const sign = t.type === 'income' ? '+' : '-';
      ctx += `- ${t.date.slice(0, 10)} ${sign}$${t.amount.toFixed(2)} ${t.category}${t.description ? ` (${t.description})` : ''}\n`;
    });
  }

  return ctx;
}
