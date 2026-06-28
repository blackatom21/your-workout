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

// Manual-override focus options (auto-programming is the default path).
const FOCUS_OPTIONS = ["Push", "Pull", "Legs", "Full Body", "Upper Body", "Lower Body", "Core", "Conditioning"];

// ── Auto-Programming Engine ──────────────────────────────────────────────────
// Strength emphasis rotates through these for balanced recovery.
const STRENGTH_ROTATION = ["Push", "Pull", "Legs"];
// Insert a VO2/endurance day after this many strength sessions in a row.
const CONDITIONING_EVERY = 3;

function sessionTypeOf(rec) {
  return rec.sessionType || rec.focus || "Full Body";
}

// Decide the next appropriate session from completed history.
// Returns { type, reason }.
function decideNextSession(history) {
  const recent = (history || []).slice(0, 8); // newest first
  if (recent.length === 0) {
    return { type: "Full Body", reason: "Your first session — a balanced full-body start to set baselines." };
  }
  const lastType = sessionTypeOf(recent[0]);

  // How many strength sessions since the last conditioning day?
  let sinceConditioning = 0;
  let everConditioned = false;
  for (const r of recent) {
    if (sessionTypeOf(r) === "Conditioning") { everConditioned = true; break; }
    sinceConditioning++;
  }

  // Schedule a VO2/endurance day when it's been a while (never two in a row).
  if (lastType !== "Conditioning" &&
      (sinceConditioning >= CONDITIONING_EVERY || (!everConditioned && recent.length >= 2))) {
    return {
      type: "Conditioning",
      reason: `${sinceConditioning} strength session${sinceConditioning === 1 ? "" : "s"} in a row — time for VO2 max / endurance work to round out the week.`,
    };
  }

  // Otherwise pick the least-recently-trained strength split.
  const lastSeen = {};
  recent.forEach((r, i) => { const t = sessionTypeOf(r); if (lastSeen[t] === undefined) lastSeen[t] = i; });
  let pick = STRENGTH_ROTATION[0], best = -1;
  for (const t of STRENGTH_ROTATION) {
    const score = lastSeen[t] === undefined ? 999 : lastSeen[t];
    if (score > best) { best = score; pick = t; }
  }
  const reason = lastType === "Conditioning"
    ? `Back to strength after conditioning — ${pick} is next in your rotation.`
    : `${pick} hasn't been trained recently — keeps your week balanced.`;
  return { type: pick, reason };
}

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

// Deterministic warm-up (ramp-up) sets for heavier compound lifts.
// Returns [{ weight, reps }] from lighter→heavier, all below the working weight.
// Only barbell and heavier dumbbell work qualify; cable/bodyweight/light DB skip.
function rampUpSets(equipment, workingWeight) {
  const ladder = ladderFor(equipment);
  const eq = (equipment || "").toLowerCase();
  if (!ladder || workingWeight == null) return [];
  if (eq !== "barbell" && eq !== "dumbbell") return [];
  if (eq === "dumbbell" && workingWeight < 20) return []; // light DB isolation

  const pcts = [0.5, 0.75];
  const repsByStep = [5, 3];
  const out = [];
  const seen = new Set();
  pcts.forEach((p, i) => {
    const w = snapWeight(ladder, workingWeight * p);
    if (w != null && w < workingWeight && !seen.has(w)) {
      seen.add(w);
      out.push({ weight: w, reps: repsByStep[i] ?? 4 });
    }
  });
  return out;
}

// Profile context line for the AI (imperial). Empty string if nothing set.
// Estimated max heart rate: measured value if provided, else Tanaka (208 − 0.7×age).
function estimatedMaxHr(profile) {
  if (profile?.maxHrKnown) {
    const m = Number(profile.maxHrKnown);
    if (!isNaN(m) && m > 0) return Math.round(m);
  }
  if (profile?.age) {
    const a = Number(profile.age);
    if (!isNaN(a) && a > 0) return Math.round(208 - 0.7 * a);
  }
  return null;
}

// Heart-rate training zones (BPM ranges) derived from max HR.
function hrZones(maxHr) {
  if (!maxHr) return null;
  const z = (lo, hi) => `${Math.round(maxHr * lo)}–${Math.round(maxHr * hi)} bpm`;
  return {
    max: maxHr,
    vo2: z(0.85, 0.95),        // hard VO2-max work intervals
    threshold: z(0.80, 0.90),  // tempo / threshold
    easy: z(0.60, 0.70),       // warm-up, recovery, cool-down
  };
}

function profileLine(profile) {
  if (!profile) return "";
  const parts = [];
  if (profile.gender) parts.push(`Gender: ${profile.gender}`);
  if (profile.age) parts.push(`Age: ${profile.age}`);
  if (profile.heightFt || profile.heightIn) {
    const ft = profile.heightFt || 0;
    const inch = profile.heightIn || 0;
    parts.push(`Height: ${ft}'${inch}"`);
  }
  if (profile.weightLbs) parts.push(`Weight: ${profile.weightLbs} lbs`);
  const mhr = estimatedMaxHr(profile);
  if (mhr) parts.push(`Estimated max HR: ${mhr} bpm (${profile.maxHrKnown ? "measured" : "Tanaka formula"})`);
  if (parts.length === 0) return "";
  return `\nUSER PROFILE (use to tailor starting loads for NEW exercises, rep ranges, conditioning intensity, recovery, progression aggressiveness, and mobility emphasis — but the user's LOGGED performance always takes precedence over profile estimates): ${parts.join(", ")}.\n`;
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
  profile: "yw_profile",
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
      warmupSets: rampUpSets(equipment, rx.weight),
      tracked: !!known,
    };
  });
}

// Prompt for a strength session of a given split (Push/Pull/Legs/etc.).
function buildStrengthPrompt(focus, briefing, profile) {
  return `You are a certified strength and conditioning coach running a progressive-overload program. Build today's complete STRENGTH session using ONLY this equipment:
${EQUIPMENT_DESCRIPTION}

Today's session type: ${focus}.
${profileLine(profile)}${briefing}
TRAINING PHILOSOPHY — reflect ALL of these:
- Functional strength: compound, real-world movement patterns (push, pull, hinge, squat, carry, rotate), progressed over time, appropriate to today's ${focus} emphasis.
- Mobility & flexibility: dynamic joint mobility in the warm-up and long-hold static stretching in the cool-down; full-range main exercises.
- Cardiovascular endurance: treadmill in the warm-up and cool-down (today's dedicated conditioning happens on separate days, so keep cardio here light).
- Equipment variety: make real use of the F22's cable attachments — lat pulldown bar, straight bar, D/stirrup handles, T-bar/landmine handle — plus the landmine and dip bars, not just barbell and dumbbells.

PROGRESSION RULES:
- Prefer reusing tracked lifts from the PROGRESSION LEDGER that fit today's ${focus} emphasis, using their EXACT names, so the app can apply progressive overload. Keep their rep ranges stable.
- You may add new exercises for variety, balance, or mobility.
- Do NOT prescribe weights — the app calculates loads. For each MAIN exercise set "equipment" to one of: "barbell", "dumbbell", "cable", "bodyweight", "other". For brand-new loaded exercises only, include a rough "start_weight" number in lbs.

The session MUST have: warm-up (treadmill cardio + dynamic mobility), exactly 6 main exercises matching the ${focus} emphasis, and cool-down (treadmill walk + static stretching). Estimate total minutes.

Respond ONLY with a JSON object (no markdown) in EXACTLY this shape:
{
  "estimated_minutes": 55,
  "warmup": {"title":"Warm-Up & Dynamic Mobility","duration":"6 min","activities":["5 min treadmill brisk walk","Leg swings, 10 each side","World's greatest stretch, 5 each side"]},
  "exercises": [
    {"name":"Barbell Back Squat","sets":3,"reps":"8-12","muscles":"Quads, Glutes","equipment":"barbell","description":"Full-depth, knees tracking toes.","start_weight":95}
  ],
  "cooldown": {"title":"Cool-Down & Static Stretching","duration":"6 min","activities":["3 min treadmill walk","Hamstring stretch, 30 sec each","Hip flexor stretch, 30 sec each"]}
}`;
}

// Prompt for a dedicated VO2-max / endurance conditioning session.
function buildConditioningPrompt(lastConditioning, profile) {
  let progressNote = "";
  if (lastConditioning && Array.isArray(lastConditioning.exercises)) {
    const summary = lastConditioning.exercises
      .map(b => `${b.name}: ${b.rounds || "?"} rounds, work ${b.work || "?"}, rest ${b.rest || "?"}`)
      .join("; ");
    progressNote = `\nLAST CONDITIONING SESSION (progress slightly from this — add a round, extend work intervals, or increase pace/incline): ${summary}\n`;
  }
  const mhr = estimatedMaxHr(profile);
  const z = hrZones(mhr);
  const hrLine = z
    ? `\nThe user's max HR is ${mhr} bpm. Express every work/rest interval intensity with BOTH an RPE and a target HEART-RATE RANGE in bpm. Reference zones: VO2/hard work ${z.vo2}, threshold ${z.threshold}, easy/recovery ${z.easy}.\n`
    : "";
  return `You are a certified conditioning coach. Build today's dedicated CARDIOVASCULAR / VO2-MAX session using ONLY this equipment:
${EQUIPMENT_DESCRIPTION}
${profileLine(profile)}${hrLine}
This is an ENDURANCE day, not a strength day. The centerpiece is structured cardiovascular work to build VO2 max and aerobic capacity, primarily on the treadmill, optionally mixed with light functional circuit movements for a metabolic effect. Do NOT program heavy strength lifting today.
${progressNote}
PRINCIPLES:
- Include true high-intensity work that pushes VO2 max (e.g. 4×4 min @ RPE 8-9 / ~85-95% max HR with active recovery), OR a tempo/threshold block, OR an interval ladder — pick one well-structured format.
- Give clear intensity targets (RPE${z ? " AND target bpm range" : " and approximate % max heart rate"}) and explicit work/rest timing.
- Keep it time-efficient and appropriate for someone who also strength-trains on other days.

The session MUST have: warm-up (gradual treadmill build + dynamic mobility), 1-3 conditioning blocks, and cool-down (easy treadmill walk + static stretching). Estimate total minutes.

Respond ONLY with a JSON object (no markdown) in EXACTLY this shape:
{
  "estimated_minutes": 35,
  "warmup": {"title":"Warm-Up & Aerobic Prime","duration":"6 min","activities":["5 min treadmill easy-to-moderate build","Leg swings, 10 each side","High knees, 30 sec"]},
  "conditioning": [
    {"name":"Treadmill VO2 Intervals (4×4)","format":"intervals","rounds":4,"work":"4 min @ RPE 8-9${z ? `, ${z.vo2}` : " (~90% max HR)"}","rest":"3 min easy walk/jog${z ? `, ${z.easy}` : ""}","description":"Hard enough that talking is difficult during work intervals."}
  ],
  "cooldown": {"title":"Cool-Down & Static Stretching","duration":"6 min","activities":["3-5 min treadmill easy walk","Hamstring stretch, 30 sec each","Calf stretch, 30 sec each"]}
}`;
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
  const [profile, setProfile]           = useState(() => lsGet(LS_KEYS.profile, {}));
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
  useEffect(() => { lsSet(LS_KEYS.profile, profile); }, [profile]);
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

  // Summarize the most recent conditioning session so the AI can progress it.
  const lastConditioning = history.find(r => sessionTypeOf(r) === "Conditioning");

  // ── Generate the next session (auto-decided type, or a manual override) ────
  const generateRoutine = useCallback(async (overrideType) => {
    const sessionType = overrideType || decideNextSession(history).type;
    setFocus(sessionType);
    setLoading(true);
    setError(null);

    const isConditioning = sessionType === "Conditioning";
    const prompt = isConditioning
      ? buildConditioningPrompt(lastConditioning, profile)
      : buildStrengthPrompt(sessionType, buildProgressionBriefing(ledger, history, sessionType), profile);

    try {
      const text = await callAI(prompt);
      const routine = parseRoutine(text);

      if (isConditioning) {
        const blocks = Array.isArray(routine?.conditioning) ? routine.conditioning : null;
        if (blocks && blocks.length > 0) {
          const withIds = blocks.map((b, i) => ({
            ...b,
            id: `cond-${Date.now()}-${i}`,
            kind: "conditioning",
            rounds: Math.max(1, Number(b.rounds) || 1),
          }));
          setExercises(withIds);
          setRoutineMeta({
            sessionType,
            estimatedMinutes: routine.estimated_minutes ?? null,
            warmup: routine.warmup ?? null,
            cooldown: routine.cooldown ?? null,
          });
          setLogs({});
          setCompletedSets({});
          setSectionChecks({});
          setScreen("routine");
        } else {
          setError("Couldn't parse the conditioning session — tap Generate to try again.");
        }
      } else {
        if (routine && Array.isArray(routine.exercises) && routine.exercises.length > 0) {
          const withRx = applyPrescriptions(routine.exercises, ledger)
            .map(e => ({ ...e, kind: "strength" }));
          setExercises(withRx);
          setRoutineMeta({
            sessionType,
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
      }
    } catch (e) {
      setError(e.message || "Something went wrong.");
    }
    setLoading(false);
  }, [callAI, ledger, history, lastConditioning, profile]);

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

  // ── Notes for a conditioning block (pace/incline used, how it felt) ───────
  const updateNotes = useCallback((exerciseId, value) => {
    setLogs(prev => ({ ...prev, [exerciseId]: { ...(prev[exerciseId] || {}), notes: value } }));
  }, []);

  // ── Progress (units = strength sets OR conditioning rounds) ───────────────
  const unitsOf = (ex) => ex.kind === "conditioning" ? (ex.rounds || 1) : (ex.sets || 0);
  const totalSets = exercises.reduce((a, ex) => a + unitsOf(ex), 0);
  const totalSetsCompleted = exercises.reduce((a, ex) => {
    for (let i = 0; i < unitsOf(ex); i++) if (completedSets[`${ex.id}-${i}`]) a++;
    return a;
  }, 0);
  const progress = totalSets > 0 ? Math.round((totalSetsCompleted / totalSets) * 100) : 0;

  // ── Save the finished workout as a record + advance the ledger ────────────
  const completeWorkout = useCallback(() => {
    if (exercises.length === 0) return;
    const now = new Date();
    const sessionType = routineMeta?.sessionType || focus;
    const isConditioning = sessionType === "Conditioning";

    const record = {
      id: `rec-${Date.now()}`,
      date: now.toISOString(),
      dayOfWeek: now.toLocaleDateString(undefined, { weekday: "long" }),
      focus: sessionType,
      sessionType,
      totalSets,
      completedSets: totalSetsCompleted,
      estimatedMinutes: routineMeta?.estimatedMinutes ?? null,
      warmup: routineMeta?.warmup ?? null,
      cooldown: routineMeta?.cooldown ?? null,
      exercises: exercises.map(ex => {
        if (ex.kind === "conditioning") {
          const rounds = ex.rounds || 1;
          return {
            kind: "conditioning",
            name: ex.name,
            format: ex.format,
            rounds,
            work: ex.work,
            rest: ex.rest,
            description: ex.description,
            notes: (logs[ex.id]?.notes) || "",
            roundsDone: Array.from({ length: rounds }, (_, i) => !!completedSets[`${ex.id}-${i}`]).filter(Boolean).length,
          };
        }
        return {
          kind: "strength",
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
        };
      }),
    };

    // Advance the strength progression ledger (conditioning days skip this).
    if (!isConditioning) {
      setLedger(prev => {
        const next = { ...prev };
        for (const ex of exercises) {
          if (ex.kind === "conditioning") continue;
          const key = normalizeName(ex.name);
          const range = parseRepRange(ex.reps);
          const logEntries = getLog(ex.id, ex.sets).slice(0, ex.sets).map((entry, i) => ({
            weight: entry.weight,
            reps: entry.reps,
            done: !!completedSets[`${ex.id}-${i}`],
          }));
          const perf = summarizePerformance(logEntries, range.high);
          const touched = logEntries.some(e => e.done || (e.weight !== "" && e.weight != null));
          if (!touched && !next[key]) continue;
          next[key] = {
            ...advanceLedgerEntry(next[key], perf, range, ex.equipment || "other"),
            name: ex.name,
            lastDate: now.toISOString(),
          };
        }
        return next;
      });
    }

    setHistory(prev => [record, ...prev]);
    setLogs({});
    setCompletedSets({});
    setSectionChecks({});
    setScreen("history");
  }, [exercises, focus, totalSets, totalSetsCompleted, completedSets, logs, routineMeta]);

  // ── Repeat a saved workout as a fresh active routine ──────────────────────
  // Re-applies CURRENT ledger prescriptions so repeating reflects progression.
  const repeatWorkout = useCallback((record) => {
    const sessionType = record.sessionType || record.focus || "Full Body";
    const isConditioning = sessionType === "Conditioning";
    let fresh;
    if (isConditioning) {
      fresh = record.exercises.map((ex, i) => ({
        id: `cond-${Date.now()}-${i}`,
        kind: "conditioning",
        name: ex.name,
        format: ex.format,
        rounds: Math.max(1, Number(ex.rounds) || 1),
        work: ex.work,
        rest: ex.rest,
        description: ex.description,
      }));
    } else {
      const raw = record.exercises.map(ex => ({
        name: ex.name,
        muscles: ex.muscles,
        reps: ex.reps,
        sets: ex.sets,
        equipment: ex.equipment || "other",
        description: ex.description,
      }));
      fresh = applyPrescriptions(raw, ledger).map(e => ({ ...e, kind: "strength" }));
    }
    setFocus(sessionType);
    setExercises(fresh);
    setRoutineMeta({
      sessionType,
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
    setProfile({});
    setFocus("Full Body");
    setError(null);
    setScreen("setup");
  }, []);

  return (
    <div style={s.app}>
      {screen === "setup" && (
        <SetupScreen
          decision={decideNextSession(history)}
          onGenerate={generateRoutine}
          loading={loading} error={error}
          hasExistingRoutine={exercises.length > 0}
          onResume={() => setScreen("routine")}
          historyCount={history.length}
          onViewHistory={() => setScreen("history")}
          onResetAll={resetAllData}
          ledgerCount={Object.keys(ledger).length}
          onViewProgress={() => setScreen("progress")}
          profile={profile} setProfile={setProfile}
        />
      )}
      {screen === "routine" && (
        <RoutineScreen
          exercises={exercises} loading={loading} swappingIndex={swappingIndex}
          onSwap={handleSwap} onRefresh={() => generateRoutine()} onBack={() => setScreen("setup")}
          logs={logs} getLog={getLog} updateLog={updateLog} updateNotes={updateNotes}
          completedSets={completedSets} toggleSetDone={toggleSetDone}
          progress={progress} totalSetsCompleted={totalSetsCompleted}
          totalSets={totalSets} focus={focus} error={error}
          onComplete={completeWorkout}
          routineMeta={routineMeta}
          sectionChecks={sectionChecks} toggleSectionCheck={toggleSectionCheck}
          onRemove={removeExercise}
          profile={profile}
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
function SetupScreen({ decision, onGenerate, loading, error, hasExistingRoutine, onResume, historyCount, onViewHistory, onResetAll, ledgerCount, onViewProgress, profile, setProfile }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const isConditioning = decision.type === "Conditioning";

  const setField = (field, value) => setProfile({ ...profile, [field]: value });
  const hasProfile = profile && (profile.gender || profile.weightLbs || profile.heightFt || profile.heightIn || profile.age);
  const profileSummary = hasProfile
    ? [profile.gender, profile.age ? `${profile.age} yrs` : null, (profile.heightFt || profile.heightIn) ? `${profile.heightFt || 0}'${profile.heightIn || 0}"` : null, profile.weightLbs ? `${profile.weightLbs} lbs` : null].filter(Boolean).join(" · ")
    : "Not set — tap to personalize";
  const estMaxHr = estimatedMaxHr(profile);

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
        <h2 style={s.sectionLabel}>YOUR PROFILE</h2>
        {!showProfile ? (
          <button onClick={() => setShowProfile(true)} style={s.profileSummaryBtn}>
            <span style={s.profileIcon}>👤</span>
            <span style={s.profileSummaryText}>{profileSummary}</span>
            <span style={s.profileEdit}>Edit</span>
          </button>
        ) : (
          <div style={s.profileCard}>
            <div style={s.profileField}>
              <label style={s.profileLabel}>Gender</label>
              <div style={s.genderRow}>
                {["Male", "Female", "Other"].map(g => (
                  <button key={g} onClick={() => setField("gender", profile.gender === g ? "" : g)}
                    style={{ ...s.genderBtn, ...(profile.gender === g ? s.genderBtnActive : {}) }}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div style={s.profileField}>
              <label style={s.profileLabel}>Age</label>
              <div style={s.heightRow}>
                <input type="number" min="0" inputMode="numeric" placeholder="years"
                  value={profile.age || ""}
                  onChange={e => setField("age", e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                  style={s.profileInput} />
                <span style={s.heightUnit}>years</span>
              </div>
            </div>
            <div style={s.profileField}>
              <label style={s.profileLabel}>Height</label>
              <div style={s.heightRow}>
                <input type="number" min="0" inputMode="numeric" placeholder="ft"
                  value={profile.heightFt || ""}
                  onChange={e => setField("heightFt", e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                  style={s.profileInput} />
                <span style={s.heightUnit}>ft</span>
                <input type="number" min="0" max="11" inputMode="numeric" placeholder="in"
                  value={profile.heightIn || ""}
                  onChange={e => setField("heightIn", e.target.value === "" ? "" : Math.max(0, Math.min(11, Number(e.target.value))))}
                  style={s.profileInput} />
                <span style={s.heightUnit}>in</span>
              </div>
            </div>
            <div style={s.profileField}>
              <label style={s.profileLabel}>Weight</label>
              <div style={s.heightRow}>
                <input type="number" min="0" inputMode="numeric" placeholder="lbs"
                  value={profile.weightLbs || ""}
                  onChange={e => setField("weightLbs", e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                  style={s.profileInput} />
                <span style={s.heightUnit}>lbs</span>
              </div>
            </div>
            <div style={s.profileField}>
              <label style={s.profileLabel}>Measured Max HR <span style={s.optionalTag}>(optional)</span></label>
              <div style={s.heightRow}>
                <input type="number" min="0" inputMode="numeric" placeholder="bpm"
                  value={profile.maxHrKnown || ""}
                  onChange={e => setField("maxHrKnown", e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                  style={s.profileInput} />
                <span style={s.heightUnit}>bpm</span>
              </div>
              {estMaxHr && (
                <div style={s.hrEstimate}>
                  {profile.maxHrKnown
                    ? `Using your measured max HR: ${estMaxHr} bpm`
                    : `Estimated max HR (Tanaka): ${estMaxHr} bpm — enter a measured value above if you have one`}
                </div>
              )}
            </div>
            <button onClick={() => setShowProfile(false)} style={s.profileDoneBtn}>Done</button>
            <p style={s.profileNote}>
              Used to tailor starting loads and intensity. All optional — your logged
              performance always takes precedence once you've trained a lift.
            </p>
          </div>
        )}
      </section>

      <section style={s.section}>
        <h2 style={s.sectionLabel}>YOUR EQUIPMENT</h2>
        <div style={s.gearCard}>
          <GearRow icon="🏋️" name="Bowflex SelectTech Dumbbells" detail="Adjustable weight · single pair" />
          <div style={s.gearDivider} />
          <GearRow icon="🪑" name="Adjustable Bench" detail="Flat · Incline · Decline" />
          <div style={s.gearDivider} />
          <GearRow icon="🏃" name="Treadmill" detail="Warm-up cardio, cool-down & VO2 intervals" />
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
        <h2 style={s.sectionLabel}>NEXT SESSION</h2>
        <div style={{ ...s.nextCard, borderColor: isConditioning ? "#38bdf855" : "#a3e63555" }}>
          <div style={s.nextType}>
            <span style={s.nextIcon}>{isConditioning ? "🫀" : "💪"}</span>
            <span style={{ ...s.nextTypeText, color: isConditioning ? "#7dd3fc" : "#a3e635" }}>
              {decision.type}{isConditioning ? " · VO2 Max" : ""}
            </span>
          </div>
          <p style={s.nextReason}>{decision.reason}</p>
        </div>
      </section>

      {error && <div style={s.errorBox}>{error}</div>}

      <button onClick={() => onGenerate()} disabled={loading}
        style={{ ...s.primaryBtn, opacity: loading ? 0.5 : 1 }}>
        {loading ? "Building your session…" : `Generate ${decision.type} Session →`}
      </button>

      {hasExistingRoutine && (
        <button onClick={onResume} style={s.secondaryBtn}>
          Resume Today's Workout
        </button>
      )}

      {!showManual ? (
        <button onClick={() => setShowManual(true)} style={s.ghostBtn}>
          Choose a different focus
        </button>
      ) : (
        <div style={s.manualBox}>
          <div style={s.manualLabel}>Pick a session manually:</div>
          <div style={s.focusRow}>
            {FOCUS_OPTIONS.map(f => (
              <button key={f} onClick={() => onGenerate(f)} disabled={loading}
                style={s.focusBtn}>
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {ledgerCount > 0 && (
        <button onClick={onViewProgress} style={s.ghostBtn}>
          📈 Progression Tracker ({ledgerCount} {ledgerCount === 1 ? "lift" : "lifts"})
        </button>
      )}

      {historyCount > 0 && (
        <button onClick={onViewHistory} style={s.ghostBtn}>
          View Past Workouts ({historyCount})
        </button>
      )}

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
  logs, getLog, updateLog, updateNotes, completedSets, toggleSetDone,
  progress, totalSetsCompleted, totalSets, focus, error, onComplete,
  routineMeta, sectionChecks, toggleSectionCheck, onRemove, profile,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const warmup = routineMeta?.warmup;
  const cooldown = routineMeta?.cooldown;
  const estMin = routineMeta?.estimatedMinutes;
  const sessionType = routineMeta?.sessionType || focus;
  const isConditioning = sessionType === "Conditioning";
  const unitWord = isConditioning ? "rounds" : "sets";
  const zones = isConditioning ? hrZones(estimatedMaxHr(profile)) : null;

  return (
    <div style={s.container}>
      <div style={s.routineHeader}>
        <button onClick={onBack} style={s.backBtn}>← Back</button>
        <div style={{ textAlign: "center" }}>
          <h1 style={s.routineTitle}>{isConditioning ? "Conditioning" : "Today's Routine"}</h1>
          <span style={s.focusTag}>{isConditioning ? "VO2 Max · Endurance" : sessionType}</span>
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

      {zones && !loading && (
        <div style={s.hrCard}>
          <div style={s.hrCardTitle}>YOUR HEART-RATE ZONES <span style={s.hrCardMax}>· max {zones.max} bpm</span></div>
          <div style={s.hrZoneRow}>
            <span style={{ ...s.hrZoneDot, background: "#f87171" }} />
            <span style={s.hrZoneLabel}>VO2 / hard work</span>
            <span style={s.hrZoneVal}>{zones.vo2}</span>
          </div>
          <div style={s.hrZoneRow}>
            <span style={{ ...s.hrZoneDot, background: "#fbbf24" }} />
            <span style={s.hrZoneLabel}>Threshold / tempo</span>
            <span style={s.hrZoneVal}>{zones.threshold}</span>
          </div>
          <div style={s.hrZoneRow}>
            <span style={{ ...s.hrZoneDot, background: "#4ade80" }} />
            <span style={s.hrZoneLabel}>Easy / recovery</span>
            <span style={s.hrZoneVal}>{zones.easy}</span>
          </div>
        </div>
      )}

      <div style={s.progressBar}>
        <div style={{ ...s.progressFill, width: `${progress}%` }} />
      </div>
      <p style={s.progressLabel}>{totalSetsCompleted} / {totalSets} {unitWord} complete · {progress}%</p>

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
          if (ex.kind === "conditioning") {
            return (
              <ConditioningCard
                key={ex.id}
                ex={ex}
                idx={idx}
                completedSets={completedSets}
                toggleSetDone={toggleSetDone}
                notes={logs[ex.id]?.notes || ""}
                updateNotes={updateNotes}
                onRemove={onRemove}
              />
            );
          }
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

                  {ex.warmupSets && ex.warmupSets.length > 0 && (
                    <div style={s.warmupBox}>
                      <div style={s.warmupTitle}>WARM-UP SETS</div>
                      {ex.warmupSets.map((w, wi) => (
                        <div key={wi} style={s.warmupRow}>
                          <span style={s.warmupNum}>W{wi + 1}</span>
                          <span style={s.warmupWeight}>
                            {ex.equipment === "barbell"
                              ? `${w.weight} lbs · ${barbellPlateLabel(w.weight)}`
                              : `${w.weight} lbs${ex.equipment === "dumbbell" ? " each" : ""}`}
                          </span>
                          <span style={s.warmupReps}>× {w.reps}</span>
                        </div>
                      ))}
                      <div style={s.warmupHint}>Then your working sets ↓</div>
                    </div>
                  )}

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

// ── Conditioning block card (intervals / VO2-max work) ───────────────────────
function ConditioningCard({ ex, idx, completedSets, toggleSetDone, notes, updateNotes, onRemove }) {
  const rounds = ex.rounds || 1;
  const done = Array.from({ length: rounds }, (_, i) => completedSets[`${ex.id}-${i}`]).filter(Boolean).length;
  return (
    <div style={{ ...s.card, borderColor: "#1d3a4d" }}>
      <div style={{ ...s.cardHeader, cursor: "default" }}>
        <div style={s.cardLeft}>
          <span style={{ ...s.cardNum, color: "#7dd3fc" }}>{String(idx + 1).padStart(2, "0")}</span>
          <div>
            <div style={s.cardName}>{ex.name}</div>
            <div style={s.cardMeta}>
              {ex.format ? `${ex.format} · ` : ""}{rounds} round{rounds === 1 ? "" : "s"}
              {done > 0 && <span style={s.condDoneTag}> · {done}/{rounds} done</span>}
            </div>
          </div>
        </div>
      </div>

      <div style={s.cardBody}>
        {ex.description && <p style={s.cardDesc}>{ex.description}</p>}
        <div style={s.condProtocol}>
          {ex.work && (
            <div style={s.condRow}>
              <span style={{ ...s.condTag, color: "#7dd3fc", borderColor: "#1d4d5e" }}>WORK</span>
              <span style={s.condText}>{ex.work}</span>
            </div>
          )}
          {ex.rest && (
            <div style={s.condRow}>
              <span style={{ ...s.condTag, color: "#888", borderColor: "#2a2a2a" }}>REST</span>
              <span style={s.condText}>{ex.rest}</span>
            </div>
          )}
        </div>

        <div style={s.condRounds}>
          {Array.from({ length: rounds }, (_, i) => {
            const isDone = !!completedSets[`${ex.id}-${i}`];
            return (
              <button key={i} onClick={() => toggleSetDone(ex.id, i)}
                style={{ ...s.condRoundBtn, ...(isDone ? s.condRoundBtnDone : {}) }}>
                {isDone ? "✓ " : ""}Round {i + 1}
              </button>
            );
          })}
        </div>

        <input
          type="text"
          placeholder="Notes — pace, speed, incline, how it felt…"
          value={notes}
          onChange={e => updateNotes(ex.id, e.target.value)}
          style={s.condNotes}
        />

        <button onClick={() => onRemove(ex.id)} style={s.removeBtn}>
          ✕ Remove this block
        </button>
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
                      {ex.kind === "conditioning" ? (
                        <>
                          <div style={s.recExMeta}>
                            {ex.format ? `${ex.format} · ` : ""}{ex.roundsDone ?? 0}/{ex.rounds || 1} rounds
                            {ex.work ? ` · ${ex.work}` : ""}
                          </div>
                          {ex.notes && <div style={s.recCondNotes}>“{ex.notes}”</div>}
                        </>
                      ) : (
                        <>
                          <div style={s.recExMeta}>{ex.muscles}</div>
                          <div style={s.recSetList}>
                            {(ex.log || []).map((entry, j) => (
                              <span key={j} style={{
                                ...s.recSetChip,
                                ...(entry.done ? s.recSetChipDone : {}),
                              }}>
                                {entry.done ? "✓ " : ""}
                                {entry.weight ? `${entry.weight}lb` : "—"} × {entry.reps || "—"}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
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
  recCondNotes: { fontSize: 12, color: "#7dd3fc", fontStyle: "italic", marginTop: 4 },

  // Next-session auto card
  nextCard: {
    background: "#0e1614", border: "1px solid #a3e63555", borderRadius: 14, padding: "18px",
  },
  nextType: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  nextIcon: { fontSize: 22 },
  nextTypeText: { fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" },
  nextReason: { fontSize: 13, color: "#9aa", lineHeight: 1.5, margin: 0 },

  // Manual override
  manualBox: {
    background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 12,
    padding: "14px", marginBottom: 12,
  },
  manualLabel: { fontSize: 12, color: "#888", marginBottom: 10 },

  // Conditioning card
  condDoneTag: { color: "#7dd3fc" },
  condProtocol: { marginBottom: 14 },
  condRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  condTag: {
    fontSize: 10, fontWeight: 800, letterSpacing: "1px", minWidth: 44, textAlign: "center",
    border: "1px solid", borderRadius: 5, padding: "2px 6px",
  },
  condText: { fontSize: 13, color: "#ccc", lineHeight: 1.4 },
  condRounds: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  condRoundBtn: {
    fontSize: 13, fontWeight: 600, background: "#1a1a1a", border: "1px solid #2a2a2a",
    color: "#aaa", padding: "8px 14px", borderRadius: 8, cursor: "pointer",
  },
  condRoundBtnDone: { background: "#0d2b33", border: "1px solid #1d4d5e", color: "#7dd3fc" },
  condNotes: {
    width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8,
    color: "#f0f0f0", fontSize: 13, padding: "10px 12px", outline: "none", marginBottom: 14,
  },

  // Profile
  profileSummaryBtn: {
    display: "flex", alignItems: "center", gap: 12, width: "100%",
    background: "#111", border: "1px solid #1e1e1e", borderRadius: 12,
    padding: "14px 16px", cursor: "pointer", textAlign: "left",
  },
  profileIcon: { fontSize: 20 },
  profileSummaryText: { flex: 1, fontSize: 14, color: "#ccc" },
  profileEdit: { fontSize: 12, fontWeight: 700, color: "#a3e635" },
  profileCard: {
    background: "#111", border: "1px solid #1e1e1e", borderRadius: 12, padding: "16px",
  },
  profileField: { marginBottom: 16 },
  profileLabel: {
    display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "1px",
    color: "#888", textTransform: "uppercase", marginBottom: 8,
  },
  genderRow: { display: "flex", gap: 8 },
  genderBtn: {
    flex: 1, padding: "9px", borderRadius: 8, border: "1px solid #2a2a2a",
    background: "#1a1a1a", color: "#aaa", fontSize: 13, cursor: "pointer",
  },
  genderBtnActive: {
    border: "1px solid #a3e635", background: "#182800", color: "#a3e635", fontWeight: 700,
  },
  heightRow: { display: "flex", alignItems: "center", gap: 8 },
  profileInput: {
    width: 80, background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8,
    color: "#f0f0f0", fontSize: 15, padding: "9px 12px", outline: "none",
  },
  heightUnit: { fontSize: 13, color: "#666", marginRight: 8 },
  profileDoneBtn: {
    width: "100%", padding: "12px", background: "#a3e635", color: "#0a0a0a",
    border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
  },
  profileNote: { fontSize: 12, color: "#666", lineHeight: 1.5, marginTop: 12 },
  optionalTag: { color: "#555", fontWeight: 400, textTransform: "none", letterSpacing: 0 },
  hrEstimate: { fontSize: 12, color: "#7dd3fc", marginTop: 8, lineHeight: 1.4 },

  // HR zones reference card (conditioning days)
  hrCard: {
    background: "#0d1418", border: "1px solid #1d3a4d", borderRadius: 12,
    padding: "14px 16px", marginBottom: 16,
  },
  hrCardTitle: {
    fontSize: 10, fontWeight: 800, letterSpacing: "1.5px", color: "#7dd3fc", marginBottom: 12,
  },
  hrCardMax: { color: "#5a7a8a", fontWeight: 600 },
  hrZoneRow: { display: "flex", alignItems: "center", gap: 10, padding: "5px 0" },
  hrZoneDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  hrZoneLabel: { flex: 1, fontSize: 13, color: "#bbb" },
  hrZoneVal: { fontSize: 13, fontWeight: 700, color: "#e0e0e0" },

  // Warm-up (ramp-up) sets
  warmupBox: {
    background: "#161205", border: "1px solid #3a2e0a", borderRadius: 10,
    padding: "12px 14px", marginBottom: 12,
  },
  warmupTitle: {
    fontSize: 10, fontWeight: 800, letterSpacing: "1.5px", color: "#c9a227", marginBottom: 8,
  },
  warmupRow: { display: "flex", alignItems: "center", gap: 10, padding: "3px 0" },
  warmupNum: {
    fontSize: 11, fontWeight: 800, color: "#c9a227", minWidth: 26,
  },
  warmupWeight: { flex: 1, fontSize: 13, color: "#d8c88a" },
  warmupReps: { fontSize: 13, color: "#9a8a4a", fontWeight: 600 },
  warmupHint: { fontSize: 11, color: "#6a5a2a", marginTop: 6, fontStyle: "italic" },

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
