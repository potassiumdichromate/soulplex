"""Countries and the cities people can sign up in. Keep in sync with frontend/src/places.ts.

People are matched within the same city, so each name here must be unique across countries.
"""

PLACES: dict[str, list[str]] = {
    "United Arab Emirates": ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah"],
    "India": ["Delhi NCR", "Mumbai", "Bengaluru", "Hyderabad", "Pune", "Chennai", "Kolkata", "Ahmedabad"],
    "Saudi Arabia": ["Riyadh", "Jeddah", "Dammam"],
    "Qatar": ["Doha"],
    "United Kingdom": ["London", "Manchester", "Birmingham"],
    "United States": ["New York", "Los Angeles", "San Francisco Bay Area", "Chicago", "Houston"],
}

CITIES = {city for cities in PLACES.values() for city in cities}
COUNTRY_OF = {city: country for country, cities in PLACES.items() for city in cities}


def valid_city(city: str) -> bool:
    return city in CITIES
