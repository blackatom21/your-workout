import { useState, useEffect, useCallback } from "react";

// ── Equipment context passed to the AI ──────────────────────────────────────
const EQUIPMENT_DESCRIPTION = `
- Bowflex SelectTech adjustable dumbbells (adjustable weight, single pair)
- Adjustable bench (can be set flat, incline, or decline)
- Treadmill (good for warm-up cardio and cool-down walking)
- Major Fitness F22 power rack, which includes ALL of the following built-in, with these specific cable attachments — USE THEM for variety:
    • Standard Olympic barbell (35 lbs)
    • Multi-grip pull-up bar (wide, neutral, and close-grip handles) — pull-ups, chin-ups
    • Dual cable pulley system (2:1 ratio, so the resistance you FEEL is about half the weight loaded) with these included attachments:
        – Lat pulldown bar → lat pulldowns, straight-arm pulldowns
        – Straight bar → cable curls, triceps pushdowns, cable rows, upright rows
        – Stirrup / D handles (pair) → single-arm cable rows, cable flyes, face pulls, lateral raises
        – T-bar / landmine row handle → T-bar rows
    • 360° landmine attachment → landmine press, landmine squat-to-press, rotations, RDLs
    • Rack-mounted dip bars (two grip widths) → dips, inverted rows
    • Low row footplate → seated cable rows
    • Band pegs (top and bottom)
- Available plates for both barbell and cable system: two 35 lb plates, two 15 lb plates, two 10 lb plates
- Barbell weighs 35 lbs (lighter than a standard Olympic bar)
- Achievable barbell totals (35 lb bar + plates): 35, 55, 65, 85, 105, 125, 135, 155 lbs
`.trim();

const FOCUS_OPTIONS = ["Full Body", "Upper Body", "Lower Body", "Core", "Push", "Pull", "Legs"];

// ── Progressive Overload Engine ──────────────────────────────────────────────
// The user's barbell weighs 35 lbs (not the standard 45). All barbell math
// derives from this so the achievable loads are correct.
const BAR_WEIGHT = 35;
// Achievable BARBELL totals from a 35 lb bar + plates (2×35, 2×15, 2×10).
// Per-side combos from {35,15,10}: 0,10,15,25,35,45,50,60 → ×2 + 35 bar = below.
const BARBELL_LADDER = [35, 55, 65, 85, 105, 125, 135, 155];

// Bowflex SelectTech DUMBBELL increments (per dumbbell), default = 552 model.
// If you own the 1090, swap to: [10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90]
const DUMBBELL_LADDER = [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 30, 35, 40, 45, 50, 52.5];

// Generic fallback ladder for cable/other loaded movements (5 lb steps).
const GENERIC_LADDER = Array.from({ length: 40 }, (_, i) => 5 + i * 5); // 5..200

function ladderFor(equipment) {
  switch ((equipment || "").toLowerCase()) {
    case "barbell": return BARBELL_LADDER;
    case "dumbbell": return DUMBBELL_LADDER;
    case "cable":
    case "other": return GENERIC_LADDER;
    default: return null; // bodyweight → no external load
  }
}

// Nearest achievable load at or below a target (so we never over-prescribe).
function snapWeight(ladder, target) {
  if (!ladder || target == null) return null;
  let best = ladder[0];
  for (const w of ladder) { if (w <= target) best = w; else break; }
  return best;
}

// Next step up the ladder (one increment heavier), capped at the top.
function nextWeight(ladder, current) {
  if (!ladder) return null;
  for (const w of ladder) { if (w > current) return w; }
  return ladder[ladder.length - 1]; // already at max
}

// One step down (for deloads), floored at the bottom.
function prevWeight(ladder, current) {
  if (!ladder) return null;
  let prev = ladder[0];
  for (const w of ladder) { if (w < current) prev = w; else break; }
  return prev;
}

// Human-readable barbell plate breakdown, e.g. 105 → "35 bar + 35/side".
function barbellPlateLabel(total) {
  const perSide = (total - BAR_WEIGHT) / 2;
  if (perSide <= 0) return `${BAR_WEIGHT} lb bar (empty)`;
  const plates = [35, 15, 10];
  const used = [];
  let rem = perSide;
  for (const p of plates) { if (rem >= p) { used.push(p); rem -= p; } }
  return `${BAR_WEIGHT} bar + ${used.join("+")}/side`;
}

function weightLabel(equipment, weight) {
  if (weight == null) return "Bodyweight";
  const eq = (equipment || "").toLowerCase();
  if (eq === "barbell") return `${weight} lbs · ${barbellPlateLabel(weight)}`;
  if (eq === "dumbbell") return `${weight} lbs each dumbbell`;
  // F22 cables are 2:1, so felt resistance ≈ half the plate weight loaded.
  if (eq === "cable") return `${weight} lbs felt (load ~${weight * 2} lbs on the cable)`;
  return `${weight} lbs`;
}

// Normalize an exercise name so "Barbell Back Squat" == "barbell back squat".
function normalizeName(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// Parse a reps string like "8-10" or "12" into { low, high }.
function parseRepRange(reps) {
  if (typeof reps === "number") return { low: reps, high: reps };
  const m = String(reps || "").match(/(\d+)\s*[-–]\s*(\d+)/);
  if (m) return { low: +m[1], high: +m[2] };
  const single = String(reps || "").match(/(\d+)/);
  if (single) return { low: +single[1], high: +single[1] };
  return { low: 8, high: 12 };
}

// From a completed exercise's log, derive what actually happened.
function summarizePerformance(logEntries, repHigh) {
  const done = logEntries.filter(e => e.done);
  if (done.length === 0) return { completedAllSets: false, hitTopOfRange: false, workingWeight: null };
  const completedAllSets = done.length === logEntries.length;
  const weights = done.map(e => Number(e.weight)).filter(w => !isNaN(w) && w > 0);
  const workingWeight = weights.length ? Math.max(...weights) : null;
  const reps = done.map(e => Number(e.reps)).filter(r => !isNaN(r) && r > 0);
  const hitTopOfRange = reps.length === done.length && reps.every(r => r >= repHigh);
  return { completedAllSets, hitTopOfRange, workingWeight };
}

// Given a ledger entry, produce the prescription the user should aim for today.
// Returns { weight, label, note } — weight is code-authoritative (snapped).
function prescribe(entry) {
  if (!entry) return null;
  const ladder = ladderFor(entry.equipment);
  if (!ladder) {
    // Bodyweight: progress reps, not load.
    return {
      weight: null,
      label: "Bodyweight",
      note: entry.sessions > 0
        ? `Aim for ${entry.repHigh} reps per set`
        : "New — establish your baseline reps",
    };
  }
  const weight = snapWeight(ladder, entry.currentWeight);
  let note;
  if (entry.sessions === 0) {
    note = "New — establish your baseline";
  } else if (entry.lastAction === "increase") {
    note = `↑ Increased from ${entry.previousWeight} lbs — new target`;
  } else if (entry.lastAction === "deload") {
    note = `↓ Deloaded from ${entry.previousWeight} lbs — rebuild`;
  } else {
    note = `Repeat ${weight} lbs — aim for ${entry.repHigh} reps to progress`;
  }
  return { weight, label: weightLabel(entry.equipment, weight), note };
}

// Apply double-progression rules to one exercise after a completed workout.
// Mutates and returns an updated ledger entry.
function advanceLedgerEntry(prev, perf, repRange, equipment) {
  const ladder = ladderFor(equipment);
  const base = prev || {
    equipment,
    repLow: repRange.low,
    repHigh: repRange.high,
    currentWeight: ladder ? snapWeight(ladder, perf.workingWeight ?? ladder[0]) : null,
    previousWeight: null,
    sessions: 0,
    consecutiveFailures: 0,
    lastAction: "baseline",
  };

  // Anchor current weight to what they actually lifted, if logged.
  let current = base.currentWeight;
  if (ladder && perf.workingWeight != null) {
    current = snapWeight(ladder, perf.workingWeight);
  }

  let next = { ...base, equipment, repLow: repRange.low, repHigh: repRange.high };
  next.sessions = base.sessions + 1;
  next.previousWeight = current;

  if (!ladder) {
    // Bodyweight progression is rep-based; just record the session.
    next.currentWeight = null;
    next.lastAction = perf.hitTopOfRange ? "increase" : "repeat";
    next.consecutiveFailures = perf.completedAllSets ? 0 : base.consecutiveFailures + 1;
    return next;
  }

  if (perf.completedAllSets && perf.hitTopOfRange) {
    // Earned the jump: one increment up, reset rep target to bottom of range.
    next.currentWeight = nextWeight(ladder, current);
    next.lastAction = next.currentWeight > current ? "increase" : "repeat";
    next.consecutiveFailures = 0;
  } else if (perf.completedAllSets) {
    // Finished all sets but not at the top — repeat, chase more reps.
    next.currentWeight = current;
    next.lastAction = "repeat";
    next.consecutiveFailures = 0;
  } else {
    // Missed sets — count a failure; deload after two in a row.
    const fails = base.consecutiveFailures + 1;
    if (fails >= 2) {
      next.currentWeight = prevWeight(ladder, current);
      next.lastAction = "deload";
      next.consecutiveFailures = 0;
    } else {
      next.currentWeight = current;
      next.lastAction = "repeat";
      next.consecutiveFailures = fails;
    }
  }
  return next;
}

// ── localStorage helpers ─────────────────────────────────────────────────────
const LS_KEYS = {
  exercises: "yw_exercises",
  logs: "yw_logs",
  completedSets: "yw_completedSets",
  focus: "yw_focus",
  screen: "yw_screen",
  lastDate: "yw_lastDate",
  history: "yw_history",
  routineMeta: "yw_routineMeta",
  sectionChecks: "yw_sectionChecks",
  ledger: "yw_ledger",
};

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric",
    }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}

function dayOfWeekFromIso(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { weekday: "long" });
  } catch { return ""; }
}

// ── JSON parsing helpers ─────────────────────────────────────────────────────
// With responseMimeType: "application/json" the proxy returns clean JSON,
// but these stay tolerant of markdown fences or stray surrounding text.
function parseArray(text) {
  if (!text) return null;
  // Try direct parse first (the expected case)
  try {
    const v = JSON.parse(text.trim());
    if (Array.isArray(v)) return v;
  } catch {}
  // Fall back to extracting a fenced or bare array
  try {
    const m = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\[[\s\S]*\])/);
    if (m) {
      const v = JSON.parse(m[1]);
      if (Array.isArray(v)) return v;
    }
  } catch {}
  return null;
}

function parseObject(text) {
  if (!text) return null;
  try {
    const v = JSON.parse(text.trim());
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}
  try {
    const m = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
    if (m) return JSON.parse(m[1]);
  } catch {}
  return null;
}

// The full routine is a JSON object with estimated_minutes, warmup,
// exercises[], and cooldown — same parsing path as a plain object.
function parseRoutine(text) {
  return parseObject(text);
}

// Build the text block that teaches the AI today's progression targets.
function buildProgressionBriefing(ledger, history, focus) {
  const entries = Object.values(ledger || {});
  let out = "";

  if (entries.length > 0) {
    out += "\nPROGRESSION LEDGER — these are tracked lifts. When one fits today's focus, REUSE ITS EXACT NAME so progressive overload continues. Do NOT set their weight (the app computes it):\n";
    // Show the most relevant / recently trained first, cap at 12 lines.
    const sorted = entries.sort((a, b) => (b.sessions || 0) - (a.sessions || 0)).slice(0, 12);
    for (const e of sorted) {
      const load = ladderFor(e.equipment)
        ? `${snapWeight(ladderFor(e.equipment), e.currentWeight)} lbs`
        : "bodyweight";
      out += `- "${e.name}" (${e.equipment}): current ${load}, target reps ${e.repLow}-${e.repHigh}\n`;
    }
  }

  if (history && history.length > 0) {
    out += "\nRECENT SESSIONS (avoid hammering the same muscles two days running):\n";
    for (const rec of history.slice(0, 3)) {
      const names = rec.exercises.map(x => x.name).join(", ");
      out += `- ${rec.dayOfWeek || ""} (${rec.focus}): ${names}\n`;
    }
  }

  return out;
}

// After the AI returns exercises, attach code-authoritative prescriptions.
// Tracked lifts get weight from the ledger; new lifts seed from the AI's hint.
function applyPrescriptions(rawExercises, ledger) {
  return rawExercises.map((e, i) => {
    const key = normalizeName(e.name);
    const known = ledger[key];
    const equipment = (e.equipment || known?.equipment || "other").toLowerCase();
    const range = parseRepRange(e.reps);

    let rx;
    if (known) {
      rx = prescribe({ ...known, equipment, repLow: range.low, repHigh: range.high });
    } else {
      // New exercise: seed weight from the AI's numeric hint, snapped to a ladder.
      const ladder = ladderFor(equipment);
      const hinted = Number(e.start_weight);
      const seed = ladder
        ? snapWeight(ladder, !isNaN(hinted) && hinted > 0 ? hinted : ladder[0])
        : null;
      rx = {
        weight: seed,
        label: weightLabel(equipment, seed),
        note: "New — establish your baseline",
      };
    }

    return {
      ...e,
      id: `ex-${Date.now()}-${i}`,
      equipment,
      reps: e.reps,
      prescribedWeight: rx.weight,
      prescribedLabel: rx.label,
      progressionNote: rx.note,
      tracked: !!known,
    };
  });
}

// ── Root component ───────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]             = useState(() => lsGet(LS_KEYS.screen, "setup"));
  const [focus, setFocus]               = useState(() => lsGet(LS_KEYS.focus, "Full Body"));
  const [exercises, setExercises]       = useState(() => lsGet(LS_KEYS.exercises, []));
  const [logs, setLogs]                 = useState(() => lsGet(LS_KEYS.logs, {}));
  const [completedSets, setCompletedSets] = useState(() => lsGet(LS_KEYS.completedSets, {}));
  const [routineMeta, setRoutineMeta]   = useState(() => lsGet(LS_KEYS.routineMeta, null));
  const [sectionChecks, setSectionChecks] = useState(() => lsGet(LS_KEYS.sectionChecks, {}));
  const [history, setHistory]           = useState(() => lsGet(LS_KEYS.history, []));
  const [ledger, setLedger]             = useState(() => lsGet(LS_KEYS.ledger, {}));
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [swappingIndex, setSwappingIndex] = useState(null);

  // Persist every state change to localStorage
  useEffect(() => { lsSet(LS_KEYS.screen, screen); }, [screen]);
  useEffect(() => { lsSet(LS_KEYS.focus, focus); }, [focus]);
  useEffect(() => { lsSet(LS_KEYS.exercises, exercises); }, [exercises]);
  useEffect(() => { lsSet(LS_KEYS.logs, logs); }, [logs]);
  useEffect(() => { lsSet(LS_KEYS.completedSets, completedSets); }, [completedSets]);
  useEffect(() => { lsSet(LS_KEYS.ledger, ledger); }, [ledger]);
  useEffect(() => { lsSet(LS_KEYS.routineMeta, routineMeta); }, [routineMeta]);
  useEffect(() => { lsSet(LS_KEYS.sectionChecks, sectionChecks); }, [sectionChecks]);
  useEffect(() => { lsSet(LS_KEYS.history, history); }, [history]);

  // Auto-reset logs if it's a new day (keep exercises, clear progress)
  useEffect(() => {
    const last = lsGet(LS_KEYS.lastDate, null);
    const today = todayStr();
    if (last && last !== today) {
      setLogs({});
      setCompletedSets({});
      setSectionChecks({});
    }
    lsSet(LS_KEYS.lastDate, today);
  }, []);

  // ── API call (proxied through /api/generate → Gemini) ────────────────────
  const callAI = useCallback(async (prompt) => {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "API error");
    return data.text || "";
  }, []);

  // ── Generate full routine ─────────────────────────────────────────────────
  const generateRoutine = useCallback(async () => {
    setLoading(true);
    setError(null);
    const briefing = buildProgressionBriefing(ledger, history, focus);
    const prompt = `You are a certified strength and conditioning coach running a progressive-overload program. Build today's complete workout session using ONLY this equipment:
${EQUIPMENT_DESCRIPTION}

Focus: ${focus}.
${briefing}
TRAINING PHILOSOPHY — every routine must reflect ALL of these together:
- Functional strength: compound, real-world movement patterns (push, pull, hinge, squat, carry, rotate), progressed over time.
- Mobility & flexibility: dynamic joint mobility in the warm-up and meaningful long-hold static stretching in the cool-down; favor full-range main exercises.
- Cardiovascular endurance: treadmill in the warm-up and cool-down, plus at least one conditioning / higher-rep element among the main exercises when it fits the focus.
- Equipment variety: make real use of the F22's cable attachments across sessions — lat pulldown bar, straight bar, D/stirrup handles, T-bar/landmine handle — and the landmine and dip bars, not just the barbell and dumbbells. Pick the attachment that best fits each movement.

PROGRESSION RULES:
- Prefer reusing tracked lifts from the PROGRESSION LEDGER that fit today's focus, using their EXACT names, so the app can apply progressive overload. Keep their rep ranges stable session to session.
- You may add new exercises for variety, balance, mobility, or conditioning.
- IMPORTANT: do NOT prescribe specific weights — the app calculates all loads. For each MAIN exercise, set "equipment" to one of: "barbell", "dumbbell", "cable", "bodyweight", or "other". For brand-new loaded exercises only, you may include a rough "start_weight" number in lbs as a starting hint.

The session MUST have three parts: warm-up (treadmill cardio + dynamic mobility), exactly 6 main exercises, and cool-down (treadmill walk + static stretching).
Also estimate total time in minutes (warm-up + main work + cool-down) accounting for sets, rest, and transitions.

Respond ONLY with a JSON object (no markdown, no extra text) in EXACTLY this shape:
{
  "estimated_minutes": 55,
  "warmup": {
    "title": "Warm-Up & Dynamic Mobility",
    "duration": "6 min",
    "activities": ["5 min treadmill brisk walk or light jog", "Leg swings, 10 each side", "World's greatest stretch, 5 each side"]
  },
  "exercises": [
    {"name":"Barbell Back Squat","sets":3,"reps":"8-12","muscles":"Quads, Glutes","equipment":"barbell","description":"Full-depth squat, knees tracking toes.","start_weight":95}
  ],
  "cooldown": {
    "title": "Cool-Down & Static Stretching",
    "duration": "6 min",
    "activities": ["3 min treadmill walk", "Hamstring stretch, 30 sec each", "Hip flexor stretch, 30 sec each"]
  }
}
Make everything practical and well-balanced for this exact equipment and focus.`;

    try {
      const text = await callAI(prompt);
      const routine = parseRoutine(text);
      if (routine && Array.isArray(routine.exercises) && routine.exercises.length > 0) {
        const withRx = applyPrescriptions(routine.exercises, ledger);
        setExercises(withRx);
        setRoutineMeta({
          estimatedMinutes: routine.estimated_minutes ?? null,
          warmup: routine.warmup ?? null,
          cooldown: routine.cooldown ?? null,
        });
        setLogs({});
        setCompletedSets({});
        setSectionChecks({});
        setScreen("routine");
      } else {
        setError("Couldn't parse the routine — tap Generate to try again.");
      }
    } catch (e) {
      setError(e.message || "Something went wrong.");
    }
    setLoading(false);
  }, [focus, callAI, ledger, history]);

  // ── Swap a single exercise ────────────────────────────────────────────────
  const handleSwap = useCallback(async (index) => {
    setSwappingIndex(index);
    setError(null);
    const existing = exercises.map(e => e.name).join(", ");
    const toReplace = exercises[index]?.name;
    const prompt = `You are a strength coach. The user has:
${EQUIPMENT_DESCRIPTION}

Their current routine is: ${existing}.
Replace "${toReplace}" with a DIFFERENT functional, full-range exercise using only the equipment listed. Keep the focus: ${focus}.
Do NOT prescribe a weight — the app computes loads. Set "equipment" to one of: "barbell", "dumbbell", "cable", "bodyweight", or "other". You may include a rough "start_weight" number in lbs as a hint for loaded movements.
Respond ONLY with a single JSON object (no markdown, no extra text):
{"name":"Exercise Name","sets":3,"reps":"8-12","muscles":"Quads, Glutes","equipment":"barbell","description":"Brief technique tip.","start_weight":95}`;

    try {
      const text = await callAI(prompt);
      const obj = parseObject(text);
      if (obj && obj.name) {
        const oldId = exercises[index]?.id;
        const [prescribed] = applyPrescriptions([obj], ledger);
        const updated = [...exercises];
        updated[index] = prescribed;
        setExercises(updated);
        setLogs(prev => { const n = { ...prev }; delete n[oldId]; return n; });
        setCompletedSets(prev => {
          const n = { ...prev };
          Object.keys(n).filter(k => k.startsWith(oldId)).forEach(k => delete n[k]);
          return n;
        });
      } else {
        setError("Couldn't parse replacement — tap swap to try again.");
      }
    } catch (e) {
      setError(e.message || "Swap failed.");
    }
    setSwappingIndex(null);
  }, [exercises, focus, callAI, ledger]);

  // ── Log helpers ───────────────────────────────────────────────────────────
  const getLog = (exerciseId, sets) =>
    logs[exerciseId] || Array.from({ length: sets }, (_, i) => ({ set: i + 1, weight: "", reps: "" }));

  const updateLog = (exerciseId, setIndex, field, value) => {
    const clamped = value === "" ? "" : Math.max(0, Number(value));
    setLogs(prev => {
      const current = prev[exerciseId] || Array.from({ length: 99 }, (_, i) => ({ set: i + 1, weight: "", reps: "" }));
      const updated = [...current];
      updated[setIndex] = { ...updated[setIndex], [field]: clamped };
      return { ...prev, [exerciseId]: updated };
    });
  };

  const toggleSetDone = (exerciseId, setIndex) => {
    const key = `${exerciseId}-${setIndex}`;
    setCompletedSets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // ── Remove an exercise from the current routine ───────────────────────────
  const removeExercise = useCallback((exerciseId) => {
    setExercises(prev => prev.filter(ex => ex.id !== exerciseId));
    setLogs(prev => { const n = { ...prev }; delete n[exerciseId]; return n; });
    setCompletedSets(prev => {
      const n = { ...prev };
      Object.keys(n).filter(k => k.startsWith(exerciseId)).forEach(k => delete n[k]);
      return n;
    });
  }, []);

  // ── Check off a warm-up / cool-down activity ──────────────────────────────
  const toggleSectionCheck = useCallback((key) => {
    setSectionChecks(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Progress ──────────────────────────────────────────────────────────────
  const totalSets = exercises.reduce((a, ex) => a + ex.sets, 0);
  const totalSetsCompleted = exercises.reduce((a, ex) => {
    for (let i = 0; i < ex.sets; i++) if (completedSets[`${ex.id}-${i}`]) a++;
    return a;
  }, 0);
  const progress = totalSets > 0 ? Math.round((totalSetsCompleted / totalSets) * 100) : 0;

  // ── Save the finished workout as a record + advance the ledger ────────────
  const completeWorkout = useCallback(() => {
    if (exercises.length === 0) return;
    const now = new Date();
    const record = {
      id: `rec-${Date.now()}`,
      date: now.toISOString(),
      dayOfWeek: now.toLocaleDateString(undefined, { weekday: "long" }),
      focus,
      totalSets,
      completedSets: totalSetsCompleted,
      estimatedMinutes: routineMeta?.estimatedMinutes ?? null,
      warmup: routineMeta?.warmup ?? null,
      cooldown: routineMeta?.cooldown ?? null,
      exercises: exercises.map(ex => ({
        name: ex.name,
        muscles: ex.muscles,
        reps: ex.reps,
        sets: ex.sets,
        equipment: ex.equipment,
        prescribedLabel: ex.prescribedLabel,
        progressionNote: ex.progressionNote,
        description: ex.description,
        log: getLog(ex.id, ex.sets).slice(0, ex.sets).map((entry, i) => ({
          set: i + 1,
          weight: entry.weight ?? "",
          reps: entry.reps ?? "",
          done: !!completedSets[`${ex.id}-${i}`],
        })),
      })),
    };

    // Advance the progression ledger from this session's logged performance.
    setLedger(prev => {
      const next = { ...prev };
      for (const ex of exercises) {
        const key = normalizeName(ex.name);
        const range = parseRepRange(ex.reps);
        const logEntries = getLog(ex.id, ex.sets).slice(0, ex.sets).map((entry, i) => ({
          weight: entry.weight,
          reps: entry.reps,
          done: !!completedSets[`${ex.id}-${i}`],
        }));
        const perf = summarizePerformance(logEntries, range.high);
        // Only progress exercises the user actually engaged with this session.
        const touched = logEntries.some(e => e.done || (e.weight !== "" && e.weight != null));
        if (!touched && !next[key]) continue;
        next[key] = {
          ...advanceLedgerEntry(next[key], perf, range, ex.equipment || "other"),
          name: ex.name, // preserve display casing
          lastDate: now.toISOString(),
        };
      }
      return next;
    });

    setHistory(prev => [record, ...prev]);
    setLogs({});
    setCompletedSets({});
    setSectionChecks({});
    setScreen("history");
  }, [exercises, focus, totalSets, totalSetsCompleted, completedSets, logs, routineMeta]);

  // ── Repeat a saved workout as a fresh active routine ──────────────────────
  // Re-applies CURRENT ledger prescriptions so repeating reflects progression.
  const repeatWorkout = useCallback((record) => {
    const raw = record.exercises.map(ex => ({
      name: ex.name,
      muscles: ex.muscles,
      reps: ex.reps,
      sets: ex.sets,
      equipment: ex.equipment || "other",
      description: ex.description,
    }));
    const fresh = applyPrescriptions(raw, ledger);
    setFocus(record.focus);
    setExercises(fresh);
    setRoutineMeta({
      estimatedMinutes: record.estimatedMinutes ?? null,
      warmup: record.warmup ?? null,
      cooldown: record.cooldown ?? null,
    });
    setLogs({});
    setCompletedSets({});
    setSectionChecks({});
    setScreen("routine");
  }, [ledger]);

  const deleteRecord = useCallback((id) => {
    setHistory(prev => prev.filter(r => r.id !== id));
  }, []);

  // ── Wipe everything (testing reset) ───────────────────────────────────────
  const resetAllData = useCallback(() => {
    Object.values(LS_KEYS).forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });
    setExercises([]);
    setLogs({});
    setCompletedSets({});
    setRoutineMeta(null);
    setSectionChecks({});
    setHistory([]);
    setLedger({});
    setFocus("Full Body");
    setError(null);
    setScreen("setup");
  }, []);

  return (
    <div style={s.app}>
      {screen === "setup" && (
        <SetupScreen
          focus={focus} setFocus={setFocus}
          onGenerate={generateRoutine}
          loading={loading} error={error}
          hasExistingRoutine={exercises.length > 0}
          onResume={() => setScreen("routine")}
          historyCount={history.length}
          onViewHistory={() => setScreen("history")}
          onResetAll={resetAllData}
          ledgerCount={Object.keys(ledger).length}
          onViewProgress={() => setScreen("progress")}
        />
      )}
      {screen === "routine" && (
        <RoutineScreen
          exercises={exercises} loading={loading} swappingIndex={swappingIndex}
          onSwap={handleSwap} onRefresh={generateRoutine} onBack={() => setScreen("setup")}
          logs={logs} getLog={getLog} updateLog={updateLog}
          completedSets={completedSets} toggleSetDone={toggleSetDone}
          progress={progress} totalSetsCompleted={totalSetsCompleted}
          totalSets={totalSets} focus={focus} error={error}
          onComplete={completeWorkout}
          routineMeta={routineMeta}
          sectionChecks={sectionChecks} toggleSectionCheck={toggleSectionCheck}
          onRemove={removeExercise}
        />
      )}
      {screen === "history" && (
        <HistoryScreen
          history={history}
          onBack={() => setScreen("setup")}
          onRepeat={repeatWorkout}
          onDelete={deleteRecord}
        />
      )}
      {screen === "progress" && (
        <ProgressScreen
          ledger={ledger}
          onBack={() => setScreen("setup")}
        />
      )}
    </div>
  );
}

// ── Setup Screen ─────────────────────────────────────────────────────────────
function SetupScreen({ focus, setFocus, onGenerate, loading, error, hasExistingRoutine, onResume, historyCount, onViewHistory, onResetAll, ledgerCount, onViewProgress }) {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div style={s.container}>
      <div style={s.headerRow}>
        <div style={{ flex: 1 }} />
        <div style={s.header}>
          <h1 style={s.title}>YourWorkout</h1>
          <p style={s.subtitle}>Daily Routines Built Around Your Gear</p>
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onViewHistory} style={s.historyIconBtn} title="Workout history">
            🗂️{historyCount > 0 && <span style={s.historyCount}>{historyCount}</span>}
          </button>
        </div>
      </div>

      <section style={s.section}>
        <h2 style={s.sectionLabel}>YOUR EQUIPMENT</h2>
        <div style={s.gearCard}>
          <GearRow icon="🏋️" name="Bowflex SelectTech Dumbbells" detail="Adjustable weight · single pair" />
          <div style={s.gearDivider} />
          <GearRow icon="🪑" name="Adjustable Bench" detail="Flat · Incline · Decline" />
          <div style={s.gearDivider} />
          <GearRow icon="🏃" name="Treadmill" detail="Warm-up cardio & cool-down walking" />
          <div style={s.gearDivider} />
          <div style={s.gearItem}>
            <span style={s.gearIcon}>🔩</span>
            <div>
              <div style={s.gearName}>Major Fitness F22 Power Rack</div>
              <div style={s.gearDetail}>35 lb Olympic barbell</div>
              <div style={s.featureRow}>
                {["Multi-grip pull-up bar","Dual cable system","Dip bars","Landmine"].map(f => (
                  <span key={f} style={s.featureBadge}>{f}</span>
                ))}
              </div>
            </div>
          </div>
          <div style={s.gearDivider} />
          <div style={s.gearItem}>
            <span style={s.gearIcon}>🪙</span>
            <div>
              <div style={s.gearName}>Available Plates</div>
              <div style={s.plateRow}>
                {["2× 35 lb","2× 15 lb","2× 10 lb"].map(p => (
                  <span key={p} style={s.plateBadge}>{p}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={s.section}>
        <h2 style={s.sectionLabel}>TODAY'S FOCUS</h2>
        <div style={s.focusRow}>
          {FOCUS_OPTIONS.map(f => (
            <button key={f} onClick={() => setFocus(f)}
              style={{ ...s.focusBtn, ...(focus === f ? s.focusBtnActive : {}) }}>
              {f}
            </button>
          ))}
        </div>
      </section>

      {error && <div style={s.errorBox}>{error}</div>}

      <button onClick={onGenerate} disabled={loading}
        style={{ ...s.primaryBtn, opacity: loading ? 0.5 : 1 }}>
        {loading ? "Building your routine…" : "Generate My Routine →"}
      </button>

      {hasExistingRoutine && (
        <button onClick={onResume} style={s.secondaryBtn}>
          Resume Today's Workout
        </button>
      )}

      {historyCount > 0 && (
        <button onClick={onViewHistory} style={s.ghostBtn}>
          View Past Workouts ({historyCount})
        </button>
      )}

      {ledgerCount > 0 && (
        <button onClick={onViewProgress} style={s.ghostBtn}>
          📈 Progression Tracker ({ledgerCount} {ledgerCount === 1 ? "lift" : "lifts"})
        </button>
      )}

      <p style={s.hint}>{focus} focus · exercises tailored to your rack & dumbbells</p>

      <div style={s.resetZone}>
        {confirmReset ? (
          <div style={s.resetConfirm}>
            <span style={s.resetConfirmText}>
              Erase all data, including saved workouts? This can't be undone.
            </span>
            <div style={s.resetConfirmBtns}>
              <button onClick={() => { onResetAll(); setConfirmReset(false); }} style={s.resetYes}>
                Erase everything
              </button>
              <button onClick={() => setConfirmReset(false)} style={s.resetNo}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmReset(true)} style={s.resetLink}>
            Reset all data
          </button>
        )}
      </div>
    </div>
  );
}

function GearRow({ icon, name, detail }) {
  return (
    <div style={s.gearItem}>
      <span style={s.gearIcon}>{icon}</span>
      <div>
        <div style={s.gearName}>{name}</div>
        <div style={s.gearDetail}>{detail}</div>
      </div>
    </div>
  );
}

// ── Routine Screen ────────────────────────────────────────────────────────────
function RoutineScreen({
  exercises, loading, swappingIndex, onSwap, onRefresh, onBack,
  logs, getLog, updateLog, completedSets, toggleSetDone,
  progress, totalSetsCompleted, totalSets, focus, error, onComplete,
  routineMeta, sectionChecks, toggleSectionCheck, onRemove,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const warmup = routineMeta?.warmup;
  const cooldown = routineMeta?.cooldown;
  const estMin = routineMeta?.estimatedMinutes;

  return (
    <div style={s.container}>
      <div style={s.routineHeader}>
        <button onClick={onBack} style={s.backBtn}>← Back</button>
        <div style={{ textAlign: "center" }}>
          <h1 style={s.routineTitle}>Today's Routine</h1>
          <span style={s.focusTag}>{focus}</span>
        </div>
        <button onClick={onRefresh} disabled={loading} style={s.refreshBtn}>
          {loading && swappingIndex === null ? "…" : "↺ New"}
        </button>
      </div>

      {estMin != null && !loading && (
        <div style={s.timeBanner}>
          <span style={s.timeBannerIcon}>⏱️</span>
          <span style={s.timeBannerText}>
            Estimated total time: <strong style={s.timeBannerMin}>{estMin} min</strong>
          </span>
        </div>
      )}

      <div style={s.progressBar}>
        <div style={{ ...s.progressFill, width: `${progress}%` }} />
      </div>
      <p style={s.progressLabel}>{totalSetsCompleted} / {totalSets} sets complete · {progress}%</p>

      {error && <div style={s.errorBox}>{error}</div>}

      {loading && swappingIndex === null ? (
        <div style={s.loadingBlock}>Building your session…</div>
      ) : (
        <>
          {warmup && (
            <SectionCard
              section={warmup}
              prefix="warmup"
              accent="#38bdf8"
              label="WARM-UP"
              sectionChecks={sectionChecks}
              toggleSectionCheck={toggleSectionCheck}
            />
          )}

          {exercises.map((ex, idx) => {
          const isExpanded = expandedId === ex.id;
          const setLog = getLog(ex.id, ex.sets);
          const isSwapping = swappingIndex === idx;
          const setsCompleted = Array.from({ length: ex.sets }, (_, i) => completedSets[`${ex.id}-${i}`]).filter(Boolean).length;

          return (
            <div key={ex.id} style={{ ...s.card, opacity: isSwapping ? 0.5 : 1 }}>
              <div style={s.cardHeader} onClick={() => setExpandedId(isExpanded ? null : ex.id)}>
                <div style={s.cardLeft}>
                  <span style={s.cardNum}>{String(idx + 1).padStart(2, "0")}</span>
                  <div>
                    <div style={s.cardName}>
                      {ex.tracked && <span style={s.trackedDot} title="Tracked for progression">●</span>}
                      {ex.name}
                    </div>
                    <div style={s.cardMeta}>
                      {ex.muscles} · {ex.sets} × {ex.reps}
                      {ex.prescribedWeight != null && (
                        <span style={s.rxInline}> · {ex.prescribedWeight} lbs</span>
                      )}
                      {setsCompleted > 0 && (
                        <span style={s.setsDoneTag}> · {setsCompleted}/{ex.sets} done</span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={s.cardRight}>
                  <button onClick={e => { e.stopPropagation(); onSwap(idx); }}
                    disabled={loading} style={s.swapBtn} title="Swap exercise">
                    {isSwapping ? "…" : "⇄"}
                  </button>
                  <span style={s.chevron}>{isExpanded ? "▲" : "▼"}</span>
                </div>
              </div>

              {isExpanded && (
                <div style={s.cardBody}>
                  <p style={s.cardDesc}>{ex.description}</p>

                  <div style={s.rxCard}>
                    <div style={s.rxRow}>
                      <span style={s.rxLabel}>TARGET</span>
                      <span style={s.rxValue}>{ex.prescribedLabel || "Bodyweight"}</span>
                    </div>
                    {ex.progressionNote && (
                      <div style={s.rxNote}>{ex.progressionNote}</div>
                    )}
                  </div>
                  <div style={s.setTable}>
                    <div style={s.setTableHeader}>
                      <span>SET</span>
                      <span>WEIGHT (lbs)</span>
                      <span>REPS</span>
                      <span>DONE</span>
                    </div>
                    {Array.from({ length: ex.sets }, (_, i) => {
                      const entry = setLog[i] || { weight: "", reps: "" };
                      const doneKey = `${ex.id}-${i}`;
                      const done = !!completedSets[doneKey];
                      return (
                        <div key={i} style={{ ...s.setRow, background: done ? "#0d2b1a" : "transparent" }}>
                          <span style={s.setNum}>{i + 1}</span>
                          <input type="number" min="0"
                            placeholder={ex.prescribedWeight != null ? String(ex.prescribedWeight) : "lbs"}
                            value={entry.weight}
                            onChange={e => updateLog(ex.id, i, "weight", e.target.value)}
                            style={s.setInput} />
                          <input type="number" min="0" placeholder={ex.reps}
                            value={entry.reps}
                            onChange={e => updateLog(ex.id, i, "reps", e.target.value)}
                            style={s.setInput} />
                          <button onClick={() => toggleSetDone(ex.id, i)}
                            style={{ ...s.doneBtn, background: done ? "#22c55e" : "#1a1a1a", border: done ? "none" : "1px solid #333" }}>
                            {done ? "✓" : "○"}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <button onClick={() => onRemove(ex.id)} style={s.removeBtn}>
                    ✕ Remove this exercise
                  </button>
                </div>
              )}
            </div>
          );
        })}

          {cooldown && (
            <SectionCard
              section={cooldown}
              prefix="cooldown"
              accent="#a78bfa"
              label="COOL-DOWN"
              sectionChecks={sectionChecks}
              toggleSectionCheck={toggleSectionCheck}
            />
          )}
        </>
      )}

      {progress === 100 && (
        <div style={s.doneMessage}>🏆 All sets done! Save it below.</div>
      )}

      {exercises.length > 0 && !loading && (
        <button onClick={onComplete} style={s.completeBtn}>
          ✓ Complete Workout
        </button>
      )}
      {exercises.length > 0 && !loading && (
        <p style={s.completeHint}>
          Saves a record with your logged weights and reps
        </p>
      )}
    </div>
  );
}

// ── Warm-up / Cool-down checklist card ────────────────────────────────────────
function SectionCard({ section, prefix, accent, label, sectionChecks, toggleSectionCheck }) {
  const activities = section?.activities || [];
  const doneCount = activities.filter((_, i) => sectionChecks[`${prefix}-${i}`]).length;
  return (
    <div style={{ ...s.sectionCard, borderColor: accent + "44" }}>
      <div style={s.sectionCardHeader}>
        <div>
          <span style={{ ...s.sectionCardLabel, color: accent }}>{label}</span>
          <div style={s.sectionCardTitle}>{section.title}</div>
        </div>
        <div style={s.sectionCardMeta}>
          {section.duration && <span style={s.sectionDuration}>{section.duration}</span>}
          {activities.length > 0 && (
            <span style={s.sectionDoneTag}>{doneCount}/{activities.length}</span>
          )}
        </div>
      </div>
      <div style={s.sectionActivityList}>
        {activities.map((act, i) => {
          const key = `${prefix}-${i}`;
          const checked = !!sectionChecks[key];
          return (
            <button key={i} onClick={() => toggleSectionCheck(key)}
              style={{ ...s.activityRow, ...(checked ? s.activityRowDone : {}) }}>
              <span style={{
                ...s.activityCheck,
                background: checked ? accent : "transparent",
                borderColor: checked ? accent : "#333",
                color: checked ? "#0a0a0a" : "transparent",
              }}>✓</span>
              <span style={{ ...s.activityText, ...(checked ? s.activityTextDone : {}) }}>{act}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── History Screen ────────────────────────────────────────────────────────────
function HistoryScreen({ history, onBack, onRepeat, onDelete }) {
  const [expandedId, setExpandedId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  return (
    <div style={s.container}>
      <div style={s.routineHeader}>
        <button onClick={onBack} style={s.backBtn}>← Back</button>
        <div style={{ textAlign: "center" }}>
          <h1 style={s.routineTitle}>Past Workouts</h1>
          <span style={s.focusTag}>{history.length} saved</span>
        </div>
        <div style={{ minWidth: 60 }} />
      </div>

      {history.length === 0 ? (
        <div style={s.emptyState}>
          <div style={s.emptyIcon}>🗂️</div>
          <p style={s.emptyTitle}>No saved workouts yet</p>
          <p style={s.emptyText}>
            Finish a routine and tap "Complete Workout" to save it here.
          </p>
        </div>
      ) : (
        history.map(rec => {
          const isExpanded = expandedId === rec.id;
          const pct = rec.totalSets > 0 ? Math.round((rec.completedSets / rec.totalSets) * 100) : 0;
          const dow = rec.dayOfWeek || dayOfWeekFromIso(rec.date);
          return (
            <div key={rec.id} style={s.card}>
              <div style={s.cardHeader} onClick={() => setExpandedId(isExpanded ? null : rec.id)}>
                <div style={s.cardLeft}>
                  <div>
                    <div style={s.cardName}>
                      {dow && <span style={s.recDow}>{dow}</span>}
                      {rec.focus}
                    </div>
                    <div style={s.cardMeta}>
                      {formatDate(rec.date)} · {rec.exercises.length} exercises · {rec.completedSets}/{rec.totalSets} sets ({pct}%)
                      {rec.estimatedMinutes != null && ` · ~${rec.estimatedMinutes} min`}
                    </div>
                  </div>
                </div>
                <span style={s.chevron}>{isExpanded ? "▲" : "▼"}</span>
              </div>

              {isExpanded && (
                <div style={s.cardBody}>
                  {rec.warmup && (
                    <div style={s.recSection}>
                      <span style={{ ...s.recSectionLabel, color: "#38bdf8" }}>WARM-UP</span>
                      <span style={s.recSectionText}>{rec.warmup.title}{rec.warmup.duration ? ` · ${rec.warmup.duration}` : ""}</span>
                    </div>
                  )}
                  {rec.exercises.map((ex, i) => (
                    <div key={i} style={s.recExercise}>
                      <div style={s.recExName}>{ex.name}</div>
                      <div style={s.recExMeta}>{ex.muscles}</div>
                      <div style={s.recSetList}>
                        {ex.log.map((entry, j) => (
                          <span key={j} style={{
                            ...s.recSetChip,
                            ...(entry.done ? s.recSetChipDone : {}),
                          }}>
                            {entry.done ? "✓ " : ""}
                            {entry.weight ? `${entry.weight}lb` : "—"} × {entry.reps || "—"}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {rec.cooldown && (
                    <div style={s.recSection}>
                      <span style={{ ...s.recSectionLabel, color: "#a78bfa" }}>COOL-DOWN</span>
                      <span style={s.recSectionText}>{rec.cooldown.title}{rec.cooldown.duration ? ` · ${rec.cooldown.duration}` : ""}</span>
                    </div>
                  )}

                  <div style={s.recActions}>
                    <button onClick={() => onRepeat(rec)} style={s.repeatBtn}>
                      ↻ Repeat This Workout
                    </button>
                    {confirmDelete === rec.id ? (
                      <div style={s.confirmRow}>
                        <span style={s.confirmText}>Delete?</span>
                        <button onClick={() => { onDelete(rec.id); setConfirmDelete(null); }}
                          style={s.confirmYes}>Yes</button>
                        <button onClick={() => setConfirmDelete(null)}
                          style={s.confirmNo}>No</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDelete(rec.id)} style={s.deleteBtn}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Progress Screen — the progression ledger made visible ─────────────────────
function ProgressScreen({ ledger, onBack }) {
  const entries = Object.values(ledger || {}).sort((a, b) => (b.sessions || 0) - (a.sessions || 0));

  const trendIcon = (action) => {
    if (action === "increase") return { sym: "↑", color: "#22c55e" };
    if (action === "deload") return { sym: "↓", color: "#f87171" };
    return { sym: "→", color: "#888" };
  };

  return (
    <div style={s.container}>
      <div style={s.routineHeader}>
        <button onClick={onBack} style={s.backBtn}>← Back</button>
        <div style={{ textAlign: "center" }}>
          <h1 style={s.routineTitle}>Progression</h1>
          <span style={s.focusTag}>{entries.length} tracked lifts</span>
        </div>
        <div style={{ minWidth: 60 }} />
      </div>

      <p style={s.progressIntro}>
        Loads here are calculated from your logged performance and snapped to weights
        you can actually build. Hit the top of a rep range on every set and the weight
        goes up next session.
      </p>

      {entries.length === 0 ? (
        <div style={s.emptyState}>
          <div style={s.emptyIcon}>📈</div>
          <p style={s.emptyTitle}>No tracked lifts yet</p>
          <p style={s.emptyText}>
            Complete a workout and the exercises you log will start being tracked here.
          </p>
        </div>
      ) : (
        entries.map((e, i) => {
          const ladder = ladderFor(e.equipment);
          const weight = ladder ? snapWeight(ladder, e.currentWeight) : null;
          const t = trendIcon(e.lastAction);
          return (
            <div key={i} style={s.ledgerCard}>
              <div style={s.ledgerTop}>
                <div style={s.ledgerName}>{e.name}</div>
                <div style={{ ...s.ledgerTrend, color: t.color }}>{t.sym}</div>
              </div>
              <div style={s.ledgerMeta}>
                <span style={s.ledgerEquip}>{e.equipment}</span>
                <span style={s.ledgerReps}>target {e.repLow}-{e.repHigh} reps</span>
                <span style={s.ledgerSessions}>{e.sessions} session{e.sessions === 1 ? "" : "s"}</span>
              </div>
              <div style={s.ledgerWeight}>
                {weight != null ? weightLabel(e.equipment, weight) : "Bodyweight — progress by reps"}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  app: {
    minHeight: "100vh",
    background: "#0a0a0a",
    color: "#f0f0f0",
    fontFamily: "-apple-system, 'Inter', sans-serif",
  },
  container: {
    maxWidth: 640,
    margin: "0 auto",
    padding: "32px 20px 100px",
  },
  header: { textAlign: "center", marginBottom: 40 },
  headerRow: { display: "flex", alignItems: "flex-start", marginBottom: 40 },
  historyIconBtn: {
    position: "relative", background: "#1a1a1a", border: "1px solid #2a2a2a",
    borderRadius: 10, fontSize: 18, padding: "8px 12px", cursor: "pointer",
  },
  historyCount: {
    position: "absolute", top: -6, right: -6, background: "#a3e635", color: "#0a0a0a",
    fontSize: 10, fontWeight: 800, borderRadius: 10, minWidth: 18, height: 18,
    display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
  },
  title: {
    fontSize: 38,
    fontWeight: 800,
    letterSpacing: "-2px",
    margin: 0,
    background: "linear-gradient(135deg, #f0f0f0 0%, #a3e635 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  subtitle: { color: "#666", fontSize: 15, marginTop: 8 },
  section: { marginBottom: 32 },
  sectionLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: "2px",
    color: "#a3e635", margin: "0 0 14px",
  },
  gearCard: {
    background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: "4px 0",
  },
  gearItem: { display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 18px" },
  gearIcon: { fontSize: 22, minWidth: 28, textAlign: "center", paddingTop: 2 },
  gearName: { fontWeight: 600, fontSize: 14, color: "#f0f0f0", marginBottom: 2 },
  gearDetail: { fontSize: 12, color: "#555" },
  gearDivider: { height: 1, background: "#1a1a1a", margin: "0 18px" },
  featureRow: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 },
  featureBadge: {
    fontSize: 10, fontWeight: 600, background: "#1a1a1a",
    border: "1px solid #2a2a2a", color: "#888", padding: "2px 7px", borderRadius: 5,
  },
  plateRow: { display: "flex", gap: 6, marginTop: 4 },
  plateBadge: {
    fontSize: 11, fontWeight: 700, background: "#1a1a1a",
    border: "1px solid #2a2a2a", color: "#a3e635", padding: "3px 8px", borderRadius: 6,
  },
  focusRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  focusBtn: {
    padding: "7px 14px", borderRadius: 20, border: "1px solid #2a2a2a",
    background: "#111", color: "#888", fontSize: 13, cursor: "pointer",
  },
  focusBtnActive: {
    border: "1px solid #a3e635", background: "#a3e635", color: "#0a0a0a", fontWeight: 700,
  },
  primaryBtn: {
    display: "block", width: "100%", padding: "16px", background: "#a3e635",
    color: "#0a0a0a", border: "none", borderRadius: 12, fontSize: 16,
    fontWeight: 700, cursor: "pointer", marginBottom: 12,
  },
  secondaryBtn: {
    display: "block", width: "100%", padding: "14px", background: "transparent",
    color: "#a3e635", border: "1px solid #a3e635", borderRadius: 12, fontSize: 15,
    fontWeight: 600, cursor: "pointer", marginBottom: 12,
  },
  hint: { textAlign: "center", color: "#555", fontSize: 13 },
  ghostBtn: {
    display: "block", width: "100%", padding: "12px", background: "transparent",
    color: "#888", border: "1px solid #2a2a2a", borderRadius: 12, fontSize: 14,
    fontWeight: 600, cursor: "pointer", marginBottom: 12,
  },
  errorBox: {
    background: "#2a0a0a", border: "1px solid #6b1a1a", color: "#f87171",
    padding: "12px 16px", borderRadius: 8, fontSize: 14, marginBottom: 16,
  },
  routineHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20,
  },
  backBtn: {
    background: "none", border: "none", color: "#666",
    cursor: "pointer", fontSize: 13, padding: 0, minWidth: 60,
  },
  routineTitle: { fontSize: 26, fontWeight: 800, margin: "0 0 2px", letterSpacing: "-1px" },
  focusTag: {
    fontSize: 11, fontWeight: 700, letterSpacing: "1px",
    color: "#a3e635", textTransform: "uppercase",
  },
  refreshBtn: {
    background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#ccc",
    cursor: "pointer", fontSize: 13, padding: "6px 12px", borderRadius: 8, minWidth: 60,
  },
  progressBar: {
    height: 4, background: "#1a1a1a", borderRadius: 4, overflow: "hidden", marginBottom: 6,
  },
  progressFill: {
    height: "100%", background: "#a3e635", borderRadius: 4, transition: "width 0.4s ease",
  },
  progressLabel: { color: "#555", fontSize: 12, marginBottom: 24 },
  loadingBlock: { textAlign: "center", color: "#555", padding: 48, fontSize: 15 },
  card: {
    background: "#111", border: "1px solid #1e1e1e",
    borderRadius: 14, marginBottom: 12, overflow: "hidden", transition: "opacity 0.2s",
  },
  cardHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "16px 18px", cursor: "pointer",
  },
  cardLeft: { display: "flex", alignItems: "center", gap: 14 },
  cardNum: { fontSize: 11, fontWeight: 700, color: "#a3e635", letterSpacing: "1px", minWidth: 22 },
  cardName: { fontWeight: 700, fontSize: 15, color: "#f0f0f0" },
  cardMeta: { fontSize: 12, color: "#555", marginTop: 2 },
  setsDoneTag: { color: "#a3e635" },
  cardRight: { display: "flex", alignItems: "center", gap: 10 },
  swapBtn: {
    background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#888",
    borderRadius: 6, cursor: "pointer", fontSize: 14, padding: "4px 8px",
  },
  chevron: { color: "#444", fontSize: 10 },
  cardBody: { padding: "16px 18px 18px", borderTop: "1px solid #1a1a1a" },
  cardDesc: { fontSize: 13, color: "#888", lineHeight: 1.6, marginBottom: 10 },
  weightNote: {
    fontSize: 13, color: "#a3e635", background: "#0d1f00",
    padding: "8px 12px", borderRadius: 8, marginBottom: 16,
  },
  trackedDot: { color: "#a3e635", fontSize: 10, marginRight: 6, verticalAlign: "middle" },
  rxInline: { color: "#a3e635", fontWeight: 700 },
  rxCard: {
    background: "#0d1f00", border: "1px solid #1d3a08", borderRadius: 10,
    padding: "12px 14px", marginBottom: 16,
  },
  rxRow: { display: "flex", alignItems: "baseline", gap: 10 },
  rxLabel: { fontSize: 10, fontWeight: 800, letterSpacing: "1.5px", color: "#6a8a3a" },
  rxValue: { fontSize: 15, fontWeight: 700, color: "#a3e635" },
  rxNote: { fontSize: 12, color: "#7fae5a", marginTop: 6 },
  setTable: { borderRadius: 8, overflow: "hidden", border: "1px solid #1e1e1e" },
  setTableHeader: {
    display: "grid", gridTemplateColumns: "0.5fr 2fr 1.5fr 1fr",
    padding: "8px 12px", background: "#161616",
    fontSize: 10, fontWeight: 700, letterSpacing: "1.5px", color: "#444",
  },
  setRow: {
    display: "grid", gridTemplateColumns: "0.5fr 2fr 1.5fr 1fr",
    padding: "8px 12px", alignItems: "center",
    borderTop: "1px solid #1a1a1a", transition: "background 0.2s",
  },
  setNum: { fontSize: 12, color: "#888" },
  setInput: {
    background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6,
    color: "#f0f0f0", fontSize: 13, padding: "5px 8px", width: "80%", outline: "none",
  },
  doneBtn: {
    borderRadius: 6, color: "#f0f0f0", cursor: "pointer",
    fontSize: 14, padding: "5px 10px", width: 36, textAlign: "center",
  },
  doneMessage: {
    textAlign: "center", padding: "20px", background: "#0d2b1a",
    border: "1px solid #22c55e", borderRadius: 14, color: "#22c55e",
    fontWeight: 700, fontSize: 16, marginTop: 16, marginBottom: 16,
  },
  completeBtn: {
    display: "block", width: "100%", padding: "16px", background: "#22c55e",
    color: "#0a0a0a", border: "none", borderRadius: 12, fontSize: 16,
    fontWeight: 800, cursor: "pointer", marginTop: 8,
  },
  completeHint: { textAlign: "center", color: "#555", fontSize: 12, marginTop: 8 },

  // Reset all data
  resetZone: { marginTop: 32, textAlign: "center" },
  resetLink: {
    background: "none", border: "none", color: "#5a4a4a",
    fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 8,
  },
  resetConfirm: {
    background: "#1a0d0d", border: "1px solid #3a1a1a", borderRadius: 12, padding: "16px",
  },
  resetConfirmText: { fontSize: 13, color: "#c98a8a", display: "block", marginBottom: 12 },
  resetConfirmBtns: { display: "flex", gap: 8, justifyContent: "center" },
  resetYes: {
    background: "#6b1a1a", border: "none", color: "#fca5a5",
    fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "8px 16px", borderRadius: 8,
  },
  resetNo: {
    background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#888",
    fontSize: 13, cursor: "pointer", padding: "8px 16px", borderRadius: 8,
  },

  // Day-of-week badge on history records
  recDow: {
    fontSize: 10, fontWeight: 800, letterSpacing: "1px", color: "#a3e635",
    background: "#182800", border: "1px solid #2d4a0a", borderRadius: 5,
    padding: "2px 7px", marginRight: 8, textTransform: "uppercase",
    verticalAlign: "middle",
  },

  // Progression tracker
  progressIntro: { fontSize: 13, color: "#777", lineHeight: 1.5, marginBottom: 20 },
  ledgerCard: {
    background: "#111", border: "1px solid #1e1e1e", borderRadius: 12,
    padding: "14px 16px", marginBottom: 10,
  },
  ledgerTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  ledgerName: { fontWeight: 700, fontSize: 15, color: "#f0f0f0" },
  ledgerTrend: { fontSize: 20, fontWeight: 800 },
  ledgerMeta: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6, marginBottom: 10 },
  ledgerEquip: {
    fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase",
    color: "#888", background: "#1a1a1a", border: "1px solid #2a2a2a",
    padding: "2px 7px", borderRadius: 5,
  },
  ledgerReps: { fontSize: 12, color: "#666" },
  ledgerSessions: { fontSize: 12, color: "#666" },
  ledgerWeight: {
    fontSize: 14, fontWeight: 700, color: "#a3e635",
    background: "#0d1f00", padding: "8px 12px", borderRadius: 8,
  },

  // Time estimate banner
  timeBanner: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    background: "#10231f", border: "1px solid #1d4d44", borderRadius: 12,
    padding: "12px 16px", marginBottom: 16,
  },
  timeBannerIcon: { fontSize: 16 },
  timeBannerText: { fontSize: 14, color: "#9fdccb" },
  timeBannerMin: { color: "#a3e635" },

  // Warm-up / cool-down section cards
  sectionCard: {
    background: "#111", border: "1px solid #1e1e1e", borderRadius: 14,
    marginBottom: 12, overflow: "hidden",
  },
  sectionCardHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    padding: "14px 18px 10px",
  },
  sectionCardLabel: { fontSize: 10, fontWeight: 800, letterSpacing: "2px" },
  sectionCardTitle: { fontWeight: 700, fontSize: 15, color: "#f0f0f0", marginTop: 3 },
  sectionCardMeta: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 },
  sectionDuration: {
    fontSize: 11, fontWeight: 700, color: "#888",
    background: "#1a1a1a", border: "1px solid #2a2a2a", padding: "2px 8px", borderRadius: 6,
  },
  sectionDoneTag: { fontSize: 11, color: "#555" },
  sectionActivityList: { padding: "0 12px 12px" },
  activityRow: {
    display: "flex", alignItems: "center", gap: 10, width: "100%",
    background: "transparent", border: "none", padding: "8px 6px",
    cursor: "pointer", textAlign: "left", borderRadius: 8,
  },
  activityRowDone: { background: "#0f140f" },
  activityCheck: {
    minWidth: 20, height: 20, borderRadius: 6, border: "1px solid #333",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontSize: 12, fontWeight: 800,
  },
  activityText: { fontSize: 13, color: "#bbb", lineHeight: 1.4 },
  activityTextDone: { color: "#666", textDecoration: "line-through" },

  // Remove exercise
  removeBtn: {
    width: "100%", marginTop: 14, padding: "10px", background: "transparent",
    color: "#a16060", border: "1px solid #3a1a1a", borderRadius: 8,
    fontSize: 13, fontWeight: 600, cursor: "pointer",
  },

  // History
  emptyState: { textAlign: "center", padding: "60px 20px" },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontWeight: 700, color: "#ccc", marginBottom: 8 },
  emptyText: { fontSize: 14, color: "#555", lineHeight: 1.5 },
  recExercise: { padding: "12px 0", borderBottom: "1px solid #1a1a1a" },
  recSection: {
    display: "flex", alignItems: "center", gap: 8, padding: "10px 0",
    borderBottom: "1px solid #1a1a1a",
  },
  recSectionLabel: { fontSize: 10, fontWeight: 800, letterSpacing: "1.5px", minWidth: 76 },
  recSectionText: { fontSize: 13, color: "#999" },
  recExName: { fontWeight: 600, fontSize: 14, color: "#f0f0f0" },
  recExMeta: { fontSize: 12, color: "#555", marginTop: 2, marginBottom: 8 },
  recSetList: { display: "flex", flexWrap: "wrap", gap: 6 },
  recSetChip: {
    fontSize: 11, fontWeight: 600, background: "#1a1a1a", border: "1px solid #2a2a2a",
    color: "#888", padding: "3px 8px", borderRadius: 6,
  },
  recSetChipDone: { background: "#0d2b1a", border: "1px solid #1d5237", color: "#a3e635" },
  recActions: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 10, marginTop: 16,
  },
  repeatBtn: {
    flex: 1, padding: "12px", background: "#a3e635", color: "#0a0a0a",
    border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
  },
  deleteBtn: {
    background: "none", border: "none", color: "#666",
    fontSize: 13, cursor: "pointer", padding: "8px",
  },
  confirmRow: { display: "flex", alignItems: "center", gap: 8 },
  confirmText: { fontSize: 13, color: "#888" },
  confirmYes: {
    background: "#6b1a1a", border: "none", color: "#f87171",
    fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "6px 12px", borderRadius: 6,
  },
  confirmNo: {
    background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#888",
    fontSize: 13, cursor: "pointer", padding: "6px 12px", borderRadius: 6,
  },
};
