"""OCEAN (Big Five) self-report and blinded twin calibration.

Instrument: the IPIP 50-item Big-Five Factor Markers (Goldberg, 1992) with the 20-item
Mini-IPIP subset (Donnellan, Oswald, Baird & Lucas, 2006). IPIP items are public domain
(https://ipip.ori.org). Both are scored on the 1-5 IPIP accuracy scale.

What the numbers are, and are not:

* Scores are POMP (percent of maximum possible): the owner's keyed mean mapped to 0-100.
  They are not percentiles. No population norms ship with this code, so nothing here says
  "higher than 80% of people".
* The range around each score is a heuristic band from the spread of that person's own item
  answers, widened for short forms. It is a reminder that 4 items are not a measurement
  device, not a published confidence interval.
* A model never writes or edits a score. Models only *predict* held-out answers during
  calibration, and those predictions are compared with what the owner actually said.
* Personality is never a gate. It shapes how a twin speaks, and, only when the owner opts in
  to the "matching" scope, adds conversation notes and a small, labelled nudge to a date
  reflection.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import re
import statistics

INSTRUMENT = "ipip-50-bffm"
INSTRUMENT_VERSION = "1.0.0"
CITATION = (
    "IPIP Big-Five Factor Markers (Goldberg, 1992); Mini-IPIP (Donnellan et al., 2006). "
    "Public-domain items from the International Personality Item Pool, ipip.ori.org."
)
STEM = "Describe yourself as you generally are now, not as you wish to be in the future."
SCALE = [
    {"value": 1, "label": "Very inaccurate"},
    {"value": 2, "label": "Moderately inaccurate"},
    {"value": 3, "label": "Neither accurate nor inaccurate"},
    {"value": 4, "label": "Moderately accurate"},
    {"value": 5, "label": "Very accurate"},
]
TRAITS = ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"]
TRAIT_LABELS = {
    "openness": "Openness (intellect and imagination)",
    "conscientiousness": "Conscientiousness",
    "extraversion": "Extraversion",
    "agreeableness": "Agreeableness",
    "neuroticism": "Emotional sensitivity (neuroticism)",
}
SCOPES = ("private", "twin", "matching")
MIN_ITEMS = 3

# (id, trait, key, mini, text). Key is relative to the named trait; neuroticism items are
# keyed toward neuroticism, so "Am relaxed most of the time" is reverse-keyed.
ITEMS = [
    ("E1", "extraversion", 1, True, "Am the life of the party."),
    ("A1", "agreeableness", -1, False, "Feel little concern for others."),
    ("C1", "conscientiousness", 1, False, "Am always prepared."),
    ("N1", "neuroticism", 1, False, "Get stressed out easily."),
    ("O1", "openness", 1, False, "Have a rich vocabulary."),
    ("E2", "extraversion", -1, True, "Don't talk a lot."),
    ("A2", "agreeableness", 1, False, "Am interested in people."),
    ("C2", "conscientiousness", -1, False, "Leave my belongings around."),
    ("N2", "neuroticism", -1, True, "Am relaxed most of the time."),
    ("O2", "openness", -1, True, "Have difficulty understanding abstract ideas."),
    ("E3", "extraversion", 1, False, "Feel comfortable around people."),
    ("A3", "agreeableness", -1, False, "Insult people."),
    ("C3", "conscientiousness", 1, False, "Pay attention to details."),
    ("N3", "neuroticism", 1, False, "Worry about things."),
    ("O3", "openness", 1, True, "Have a vivid imagination."),
    ("E4", "extraversion", -1, True, "Keep in the background."),
    ("A4", "agreeableness", 1, True, "Sympathize with others' feelings."),
    ("C4", "conscientiousness", -1, True, "Make a mess of things."),
    ("N4", "neuroticism", -1, True, "Seldom feel blue."),
    ("O4", "openness", -1, True, "Am not interested in abstract ideas."),
    ("E5", "extraversion", 1, False, "Start conversations."),
    ("A5", "agreeableness", -1, True, "Am not interested in other people's problems."),
    ("C5", "conscientiousness", 1, True, "Get chores done right away."),
    ("N5", "neuroticism", 1, False, "Am easily disturbed."),
    ("O5", "openness", 1, False, "Have excellent ideas."),
    ("E6", "extraversion", -1, False, "Have little to say."),
    ("A6", "agreeableness", 1, False, "Have a soft heart."),
    ("C6", "conscientiousness", -1, True, "Often forget to put things back in their proper place."),
    ("N6", "neuroticism", 1, True, "Get upset easily."),
    ("O6", "openness", -1, True, "Do not have a good imagination."),
    ("E7", "extraversion", 1, True, "Talk to a lot of different people at parties."),
    ("A7", "agreeableness", -1, True, "Am not really interested in others."),
    ("C7", "conscientiousness", 1, True, "Like order."),
    ("N7", "neuroticism", 1, False, "Change my mood a lot."),
    ("O7", "openness", 1, False, "Am quick to understand things."),
    ("E8", "extraversion", -1, False, "Don't like to draw attention to myself."),
    ("A8", "agreeableness", 1, False, "Take time out for others."),
    ("C8", "conscientiousness", -1, False, "Shirk my duties."),
    ("N8", "neuroticism", 1, True, "Have frequent mood swings."),
    ("O8", "openness", 1, False, "Use difficult words."),
    ("E9", "extraversion", 1, False, "Don't mind being the center of attention."),
    ("A9", "agreeableness", 1, True, "Feel others' emotions."),
    ("C9", "conscientiousness", 1, False, "Follow a schedule."),
    ("N9", "neuroticism", 1, False, "Get irritated easily."),
    ("O9", "openness", 1, False, "Spend time reflecting on things."),
    ("E10", "extraversion", -1, False, "Am quiet around strangers."),
    ("A10", "agreeableness", 1, False, "Make people feel at ease."),
    ("C10", "conscientiousness", 1, False, "Am exacting in my work."),
    ("N10", "neuroticism", 1, False, "Often feel blue."),
    ("O10", "openness", 1, False, "Am full of ideas."),
]
BY_ID = {row[0]: {"id": row[0], "trait": row[1], "key": row[2], "mini": row[3], "text": row[4]} for row in ITEMS}
MINI = [row[0] for row in ITEMS if row[3]]


def inventory(form="mini"):
    ids = MINI if form == "mini" else [row[0] for row in ITEMS]
    return {
        "instrument": INSTRUMENT,
        "instrument_version": INSTRUMENT_VERSION,
        "form": "mini" if form == "mini" else "full",
        "stem": STEM,
        "scale": SCALE,
        "items": [{"id": i, "text": BY_ID[i]["text"]} for i in ids],
        "traits": [{"id": t, "label": TRAIT_LABELS[t]} for t in TRAITS],
        "citation": CITATION,
        "note": "There are no right answers. Your scores are a mirror of your own answers, not a diagnosis, and they never decide who you can meet.",
    }


def keyed(item_id, value):
    return value if BY_ID[item_id]["key"] > 0 else 6 - value


def level(score):
    if score is None:
        return None
    return "higher" if score >= 60 else "lower" if score <= 40 else "middle"


def score(responses):
    """responses: {item_id: 1..5}. Returns per-trait POMP scores with an approximate range."""
    out = {}
    for trait in TRAITS:
        values = [keyed(i, v) for i, v in responses.items() if BY_ID[i]["trait"] == trait]
        k = len(values)
        if k < MIN_ITEMS:
            out[trait] = {"score": None, "items": k, "low": None, "high": None, "level": None}
            continue
        mean = sum(values) / k
        pomp = (mean - 1) / 4 * 100
        spread = statistics.pstdev(values) if k > 1 else 0.0
        floor = 12 if k <= 4 else 8 if k <= 7 else 6
        half = max(1.96 * spread / math.sqrt(k) * 25, floor)
        out[trait] = {
            "score": round(pomp),
            "items": k,
            "low": max(0, round(pomp - half)),
            "high": min(100, round(pomp + half)),
            "level": level(pomp),
        }
    return out


def form_of(responses):
    answered = set(responses)
    if len(answered) == len(ITEMS):
        return "full"
    if set(MINI) <= answered:
        return "mini"
    return "partial"


def quality(responses, timings=None):
    """Flags answer patterns that make a self-report hard to read. Flags never block saving."""
    flags = []
    values = list(responses.values())
    n = len(values)
    if n >= 10:
        top = max(values.count(v) for v in set(values))
        if top / n >= 0.9:
            flags.append({"id": "same_answer", "detail": "Almost every answer was the same choice."})
    contradictions = 0
    for trait in TRAITS:
        pos = [v for i, v in responses.items() if BY_ID[i]["trait"] == trait and BY_ID[i]["key"] > 0]
        neg = [6 - v for i, v in responses.items() if BY_ID[i]["trait"] == trait and BY_ID[i]["key"] < 0]
        if pos and neg and abs(sum(pos) / len(pos) - sum(neg) / len(neg)) >= 2.0:
            contradictions += 1
    if contradictions >= 2:
        flags.append({
            "id": "contradictory",
            "detail": "Several pairs of opposite statements got the same answer, for example agreeing with both.",
        })
    timed = [t for t in (timings or []) if t and t > 0]
    if len(timed) >= 10 and statistics.median(timed) < 800:
        flags.append({"id": "rushed", "detail": "Answers came faster than most people can read the statements."})
    return {"status": "review" if flags else "ok", "flags": flags, "answered": n}


def usable(profile):
    """A profile shapes the twin only when its answers passed the checks or the owner confirmed them."""
    if not profile or profile.scope == "private":
        return False
    q = profile.quality or {}
    if q.get("status") not in ("ok", "confirmed"):
        return False
    return any((profile.scores or {}).get(t, {}).get("score") is not None for t in TRAITS)


STYLE = {
    ("extraversion", "higher"): "Bring easy energy, open topics readily, and keep the conversation moving.",
    ("extraversion", "lower"): "Be calm and unhurried. Ask one question at a time and leave room to listen.",
    ("agreeableness", "higher"): "Be warm and generous with appreciation for what the other person shares.",
    ("agreeableness", "lower"): "Be candid and direct. Stay kind, but do not over-agree or flatter.",
    ("conscientiousness", "higher"): "Be concrete and organised. It is natural to mention plans and follow-through.",
    ("conscientiousness", "lower"): "Keep it relaxed and spontaneous rather than planned to the minute.",
    ("neuroticism", "higher"): "Be honest about feelings and do not fake certainty. Reassurance can be asked for gently.",
    ("neuroticism", "lower"): "Stay steady and even-keeled, even if the conversation stalls.",
    ("openness", "higher"): "Enjoy ideas, imaginative tangents, and 'what if' questions.",
    ("openness", "lower"): "Prefer practical, grounded topics over abstract ones.",
}


def style_hints(profile):
    """How the twin should come across. Tone guidance only, never stated as a fact."""
    if not usable(profile):
        return []
    hints = []
    for trait in ("extraversion", "agreeableness", "conscientiousness", "openness", "neuroticism"):
        lv = (profile.scores or {}).get(trait, {}).get("level")
        if (trait, lv) in STYLE:
            hints.append(STYLE[(trait, lv)])
    return hints


def shared_levels(profile):
    """What may reach a date reflection: levels only, and only in the matching scope."""
    if not usable(profile) or profile.scope != "matching":
        return None
    return {t: (profile.scores or {}).get(t, {}).get("score") for t in ("extraversion", "conscientiousness", "openness", "agreeableness")}


def pair_notes(pa, pb, name_a, name_b):
    """Conversation notes for two matching-scope profiles. Neuroticism is never compared.

    Research finds personality similarity is a weak predictor of relationship outcomes, so the
    score nudge is capped at +/-4 points on one dimension and labelled.
    """
    if not pa or not pb:
        return None
    shared, explore = [], []
    e_a, e_b = pa.get("extraversion"), pb.get("extraversion")
    c_a, c_b = pa.get("conscientiousness"), pb.get("conscientiousness")
    o_a, o_b = pa.get("openness"), pb.get("openness")
    g_a, g_b = pa.get("agreeableness"), pb.get("agreeableness")
    if None not in (e_a, e_b):
        if e_a >= 60 and e_b >= 60:
            shared.append("You both enjoy lively company")
        elif e_a <= 40 and e_b <= 40:
            shared.append("You both recharge quietly")
        elif abs(e_a - e_b) >= 35:
            explore.append("How you each like to spend social energy: big nights out or quiet evenings in?")
    if None not in (c_a, c_b):
        if c_a >= 60 and c_b >= 60:
            shared.append("You both value plans and follow-through")
        elif abs(c_a - c_b) >= 35:
            explore.append("Planning versus spontaneity: how would you organise plans together?")
    if None not in (o_a, o_b) and o_a >= 60 and o_b >= 60:
        shared.append("You both enjoy ideas and imagination")
    if None not in (g_a, g_b) and g_a >= 60 and g_b >= 60:
        shared.append("You both lead with warmth")
    gaps = [abs(x - y) for x, y in ((e_a, e_b), (c_a, c_b), (o_a, o_b)) if x is not None and y is not None]
    nudge = 0
    if gaps:
        nudge = max(-4, min(4, round(4 - (sum(gaps) / len(gaps)) / 12.5)))
    return {
        "shared": shared,
        "explore": explore,
        "nudge": nudge,
        "basis": f"From {name_a}'s and {name_b}'s own IPIP answers, which both chose to use for matching. Similarity is a weak signal, so it moves the score by at most 4 points.",
    }


# ---------- Blinded calibration ----------


def plan_holdout(responses, rng=None, per_trait=2):
    """Pick held-out items, leaving at least MIN_ITEMS per trait for the twin's training view."""
    rng = rng or random.SystemRandom()
    held = []
    for trait in TRAITS:
        answered = [i for i in responses if BY_ID[i]["trait"] == trait]
        spare = len(answered) - MIN_ITEMS
        if spare <= 0:
            continue
        rng.shuffle(answered)
        held += answered[: min(per_trait, spare)]
    return held


def training_view(responses, held_out):
    return {i: v for i, v in responses.items() if i not in set(held_out)}


def prompt_items(held_out, rng=None):
    """Opaque labels so the item id does not reveal its trait or key to the twin."""
    rng = rng or random.SystemRandom()
    order = list(held_out)
    rng.shuffle(order)
    return [{"id": f"q{n + 1}", "text": BY_ID[i]["text"], "_item": i} for n, i in enumerate(order)]


def calibration_context(train_scores, facts, items):
    return {
        "task": "Predict how this person would rate each statement about themselves.",
        "stem": STEM,
        "scale": SCALE,
        "self_report_summary": {
            TRAIT_LABELS[t]: {"score_0_100": s["score"], "level": s["level"]}
            for t, s in train_scores.items()
            if s.get("score") is not None
        },
        "approved_facts": facts,
        "statements": [{"id": row["id"], "text": row["text"]} for row in items],
    }


def context_hash(context):
    raw = json.dumps(context, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def parse_predictions(text, labels):
    """Read {"predictions":[{"id":"q1","value":4}]} from a model or Mind reply."""
    match = re.search(r"\{.*\}", text or "", re.S)
    if not match:
        raise ValueError("No JSON object in the reply.")
    data = json.loads(match.group(0))
    rows = data.get("predictions") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ValueError("The reply has no predictions list.")
    out = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        label, value = row.get("id"), row.get("value")
        if label in labels and isinstance(value, (int, float)) and 1 <= value <= 5:
            out[label] = int(round(value))
    if set(out) != set(labels):
        raise ValueError("The reply did not rate every statement exactly once.")
    return out


def evaluate(responses, held_out, predictions, train_scores):
    """Compare twin predictions with the owner's held-out answers, against two naive baselines.

    * midpoint: always predict 3.
    * self_report: predict from the trait mean the twin was shown (what a lookup table would do).
    The twin adds value only when it beats the self_report baseline.
    """
    errors, mid, base, per_trait = [], [], [], {}
    for item in held_out:
        actual = responses[item]
        guess = predictions[item]
        trait = BY_ID[item]["trait"]
        t_score = train_scores.get(trait, {}).get("score")
        keyed_mean = 1 + 4 * (t_score / 100) if t_score is not None else 3.0
        expected = keyed_mean if BY_ID[item]["key"] > 0 else 6 - keyed_mean
        err = abs(guess - actual)
        errors.append(err)
        mid.append(abs(3 - actual))
        base.append(abs(expected - actual))
        per_trait.setdefault(trait, []).append(err)
    n = len(errors)
    mae = sum(errors) / n
    base_mae = sum(base) / n
    return {
        "items": n,
        "mae": round(mae, 3),
        "exact": round(sum(e == 0 for e in errors) / n, 3),
        "within_one": round(sum(e <= 1 for e in errors) / n, 3),
        "agreement": round(100 * (1 - mae / 4)),
        "baseline_midpoint_mae": round(sum(mid) / n, 3),
        "baseline_self_report_mae": round(base_mae, 3),
        "lift_over_self_report": round(base_mae - mae, 3),
        "per_trait_mae": {t: round(sum(v) / len(v), 3) for t, v in per_trait.items()},
        "label": (
            f"Your twin rated {n} statements it had never seen you answer. "
            f"It was within one step of your answer on {sum(e <= 1 for e in errors)} of them."
        ),
    }


def trend(runs):
    done = [r for r in runs if r.status == "complete" and r.metrics]
    if not done:
        return {"runs": 0, "label": "No calibration yet. Answer the full 50 statements, then run one."}
    recent = sorted(done, key=lambda r: r.created)[-5:]
    agreement = round(sum(r.metrics["agreement"] for r in recent) / len(recent))
    lift = round(sum(r.metrics["lift_over_self_report"] for r in recent) / len(recent), 3)
    return {
        "runs": len(done),
        "recent": len(recent),
        "agreement": agreement,
        "lift_over_self_report": lift,
        "label": f"Average agreement on held-out statements over the last {len(recent)} run(s): {agreement}/100.",
    }
