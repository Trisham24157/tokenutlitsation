// Builds the Experiment 10 report in the same layout as the class reference document
// (underlined title, highlighted pipeline line, arrow bullets, "Section -" headings with screenshots).
// Run: NODE_PATH=report_build/node_modules node report_build/build_reference_style.js
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, Table, TableRow, TableCell, AlignmentType,
  WidthType, ShadingType, BorderStyle, PageBreak, LevelFormat, Footer, PageNumber,
} = require("docx");

// ---- student details (edit these) ----
const STUDENT_NAME = process.env.STUDENT_NAME || "Your Full Name";
const CLASS_ROLL = process.env.CLASS_ROLL || "TE IT B - Roll No.";
const LAB = "Machine Learning Lab";
const REPO_URL = "https://github.com/jerry5379/tokensense";

const ROOT = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const ins = JSON.parse(read("models/insights.json"));
const rf = ins.random_forest;
const km = ins.kmeans;
const fmt = n => Math.round(n).toLocaleString("en-IN");

const FONT = "Arial";
const MONO = "Courier New";
const A4 = { width: 11906, height: 16838 };
const MARGIN = 1440;
const TEXT_W = A4.width - 2 * MARGIN;

// ---------- helpers ----------
function runs(text, opts = {}) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(s =>
    s.startsWith("**") ? new TextRun({ text: s.slice(2, -2), bold: true, ...opts }) : new TextRun({ text: s, ...opts }));
}
const P = text => new Paragraph({ children: runs(text), spacing: { after: 160 } });
const section = text => new Paragraph({ spacing: { before: 280, after: 140 }, keepNext: true,
  children: [new TextRun({ text: `${text} -`, bold: true, size: 30 })] });
const sub = text => new Paragraph({ spacing: { before: 160, after: 80 }, keepNext: true,
  children: [new TextRun({ text, bold: true, size: 26 })] });
const dot = text => new Paragraph({ numbering: { reference: "dots", level: 0 }, children: runs(text), spacing: { after: 60 } });
const arrow = text => new Paragraph({ numbering: { reference: "arrows", level: 0 }, children: [new TextRun(text)], spacing: { after: 40 } });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });
const gap = () => new Paragraph({ spacing: { after: 80 }, children: [] });

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function image(rel, maxW = 600, maxH = 760) {
  const file = path.join(ROOT, rel);
  const { w, h } = pngSize(file);
  let width = maxW, height = Math.round(h * maxW / w);
  if (height > maxH) { height = maxH; width = Math.round(w * maxH / h); }
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 80, after: 200 },
    children: [new ImageRun({ type: "png", data: fs.readFileSync(file), transformation: { width, height },
      altText: { title: path.basename(rel), description: path.basename(rel), name: path.basename(rel) } })],
  });
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
function table(header, rows, widths, fontSize = 18) {
  const cell = (text, i, head) => new TableCell({
    borders, width: { size: widths[i], type: WidthType.DXA },
    margins: { top: 30, bottom: 30, left: 60, right: 60 },
    shading: head ? { fill: "D9EAF7", type: ShadingType.CLEAR, color: "auto" } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: head, size: fontSize })] })],
  });
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, i, true)) }),
      ...rows.map(r => new TableRow({ children: r.map((c, i) => cell(c, i, false)) }))],
  });
}

// Terminal-style block (dark background) and code block (light background)
function block(text, { dark = false, size = 15 } = {}) {
  const lines = text.replace(/\s+$/, "").split("\n");
  const fill = dark ? "1E1E1E" : "F2F2F2";
  const color = dark ? "E6E6E6" : "000000";
  return lines.map((line, i) => new Paragraph({
    spacing: { after: 0, line: 240 },
    keepNext: dark && i < lines.length - 1,
    shading: { fill, type: ShadingType.CLEAR, color: "auto" },
    border: {
      left: { style: BorderStyle.SINGLE, size: 6, color: dark ? "1E1E1E" : "808080", space: 4 },
      right: { style: BorderStyle.SINGLE, size: 6, color: fill, space: 4 },
      ...(i === 0 ? { top: { style: BorderStyle.SINGLE, size: 6, color: fill, space: 2 } } : {}),
      ...(i === lines.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: fill, space: 2 } } : {}),
    },
    children: [new TextRun({ text: line || " ", font: MONO, size, color,
      bold: dark && line.startsWith("$") })],
  }));
}
function pyFunction(file, name) {
  const src = read(file).split("\n");
  let start = src.findIndex(l => l.startsWith(`def ${name}(`));
  let end = start + 1;
  if (start > 0 && src[start - 1].startsWith("@")) start--;
  while (end < src.length && !(src[end].length && !/^\s/.test(src[end]) && !src[end].startsWith(")"))) end++;
  return src.slice(start, end).join("\n").replace(/\n+$/, "");
}
function jsFunction(file, name) {
  const src = read(file);
  const start = src.indexOf(`async function ${name}(`);
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
}

// ---------- data ----------
const csv = read("data/token_usage_daily.csv").trim().split("\n");
const cols = csv[0].split(",");
const pick = ["user_id", "profession", "day_of_week", "deadline_week", "uses_agents", "sessions_per_day",
  "turns_per_session", "avg_prompt_words", "docs_uploaded", "input_tokens", "output_tokens"];
const pickHead = ["User", "Profession", "Day", "Deadline", "Agents", "Sessions", "Msgs/ session", "Prompt words",
  "Docs", "Input tokens", "Output tokens"];
const pickW = [620, 1700, 560, 760, 680, 760, 760, 760, 560, 830, 836];
const sample = [];
for (let i = 1; i < csv.length && sample.length < 15; i += 600) sample.push(csv[i].split(","));
const sampleRows = sample.map(r => pick.map(c => {
  const v = r[cols.indexOf(c)];
  return c.endsWith("_tokens") ? fmt(+v) : v;
}));

const metricRows = Object.entries(rf.metrics).map(([t, m]) => [t, fmt(m.mae), fmt(m.rmse), m.r2.toFixed(3)]);
const clusterRows = [...km.clusters].sort((a, b) => a.avg_daily_tokens - b.avg_daily_tokens)
  .map(c => [c.name, String(c.users), fmt(c.avg_daily_tokens), Object.keys(c.top_professions).join(", ")]);

// ---------- content ----------
const header = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "EXPERIMENT 10 - MINI PROJECT", bold: true, underline: {}, size: 40 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
    shading: { fill: "C9F1F5", type: ShadingType.CLEAR, color: "auto" },
    children: [new TextRun({ text: "Dataset→Random Forest→K-Means→Flask→Web App", bold: true, size: 30,
      font: "Cambria", color: "1F3864" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "TokenSense – AI Token Utilization Predictor", bold: true, size: 26 })] }),
  arrow(STUDENT_NAME),
  arrow(CLASS_ROLL),
  arrow(LAB),
  gap(),
  P("**TokenSense** is a machine learning web application that predicts how many **AI tokens** a person will use per day and per month, based on their **profession** and AI usage habits. It predicts two values: **input tokens**, which the user feeds to the AI (prompts, chat history and uploaded files), and **output tokens**, which the AI generates as replies. It also estimates the **cost** on small, medium and large AI models and tells the user what **type of AI user** they are."),
  P("A **Random Forest Regression** model (Module 3) predicts the daily input and output tokens, and **K-Means Clustering** (Module 4) groups users into four usage types. A **Flask** backend serves the trained models through a REST API, and an **HTML, CSS and JavaScript** frontend lets the user enter their profile and see the prediction, cost, user type and a 7-day forecast."),
  new Paragraph({ spacing: { before: 200, after: 200 }, children: [
    new TextRun({ text: "GitHub Repo URL - ", bold: true, size: 26 }),
    new ExternalHyperlink({ link: REPO_URL, children: [new TextRun({ text: REPO_URL, style: "Hyperlink", size: 26 })] }),
  ] }),
  image("screenshots/01_predict.png", 600, 330),
];

const writeUp = [
  section("Aim"),
  P("To build a web application that predicts the AI token requirement of a person according to their profession and usage habits, split into input tokens and output tokens, estimates the cost, and groups users into usage types using machine learning."),

  section("Problem Statement"),
  P("AI assistants such as ChatGPT, Claude, Gemini and GitHub Copilot are now used every day by developers, students, writers, teachers, doctors and lawyers, and all of them bill usage in **tokens** (about 0.75 words per token). People cannot easily tell how many tokens they will need in a month or which model tier they can afford. Usage depends on the **profession** (a developer pastes code and logs, a content writer asks for long replies), on **habits** (chats per day, messages per chat, prompt length, uploaded files, AI agents) and on the **calendar** (weekends and deadline or exam weeks). TokenSense learns these patterns from data and gives each person a personal token budget."),

  section("Training Dataset"),
  P(`Real per-user token logs are private, so a realistic **synthetic dataset** was generated in Python (src/generate_data.py, random seed 42) using the rules of LLM billing: every new message re-sends the whole conversation, so input tokens grow roughly with the square of the messages per session; each uploaded document adds about 2,500 tokens; AI agents multiply the context about 2.5 times; and ±12% random noise is added.`),
  dot(`**File:** data/token_usage_daily.csv, **${fmt(ins.dataset.rows)} rows** (${ins.dataset.users} users × 30 days), 12 professions.`),
  dot("**Features (11):** profession, day of week, model tier, experience, deadline/exam week, uses AI agents, chat sessions per day, messages per session, prompt length (words), documents uploaded, coding task."),
  dot("**Targets (2):** input_tokens and output_tokens."),
  dot(`**Split:** ${fmt(ins.dataset.train_rows)} rows for training, ${fmt(ins.dataset.test_rows)} rows for testing (80/20).`),
  sub(`Sample of the training data (${sampleRows.length} of ${fmt(ins.dataset.rows)} rows):`),
  table(pickHead, sampleRows, pickW, 15),
  gap(),

  section("Algorithms Used"),
  sub("1. Random Forest Regression (Module 3)"),
  P("A Random Forest is an ensemble of many decision trees. Each tree is trained on a bootstrap sample of the rows and considers a random subset of features at each split, choosing the split that most reduces the squared error. The forest predicts the **average of all trees**, which reduces the overfitting of a single tree while still capturing non-linear patterns. This suits token usage, which is strongly non-linear: doubling the messages in a chat roughly quadruples the input tokens, and AI agents multiply everything."),
  P(`One multi-output forest with **${rf.n_estimators} trees** predicts both targets. Categorical features are one-hot encoded with a ColumnTransformer inside a scikit-learn Pipeline, so the same preprocessing is used in training and in the web app. On unseen test data it achieved **R² = ${rf.metrics.overall.r2.toFixed(3)}**:`),
  table(["Target", "MAE (tokens)", "RMSE (tokens)", "R²"], metricRows, [2826, 2100, 2100, 2000], 20),
  gap(),
  sub("2. K-Means Clustering (Module 4)"),
  P(`K-Means is an unsupervised algorithm that divides data into k groups. It picks k starting centroids, assigns every point to the nearest centroid (Euclidean distance), moves each centroid to the mean of its points, and repeats until nothing changes. Each user is described by four standardised features from their 30 days: log of average daily tokens, burstiness (std / mean), output share, and weekend-to-weekday ratio. **k = ${km.k}** was chosen with the elbow method and silhouette score (${km.silhouette.toFixed(2)}):`),
  table(["User type", "Users", "Avg tokens/day", "Most common professions"], clusterRows, [2600, 800, 1500, 4126], 18),
  gap(),
  P("**Working together:** for a new user, the Random Forest predicts all 7 days of the week, the same four features are calculated from that forecast, and K-Means assigns the user type."),

  section("Frontend"),
  P("A single-page web interface built with plain **HTML, CSS and JavaScript** (templates/index.html, static/style.css, static/app.js). The **Predict** tab has the input form and shows input tokens, output tokens, today’s cost, monthly requirement, the K-Means user type, monthly cost per model tier and a 7-day forecast chart. The **Model Insights**, **Training Data** and **About** tabs show model metrics, clusters, training charts, dataset sample and architecture. Choosing a profession auto-fills its typical habits, and a Light/Dark mode button is provided."),

  section("Backend"),
  P("A Python **Flask** server (app.py). On start-up it loads the trained Random Forest pipeline and K-Means model (saved with joblib by src/train.py) and exposes a REST API that returns JSON: **POST /api/predict** (prediction, weekly and monthly forecast, cost, user type), **GET /api/insights** (metrics and clusters), **GET /api/meta** (form options and defaults) and **GET /api/dataset** (data preview)."),

  section("Frontend–Backend Connection"),
  P("When the user clicks **Predict my token usage**, app.js reads the form and sends it as JSON to **/api/predict** using fetch(). Flask converts the JSON into a one-row pandas DataFrame, runs it through the same pipeline used in training (one-hot encoding, then Random Forest), runs K-Means on the weekly forecast, calculates the cost, and returns one JSON response. JavaScript renders it into cards, tables and charts without reloading the page. Training runs separately and only writes the model files the server reads, which keeps the ML code and the web code separate."),
  ...block(`Browser (HTML + CSS + JavaScript)
     |  fetch() -> JSON over HTTP
     v
Flask REST API (app.py)  -->  models/rf_token_model.joblib  (Random Forest)
                              models/kmeans_users.joblib    (K-Means + scaler)
                              models/insights.json          (metrics, clusters)`, { size: 17 }),
];

const steps = [
  section("Generating Data & Training the Model"),
  P("The dataset is generated and both models are trained from the terminal:"),
  ...block(read("report_build/train_log.txt"), { dark: true, size: 16 }),
  gap(),

  section("Model Results"),
  image("static/figures/actual_vs_predicted.png"),
  image("static/figures/feature_importance.png", 460),
  image("static/figures/profession_tokens.png", 500),
  image("static/figures/kmeans_elbow.png", 400),
  image("static/figures/kmeans_clusters.png", 440),

  section("Running the Web App"),
  ...block(`$ source .venv/bin/activate
$ python app.py
 * Serving Flask app 'app'
 * Running on http://127.0.0.1:5050
Press CTRL+C to quit`, { dark: true, size: 16 }),
  gap(),
  sub("Predict – Software Developer:"),
  image("screenshots/01_predict.png", 560, 400),
  sub("Predict – Student in exam week:"),
  image("screenshots/02_predict_student_exam_week.png", 560, 400),
  sub("Model Insights:"),
  image("screenshots/03_model_insights.png", 600, 820),
  sub("Training Data:"),
  image("screenshots/04_training_data.png", 560, 400),
  sub("About (algorithms and architecture):"),
  image("screenshots/05_about.png", 560, 400),

  section("Important Code"),
  sub("Random Forest training (src/train.py)"),
  ...block(pyFunction("src/train.py", "train_random_forest")),
  sub("K-Means clustering (src/train.py)"),
  ...block(pyFunction("src/train.py", "train_kmeans").split("    summary = []")[0].trimEnd() + "\n    ..."),
  sub("Backend prediction API (app.py)"),
  ...block(pyFunction("app.py", "predict")),
  sub("Frontend call to the backend (static/app.js)"),
  ...block(jsFunction("static/app.js", "onPredict")),

  section("Conclusion"),
  P(`TokenSense predicts the daily input and output AI tokens of a person with R² = ${rf.metrics.overall.r2.toFixed(3)} using Random Forest Regression, and groups users into four meaningful usage types with K-Means, without any labels. Combined with a Flask backend and a simple web frontend, it gives a practical tool for planning AI usage and cost for every profession. Future scope: train on real usage logs, add time-series forecasting, and connect directly to AI providers’ usage APIs.`),
];

const doc = new Document({
  creator: STUDENT_NAME,
  title: "Experiment 10 - Mini Project: TokenSense",
  styles: { default: { document: { run: { font: FONT, size: 24 }, paragraph: { spacing: { line: 276 } } } } },
  numbering: { config: [
    { reference: "arrows", levels: [{ level: 0, format: LevelFormat.BULLET, text: "➢", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    { reference: "dots", levels: [{ level: 0, format: LevelFormat.BULLET, text: "●", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } }, run: { size: 18 } } }] },
  ] },
  sections: [{
    properties: { page: { size: A4, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) },
    children: [...header, ...writeUp, ...steps],
  }],
});

const out = path.join(ROOT, process.env.OUT_NAME || "Experiment_10_Mini_Project.docx");
Packer.toBuffer(doc).then(buf => { fs.writeFileSync(out, buf); console.log("Wrote", out); });
