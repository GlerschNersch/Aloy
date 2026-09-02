import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Wallet,
  TrendingUp,
  TrendingDown,
  Plus,
  Trash2,
  PiggyBank
} from 'lucide-react';
import {
  DEFAULT_CATEGORIES,
  getCurrentMonthKey,
  calculateSummary,
  calculateCategoryTotals,
  calculateBudgetStatus
} from '../services/financeTracker';
import FinanceTrendsChart from './FinanceTrendsChart';

const BUDGET_STATUS_COLOR = {
  ok: { color: '#4ade80', bar: 'linear-gradient(90deg, #22c55e, #4ade80)' },
  warning: { color: '#fde047', bar: 'linear-gradient(90deg, #eab308, #fde047)' },
  over: { color: '#f87171', bar: 'linear-gradient(90deg, #dc2626, #f87171)' }
};

export default function FinancesPanel({ isOpen, onClose, transactions, budgets, onAddTransaction, onDeleteTransaction, onSetBudget, onDeleteBudget }) {
  const [type, setType] = useState('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [budgetCategory, setBudgetCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [budgetLimit, setBudgetLimit] = useState('');

  const monthKey = getCurrentMonthKey();
  const summary = calculateSummary(transactions, monthKey);
  const categoryTotals = calculateCategoryTotals(transactions, monthKey);
  const budgetStatus = calculateBudgetStatus(budgets, transactions, monthKey);

  const allCategories = Array.from(new Set([...DEFAULT_CATEGORIES, ...transactions.map(t => t.category)]));

  const handleAdd = (e) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return;
    onAddTransaction({
      id: `tx-${Date.now()}`,
      type,
      amount: parsedAmount,
      category: category.trim() || 'Other',
      description: description.trim(),
      date: new Date(date).toISOString()
    });
    setAmount('');
    setDescription('');
  };

  const handleSetBudget = (e) => {
    e.preventDefault();
    const parsedLimit = parseFloat(budgetLimit);
    if (!parsedLimit || parsedLimit <= 0) return;
    onSetBudget({ category: budgetCategory.trim() || 'Other', limit: parsedLimit });
    setBudgetLimit('');
  };

  const recentTransactions = [...transactions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 30);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
            display: 'flex', justifyContent: 'flex-end',
            background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(8px)'
          }}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className="glass-panel"
            style={{
              width: '500px', maxWidth: '92vw', height: '100%',
              background: 'rgba(16, 20, 31, 0.98)',
              borderLeft: '1px solid rgba(0, 242, 254, 0.35)',
              display: 'flex', flexDirection: 'column',
              boxShadow: '-10px 0 50px rgba(0, 0, 0, 0.9)'
            }}
          >
            {/* Header */}
            <div style={{
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '12px',
                  background: 'rgba(0, 242, 254, 0.15)', border: '1px solid rgba(0, 242, 254, 0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00f2fe'
                }}>
                  <Wallet size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', margin: 0 }}>Finances</h3>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Local-only tracking, budgets & trends</span>
                </div>
              </div>
              <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '6px', borderRadius: '8px' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem' }}>
                <div className="glass-panel" style={{ padding: '0.75rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Income</span>
                  <span style={{ fontSize: '1rem', fontWeight: 700, color: '#4ade80', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <TrendingUp size={14} /> ${summary.income.toFixed(2)}
                  </span>
                </div>
                <div className="glass-panel" style={{ padding: '0.75rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Expenses</span>
                  <span style={{ fontSize: '1rem', fontWeight: 700, color: '#f87171', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <TrendingDown size={14} /> ${summary.expenses.toFixed(2)}
                  </span>
                </div>
                <div className="glass-panel" style={{ padding: '0.75rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Net</span>
                  <span style={{ fontSize: '1rem', fontWeight: 700, color: summary.net >= 0 ? '#00f2fe' : '#f87171' }}>
                    ${summary.net.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Add Transaction */}
              <form onSubmit={handleAdd} className="glass-panel" style={{ padding: '1rem', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#00f2fe', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Add Transaction
                </span>

                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button type="button" onClick={() => setType('expense')} style={{
                    flex: 1, padding: '6px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                    border: type === 'expense' ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255,255,255,0.08)',
                    background: type === 'expense' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                    color: type === 'expense' ? '#f87171' : '#94a3b8'
                  }}>Expense</button>
                  <button type="button" onClick={() => setType('income')} style={{
                    flex: 1, padding: '6px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                    border: type === 'income' ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(255,255,255,0.08)',
                    background: type === 'income' ? 'rgba(34, 197, 94, 0.15)' : 'transparent',
                    color: type === 'income' ? '#4ade80' : '#94a3b8'
                  }}>Income</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <input type="number" step="0.01" min="0" placeholder="Amount" value={amount}
                    onChange={(e) => setAmount(e.target.value)} className="glass-input"
                    style={{ padding: '0.5rem 0.7rem', borderRadius: '8px', fontSize: '0.85rem' }} required />
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="glass-input"
                    style={{ padding: '0.5rem 0.7rem', borderRadius: '8px', fontSize: '0.85rem' }} />
                </div>

                <input list="finance-categories" placeholder="Category" value={category}
                  onChange={(e) => setCategory(e.target.value)} className="glass-input"
                  style={{ padding: '0.5rem 0.7rem', borderRadius: '8px', fontSize: '0.85rem' }} />
                <datalist id="finance-categories">
                  {allCategories.map(c => <option key={c} value={c} />)}
                </datalist>

                <input type="text" placeholder="Description (optional)" value={description}
                  onChange={(e) => setDescription(e.target.value)} className="glass-input"
                  style={{ padding: '0.5rem 0.7rem', borderRadius: '8px', fontSize: '0.85rem' }} />

                <button type="submit" style={{
                  padding: '0.6rem', borderRadius: '10px', border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)', color: '#000',
                  fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                }}>
                  <Plus size={15} /> Add
                </button>
              </form>

              {/* Budgets */}
              <div className="glass-panel" style={{ padding: '1rem', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#c084fc', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <PiggyBank size={14} /> Monthly Budgets
                </span>

                {budgetStatus.length === 0 ? (
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>No budgets set yet.</div>
                ) : (
                  budgetStatus.map((b) => {
                    const colors = BUDGET_STATUS_COLOR[b.status];
                    return (
                      <div key={b.category} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{b.category}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: colors.color, fontWeight: 600 }}>
                              ${b.spent.toFixed(0)} / ${b.limit.toFixed(0)} ({b.pct.toFixed(0)}%)
                            </span>
                            <button onClick={() => onDeleteBudget(b.category)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px' }}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <div style={{ width: '100%', height: '6px', borderRadius: '20px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, b.pct)}%`, height: '100%', borderRadius: '20px', background: colors.bar, transition: 'width 0.4s ease' }} />
                        </div>
                      </div>
                    );
                  })
                )}

                <form onSubmit={handleSetBudget} style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem' }}>
                  <input list="finance-categories" placeholder="Category" value={budgetCategory}
                    onChange={(e) => setBudgetCategory(e.target.value)} className="glass-input"
                    style={{ flex: 1, padding: '0.45rem 0.6rem', borderRadius: '8px', fontSize: '0.8rem' }} />
                  <input type="number" min="0" placeholder="$ limit" value={budgetLimit}
                    onChange={(e) => setBudgetLimit(e.target.value)} className="glass-input"
                    style={{ width: '90px', padding: '0.45rem 0.6rem', borderRadius: '8px', fontSize: '0.8rem' }} />
                  <button type="submit" style={{
                    padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid rgba(168, 85, 247, 0.4)',
                    background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer'
                  }}>Set</button>
                </form>
              </div>

              {/* Trends chart */}
              <FinanceTrendsChart categoryTotals={categoryTotals} />

              {/* Recent transactions */}
              <div className="glass-panel" style={{ padding: '1rem', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Recent Transactions
                </span>
                {recentTransactions.length === 0 ? (
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>No transactions logged yet.</div>
                ) : (
                  recentTransactions.map((t) => (
                    <div key={t.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.8rem'
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ color: '#e2e8f0', fontWeight: 600 }}>
                          {t.category}{t.description ? ` · ${t.description}` : ''}
                        </span>
                        <span style={{ color: '#64748b', fontSize: '0.72rem' }}>{t.date.slice(0, 10)}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ color: t.type === 'income' ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                          {t.type === 'income' ? '+' : '-'}${t.amount.toFixed(2)}
                        </span>
                        <button onClick={() => onDeleteTransaction(t.id)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
