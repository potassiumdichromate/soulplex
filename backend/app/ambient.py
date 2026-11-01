"""Ten display-only dates for an empty island.

They are not accounts, they never enter matching, and they are appended only
while no real date is queued or running. Real dates stay above them.
"""

import hashlib
import time

from .faces import spec_for

# venue, name, gender, name, gender, what each agent says
PAIRS = [
    ("cafe", "Arun", "man", "Meera", "woman", "Two cappuccinos. Arun likes a slow Sunday and a window table.", "Meera would add a long walk after the coffee."),
    ("walk", "Kabir", "man", "Sara", "woman", "Kabir starts at the willow loop and keeps the pace easy.", "Sara points out the pond and asks what a good week looks like."),
    ("bookshop", "Rohan", "man", "Ananya", "woman", "Rohan pulls a poetry shelf and reads one line out loud.", "Ananya matches it with a book she rereads every year."),
    ("garden", "Vikram", "man", "Leila", "woman", "Vikram picks the rose blanket and talks about quiet mornings.", "Leila describes the city she wants to show someone slowly."),
    ("cooking", "Ishaan", "man", "Zara", "woman", "Ishaan starts the pasta and asks who cooks at home.", "Zara says she cooks when she wants the evening to last."),
    ("streetfood", "Rahul", "man", "Noor", "woman", "Rahul orders the mild side and saves the spicy one to share.", "Noor names the sweet stall she always ends on."),
    ("gallery", "Daniel", "man", "Aditi", "woman", "Daniel stops at the colour wall and asks what it reminds her of.", "Aditi talks about a painting she stood in front of for an hour."),
    ("sunset", "Omar", "man", "Priya", "woman", "Omar takes the north pier and watches the light go.", "Priya says this is the hour she answers honestly."),
    ("stars", "Karan", "man", "Aisha", "woman", "Karan finds the brass telescope and names one constellation.", "Aisha trades it for the story of her favourite night sky."),
    ("games", "Neil", "man", "Maya", "woman", "Neil sets up the chess table and promises a slow game.", "Maya laughs and says she plays to talk, not to win."),
]


def _agent(name: str, gender: str):
    hue = int(hashlib.sha256(name.encode()).hexdigest()[:4], 16) % 360
    return {
        "name": name,
        "hue": hue,
        "face": {"kind": "illustrated", "spec": spec_for(gender, "ambient:" + name)},
        "gender": gender,
    }


def filler_dates(now=None):
    now = now or time.time()
    out = []
    for i, (venue, a, ag, b, bg, line_a, line_b) in enumerate(PAIRS):
        step = i % 4
        out.append({
            "id": "ambient-" + venue,
            "type": venue,
            "spot": 0,
            "status": "running",
            "started": now - (14 + i * 8) * 60,
            "step": step,
            "mine": False,
            "public": True,
            "ambient": True,
            "a": _agent(a, ag),
            "b": _agent(b, bg),
            "lines": [
                {"side": "a", "speaker": a + "'s agent", "text": line_a, "stage": step, "mood": "relaxed"},
                {"side": "b", "speaker": b + "'s agent", "text": line_b, "stage": step, "mood": "warming up"},
            ],
        })
    return out
