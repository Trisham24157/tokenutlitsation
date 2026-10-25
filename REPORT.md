# Experiment 10 – Mini Project

## TokenSense: AI Token Utilization Prediction by Profession

**Class:** TE-B  **Subject:** Machine Learning Lab
**Algorithms used:** Random Forest Regression (M3), K-Means Clustering (M4)

---

### 1. Aim

To build a web application that predicts how many AI tokens a person will need per day and per month,
split into **input tokens** (what they feed to the AI) and **output tokens** (what the AI generates),
based on their profession and usage habits, and to group users into usage types.

### 2. Problem statement

AI assistants such as ChatGPT, Claude, Gemini and Copilot are now part of daily work for developers,
students, writers, teachers, lawyers and many others. All of these services measure usage in tokens
(about 0.75 words per token). Users cannot easily answer simple questions: *How many tokens will I use
this month? Which model tier can I afford?* Usage depends on the profession (a developer pastes code and
logs, a content writer asks for long replies), on habits (number of chats, messages per chat, prompt length,
uploaded files, AI agents), and on the calendar (weekends, deadline or exam weeks). TokenSense learns these
patterns from data and gives a personal token budget.

### 3. Dataset

Real per-user token logs are private, so a realistic **synthetic dataset** was generated with Python
(`src/generate_data.py`, random seed 42). The rules follow how LLM billing works: each new message re-sends
the whole conversation, so input tokens grow with roughly (messages per session)²; each uploaded document adds
about 2,500 tokens; agent mode multiplies context about 2.5×; and ±12% random noise is added.

**token_usage_daily.csv:** 9,000 rows (300 users × 30 days), 12 professions.

- **Features (11):** profession, day of week, model tier, experience, deadline week, uses agents, sessions per day, messages per session, prompt length in words, documents uploaded, coding task.
- **Targets (2):** input_tokens and output_tokens.

Sample of the training data:

| user_id | profession | exp | tier | agents | day | deadline | sessions | msgs | words | docs | code | input_tokens | output_tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| U001 | Software Developer | 3 | medium | 0 | Sat | 0 | 4 | 6 | 268 | 0 | 1 | 60,996 | 10,805 |
| U001 | Software Developer | 3 | medium | 0 | Mon | 0 | 4 | 6 | 208 | 4 | 1 | 60,726 | 8,931 |
| U001 | Software Developer | 3 | medium | 0 | Tue | 0 | 4 | 7 | 281 | 4 | 1 | 85,614 | 14,919 |

### 4. Algorithms used

**4.1 Random Forest Regression (M3).** A Random Forest is an ensemble of many decision trees. Each tree is
trained on a bootstrap sample (random rows drawn with replacement), and at every split it looks at a random
subset of features. A single regression tree splits the data to reduce the squared error and predicts the
average of the rows in a leaf. The forest predicts the **average of all trees**, which lowers the variance
(overfitting) of a single tree while keeping its ability to learn non-linear patterns. This matters here
because token usage is strongly non-linear: doubling the messages in a chat roughly quadruples the input
tokens, and AI agents multiply everything.

In this project, one multi-output forest with 200 trees predicts both input and output tokens. Categorical
features (profession, day, tier) are one-hot encoded with a `ColumnTransformer` inside a scikit-learn
`Pipeline`, so the same preprocessing runs during training and in the web app. The data was split 80/20, and
the 1,800 unseen test rows gave:

| Target | MAE (tokens) | RMSE | R² |
|---|---|---|---|
| input_tokens | 11,298 | 26,145 | 0.924 |
| output_tokens | 2,116 | 3,557 | 0.906 |
| overall | 6,707 | 14,851 | **0.915** |

The forest's feature importance shows that chat sessions per day (35%), messages per session (25%),
use of AI agents (18%) and prompt length (17%) drive token usage the most.

**4.2 K-Means Clustering (M4).** K-Means is an unsupervised algorithm that splits data into k groups:

1. Choose k starting centroids.
2. Assign every point to its nearest centroid (Euclidean distance).
3. Move each centroid to the mean of its points.
4. Repeat steps 2 and 3 until the assignments stop changing.

Each of the 300 users is summarised by 4 features computed from their 30 days: log of average daily tokens,
burstiness (standard deviation / mean), output share, and weekend-to-weekday ratio. The features are
standardised first. k = 4 was chosen using the elbow curve (inertia) and the silhouette score (0.25).
The clusters were named from their centroids:

| User type | Users | Avg tokens/day | Typical professions |
|---|---|---|---|
| Light / Irregular User | 53 | 36,912 | Digital Marketer, Designer, Business Analyst |
| Steady 9-to-5 Professional | 98 | 44,607 | Customer Support, Doctor, Teacher |
| Anytime Learner / Creator | 57 | 88,156 | Student, Researcher, Content Writer |
| Power User (Heavy Context) | 92 | 153,347 | Data Scientist, Software Developer, Lawyer |

**How the two algorithms work together:** in the app, the Random Forest first predicts the new user's usage
for all 7 days of a week. The same 4 profile features are calculated from that forecast, and the trained
K-Means model assigns the user's type.

### 5. System design: frontend, backend and their connection

```
 Browser: HTML + CSS + JavaScript (templates/index.html, static/app.js)
        │  fetch() sends JSON over HTTP
        ▼
 Flask REST API (app.py) ── loads ──► rf_token_model.joblib (Random Forest pipeline)
                                      kmeans_users.joblib  (K-Means + scaler)
                                      insights.json        (test metrics, clusters)
```

**Frontend.** A single-page web interface written in plain HTML, CSS and JavaScript, with no framework. It has
four tabs:

- **Predict:** the input form, result cards (input tokens, output tokens, today's cost, monthly requirement), the user type, monthly cost on each model tier, and a 7-day forecast chart for a normal week and a deadline week.
- **Model Insights:** Random Forest metrics and feature importance, the clusters, and the training charts.
- **Training Data:** a sample of the CSV file and statistics.
- **About:** the algorithm table and architecture diagram.

Choosing a profession auto-fills that profession's typical habits from the dataset.

**Backend.** A Python Flask server. When it starts, it loads the trained models saved with `joblib`.
It exposes JSON endpoints:

- `POST /api/predict`: Random Forest prediction, 7-day and monthly forecast, cost, and K-Means user type.
- `GET /api/insights`: training metrics and clusters.
- `GET /api/meta`: dropdown options and default habits.
- `GET /api/dataset`: data preview.

**Connection.** When the user clicks *Predict*, `app.js` reads the form and sends it to `/api/predict` as JSON
using `fetch()`. Flask turns the JSON into a one-row pandas DataFrame and passes it through the same pipeline
used in training (one-hot encoding, then the Random Forest). It then runs K-Means on the weekly forecast,
calculates cost, and returns one JSON response, which JavaScript renders into cards and charts without
reloading the page. Training (`src/train.py`) runs separately and writes the model files that the server
reads, so the ML code and the web code are cleanly separated.

### 6. Result

TokenSense predicts daily input and output tokens with R² = 0.915 on unseen data. For example, a student
using a small model with 7 chats a day in exam week gets about 39,500 input and 9,200 output tokens
(about ₹1 per day), about 1.46 million tokens a month, and is classified as an "Anytime Learner / Creator".

### 7. Conclusion

Random Forest regression learned the non-linear way AI token usage grows with chats, messages, prompt length
and agents, and predicted it accurately. K-Means found four meaningful user types without any labels, which
helps match users to the right token budget or plan. **Future scope:** train on real exported usage logs, add
time-series forecasting, and connect directly to AI providers' usage APIs.

---

## Important code

**Random Forest regression (`src/train.py`)**

```python
X, y = df[FEATURES], df[TARGETS]                 # TARGETS = [input_tokens, output_tokens]
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

pipe = Pipeline([
    ("prep", ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL),
        ("num", "passthrough", NUMERIC),
    ])),
    ("model", RandomForestRegressor(n_estimators=200, min_samples_leaf=2, random_state=42, n_jobs=-1)),
])
pipe.fit(X_train, y_train)
pred = pipe.predict(X_test)
print("MAE", mean_absolute_error(y_test, pred), "R2", r2_score(y_test, pred))
```

**K-Means user types (`src/train.py`)**

```python
Z = StandardScaler().fit_transform(profiles[PROFILE_FEATURES])
for k in range(2, 9):                                   # elbow + silhouette to choose k
    km = KMeans(n_clusters=k, n_init=10, random_state=42).fit(Z)
    elbow.append({"k": k, "inertia": km.inertia_, "silhouette": silhouette_score(Z, km.labels_)})
km = KMeans(n_clusters=4, n_init=10, random_state=42).fit(Z)
profiles["cluster"] = km.labels_
```

**Backend API (`app.py`)**

```python
@app.post("/api/predict")
def predict():
    row = parse_inputs(request.get_json(force=True))
    x = pd.DataFrame([row])[FEATURES]
    inp, out = rf.predict(x)[0]                                    # Random Forest
    normal = rf.predict(week_frame(row, weekend_sessions, 0))      # 7-day forecast
    profile = build_profile(DAYS, normal[:, 0], normal[:, 1])
    cluster_id = km["kmeans"].predict(km["scaler"].transform(pd.DataFrame([profile])))[0]  # K-Means
    return jsonify({"prediction": ..., "weekly": ..., "monthly": ..., "cluster": ...})
```

**Frontend call (`static/app.js`)**

```javascript
const result = await api("/api/predict", { method: "POST", body: readForm() });
renderResults(result);   // draws result cards, user type, cost table and weekly chart
```

---

## Figures and screenshots to paste

| # | File | Caption |
|---|---|---|
| 1 | Screenshot of the Predict tab | Prediction, cost, user type and weekly forecast |
| 2 | Screenshot of the Model Insights tab | Metrics, feature importance and clusters |
| 3 | Screenshot of the Training Data tab | Training data sample |
| 4 | `static/figures/profession_tokens.png` | Average daily tokens by profession |
| 5 | `static/figures/actual_vs_predicted.png` | Random Forest actual vs predicted |
| 6 | `static/figures/feature_importance.png` | Random Forest feature importance |
| 7 | `static/figures/kmeans_elbow.png` | Choosing k (elbow + silhouette) |
| 8 | `static/figures/kmeans_clusters.png` | K-Means user clusters |
