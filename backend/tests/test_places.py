"""Sign-up without age / interested-in, country -> city list, and age asked in onboarding."""

from app.places import PLACES, CITIES, COUNTRY_OF
from app.studio import UAE

BASE = {
    "name": "Lina",
    "city": "Jeddah",
    "gender": "woman",
    "age_min": 25,
    "age_max": 38,
    "intent": "relationship",
    "consent": True,
    "email": "lina@example.com",
    "password": "a-long-password-1",
}


def register(client, **over):
    r = client.post("/api/auth/register", json={**BASE, **over})
    if r.status_code == 200:
        client.headers["X-CSRF-Token"] = r.json()["csrf"]
    return r


def test_signup_needs_no_age_or_interested_in(client):
    r = register(client)
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    assert user["city"] == "Jeddah"
    # placeholders until onboarding: open to everyone, hidden from discovery
    assert sorted(user["seeking"]) == ["man", "nonbinary", "self-described", "woman"]
    assert user["discovery"] is False


def test_signup_still_accepts_age_and_seeking_if_sent(client):
    r = register(client, age=33, seeking=["man"])
    assert r.status_code == 200, r.text
    assert r.json()["user"]["age"] == 33 and r.json()["user"]["seeking"] == ["man"]
    assert register(client, email="kid@example.com", age=17).status_code == 422


def test_every_listed_city_is_accepted_and_others_rejected(client):
    for i, city in enumerate(["Dubai", "Delhi NCR", "Abu Dhabi", "Doha", "London", "New York"]):
        r = client.post("/api/auth/register", json={**BASE, "city": city, "email": f"u{i}@example.com"})
        assert r.status_code == 200, (city, r.text)
    for bad in ["Paris", "", "dubai", "Delhi"]:
        r = client.post("/api/auth/register", json={**BASE, "city": bad, "email": "bad@example.com"})
        assert r.status_code == 422, bad
        assert "city" in r.text.lower()


def test_onboarding_age_step_saves_their_real_age(client):
    register(client)
    r = client.post("/api/onboarding/age", json={"adult": True, "age": 31})
    assert r.status_code == 200, r.text
    me = client.get("/api/me").json()
    me = me.get("user", me)
    assert me["age"] == 31 and me["age_verified"] is True
    assert client.post("/api/onboarding/age", json={"adult": True, "age": 16}).status_code == 422
    # older clients that only send the adult tick keep working
    assert client.post("/api/onboarding/age", json={"adult": True}).status_code == 200


def test_onboarding_range_accepts_new_cities(client):
    register(client)
    ok = client.put("/api/onboarding/range", json={"age_min": 26, "age_max": 36, "city": "Riyadh"})
    assert ok.status_code == 200, ok.text
    bad = client.put("/api/onboarding/range", json={"age_min": 26, "age_max": 36, "city": "Paris"})
    assert bad.status_code == 422


def test_settings_profile_update_checks_city(client, login):
    login("maya")
    me = client.get("/api/me").json()
    me = me.get("user", me)
    keys = ["name", "age", "city", "gender", "seeking", "age_min", "age_max", "intent", "contact", "discovery"]
    body = {k: me[k] for k in keys}
    ok = client.put("/api/profile", json={**body, "city": "Sharjah"})
    assert ok.status_code == 200, ok.text
    assert client.put("/api/profile", json={**body, "city": "Paris"}).status_code == 422


def test_place_list_is_consistent():
    assert set(PLACES) >= {"United Arab Emirates", "India", "Saudi Arabia", "Qatar", "United Kingdom", "United States"}
    names = [c for cities in PLACES.values() for c in cities]
    assert len(names) == len(CITIES), "a city name appears in two countries"
    assert UAE == {c for c, country in COUNTRY_OF.items() if country == "United Arab Emirates"}
