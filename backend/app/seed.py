import secrets
from sqlalchemy import select
from .db import SessionLocal, User, Memory, Message
from .security import hash_password, DEMO
from .about import facts as about_facts
from .demo_about import ABOUT


INTENTS = {"leila": "marriage", "omar": "marriage", "priya": "marriage", "aditi": "marriage", "karan": "marriage", "daniel": "dating", "sara": "dating"}


def seed():
    if not DEMO:
        return
    with SessionLocal() as db:
        W, M = ["man"], ["woman"]
        people = [
            ("maya", "Maya", 29, "Dubai", "woman", W, [
                ("interests", "I like quiet bookshops and long lunches."),
                ("values", "I value kindness and honest communication."),
                ("backstory", "I moved to Dubai for work and enjoy building a community here."),
                ("communication", "When we disagree I prefer to talk it through calmly the same day."),
                ("lifestyle", "My ideal weekend is a slow morning, a walk by the water and cooking for friends."),
            ]),
            ("arjun", "Arjun", 31, "Dubai", "man", M, [
                ("interests", "I enjoy photography, neighbourhood walks and coffee."),
                ("lifestyle", "I like a thoughtful plan with room for a spontaneous detour."),
                ("values", "I value curiosity and making time for people."),
                ("future", "In a few years I want to settle in Dubai and build a home with someone."),
                ("communication", "I need a little space to think before I talk through a disagreement."),
            ]),
            ("priya", "Priya", 28, "Delhi NCR", "woman", W, [
                ("interests", "I enjoy live music and cooking with friends."),
                ("communication", "I prefer to discuss differences calmly."),
                ("future", "Family matters a lot to me and I see marriage in the next few years."),
            ]),
            ("rohan", "Rohan", 30, "Delhi NCR", "man", M, [
                ("interests", "I enjoy gardens and trying new recipes."),
                ("future", "I am looking for a committed relationship."),
                ("values", "Honesty and patience are what I bring and hope to find."),
            ]),
            ("operator", "Pilot operator", 35, "Dubai", "nonbinary", ["nonbinary"], []),
            ("karan", "Karan", 33, "Dubai", "man", M, [
                ("interests", "I read a book a week and run a small book club."),
                ("values", "Kindness and honesty matter more to me than grand gestures."),
                ("lifestyle", "Weekends are for long lunches, a walk and an early night."),
                ("communication", "I like to talk things through calmly instead of letting things build up."),
                ("future", "I want a committed relationship and eventually a home full of books."),
            ]),
            ("omar", "Omar", 30, "Dubai", "man", M, [
                ("interests", "I play football twice a week and love travel photography."),
                ("lifestyle", "I'm an early riser: gym, coffee, then work."),
                ("values", "Family and loyalty come first for me."),
                ("communication", "I'm direct: I'd rather say what I feel than guess."),
            ]),
            ("daniel", "Daniel", 34, "Dubai", "man", M, [
                ("interests", "I design furniture and spend Saturdays at art galleries."),
                ("lifestyle", "I love cooking elaborate dinners for friends."),
                ("future", "I might relocate in a few years, so I'm open about that early."),
            ]),
            ("vikram", "Vikram", 32, "Dubai", "man", M, [
                ("interests", "Cricket on weekends, learning the guitar on weeknights."),
                ("values", "I value humour and patience in tough moments."),
                ("communication", "I check in often by text; small messages matter to me."),
                ("lifestyle", "I enjoy quiet coffee mornings and walks by the water."),
            ]),
            ("sara", "Sara", 27, "Dubai", "woman", W, [
                ("interests", "I paint, hike in the mountains and collect old film cameras."),
                ("values", "Curiosity and generosity are what I admire most."),
                ("lifestyle", "My weekends are spontaneous: a road trip or a new cafe."),
                ("future", "I see myself building something together, maybe a small studio."),
            ]),
            ("leila", "Leila", 30, "Dubai", "woman", W, [
                ("interests", "I love books, especially poetry, and Sunday farmers markets."),
                ("communication", "I need space to process before discussing a disagreement."),
                ("values", "Respect and making time for people are my non-negotiables."),
                ("future", "Marriage and children are part of my plan in the next few years."),
            ]),
            ("ananya", "Ananya", 29, "Dubai", "woman", W, [
                ("interests", "I do photography and yoga, and I'm learning to cook Thai food."),
                ("lifestyle", "A good weekend has a long walk, coffee and time with friends."),
                ("values", "Honesty and curiosity about the world."),
                ("communication", "Let's talk it through calmly; I'm a listener first."),
                ("future", "I'm ready for commitment and want to settle in Dubai."),
            ]),
            ("noor", "Noor", 31, "Dubai", "woman", W, [
                ("interests", "Tech meetups, sci-fi films and weekend tennis."),
                ("lifestyle", "I plan my weeks carefully but love one spontaneous evening."),
                ("communication", "I'm direct and appreciate the same."),
            ]),
            ("aditi", "Aditi", 27, "Delhi NCR", "woman", W, [
                ("interests", "Classical dance, books and long drives."),
                ("values", "Kindness and family keep me grounded."),
                ("future", "I want a committed partner who wants marriage too."),
            ]),
            ("meera", "Meera", 30, "Delhi NCR", "woman", W, [
                ("interests", "I teach yoga and spend Sundays at the flower market."),
                ("values", "Kindness and patience matter most to me."),
                ("communication", "I like to talk things through calmly over chai."),
            ]),
            ("ishaan", "Ishaan", 29, "Delhi NCR", "man", M, [
                ("interests", "I play guitar and I'm learning to cook my grandmother's recipes."),
                ("lifestyle", "My weekends are long walks, old bookshops and family lunches."),
                ("values", "Honesty and making time for family are everything to me."),
            ]),
            ("zara", "Zara", 26, "Dubai", "woman", W, [
                ("interests", "I swim at sunrise and read too many mystery novels."),
                ("lifestyle", "I love planning small adventures: a new cafe, a desert drive."),
                ("communication", "I'm direct but kind, and I listen before I answer."),
            ]),
            ("rahul", "Rahul", 35, "Dubai", "man", M, [
                ("interests", "I cook on weekends and I'm slowly learning photography."),
                ("values", "Kindness, loyalty and a good sense of humour."),
                ("future", "I'm ready for commitment and would love to build a home together."),
            ]),
            ("kabir", "Kabir", 31, "Delhi NCR", "man", M, [
                ("interests", "Music festivals, cooking and cricket."),
                ("communication", "I like to discuss things calmly and listen first."),
                ("lifestyle", "Weekends with friends, Sunday mornings slow."),
            ]),
        ]
        CAST_FACES = {
            "maya": "creamsuit", "sara": "pinkbomber", "leila": "lavender", "zara": "sheerlilac",
            "arjun": "midnight", "karan": "lilachoodie", "omar": "tealvarsity", "vikram": "blackbomber",
        }
        faces = {
            "maya": dict(skin=2, hair=1, hairColor=1, eyes=1, brows=0, mouth=0, facial=0, accessory=3, outfit=0),
            "arjun": dict(skin=3, hair=0, hairColor=0, eyes=0, brows=1, mouth=1, facial=1, accessory=0, outfit=3),
            "priya": dict(skin=3, hair=2, hairColor=0, eyes=1, brows=0, mouth=0, facial=0, accessory=2, outfit=1),
            "rohan": dict(skin=4, hair=5, hairColor=0, eyes=0, brows=1, mouth=1, facial=2, accessory=0, outfit=4),
            "operator": dict(skin=1, hair=4, hairColor=2, eyes=2, brows=2, mouth=0, facial=0, accessory=1, outfit=5),
            "karan": dict(skin=2, hair=4, hairColor=0, eyes=2, brows=1, mouth=1, facial=0, accessory=1, outfit=2),
            "omar": dict(skin=3, hair=5, hairColor=0, eyes=0, brows=1, mouth=1, facial=1, accessory=0, outfit=5),
            "daniel": dict(skin=0, hair=6, hairColor=4, eyes=0, brows=0, mouth=0, facial=2, accessory=0, outfit=1),
            "vikram": dict(skin=4, hair=7, hairColor=0, eyes=1, brows=1, mouth=1, facial=1, accessory=0, outfit=2),
            "sara": dict(skin=1, hair=3, hairColor=3, eyes=1, brows=0, mouth=0, facial=0, accessory=3, outfit=1),
            "leila": dict(skin=2, hair=8, hairColor=0, eyes=1, brows=0, mouth=0, facial=0, accessory=0, outfit=3),
            "ananya": dict(skin=4, hair=2, hairColor=1, eyes=2, brows=0, mouth=0, facial=0, accessory=2, outfit=4),
            "noor": dict(skin=2, hair=1, hairColor=0, eyes=1, brows=2, mouth=2, facial=0, accessory=1, outfit=0),
            "aditi": dict(skin=3, hair=3, hairColor=0, eyes=1, brows=0, mouth=0, facial=0, accessory=2, outfit=2),
            "meera": dict(skin=3, hair=2, hairColor=1, eyes=2, brows=0, mouth=0, facial=0, accessory=2, outfit=3),
            "ishaan": dict(skin=3, hair=4, hairColor=1, eyes=0, brows=1, mouth=1, facial=2, accessory=1, outfit=1),
            "zara": dict(skin=2, hair=3, hairColor=2, eyes=1, brows=0, mouth=1, facial=0, accessory=3, outfit=4),
            "rahul": dict(skin=3, hair=0, hairColor=0, eyes=2, brows=1, mouth=0, facial=1, accessory=0, outfit=5),
            "kabir": dict(skin=4, hair=0, hairColor=0, eyes=0, brows=1, mouth=1, facial=1, accessory=0, outfit=0),
        }
        for key, name, age, city, gender, seeking, facts in people:
            email = key + "@demo.soulplex.local"
            if db.scalar(select(User).where(User.email == email)):
                continue
            u = User(
                email=email,
                password=hash_password(secrets.token_urlsafe(32)),
                name=name,
                age=age,
                city=city,
                gender=gender,
                seeking=seeking,
                age_min=max(21, age - 8),
                age_max=age + 9,
                intent=INTENTS.get(key, "relationship"),
                contact=key + "@example.invalid",
                verified=True,
                discovery=key != "operator",
                synthetic=True,
                public_dates=key != "operator",  # fictional members: anyone may watch their dates
                role="admin" if key == "operator" else "member",
                memory_version=1,
                face={"kind": "cast", "id": CAST_FACES[key]} if key in CAST_FACES else {"kind": "illustrated", "spec": faces.get(key, {})},
                about=ABOUT.get(key, {}),
            )
            db.add(u)
            db.flush()
            for category, f in facts:
                source = Message(user_id=u.id, role="user", content=f)
                db.add(source)
                db.flush()
                db.add(
                    Memory(
                        user_id=u.id,
                        category=category,
                        content=f,
                        source_quote=f,
                        source_id=source.id,
                        status="approved",
                        visibility="shareable",
                    )
                )
            for k, category, sentence in about_facts(ABOUT.get(key, {})):
                db.add(
                    Memory(
                        user_id=u.id,
                        category=category,
                        content=sentence,
                        source_quote=sentence,
                        source_id="about:" + k,
                        status="approved",
                        visibility="shareable",
                    )
                )
        db.commit()
