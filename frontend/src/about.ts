/* About-me profile: field definitions shared by the setup wizard, cards and profile sheet. */

export type About = {
  pronouns?: string; height_cm?: number; hometown?: string; job?: string; education?: string;
  languages?: string[]; marital?: string; children?: string; family_plans?: string; timeline?: string;
  relocate?: string; drinking?: string; smoking?: string; diet?: string; exercise?: string; sleep?: string;
  pets?: string; religion?: string; religion_importance?: string; love_languages?: string[];
  date_comfort?: string;
  prompts?: { id: string; answer: string }[]; dealbreakers?: string[];
};

type Opt = [value: string, label: string, icon?: string];
export const FIELDS: Record<string, { label: string; icon: string; options: Opt[]; multi?: number }> = {
  pronouns: { label: "Pronouns", icon: "🙂", options: [["she", "She/her"], ["he", "He/him"], ["they", "They/them"], ["prefer_not", "Prefer not to say"]] },
  education: { label: "Education", icon: "🎓", options: [["high_school", "High school"], ["diploma", "Diploma"], ["bachelors", "Bachelor's"], ["masters", "Master's"], ["doctorate", "Doctorate"], ["other", "Other"]] },
  languages: { label: "Languages I speak", icon: "🗣️", multi: 6, options: ["English", "Hindi", "Arabic", "Urdu", "Punjabi", "Tamil", "Telugu", "Malayalam", "Bengali", "Marathi", "Gujarati", "Kannada", "French", "Tagalog", "Other"].map((l) => [l, l] as Opt) },
  marital: { label: "Marital status", icon: "💍", options: [["never_married", "Never married"], ["divorced", "Divorced"], ["widowed", "Widowed"], ["separated", "Separated"]] },
  children: { label: "Children", icon: "🧸", options: [["none", "Don't have children"], ["have_kids", "Have children"]] },
  family_plans: { label: "Family plans", icon: "👶", options: [["want", "Want children", "👶"], ["open", "Open to children"], ["not_sure", "Not sure yet"], ["dont_want", "Don't want children"]] },
  timeline: { label: "When I'd like to settle down", icon: "⏳", options: [["within_year", "Within a year"], ["one_two_years", "In 1–2 years"], ["when_right", "When it feels right"]] },
  relocate: { label: "Open to moving cities?", icon: "🧳", options: [["yes", "Yes"], ["maybe", "Maybe"], ["no", "No, I'm staying"]] },
  drinking: { label: "Drinking", icon: "🍷", options: [["no", "Don't drink"], ["socially", "Socially"], ["yes", "Yes"]] },
  smoking: { label: "Smoking", icon: "🚬", options: [["no", "Don't smoke"], ["sometimes", "Sometimes"], ["yes", "Yes"]] },
  diet: { label: "Food", icon: "🍽️", options: [["vegetarian", "Vegetarian", "🥦"], ["eggetarian", "Eggetarian", "🥚"], ["vegan", "Vegan", "🌱"], ["jain", "Jain", "🌿"], ["non_veg", "Non-vegetarian", "🍗"], ["halal", "Halal", "🥘"], ["anything", "Eat anything", "🍜"]] },
  exercise: { label: "Exercise", icon: "🏃", options: [["often", "Often"], ["sometimes", "Sometimes"], ["rarely", "Rarely"]] },
  sleep: { label: "Body clock", icon: "🌙", options: [["early_bird", "Early bird", "🌅"], ["night_owl", "Night owl", "🦉"], ["flexible", "Flexible"]] },
  pets: { label: "Pets", icon: "🐾", options: [["have", "Have a pet"], ["love", "Love animals"], ["allergic", "Allergic"], ["no", "Not for me"]] },
  religion: { label: "Religion", icon: "🙏", options: [["hindu", "Hindu"], ["muslim", "Muslim"], ["christian", "Christian"], ["sikh", "Sikh"], ["jain", "Jain"], ["buddhist", "Buddhist"], ["jewish", "Jewish"], ["spiritual", "Spiritual"], ["not_religious", "Not religious"], ["other", "Other"], ["prefer_not", "Prefer not to say"]] },
  religion_importance: { label: "How important is faith to you?", icon: "✨", options: [["very", "Very"], ["somewhat", "Somewhat"], ["not", "Not very"]] },
  love_languages: { label: "I feel loved through (pick up to 2)", icon: "💞", multi: 2, options: [["words", "Kind words"], ["time", "Quality time"], ["gifts", "Thoughtful gifts"], ["acts", "Acts of help"], ["touch", "Physical closeness"]] },
};

/** Q05 first-scene choices. A skip stays unanswered; "flexible" is an explicit choice. */
export const SCENES: [id: string, label: string, icon: string][] = [
  ["quiet_cafe", "A quiet café", "☕"],
  ["park", "A walk in the park", "🌳"],
  ["bookshop", "A bookshop or gallery", "📖"],
  ["activity", "A fun activity", "🎯"],
  ["dinner", "Dinner somewhere comfortable", "🍽️"],
  ["flexible", "Surprise me - I am flexible", "✨"],
];

export const PROMPTS: Record<string, string> = {
  sunday: "My perfect Sunday looks like…",
  win: "The way to win me over is…",
  together: "We'll get along if…",
  family: "My family would describe me as…",
  argue: "After a disagreement, I…",
  learning: "Something I'm learning right now…",
  green: "A green flag I look for…",
  future: "In five years, I hope…",
  hours: "I could talk for hours about…",
};

export const DEALBREAKERS: [string, string][] = [
  ["smoking", "Doesn't smoke"],
  ["drinking", "Doesn't drink"],
  ["heavy_drinking", "Drinks only socially"],
  ["veg_partner", "Is vegetarian"],
  ["family_plans", "Agrees with me on having children"],
  ["diet", "Is vegetarian, if I am"],
  ["religion", "Shares my religion"],
];

export const label = (k: string, v?: string) => FIELDS[k]?.options.find((o) => o[0] === v)?.[1] ?? v ?? "";

export function heightLabel(cm?: number) {
  if (!cm) return "";
  const inches = Math.round(cm / 2.54);
  return `${cm} cm · ${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** Short chips for cards, most useful first. */
export function vitals(a: About = {}): { icon: string; text: string }[] {
  const out: { icon: string; text: string }[] = [];
  if (a.height_cm) out.push({ icon: "📏", text: heightLabel(a.height_cm).split(" · ")[1] });
  if (a.job) out.push({ icon: "💼", text: a.job.replace(/^an? /i, "") });
  if (a.family_plans) out.push({ icon: "👶", text: label("family_plans", a.family_plans) });
  if (a.diet) out.push({ icon: "🍽️", text: label("diet", a.diet) });
  if (a.drinking) out.push({ icon: "🍷", text: label("drinking", a.drinking) });
  if (a.religion && a.religion !== "prefer_not") out.push({ icon: "🙏", text: label("religion", a.religion) });
  if (a.timeline) out.push({ icon: "⏳", text: label("timeline", a.timeline) });
  return out;
}
