const $ = (sel, root = document) => root.querySelector(sel);
const fmt = n => Math.round(n).toLocaleString("en-IN");
const short = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let META = null;

function toast(msg, error = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (error ? " error" : "");
  setTimeout(() => (t.className = ""), 2800);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ---------- Tabs ----------
function showTab(name) {
  document.querySelectorAll(".tab[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === name));
  history.replaceState(null, "", "#" + name);
  if (name === "insights") loadInsights();
  if (name === "data") loadData();
}
document.querySelectorAll(".tab[data-tab]").forEach(btn => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

function setTheme(light) {
  document.body.classList.toggle("light", light);
  $("#theme-toggle").textContent = light ? "Dark mode" : "Light mode";
  localStorage.setItem("theme", light ? "light" : "dark");
}
$("#theme-toggle").addEventListener("click", () => setTheme(!document.body.classList.contains("light")));
setTheme(new URLSearchParams(location.search).get("theme") === "light" || localStorage.getItem("theme") === "light");

// ---------- Form ----------
function fillOptions(select, values) {
  select.innerHTML = values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
}

function applyDefaults(profession) {
  const d = META.defaults[profession];
  const form = $("#predict-form");
  for (const [k, v] of Object.entries(d)) {
    const el = form.elements[k];
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!v; else el.value = v;
  }
}

function readForm() {
  const f = $("#predict-form").elements;
  const num = name => Number(f[name].value || 0);
  return {
    profession: f.profession.value,
    day_of_week: f.day_of_week.value,
    model_tier: f.model_tier.value,
    experience_years: num("experience_years"),
    deadline_week: f.deadline_week.checked ? 1 : 0,
    uses_agents: f.uses_agents.checked ? 1 : 0,
    sessions_per_day: num("sessions_per_day"),
    weekend_sessions: num("weekend_sessions"),
    turns_per_session: num("turns_per_session"),
    avg_prompt_words: num("avg_prompt_words"),
    docs_uploaded: num("docs_uploaded"),
    code_task: f.code_task.checked ? 1 : 0,
  };
}

async function init() {
  META = await api("/api/meta");
  fillOptions($("#profession"), META.professions);
  fillOptions($("#day_of_week"), META.days);
  fillOptions($("#model_tier"), META.model_tiers);
  $("#profession").value = "Software Developer";
  applyDefaults("Software Developer");
  $("#profession").addEventListener("change", e => applyDefaults(e.target.value));
  $("#predict-form").addEventListener("submit", onPredict);
  $("#predict-form").requestSubmit();
  const tab = location.hash.slice(1);
  if (["insights", "data", "about"].includes(tab)) showTab(tab);
}

async function onPredict(e) {
  e.preventDefault();
  const btn = $("#predict-form button");
  btn.disabled = true;
  try {
    renderResults(await api("/api/predict", { method: "POST", body: readForm() }));
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Results ----------
function renderResults(r) {
  const p = r.prediction;
  const weekMax = Math.max(...r.weekly.map(d => d.deadline_input + d.deadline_output), 1);
  const tierRows = Object.entries(r.monthly.cost_by_tier).map(([t, c]) =>
    `<tr class="${t === r.inputs.model_tier ? "best" : ""}"><td>${t}</td><td>$${c.usd.toFixed(2)}</td><td>₹${fmt(c.inr)}</td></tr>`).join("");

  $("#results").className = "results";
  $("#results").innerHTML = `
    <div class="card">
      <h2>Predicted usage for ${esc(r.inputs.profession)} on ${esc(r.inputs.day_of_week)}
        ${r.inputs.deadline_week ? '<span class="badge warn">deadline week</span>' : ""}</h2>
      <p class="muted">Random Forest regression (${fmt(p.total_tokens)} total tokens today)</p>
      <div class="kpis">
        <div class="kpi in"><div class="label">Tokens you feed to AI (input)</div>
          <div class="value">${fmt(p.input_tokens)}</div><div class="sub">prompts + chat history + files</div></div>
        <div class="kpi out"><div class="label">Tokens AI generates (output)</div>
          <div class="value">${fmt(p.output_tokens)}</div><div class="sub">model replies</div></div>
        <div class="kpi cost"><div class="label">Cost today (${esc(r.inputs.model_tier)} model)</div>
          <div class="value">₹${p.cost.inr.toFixed(2)}</div><div class="sub">$${p.cost.usd.toFixed(3)}</div></div>
        <div class="kpi"><div class="label">Monthly requirement</div>
          <div class="value">${short(r.monthly.total_tokens)}</div>
          <div class="sub">${short(r.monthly.input_tokens)} in · ${short(r.monthly.output_tokens)} out</div></div>
      </div>
    </div>

    <div class="grid-auto">
      <div class="card">
        <h3>Your user type (K-Means)</h3>
        <p><span class="badge">${esc(r.cluster.name)}</span></p>
        <p class="muted">${r.cluster.users} users in the training data share this pattern. Their average is
          ${fmt(r.cluster.avg_daily_tokens)} tokens/day with weekend usage at ${(r.cluster.weekend_ratio * 100).toFixed(0)}%
          of weekdays. Most common professions: ${esc(Object.keys(r.cluster.top_professions).join(", "))}.</p>
      </div>
      <div class="card">
        <h3>Monthly cost by model tier</h3>
        <table class="table"><thead><tr><th>Tier</th><th>USD</th><th>INR</th></tr></thead><tbody>${tierRows}</tbody></table>
        <p class="muted">Assumes 3 normal weeks + 1 deadline week per month.</p>
      </div>
    </div>

    <div class="card">
      <h3>7-day forecast</h3>
      <div class="week">
        ${r.weekly.map(d => {
          const h = (a, b) => `${(a + b) / weekMax * 100}%`;
          return `<div class="day">
            <div class="bars">
              <div class="stack" style="height:${h(d.input, d.output)}" title="Normal: ${fmt(d.input + d.output)}">
                <div class="i" style="flex:${d.input}"></div><div class="o" style="flex:${d.output}"></div></div>
              <div class="stack deadline" style="height:${h(d.deadline_input, d.deadline_output)}" title="Deadline: ${fmt(d.deadline_input + d.deadline_output)}">
                <div class="i" style="flex:${d.deadline_input}"></div><div class="o" style="flex:${d.deadline_output}"></div></div>
            </div><span>${d.day}</span></div>`;
        }).join("")}
      </div>
      <div class="legend">
        <span><i style="background:var(--accent)"></i>Input (normal week)</span>
        <span><i style="background:var(--accent-2)"></i>Output (normal week)</span>
        <span><i style="background:#4338ca"></i>Input (deadline week)</span>
        <span><i style="background:#b45309"></i>Output (deadline week)</span>
      </div>
      <p class="muted">Deadline-week bars assume ${((r.deadline_uplift - 1) * 100).toFixed(0)}% more chat sessions,
        the increase seen for ${esc(r.inputs.profession)}s in the training data.</p>
    </div>`;
}

// ---------- Insights ----------
async function loadInsights() {
  const ins = await api("/api/insights");
  const rf = ins.random_forest;
  const impMax = Math.max(...Object.values(rf.feature_importance));
  const figs = [
    ["profession_tokens.png", "Average daily input/output tokens by profession (training data)"],
    ["actual_vs_predicted.png", "Random Forest: actual vs predicted on the 20% test set"],
    ["feature_importance.png", "Random Forest: feature importance"],
    ["kmeans_elbow.png", "K-Means: choosing k with elbow and silhouette"],
    ["kmeans_clusters.png", "K-Means: user clusters projected with PCA"],
  ];

  $("#insights-body").innerHTML = `
    <div class="grid-auto">
      <div class="card">
        <h3>Random Forest regression · test set results</h3>
        <table class="table">
          <thead><tr><th>Target</th><th>MAE</th><th>RMSE</th><th>R²</th></tr></thead>
          <tbody>${Object.entries(rf.metrics).map(([t, m]) => `<tr class="${t === "overall" ? "best" : ""}">
            <td>${esc(t)}</td><td>${fmt(m.mae)}</td><td>${fmt(m.rmse)}</td><td>${m.r2.toFixed(3)}</td></tr>`).join("")}</tbody>
        </table>
        <p class="muted">${rf.n_estimators} trees. Trained on ${fmt(ins.dataset.train_rows)} rows,
          tested on ${fmt(ins.dataset.test_rows)} unseen rows (80/20 split).</p>
      </div>
      <div class="card">
        <h3>Random Forest · feature importance</h3>
        ${Object.entries(rf.feature_importance).map(([f, v]) => `
          <div class="imp-row"><div>${esc(META.feature_labels[f] || f)}</div>
          <div><div class="imp-bar" style="width:${v / impMax * 100}%"></div></div><div>${(v * 100).toFixed(1)}%</div></div>`).join("")}
      </div>
    </div>

    <h2 class="section-title">K-Means user types (k = ${ins.kmeans.k}, silhouette ${ins.kmeans.silhouette})</h2>
    <div class="grid-auto">
      ${ins.kmeans.clusters.map(k => `<div class="cluster-card">
        <h4>${esc(k.name)}</h4>
        <div class="muted">${k.users} users · ${fmt(k.avg_daily_tokens)} tokens/day · output share ${(k.output_share * 100).toFixed(0)}% ·
          weekend ${(k.weekend_ratio * 100).toFixed(0)}% of weekday · burstiness ${k.burstiness}</div>
        <div class="muted">Top professions: ${esc(Object.entries(k.top_professions).map(([p, n]) => `${p} (${n})`).join(", "))}</div>
      </div>`).join("")}
    </div>

    <h2 class="section-title">Training figures</h2>
    <div class="figs">${figs.map(([f, cap]) => `<figure style="margin:0"><img src="/static/figures/${f}?v=${Date.now()}" alt="${esc(cap)}">
      <figcaption>${esc(cap)}</figcaption></figure>`).join("")}</div>`;
}

// ---------- Data ----------
async function loadData() {
  const d = await api("/api/dataset?limit=25");
  const cols = d.daily_columns;
  const stats = d.daily_stats;
  $("#data-body").innerHTML = `
    <div class="card">
      <h3>token_usage_daily.csv · ${fmt(d.daily_count)} rows (300 users × 30 days), random sample of 25</h3>
      <p class="muted">Used by Random Forest and K-Means. Targets: <b>input_tokens</b> and <b>output_tokens</b>.</p>
      <div class="scroll"><table class="table">
        <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${d.daily_rows.map(r => `<tr>${cols.map(c => `<td>${esc(typeof r[c] === "number" && r[c] > 999 ? fmt(r[c]) : r[c])}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
    </div>
    <div class="card" style="margin-top:20px">
      <h3>Target statistics</h3>
      <table class="table"><thead><tr><th></th>${Object.keys(stats).map(k => `<th>${esc(k)}</th>`).join("")}</tr></thead>
        <tbody>${Object.keys(stats.input_tokens).map(s => `<tr><td>${esc(s)}</td>${Object.keys(stats).map(k => `<td>${fmt(stats[k][s])}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`;
}

init().catch(err => toast(err.message, true));
