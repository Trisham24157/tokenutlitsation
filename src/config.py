"""Shared constants used by the data generator, training script and Flask app."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
MODEL_DIR = ROOT / "models"
FIGURE_DIR = ROOT / "static" / "figures"

DAILY_CSV = DATA_DIR / "token_usage_daily.csv"

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MODEL_TIERS = ["small", "medium", "large"]

# Per-profession behaviour used to simulate usage:
# sessions/day, words per prompt, documents uploaded/day, probability of code work,
# output/input-per-turn ratio, weekend activity factor, probability of using agents
PROFESSIONS = {
    "Software Developer": dict(sessions=10, words=250, docs=2.0, code=0.90, out_ratio=0.9, weekend=0.40, agents=0.55),
    "Data Scientist":     dict(sessions=8,  words=220, docs=3.0, code=0.75, out_ratio=0.8, weekend=0.40, agents=0.40),
    "Student":            dict(sessions=6,  words=120, docs=1.5, code=0.30, out_ratio=1.2, weekend=0.90, agents=0.10),
    "Content Writer":     dict(sessions=9,  words=180, docs=1.0, code=0.02, out_ratio=1.8, weekend=0.60, agents=0.10),
    "Digital Marketer":   dict(sessions=7,  words=130, docs=0.8, code=0.05, out_ratio=1.5, weekend=0.30, agents=0.15),
    "Teacher":            dict(sessions=4,  words=150, docs=1.5, code=0.05, out_ratio=1.4, weekend=0.50, agents=0.05),
    "Doctor":             dict(sessions=3,  words=100, docs=1.0, code=0.00, out_ratio=0.8, weekend=0.50, agents=0.05),
    "Lawyer":             dict(sessions=4,  words=300, docs=4.0, code=0.00, out_ratio=0.7, weekend=0.40, agents=0.10),
    "Researcher":         dict(sessions=6,  words=280, docs=4.0, code=0.30, out_ratio=0.7, weekend=0.60, agents=0.25),
    "Designer":           dict(sessions=4,  words=90,  docs=0.5, code=0.10, out_ratio=0.9, weekend=0.50, agents=0.05),
    "Customer Support":   dict(sessions=12, words=80,  docs=0.3, code=0.00, out_ratio=1.1, weekend=0.30, agents=0.20),
    "Business Analyst":   dict(sessions=6,  words=200, docs=2.5, code=0.20, out_ratio=0.9, weekend=0.30, agents=0.15),
}

CATEGORICAL = ["profession", "day_of_week", "model_tier"]
NUMERIC = [
    "experience_years",
    "deadline_week",
    "uses_agents",
    "sessions_per_day",
    "turns_per_session",
    "avg_prompt_words",
    "docs_uploaded",
    "code_task",
]
FEATURES = CATEGORICAL + NUMERIC
TARGETS = ["input_tokens", "output_tokens"]

FEATURE_LABELS = {
    "profession": "Profession",
    "day_of_week": "Day of week",
    "model_tier": "Model tier",
    "experience_years": "Experience (years)",
    "deadline_week": "Deadline / exam week",
    "uses_agents": "Uses AI agents",
    "sessions_per_day": "Chat sessions per day",
    "turns_per_session": "Messages per session",
    "avg_prompt_words": "Avg prompt length (words)",
    "docs_uploaded": "Documents uploaded",
    "code_task": "Coding task today",
}

# USD per 1M tokens (illustrative prices for small / medium / large LLM tiers)
PRICING = {
    "small":  {"input": 0.15, "output": 0.60},
    "medium": {"input": 3.00, "output": 15.00},
    "large":  {"input": 15.00, "output": 75.00},
}
USD_TO_INR = 84.0
