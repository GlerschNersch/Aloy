// Workout logging — data model harvested from OpenGym (norrdev/OpenGym)'s
// SQL schema: a workout entry is a session (date, optional notes) containing
// one or more logged exercises (name, sets, reps, weight). Deliberately not
// replicating OpenGym's full program-builder/exercise-catalog/muscle-mapping
// system — this is a log, not a training-program constructor.

export function createWorkoutEntry(exercises, notes) {
  return {
    id: `workout-${Date.now()}`,
    date: new Date().toISOString(),
    exercises: (exercises || []).map((e) => ({
      name: e.name,
      sets: e.sets ?? null,
      reps: e.reps ?? null,
      weight: e.weight ?? null
    })),
    notes: notes || ''
  };
}

// Current streak: consecutive calendar days with at least one logged
// workout, counting back from today. A gap of a day breaks it.
export function calculateWorkoutStreak(workouts) {
  if (!workouts || workouts.length === 0) return 0;
  const days = new Set(workouts.map((w) => new Date(w.date).toDateString()));
  let streak = 0;
  const cursor = new Date();
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Keyword match against a Google Calendar event's summary to decide whether
// it's a workout. Deliberately keyword-based, not a calendar/category the
// user would have to set up separately — matches whatever they already
// happen to name their gym/training events.
const WORKOUT_KEYWORDS = [
  'gym', 'workout', 'work out', 'run', 'running', 'yoga', 'cardio', 'cycling',
  'spin class', 'swim', 'lift', 'lifting', 'leg day', 'push day', 'pull day',
  'arm day', 'crossfit', 'pilates', 'hiit', 'bootcamp', 'training session',
  'personal training', 'exercise'
];

// Meal/nutrition-timing reminders ("Meal 3: Pre-Workout Snack") legitimately
// contain "workout" as a substring but aren't workouts themselves — found via
// real calendar data (e.g. recurring pre-workout meal-prep reminders).
// Excluded regardless of which other keyword matched.
const NON_WORKOUT_KEYWORDS = ['meal', 'snack'];

export function isWorkoutEvent(summary) {
  if (!summary) return false;
  const lower = summary.toLowerCase();
  if (NON_WORKOUT_KEYWORDS.some((kw) => lower.includes(kw))) return false;
  return WORKOUT_KEYWORDS.some((kw) => lower.includes(kw));
}

export function filterWorkoutCalendarEvents(events) {
  return (events || []).filter((ev) => isWorkoutEvent(ev.summary));
}

export function formatWorkoutHistoryContext(workouts, limit = 10) {
  if (!workouts || workouts.length === 0) return 'No workouts logged yet.';
  const recent = [...workouts].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limit);
  return recent
    .map((w) => {
      const exList = w.exercises.map((e) => `${e.name} ${e.sets ?? '?'}x${e.reps ?? '?'} @ ${e.weight ?? '?'}`).join(', ');
      return `${new Date(w.date).toLocaleDateString()}: ${exList}${w.notes ? ` — ${w.notes}` : ''}`;
    })
    .join('\n');
}
