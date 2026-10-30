"""Stand-in for the live model during tests. The app itself never uses this."""

from app.ai import Fact, Interview, QUESTIONS, Turn
from app.date_types import B_LINES, DATE_TYPES, resolve
from app.resonance import apply_signals, finalize, heuristic

QUESTIONS_BY_CATEGORY = {
    "values": "What does {n} need most from a partner?",
    "lifestyle": "What does a good weekend look like for {n}?",
    "communication": "How does {n} like to handle a disagreement?",
    "future": "Where does {n} see the next few years going?",
    "interests": "What could {n} talk about for hours?",
    "backstory": "What chapter shaped {n} the most?",
    "boundaries": "What pace feels right for {n}?",
}


async def moderate(text):
    return None


async def interview(text, history, memory, index, mind=None):
    category, _question = QUESTIONS[min(index, len(QUESTIONS) - 1)]
    nxt = (
        QUESTIONS[index + 1][1]
        if index + 1 < len(QUESTIONS)
        else "Thank you. Review the proposed memories."
    )
    return (
        Interview(
            reply=f"Thank you for sharing that. {nxt}",
            facts=[Fact(category=category, quote=text[:600])],
        ),
        0,
    )


def _line(i, type_id, me, other, fact, ask):
    quoted = f"“{fact['content'].rstrip('.')}.”"
    question = QUESTIONS_BY_CATEGORY.get(
        ask.get("category", ""), "What matters most to {n}?"
    ).format(n=other["name"])
    stage = DATE_TYPES[type_id]["stages"][i // 2]
    template = stage["a"] if i % 2 == 0 else B_LINES[i // 2]
    return (
        template.format(me=me["name"], other=other["name"], q=quoted, ask=question)
        .replace("  ", " ")
        .strip()
    )


async def run_dialogue(venue, a, b, scene_id=""):
    type_id = resolve(venue)
    spec = DATE_TYPES[type_id]
    lines = []
    for i in range(8):
        stage = spec["stages"][i // 2]
        actor = a if i % 2 == 0 else b
        other = b if actor is a else a
        fact = actor["facts"][(i // 2) % len(actor["facts"])]
        nxt = other["facts"][((i + 1) // 2) % len(other["facts"])]
        lines.append(
            {
                "speaker_id": actor["id"],
                "speaker": actor["name"] + "’s representative",
                "text": _line(i, type_id, actor, other, fact, nxt)[:1200],
                "fact_ids": [fact["id"]],
                "stage": i // 2,
                "mood": stage["mood"],
            }
        )
    return {
        "dialogue": lines,
        "question": spec["human"],
        "summary": "These are possibilities to discuss. Only you can decide whether the real interaction feels right.",
        "evidence": [
            {"id": f["id"], "owner_id": p["id"], "content": f["content"]}
            for p in (a, b)
            for f in p["facts"]
        ],
    }, 0


async def assess(a, b, dialogue):
    return finalize(apply_signals(heuristic(a, b, dialogue), a, b), "keyword"), 0
