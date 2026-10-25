"""Generate the synthetic training dataset.

data/token_usage_daily.csv - one row per user per day (300 users x 30 days = 9000 rows),
used by Random Forest (prediction) and K-Means (user types).

The numbers follow how LLM billing actually works: every new message re-sends the whole
conversation, so input tokens grow roughly with turns^2, uploaded files and agent loops
multiply the context, and the model's reply is the output.
"""
import numpy as np
import pandas as pd

from config import DAILY_CSV, DATA_DIR, DAYS, MODEL_TIERS, PROFESSIONS

RNG = np.random.default_rng(42)
N_USERS = 300
N_DAYS = 30
WORDS_TO_TOKENS = 1.33


def simulate_day(p, user, day_idx, deadline):
    dow = DAYS[day_idx % 7]
    weekend = dow in ("Sat", "Sun")
    activity = p["weekend"] if weekend else 1.0
    if dow == "Fri" and not weekend:
        activity *= 0.85
    if deadline:
        activity *= 1.35

    sessions = max(0, RNG.poisson(p["sessions"] * activity * user["intensity"]))
    turns = max(1, int(round(RNG.normal(user["turns"], 1.0))))
    words = max(10, int(RNG.normal(p["words"], p["words"] * 0.2)))
    docs = RNG.poisson(p["docs"] * activity)
    code = int(RNG.random() < p["code"])

    prompt_tokens = words * WORDS_TO_TOKENS
    reply_tokens = prompt_tokens * p["out_ratio"] * (1.3 if code else 1.0)

    # Each turn re-sends all previous prompts and replies (conversation history)
    history = turns * (turns + 1) / 2
    input_tokens = sessions * (history * prompt_tokens + (history - turns) * reply_tokens + 400)
    input_tokens += docs * 2500 + code * sessions * 1200
    if user["agents"]:
        input_tokens *= 2.5
    input_tokens *= {"small": 0.9, "medium": 1.0, "large": 1.1}[user["tier"]]

    output_tokens = sessions * turns * reply_tokens
    if user["agents"]:
        output_tokens *= 1.6
    output_tokens += 150 * user["experience"] ** 0.5 * sessions  # seniors ask for longer outputs

    noise = RNG.lognormal(0, 0.12, size=2)
    return dict(
        day_of_week=dow,
        deadline_week=int(deadline),
        sessions_per_day=int(sessions),
        turns_per_session=turns,
        avg_prompt_words=words,
        docs_uploaded=int(docs),
        code_task=code,
        input_tokens=int(input_tokens * noise[0]),
        output_tokens=int(output_tokens * noise[1]),
    )


def make_daily():
    rows = []
    professions = list(PROFESSIONS)
    for uid in range(1, N_USERS + 1):
        prof = professions[(uid - 1) % len(professions)]
        p = PROFESSIONS[prof]
        user = dict(
            experience=int(RNG.integers(0, 4) if prof == "Student" else RNG.integers(1, 26)),
            tier=RNG.choice(MODEL_TIERS, p=[0.35, 0.45, 0.20]),
            agents=int(RNG.random() < p["agents"]),
            turns=RNG.uniform(3, 8),
            intensity=RNG.lognormal(0, 0.25),
        )
        start_dow = int(RNG.integers(0, 7))
        deadline_weeks = RNG.random(5) < 0.25
        for d in range(N_DAYS):
            day_idx = start_dow + d
            row = dict(
                user_id=f"U{uid:03d}",
                profession=prof,
                experience_years=user["experience"],
                model_tier=user["tier"],
                uses_agents=user["agents"],
            )
            row.update(simulate_day(p, user, day_idx, deadline_weeks[d // 7]))
            row["total_tokens"] = row["input_tokens"] + row["output_tokens"]
            rows.append(row)
    return pd.DataFrame(rows)


if __name__ == "__main__":
    DATA_DIR.mkdir(exist_ok=True)
    daily = make_daily()
    daily.to_csv(DAILY_CSV, index=False)
    print(f"Wrote {len(daily)} rows -> {DAILY_CSV}")
    print(daily.groupby("profession")[["input_tokens", "output_tokens"]].mean().round(0).sort_values("input_tokens"))
