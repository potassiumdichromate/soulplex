"""Twin Studio v1.2: stable question IDs, blinded calibration, and grounded reveals.

Quick taps and talk-to-twin both save this schema. Nothing here invents a personality
score, and a skipped answer is stored as unanswered rather than as a preference.
"""

import hashlib
import json
import os
import re

from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from .ai import ProviderError, structured
from .places import PLACES
from .db import (
    CalibrationRun,
    ConsentRecord,
    Memory,
    Participation,
    Report,
    Scene,
    StudioAnswer,
    User,
    now,
)

SCHEMA_VERSION = "1.2.0"
NOTICE_VERSION = "2026-10-24"

GENDER = [
    ("woman", "Woman"),
    ("man", "Man"),
    ("nonbinary", "Non-binary"),
    ("self_described", "I describe my gender another way"),
    ("prefer_not", "Prefer not to say"),
]
SEEKING = [
    ("men", "Men"),
    ("women", "Women"),
    ("nonbinary", "Non-binary people"),
    ("self_described", "People who self-describe their gender"),
    ("any", "Open to all genders"),
]
DISTANCE = [
    ("10km", "Within 10 km"),
    ("25km", "Within 25 km"),
    ("city", "Same city"),
    ("uae", "Anywhere in the UAE"),
    ("nearby", "Open to nearby cities"),
]
INTENT = [
    ("long_term", "Something serious", "💞"),
    ("marriage_minded", "Long-term, with marriage in mind", "💍"),
    ("open_to_serious", "Seeing where it goes", "🌱"),
    ("exploring", "Still figuring it out", "🤔"),
]
DEALBREAKERS = [
    ("smoking", "A match who smokes"),
    ("long_distance", "A long-distance relationship"),
    ("intent", "Different relationship intentions"),
    ("relocation", "A match who expects me to relocate"),
    ("schedules", "Strongly conflicting schedules"),
    ("pets", "Incompatible pet preferences"),
    ("other", "Something else (describe privately)"),
    ("none", "None for now"),
]
VALUES = [
    ("humor", "Great sense of humour", "😄"),
    ("kindness", "Kind-hearted", "💗"),
    ("honesty", "Honest", "🤝"),
    ("listener", "A good listener", "👂"),
    ("family", "Family-oriented", "🏡"),
    ("ambition", "Driven", "🚀"),
    ("adventurous", "Adventurous", "🌍"),
    ("emotional_maturity", "Emotionally mature", "🌱"),
    ("reliability", "Reliable", "⏰"),
    ("curiosity", "Curious", "💡"),
    ("independence", "Independent", "🦋"),
    ("shared_values", "A similar outlook on life", "🧭"),
    ("other", "Something else", "✨"),
]
# About you: easy, dating-app style picks. Icons are display-only.
VIBE = [
    ("humour", "Great sense of humour", "😄"),
    ("listener", "Active listener", "👂"),
    ("open", "Open communicator", "💬"),
    ("direct", "Direct and candid", "🎯"),
    ("calm", "Calm under pressure", "🧘"),
    ("independent", "Independent", "🦋"),
    ("caring", "Warm and caring", "🤗"),
    ("adventurous", "Adventurous", "🌍"),
    ("thoughtful", "Thoughtful", "💭"),
    ("ambitious", "Ambitious", "🚀"),
    ("homebody", "A bit of a homebody", "🏡"),
    ("social", "Social butterfly", "🎉"),
]
WEEKEND = [
    ("movie_night", "A cozy movie night in", "🍿"),
    ("cafe", "Trying a new café or restaurant", "☕"),
    ("getaway", "A quick weekend getaway", "🧳"),
    ("friends", "Out with friends", "🎉"),
    ("outdoors", "Something outdoors", "🌿"),
    ("recharge", "Sleeping in and recharging", "😴"),
]
LIFE = [
    ("career", "Growing my career", "💼"),
    ("family", "Family time", "👨‍👩‍👧"),
    ("balance", "Work-life balance", "⚖️"),
    ("health", "Health and fitness", "💪"),
    ("growth", "Learning and self-growth", "📈"),
    ("fun", "Having fun, honestly", "🥳"),
    ("building", "Building something of my own", "🛠️"),
]
HABITS = [
    ("H01_drinking", "drinking", "Drinking", "🍷", [("no", "Never"), ("socially", "Socially"), ("yes", "Regularly")]),
    ("H02_smoking", "smoking", "Smoking", "🚬", [("no", "Never"), ("sometimes", "Sometimes"), ("yes", "Yes")]),
    ("H03_workout", "exercise", "Working out", "🏃", [("often", "Most days"), ("sometimes", "Sometimes"), ("rarely", "Rarely")]),
    ("H04_diet", "diet", "Food", "🍽️", [("vegetarian", "Vegetarian"), ("eggetarian", "Eggetarian"), ("vegan", "Vegan"), ("non_veg", "Non-veg"), ("anything", "Eat anything")]),
]
PARTNER = [
    ("P01_drinking", "Their drinking", "🍷", [("no", "Prefer a non-drinker"), ("socially", "Social drinking is fine"), ("any", "Doesn't matter")]),
    ("P02_smoking", "Their smoking", "🚬", [("no", "Non-smoker, please"), ("any", "Doesn't matter")]),
    ("P03_active", "Their activity", "🏃", [("active", "Someone active"), ("any", "Doesn't matter")]),
    ("P04_diet", "Their food", "🍽️", [("vegetarian", "Vegetarian, please"), ("any", "Doesn't matter")]),
]
SCENES = [
    ("quiet_cafe", "A quiet café", "☕"),
    ("park", "A walk in the park", "🌳"),
    ("bookshop", "A bookshop or gallery", "📖"),
    ("activity", "A fun activity", "🎯"),
    ("dinner", "Dinner somewhere comfortable", "🍽️"),
    ("flexible", "Surprise me, I'm flexible", "✨"),
]
# Optional, collected after the first preview or on the agent page. Not signup gates.
STYLE = [
    ("S01", "communication_natural", "When you're chatting with someone new, you're usually…", "single", [
        ("warm", "Warm and easy", "☀️"),
        ("direct", "Direct and clear", "🎯"),
        ("playful", "Playful, lots of banter", "😜"),
        ("thoughtful", "Thoughtful, I take my time", "💭"),
        ("depends", "It depends on the vibe", "🤷"),
    ]),
    ("S02", "interests", "What are you into?", "multi", [
        ("films", "Movies and shows", "🎬"),
        ("anime", "Anime", "🍥"),
        ("cafes", "Cafés and casual dining", "☕"),
        ("travel", "Travel and weekend getaways", "✈️"),
        ("music", "Music", "🎧"),
        ("books", "Reading", "📚"),
        ("food", "Cooking and food", "🍳"),
        ("fitness", "Fitness", "💪"),
        ("outdoors", "Hikes and the outdoors", "🥾"),
        ("sport", "Sports", "⚽"),
        ("games", "Gaming", "🎮"),
        ("art", "Art and design", "🎨"),
        ("photography", "Photography", "📷"),
        ("family", "Time with family", "👨‍👩‍👧"),
    ]),
    ("S03", "personal_values", "Which values are yours, not a partner's?", "multi", [
        ("kindness", "Kindness"),
        ("honesty", "Honesty"),
        ("curiosity", "Curiosity"),
        ("loyalty", "Loyalty"),
        ("growth", "Growth"),
        ("freedom", "Freedom"),
        ("family", "Family"),
        ("faith", "Faith"),
    ]),
    ("S04", "authentic_voice", "How should your twin sound?", "single", [
        ("like_me", "Sound like I do"),
        ("warmer", "A little warmer than I am"),
        ("shorter", "Shorter and simpler"),
        ("formal", "A bit more formal"),
        ("depends", "It depends who I am talking to"),
    ]),
]
CONTEXTUAL = [
    ("Q06", "communication_style", "pre_introduction", "How do you like a first conversation to flow?", [
        ("thoughtful", "Thoughtful conversations, even if less frequent"),
        ("frequent", "Frequent check-ins and conversations"),
        ("in_person", "I connect best in person"),
        ("light_playful", "Light, playful conversations at first"),
        ("depends", "It depends on the person"),
    ]),
    ("Q07", "disagreement_style", "post_date", "How would you normally handle a disagreement?", [
        ("ask", "Ask questions to understand their perspective"),
        ("direct", "Express my point of view directly"),
        ("reflect", "Take a moment to think before responding"),
        ("common_ground", "Look for common ground"),
        ("depends", "It depends on the situation"),
    ]),
    ("Q08", "planning_style", "pre_date", "Would you rather make a plan or keep things spontaneous?", [
        ("spontaneous", "I love spontaneous plans"),
        ("plan", "I prefer making plans in advance"),
        ("mix", "A healthy mix of both"),
        ("depends", "It depends on the situation"),
    ]),
    ("Q09", "bill_preference", "cafe_bill", "When the bill comes, what would feel comfortable?", [
        ("split", "Suggesting we split the bill"),
        ("offer", "Offering to pay"),
        ("treated", "Accepting when the other person offers"),
        ("flexible", "Deciding together"),
        ("depends", "It depends on the situation"),
    ]),
]
CALIBRATION = [
    ("CAL02", "The café mix-up", "The waiter brings a drink you did not order. What would you usually do?", [
        ("correct", "Politely ask for the correct order"),
        ("keep", "Keep it if it seems fine"),
        ("ask", "Ask the waiter what options are available"),
        ("depends", "It depends on the mistake"),
    ]),
    ("CAL01", "The late arrival", "You arrive for a first coffee date. The other person is 15 minutes late and has not updated you. What would you naturally do?", [
        ("check", "Send a friendly check-in"),
        ("wait", "Wait a little longer"),
        ("boundary", "Say that updates and punctuality matter to me"),
        ("leave", "Leave if there is still no update"),
        ("depends", "It depends"),
    ]),
    ("CAL03", "Your boundary", "Someone you are just meeting asks a question that feels too personal. What would you say?", [
        ("boundary", "I would rather not discuss that yet"),
        ("brief", "Give a brief answer and move on"),
        ("redirect", "Change the subject"),
        ("why", "Ask why they want to know"),
        ("depends", "It depends"),
    ]),
]
UNSEEN = [
    ("UNS01", "The changed plan", "A friend changes the meeting place at the last minute. What would you usually do?", [
        ("adapt", "Go along if the new place still works"),
        ("ask", "Ask what changed before deciding"),
        ("keep", "Keep the original plan"),
        ("depends", "It depends"),
    ]),
    ("UNS02", "The group introduction", "Someone introduces you to a friend and overstates how close you are. What would you do?", [
        ("correct", "Gently correct it"),
        ("later", "Let it pass and clarify later"),
        ("laugh", "Laugh it off"),
        ("depends", "It depends"),
    ]),
    ("UNS03", "The quiet table", "The table you are given is much louder than you expected. What would you do?", [
        ("move", "Ask whether a quieter table is free"),
        ("stay", "Stay and make the best of it"),
        ("leave", "Suggest going somewhere else"),
        ("depends", "It depends"),
    ]),
]
CONSENTS = [
    ("notice_ack", "I have read how Soulplex uses my answers and can manage them later."),
    ("allow_matching", "Use my approved matching preferences to find mutually eligible members."),
    ("allow_virtual_interactions", "Allow my twin to take part in virtual conversations within my boundaries."),
    ("allow_shareable_facts", "Share only the individual facts I mark as shareable with matched twins."),
    ("allow_episode_memory", "Remember my twin's simulated experiences to improve future virtual interactions."),
    ("allow_external_minds", "Allow approved, minimal information to be processed by the external Minds provider."),
    ("allow_research_feedback", "Use my optional feedback for product-evaluation research."),
]
SCOPES = ("private", "twin", "shareable")
GENDER_PROFILE = {
    "woman": "woman",
    "man": "man",
    "nonbinary": "nonbinary",
    "self_described": "self-described",
    "prefer_not": "prefer_not",
}
SEEK_PROFILE = {
    "men": ["man"],
    "women": ["woman"],
    "nonbinary": ["nonbinary"],
    "self_described": ["self-described"],
    "any": ["woman", "man", "nonbinary", "self-described", "prefer_not"],
}
INTENT_PROFILE = {
    "long_term": "relationship",
    "marriage_minded": "marriage",
    "open_to_serious": "relationship",
    "exploring": "dating",
}
UAE = set(PLACES["United Arab Emirates"])
ORDER = ["CAL02", "CAL01", "CAL03"]


def _opts(pairs):
    out = []
    for row in pairs:
        option = {"id": row[0], "label": row[1]}
        if len(row) > 2:
            option["icon"] = row[2]
        out.append(option)
    return out


def _field(field_id, storage, prompt, kind, options, *, required=False, maximum=1, skip=True, text_max=0):
    return {
        "field_id": field_id,
        "storage": storage,
        "prompt": prompt,
        "kind": kind,
        "required": required,
        "maximum": maximum,
        "skip": skip,
        "text_max": text_max,
        "options": _opts(options),
        "schema_version": SCHEMA_VERSION,
    }


def schema():
    return {
        "schema_version": SCHEMA_VERSION,
        "notice_version": NOTICE_VERSION,
        "order": ["welcome", "age", "Q01_gender", "A01_vibe", "S02", "A03_weekend", "A04_life", "habits", "S01", "Q01_seeking", "ages", "Q01_distance", "Q02", "partner", "Q04", "Q05", "preview", "facts", "permissions", "ready"],
        "fields": [
            _field("Q01_gender", "match_preferences", "My gender (private)", "single", GENDER, required=True, skip=False),
            _field("Q01_seeking", "match_preferences", "Genders I'd like to meet", "multi", SEEKING, required=True, maximum=4, skip=False),
            _field("Q01_distance", "match_preferences", "Where should your twin look?", "single", DISTANCE, required=True, skip=False),
            _field("Q02", "relationship_intent", "What kind of connection are you open to?", "single", INTENT, required=True, skip=False),
            _field("Q03", "dealbreakers", "Anything that is a definite no?", "multi", DEALBREAKERS, maximum=3, text_max=140),
            _field("Q04", "partner_values", "Which three qualities would really matter to you?", "multi", VALUES, maximum=3, text_max=100),
            _field("Q05", "date_comfort", "Where would you feel most yourself?", "single", SCENES),
            _field("A01_vibe", "about_vibe", "How would your friends describe you?", "multi", VIBE, maximum=4),
            _field("A03_weekend", "about_weekend", "Your perfect weekend looks like…", "single", WEEKEND),
            _field("A04_life", "about_life", "What matters most to you right now?", "multi", LIFE, maximum=3),
            *[_field(fid, "habits", label, "single", options) | {"icon": icon, "group": "habits"} for fid, _key, label, icon, options in HABITS],
            *[_field(fid, "partner_preferences", label, "single", options) | {"icon": icon, "group": "partner"} for fid, label, icon, options in PARTNER],
            *[_field(fid, storage, prompt, kind, options, maximum=6 if fid == "S02" else 3 if fid == "S03" else 1) for fid, storage, prompt, kind, options in STYLE],
            *[_field(fid, storage, prompt, "single", options) | {"trigger": trigger} for fid, storage, trigger, prompt, options in CONTEXTUAL],
        ],
        "calibration_order": ORDER,
        "calibration": [
            {"id": i, "title": title, "prompt": prompt, "options": _opts(options)}
            for i, title, prompt, options in CALIBRATION
        ],
        "unseen": [
            {"id": i, "title": title, "prompt": prompt, "options": _opts(options)}
            for i, title, prompt, options in UNSEEN
        ],
        "consents": [{"id": i, "label": label, "default": False} for i, label in CONSENTS],
        "scopes": list(SCOPES),
    }


def _by_id(field_id):
    for field in schema()["fields"]:
        if field["field_id"] == field_id:
            return field
    return None


def scenario(scenario_id):
    for group in (CALIBRATION, UNSEEN):
        for row in group:
            if row[0] == scenario_id:
                return {"id": row[0], "title": row[1], "prompt": row[2], "options": _opts(row[3]), "unseen": group is UNSEEN}
    return None


def label_of(field_id, option_id):
    field = _by_id(field_id)
    if not field:
        scene = scenario(field_id)
        options = scene["options"] if scene else []
    else:
        options = field["options"]
    for option in options:
        if option["id"] == option_id:
            return option["label"]
    return option_id


def validate_answer(field_id, option_ids, free_text, status):
    field = _by_id(field_id)
    if not field:
        raise ValueError("Unknown question.")
    if status == "skipped":
        if not field["skip"]:
            raise ValueError("This question cannot be skipped.")
        return {"option_ids": [], "free_text": "", "status": "skipped"}
    if status != "answered":
        raise ValueError("Save an answer or skip it.")
    ids = list(dict.fromkeys(option_ids or []))
    allowed = {o["id"] for o in field["options"]}
    if not ids or any(i not in allowed for i in ids):
        raise ValueError("Choose one of the listed options.")
    if field["kind"] == "single" and len(ids) != 1:
        raise ValueError("Choose one option.")
    if len(ids) > field["maximum"]:
        raise ValueError(f"Choose at most {field['maximum']}.")
    if "any" in ids and ids != ["any"]:
        raise ValueError("Open to all genders stands on its own.")
    if "none" in ids and ids != ["none"]:
        raise ValueError("None for now stands on its own.")
    text = (free_text or "").strip()
    if text and "other" not in ids and "depends" not in ids:
        raise ValueError("Extra text is only for Other or It depends.")
    if field["text_max"] and len(text) > field["text_max"]:
        raise ValueError(f"Keep that note under {field['text_max']} characters.")
    return {"option_ids": ids, "free_text": text, "status": "answered"}


def apply_profile(user, answers):
    """Copy matching essentials onto the existing profile without clearing other about fields."""
    about = dict(user.about or {})
    by = {a.field_id: a for a in answers if a.status == "answered"}
    gender = by.get("Q01_gender")
    if gender:
        user.gender = GENDER_PROFILE[gender.option_ids[0]]
    seeking = by.get("Q01_seeking")
    if seeking:
        picked = []
        for option in seeking.option_ids:
            for value in SEEK_PROFILE[option]:
                if value not in picked:
                    picked.append(value)
        user.seeking = picked
    intent = by.get("Q02")
    if intent:
        user.intent = INTENT_PROFILE[intent.option_ids[0]]
    if by.get("Q03"):
        about["studio_dealbreakers"] = list(by["Q03"].option_ids)
    elif any(a.field_id == "Q03" and a.status == "skipped" for a in answers):
        about.pop("studio_dealbreakers", None)
    if by.get("Q04"):
        about["partner_values"] = list(by["Q04"].option_ids)
    if by.get("Q05"):
        about["date_comfort"] = by["Q05"].option_ids[0]
    if by.get("Q01_distance"):
        about["distance"] = by["Q01_distance"].option_ids[0]
    # Lifestyle taps stay private: matching may read them, public profiles never show them.
    habits = dict(about.get("studio_habits", {}))
    for fid, key, _label, _icon, _options in HABITS:
        if by.get(fid):
            habits[key] = by[fid].option_ids[0]
    if habits:
        about["studio_habits"] = habits
    # Partner lifestyle picks become must-haves only when the person asked for them.
    rules = {
        "P01_drinking": {"no": "drinking", "socially": "heavy_drinking"},
        "P02_smoking": {"no": "smoking"},
        "P04_diet": {"vegetarian": "veg_partner"},
    }
    musts = list(about.get("dealbreakers", []))
    for fid, mapping in rules.items():
        row = next((a for a in answers if a.field_id == fid), None)
        if not row:
            continue
        for value in mapping.values():
            if value in musts:
                musts.remove(value)
        if row.status == "answered" and row.option_ids[0] in mapping:
            musts.append(mapping[row.option_ids[0]])
    if musts or "dealbreakers" in about:
        about["dealbreakers"] = musts
    if by.get("P03_active"):
        about["partner_active"] = by["P03_active"].option_ids[0] == "active"
    user.about = about


def cities_fit(a, b):
    if a.city == b.city:
        return True
    dist_a = (a.about or {}).get("distance")
    dist_b = (b.about or {}).get("distance")
    both_wide = dist_a in ("uae", "nearby") and dist_b in ("uae", "nearby")
    return bool(both_wide and a.city in UAE and b.city in UAE)


def preview_lines(answers):
    """A mirror of what the owner chose. Not a reading of their personality."""
    by = {a.field_id: a for a in answers if a.status == "answered"}
    lines = []
    mine = []
    if by.get("Q01_gender"):
        lines.append("You described your gender as " + label_of("Q01_gender", by["Q01_gender"].option_ids[0]) + ".")
    if by.get("Q01_seeking"):
        labels = [label_of("Q01_seeking", i) for i in by["Q01_seeking"].option_ids]
        lines.append("You'd like to meet " + ", ".join(x.lower() for x in labels) + ".")
    if by.get("Q02"):
        lines.append("You're looking for: " + label_of("Q02", by["Q02"].option_ids[0]).lower() + ".")
    if by.get("Q04"):
        labels = [label_of("Q04", i) for i in by["Q04"].option_ids if i != "other"]
        if labels:
            lines.append("What would win you over: " + ", ".join(x.lower() for x in labels) + ".")
    if by.get("Q05"):
        lines.append("Ideal first date: " + label_of("Q05", by["Q05"].option_ids[0]).lower() + ".")
    if by.get("A01_vibe"):
        mine.append("Friends would call you: " + ", ".join(label_of("A01_vibe", i).lower() for i in by["A01_vibe"].option_ids) + ".")
    if by.get("S02"):
        mine.append("You're into " + ", ".join(label_of("S02", i).lower() for i in by["S02"].option_ids) + ".")
    if by.get("A03_weekend"):
        mine.append("Your perfect weekend: " + label_of("A03_weekend", by["A03_weekend"].option_ids[0]).lower() + ".")
    if by.get("A04_life"):
        mine.append("What matters right now: " + ", ".join(label_of("A04_life", i).lower() for i in by["A04_life"].option_ids) + ".")
    say = {
        "H01_drinking": {"no": "don't drink", "socially": "drink socially", "yes": "enjoy a drink regularly"},
        "H02_smoking": {"no": "don't smoke", "sometimes": "smoke sometimes", "yes": "smoke"},
        "H03_workout": {"often": "work out most days", "sometimes": "work out sometimes", "rarely": "rarely work out"},
        "H04_diet": {"vegetarian": "are vegetarian", "eggetarian": "are eggetarian", "vegan": "are vegan", "non_veg": "eat non-veg", "anything": "eat anything"},
    }
    habit_bits = [say[fid][by[fid].option_ids[0]] for fid, *_rest in HABITS if by.get(fid)]
    if habit_bits:
        joined = ", ".join(habit_bits[:-1]) + (" and " if len(habit_bits) > 1 else "") + habit_bits[-1]
        mine.append("You " + joined + ".")
    if by.get("S01"):
        mine.append("Chatting with someone new, you're " + label_of("S01", by["S01"].option_ids[0]).lower() + ".")
    want_say = {
        "P01_drinking": {"no": "a non-drinker", "socially": "someone who drinks only socially"},
        "P02_smoking": {"no": "a non-smoker"},
        "P03_active": {"active": "someone active"},
        "P04_diet": {"vegetarian": "a vegetarian"},
    }
    wants = [want_say[fid][by[fid].option_ids[0]] for fid, *_rest in PARTNER if by.get(fid) and by[fid].option_ids[0] in want_say[fid]]
    if wants:
        lines.append("You'd prefer " + (", ".join(wants[:-1]) + " and " if len(wants) > 1 else "") + wants[-1] + ".")
    if by.get("Q03") and by["Q03"].option_ids != ["none"]:
        labels = [label_of("Q03", i) for i in by["Q03"].option_ids if i != "other"]
        if labels:
            lines.append("You named these as definite nos: " + ", ".join(labels) + ".")
    return mine + lines


def decision_context(scenario_row, facts, corrections):
    """What the twin may see. The owner's current answer is intentionally absent."""
    return {
        "scenario_id": scenario_row["id"],
        "situation": scenario_row["prompt"],
        "options": scenario_row["options"],
        "approved_facts": facts,
        "approved_corrections": corrections,
    }


class TwinChoice(BaseModel):
    option_id: str
    summary: str = Field(max_length=400)


async def independent_answer(scenario_row, context):
    if not os.getenv("AI_API_KEY") or not os.getenv("AI_MODEL"):
        raise ProviderError(
            "Your twin cannot answer independently until an approved provider is connected. This challenge is not completed."
        )
    choice = (await structured(
        "You are this person's AI twin answering a hypothetical situation. Use ONLY the approved facts and approved corrections. "
        "The owner's own answer to this situation is not included and you must not guess it. "
        "If the facts do not say what they would do, choose the option id 'depends' when it exists and say you would ask rather than invent a trait. "
        "Do not diagnose personality, trauma, or compatibility. Return the option id and a short summary grounded in the supplied facts.",
        context,
        TwinChoice,
        feature="studio",
    ))[0]
    allowed = {o["id"] for o in scenario_row["options"]}
    if choice.option_id not in allowed:
        raise ProviderError("The twin response was not one of the listed choices, so it was not locked.")
    return choice


def prompt_hash(context):
    raw = json.dumps(context, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def _tokens(text):
    stop = {"with", "that", "this", "from", "your", "about", "would", "like", "have", "they", "them", "their", "what", "when", "where"}
    return {w for w in re.findall(r"[a-z]{4,}", (text or "").lower()) if w not in stop}


def why_click(own_facts, their_facts, lines):
    """Shared points, differences, and quoted moments. Empty when nothing was approved."""
    shared = []
    used = set()
    for mine in own_facts:
        overlap_best = set()
        match = ""
        for theirs in their_facts:
            overlap = _tokens(mine) & _tokens(theirs)
            if len(overlap) > len(overlap_best):
                overlap_best, match = overlap, theirs
        if overlap_best and match not in used:
            used.add(match)
            shared.append({"yours": mine, "theirs": match, "words": sorted(overlap_best)[:4]})
    differences = []
    for mine in own_facts:
        if any(item["yours"] == mine for item in shared):
            continue
        if their_facts:
            differences.append({"yours": mine, "theirs": their_facts[0]})
        if len(differences) == 2:
            break
    moments = []
    for line in lines:
        text = (line or "").strip()
        if text and text not in moments:
            moments.append(text)
        if len(moments) == 3:
            break
    return {
        "title": "Why you two might click",
        "shared": shared[:3],
        "differences": differences[:2],
        "moments": moments,
        "note": "Built only from facts you both approved for sharing and lines the twins actually said. It is not a personality score, and it does not decide whether you meet.",
    }


def consents_for(db, user_id):
    return db.scalars(select(ConsentRecord).where(ConsentRecord.user_id == user_id)).all()


def granted(db, user, purpose):
    rows = consents_for(db, user.id)
    if not rows:
        return True
    return any(row.purpose == purpose and row.granted for row in rows)


def may_start_virtual(db, user):
    return granted(db, user, "allow_virtual_interactions")


def may_auto_join(db, user):
    if user.auto_accept is False:
        return False
    return granted(db, user, "allow_virtual_interactions")


def matching_allowed(db, user):
    return granted(db, user, "allow_matching")


def external_allowed(db, user):
    """An external processor needs an explicit yes. Having no consent rows is not a yes."""
    return any(row.purpose == "allow_external_minds" and row.granted for row in consents_for(db, user.id))


def answers_for(db, user_id):
    return db.scalars(select(StudioAnswer).where(StudioAnswer.user_id == user_id)).all()


def answer_view(row):
    return {
        "field_id": row.field_id,
        "option_ids": list(row.option_ids or []),
        "free_text": row.free_text,
        "status": row.status,
        "source": row.source,
        "schema_version": row.schema_version,
        "permission_scope": row.permission_scope,
        "answer_version": row.answer_version,
        "updated": row.updated,
    }


def calibration_view(row, reveal=True):
    data = {
        "scenario_id": row.scenario_id,
        "unseen": row.unseen,
        "owner_option": row.owner_option,
        "owner_why": row.owner_why,
        "owner_locked": bool(row.owner_locked),
        "twin_locked": bool(row.twin_locked),
        "rating": row.rating,
        "correction": row.correction,
        "correction_status": row.correction_status,
        "twin_method": row.twin_method,
    }
    if reveal and row.twin_locked:
        data["twin_option"] = row.twin_option
        data["twin_summary"] = row.twin_summary
    return data


def fidelity(rows):
    reviewed = [r for r in rows if r.twin_locked and r.twin_method == "model" and r.rating and r.owner_option]
    agreed = [r for r in reviewed if r.owner_option == r.twin_option and r.rating == "yes"]
    unseen = [r for r in reviewed if r.unseen]
    unseen_agreed = [r for r in unseen if r.owner_option == r.twin_option]
    corrected = [r for r in unseen if r.correction_status == "approved"]
    return {
        "compared": len(reviewed),
        "agreed": len(agreed),
        "unseen_compared": len(unseen),
        "unseen_agreed": len(unseen_agreed),
        "unseen_after_correction": len(corrected),
        "label": "Not enough held-out comparisons yet." if len(reviewed) < 1 else f"{len(agreed)} of {len(reviewed)} locked answers matched.",
    }


def suspicious(user, report_count):
    reasons = []
    if re.search(r"@|\d{6,}", user.name or ""):
        reasons.append("Name looks like contact information.")
    if report_count >= 2:
        reasons.append(f"{report_count} open reports.")
    if user.discovery and not user.email_verified:
        reasons.append("Discovery was requested before email verification.")
    return reasons


def pilot_metrics(db):
    members = db.scalars(select(User).where(User.synthetic == False, User.role == "member")).all()
    started = [u for u in members if (u.studio or {}).get("step")]
    previewed = [u for u in started if (u.studio or {}).get("previewed")]
    scenes = db.scalars(select(Scene)).all()
    completed = [s for s in scenes if s.status == "completed"]
    parts = db.scalars(select(Participation)).all()
    accepts = [p for p in parts if p.decision == "accept"]
    mutual_ids = set()
    by_scene = {}
    for part in parts:
        by_scene.setdefault(part.scene_id, []).append(part)
    for sid, group in by_scene.items():
        if len(group) >= 2 and all(p.decision == "accept" and p.contribution for p in group):
            mutual_ids.add(sid)
    thin = []
    for user in members:
        if not user.discovery or not user.verified:
            continue
        others = [
            other for other in members
            if other.id != user.id and other.city == user.city and other.discovery and other.verified and user.gender in (other.seeking or []) and other.gender in (user.seeking or [])
        ]
        if len(others) < 3:
            thin.append({"id": user.id, "name": user.name, "city": user.city, "eligible": len(others)})
    runs = db.scalars(select(CalibrationRun)).all()
    return {
        "onboarding_started": len(started),
        "previews": len(previewed),
        "members": len(members),
        "virtual_dates": len(completed),
        "human_accepts": len(accepts),
        "mutual_accepts": len(mutual_ids),
        "confirmed_next_steps": sum(1 for p in parts if p.decision == "accept" and p.next_step),
        "feedback": sum(1 for p in parts if p.feedback),
        "fidelity": fidelity(runs),
        "thin_pools": thin[:20],
    }


def shareable_text(db, user_id):
    rows = db.scalars(
        select(Memory).where(Memory.user_id == user_id, Memory.status == "approved", Memory.visibility == "shareable")
    ).all()
    return [row.content for row in rows]


def guidance_text(db, user_id):
    rows = db.scalars(
        select(Memory).where(
            Memory.user_id == user_id,
            Memory.status == "approved",
            Memory.visibility.in_(("shareable", "twin")),
        )
    ).all()
    return [{"id": row.id, "content": row.content, "disclose": row.visibility == "shareable"} for row in rows]


def report_counts(db):
    rows = db.execute(
        select(Report.target, func.count()).where(Report.status == "open").group_by(Report.target)
    ).all()
    return {target: count for target, count in rows}


def cancel_queued(db, user_id):
    scenes = db.scalars(
        select(Scene).where(or_(Scene.a == user_id, Scene.b == user_id), Scene.status.in_(("queued", "invited")))
    ).all()
    for scene in scenes:
        scene.status = "declined"
        scene.dedupe_key = None
    return len(scenes)
