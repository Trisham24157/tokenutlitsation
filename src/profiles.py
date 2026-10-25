"""Turn a series of daily token predictions/observations into a user-level usage profile.

The same function is used on the real 30-day history at training time (to fit K-Means)
and on the 7-day forecast inside the web app (to assign a new user to a cluster).
"""
import numpy as np

PROFILE_FEATURES = ["log_avg_daily_tokens", "burstiness", "output_share", "weekend_ratio"]
PROFILE_LABELS = {
    "log_avg_daily_tokens": "log(avg daily tokens)",
    "burstiness": "Burstiness (std / mean)",
    "output_share": "Output share of tokens",
    "weekend_ratio": "Weekend vs weekday usage",
}


def build_profile(days, input_tokens, output_tokens):
    days = np.asarray(days)
    inp = np.asarray(input_tokens, dtype=float)
    out = np.asarray(output_tokens, dtype=float)
    total = inp + out
    weekend = np.isin(days, ["Sat", "Sun"])
    weekday_mean = total[~weekend].mean() if (~weekend).any() else total.mean()
    weekend_mean = total[weekend].mean() if weekend.any() else weekday_mean
    mean = total.mean()
    return {
        "log_avg_daily_tokens": float(np.log1p(mean)),
        "burstiness": float(total.std() / mean) if mean > 0 else 0.0,
        "output_share": float(out.sum() / total.sum()) if total.sum() > 0 else 0.0,
        "weekend_ratio": float(weekend_mean / weekday_mean) if weekday_mean > 0 else 0.0,
    }
