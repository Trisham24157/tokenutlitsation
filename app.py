"""TokenSense - Flask backend.

Serves the single-page frontend (templates/index.html) and a small JSON API:

    GET  /api/meta      dropdown options + typical habits per profession
    POST /api/predict   Random Forest prediction + weekly/monthly forecast + K-Means user type
    GET  /api/insights  model metrics and clusters from training
    GET  /api/dataset   preview of the training data
"""
import json
import sys
from pathlib import Path

import joblib
import pandas as pd
from flask import Flask, jsonify, render_template, request

sys.path.insert(0, str(Path(__file__).parent / "src"))
from config import DAILY_CSV, DAYS, FEATURE_LABELS, FEATURES, MODEL_DIR, MODEL_TIERS, PRICING, PROFESSIONS, TARGETS, USD_TO_INR
from profiles import PROFILE_FEATURES, build_profile

app = Flask(__name__)
app.json.sort_keys = False  # keep ranked dicts (feature importance) in order
state = {}


def load_models():
    state["rf"] = joblib.load(MODEL_DIR / "rf_token_model.joblib")
    state["kmeans"] = joblib.load(MODEL_DIR / "kmeans_users.joblib")
    with open(MODEL_DIR / "insights.json") as f:
        state["insights"] = json.load(f)
    daily = pd.read_csv(DAILY_CSV)
    state["daily"] = daily
    weekday = daily[~daily.day_of_week.isin(["Sat", "Sun"])]
    weekend = daily[daily.day_of_week.isin(["Sat", "Sun"])]
    state["defaults"] = {
        prof: {
            "experience_years": int(g.experience_years.median()),
            "model_tier": g.model_tier.mode()[0],
            "uses_agents": int(g.uses_agents.mean() >= 0.5),
            "sessions_per_day": int(round(weekday[weekday.profession == prof].sessions_per_day.median())),
            "weekend_sessions": int(round(weekend[weekend.profession == prof].sessions_per_day.median())),
            "turns_per_session": int(g.turns_per_session.median()),
            "avg_prompt_words": int(g.avg_prompt_words.median()),
            "docs_uploaded": int(g.docs_uploaded.median()),
            "code_task": int(g.code_task.mean() >= 0.5),
        }
        for prof, g in daily.groupby("profession")
    }
    # How much more people chat during deadline/exam weeks, measured per profession
    sessions = daily.groupby(["profession", "deadline_week"]).sessions_per_day.mean().unstack()
    state["deadline_uplift"] = (sessions[1] / sessions[0]).round(3).to_dict()


def cost(input_tokens, output_tokens, tier):
    p = PRICING[tier]
    usd = input_tokens / 1e6 * p["input"] + output_tokens / 1e6 * p["output"]
    return {"usd": round(usd, 4), "inr": round(usd * USD_TO_INR, 2)}


def parse_inputs(body):
    row = {
        "profession": body["profession"],
        "day_of_week": body.get("day_of_week", "Mon"),
        "model_tier": body.get("model_tier", "medium"),
    }
    for f in FEATURES[3:]:
        row[f] = float(body.get(f, 0))
    if row["profession"] not in PROFESSIONS or row["day_of_week"] not in DAYS or row["model_tier"] not in MODEL_TIERS:
        raise ValueError("Unknown profession, day or model tier")
    return row


def week_frame(row, weekend_sessions, deadline):
    uplift = state["deadline_uplift"][row["profession"]] if deadline else 1.0
    rows = []
    for d in DAYS:
        r = dict(row, day_of_week=d, deadline_week=deadline)
        if d in ("Sat", "Sun"):
            r["sessions_per_day"] = weekend_sessions
        r["sessions_per_day"] = round(r["sessions_per_day"] * uplift)
        rows.append(r)
    return pd.DataFrame(rows)[FEATURES]


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/meta")
def meta():
    return jsonify({
        "professions": list(PROFESSIONS),
        "days": DAYS,
        "model_tiers": MODEL_TIERS,
        "pricing": PRICING,
        "defaults": state["defaults"],
        "feature_labels": FEATURE_LABELS,
    })


@app.post("/api/predict")
def predict():
    body = request.get_json(force=True)
    try:
        row = parse_inputs(body)
    except (KeyError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    weekend_sessions = float(body.get("weekend_sessions", row["sessions_per_day"]))
    rf = state["rf"]

    # M3: Random Forest predicts today's input and output tokens
    x = pd.DataFrame([row])[FEATURES]
    inp, out = (max(0.0, v) for v in rf.predict(x)[0])

    normal = rf.predict(week_frame(row, weekend_sessions, 0)).clip(min=0)
    deadline = rf.predict(week_frame(row, weekend_sessions, 1)).clip(min=0)
    weekly = [{"day": d, "input": int(n[0]), "output": int(n[1]),
               "deadline_input": int(dl[0]), "deadline_output": int(dl[1])}
              for d, n, dl in zip(DAYS, normal, deadline)]

    # A typical month = 3 normal weeks + 1 deadline/exam week, scaled to 30 days
    month_in = (3 * normal[:, 0].sum() + deadline[:, 0].sum()) * 30 / 28
    month_out = (3 * normal[:, 1].sum() + deadline[:, 1].sum()) * 30 / 28
    monthly = {
        "input_tokens": int(month_in), "output_tokens": int(month_out),
        "total_tokens": int(month_in + month_out),
        "cost_by_tier": {t: cost(month_in, month_out, t) for t in MODEL_TIERS},
    }

    # M4: K-Means assigns the user type from their predicted week
    km = state["kmeans"]
    profile = build_profile(DAYS, normal[:, 0], normal[:, 1])
    z = km["scaler"].transform(pd.DataFrame([profile])[PROFILE_FEATURES])
    cluster_id = int(km["kmeans"].predict(z)[0])
    cluster = next(c for c in state["insights"]["kmeans"]["clusters"] if c["cluster"] == cluster_id)

    return jsonify({
        "inputs": row,
        "prediction": {"input_tokens": int(inp), "output_tokens": int(out), "total_tokens": int(inp + out),
                       "cost": cost(inp, out, row["model_tier"])},
        "weekly": weekly,
        "deadline_uplift": state["deadline_uplift"][row["profession"]],
        "monthly": monthly,
        "cluster": {**cluster, "profile": {k: round(v, 3) for k, v in profile.items()}},
    })


@app.get("/api/insights")
def insights():
    return jsonify(state["insights"])


@app.get("/api/dataset")
def dataset():
    limit = min(int(request.args.get("limit", 25)), 200)
    daily = state["daily"]
    stats = daily[TARGETS + ["total_tokens"]].describe().round(0).astype(int)
    return jsonify({
        "daily_columns": list(daily.columns),
        "daily_rows": daily.sample(limit, random_state=1).to_dict("records"),
        "daily_count": len(daily),
        "daily_stats": stats.to_dict(),
    })


load_models()

if __name__ == "__main__":
    app.run(debug=False, port=5050)
