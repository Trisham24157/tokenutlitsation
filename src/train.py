"""Train the two models used by TokenSense and save them for the web app.

    M3  Random Forest regression  -> predicts input + output tokens per user per day
    M4  K-Means clustering        -> groups users into usage types

Run:  python src/train.py
"""
import json

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.compose import ColumnTransformer
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error, silhouette_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from config import CATEGORICAL, DAILY_CSV, FEATURE_LABELS, FEATURES, FIGURE_DIR, MODEL_DIR, NUMERIC, TARGETS
from profiles import PROFILE_FEATURES, PROFILE_LABELS, build_profile

SEED = 42
N_ESTIMATORS = 200
N_CLUSTERS = 4

plt.rcParams.update({"figure.dpi": 120, "axes.spines.top": False, "axes.spines.right": False})


def save_fig(name):
    plt.tight_layout()
    plt.savefig(FIGURE_DIR / name)
    plt.close()


# ---------------- M3: Random Forest regression ----------------
def train_random_forest(df):
    X, y = df[FEATURES], df[TARGETS]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=SEED)

    pipe = Pipeline([
        ("prep", ColumnTransformer([
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL),
            ("num", "passthrough", NUMERIC),
        ])),
        ("model", RandomForestRegressor(n_estimators=N_ESTIMATORS, min_samples_leaf=2,
                                        random_state=SEED, n_jobs=-1)),
    ])
    pipe.fit(X_train, y_train)
    pred = pipe.predict(X_test)

    metrics = {
        t: {"mae": round(mean_absolute_error(y_test[t], pred[:, i]), 1),
            "rmse": round(root_mean_squared_error(y_test[t], pred[:, i]), 1),
            "r2": round(r2_score(y_test[t], pred[:, i]), 4)}
        for i, t in enumerate(TARGETS)
    }
    metrics["overall"] = {"mae": round(mean_absolute_error(y_test, pred), 1),
                          "rmse": round(root_mean_squared_error(y_test, pred), 1),
                          "r2": round(r2_score(y_test, pred), 4)}
    for k, m in metrics.items():
        print(f"[RF] {k:14s} MAE={m['mae']:>9}  RMSE={m['rmse']:>9}  R2={m['r2']}")

    # Feature importance, with one-hot columns summed back into their original feature
    names = pipe.named_steps["prep"].get_feature_names_out()
    importance = {}
    for name, imp in zip(names, pipe.named_steps["model"].feature_importances_):
        col = name.split("__", 1)[1]
        source = next((c for c in CATEGORICAL if col.startswith(c + "_")), col)
        importance[source] = importance.get(source, 0) + float(imp)
    importance = dict(sorted(((k, round(v, 4)) for k, v in importance.items()), key=lambda kv: -kv[1]))

    return pipe, metrics, importance, (y_test, pred), (len(X_train), len(X_test))


# ---------------- M4: K-Means clustering ----------------
def name_clusters(centers):
    """Give human-readable names to clusters from their centroids."""
    order = centers["log_avg_daily_tokens"].sort_values().index.tolist()
    names = {order[0]: "Light / Irregular User", order[-1]: "Power User (Heavy Context)"}
    a, b = order[1:-1]
    weekend_heavy = a if centers.loc[a, "weekend_ratio"] > centers.loc[b, "weekend_ratio"] else b
    names[weekend_heavy] = "Anytime Learner / Creator"
    names[b if weekend_heavy == a else a] = "Steady 9-to-5 Professional"
    return names


def train_kmeans(df):
    rows = []
    for uid, g in df.groupby("user_id"):
        prof = build_profile(g["day_of_week"], g["input_tokens"], g["output_tokens"])
        prof.update(user_id=uid, profession=g["profession"].iloc[0],
                    avg_daily_tokens=float((g["input_tokens"] + g["output_tokens"]).mean()))
        rows.append(prof)
    profiles = pd.DataFrame(rows)
    scaler = StandardScaler()
    Z = scaler.fit_transform(profiles[PROFILE_FEATURES])

    elbow = []
    for k in range(2, 9):
        km = KMeans(n_clusters=k, n_init=10, random_state=SEED).fit(Z)
        elbow.append({"k": k, "inertia": round(km.inertia_, 2),
                      "silhouette": round(silhouette_score(Z, km.labels_), 4)})

    km = KMeans(n_clusters=N_CLUSTERS, n_init=10, random_state=SEED).fit(Z)
    profiles["cluster"] = km.labels_
    centers = pd.DataFrame(scaler.inverse_transform(km.cluster_centers_), columns=PROFILE_FEATURES)
    names = name_clusters(centers)
    profiles["cluster_name"] = profiles["cluster"].map(names)
    silhouette = round(silhouette_score(Z, km.labels_), 4)

    summary = []
    for c in range(N_CLUSTERS):
        g = profiles[profiles.cluster == c]
        summary.append({
            "cluster": c,
            "name": names[c],
            "users": int(len(g)),
            "avg_daily_tokens": int(g["avg_daily_tokens"].mean()),
            "burstiness": round(float(g["burstiness"].mean()), 3),
            "output_share": round(float(g["output_share"].mean()), 3),
            "weekend_ratio": round(float(g["weekend_ratio"].mean()), 3),
            "top_professions": g["profession"].value_counts().head(3).to_dict(),
        })
    print(f"[K-Means] k={N_CLUSTERS}, silhouette={silhouette}")
    for s in summary:
        print(f"          {s['name']:30s} users={s['users']:3d} avg/day={s['avg_daily_tokens']:>7}")
    return km, scaler, names, profiles, Z, elbow, summary, silhouette


def make_figures(df, test_data, importance, Z, profiles, elbow):
    FIGURE_DIR.mkdir(parents=True, exist_ok=True)
    for old in FIGURE_DIR.glob("*.png"):
        old.unlink()

    means = df.groupby("profession")[TARGETS].mean().sort_values("input_tokens")
    ax = means.plot.barh(figsize=(8, 5), color=["#6366f1", "#f59e0b"])
    ax.set_xlabel("Average tokens per day")
    ax.set_title("Average daily tokens by profession (training data)")
    ax.legend(["Input (fed to AI)", "Output (generated by AI)"])
    save_fig("profession_tokens.png")

    y_test, pred = test_data
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    for i, t in enumerate(TARGETS):
        ax = axes[i]
        ax.scatter(y_test[t], pred[:, i], s=6, alpha=0.4, color="#6366f1")
        lim = max(y_test[t].max(), pred[:, i].max())
        ax.plot([0, lim], [0, lim], "r--", lw=1)
        ax.set_xlabel(f"Actual {t}"); ax.set_ylabel(f"Predicted {t}")
        ax.set_title(f"Random Forest – {t}: R² = {r2_score(y_test[t], pred[:, i]):.3f}")
    save_fig("actual_vs_predicted.png")

    imp = pd.Series(importance).rename(index=FEATURE_LABELS).sort_values()
    ax = imp.plot.barh(figsize=(7, 4.5), color="#6366f1")
    ax.set_title("Random Forest feature importance")
    ax.set_xlabel("Importance")
    save_fig("feature_importance.png")

    e = pd.DataFrame(elbow)
    fig, ax1 = plt.subplots(figsize=(6, 4))
    ax1.plot(e.k, e.inertia, "o-", color="#6366f1"); ax1.set_xlabel("k"); ax1.set_ylabel("Inertia", color="#6366f1")
    ax2 = ax1.twinx(); ax2.plot(e.k, e.silhouette, "s--", color="#f59e0b"); ax2.set_ylabel("Silhouette", color="#f59e0b")
    ax1.axvline(N_CLUSTERS, color="grey", ls=":")
    ax1.set_title("K-Means: elbow and silhouette")
    save_fig("kmeans_elbow.png")

    pts = PCA(n_components=2, random_state=SEED).fit_transform(Z)
    fig, ax = plt.subplots(figsize=(7, 5))
    for name, g in profiles.groupby("cluster_name"):
        ax.scatter(pts[g.index, 0], pts[g.index, 1], s=18, label=f"{name} ({len(g)})", alpha=0.8)
    ax.set_xlabel("PC 1"); ax.set_ylabel("PC 2")
    ax.set_title("User clusters (K-Means, PCA projection)")
    ax.legend(fontsize=8)
    save_fig("kmeans_clusters.png")


def main():
    MODEL_DIR.mkdir(exist_ok=True)
    df = pd.read_csv(DAILY_CSV)
    print(f"Loaded {len(df)} rows")

    rf_pipe, metrics, importance, test_data, split = train_random_forest(df)
    km, scaler, names, profiles, Z, elbow, clusters, silhouette = train_kmeans(df)
    make_figures(df, test_data, importance, Z, profiles, elbow)

    rf_pipe.fit(df[FEATURES], df[TARGETS])  # final model uses every row
    joblib.dump(rf_pipe, MODEL_DIR / "rf_token_model.joblib", compress=3)
    joblib.dump({"kmeans": km, "scaler": scaler, "names": names}, MODEL_DIR / "kmeans_users.joblib")

    insights = {
        "dataset": {"rows": len(df), "users": int(df["user_id"].nunique()),
                    "train_rows": split[0], "test_rows": split[1],
                    "features": FEATURES, "targets": TARGETS},
        "random_forest": {"n_estimators": N_ESTIMATORS, "metrics": metrics,
                          "feature_importance": importance},
        "kmeans": {"k": N_CLUSTERS, "silhouette": silhouette, "elbow": elbow,
                   "clusters": clusters, "profile_features": PROFILE_LABELS},
    }
    with open(MODEL_DIR / "insights.json", "w") as f:
        json.dump(insights, f, indent=2)
    print(f"Saved models to {MODEL_DIR} and figures to {FIGURE_DIR}")


if __name__ == "__main__":
    main()
