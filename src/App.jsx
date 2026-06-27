import { useState, useEffect, useCallback } from "react";

// ── Equipment context passed to the AI ──────────────────────────────────────
const EQUIPMENT_DESCRIPTION = `
- Bowflex SelectTech adjustable dumbbells (adjustable weight, single pair)
- Adjustable bench (can be set flat, incline, or decline)
- Major Fitness F22 power rack, which includes ALL of the following built-in:
    • Standard Olympic barbell (45 lbs)
    • Multi-grip pull-up bar with wide, neutral, and close-grip handle options
    • Dual cable pulley system (plate-loaded, 2:1 ratio) with lat pulldown bar, straight bar, and cable D handles
    • Rack-mounted dip bars (two grip widths)
    • 360° landmine attachment
    • Band pegs (top and bottom)
- Available plates for both barbell and cable system: two 35 lb plates, two 15 lb plates, two 10 lb plates
- Barbell weighs 45 lbs (standard Olympic bar)
- Possible barbell loading combinations (per side): 35, 35+10, 35+15, 35+15+10, 10, 15, 15+10
`.trim();

const FOCUS_OPTIONS = ["Full Body", "Upper Body", "Lower Body", "Core", "Push", "Pull", "Legs"];

// ── localStorage helpers ─────────────────────────────────────────────────────
const LS_KEYS = {
  exercises: "yw_exercises",
  logs: "yw_logs",
  completedSets: "yw_completedSets",
  focus: "yw_focus",
  screen: "yw_screen",
  lastDate: "yw_lastDate",
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

// ── Root component ───────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]             = useState(() => lsGet(LS_KEYS.screen, "setup"));
  const [focus, setFocus]               = useState(() => lsGet(LS_KEYS.focus, "Full Body"));
  const [exercises, setExercises]       = useState(() => lsGet(LS_KEYS.exercises, []));
  const [logs, setLogs]                 = useState(() => lsGet(LS_KEYS.logs, {}));
  const [completedSets, setCompletedSets] = useState(() => lsGet(LS_KEYS.completedSets, {}));
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [swappingIndex, setSwappingIndex] = useState(null);

  // Persist every state change to localStorage
  useEffect(() => { lsSet(LS_KEYS.screen, screen); }, [screen]);
  useEffect(() => { lsSet(LS_KEYS.focus, focus); }, [focus]);
  useEffect(() => { lsSet(LS_KEYS.exercises, exercises); }, [exercises]);
  useEffect(() => { lsSet(LS_KEYS.logs, logs); }, [logs]);
  useEffect(() => { lsSet(LS_KEYS.completedSets, completedSets); }, [completedSets]);

  // Auto-reset logs if it's a new day (keep exercises, clear progress)
  useEffect(() => {
    const last = lsGet(LS_KEYS.lastDate, null);
    const today = todayStr();
    if (last && last !== today) {
      setLogs({});
      setCompletedSets({});
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
    const prompt = `You are a certified personal trainer. Generate a daily functional exercise routine using ONLY this equipment:
${EQUIPMENT_DESCRIPTION}

Focus: ${focus}.
Provide exactly 6 exercises. For any barbell exercise, specify the exact plate loading (e.g. "45 lb bar + 35 lb each side = 115 lbs total"). For dumbbell exercises, suggest a starting dumbbell weight in lbs.
Respond ONLY with a JSON array (no markdown, no extra text):
[{"name":"Exercise Name","sets":3,"reps":"8-10","weight_note":"Specific weight suggestion using available equipment","muscles":"Quads, Glutes","description":"Brief technique tip."}]
Make exercises functional, practical, and well-balanced for this exact equipment.`;

    try {
      const text = await callAI(prompt);
      const arr = parseArray(text);
      if (Array.isArray(arr) && arr.length > 0) {
        const withIds = arr.map((e, i) => ({ ...e, id: `ex-${Date.now()}-${i}` }));
        setExercises(withIds);
        setLogs({});
        setCompletedSets({});
        setScreen("routine");
      } else {
        setError("Couldn't parse exercises — tap Generate to try again.");
      }
    } catch (e) {
      setError(e.message || "Something went wrong.");
    }
    setLoading(false);
  }, [focus, callAI]);

  // ── Swap a single exercise ────────────────────────────────────────────────
  const handleSwap = useCallback(async (index) => {
    setSwappingIndex(index);
    setError(null);
    const existing = exercises.map(e => e.name).join(", ");
    const toReplace = exercises[index]?.name;
    const prompt = `You are a certified personal trainer. The user has:
${EQUIPMENT_DESCRIPTION}

Their current routine is: ${existing}.
Replace "${toReplace}" with a DIFFERENT functional exercise using only the equipment listed. Keep the focus: ${focus}.
Barbell weight suggestions must account for the bar (45 lbs) plus available plates.
Respond ONLY with a single JSON object (no markdown, no extra text):
{"name":"Exercise Name","sets":3,"reps":"8-10","weight_note":"e.g. Barbell: 45+35 each side = 115 lbs total","muscles":"Quads, Glutes","description":"Brief technique tip."}`;

    try {
      const text = await callAI(prompt);
      const obj = parseObject(text);
      if (obj && obj.name) {
        const oldId = exercises[index]?.id;
        const updated = [...exercises];
        updated[index] = { ...obj, id: `ex-${Date.now()}` };
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
  }, [exercises, focus, callAI]);

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

  // ── Progress ──────────────────────────────────────────────────────────────
  const totalSets = exercises.reduce((a, ex) => a + ex.sets, 0);
  const totalSetsCompleted = exercises.reduce((a, ex) => {
    for (let i = 0; i < ex.sets; i++) if (completedSets[`${ex.id}-${i}`]) a++;
    return a;
  }, 0);
  const progress = totalSets > 0 ? Math.round((totalSetsCompleted / totalSets) * 100) : 0;

  return (
    <div style={s.app}>
      {screen === "setup" ? (
        <SetupScreen
          focus={focus} setFocus={setFocus}
          onGenerate={generateRoutine}
          loading={loading} error={error}
          hasExistingRoutine={exercises.length > 0}
          onResume={() => setScreen("routine")}
        />
      ) : (
        <RoutineScreen
          exercises={exercises} loading={loading} swappingIndex={swappingIndex}
          onSwap={handleSwap} onRefresh={generateRoutine} onBack={() => setScreen("setup")}
          logs={logs} getLog={getLog} updateLog={updateLog}
          completedSets={completedSets} toggleSetDone={toggleSetDone}
          progress={progress} totalSetsCompleted={totalSetsCompleted}
          totalSets={totalSets} focus={focus} error={error}
        />
      )}
    </div>
  );
}

// ── Setup Screen ─────────────────────────────────────────────────────────────
function SetupScreen({ focus, setFocus, onGenerate, loading, error, hasExistingRoutine, onResume }) {
  return (
    <div style={s.container}>
      <div style={s.header}>
        <h1 style={s.title}>YourWorkout</h1>
        <p style={s.subtitle}>Daily Routines Built Around Your Gear</p>
      </div>

      <section style={s.section}>
        <h2 style={s.sectionLabel}>YOUR EQUIPMENT</h2>
        <div style={s.gearCard}>
          <GearRow icon="🏋️" name="Bowflex SelectTech Dumbbells" detail="Adjustable weight · single pair" />
          <div style={s.gearDivider} />
          <GearRow icon="🪑" name="Adjustable Bench" detail="Flat · Incline · Decline" />
          <div style={s.gearDivider} />
          <div style={s.gearItem}>
            <span style={s.gearIcon}>🔩</span>
            <div>
              <div style={s.gearName}>Major Fitness F22 Power Rack</div>
              <div style={s.gearDetail}>45 lb Olympic barbell</div>
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

      <p style={s.hint}>{focus} focus · exercises tailored to your rack & dumbbells</p>
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
  progress, totalSetsCompleted, totalSets, focus, error,
}) {
  const [expandedId, setExpandedId] = useState(null);

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

      <div style={s.progressBar}>
        <div style={{ ...s.progressFill, width: `${progress}%` }} />
      </div>
      <p style={s.progressLabel}>{totalSetsCompleted} / {totalSets} sets complete · {progress}%</p>

      {error && <div style={s.errorBox}>{error}</div>}

      {loading && swappingIndex === null ? (
        <div style={s.loadingBlock}>Generating exercises…</div>
      ) : (
        exercises.map((ex, idx) => {
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
                    <div style={s.cardName}>{ex.name}</div>
                    <div style={s.cardMeta}>
                      {ex.muscles} · {ex.sets} sets × {ex.reps} reps
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
                  <p style={s.weightNote}>💡 {ex.weight_note}</p>

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
                          <input type="number" min="0" placeholder="lbs"
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
                </div>
              )}
            </div>
          );
        })
      )}

      {progress === 100 && (
        <div style={s.doneMessage}>🏆 Workout complete! Great work today.</div>
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
    textAlign: "center", padding: "24px", background: "#0d2b1a",
    border: "1px solid #22c55e", borderRadius: 14, color: "#22c55e",
    fontWeight: 700, fontSize: 18, marginTop: 16,
  },
};
