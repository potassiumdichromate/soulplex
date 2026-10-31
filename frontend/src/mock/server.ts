/*
 * In-browser Soulplex backend for the static live demo.
 * Mirrors the FastAPI contract (same paths, shapes and consent rules) so the
 * real frontend runs unchanged. The worker is simulated with timestamps:
 * a scene is queued, then running, then completed, computed lazily on each call.
 * Fictional people also reply: after you accept, they decide based on resonance.
 */

type Id = string;
type User = {
  id: Id; email: string; password: string; name: string; age: number; city: string; gender: string;
  seeking: string[]; age_min: number; age_max: number; intent: string; contact: string; discovery: boolean;
  verified: boolean; email_verified: boolean; disabled: boolean; synthetic: boolean; role: string;
  memory_version: number; created: number; face: any; about: any; auto_accept?: boolean; public_dates?: boolean;
};
type Mem = {
  id: Id; user_id: Id; category: string; content: string; source_quote: string; source_id: string;
  status: string; visibility: string; version: number; updated: number;
};
type Msg = { id: Id; user_id: Id; role: string; content: string; created: number };
type Scene = {
  id: Id; a: Id; b: Id; venue: string; status: string; a_version: number; b_version: number;
  output: any; model: string; error: string; tokens: number; created: number; runAt: number; doneAt: number; waived_by?: string | null;
  /** a finished, reviewed date from the agent's history: it stays readable after profiles change */
  history?: boolean;
};
type Part = {
  scene_id: Id; user_id: Id; reviewed: boolean; contribution: string; decision: string; next_step: string;
  feedback: Record<string, unknown>; decideAt?: number;
};
type DB = {
  v: number; users: User[]; memories: Mem[]; messages: Msg[]; scenes: Scene[]; parts: Part[];
  blocks: { owner: Id; target: Id }[]; reports: { id: Id; owner: Id; target: Id; reason: string; status: string }[];
  session: Id | null; quotas: Record<string, number>;
};

import { DEMO_ABOUT } from "./demoAbout";
import { FULL_TYPES, B_LINES } from "./dateTypesFull";
import { aboutFacts, violates, signals, completion } from "../aboutLogic";

const KEY = "soulplex-live-demo-v8";
const STEP: Record<string, number> = { marriage: 0, relationship: 1, dating: 2 };
const INTENTS: Record<string, string> = { leila: "marriage", omar: "marriage", priya: "marriage", aditi: "marriage", karan: "marriage", daniel: "dating", sara: "dating" };

const now = () => Date.now() / 1000;
const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (status: number, msg = "Not found."): never => {
  throw new HttpError(status, msg);
};

/* ----------------------------- AI constants ----------------------------- */
const CATEGORIES = ["backstory", "values", "lifestyle", "communication", "future", "interests", "boundaries"];
const QUESTIONS: [string, string][] = [
  ["backstory", "What is a chapter in your life that shaped who you are? Share only what you feel comfortable sharing."],
  ["values", "What do you most appreciate in a relationship, and what does that look like in everyday life?"],
  ["lifestyle", "Walk me through an ordinary weekend you would enjoy."],
  ["communication", "When plans change or you disagree, how do you like to talk it through?"],
  ["future", "What would you like the next few years to look like? Include location or relationship intentions if relevant."],
  ["interests", "What do you love doing or learning about when nobody is making you do it?"],
  ["boundaries", "What should your representative know to respect your time, pace and boundaries?"],
];
const CONTACT = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|https?:\/\/|(?:\+?\d[\s().-]*){8,}/i;

/* ------------------------------ resonance ------------------------------ */
const DIMENSIONS = ["values", "lifestyle", "communication", "future", "interests"];
const THEMES: Record<string, Record<string, string>> = {
  values: { kind: "kindness", honest: "honesty", trust: "trust", curio: "curiosity", loyal: "loyalty", respect: "respect", family: "family", faith: "faith", generous: "generosity", patien: "patience", "time for people": "making time for people", community: "community", humou: "humour", humor: "humour" },
  lifestyle: { weekend: "slow weekends", lunch: "long meals", walk: "walks", cook: "cooking", recipe: "cooking", travel: "travel", quiet: "quiet time", coffee: "coffee", tea: "tea", gym: "fitness", run: "running", yoga: "yoga", morning: "mornings", spontan: "spontaneity", plan: "planning ahead", friends: "time with friends", outdoor: "the outdoors", garden: "gardens" },
  communication: { "honest communication": "honest communication", discuss: "talking things through", talk: "talking things through", calm: "staying calm", listen: "listening", direct: "directness", space: "giving space", disagree: "handling disagreement", differences: "handling differences", "check in": "checking in", text: "texting" },
  future: { commit: "commitment", marri: "marriage", kids: "children", children: "children", settle: "settling down", career: "career growth", "move to": "moving cities", moving: "moving cities", relocat: "moving cities", home: "building a home", years: "a long-term view", "build a home": "building a home", "build something": "building something together", "building something": "building something together" },
  interests: { book: "books", read: "reading", music: "music", photo: "photography", garden: "gardens", art: "art", film: "films", movie: "films", hik: "hiking", learn: "learning", cook: "cooking", recipe: "cooking", travel: "travel", dance: "dancing", sport: "sport", cricket: "cricket", football: "football", write: "writing", design: "design", tech: "technology" },
};
const CATEGORY_DIM: Record<string, string> = { values: "values", boundaries: "communication", communication: "communication", lifestyle: "lifestyle", future: "future", interests: "interests", backstory: "interests" };
const GROWTH: Record<string, string> = {
  values: "Your agent struggled to describe what you value in a partner. Add one trait about what matters most to you day to day.",
  lifestyle: "Your agent couldn't paint your ordinary week. Describe a weekend you'd love so it can plan better dates.",
  communication: "Your agent didn't know how you handle disagreement. That's one of the strongest signals for long-term fit, so add a line on it.",
  future: "Your agent couldn't speak about your next few years. Sharing your intentions (city, family, pace) saves both people time.",
  interests: "Your agent ran out of things you love doing. Add an interest or two so conversations have more to grow from.",
};
type Fact = { id: string; category: string; content: string };
type Actor = { id: string; name: string; facts: Fact[]; about?: any };

function themes(text: string, dim: string) {
  const low = text.toLowerCase();
  return new Set(Object.entries(THEMES[dim]).filter(([s]) => low.includes(s)).map(([, l]) => l));
}
function dimThemes(facts: Fact[]) {
  const out: Record<string, Set<string>> = {};
  DIMENSIONS.forEach((d) => (out[d] = new Set()));
  for (const f of facts) {
    for (const d of DIMENSIONS) themes(f.content, d).forEach((t) => out[d].add(t));
    const d = CATEGORY_DIM[f.category];
    if (d && !out[d].size) out[d].add("");
  }
  return out;
}
const short = (t: string, n = 110) => (t.length <= n ? t : t.slice(0, n - 1).replace(/\s\S*$/, "") + "…");
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function assess(a: Actor, b: Actor, dialogue: any[]) {
  const ta = dimThemes(a.facts), tb = dimThemes(b.facts);
  const dims: any[] = [], shared: string[] = [], explore: string[] = [];
  for (const d of DIMENSIONS) {
    const sa = new Set([...ta[d]].filter(Boolean)), sb = new Set([...tb[d]].filter(Boolean));
    const ka = ta[d].size > 0, kb = tb[d].size > 0;
    const common = [...sa].filter((x) => sb.has(x)).sort();
    if (!ka || !kb) {
      const who = !ka && !kb ? "either of you" : !ka ? a.name : b.name;
      dims.push({ name: d, score: 50, note: `Not enough shared by ${who} yet, so this is neutral.`, known: false });
      explore.push(`Ask each other about ${d}; neither agent could cover it fully.`);
      continue;
    }
    const union = new Set([...sa, ...sb]);
    const overlap = union.size ? common.length / union.size : 0;
    const score = Math.round(58 + 38 * overlap + Math.min(common.length, 3) * 2);
    let note: string;
    if (common.length) {
      note = "You both bring up " + common.slice(0, 3).join(", ") + ".";
      common.slice(0, 2).forEach((c) => shared.push(cap(c)));
    } else {
      const oa = [...sa].sort()[0] ?? "other things", ob = [...sb].sort()[0] ?? "other things";
      note = `Different emphasis: ${a.name} leans to ${oa}, ${b.name} to ${ob}. Could be complementary.`;
      explore.push(`${cap(d)}: how would ${oa} and ${ob} fit together?`);
    }
    dims.push({ name: d, score: Math.min(score, 97), note, known: true });
  }
  const persp = (me: Actor, other: Actor, mine: Record<string, Set<string>>) => {
    const spoken = dialogue.filter((l) => l.speaker_id === me.id);
    const missing = DIMENSIONS.filter((d) => !mine[d].size);
    const cats: Record<string, number> = {};
    me.facts.forEach((f) => (cats[f.category] = (cats[f.category] ?? 0) + 1));
    const noticed: string[] = [];
    const top = Object.keys(cats).sort((x, y) => cats[y] - cats[x])[0];
    if (top) noticed.push(`Your agent leaned on your ${top} the most in this conversation.`);
    if (spoken.length) noticed.push(`It spoke ${spoken.length} times and shared ${new Set(spoken.flatMap((l) => l.fact_ids)).size} of your traits.`);
    let growth: string;
    if (missing.length) growth = GROWTH[missing[0]];
    else {
      const known = dims.filter((x) => x.known).sort((x, y) => x.score - y.score)[0];
      growth = known
        ? `Your profile covers every dimension. On a real date, try asking about ${known.name}; it's where you two differ the most.`
        : "Keep adding traits as you learn more about yourself.";
    }
    return { learned_about_partner: other.facts.slice(0, 3).map((f) => short(f.content)), noticed_about_you: noticed, growth };
  };
  // structured About-me signals (family plans, diet, faith…)
  const by: Record<string, any> = Object.fromEntries(dims.map((d) => [d.name, d]));
  const structured: string[] = [];
  for (const [dim, delta, kind, text] of signals(a.about ?? {}, b.about ?? {}, a.name, b.name)) {
    const d = by[dim];
    if (!d.known) {
      d.known = true;
      d.score = 60;
      d.note = text || d.note;
      const i = explore.findIndex((x) => x.startsWith(`Ask each other about ${dim}`));
      if (i >= 0) explore.splice(i, 1);
    }
    d.score = Math.max(5, Math.min(97, d.score + delta));
    if (kind === "shared") {
      structured.push(text);
      if (delta > 0 && !d.note.includes("You both")) d.note = d.note.replace(/\.$/, "") + `. ${text}.`;
    }
    if (kind === "explore") {
      explore.unshift(text);
      d.note = text;
    }
  }
  shared.unshift(...structured);
  const known = dims.filter((d) => d.known).map((d) => d.score);
  const base = known.length ? known.reduce((s, x) => s + x, 0) / known.length : 50;
  const coverage = known.length / DIMENSIONS.length;
  return {
    dimensions: dims,
    shared: [...new Set(shared)].slice(0, 5),
    explore: [...new Set(explore)].slice(0, 4),
    perspectives: { [a.id]: persp(a, b, ta), [b.id]: persp(b, a, tb) },
    score: Math.max(0, Math.min(100, Math.round(base * coverage + 50 * (1 - coverage)))),
    confidence: coverage >= 0.8 ? "high" : coverage >= 0.5 ? "medium" : "low",
    method: "keyword-demo",
  };
}

/* ------------------------------- dialogue ------------------------------- */
const DQ: Record<string, string> = {
  values: "What does {n} need most from a partner?",
  lifestyle: "What does a good weekend look like for {n}?",
  communication: "How does {n} like to handle a disagreement?",
  future: "Where does {n} see the next few years going?",
  interests: "What could {n} talk about for hours?",
  backstory: "What chapter shaped {n} the most?",
  boundaries: "What pace feels right for {n}?",
};
const resolveType = (t: string) => (FULL_TYPES[t] ? t : "cafe");
function pickType(themes: string[], seed: string) {
  let best = "", score = 0;
  for (const [id, t] of Object.entries(FULL_TYPES)) {
    const n = themes.filter((x) => t.themes.includes(x)).length;
    if (n > score) [best, score] = [id, n];
  }
  if (best) return best;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const ids = Object.keys(FULL_TYPES);
  return ids[h % ids.length];
}
function runDialogue(venue: string, a: Actor, b: Actor) {
  const spec = FULL_TYPES[resolveType(venue)];
  const lines = [];
  for (let i = 0; i < 8; i++) {
    const actor = i % 2 === 0 ? a : b, other = actor === a ? b : a;
    const fact = actor.facts[Math.floor(i / 2) % actor.facts.length];
    const ask = other.facts[Math.floor((i + 1) / 2) % other.facts.length];
    const stage = spec.stages[Math.floor(i / 2)];
    const q = `“${fact.content.replace(/\.$/, "")}.”`;
    const question = (DQ[ask.category] ?? "What matters most to {n}?").replace("{n}", other.name);
    const tpl: string = i % 2 === 0 ? stage.a : B_LINES[Math.floor(i / 2)];
    const text = tpl.replaceAll("{me}", actor.name).replaceAll("{other}", other.name).replaceAll("{q}", q).replaceAll("{ask}", question).replace(/\s+/g, " ").trim();
    lines.push({ speaker_id: actor.id, speaker: actor.name + "’s representative", text, fact_ids: [fact.id], stage: Math.floor(i / 2), mood: stage.mood });
  }
  return {
    dialogue: lines,
    question: spec.human,
    summary: "These are possibilities to discuss. Only you can decide whether the real interaction feels right.",
    evidence: [a, b].flatMap((p) => p.facts.map((f) => ({ id: f.id, owner_id: p.id, content: f.content }))),
  };
}

/* --------------------------------- seed --------------------------------- */
const W = ["man"], M = ["woman"];
const PEOPLE: [string, string, number, string, string, string[], [string, string][]][] = [
  ["maya", "Maya", 29, "Dubai", "woman", W, [["interests", "I like quiet bookshops and long lunches."], ["values", "I value kindness and honest communication."], ["backstory", "I moved to Dubai for work and enjoy building a community here."], ["communication", "When we disagree I prefer to talk it through calmly the same day."], ["lifestyle", "My ideal weekend is a slow morning, a walk by the water and cooking for friends."]]],
  ["arjun", "Arjun", 31, "Dubai", "man", M, [["interests", "I enjoy photography, neighbourhood walks and coffee."], ["lifestyle", "I like a thoughtful plan with room for a spontaneous detour."], ["values", "I value curiosity and making time for people."], ["future", "In a few years I want to settle in Dubai and build a home with someone."], ["communication", "I need a little space to think before I talk through a disagreement."]]],
  ["priya", "Priya", 28, "Delhi NCR", "woman", W, [["interests", "I enjoy live music and cooking with friends."], ["communication", "I prefer to discuss differences calmly."], ["future", "Family matters a lot to me and I see marriage in the next few years."]]],
  ["rohan", "Rohan", 30, "Delhi NCR", "man", M, [["interests", "I enjoy gardens and trying new recipes."], ["future", "I am looking for a committed relationship."], ["values", "Honesty and patience are what I bring and hope to find."]]],
  ["operator", "Pilot operator", 35, "Dubai", "nonbinary", ["nonbinary"], []],
  ["karan", "Karan", 33, "Dubai", "man", M, [["interests", "I read a book a week and run a small book club."], ["values", "Kindness and honesty matter more to me than grand gestures."], ["lifestyle", "Weekends are for long lunches, a walk and an early night."], ["communication", "I like to talk things through calmly instead of letting things build up."], ["future", "I want a committed relationship and eventually a home full of books."]]],
  ["omar", "Omar", 30, "Dubai", "man", M, [["interests", "I play football twice a week and love travel photography."], ["lifestyle", "I'm an early riser: gym, coffee, then work."], ["values", "Family and loyalty come first for me."], ["communication", "I'm direct: I'd rather say what I feel than guess."]]],
  ["daniel", "Daniel", 34, "Dubai", "man", M, [["interests", "I design furniture and spend Saturdays at art galleries."], ["lifestyle", "I love cooking elaborate dinners for friends."], ["future", "I might relocate in a few years, so I'm open about that early."]]],
  ["vikram", "Vikram", 32, "Dubai", "man", M, [["interests", "Cricket on weekends, learning the guitar on weeknights."], ["values", "I value humour and patience in tough moments."], ["communication", "I check in often by text; small messages matter to me."], ["lifestyle", "I enjoy quiet coffee mornings and walks by the water."]]],
  ["sara", "Sara", 27, "Dubai", "woman", W, [["interests", "I paint, hike in the mountains and collect old film cameras."], ["values", "Curiosity and generosity are what I admire most."], ["lifestyle", "My weekends are spontaneous: a road trip or a new cafe."], ["future", "I see myself building something together, maybe a small studio."]]],
  ["leila", "Leila", 30, "Dubai", "woman", W, [["interests", "I love books, especially poetry, and Sunday farmers markets."], ["communication", "I need space to process before discussing a disagreement."], ["values", "Respect and making time for people are my non-negotiables."], ["future", "Marriage and children are part of my plan in the next few years."]]],
  ["ananya", "Ananya", 29, "Dubai", "woman", W, [["interests", "I do photography and yoga, and I'm learning to cook Thai food."], ["lifestyle", "A good weekend has a long walk, coffee and time with friends."], ["values", "Honesty and curiosity about the world."], ["communication", "Let's talk it through calmly; I'm a listener first."], ["future", "I'm ready for commitment and want to settle in Dubai."]]],
  ["noor", "Noor", 31, "Dubai", "woman", W, [["interests", "Tech meetups, sci-fi films and weekend tennis."], ["lifestyle", "I plan my weeks carefully but love one spontaneous evening."], ["communication", "I'm direct and appreciate the same."]]],
  ["aditi", "Aditi", 27, "Delhi NCR", "woman", W, [["interests", "Classical dance, books and long drives."], ["values", "Kindness and family keep me grounded."], ["future", "I want a committed partner who wants marriage too."]]],
  ["meera", "Meera", 30, "Delhi NCR", "woman", W, [["interests", "I teach yoga and spend Sundays at the flower market."], ["values", "Kindness and patience matter most to me."], ["communication", "I like to talk things through calmly over chai."]]],
  ["ishaan", "Ishaan", 29, "Delhi NCR", "man", M, [["interests", "I play guitar and I'm learning to cook my grandmother's recipes."], ["lifestyle", "My weekends are long walks, old bookshops and family lunches."], ["values", "Honesty and making time for family are everything to me."]]],
  ["zara", "Zara", 26, "Dubai", "woman", W, [["interests", "I swim at sunrise and read too many mystery novels."], ["lifestyle", "I love planning small adventures: a new cafe, a desert drive."], ["communication", "I'm direct but kind, and I listen before I answer."]]],
  ["rahul", "Rahul", 35, "Dubai", "man", M, [["interests", "I cook on weekends and I'm slowly learning photography."], ["values", "Kindness, loyalty and a good sense of humour."], ["future", "I'm ready for commitment and would love to build a home together."]]],
  ["kabir", "Kabir", 31, "Delhi NCR", "man", M, [["interests", "Music festivals, cooking and cricket."], ["communication", "I like to discuss things calmly and listen first."], ["lifestyle", "Weekends with friends, Sunday mornings slow."]]],
];

/** Fictional members who appear as the Soulplex cast (character-sheet art). */
const CAST_FACES: Record<string, string> = {
  maya: "creamsuit", sara: "pinkbomber", leila: "lavender", zara: "sheerlilac",
  arjun: "midnight", karan: "lilachoodie", omar: "tealvarsity", vikram: "blackbomber",
};

const FACES: Record<string, Record<string, number>> = {
  maya: { skin: 2, hair: 1, hairColor: 1, eyes: 1, brows: 0, mouth: 0, facial: 0, accessory: 3, outfit: 0 },
  arjun: { skin: 3, hair: 0, hairColor: 0, eyes: 0, brows: 1, mouth: 1, facial: 1, accessory: 0, outfit: 3 },
  priya: { skin: 3, hair: 2, hairColor: 0, eyes: 1, brows: 0, mouth: 0, facial: 0, accessory: 2, outfit: 1 },
  rohan: { skin: 4, hair: 5, hairColor: 0, eyes: 0, brows: 1, mouth: 1, facial: 2, accessory: 0, outfit: 4 },
  operator: { skin: 1, hair: 4, hairColor: 2, eyes: 2, brows: 2, mouth: 0, facial: 0, accessory: 1, outfit: 5 },
  karan: { skin: 2, hair: 4, hairColor: 0, eyes: 2, brows: 1, mouth: 1, facial: 0, accessory: 1, outfit: 2 },
  omar: { skin: 3, hair: 5, hairColor: 0, eyes: 0, brows: 1, mouth: 1, facial: 1, accessory: 0, outfit: 5 },
  daniel: { skin: 0, hair: 6, hairColor: 4, eyes: 0, brows: 0, mouth: 0, facial: 2, accessory: 0, outfit: 1 },
  vikram: { skin: 4, hair: 7, hairColor: 0, eyes: 1, brows: 1, mouth: 1, facial: 1, accessory: 0, outfit: 2 },
  sara: { skin: 1, hair: 3, hairColor: 3, eyes: 1, brows: 0, mouth: 0, facial: 0, accessory: 3, outfit: 1 },
  leila: { skin: 2, hair: 8, hairColor: 0, eyes: 1, brows: 0, mouth: 0, facial: 0, accessory: 0, outfit: 3 },
  ananya: { skin: 4, hair: 2, hairColor: 1, eyes: 2, brows: 0, mouth: 0, facial: 0, accessory: 2, outfit: 4 },
  noor: { skin: 2, hair: 1, hairColor: 0, eyes: 1, brows: 2, mouth: 2, facial: 0, accessory: 1, outfit: 0 },
  aditi: { skin: 3, hair: 3, hairColor: 0, eyes: 1, brows: 0, mouth: 0, facial: 0, accessory: 2, outfit: 2 },
  meera: { skin: 3, hair: 2, hairColor: 1, eyes: 2, brows: 0, mouth: 0, facial: 0, accessory: 2, outfit: 3 },
  ishaan: { skin: 3, hair: 4, hairColor: 1, eyes: 0, brows: 1, mouth: 1, facial: 2, accessory: 1, outfit: 1 },
  zara: { skin: 2, hair: 3, hairColor: 2, eyes: 1, brows: 0, mouth: 1, facial: 0, accessory: 3, outfit: 4 },
  rahul: { skin: 3, hair: 0, hairColor: 0, eyes: 2, brows: 1, mouth: 0, facial: 1, accessory: 0, outfit: 5 },
  kabir: { skin: 4, hair: 0, hairColor: 0, eyes: 0, brows: 1, mouth: 1, facial: 1, accessory: 0, outfit: 0 },
};
const FACE_OPTS: Record<string, number> = { skin: 6, hair: 9, hairColor: 7, eyes: 3, brows: 3, mouth: 3, facial: 3, accessory: 5, outfit: 6 };
const IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function faceView(face: any, owner = false, revealed = false) {
  if (!face?.kind) return {};
  if (face.kind === "photo") {
    if (owner) return { ...face };
    const open = face.reveal === "everyone" || revealed;
    return { kind: "photo", image: open ? face.photo : face.public, locked: !open };
  }
  if (face.kind === "cast") return { kind: "cast", id: face.id };
  return { kind: "illustrated", spec: face.spec ?? {} };
}

function cleanAbout(b: any) {
  const out: any = {};
  for (const [k, v] of Object.entries(b ?? {})) {
    if (v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (k === "height_cm" && (typeof v !== "number" || v < 120 || v > 220)) fail(422, "Height should be between 120 and 220 cm.");
    if ((k === "job" && String(v).length > 60) || (k === "hometown" && String(v).length > 40)) fail(422, `Keep ${k} shorter.`);
    if (k === "prompts") {
      if (!Array.isArray(v) || v.length > 3) fail(422, "Answer up to three prompts.");
      for (const p of v as any[]) if (!p.answer || p.answer.trim().length < 2 || p.answer.length > 300) fail(422, "Each prompt answer should be 2–300 characters.");
      out.prompts = (v as any[]).map((p) => ({ id: p.id, answer: p.answer.trim() }));
      continue;
    }
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  if (out.love_languages) out.love_languages = out.love_languages.slice(0, 2);
  return out;
}

function seed(): DB {
  const db: DB = { v: 7, users: [], memories: [], messages: [], scenes: [], parts: [], blocks: [], reports: [], session: null, quotas: {} };
  let t = now() - 86400 * 30;
  for (const [key, name, age, city, gender, seeking, facts] of PEOPLE) {
    const u: User = {
      id: key + "-" + uid().slice(0, 6), email: key + "@demo.soulplex.local", password: "", name, age, city, gender, seeking,
      age_min: Math.max(21, age - 8), age_max: age + 9, intent: INTENTS[key] ?? "relationship", contact: key + "@example.invalid", discovery: key !== "operator",
      verified: true, email_verified: true, disabled: false, synthetic: true, public_dates: key !== "operator", role: key === "operator" ? "admin" : "member",
      memory_version: 1, created: (t += 60), face: CAST_FACES[key] ? { kind: "cast", id: CAST_FACES[key] } : { kind: "illustrated", spec: FACES[key] ?? {} }, about: DEMO_ABOUT[key] ?? {},
    };
    db.users.push(u);
    for (const [category, content] of facts) {
      db.memories.push({ id: uid(), user_id: u.id, category, content, source_quote: content, source_id: "owner-written", status: "approved", visibility: "shareable", version: 1, updated: t });
    }
    for (const [k, category, content] of aboutFacts(u.about))
      db.memories.push({ id: uid(), user_id: u.id, category, content, source_quote: content, source_id: "about:" + k, status: "approved", visibility: "shareable", version: 1, updated: t });
  }
  return db;
}

/* ------------------------------ persistence ------------------------------ */
let db: DB = load();
function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d.v === 7) return d;
    }
  } catch {
    /* storage unavailable: run in memory */
  }
  return seed();
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* ignore */
  }
}
export function resetDemo() {
  db = seed();
  save();
}

/* -------------------------------- domain -------------------------------- */
const hue = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
};
const user = (id: Id) => db.users.find((u) => u.id === id);
const memories = (uid_: Id, shareable = false) =>
  db.memories
    .filter((m) => m.user_id === uid_ && m.status === "approved" && (!shareable || m.visibility === "shareable"))
    .sort((x, y) => y.updated - x.updated);
const factData = (m: Mem) => ({ ...m });
const publicProfile = (u: User, revealed = false) => ({ face: faceView(u.face, false, revealed), about: (({ dealbreakers, ...rest }) => rest)(u.about ?? {}), id: u.id, hue: hue(u.id), name: u.name, age: u.age, city: u.city, intent: u.intent, synthetic: u.synthetic });
const ownProfile = (u: User) => ({
  ...publicProfile(u),
  face: faceView(u.face, true),
  about: { ...(u.about ?? {}) },
  about_complete: completion(u.about ?? {}),
  auto_accept: u.auto_accept !== false, public_dates: !!u.public_dates, email: u.email, gender: u.gender, seeking: u.seeking, age_min: u.age_min, age_max: u.age_max,
  contact: u.contact, discovery: u.discovery, verified: u.verified, email_verified: u.email_verified, role: u.role, memory_version: u.memory_version,
});
const blocked = (a: Id, b: Id) => db.blocks.some((x) => (x.owner === a && x.target === b) || (x.owner === b && x.target === a));
function baseOk(a?: User, b?: User) {
  return !!(a && b && a.id !== b.id && !a.disabled && !b.disabled && a.discovery && b.discovery && a.verified && b.verified &&
    a.age >= 18 && b.age >= 18 && a.city === b.city && Math.abs((STEP[a.intent] ?? 1) - (STEP[b.intent] ?? 1)) <= 1 &&
    a.seeking.includes(b.gender) && b.seeking.includes(a.gender) && !blocked(a.id, b.id));
}
const prefsOk = (a: User, b: User) => a.age_min <= b.age && b.age <= a.age_max && !violates(a.about ?? {}, b.about ?? {});
function eligible(a?: User, b?: User, waivedBy?: string | null) {
  return !!(baseOk(a, b) && (prefsOk(a!, b!) || a!.id === waivedBy) && (prefsOk(b!, a!) || b!.id === waivedBy));
}
const sceneOk = (s: Scene) => eligible(user(s.a), user(s.b), s.waived_by);
const MUST: Record<string, string> = { smoking: "doesn't smoke", drinking: "doesn't drink", family_plans: "agrees on children", diet: "is vegetarian", religion: "shares your religion" };
function outsideReasons(a: User, b: User) {
  const out: string[] = [];
  if (!(a.age_min <= b.age && b.age <= a.age_max)) out.push(`${b.age} is outside your ${a.age_min}–${a.age_max} age range`);
  for (const d of a.about?.dealbreakers ?? []) if (violates({ ...a.about, dealbreakers: [d] }, b.about ?? {})) out.push("Your must-have: " + MUST[d]);
  return out;
}
const rank = (m: Mem) => (m.source_id.startsWith("about:prompt") ? 0 : m.source_id.startsWith("about:") ? 2 : 1);
const actor = (u: User): Actor => ({
  id: u.id, name: u.name, about: u.about ?? {},
  facts: [...memories(u.id, true)].sort((x, y) => rank(x) - rank(y)).slice(0, 16).map((m) => ({ id: m.id, content: m.content, category: m.category })),
});
const stale = (s: Scene, a: User, b: User) => !s.history && (s.a_version !== a.memory_version || s.b_version !== b.memory_version);
const bump = (u: User) => (u.memory_version += 1);
function quota(key: string, limit: number) {
  const k = key + ":" + Math.floor(now() / 86400);
  db.quotas[k] = (db.quotas[k] ?? 0) + 1;
  if (db.quotas[k] > limit) fail(429, "Daily pilot limit reached. Please try tomorrow.");
}
const contactIn = (t: string) => CONTACT.test(t);

/** Maya's agent has been on a few dates already: what it learned there carries into every new one. */
const HISTORY: [string, string, number, string, string, string][] = [
  ["omar", "walk", 26, "pass", "pass", "Thank you, this was kind. We want different paces of life, so I'll pass."],
  ["vikram", "garden", 19, "pass", "accept", "He was lovely, but our plans for the next few years don't line up."],
  ["daniel", "gallery", 12, "accept", "pass", "I'd like to meet. Maybe a gallery morning, then coffee?"],
  ["karan", "bookshop", 5, "accept", "accept", "Yes! Let's swap favourite books over a slow coffee."],
];
function ensureHistory() {
  const d = db as DB & { hist?: number };
  if (d.hist) return;
  d.hist = 1;
  const maya = db.users.find((u) => u.email.startsWith("maya@"));
  if (!maya) return;
  for (const [key, venue, daysAgo, mine, theirs, words] of HISTORY) {
    const p = db.users.find((u) => u.email.startsWith(key + "@"));
    if (!p) continue;
    const t = now() - daysAgo * 86400;
    const aa = actor(maya), bb = actor(p);
    const out: any = runDialogue(venue, aa, bb);
    out.assessment = assess(aa, bb, out.dialogue);
    const sc: Scene = {
      id: uid(), a: p.id, b: maya.id, venue, status: "completed", a_version: p.memory_version, b_version: maya.memory_version,
      output: out, model: "deterministic-demo", error: "", tokens: 0, created: t, runAt: t, doneAt: t, waived_by: null, history: true,
    };
    db.scenes.push(sc);
    db.parts.push({ scene_id: sc.id, user_id: maya.id, reviewed: true, contribution: words, decision: mine, next_step: "public_cafe", feedback: {} });
    db.parts.push({
      scene_id: sc.id, user_id: p.id, reviewed: true, decision: theirs, next_step: "public_cafe", feedback: {},
      contribution: theirs === "accept" ? "I enjoyed this a lot. I'd love to meet in person." : "Thank you, this was kind. I don't think we're the right fit.",
    });
  }
}

/** Simulated worker + simulated partners. Runs lazily on every request. */
function tick() {
  ensureHistory();
  const t = now();
  for (const s of db.scenes) {
    if (s.status === "queued" && t >= s.runAt) s.status = "running";
    if (s.status === "running" && t >= s.doneAt) {
      const a = user(s.a)!, b = user(s.b)!;
      if (!sceneOk(s) || stale(s, a, b)) {
        s.status = "failed";
        s.error = "Profiles changed. Start a fresh experience.";
        continue;
      }
      const aa = actor(a), bb = actor(b);
      const out: any = runDialogue(s.venue, aa, bb);
      out.assessment = assess(aa, bb, out.dialogue);
      s.output = out;
      s.status = "completed";
      s.model = "deterministic-demo";
    }
  }
  for (const p of db.parts) {
    if (p.decideAt && t >= p.decideAt && p.decision === "pending") {
      const s = db.scenes.find((x) => x.id === p.scene_id);
      const score = s?.output?.assessment?.score ?? 50;
      const me = user(p.user_id)!;
      const facts = memories(me.id, true);
      p.reviewed = true;
      p.decision = score >= 58 ? "accept" : "pass";
      p.contribution =
        p.decision === "accept"
          ? `I enjoyed reading this. ${facts[0] ? facts[0].content : ""} Maybe ${s?.venue === "bookshop" ? "we swap favourite books" : s?.venue === "garden" ? "an indoor plan if it rains" : "a slow coffee"} to start?`.trim()
          : "Thank you, this was kind. I don't think we're the right fit, but I wish you the best.";
      p.next_step = "public_cafe";
      p.decideAt = undefined;
    }
  }
}

function sceneData(s: Scene, me: User) {
  const a = user(s.a)!, b = user(s.b)!;
  const changed = stale(s, a, b);
  const parts = db.parts.filter((p) => p.scene_id === s.id);
  const mine = parts.find((p) => p.user_id === me.id)!;
  const other = parts.find((p) => p.user_id !== me.id)!;
  const mutual = !changed && s.status === "completed" && parts.every((p) => p.reviewed && p.contribution && p.decision === "accept");
  const partner = me.id === a.id ? b : a;
  let output = changed ? {} : { ...(s.output ?? {}) };
  if (output.assessment) {
    const { perspectives, ...rest } = output.assessment;
    output = { ...output, assessment: { ...rest, perspective: perspectives?.[me.id] ?? null } };
  }
  return {
    id: s.id, venue: s.venue, spot: spotFor(s.venue, s.id), status: s.status, stale: changed, partner: publicProfile(partner, mutual), incoming: s.a !== me.id, waived: !!s.waived_by, output, model: s.model,
    error: s.error, tokens: 0, created: s.created,
    mine: { reviewed: mine.reviewed, contribution: mine.contribution, decision: mine.decision, next_step: mine.next_step, feedback: mine.feedback },
    other: { contribution: !changed && mine.contribution ? other.contribution : "", decision: other.decision, next_step: mutual ? other.next_step : "" },
    mutual, contact: mutual ? partner.contact : null,
  };
}

function me(): User {
  const u = db.session ? user(db.session) : undefined;
  if (!u) fail(401, "Please sign in.");
  return u!;
}
function blocker(u: User) {
  if (!u.discovery || !u.verified) return "Complete your profile and turn on discovery in Settings.";
  if (!memories(u.id, true).length) return "Approve at least one shareable memory first.";
  return "";
}
function* partners(u: User) {
  for (const p of [...db.users].sort((x, y) => x.created - y.created)) {
    if (p.city === u.city && p.discovery && p.verified && !p.disabled && p.id !== u.id && eligible(u, p)) {
      const f = memories(p.id, true);
      if (f.length) yield [p, f] as const;
    }
  }
}
function previewCommon(own: Mem[], facts: Mem[], limit = 3) {
  const ta = dimThemes(own.map(factData)), tb = dimThemes(facts.map(factData));
  return [...new Set(DIMENSIONS.flatMap((d) => [...ta[d]].filter((t) => t && tb[d].has(t))))].sort().slice(0, limit);
}
function chooseType(u: User, p: User | undefined, venue: string) {
  if (FULL_TYPES[venue]) return venue;
  if (venue && venue !== "auto") fail(422, "Unknown date type.");
  const themes = p ? previewCommon(memories(u.id, true), memories(p.id, true), 20) : [];
  return pickType(themes, u.id + (p?.id ?? "") + u.memory_version);
}
function queueScene(u: User, p: User | undefined, venueIn: string, waive = false) {
  const venue = chooseType(u, p, venueIn);
  const waivedBy = waive && p && !prefsOk(u, p) ? u.id : null;
  if (!eligible(u, p, waivedBy)) fail(409, "Both people must be eligible, verified and opted in.");
  if (!memories(u.id, true).length || !memories(p!.id, true).length) fail(409, "Both representatives need approved shareable memories.");
  const existing = db.scenes.find(
    (s) => s.status !== "failed" && s.venue === venue && ((s.a === u.id && s.b === p!.id && s.a_version === u.memory_version && s.b_version === p!.memory_version) || (s.b === u.id && s.a === p!.id && s.b_version === u.memory_version && s.a_version === p!.memory_version)),
  );
  if (existing) return [existing.id, false] as const;
  quota("scene:" + u.id, 25);
  const t = now();
  const n = db.scenes.filter((s) => s.status === "queued" || s.status === "running").length;
  const s: Scene = {
    id: uid(), a: u.id, b: p!.id, venue, status: p!.auto_accept === false ? "invited" : "queued", a_version: u.memory_version, b_version: p!.memory_version,
    output: {}, model: "", error: "", tokens: 0, created: t, runAt: t + 2.2 + n * 1.2, doneAt: t + 7 + n * 2.5, waived_by: waivedBy,
  };
  db.scenes.push(s);
  for (const id of [u.id, p!.id]) db.parts.push({ scene_id: s.id, user_id: id, reviewed: false, contribution: "", decision: "pending", next_step: "video", feedback: {} });
  return [s.id, true] as const;
}
function getScene(sid: Id, u: User) {
  const s = db.scenes.find((x) => x.id === sid);
  if (!s || (s.a !== u.id && s.b !== u.id)) fail(404, "Experience not found.");
  if (!sceneOk(s!)) fail(404, "This introduction is no longer available.");
  return s!;
}

function insights(u: User) {
  const approved = memories(u.id);
  const coverage: Record<string, number> = {};
  CATEGORIES.forEach((c) => (coverage[c] = approved.filter((m) => m.category === c).length));
  const knowledge = Math.round(100 * (0.6 * CATEGORIES.filter((c) => coverage[c]).length / CATEGORIES.length + 0.4 * Math.min(approved.length, 14) / 14));
  const dates: any[] = [], dims: Record<string, number[]> = {}, shared: Record<string, number> = {}, venues: Record<string, number[]> = {};
  let explore: string[] = [], growth: string[] = [], learned: any[] = [], accepted = 0, mutual = 0;
  for (const s of db.scenes.filter((x) => (x.a === u.id || x.b === u.id) && x.status === "completed").sort((x, y) => y.created - x.created)) {
    if (!sceneOk(s)) continue;
    const d = sceneData(s, u);
    if (d.mine.decision === "accept") accepted++;
    if (d.mutual) mutual++;
    const asm = s.output?.assessment;
    if (!asm) continue;
    const p = asm.perspectives?.[u.id] ?? {};
    dates.push({ id: s.id, partner: d.partner.name, hue: d.partner.hue, face: d.partner.face, partner_id: d.partner.id, venue: s.venue, score: asm.score, created: s.created, stale: d.stale });
    (venues[s.venue] ??= []).push(asm.score);
    for (const x of asm.dimensions) if (x.known) (dims[x.name] ??= []).push(x.score);
    for (const t of asm.shared) shared[t] = (shared[t] ?? 0) + 1;
    explore = explore.concat(asm.explore);
    if (p.growth) growth.push(p.growth);
    for (const x of (p.learned_about_partner ?? []).slice(0, 2)) learned.push({ partner: d.partner.name, text: x });
  }
  const avg: Record<string, number> = {};
  for (const [k, v] of Object.entries(dims)) avg[k] = Math.round(v.reduce((s, x) => s + x, 0) / v.length);
  const missing = DIMENSIONS.filter((d) => !(d in avg) && !Object.entries(CATEGORY_DIM).some(([c, dd]) => dd === d && coverage[c]));
  const fbs = db.parts.filter((p) => p.user_id === u.id && Object.keys(p.feedback).length).map((p) => p.feedback);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  return {
    knowledge, coverage, traits: { approved: approved.length, shareable: approved.filter((m) => m.visibility === "shareable").length },
    dates, average: dates.length ? Math.round(mean(dates.map((d) => d.score))) : null, dimensions: avg,
    strengths: Object.keys(avg).sort((x, y) => avg[y] - avg[x]).slice(0, 2),
    shared_themes: Object.entries(shared).sort((x, y) => y[1] - x[1]).slice(0, 6),
    explore: [...new Set(explore)].slice(0, 4), growth: [...new Set([...missing.map((d) => GROWTH[d]), ...growth])].slice(0, 4),
    learned: learned.slice(0, 8),
    best_venue: Object.keys(venues).sort((x, y) => mean(venues[y]) - mean(venues[x]))[0] ?? null,
    funnel: { dates: dates.length, accepted, mutual },
    feedback: { responses: fbs.length, represented_accurately: fbs.filter((f) => f.represented_accurately).length },
  };
}

function search(u: User, q: URLSearchParams) {
  const bl = blocker(u);
  if (bl) return { matches: [], outside: [], hidden: 0, blocked: true, reason: bl };
  const own = memories(u.id, true);
  const text = (q.get("q") ?? "").trim().toLowerCase();
  const amin = +(q.get("age_min") || 18), amax = +(q.get("age_max") || 100);
  const VEG = ["vegetarian", "eggetarian", "vegan", "jain"];
  const matches: any[] = [], outside: any[] = [];
  let hidden = 0;
  for (const p of [...db.users].sort((x, y) => x.created - y.created)) {
    if (p.id === u.id || p.city !== u.city || !p.discovery || !p.verified || p.disabled) continue;
    if (!baseOk(u, p) || !prefsOk(p, u)) {
      hidden++;
      continue;
    }
    const facts = memories(p.id, true);
    if (!facts.length) continue;
    const ab = p.about ?? {};
    const hay = [p.name, ab.job ?? "", ab.hometown ?? "", ...(ab.prompts ?? []).map((x: any) => x.answer), ...facts.map((f) => f.content)].join(" ").toLowerCase();
    if (text && !hay.includes(text)) continue;
    if (p.age < amin || p.age > amax) continue;
    if (q.get("intent") && p.intent !== q.get("intent")) continue;
    if (q.get("diet") === "veg" && !VEG.includes(ab.diet)) continue;
    if (q.get("family_plans") && ab.family_plans !== q.get("family_plans")) continue;
    if (q.get("religion") && ab.religion !== q.get("religion")) continue;
    const common = previewCommon(own, facts);
    const card = { ...publicProfile(p), preview: facts.slice(0, 2).map((f) => f.content), traits: facts.length, common, reason: "" };
    const why = outsideReasons(u, p);
    (why.length ? outside : matches).push(why.length ? { ...card, outside: why } : card);
  }
  return { matches: matches.slice(0, 30), outside: outside.slice(0, 30), hidden, blocked: false, reason: "" };
}

function listDates(u: User, q: URLSearchParams) {
  const status = q.get("status") ?? "", type = q.get("type") ?? "", text = (q.get("q") ?? "").toLowerCase();
  const offset = +(q.get("offset") || 0), limit = Math.min(100, +(q.get("limit") || 30));
  let rows = db.scenes
    .filter((s) => (s.a === u.id || s.b === u.id) && sceneOk(s) && (!type || s.venue === type))
    .filter((s) => !["queued", "running", "completed", "failed", "invited", "declined"].includes(status) || s.status === status)
    .sort((x, y) => y.created - x.created)
    .map((s) => sceneData(s, u))
    .filter((d) => !text || d.partner.name.toLowerCase().includes(text))
    .filter((d) => status !== "waiting" || (d.status === "completed" && !d.stale && d.mine.decision === "pending"))
    .filter((d) => status !== "mutual" || d.mutual);
  if (q.get("sort") === "score") rows = rows.sort((x, y) => (y.output.assessment?.score ?? -1) - (x.output.assessment?.score ?? -1));
  const items = rows.slice(offset, offset + limit).map((d) => ({
    ...d,
    output: d.output.assessment ? { assessment: { score: d.output.assessment.score, confidence: d.output.assessment.confidence, shared: d.output.assessment.shared } } : {},
  }));
  return { items, total: rows.length, offset, limit };
}

/** Island-wide activity. The demo adds a clearly labelled simulated city on top of real demo data. */
const SIM_NAMES = [
  "Aanya", "Kabir", "Zara", "Vihaan", "Meera", "Omar", "Ishita", "Reyansh", "Layla", "Arnav", "Sana", "Dev",
  "Noor", "Aditya", "Kiara", "Yusuf", "Tara", "Rohan", "Amira", "Neel", "Riya", "Imran", "Diya", "Karan",
  "Hana", "Aarav", "Leela", "Samir", "Myra", "Farhan", "Anika", "Vikram", "Inaya", "Zayan", "Pooja", "Elias",
];
const hashStr = (x: string) => {
  let h = 2166136261;
  for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** A stable spot on the island for a date (each island has 2-3 spots). */
export const spotFor = (type: string, key: string) => hashStr(key) % (FULL_TYPES[resolveType(type)]?.spots?.length ?? 2);

/**
 * Who is on which island right now. Your own running dates are real; everyone else is a
 * deterministic, slowly changing simulation of a busy city (labelled "simulated" in the UI).
 */
const liveAgent = (u: User) =>
  u.discovery && !u.disabled ? { name: u.name.split(" ")[0], hue: hue(u.id), face: faceView(u.face) } : { name: "Private agent", hue: 260, face: null };

const watchable = (a?: User, b?: User) => !!(a && b && a.public_dates && b.public_dates && a.discovery && b.discovery && !a.disabled && !b.disabled);

function liveDates(me: User | null) {
  const t = now();
  const live: any[] = [];
  const taken = new Set<string>();
  const mine = db.scenes
    .filter((s) => s.status === "queued" || s.status === "running")
    .sort((x, y) => x.created - y.created);
  for (const s of mine) {
    const type = resolveType(s.venue);
    const n = FULL_TYPES[type].spots.length;
    const want = spotFor(type, s.id);
    let spot: number | null = null;
    for (let i = 0; i < n; i++) if (!taken.has(type + ":" + ((want + i) % n))) { spot = (want + i) % n; break; }
    if (spot !== null) taken.add(type + ":" + spot);
    const a = user(s.a)!, b = user(s.b)!;
    const began = s.runAt ?? s.created;
    live.push({
      id: s.id, type, spot, status: s.status, started: began, mine: !!me && (s.a === me.id || s.b === me.id), public: watchable(a, b),
      step: s.status === "running" ? Math.min(3, Math.floor((Math.max(0, t - began) / Math.max(1, s.doneAt - began)) * 4)) : 0,
      a: liveAgent(a),
      b: liveAgent(b),
    });
  }
  Object.keys(FULL_TYPES).forEach((type, k) => {
    FULL_TYPES[type].spots.forEach((_: string, j: number) => {
      if (taken.has(type + ":" + j)) return;
      const L = 150 + ((k * 7 + j * 13) % 5) * 15;
      const cycle = Math.floor((t + k * 17 + j * 29) / L);
      const began = cycle * L - k * 17 - j * 29;
      const h = hashStr(`${type}-${j}-${cycle}`);
      const elapsed = t - began;
      if (h % 10 < 3 || elapsed > L * 0.82) return; // this spot is free for now
      const [n1, n2] = simNames(h);
      live.push({
        id: `sim-${type}-${j}-${cycle}`, type, spot: j, status: "running", started: began, mine: false, public: true,
        step: Math.min(3, Math.floor(elapsed / ((L * 0.82) / 4))),
        a: { name: n1, hue: (h >>> 3) % 360, face: null },
        b: { name: n2, hue: (h >>> 11) % 360, face: null },
      });
    });
  });
  return live.sort((x, y) => Number(y.mine) - Number(x.mine) || x.started - y.started);
}

const simNames = (h: number) => {
  const n1 = SIM_NAMES[h % SIM_NAMES.length];
  const n2 = SIM_NAMES[(h >>> 8) % SIM_NAMES.length] === n1 ? SIM_NAMES[(h % SIM_NAMES.length + 7) % SIM_NAMES.length] : SIM_NAMES[(h >>> 8) % SIM_NAMES.length];
  return [n1, n2];
};

/** Fictional things simulated agents know about their (fictional) people. */
const SIM_FACTS: [string, string][] = [
  ["values", "Kindness matters more to me than being impressive"],
  ["values", "I keep my promises, even the small ones"],
  ["values", "Family dinners on Sunday are not negotiable"],
  ["lifestyle", "A perfect weekend is a long walk, then cooking for friends"],
  ["lifestyle", "I run most mornings, slowly and happily"],
  ["lifestyle", "I would choose a quiet bookshop over a loud party"],
  ["communication", "When we disagree, I'd rather talk it out the same day"],
  ["communication", "I say thank you a lot and I mean it"],
  ["communication", "I need a little quiet time before a big conversation"],
  ["future", "I want to live somewhere with a balcony full of plants"],
  ["future", "One day I'd love to start a small bakery"],
  ["future", "I hope to travel somewhere new every year"],
  ["interests", "I collect old film cameras"],
  ["interests", "I'm learning to play the tabla"],
  ["interests", "I can talk about street food for hours"],
];
const simActor = (id: string, name: string, h: number): Actor => ({
  id, name,
  facts: [0, 1, 2, 3].map((k) => {
    const [category, content] = SIM_FACTS[(h + k * 4) % SIM_FACTS.length];
    return { id: id + k, category, content } as Fact;
  }),
});

/** Watch a date without signing in: simulated couples, or real dates both members allow. */
function publicDate(id: string) {
  const t = now();
  const sim = id.match(/^sim-(\w+)-(\d+)-(\d+)$/);
  if (sim) {
    const [, type, js, cs] = sim;
    const k = Object.keys(FULL_TYPES).indexOf(type), j = +js, cycle = +cs;
    if (k < 0) fail(404, "This date is private.");
    const L = 150 + ((k * 7 + j * 13) % 5) * 15;
    const began = cycle * L - k * 17 - j * 29;
    const h = hashStr(`${type}-${j}-${cycle}`);
    const [n1, n2] = simNames(h);
    const A = simActor("a", n1, h), B = simActor("b", n2, h >>> 5);
    const out = runDialogue(type, A, B);
    const elapsed = t - began;
    const shown = elapsed > L * 0.82 ? 8 : Math.min(8, 1 + Math.floor(elapsed / ((L * 0.82) / 8)));
    return {
      id, type, status: shown >= 8 ? "completed" : "running",
      a: { name: n1, hue: (h >>> 3) % 360, face: null }, b: { name: n2, hue: (h >>> 11) % 360, face: null },
      lines: out.dialogue.slice(0, shown).map((l: any) => ({ side: l.speaker_id === "a" ? "a" : "b", speaker: (l.speaker_id === "a" ? n1 : n2) + "'s agent", text: l.text, stage: l.stage, mood: l.mood })),
    };
  }
  const s = db.scenes.find((x) => x.id === id);
  const a = s && user(s.a), b = s && user(s.b);
  if (!s || !["queued", "running", "completed"].includes(s.status) || !watchable(a, b)) fail(404, "This date is private.");
  const names: Record<string, string> = { [a!.id]: a!.name.split(" ")[0], [b!.id]: b!.name.split(" ")[0] };
  return {
    id, type: resolveType(s!.venue), status: s!.status, a: liveAgent(a!), b: liveAgent(b!),
    lines: s!.status === "completed"
      ? (s!.output?.dialogue ?? []).map((l: any) => ({ side: l.speaker_id === a!.id ? "a" : "b", speaker: names[l.speaker_id] + "'s agent", text: l.text, stage: l.stage, mood: l.mood }))
      : [],
  };
}

function islandStats(me: User | null) {
  const t = now();
  const live = liveDates(me);
  const wave = (k: number) => Math.round(Math.sin(t / 600 + k) * 40 + Math.sin(t / 97 + k * 3) * 12);
  const by_type: Record<string, number> = {};
  Object.keys(FULL_TYPES).forEach((id, k) => (by_type[id] = 40 + ((k * 37) % 60) + Math.round(wave(k) / 4) + live.filter((x) => x.type === id).length));
  const today = Object.values(by_type).reduce((a, b) => a + b, 0);
  return { agents: 4120 + wave(1) * 3 + db.users.length, active: live.length, today, avg_resonance: 64 + Math.round(Math.sin(t / 300) * 3), by_type, live, simulated: true };
}

/** Demo: fictional people's agents occasionally invite yours on a date. */
function demoInvite(u: User) {
  if (u.role === "admin" || blocker(u)) return;
  const incoming = db.scenes.filter((s) => s.b === u.id).sort((x, y) => y.created - x.created);
  if (incoming.length && now() - incoming[0].created < 45) return;
  if (incoming.filter((s) => ["invited", "queued", "running"].includes(s.status)).length >= 2 || incoming.length >= 6) return;
  const met = new Set(db.scenes.filter((s) => s.a === u.id || s.b === u.id).map((s) => (s.a === u.id ? s.b : s.a)));
  for (const [p] of partners(u)) {
    if (!p.synthetic || met.has(p.id)) continue;
    const t = now() + (incoming.length ? 0 : 8);
    const s: Scene = {
      id: uid(), a: p.id, b: u.id, venue: chooseType(p, u, "auto"), status: u.auto_accept === false ? "invited" : "queued",
      a_version: p.memory_version, b_version: u.memory_version, output: {}, model: "", error: "", tokens: 0,
      created: t, runAt: t + 3, doneAt: t + 9, waived_by: null,
    };
    db.scenes.push(s);
    for (const id of [p.id, u.id]) db.parts.push({ scene_id: s.id, user_id: id, reviewed: false, contribution: "", decision: "pending", next_step: "video", feedback: {} });
    return;
  }
}

/* -------------------------------- routes -------------------------------- */
type Body = any;
export function handle(path: string, method: string, body: Body): any {
  tick();
  const r = route(path.startsWith("/search") || path.startsWith("/dates") ? path : path.split("?")[0], method, body ?? {});
  save();
  return JSON.parse(JSON.stringify(r));
}

function route(path: string, method: string, b: Body): any {
  const m = (re: RegExp) => path.match(re);
  const M_ = method;
  if (path === "/health") return { ok: true, version: "0.5.0", mode: "demo" };
  if (path === "/me") {
    const u = me();
    return { user: ownProfile(u), csrf: "static", mode: "demo" };
  }
  let x;
  if ((x = m(/^\/auth\/demo\/(\w+)$/)) && M_ === "POST") {
    const u = db.users.find((u) => u.email === x![1] + "@demo.soulplex.local") ?? fail(404);
    db.session = u.id;
    return { user: ownProfile(u), csrf: "static", mode: "demo" };
  }
  if (path === "/auth/register" && M_ === "POST") {
    if (!b.consent) fail(422, "Please confirm you are 18 or older and agree to the terms.");
    if (!b.name?.trim()) fail(422, "Add a first name or nickname.");
    if (b.age < 18) fail(422, "Soulplex is for adults (18+).");
    if ((b.password ?? "").length < 12) fail(422, "Use a password of at least 12 characters.");
    if (db.users.some((u) => u.email.toLowerCase() === String(b.email).toLowerCase())) fail(409, "An account with this email already exists.");
    const u: User = {
      id: "me-" + uid().slice(0, 8), email: b.email, password: b.password, name: b.name.trim().slice(0, 40), age: +b.age, city: b.city,
      gender: b.gender, seeking: b.seeking, age_min: Math.max(18, +b.age - 6), age_max: +b.age + 8, intent: "relationship",
      contact: "", discovery: true, verified: true, email_verified: true, disabled: false, synthetic: false, role: "member",
      memory_version: 0, created: now(), face: {}, about: {},
    };
    db.users.push(u);
    db.session = u.id;
    return { user: ownProfile(u), csrf: "static", mode: "demo" };
  }
  if (path === "/auth/login" && M_ === "POST") {
    const u = db.users.find((u) => u.email.toLowerCase() === String(b.email).toLowerCase() && u.password && u.password === b.password);
    if (!u) fail(401, "Email or password is incorrect. In this demo, try the Maya or Arjun buttons.");
    db.session = u!.id;
    return { user: ownProfile(u!), csrf: "static", mode: "demo" };
  }
  if (path.startsWith("/auth/") && ["/auth/request-reset", "/auth/reset-password", "/auth/verify-email", "/auth/resend-verification"].includes(path))
    return { ok: true };
  if (path === "/auth/logout") {
    db.session = null;
    return { ok: true };
  }

  if (path === "/public/island") return islandStats(null);
  if ((x = m(/^\/public\/dates\/([\w-]+)$/))) return publicDate(x[1]);

  const u = me();
  if (path === "/profile" && M_ === "PUT") {
    if (b.age_min > b.age_max) fail(422, "Minimum age must not exceed maximum age.");
    if (contactIn(b.name)) fail(422, "Use a first name or nickname without contact details.");
    Object.assign(u, { name: b.name, age: +b.age, city: b.city, gender: b.gender, seeking: b.seeking, age_min: +b.age_min, age_max: +b.age_max, intent: b.intent, contact: b.contact, discovery: !!b.discovery });
    bump(u);
    return ownProfile(u);
  }
  if (path === "/about" && M_ === "PUT") {
    const about = cleanAbout(b);
    const texts = [...(about.prompts ?? []).map((p: any) => p.answer), about.job ?? "", about.hometown ?? ""];
    if (texts.some((t) => t && contactIn(t))) fail(422, "Keep contact details out of your profile. Use the private contact field.");
    db.memories = db.memories.filter((m) => !(m.user_id === u.id && m.source_id.startsWith("about:")));
    const t = now();
    for (const [k, category, content] of aboutFacts(about))
      db.memories.push({ id: uid(), user_id: u.id, category, content, source_quote: content, source_id: "about:" + k, status: "approved", visibility: "shareable", version: 1, updated: t });
    u.about = about;
    bump(u);
    return ownProfile(u);
  }
  if (path === "/face" && M_ === "PUT") {
    if (b.kind === "illustrated") {
      const spec: Record<string, number> = {};
      for (const [k, n] of Object.entries(FACE_OPTS)) {
        const v = b.spec?.[k] ?? 0;
        if (!Number.isInteger(v) || v < 0 || v >= n) fail(422, `Invalid face option: ${k}.`);
        spec[k] = v;
      }
      u.face = { kind: "illustrated", spec };
    } else if (b.kind === "photo") {
      for (const img of [b.photo, b.public ?? b.photo])
        if (typeof img !== "string" || img.length > 120000 || !IMG.test(img)) fail(422, "Upload a JPEG, PNG or WebP image under 90 KB after cropping.");
      u.face = { kind: "photo", photo: b.photo, public: b.public ?? b.photo, style: b.style ?? "natural", reveal: b.reveal === "everyone" ? "everyone" : "mutual" };
    } else u.face = {};
    return ownProfile(u);
  }
  if (path === "/chat" && M_ === "GET") {
    return { messages: db.messages.filter((x) => x.user_id === u.id).sort((x, y) => x.created - y.created).map(({ id, role, content }) => ({ id, role, content })), opening: QUESTIONS[0][1] };
  }
  if (path === "/chat" && M_ === "POST") {
    const text = String(b.message ?? "").trim();
    if (text.length < 2) fail(422, "Write a little more.");
    quota("chat:" + u.id, 60);
    const idx = db.messages.filter((x) => x.user_id === u.id && x.role === "user").length;
    const [category] = QUESTIONS[Math.min(idx, QUESTIONS.length - 1)];
    const next = idx + 1 < QUESTIONS.length ? QUESTIONS[idx + 1][1] : "Thank you. Review the proposed memories, edit anything that feels wrong, and choose which details your agent may share. What else would you like me to understand?";
    const t = now();
    const src: Msg = { id: uid(), user_id: u.id, role: "user", content: text, created: t };
    db.messages.push(src, { id: uid(), user_id: u.id, role: "assistant", content: `Thank you for sharing that. ${next}`, created: t + 0.001 });
    db.memories.push({ id: uid(), user_id: u.id, category, content: text.slice(0, 600), source_quote: text.slice(0, 600), source_id: src.id, status: "proposed", visibility: "private", version: 1, updated: t });
    return { reply: `Thank you for sharing that. ${next}`, proposals: 1, tokens: 0 };
  }
  if (path === "/memories" && M_ === "GET") return db.memories.filter((x) => x.user_id === u.id).sort((x, y) => y.updated - x.updated).map(factData);
  if (path === "/memories" && M_ === "POST") {
    if (!CATEGORIES.includes(b.category)) fail(422, "Choose a category.");
    const c = String(b.content ?? "").trim();
    if (c.length < 3) fail(422, "Write at least a few words.");
    if (contactIn(c)) fail(422, "Keep contact details out of agent memory. Use the mutual introduction contact field.");
    const mm: Mem = { id: uid(), user_id: u.id, category: b.category, content: c.slice(0, 600), source_quote: c.slice(0, 600), source_id: "owner-written", status: "approved", visibility: b.visibility === "private" ? "private" : "shareable", version: 1, updated: now() };
    db.memories.push(mm);
    bump(u);
    return factData(mm);
  }
  if ((x = m(/^\/memories\/([\w-]+)$/))) {
    const mm = db.memories.find((y) => y.id === x![1] && y.user_id === u.id) ?? fail(404);
    if (M_ === "DELETE") {
      db.memories = db.memories.filter((y) => y !== mm);
      bump(u);
      return { ok: true };
    }
    if (mm.version !== b.expected_version) fail(409, "This memory changed. Refresh before editing.");
    if (b.visibility === "shareable" && contactIn(b.content)) fail(422, "Keep contact details out of agent memory.");
    Object.assign(mm, { content: b.content, visibility: b.visibility, status: b.status, version: mm.version + 1, updated: now() });
    bump(u);
    return factData(mm);
  }
  if (path === "/candidates") {
    const bl = blocker(u);
    if (bl) return { candidates: [], reason: bl, blocked: true };
    const own = memories(u.id, true);
    const out = [];
    for (const [p, facts] of partners(u)) {
      const common = previewCommon(own, facts);
      out.push({ ...publicProfile(p), preview: facts.slice(0, 2).map((f) => f.content), traits: facts.length, common, reason: common.length ? "Your agents may connect over " + common.join(", ") + "." : "Mutual preferences, intention and city fit." });
    }
    return { candidates: out.slice(0, 12), reason: out.length ? "" : "No one matches both ways yet. Search below to see who's close.", blocked: false };
  }
  if (path === "/scenes" && M_ === "POST") {
    const [id] = queueScene(u, user(b.partner_id), b.venue ?? "auto", !!b.waive);
    return { id };
  }
  if (path === "/scenes" && M_ === "GET") {
    demoInvite(u);
    return db.scenes.filter((s) => (s.a === u.id || s.b === u.id) && sceneOk(s)).sort((x, y) => y.created - x.created).slice(0, 50).map((s) => sceneData(s, u));
  }
  if ((x = m(/^\/scenes\/([\w-]+)\/respond$/))) {
    const s = getScene(x[1], u);
    if (s.b !== u.id || s.status !== "invited") fail(409, "There's no open invitation here.");
    if (b.accept) {
      const t = now();
      Object.assign(s, { status: "queued", runAt: t + 2, doneAt: t + 7 });
    } else s.status = "declined";
    return sceneData(s, u);
  }
  if (path === "/settings" && M_ === "PUT") {
    if (b.auto_accept !== undefined) u.auto_accept = !!b.auto_accept;
    if (b.public_dates !== undefined) u.public_dates = !!b.public_dates;
    return ownProfile(u);
  }
  if (path.startsWith("/search")) return search(u, new URLSearchParams(path.split("?")[1] ?? ""));
  if (path.startsWith("/dates")) return listDates(u, new URLSearchParams(path.split("?")[1] ?? ""));
  if (path === "/island") return islandStats(u);
  if (path === "/agent/explore" && M_ === "POST") {
    const bl = blocker(u);
    if (bl) fail(409, bl);
    const met = new Set<string>();
    for (const s of db.scenes.filter((s) => (s.a === u.id || s.b === u.id) && s.status !== "failed")) {
      if ((s.a === u.id ? s.a_version : s.b_version) === u.memory_version) met.add(s.a === u.id ? s.b : s.a);
    }
    const own = memories(u.id, true);
    const pool = [...partners(u)].filter(([p]) => !met.has(p.id)).map(([p, f]) => [previewCommon(own, f).length, p] as const).sort((x, y) => y[0] - x[0]);
    const started: any[] = [];
    pool.slice(0, Math.min(3, b.count ?? 3)).forEach(([, p], i) => {
      const [id, isNew] = queueScene(u, p, "auto");
      if (isNew) started.push({ id, partner: p.name });
    });
    return { started, message: started.length ? `Your agent is heading out on ${started.length} date${started.length === 1 ? "" : "s"}.` : met.size ? "Your agent has already met everyone available. Add new traits to see them with fresh eyes." : "No one nearby matches your preferences yet. Try a wider age range or fewer must-haves." };
  }
  if ((x = m(/^\/scenes\/([\w-]+)$/))) return sceneData(getScene(x[1], u), u);
  if ((x = m(/^\/scenes\/([\w-]+)\/participation$/))) {
    const s = getScene(x[1], u);
    const a = user(s.a)!, bb = user(s.b)!;
    if (s.status !== "completed" || stale(s, a, bb)) fail(409, "Review a current, completed experience first.");
    if (b.decision === "accept" && (!b.reviewed || String(b.contribution).trim().length < 5 || !u.contact))
      fail(422, "Write your own contribution and add a contact method in Settings before accepting.");
    if (contactIn(b.contribution ?? "")) fail(422, "Share your contact only after mutual acceptance, using your profile contact field.");
    const p = db.parts.find((p) => p.scene_id === s.id && p.user_id === u.id)!;
    Object.assign(p, { reviewed: b.reviewed, contribution: b.contribution, decision: b.decision, next_step: b.next_step });
    const other = db.parts.find((p) => p.scene_id === s.id && p.user_id !== u.id)!;
    if (b.decision === "accept" && other.decision === "pending" && user(other.user_id)!.synthetic) other.decideAt = now() + 5;
    return sceneData(s, u);
  }
  if ((x = m(/^\/scenes\/([\w-]+)\/feedback$/))) {
    const s = getScene(x[1], u);
    if (!sceneData(s, u).mutual) fail(409, "Feedback opens after mutual acceptance.");
    db.parts.find((p) => p.scene_id === s.id && p.user_id === u.id)!.feedback = { ...b };
    return { ok: true };
  }
  if ((x = m(/^\/blocks\/([\w-]+)$/))) {
    if (x[1] === u.id || !user(x[1])) fail(404);
    db.blocks.push({ owner: u.id, target: x[1] });
    return { ok: true };
  }
  if (path === "/reports") {
    db.reports.push({ id: uid(), owner: u.id, target: b.target_id, reason: b.reason, status: "open" });
    return { ok: true };
  }
  if (path === "/insights") return insights(u);
  if (path === "/export")
    return { profile: ownProfile(u), memories: db.memories.filter((y) => y.user_id === u.id), chat: db.messages.filter((y) => y.user_id === u.id).map(({ role, content, created }) => ({ role, content, created })) };
  if (path === "/account" && M_ === "DELETE") {
    if (u.synthetic) fail(409, "Demo identities are shared fixtures. Create your own account to try deletion.");
    if (b.password !== u.password) fail(401, "Password is incorrect.");
    const ids = new Set(db.scenes.filter((s) => s.a === u.id || s.b === u.id).map((s) => s.id));
    db.scenes = db.scenes.filter((s) => !ids.has(s.id));
    db.parts = db.parts.filter((p) => !ids.has(p.scene_id));
    db.memories = db.memories.filter((y) => y.user_id !== u.id);
    db.messages = db.messages.filter((y) => y.user_id !== u.id);
    db.users = db.users.filter((y) => y !== u);
    db.session = null;
    return { ok: true };
  }
  if (path.startsWith("/admin")) {
    if (u.role !== "admin") fail(403, "Operator access required.");
    if ((x = m(/^\/admin\/users\/([\w-]+)$/))) {
      const t = user(x[1]) ?? fail(404);
      if (t.role === "admin") fail(409, "Manage operators using the CLI.");
      t.verified = !!b.verified;
      t.disabled = !!b.disabled;
      bump(t);
      return { ok: true };
    }
    if ((x = m(/^\/admin\/reports\/([\w-]+)\/resolve$/))) {
      (db.reports.find((r) => r.id === x![1]) ?? fail(404)).status = "resolved";
      return { ok: true };
    }
    return {
      members: [...db.users].sort((x, y) => y.created - x.created).map((y) => ({ id: y.id, name: y.name, city: y.city, verified: y.verified, email_verified: true, disabled: y.disabled, synthetic: y.synthetic })),
      reports: [...db.reports].reverse(),
      metrics: {
        members: db.users.filter((y) => !y.synthetic).length,
        completed_scenes: db.scenes.filter((s) => s.status === "completed").length,
        human_accepts: db.parts.filter((p) => p.decision === "accept").length,
        outcome_responses: db.parts.filter((p) => Object.keys(p.feedback).length).length,
      },
      mode: "demo",
    };
  }
  if (path === "/transcribe") fail(503, "Voice input needs the full app with an AI provider. Please type your answer.");
  return fail(404, "Not found.");
}
