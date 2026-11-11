import { useState } from "react";
import { COUNTRIES, PLACES, countryOf } from "./places";

/** Country first, then a city from that country. Renders two labelled selects (wrap them in a .row2). */
export function CityPicker({ city, onChange }: { city: string; onChange: (city: string) => void }) {
  const [country, setCountry] = useState(() => countryOf(city));
  return (
    <>
      <label>
        Country
        <select
          required
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            onChange(""); // the old city belongs to another country
          }}
        >
          <option value="" disabled>
            Choose a country
          </option>
          {COUNTRIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        City
        <select required disabled={!country} value={city} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>
            {country ? "Choose a city" : "Pick a country first"}
          </option>
          {(PLACES[country] ?? []).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
    </>
  );
}
