"""Structured "About me" profile (Hinge-style vitals + prompts + must-haves).

Answers do three jobs:

1. Shown as vitals on cards (only the fields the person filled in).
2. Turned into owner-approved, shareable agent traits (``source_id = "about:<key>"``),
   so the agent can speak about them on dates. They are regenerated on every save.
3. Structured compatibility signals for resonance, and must-haves as hard filters.
"""

CHOICES = {
    "pronouns": ["she", "he", "they", "prefer_not"],
    "education": ["high_school", "diploma", "bachelors", "masters", "doctorate", "other"],
    "marital": ["never_married", "divorced", "widowed", "separated"],
    "children": ["none", "have_kids"],
    "family_plans": ["want", "dont_want", "open", "not_sure"],
    "timeline": ["within_year", "one_two_years", "when_right"],
    "relocate": ["yes", "maybe", "no"],
    "drinking": ["no", "socially", "yes"],
    "smoking": ["no", "sometimes", "yes"],
    "diet": ["vegetarian", "eggetarian", "vegan", "jain", "non_veg", "halal", "anything"],
    "exercise": ["often", "sometimes", "rarely"],
    "sleep": ["early_bird", "night_owl", "flexible"],
    "pets": ["have", "love", "allergic", "no"],
    "religion": ["hindu", "muslim", "christian", "sikh", "jain", "buddhist", "jewish", "spiritual", "not_religious", "other", "prefer_not"],
    "religion_importance": ["very", "somewhat", "not"],
    "date_comfort": ["quiet_cafe", "park", "bookshop", "activity", "dinner", "flexible"],
}
MULTI = {
    "languages": ["English", "Hindi", "Arabic", "Urdu", "Punjabi", "Tamil", "Telugu", "Malayalam", "Bengali", "Marathi", "Gujarati", "Kannada", "French", "Tagalog", "Other"],
    "love_languages": ["words", "time", "gifts", "acts", "touch"],
}
TEXT = {"hometown": 40, "job": 60}
PROMPTS = {
    "sunday": ("My perfect Sunday looks like…", "lifestyle"),
    "win": ("The way to win me over is…", "values"),
    "together": ("We'll get along if…", "values"),
    "family": ("My family would describe me as…", "backstory"),
    "argue": ("After a disagreement, I…", "communication"),
    "learning": ("Something I'm learning right now…", "interests"),
    "green": ("A green flag I look for…", "values"),
    "future": ("In five years, I hope…", "future"),
    "hours": ("I could talk for hours about…", "interests"),
}
DEALBREAKERS = ["smoking", "drinking", "heavy_drinking", "family_plans", "diet", "veg_partner", "religion"]
VEG = {"vegetarian", "eggetarian", "vegan", "jain"}
LOVE = {"words": "words of affirmation", "time": "quality time", "gifts": "thoughtful gifts", "acts": "acts of service", "touch": "physical closeness"}


def clean(data: dict) -> dict:
    if not isinstance(data, dict):
        raise ValueError("Invalid profile.")
    out = {}
    for k, opts in CHOICES.items():
        v = data.get(k)
        if v in (None, ""):
            continue
        if v not in opts:
            raise ValueError(f"Choose a valid option for {k.replace('_', ' ')}.")
        out[k] = v
    for k, opts in MULTI.items():
        v = data.get(k) or []
        if not isinstance(v, list) or any(x not in opts for x in v):
            raise ValueError(f"Choose valid options for {k.replace('_', ' ')}.")
        if v:
            out[k] = list(dict.fromkeys(v))[: 2 if k == "love_languages" else 6]
    for k, n in TEXT.items():
        v = data.get(k)
        if v:
            if not isinstance(v, str) or len(v.strip()) > n:
                raise ValueError(f"Keep {k} under {n} characters.")
            out[k] = v.strip()
    h = data.get("height_cm")
    if h not in (None, ""):
        if not isinstance(h, int) or isinstance(h, bool) or not 120 <= h <= 220:
            raise ValueError("Height should be between 120 and 220 cm.")
        out["height_cm"] = h
    prompts = data.get("prompts") or []
    if not isinstance(prompts, list) or len(prompts) > 3:
        raise ValueError("Answer up to three prompts.")
    seen, clean_prompts = set(), []
    for p in prompts:
        if not isinstance(p, dict) or p.get("id") not in PROMPTS or p["id"] in seen:
            raise ValueError("Choose different prompts.")
        a = str(p.get("answer", "")).strip()
        if not 2 <= len(a) <= 300:
            raise ValueError("Each prompt answer should be 2–300 characters.")
        seen.add(p["id"])
        clean_prompts.append({"id": p["id"], "answer": a})
    if clean_prompts:
        out["prompts"] = clean_prompts
    db = data.get("dealbreakers") or []
    if not isinstance(db, list) or any(x not in DEALBREAKERS for x in db):
        raise ValueError("Invalid must-have.")
    if db:
        out["dealbreakers"] = list(dict.fromkeys(db))
    return out


def facts(a: dict) -> list[tuple[str, str, str]]:
    """(key, category, sentence) for every filled answer. Every sentence is first person."""
    f = []
    add = lambda k, c, s: f.append((k, c, s))
    diet = {"vegetarian": "I'm vegetarian.", "eggetarian": "I'm vegetarian but eat eggs.", "vegan": "I'm vegan.", "jain": "I follow a Jain diet.", "non_veg": "I eat meat and enjoy all kinds of food.", "halal": "I eat halal.", "anything": "I'll happily eat anything."}
    if "diet" in a:
        add("diet", "lifestyle", diet[a["diet"]])
    if "drinking" in a:
        add("drinking", "lifestyle", {"no": "I don't drink alcohol.", "socially": "I drink socially.", "yes": "I enjoy a drink."}[a["drinking"]])
    if "smoking" in a:
        add("smoking", "lifestyle", {"no": "I don't smoke.", "sometimes": "I smoke sometimes.", "yes": "I smoke."}[a["smoking"]])
    if "exercise" in a:
        add("exercise", "lifestyle", {"often": "I work out often; staying active matters to me.", "sometimes": "I stay active now and then.", "rarely": "I'm more of a relaxed, low-key person than a gym regular."}[a["exercise"]])
    if "date_comfort" in a:
        scene = {
            "quiet_cafe": "I'd feel most like myself at a quiet café.",
            "park": "I'd feel most like myself on a walk in the park.",
            "bookshop": "I'd feel most like myself in a bookshop or gallery.",
            "activity": "I'd feel most like myself doing a fun activity.",
            "dinner": "I'd feel most like myself at a comfortable dinner.",
            "flexible": "I'm flexible about where a first date happens.",
        }[a["date_comfort"]]
        add("date_comfort", "lifestyle", scene)
    if "sleep" in a:
        add("sleep", "lifestyle", {"early_bird": "I'm an early bird.", "night_owl": "I'm a night owl.", "flexible": "My sleep schedule is flexible."}[a["sleep"]])
    if "pets" in a:
        add("pets", "lifestyle", {"have": "I have a pet at home.", "love": "I love animals.", "allergic": "I'm allergic to pets.", "no": "Pets aren't really my thing."}[a["pets"]])
    if "family_plans" in a:
        add("family_plans", "future", {"want": "I'd love to have children someday.", "dont_want": "A family of two feels right to me.", "open": "I'm open to having children.", "not_sure": "I'm still deciding about starting a family."}[a["family_plans"]])
    if "timeline" in a:
        add("timeline", "future", {"within_year": "I'd like to settle down within a year.", "one_two_years": "I'd like to settle down in the next one or two years.", "when_right": "I'll settle down when it feels right, with no rush."}[a["timeline"]])
    if "relocate" in a:
        add("relocate", "future", {"yes": "I'm open to moving cities for the right person.", "maybe": "I might move cities for the right person.", "no": "I'd like to stay in my city."}[a["relocate"]])
    if a.get("children") == "have_kids":
        add("children", "backstory", "I'm a parent.")
    if a.get("religion") and a["religion"] != "prefer_not":
        name = a["religion"].replace("_", " ")
        imp = {"very": "very important to me", "somewhat": "somewhat important to me", "not": "not a big part of my daily life"}.get(a.get("religion_importance"), "part of who I am")
        add("religion", "values", f"Faith ({name}) is {imp}." if a["religion"] not in ("not_religious", "spiritual") else ("I'm spiritual." if a["religion"] == "spiritual" else "I'm not religious."))
    if a.get("love_languages"):
        add("love_languages", "communication", "I feel loved through " + " and ".join(LOVE[x] for x in a["love_languages"]) + ".")
    if a.get("languages"):
        add("languages", "backstory", "I speak " + ", ".join(a["languages"]) + ".")
    if a.get("job"):
        add("job", "backstory", f"I work as {a['job']}." if not a["job"].lower().startswith(("a ", "an ")) else f"I work as {a['job']}.")
    for p in a.get("prompts", []):
        q, cat = PROMPTS[p["id"]]
        add("prompt:" + p["id"], cat, f"{q.rstrip('…')}: {p['answer']}")
    return f


MUST_LABEL = {
    "smoking": "doesn't smoke",
    "drinking": "doesn't drink",
    "family_plans": "agrees on children",
    "diet": "is vegetarian",
    "religion": "shares your religion",
    "heavy_drinking": "doesn't drink a lot",
    "veg_partner": "is vegetarian",
}


def violations(a: dict, b: dict) -> list[str]:
    """Which of a's must-haves b breaks."""
    return [d for d in a.get("dealbreakers", []) if violates({**a, "dealbreakers": [d]}, b)]


def violates(a: dict, b: dict) -> bool:
    """True if b's answers break one of a's must-haves. Unknown answers never exclude."""
    a = {**a.get("studio_habits", {}), **{k: v for k, v in a.items() if v is not None}}
    b = {**b.get("studio_habits", {}), **{k: v for k, v in b.items() if v is not None}}
    for d in a.get("dealbreakers", []):
        mine, theirs = a.get(d), b.get(d)
        if d in ("heavy_drinking", "veg_partner"):
            theirs = b.get("drinking" if d == "heavy_drinking" else "diet")
        if theirs is None:
            continue
        if d == "smoking" and theirs != "no":
            return True
        if d == "drinking" and theirs != "no":
            return True
        if d == "heavy_drinking" and b.get("drinking") == "yes":
            return True
        if d == "veg_partner" and b.get("diet") is not None and b.get("diet") not in VEG:
            return True
        if d == "family_plans" and mine and {mine, theirs} == {"want", "dont_want"}:
            return True
        if d == "diet" and mine in VEG and theirs not in VEG:
            return True
        if d == "religion" and mine and mine != "prefer_not" and theirs != mine:
            return True
    return False


def signals(a: dict, b: dict, na: str, nb: str):
    """Structured compatibility hints: (dimension, delta, kind, text)."""
    out = []
    fa, fb = a.get("family_plans"), b.get("family_plans")
    if fa and fb:
        if {fa, fb} == {"want", "dont_want"}:
            out.append(("future", -18, "explore", "You see children differently. That's worth an honest talk early."))
        elif fa == fb or {fa, fb} <= {"want", "open"}:
            out.append(("future", 8, "shared", "Aligned on family plans"))
    ta, tb = a.get("timeline"), b.get("timeline")
    if ta and tb:
        if ta == tb:
            out.append(("future", 5, "shared", "Same pace for settling down"))
        elif {ta, tb} == {"within_year", "when_right"}:
            out.append(("future", -6, "explore", f"{na} wants to settle sooner than {nb}. Talk about timing."))
    da, dbb = a.get("diet"), b.get("diet")
    if da and dbb:
        if (da in VEG) == (dbb in VEG):
            out.append(("lifestyle", 4, "shared", "Similar food habits"))
        else:
            out.append(("lifestyle", -3, "explore", "Different diets: easy to plan around if you talk about it."))
    for key, label in (("drinking", "drinking"), ("smoking", "smoking")):
        x, y = a.get(key), b.get(key)
        if x and y:
            if x == y:
                out.append(("lifestyle", 3, None, ""))
            elif "no" in (x, y) and "yes" in (x, y):
                out.append(("lifestyle", -6, "explore", f"You feel differently about {label}."))
    sa, sb = a.get("sleep"), b.get("sleep")
    if sa and sb and "flexible" not in (sa, sb):
        out.append(("lifestyle", 4, "shared", "Same body clock") if sa == sb else ("lifestyle", -4, "explore", "One early bird, one night owl: mornings might need a plan."))
    ra, rb = a.get("religion"), b.get("religion")
    if ra and rb and "prefer_not" not in (ra, rb):
        if ra == rb:
            out.append(("values", 6, "shared", "Shared faith" if ra not in ("not_religious", "spiritual") else "Similar outlook on faith"))
        elif "very" in (a.get("religion_importance"), b.get("religion_importance")):
            out.append(("values", -8, "explore", "Faith matters a lot to one of you and you differ. Talk openly about it."))
    la, lb = set(a.get("love_languages", [])), set(b.get("love_languages", []))
    if la & lb:
        out.append(("communication", 6, "shared", "Same love language: " + LOVE[sorted(la & lb)[0]]))
    ea, eb = a.get("exercise"), b.get("exercise")
    if ea and eb and ea == eb:
        out.append(("lifestyle", 3, None, ""))
    return out


def completion(a: dict) -> int:
    keys = ["pronouns", "height_cm", "job", "education", "languages", "family_plans", "timeline", "drinking", "smoking", "diet", "sleep", "religion", "love_languages"]
    have = sum(1 for k in keys if a.get(k)) + 3 * len(a.get("prompts", []))
    return round(100 * have / (len(keys) + 9))
