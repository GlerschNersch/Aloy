// Lightweight, dependency-free prompt-size reduction for the large context
// blocks Aloy injects (HA automations, calendar events, dashboard configs).
// NOT a real compression model (LLMLingua-2 and similar, as used by tools
// like OmniRoute) — that would need a trained token-classifier model and a
// new local Python microservice, a much bigger lift for uncertain benefit
// given num_ctx already has headroom. This is just removing formatting
// noise and capping genuinely uncapped verbose blocks — safe enough to
// apply unconditionally with no real information loss.

// Collapses trailing whitespace and runs of 3+ blank lines down to a single
// blank line. Pure formatting noise that still costs real tokens to a
// tokenizer — zero information loss.
export function trimWhitespace(text) {
  if (!text) return text;
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Caps a list-shaped context block (one item per line) to the first N
// lines plus a one-line "...and N more" note — generalizes the pattern
// formatAutomationsContext already uses for its scripts list, applied
// somewhere that currently has no cap at all (e.g. the calendar event
// dump, observed live at 74 uncapped lines for a single 7-day window).
export function capLines(text, maxLines, noun = 'items') {
  if (!text) return text;
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  const kept = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;
  kept.push(`...and ${remaining} more ${noun} not shown (ask again more specifically, e.g. by date range, if you need them).`);
  return kept.join('\n');
}

// --- Context-window-proportional section budgets (added 2026-08-04, ---
// harvested from KiroCrew's proportional-context-allocation design) ---
//
// capLines above used a hardcoded line count (30, picked ad-hoc for the
// calendar-event bug) that has no relationship to how much context is
// actually available — it'd stay 30 forever even if num_ctx changed. This
// generalizes that into a real budget: known model context window, minus a
// reserved chunk for the ~20K-char tool schema (38 tools — see the num_ctx
// overflow bug root-caused 2026-08-01) and response headroom, split
// proportionally by weight across whichever context sections are competing
// for it. Char-based rather than a real tokenizer (none is used anywhere
// else in this codebase) — approximate on purpose, good enough for sizing
// soft caps, not claiming token-exact accuracy.

// Keep in sync with `ollama show aloy-assistant --modelfile`'s real num_ctx if that
// Modelfile is ever changed again — this constant is NOT read live from
// Ollama (no such lookup exists elsewhere in the app), so a future context
// bump needs this updated by hand too.
const MODEL_CONTEXT_TOKENS = 24576;
const CHARS_PER_TOKEN = 3.5;
// Deliberately small: injected per-message context blocks (calendar,
// automations, dashboards, etc.) need to stay a SMALL slice of the window.
// Most of num_ctx has to stay free for the ~20K-char tool schema (38 tools
// — see the num_ctx overflow bug root-caused 2026-08-01) and multi-turn
// conversation history, which grows independently of any single injected
// block and isn't accounted for here at all. 8% is calibrated to land close
// to the original flat "30 events" cap's real-world footprint (~1800-2700
// chars) rather than ballooning just because num_ctx is large — the actual
// win from this change is automatic RESCALING if num_ctx is ever changed,
// not a bigger budget by default.
const INJECTED_CONTEXT_SHARE = 0.08;
const AVAILABLE_CONTEXT_CHARS = MODEL_CONTEXT_TOKENS * CHARS_PER_TOKEN * INJECTED_CONTEXT_SHARE;

// Shared weights for the known variable-size injected context blocks —
// exported so both App.jsx and aloyServer.cjs allocate from the exact same
// split rather than each guessing their own. calendarEvents currently the
// only block actually wired to consume its share (see the call sites); the
// others are reserved room so wiring them later doesn't require re-deriving
// the split.
export const INJECTED_SECTION_WEIGHTS = {
  calendarEvents: 2,
  automationScripts: 1,
  automationDetails: 1,
  dashboardConfig: 1
};

// weights: { sectionName: relativeWeight, ... } — returns a per-section
// character budget proportional to its weight's share of the total.
export function allocateContextBudget(weights) {
  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0) || 1;
  const budgets = {};
  for (const [name, weight] of Object.entries(weights)) {
    budgets[name] = Math.floor((weight / totalWeight) * AVAILABLE_CONTEXT_CHARS);
  }
  return budgets;
}

// Same shape/behavior as capLines, but the cutoff is a character budget
// (from allocateContextBudget) rather than a fixed line count — a verbose
// block (long event names) gets fewer items than a terse one for the same
// budget, which a flat line-count cap can't express.
export function capLinesToBudget(text, charBudget, noun = 'items') {
  if (!text) return text;
  const lines = text.split('\n');
  let used = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    used += lines[i].length + 1;
    if (used > charBudget) break;
  }
  if (i >= lines.length) return text; // fits entirely within budget
  const kept = lines.slice(0, Math.max(1, i));
  const remaining = lines.length - kept.length;
  kept.push(`...and ${remaining} more ${noun} not shown (ask again more specifically, e.g. by date range, if you need them).`);
  return kept.join('\n');
}
