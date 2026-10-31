/* TypeScript port of backend/app/about.py: traits, must-haves and resonance signals. */
import type { About } from "./about";

const VEG = new Set(["vegetarian", "eggetarian", "vegan", "jain"]);
const LOVE: Record<string, string> = { words: "words of affirmation", time: "quality time", gifts: "thoughtful gifts", acts: "acts of service", touch: "physical closeness" };
export const PROMPT_CAT: Record<string, [string, string]> = {
  sunday: ["My perfect Sunday looks like…", "lifestyle"],
  win: ["The way to win me over is…", "values"],
  together: ["We'll get along if…", "values"],
  family: ["My family would describe me as…", "backstory"],
  argue: ["After a disagreement, I…", "communication"],
  learning: ["Something I'm learning right now…", "interests"],
  green: ["A green flag I look for…", "values"],
  future: ["In five years, I hope…", "future"],
  hours: ["I could talk for hours about…", "interests"],
};

export function aboutFacts(a: About): [string, string, string][] {
  const f: [string, string, string][] = [];
  const add = (k: string, c: string, s: string) => f.push([k, c, s]);
  const m = (k: keyof About, c: string, map: Record<string, string>) => {
    const v = a[k] as string | undefined;
    if (v && map[v]) add(k, c, map[v]);
  };
  m("diet", "lifestyle", { vegetarian: "I'm vegetarian.", eggetarian: "I'm vegetarian but eat eggs.", vegan: "I'm vegan.", jain: "I follow a Jain diet.", non_veg: "I eat meat and enjoy all kinds of food.", halal: "I eat halal.", anything: "I'll happily eat anything." });
  m("drinking", "lifestyle", { no: "I don't drink alcohol.", socially: "I drink socially.", yes: "I enjoy a drink." });
  m("smoking", "lifestyle", { no: "I don't smoke.", sometimes: "I smoke sometimes.", yes: "I smoke." });
  m("exercise", "lifestyle", { often: "I work out often; staying active matters to me.", sometimes: "I stay active now and then.", rarely: "I'm more of a relaxed, low-key person than a gym regular." });
  m("sleep", "lifestyle", { early_bird: "I'm an early bird.", night_owl: "I'm a night owl.", flexible: "My sleep schedule is flexible." });
  m("date_comfort", "lifestyle", {
    quiet_cafe: "I'd feel most like myself at a quiet café.",
    park: "I'd feel most like myself on a walk in the park.",
    bookshop: "I'd feel most like myself in a bookshop or gallery.",
    activity: "I'd feel most like myself doing a fun activity.",
    dinner: "I'd feel most like myself at a comfortable dinner.",
    flexible: "I'm flexible about where a first date happens.",
  });
  m("pets", "lifestyle", { have: "I have a pet at home.", love: "I love animals.", allergic: "I'm allergic to pets.", no: "Pets aren't really my thing." });
  m("family_plans", "future", { want: "I'd love to have children someday.", dont_want: "A family of two feels right to me.", open: "I'm open to having children.", not_sure: "I'm still deciding about starting a family." });
  m("timeline", "future", { within_year: "I'd like to settle down within a year.", one_two_years: "I'd like to settle down in the next one or two years.", when_right: "I'll settle down when it feels right, with no rush." });
  m("relocate", "future", { yes: "I'm open to moving cities for the right person.", maybe: "I might move cities for the right person.", no: "I'd like to stay in my city." });
  if (a.children === "have_kids") add("children", "backstory", "I'm a parent.");
  if (a.religion && a.religion !== "prefer_not") {
    const imp = ({ very: "very important to me", somewhat: "somewhat important to me", not: "not a big part of my daily life" } as Record<string, string>)[a.religion_importance ?? ""] ?? "part of who I am";
    add("religion", "values", a.religion === "spiritual" ? "I'm spiritual." : a.religion === "not_religious" ? "I'm not religious." : `Faith (${a.religion.replace("_", " ")}) is ${imp}.`);
  }
  if (a.love_languages?.length) add("love_languages", "communication", "I feel loved through " + a.love_languages.map((x) => LOVE[x]).join(" and ") + ".");
  if (a.languages?.length) add("languages", "backstory", "I speak " + a.languages.join(", ") + ".");
  if (a.job) add("job", "backstory", `I work as ${a.job}.`);
  for (const p of a.prompts ?? []) {
    const [q, cat] = PROMPT_CAT[p.id];
    add("prompt:" + p.id, cat, `${q.replace("…", "")}: ${p.answer}`);
  }
  return f;
}

export function violates(a: About, b: About) {
  for (const d of a.dealbreakers ?? []) {
    if (d === "heavy_drinking") { if (b.drinking === "yes") return true; continue; }
    if (d === "veg_partner") { if (b.diet && !VEG.has(b.diet)) return true; continue; }
    const mine = (a as any)[d], theirs = (b as any)[d];
    if (theirs == null) continue;
    if ((d === "smoking" || d === "drinking") && theirs !== "no") return true;
    if (d === "family_plans" && mine && new Set([mine, theirs]).size === 2 && [mine, theirs].includes("want") && [mine, theirs].includes("dont_want")) return true;
    if (d === "diet" && VEG.has(mine) && !VEG.has(theirs)) return true;
    if (d === "religion" && mine && mine !== "prefer_not" && theirs !== mine) return true;
  }
  return false;
}

export function signals(a: About, b: About, na: string, nb: string): [string, number, string | null, string][] {
  const out: [string, number, string | null, string][] = [];
  const both = (k: keyof About) => [a[k], b[k]] as [any, any];
  const [fa, fb] = both("family_plans");
  if (fa && fb) {
    if ([fa, fb].includes("want") && [fa, fb].includes("dont_want")) out.push(["future", -18, "explore", "You see children differently. That's worth an honest talk early."]);
    else if (fa === fb || [fa, fb].every((x) => x === "want" || x === "open")) out.push(["future", 8, "shared", "Aligned on family plans"]);
  }
  const [ta, tb] = both("timeline");
  if (ta && tb) {
    if (ta === tb) out.push(["future", 5, "shared", "Same pace for settling down"]);
    else if ([ta, tb].includes("within_year") && [ta, tb].includes("when_right")) out.push(["future", -6, "explore", `${na} wants to settle sooner than ${nb}. Talk about timing.`]);
  }
  const [da, db] = both("diet");
  if (da && db) out.push(VEG.has(da) === VEG.has(db) ? ["lifestyle", 4, "shared", "Similar food habits"] : ["lifestyle", -3, "explore", "Different diets: easy to plan around if you talk about it."]);
  for (const k of ["drinking", "smoking"] as const) {
    const [x, y] = both(k);
    if (x && y) {
      if (x === y) out.push(["lifestyle", 3, null, ""]);
      else if ([x, y].includes("no") && [x, y].includes("yes")) out.push(["lifestyle", -6, "explore", `You feel differently about ${k}.`]);
    }
  }
  const [sa, sb] = both("sleep");
  if (sa && sb && sa !== "flexible" && sb !== "flexible")
    out.push(sa === sb ? ["lifestyle", 4, "shared", "Same body clock"] : ["lifestyle", -4, "explore", "One early bird, one night owl: mornings might need a plan."]);
  const [ra, rb] = both("religion");
  if (ra && rb && ra !== "prefer_not" && rb !== "prefer_not") {
    if (ra === rb) out.push(["values", 6, "shared", ["not_religious", "spiritual"].includes(ra) ? "Similar outlook on faith" : "Shared faith"]);
    else if ([a.religion_importance, b.religion_importance].includes("very")) out.push(["values", -8, "explore", "Faith matters a lot to one of you and you differ. Talk openly about it."]);
  }
  const common = (a.love_languages ?? []).filter((x) => (b.love_languages ?? []).includes(x)).sort();
  if (common.length) out.push(["communication", 6, "shared", "Same love language: " + LOVE[common[0]]]);
  if (a.exercise && a.exercise === b.exercise) out.push(["lifestyle", 3, null, ""]);
  return out;
}

export function completion(a: About) {
  const keys: (keyof About)[] = ["pronouns", "height_cm", "job", "education", "languages", "family_plans", "timeline", "drinking", "smoking", "diet", "sleep", "religion", "love_languages"];
  const have = keys.filter((k) => {
    const v = a[k];
    return Array.isArray(v) ? v.length : !!v;
  }).length + 3 * (a.prompts?.length ?? 0);
  return Math.round((100 * have) / (keys.length + 9));
}
