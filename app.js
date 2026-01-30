// FORGE v1.0 — single-file PWA app (offline + local-only)
// Core: quests + timer + logs + reps/sets tracking + progression guardrail + XP/traits/tokens + permissions store + capped surprise bonus.

const STORE_KEY = "forge_v1_store";
const BONUS = {
  baseChance: 0.20,          // 20%
  perWinBonus: 0.05,         // +5% per completed quest this week (up to maxChance)
  maxChance: 0.40,           // 40%
  dailyCap: 2,
  weeklyCap: 6,
};

const TRAITS = ["Confidence", "Discipline", "Energy", "Focus", "Mood"];

const DEFAULT_RITUALS = ["Change shirt", "Same playlist", "Same time window", "Water", "Quick walk"];
const DEFAULT_REWARDS = ["Shower", "Scroll", "TV", "Tea", "Relax"];

const QUESTS = {
  save: {
    id: "save",
    name: "Save Quest",
    minutes: 6,
    desc: "Preserve identity on brutal days. Leave reps in reserve.",
    steps: [
      { title: "2 rounds", body: "10 squats · 6 incline/knee pushups · 10 hinges/glute bridges" },
      { title: "Rule", body: "Stop early on purpose. Finish wanting more." },
    ],
    exercises: [
      { key: "squat", name: "Squat", target: "10 × 2 rounds", modeOptions: ["Bodyweight", "KB goblet"] },
      { key: "push", name: "Push", target: "6 × 2 rounds", modeOptions: ["Incline", "Knee", "Floor"] },
      { key: "hinge", name: "Hinge", target: "10 × 2 rounds", modeOptions: ["Glute bridge", "Hip hinge", "KB RDL"] },
    ],
    rewards: { xp: 15, tokens: 1, trait: { Confidence:1, Discipline:1, Energy:1, Focus:0, Mood:1 } }
  },

  express: {
    id: "express",
    name: "Express Quest",
    minutes: 12,
    desc: "Busy day win. EMOM x 8 plus quick finisher.",
    steps: [
      { title: "Warm-up (2 min)", body: "March/stairs 60s · 10 squats · 20s plank" },
      { title: "Main (8 min)", body: "EMOM x8 alternating: Min1 squat 8–12 · Min2 push 6–12" },
      { title: "Finisher (2 min)", body: "Fast walk/stairs/shadow boxing" },
    ],
    exercises: [
      { key: "squat", name: "Squat", target: "8–12 on squat minutes", modeOptions: ["Bodyweight", "KB goblet"] },
      { key: "push", name: "Push", target: "6–12 on push minutes", modeOptions: ["Incline", "Floor"] },
    ],
    rewards: { xp: 25, tokens: 2, trait: { Confidence:1, Discipline:1, Energy:1, Focus:1, Mood:1 } }
  },

  core: {
    id: "core",
    name: "Core Quest",
    minutes: 20,
    desc: "Main strength stimulus (aim 3x/week). Hard breathing, not destroyed.",
    steps: [
      { title: "Warm-up (2 min)", body: "Brisk 30s · 10 squats · 10 incline pushups · 20s plank" },
      { title: "Main (15 min)", body: "EMOM x15: Squat · Push · Hinge (repeat x5). Leave 2–4 RIR." },
      { title: "Finisher (3 min)", body: "Stairs / incline walk / easy swings / shadow boxing" },
    ],
    exercises: [
      { key: "squat", name: "Squat", target: "8–12", modeOptions: ["KB goblet", "Bodyweight"] },
      { key: "push", name: "Push", target: "6–12", modeOptions: ["Incline", "Floor"] },
      { key: "hinge", name: "Hinge", target: "8–12", modeOptions: ["KB RDL", "KB deadlift"] },
    ],
    rewards: { xp: 35, tokens: 3, trait: { Confidence:2, Discipline:2, Energy:1, Focus:1, Mood:1 } }
  },
};

// ---- Helpers ----
function ymd(d = new Date()){
  return d.toISOString().slice(0,10);
}
function weekKey(d = new Date()){
  // ISO week-ish: year + week number (simple)
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2,"0")}`;
}
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function fmtTimer(sec){
  const m = Math.floor(sec/60), s = sec%60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function levelFromXP(xp){
  // gentle curve: lvl ~ sqrt
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}
function safeJSONParse(raw, fallback){
  try { return JSON.parse(raw); } catch { return fallback; }
}

// ---- State ----
function defaultState(){
  const traits = {};
  for (const t of TRAITS) traits[t] = 10;

  return {
    xp: 0,
    tokens: 0,
    traits,
    streak: 0,
    lastDone: null,
    today: { selectedQuest: null, startedAt: null, pausedRemain: null, completed: false },
    logs: [],                 // [{date, questId, exercises:[...], xp, tokensEarned, bonusTokens, ritual, reward}]
    anchors: {},              // by date: {protein,fiber,treat}
    exercise: {},             // per key: { lastReps, lastSets, lastMode, lastDiff, progressedLastTime, lastDate }
    permissions: [
      { id: crypto.randomUUID(), name: "Dessert", cost: 1, category:"treat", weeklyCap: 4, spentThisWeek: {} },
      { id: crypto.randomUUID(), name: "Takeout", cost: 3, category:"food", weeklyCap: 2, spentThisWeek: {} },
      { id: crypto.randomUUID(), name: "Guilt-free scrolling", cost: 2, category:"screen", weeklyCap: 7, spentThisWeek: {} },
      { id: crypto.randomUUID(), name: "One alcoholic drink", cost: 2, category:"alcohol", weeklyCap: 2, spentThisWeek: {} },
    ],
    allowAlcohol: true,
    ritual: { selected: DEFAULT_RITUALS[0], options: DEFAULT_RITUALS },
    reward: { selected: DEFAULT_REWARDS[0], options: DEFAULT_REWARDS },
    bonusLedger: {
      // by date: bonus tokens awarded
      daily: {}, // { "YYYY-MM-DD": n }
      // by week: bonus tokens awarded
      weekly: {}, // { "YYYY-Wxx": n }
    }
  };
}

let state = safeJSONParse(localStorage.getItem(STORE_KEY), null) ?? defaultState();
function persist(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

// ---- DOM ----
const screens = {
  home: document.getElementById("screen-home"),
  quest: document.getElementById("screen-quest"),
  log: document.getElementById("screen-log"),
  store: document.getElementById("screen-store"),
  settings: document.getElementById("screen-settings"),
};

const tabs = Array.from(document.querySelectorAll(".tab"));

const hudStreak = document.getElementById("hudStreak");
const hudLevel = document.getElementById("hudLevel");
const hudXP = document.getElementById("hudXP");
const hudTokens = document.getElementById("hudTokens");

const todayMsg = document.getElementById("todayMsg");
const questGrid = document.getElementById("questGrid");
const btnGoQuest = document.getElementById("btnGoQuest");
const btnQuickSave = document.getElementById("btnQuickSave");
const btnResetToday = document.getElementById("btnResetToday");

const aProtein = document.getElementById("aProtein");
const aFiber = document.getElementById("aFiber");
const aTreat = document.getElementById("aTreat");
const btnSaveAnchors = document.getElementById("btnSaveAnchors");
const anchorsSaved = document.getElementById("anchorsSaved");

const traitsEl = document.getElementById("traits");

const questBadge = document.getElementById("questBadge");
const questTitle = document.getElementById("questTitle");
const questDesc = document.getElementById("questDesc");
const questSteps = document.getElementById("questSteps");

const timerText = document.getElementById("timerText");
const timerHint = document.getElementById("timerHint");
const btnStart = document.getElementById("btnStart");
const btnPause = document.getElementById("btnPause");
const btnFinish = document.getElementById("btnFinish");

const progressPanel = document.getElementById("progressPanel");

const ritualChips = document.getElementById("ritualChips");
const rewardChips = document.getElementById("rewardChips");

const historyEl = document.getElementById("history");
const btnExport = document.getElementById("btnExport");
const btnImport = document.getElementById("btnImport");

const permList = document.getElementById("permList");
const btnAddPermission = document.getElementById("btnAddPermission");
const bonusExplainer = document.getElementById("bonusExplainer");
const capDaily = document.getElementById("capDaily");
const capWeekly = document.getElementById("capWeekly");

const toggleAlcohol = document.getElementById("toggleAlcohol");

const modal = document.getElementById("modal");
const btnCloseModal = document.getElementById("btnCloseModal");
const btnCancelComplete = document.getElementById("btnCancelComplete");
const btnConfirmComplete = document.getElementById("btnConfirmComplete");
const modalQuestMeta = document.getElementById("modalQuestMeta");
const workoutForm = document.getElementById("workoutForm");

// ---- Navigation ----
function showTab(name){
  for (const [k, el] of Object.entries(screens)){
    el.classList.toggle("hidden", k !== name);
  }
  tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  renderAll();
}
tabs.forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));

// ---- Rendering ----
function renderHUD(){
  const lvl = levelFromXP(state.xp);
  hudStreak.textContent = `Streak: ${state.streak}`;
  hudLevel.textContent = `Level: ${lvl}`;
  hudXP.textContent = `XP: ${state.xp}`;
  hudTokens.textContent = `Tokens: ${state.tokens}`;
}

function completedThisWeekCount(){
  const wk = weekKey();
  return state.logs.filter(l => weekKey(new Date(l.date)) === wk).length;
}

function bonusChance(){
  const wins = completedThisWeekCount();
  return clamp(BONUS.baseChance + wins * BONUS.perWinBonus, BONUS.baseChance, BONUS.maxChance);
}

function getBonusCaps(){
  const d = ymd();
  const w = weekKey();
  const dailyGiven = state.bonusLedger.daily[d] ?? 0;
  const weeklyGiven = state.bonusLedger.weekly[w] ?? 0;
  return { dailyGiven, weeklyGiven, dailyLeft: Math.max(0, BONUS.dailyCap - dailyGiven), weeklyLeft: Math.max(0, BONUS.weeklyCap - weeklyGiven) };
}

function renderHome(){
  // message
  const d = ymd();
  const already = state.logs.find(l => l.date === d);
  if (already){
    todayMsg.textContent = "Win logged. Momentum secured. If you want, do a bonus quest for fun (cosmetics later).";
  } else {
    todayMsg.textContent = "Pick a quest that leaves you feeling better than you started.";
  }

  // quest tiles
  questGrid.innerHTML = "";
  Object.values(QUESTS).forEach(q => {
    const sel = state.today.selectedQuest === q.id;
    const div = document.createElement("button");
    div.className = `quest ${sel ? "sel" : ""}`;
    const hint = questHint(q.id);
    div.innerHTML = `
      <div class="questTitle">${q.name}</div>
      <div class="questMeta">${q.minutes} min · ${q.id === "save" ? "identity protection" : q.id === "express" ? "busy day win" : "strength stimulus"}</div>
      <div class="questHint">${hint}</div>
    `;
    div.addEventListener("click", () => {
      state.today.selectedQuest = q.id;
      state.today.startedAt = null;
      state.today.pausedRemain = null;
      state.today.completed = false;
      persist();
      renderAll();
    });
    questGrid.appendChild(div);
  });

  btnGoQuest.disabled = !state.today.selectedQuest;

  // anchors
  const a = state.anchors[d] ?? { protein:false, fiber:false, treat:false };
  aProtein.checked = !!a.protein;
  aFiber.checked = !!a.fiber;
  aTreat.checked = !!a.treat;
  anchorsSaved.textContent = "";

  // traits
  traitsEl.innerHTML = "";
  for (const t of TRAITS){
    const val = clamp(state.traits[t] ?? 0, 0, 100);
    const div = document.createElement("div");
    div.className = "trait";
    div.innerHTML = `
      <div class="row"><div><strong>${t}</strong></div><div class="muted">${val}</div></div>
      <div class="bar"><div style="width:${val}%"></div></div>
    `;
    traitsEl.appendChild(div);
  }
}

function questHint(qid){
  // Recommend based on “brutal day” heuristic: if last quest was core, suggest express/save; if none, suggest express.
  const last = state.logs[0]?.questId;
  if (!last) return qid === "express" ? "Suggested: start here." : "Good option.";
  if (last === "core" && qid === "core") return "Maybe choose Express today for relief.";
  if (last === "save" && qid === "save") return "If you can, upgrade to Express for momentum.";
  return "Clean win.";
}

function renderQuest(){
  const qid = state.today.selectedQuest;
  if (!qid){
    questBadge.textContent = "No quest selected";
    questTitle.textContent = "—";
    questDesc.textContent = "Select a quest on Home.";
    questSteps.innerHTML = "";
    timerText.textContent = "00:00";
    timerHint.textContent = "Tap Start";
    btnStart.disabled = true;
    btnPause.disabled = true;
    btnFinish.disabled = true;
    return;
  }

  const q = QUESTS[qid];
  questBadge.textContent = `${q.name} · ${q.minutes} min`;
  questTitle.textContent = q.name;
  questDesc.textContent = q.desc;

  questSteps.innerHTML = "";
  q.steps.forEach(s => {
    const div = document.createElement("div");
    div.className = "step";
    div.innerHTML = `<div class="stepTitle">${s.title}</div><div class="stepBody">${s.body}</div>`;
    questSteps.appendChild(div);
  });

  const remain = getRemainingSeconds(q);
  timerText.textContent = fmtTimer(remain);
  timerHint.textContent = state.today.startedAt ? "Running…" : "Tap Start";

  btnStart.disabled = !!state.today.startedAt;
  btnPause.disabled = !state.today.startedAt;
  btnFinish.disabled = state.today.completed ? true : false;

  // chips
  renderChips(ritualChips, state.ritual.options, state.ritual.selected, (v)=>{ state.ritual.selected=v; persist(); renderAll(); });
  renderChips(rewardChips, state.reward.options, state.reward.selected, (v)=>{ state.reward.selected=v; persist(); renderAll(); });

  // progress panel
  renderProgressPanel(q);
}

function renderChips(container, options, selected, onSelect){
  container.innerHTML = "";
  options.forEach(opt => {
    const b = document.createElement("button");
    b.className = `chip ${opt === selected ? "sel" : ""}`;
    b.textContent = opt;
    b.addEventListener("click", () => onSelect(opt));
    container.appendChild(b);
  });
}

function getExerciseState(key){
  if (!state.exercise[key]){
    state.exercise[key] = {
      lastReps: "",
      lastSets: "",
      lastMode: "",
      lastDiff: "ok",
      progressedLastTime: false,
      lastDate: null
    };
  }
  return state.exercise[key];
}

function recommendForExercise(key){
  const es = getExerciseState(key);
  if (!es.lastDate){
    return { label: "Start baseline. Keep it honest. Leave reps in reserve.", status:"good", canProgress:true };
  }
  if (es.progressedLastTime){
    return { label: "Hold steady today (rule: no progression two sessions in a row).", status:"warn", canProgress:false };
  }
  if (es.lastDiff === "easy"){
    return { label: "You may progress ONE step: +1–2 reps OR slower tempo OR add KB.", status:"good", canProgress:true };
  }
  return { label: "Hold steady. Clean reps. Finish wanting more.", status:"warn", canProgress:false };
}

function renderProgressPanel(q){
  progressPanel.innerHTML = "";
  q.exercises.forEach(ex => {
    const es = getExerciseState(ex.key);
    const rec = recommendForExercise(ex.key);

    const div = document.createElement("div");
    div.className = "kv";
    div.innerHTML = `
      <div>
        <strong>${ex.name}</strong>
        <div class="small">Last: ${es.lastReps || "—"} reps × ${es.lastSets || "—"} · ${es.lastMode || "—"} · ${es.lastDiff || "—"} · ${es.lastDate || "—"}</div>
        <div class="small">${rec.label}</div>
      </div>
      <div>
        <span class="badge ${rec.status === "good" ? "good" : "warn"}">${rec.canProgress ? "OK" : "Hold"}</span>
      </div>
    `;
    progressPanel.appendChild(div);
  });
}

function renderLog(){
  historyEl.innerHTML = "";
  if (!state.logs.length){
    historyEl.innerHTML = `<div class="muted">No logs yet. Your future self will thank you.</div>`;
    return;
  }
  state.logs.slice(0, 25).forEach(l => {
    const q = QUESTS[l.questId];
    const exLines = l.exercises.map(e => `• ${e.name}: ${e.reps} reps × ${e.sets} (${e.mode}; ${e.diff})${e.progressed ? " · progressed" : ""}`).join("<br>");
    const bonusLine = l.bonusTokens ? `<br><span class="badge good">+${l.bonusTokens} bonus tokens</span>` : "";
    const div = document.createElement("div");
    div.className = "step";
    div.innerHTML = `
      <div class="stepTitle">${l.date} · ${q?.name ?? l.questId}</div>
      <div class="stepBody">${exLines}${bonusLine}<br><span class="muted">Ritual: ${l.ritual || "—"} · Reward: ${l.reward || "—"} · XP +${l.xp} · Tokens +${l.tokensEarned}</span></div>
    `;
    historyEl.appendChild(div);
  });
}

function renderStore(){
  // Bonus explainer
  const chance = bonusChance();
  const caps = getBonusCaps();
  bonusExplainer.textContent = `Current bonus chance: ${(chance*100).toFixed(0)}% (max ${(BONUS.maxChance*100).toFixed(0)}%). You can receive 0–2 bonus tokens after a completed quest, capped.`;
  capDaily.textContent = `${caps.dailyGiven}/${BONUS.dailyCap} used today`;
  capWeekly.textContent = `${caps.weeklyGiven}/${BONUS.weeklyCap} used this week`;

  // Permissions
  permList.innerHTML = "";
  const wk = weekKey();
  const list = state.permissions.filter(p => state.allowAlcohol ? true : p.category !== "alcohol");
  if (!list.length){
    permList.innerHTML = `<div class="muted">No permissions yet. Add one.</div>`;
    return;
  }

  list.forEach(p => {
    const spent = p.spentThisWeek?.[wk] ?? 0;
    const left = Math.max(0, (p.weeklyCap ?? 999) - spent);

    const item = document.createElement("div");
    item.className = "permItem";
    item.innerHTML = `
      <div class="permTop">
        <div>
          <div class="permName">${p.name}</div>
          <div class="permMeta">Cost: ${p.cost} token(s) · Weekly cap: ${p.weeklyCap} · Left this week: ${left}</div>
        </div>
        <div class="badge">${p.category}</div>
      </div>
      <div class="permActions">
        <button class="secondary" data-act="spend">Spend</button>
        <button class="ghost" data-act="edit">Edit</button>
        <button class="ghost" data-act="delete">Delete</button>
      </div>
    `;

    item.querySelector('[data-act="spend"]').addEventListener("click", () => spendPermission(p.id));
    item.querySelector('[data-act="edit"]').addEventListener("click", () => editPermission(p.id));
    item.querySelector('[data-act="delete"]').addEventListener("click", () => deletePermission(p.id));

    permList.appendChild(item);
  });
}

function renderSettings(){
  toggleAlcohol.checked = !!state.allowAlcohol;
}

function renderAll(){
  renderHUD();
  renderHome();
  renderQuest();
  renderLog();
  renderStore();
  renderSettings();
}

// ---- Anchors ----
btnSaveAnchors.addEventListener("click", () => {
  const d = ymd();
  state.anchors[d] = { protein: aProtein.checked, fiber: aFiber.checked, treat: aTreat.checked };
  persist();
  anchorsSaved.textContent = "Saved.";
});

// ---- Timer + quest flow ----
let timerInterval = null;

function getRemainingSeconds(q){
  if (state.today.pausedRemain != null) return state.today.pausedRemain;
  if (!state.today.startedAt) return q.minutes * 60;
  const elapsed = Math.floor((Date.now() - state.today.startedAt)/1000);
  return Math.max(q.minutes*60 - elapsed, 0);
}

function startQuest(){
  const qid = state.today.selectedQuest;
  if (!qid) return;
  const q = QUESTS[qid];

  state.today.startedAt = Date.now();
  state.today.pausedRemain = null;
  persist();
  renderAll();

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const rem = getRemainingSeconds(q);
    timerText.textContent = fmtTimer(rem);
    timerHint.textContent = rem === 0 ? "Time. You can complete." : "Running…";
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnFinish.disabled = false;

    if (rem === 0){
      clearInterval(timerInterval);
      timerInterval = null;
      btnPause.disabled = true;
      btnStart.disabled = true;
      btnFinish.disabled = false;
    }
  }, 250);
}

function pauseQuest(){
  const qid = state.today.selectedQuest;
  if (!qid) return;
  const q = QUESTS[qid];
  const rem = getRemainingSeconds(q);

  state.today.startedAt = null;
  state.today.pausedRemain = rem;
  persist();

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;

  timerText.textContent = fmtTimer(rem);
  timerHint.textContent = "Paused";
  btnStart.disabled = false;
  btnPause.disabled = true;
  btnFinish.disabled = false;
}

btnStart.addEventListener("click", startQuest);
btnPause.addEventListener("click", pauseQuest);

btnGoQuest.addEventListener("click", () => showTab("quest"));

btnQuickSave.addEventListener("click", () => {
  state.today.selectedQuest = "save";
  state.today.startedAt = null;
  state.today.pausedRemain = null;
  state.today.completed = false;
  persist();
  showTab("quest");
  renderAll();
});

btnResetToday.addEventListener("click", () => {
  state.today = { selectedQuest: null, startedAt: null, pausedRemain: null, completed: false };
  persist();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  renderAll();
});

// ---- Completion modal ----
function openModal(){
  const qid = state.today.selectedQuest;
  if (!qid) return;
  const q = QUESTS[qid];

  modalQuestMeta.textContent = `${q.name} · ${q.minutes} min · Ritual: ${state.ritual.selected} · Reward: ${state.reward.selected}`;
  workoutForm.innerHTML = "";

  q.exercises.forEach(ex => {
    const es = getExerciseState(ex.key);
    const rec = recommendForExercise(ex.key);

    const block = document.createElement("div");
    block.className = "step";
    block.innerHTML = `
      <div class="row">
        <div>
          <div class="stepTitle">${ex.name}</div>
          <div class="stepBody">Target: ${ex.target}</div>
          <div class="stepBody">${rec.label}</div>
        </div>
        <div><span class="badge ${rec.status === "good" ? "good" : "warn"}">${rec.canProgress ? "OK" : "Hold"}</span></div>
      </div>

      <div class="fieldGrid">
        <div>
          <label class="lbl">Mode</label>
          <select class="input" data-k="${ex.key}" data-f="mode">
            ${ex.modeOptions.map(m => `<option ${m===es.lastMode ? "selected":""}>${m}</option>`).join("")}
          </select>
        </div>

        <div>
          <label class="lbl">Reps</label>
          <input class="input" data-k="${ex.key}" data-f="reps" placeholder="e.g., 10 or 8-12" value="${es.lastReps ?? ""}">
        </div>

        <div>
          <label class="lbl">Sets / rounds</label>
          <input class="input" data-k="${ex.key}" data-f="sets" placeholder="e.g., 2" value="${es.lastSets ?? ""}">
        </div>
      </div>

      <div class="fieldGrid">
        <div>
          <label class="lbl">Difficulty</label>
          <select class="input" data-k="${ex.key}" data-f="diff">
            <option value="easy" ${es.lastDiff==="easy"?"selected":""}>easy</option>
            <option value="ok" ${es.lastDiff==="ok"?"selected":""}>ok</option>
            <option value="hard" ${es.lastDiff==="hard"?"selected":""}>hard</option>
          </select>
        </div>

        <div>
          <label class="lbl">Progressed today?</label>
          <select class="input" data-k="${ex.key}" data-f="progressed">
            <option value="no">no</option>
            <option value="yes">yes</option>
          </select>
        </div>

        <div>
          <label class="lbl">Rule check</label>
          <div class="input" style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
            <span class="muted">${es.progressedLastTime ? "Last time progressed" : "Last time held"}</span>
            <span class="badge">${es.progressedLastTime ? "Hold next" : "OK"}</span>
          </div>
        </div>
      </div>
    `;
    workoutForm.appendChild(block);
  });

  modal.classList.remove("hidden");
}

function closeModal(){
  modal.classList.add("hidden");
}

btnCloseModal.addEventListener("click", closeModal);
btnCancelComplete.addEventListener("click", closeModal);

btnFinish.addEventListener("click", () => {
  if (state.today.completed) return;
  openModal();
});

// ---- Complete logic (XP/traits/tokens/streak/bonus caps) ----
function awardStreak(){
  const today = ymd();
  const last = state.lastDone;

  if (last === today) return; // already counted today

  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = ymd(y);

  state.streak = (last === yesterday) ? (state.streak + 1) : 1;
  state.lastDone = today;
}

function rollBonusTokens(){
  const caps = getBonusCaps();
  if (caps.dailyLeft <= 0 || caps.weeklyLeft <= 0) return 0;

  const chance = bonusChance();
  const hit = Math.random() < chance;
  if (!hit) return 0;

  // 0–2 bonus tokens, but if hit, give 1–2 (feels better + still capped)
  let bonus = (Math.random() < 0.5) ? 1 : 2;

  // Respect caps
  bonus = Math.min(bonus, caps.dailyLeft, caps.weeklyLeft);
  return bonus;
}

function applyBonusLedger(bonus){
  if (!bonus) return;
  const d = ymd();
  const w = weekKey();
  state.bonusLedger.daily[d] = (state.bonusLedger.daily[d] ?? 0) + bonus;
  state.bonusLedger.weekly[w] = (state.bonusLedger.weekly[w] ?? 0) + bonus;
}

function applyQuestRewards(q, bonusTokens){
  // XP
  state.xp += q.rewards.xp;

  // Tokens
  state.tokens += q.rewards.tokens;
  if (bonusTokens) state.tokens += bonusTokens;

  // Traits (deterministic)
  for (const [trait, inc] of Object.entries(q.rewards.trait)){
    state.traits[trait] = clamp((state.traits[trait] ?? 0) + inc, 0, 100);
  }
}

function readFormValues(){
  const q = QUESTS[state.today.selectedQuest];
  const out = [];

  q.exercises.forEach(ex => {
    const mode = document.querySelector(`[data-k="${ex.key}"][data-f="mode"]`).value;
    const reps = document.querySelector(`[data-k="${ex.key}"][data-f="reps"]`).value.trim();
    const sets = document.querySelector(`[data-k="${ex.key}"][data-f="sets"]`).value.trim();
    const diff = document.querySelector(`[data-k="${ex.key}"][data-f="diff"]`).value;
    const progressed = document.querySelector(`[data-k="${ex.key}"][data-f="progressed"]`).value === "yes";

    out.push({ key: ex.key, name: ex.name, mode, reps, sets, diff, progressed });
  });

  return out;
}

btnConfirmComplete.addEventListener("click", () => {
  const qid = state.today.selectedQuest;
  if (!qid) return;

  const q = QUESTS[qid];
  const date = ymd();

  // Prevent double log for today by accident
  const already = state.logs.find(l => l.date === date && l.questId === qid && l.completed);
  // Not “punishment”, just prevents duplicates
  if (already){
    closeModal();
    alert("Already logged. If you want another short win, run a bonus quest later.");
    return;
  }

  // Collect workout data
  const exercises = readFormValues();

  // Bonus token roll (transparent + capped)
  const bonus = rollBonusTokens();
  applyBonusLedger(bonus);

  // Apply rewards
  awardStreak();
  applyQuestRewards(q, bonus);

  // Update exercise progression memory
  exercises.forEach(e => {
    const es = getExerciseState(e.key);

    // If user says progressed today, we record it (no punishment),
    // and next time engine recommends holding (enforces rule by guidance).
    es.lastMode = e.mode;
    es.lastReps = e.reps;
    es.lastSets = e.sets;
    es.lastDiff = e.diff;
    es.progressedLastTime = !!e.progressed;
    es.lastDate = date;
  });

  // Log entry
  const entry = {
    id: crypto.randomUUID(),
    date,
    questId: qid,
    exercises,
    xp: q.rewards.xp,
    tokensEarned: q.rewards.tokens,
    bonusTokens: bonus,
    ritual: state.ritual.selected,
    reward: state.reward.selected,
    completed: true
  };
  state.logs.unshift(entry);

  // Mark today
  state.today.completed = true;
  state.today.startedAt = null;
  state.today.pausedRemain = null;

  persist();
  closeModal();

  // friendly message
  const msg = bonus ? `Quest complete. +${q.rewards.xp} XP. +${q.rewards.tokens} tokens (+${bonus} bonus).` : `Quest complete. +${q.rewards.xp} XP. +${q.rewards.tokens} tokens.`;
  alert(msg);

  renderAll();
});

// ---- Store actions ----
function spendPermission(id){
  const p = state.permissions.find(x => x.id === id);
  if (!p) return;

  const wk = weekKey();
  const spent = p.spentThisWeek?.[wk] ?? 0;
  const left = Math.max(0, (p.weeklyCap ?? 999) - spent);

  if (!state.allowAlcohol && p.category === "alcohol"){
    alert("Alcohol permissions are disabled in Settings.");
    return;
  }
  if (left <= 0){
    alert("Weekly cap reached for this permission. Choose another win.");
    return;
  }
  if (state.tokens < p.cost){
    alert("Not enough tokens right now. A short quest will do it.");
    return;
  }

  state.tokens -= p.cost;
  p.spentThisWeek[wk] = spent + 1;
  persist();
  renderAll();
  alert("Choice made. Enjoy.");
}

function editPermission(id){
  const p = state.permissions.find(x => x.id === id);
  if (!p) return;

  const name = prompt("Permission name:", p.name) ?? p.name;
  const cost = Number(prompt("Token cost:", String(p.cost)) ?? p.cost);
  const category = prompt("Category (treat/food/screen/alcohol/other):", p.category) ?? p.category;
  const weeklyCap = Number(prompt("Weekly cap:", String(p.weeklyCap)) ?? p.weeklyCap);

  p.name = name.trim() || p.name;
  p.cost = clamp(isNaN(cost) ? p.cost : cost, 0, 99);
  p.category = (category.trim() || p.category).toLowerCase();
  p.weeklyCap = clamp(isNaN(weeklyCap) ? p.weeklyCap : weeklyCap, 0, 99);

  persist();
  renderAll();
}

function deletePermission(id){
  const p = state.permissions.find(x => x.id === id);
  if (!p) return;
  if (!confirm("Delete this permission?")) return;
  state.permissions = state.permissions.filter(x => x.id !== id);
  persist();
  renderAll();
}

btnAddPermission.addEventListener("click", () => {
  const name = prompt("Permission name:", "Something enjoyable") ?? "";
  const cost = Number(prompt("Token cost:", "2") ?? "2");
  const category = (prompt("Category (treat/food/screen/alcohol/other):", "other") ?? "other").toLowerCase();
  const weeklyCap = Number(prompt("Weekly cap:", "3") ?? "3");

  const p = {
    id: crypto.randomUUID(),
    name: name.trim() || "Permission",
    cost: clamp(isNaN(cost) ? 2 : cost, 0, 99),
    category,
    weeklyCap: clamp(isNaN(weeklyCap) ? 3 : weeklyCap, 0, 99),
    spentThisWeek: {}
  };

  state.permissions.unshift(p);
  persist();
  renderAll();
});

// ---- Settings ----
toggleAlcohol.addEventListener("change", () => {
  state.allowAlcohol = !!toggleAlcohol.checked;
  persist();
  renderAll();
});

// ---- Export / Import ----
btnExport.addEventListener("click", async () => {
  const data = JSON.stringify(state, null, 2);
  try {
    await navigator.clipboard.writeText(data);
    alert("Export copied to clipboard.");
  } catch {
    alert("Could not copy automatically. Use Settings > share or copy manually from your browser.");
  }
});

btnImport.addEventListener("click", async () => {
  const raw = prompt("Paste exported JSON here. This will replace current data.", "");
  if (!raw) return;
  const parsed = safeJSONParse(raw, null);
  if (!parsed || typeof parsed !== "object"){
    alert("Import failed (invalid JSON).");
    return;
  }
  state = parsed;
  persist();
  renderAll();
  alert("Imported.");
});

// ---- Service worker ----
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

// ---- Init ----
btnGoQuest.addEventListener("click", () => showTab("quest"));
renderAll();
showTab("home");
