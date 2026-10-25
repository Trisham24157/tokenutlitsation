// Builds Experiment_10_Mini_Project_TokenSense.docx from the project's real metrics, code, data and screenshots.
// Run: node report_build/build_report.js
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType,
  WidthType, ShadingType, BorderStyle, PageBreak, PageOrientation, Footer, PageNumber, LevelFormat,
} = require("docx");

const ROOT = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const ins = JSON.parse(read("models/insights.json"));
const rf = ins.random_forest;
const km = ins.kmeans;
const fmt = n => Math.round(n).toLocaleString("en-IN");

const FONT = "Times New Roman";
const MONO = "Courier New";
const A4 = { width: 11906, height: 16838 };
const MARGIN = 1134; // 0.79"
const TEXT_W = A4.width - 2 * MARGIN; // portrait text width (DXA)
const LAND_W = A4.height - 2 * MARGIN; // landscape text width (DXA)

// ---------- helpers ----------
function runs(text, opts = {}) {
  // **bold** segments inside a string
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(s =>
    s.startsWith("**") ? new TextRun({ text: s.slice(2, -2), bold: true, ...opts }) : new TextRun({ text: s, ...opts }));
}
const P = (text, opts = {}) => new Paragraph({ children: runs(text), spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED, ...opts });
const H1 = text => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
const H2 = text => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
const bullet = text => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: runs(text), spacing: { after: 60 } });
const numbered = text => new Paragraph({ numbering: { reference: "steps", level: 0 }, children: runs(text), spacing: { after: 60 } });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function image(rel, caption, maxWidthPx = 620, maxHeightPx = 820) {
  const file = path.join(ROOT, rel);
  const { w, h } = pngSize(file);
  let width = maxWidthPx, height = Math.round(h * maxWidthPx / w);
  if (height > maxHeightPx) { height = maxHeightPx; width = Math.round(w * maxHeightPx / h); }
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 },
      children: [new ImageRun({ type: "png", data: fs.readFileSync(file), transformation: { width, height },
        altText: { title: caption, description: caption, name: path.basename(rel) } })],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
      children: [new TextRun({ text: caption, italics: true, size: 20 })] }),
  ];
}

const border = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const borders = { top: border, bottom: border, left: border, right: border };
function table(header, rows, totalWidth, { fontSize = 20, widths } = {}) {
  const n = header.length;
  const colW = widths || Array(n).fill(Math.floor(totalWidth / n));
  const cell = (text, i, isHead) => new TableCell({
    borders, width: { size: colW[i], type: WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    shading: isHead ? { fill: "D9D9D9", type: ShadingType.CLEAR, color: "auto" } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: isHead, size: fontSize, font: FONT })] })],
  });
  return new Table({
    width: { size: colW.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: colW,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, i, true)) }),
      ...rows.map(r => new TableRow({ children: r.map((c, i) => cell(c, i, false)) })),
    ],
  });
}
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

function code(title, text) {
  const lines = text.replace(/\s+$/, "").split("\n");
  return [
    new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: title, bold: true })] }),
    ...lines.map((line, i) => new Paragraph({
      spacing: { after: 0, line: 240 },
      shading: { fill: "F2F2F2", type: ShadingType.CLEAR, color: "auto" },
      border: {
        left: { style: BorderStyle.SINGLE, size: 6, color: "808080", space: 4 },
        ...(i === 0 ? { top: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF", space: 2 } } : {}),
        ...(i === lines.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF", space: 2 } } : {}),
      },
      children: [new TextRun({ text: line || " ", font: MONO, size: 15 })],
    })),
  ];
}
// Pull a top-level function (and its decorator) out of a Python file
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
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end + 2);
}

// ---------- training data sample ----------
const csv = read("data/token_usage_daily.csv").trim().split("\n");
const cols = csv[0].split(",");
const sampleRows = [];
for (let i = 1; i < csv.length && sampleRows.length < 18; i += 500) sampleRows.push(csv[i].split(","));
const dataCols = ["user_id", "profession", "experience_years", "model_tier", "uses_agents", "day_of_week",
  "deadline_week", "sessions_per_day", "turns_per_session", "avg_prompt_words", "docs_uploaded", "code_task",
  "input_tokens", "output_tokens", "total_tokens"];
const shortHead = ["User", "Profession", "Exp (yrs)", "Model tier", "Agents", "Day", "Deadline wk", "Sessions",
  "Msgs / session", "Prompt words", "Docs", "Code task", "Input tokens", "Output tokens", "Total tokens"];
const idx = dataCols.map(c => cols.indexOf(c));
const dataRows = sampleRows.map(r => idx.map((j, k) => (k >= 12 ? fmt(+r[j]) : r[j])));
const dataWidths = [620, 1700, 720, 800, 700, 620, 860, 860, 900, 900, 620, 760, 1130, 1130, 1130];
const scale = LAND_W / dataWidths.reduce((a, b) => a + b, 0);
const dataW = dataWidths.map(w => Math.floor(w * scale));

const daily = csv.slice(1).map(l => l.split(","));
const profIdx = cols.indexOf("profession"), inIdx = cols.indexOf("input_tokens"), outIdx = cols.indexOf("output_tokens");
const byProf = {};
for (const r of daily) {
  const p = (byProf[r[profIdx]] ||= { n: 0, i: 0, o: 0 });
  p.n++; p.i += +r[inIdx]; p.o += +r[outIdx];
}
const profRows = Object.entries(byProf).sort((a, b) => b[1].i - a[1].i)
  .map(([p, s]) => [p, fmt(s.n), fmt(s.i / s.n), fmt(s.o / s.n), fmt((s.i + s.o) / s.n)]);

// ---------- content ----------
const metricRows = Object.entries(rf.metrics).map(([t, m]) => [t, fmt(m.mae), fmt(m.rmse), m.r2.toFixed(3)]);
const clusterRows = [...km.clusters].sort((a, b) => a.avg_daily_tokens - b.avg_daily_tokens)
  .map(c => [c.name, c.users, fmt(c.avg_daily_tokens), Object.keys(c.top_professions).join(", ")]);
const LABELS = { sessions_per_day: "chat sessions per day", turns_per_session: "messages per session",
  uses_agents: "use of AI agents", avg_prompt_words: "prompt length" };
const topImp = Object.entries(rf.feature_importance).slice(0, 4)
  .map(([f, v]) => `${LABELS[f] || f.replaceAll("_", " ")} (${(v * 100).toFixed(0)}%)`).join(", ");

const titleBlock = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
    children: [new TextRun({ text: "Experiment 10 – Mini Project", bold: true, size: 36 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: "TokenSense: AI Token Utilization Prediction by Profession", bold: true, size: 28 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "Algorithms used: Random Forest Regression (Module 3) and K-Means Clustering (Module 4)", italics: true, size: 22 })] }),
  table(["Name", "Roll No.", "Class / Division", "Date"], [["", "", "TE-B", ""]], TEXT_W, { fontSize: 22 }),
  new Paragraph({ spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 4 } }, children: [] }),
];

const writeUp = [
  H1("1. Aim"),
  P("To build a web application that predicts how many AI tokens a person will need per day and per month, split into **input tokens** (what the person feeds to the AI) and **output tokens** (what the AI generates), based on their profession and usage habits, and to group users into usage types."),

  H1("2. Problem Statement"),
  P("AI assistants such as ChatGPT, Claude, Gemini and GitHub Copilot are now part of daily work for developers, students, writers, teachers, doctors and lawyers. Every one of these services measures and bills usage in **tokens** (about 0.75 words per token). Users cannot easily answer simple questions such as “How many tokens will I use this month?” or “Which model tier can I afford?”. Token usage depends on the profession (a developer pastes code and error logs, a content writer asks for long replies), on habits (number of chats, messages per chat, prompt length, uploaded files, AI agents) and on the calendar (weekends, deadline or exam weeks). TokenSense learns these patterns from data and gives each person a personal token budget and cost estimate."),

  H1("3. Dataset"),
  P(`Real per-user token logs are private, so a realistic **synthetic dataset** was generated in Python (src/generate_data.py, random seed 42). The rules follow how large language model billing actually works: every new message re-sends the whole conversation, so input tokens grow roughly with the square of the messages per session; each uploaded document adds about 2,500 tokens; AI agents multiply the context about 2.5 times; weekends, Fridays and deadline weeks change the number of sessions; and ±12% random noise is added to every value.`),
  bullet(`**File:** token_usage_daily.csv with **${fmt(ins.dataset.rows)} rows** (${ins.dataset.users} users × 30 days) covering 12 professions.`),
  bullet("**Input features (11):** profession, day of week, model tier, experience in years, deadline/exam week, uses AI agents, chat sessions per day, messages per session, average prompt length in words, documents uploaded, coding task."),
  bullet("**Targets (2):** input_tokens and output_tokens per day."),
  bullet(`**Split:** ${fmt(ins.dataset.train_rows)} rows for training and ${fmt(ins.dataset.test_rows)} unseen rows for testing (80/20).`),

  H1("4. Algorithms Used"),
  H2("4.1 Random Forest Regression (Module 3)"),
  P("A Random Forest is an ensemble of many decision trees. Each tree is trained on a bootstrap sample (rows drawn at random with replacement), and at every split it considers only a random subset of the features. A regression tree keeps splitting the data so that the squared error inside each branch becomes as small as possible, and it predicts the average target value of the rows in a leaf. The forest predicts the **average of all its trees**. Averaging many different trees removes most of the overfitting of a single tree while keeping its ability to learn non-linear relationships."),
  P(`This is important for token prediction because usage is strongly non-linear: doubling the messages in one chat roughly quadruples the input tokens, and switching on AI agents multiplies everything. In this project one multi-output forest with **${rf.n_estimators} trees** predicts both input and output tokens. Categorical features (profession, day, model tier) are one-hot encoded with a ColumnTransformer inside a scikit-learn Pipeline, so exactly the same preprocessing runs during training and inside the web application. On the unseen test rows the model reached **R² = ${rf.metrics.overall.r2.toFixed(3)}**. Feature importance shows that the biggest drivers of token usage are ${topImp}.`),
  table(["Target", "MAE (tokens)", "RMSE (tokens)", "R²"], metricRows, TEXT_W),
  gap(),

  H2("4.2 K-Means Clustering (Module 4)"),
  P("K-Means is an unsupervised learning algorithm that divides data into k groups (clusters) without any labels. It works in four steps:"),
  numbered("Choose k starting centroids."),
  numbered("Assign every point to its nearest centroid using Euclidean distance."),
  numbered("Move each centroid to the mean of the points assigned to it."),
  numbered("Repeat steps 2 and 3 until the assignments stop changing."),
  P(`Each of the ${ins.dataset.users} users is summarised by four features calculated from their 30 days of usage: log of average daily tokens, burstiness (standard deviation divided by mean), output share of tokens, and weekend-to-weekday usage ratio. The features are standardised first so that no feature dominates the distance. The number of clusters **k = ${km.k}** was chosen with the elbow method (inertia) and the silhouette score (${km.silhouette.toFixed(2)}). The clusters were named from their centroids:`),
  table(["User type", "Users", "Avg tokens / day", "Most common professions"], clusterRows, TEXT_W,
    { widths: [2700, 900, 1700, TEXT_W - 5300] }),
  gap(),
  P("**How the two algorithms work together:** when a new user submits the form, the Random Forest predicts their tokens for all seven days of a week. The same four profile features are calculated from that forecast, and the trained K-Means model assigns the user to one of the four types."),

  H1("5. System Design: Frontend, Backend and Their Connection"),
  H2("5.1 Frontend"),
  P("The frontend is a single-page web interface written in plain HTML, CSS and JavaScript (templates/index.html, static/style.css, static/app.js), without any framework. It has four tabs:"),
  bullet("**Predict:** a form for the user’s profile, then result cards for input tokens, output tokens, today’s cost and monthly requirement, the K-Means user type, the monthly cost on small, medium and large models, and a 7-day forecast chart for a normal week and a deadline week."),
  bullet("**Model Insights:** Random Forest test metrics and feature importance, the four K-Means clusters, and all training charts."),
  bullet("**Training Data:** a sample of the training CSV and summary statistics."),
  bullet("**About:** the algorithm table and the architecture diagram."),
  P("Choosing a profession automatically fills in that profession’s typical habits taken from the dataset, so a user can get a prediction with one click and then adjust the numbers."),
  H2("5.2 Backend"),
  P("The backend is a Python **Flask** server (app.py). When it starts, it loads the trained Random Forest pipeline and the K-Means model (saved with joblib by src/train.py) and exposes a small REST API that returns JSON:"),
  bullet("**POST /api/predict:** Random Forest prediction, 7-day and monthly forecast, cost in USD and INR, and the K-Means user type."),
  bullet("**GET /api/insights:** test metrics, feature importance and cluster details from training."),
  bullet("**GET /api/meta:** dropdown options and the default habits for each profession."),
  bullet("**GET /api/dataset:** a preview of the training data."),
  H2("5.3 Connection Between Frontend and Backend"),
  P("When the user clicks “Predict my token usage”, app.js reads the form and sends it to /api/predict as JSON using the browser’s fetch() function. Flask converts the JSON into a one-row pandas DataFrame and passes it through the same pipeline used in training (one-hot encoding, then the Random Forest). It then runs K-Means on the weekly forecast, calculates the cost, and sends everything back as one JSON response. JavaScript renders the response into cards, tables and charts without reloading the page. Model training (src/train.py) runs separately and only writes the model files that the server reads, so the machine learning code and the web code stay cleanly separated."),
  table(["Layer", "Technology", "Main files"], [
    ["Frontend", "HTML, CSS, JavaScript (fetch API)", "templates/index.html, static/app.js, static/style.css"],
    ["Backend", "Python, Flask REST API", "app.py"],
    ["Machine learning", "scikit-learn, pandas, NumPy", "src/train.py, src/profiles.py"],
    ["Saved models", "joblib, JSON", "models/rf_token_model.joblib, models/kmeans_users.joblib, models/insights.json"],
    ["Data", "CSV (synthetic)", "data/token_usage_daily.csv (generated by src/generate_data.py)"],
  ], TEXT_W, { widths: [1700, 3000, TEXT_W - 4700] }),
  gap(),

  H1("6. Result"),
  P(`TokenSense predicts daily input and output tokens with **R² = ${rf.metrics.overall.r2.toFixed(3)}** and an average error of ${fmt(rf.metrics.overall.mae)} tokens on unseen data. For example, a software developer with 8 chats a day on a medium-tier model is predicted to feed about 80,700 tokens to the AI and receive about 18,700 tokens back (about ₹44 per day, 2.79 million tokens per month), and is classified as a “Power User (Heavy Context)”.`),

  H1("7. Conclusion"),
  P("Random Forest regression learned the non-linear way AI token usage grows with chats, messages, prompt length and agents, and predicted it accurately for every profession. K-Means found four meaningful user types without any labels, which helps match each person to the right token budget or plan. Together they give a practical tool for planning AI usage and cost. **Future scope:** train on real exported usage logs, add time-series forecasting, and connect directly to AI providers’ usage APIs."),
];

const screenshots = [
  H1("8. Screenshots"),
  ...image("screenshots/01_predict.png", "Figure 1: Predict tab – Software Developer: input/output tokens, cost, user type and 7-day forecast"),
  ...image("screenshots/02_predict_student_exam_week.png", "Figure 2: Predict tab – Student in exam week"),
  ...image("screenshots/03_model_insights.png", "Figure 3: Model Insights tab – Random Forest metrics, feature importance and K-Means clusters", 620, 900),
  ...image("screenshots/04_training_data.png", "Figure 4: Training Data tab – dataset sample and statistics"),
  ...image("screenshots/05_about.png", "Figure 5: About tab – algorithms and architecture"),
  H1("9. Training Graphs"),
  ...image("static/figures/actual_vs_predicted.png", "Figure 6: Random Forest – actual vs predicted tokens on the test set"),
  ...image("static/figures/feature_importance.png", "Figure 7: Random Forest – feature importance", 480),
  ...image("static/figures/profession_tokens.png", "Figure 8: Average daily tokens by profession (training data)", 520),
  ...image("static/figures/kmeans_elbow.png", "Figure 9: K-Means – elbow method and silhouette score for choosing k", 430),
  ...image("static/figures/kmeans_clusters.png", "Figure 10: K-Means – user clusters (PCA projection)", 480),
];

const codeSection = [
  H1("10. Important Code"),
  ...code("10.1 Random Forest regression training (src/train.py)", pyFunction("src/train.py", "train_random_forest")),
  ...code("10.2 K-Means clustering (src/train.py)",
    pyFunction("src/train.py", "train_kmeans").split("    summary = []")[0].trimEnd() + "\n    ..."),
  ...code("10.3 Backend prediction API (app.py)", pyFunction("app.py", "predict")),
  ...code("10.4 Frontend call to the backend (static/app.js)", jsFunction("static/app.js", "onPredict")),
];

const dataSection = [
  H1("11. Training Data"),
  P(`Sample of ${dataRows.length} rows (every 500th row) from data/token_usage_daily.csv, which has ${fmt(ins.dataset.rows)} rows in total. The last three columns are the values the model learns to predict.`),
  table(shortHead, dataRows, LAND_W, { fontSize: 15, widths: dataW }),
  gap(),
  P("Average daily usage per profession in the full training data:"),
  table(["Profession", "Rows", "Avg input tokens", "Avg output tokens", "Avg total tokens"], profRows, LAND_W, { fontSize: 18 }),
];

// ---------- document ----------
const footer = new Footer({
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
    new TextRun({ text: "Experiment 10 – Mini Project  |  Page ", size: 18 }),
    new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
  ] })],
});
const portrait = { page: { size: A4, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } };
const landscape = { page: { size: { ...A4, orientation: PageOrientation.LANDSCAPE }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } };

const doc = new Document({
  creator: "TE-B",
  title: "Experiment 10 – Mini Project: TokenSense",
  styles: {
    default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { line: 264 } } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: FONT }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 25, bold: true, font: FONT }, paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [
    { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    { reference: "steps", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
  ] },
  sections: [
    { properties: portrait, footers: { default: footer }, children: [...titleBlock, ...writeUp, pageBreak(), ...screenshots, pageBreak(), ...codeSection] },
    { properties: landscape, footers: { default: footer }, children: dataSection },
  ],
});

const out = path.join(ROOT, "Experiment_10_Mini_Project_TokenSense.docx");
Packer.toBuffer(doc).then(buf => { fs.writeFileSync(out, buf); console.log("Wrote", out); });
