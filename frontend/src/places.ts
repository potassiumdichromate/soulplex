/** Countries and the cities people can sign up in. Keep in sync with backend/app/places.py. */
export const PLACES: Record<string, string[]> = {
  "United Arab Emirates": ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah"],
  India: ["Delhi NCR", "Mumbai", "Bengaluru", "Hyderabad", "Pune", "Chennai", "Kolkata", "Ahmedabad"],
  "Saudi Arabia": ["Riyadh", "Jeddah", "Dammam"],
  Qatar: ["Doha"],
  "United Kingdom": ["London", "Manchester", "Birmingham"],
  "United States": ["New York", "Los Angeles", "San Francisco Bay Area", "Chicago", "Houston"],
};

export const COUNTRIES = Object.keys(PLACES);

export const countryOf = (city: string) => COUNTRIES.find((c) => PLACES[c].includes(city)) ?? "";
