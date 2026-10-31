/*
 * The Soulplex cast: 15 outfit styles for the 3D characters, modelled on the brand's
 * character sheets (oversized knits and jackets, cargo pants, chunky pastel sneakers).
 *
 * Each person's agent wears one of these. People who designed an illustrated face keep their
 * own skin, hair and face; the look adds the clothes. Everyone else gets the look's full
 * styling, so the island always shows a varied, on-brand crowd.
 */

import face_lavender from "./assets/cast/face-lavender.webp";
import face_pinkbomber from "./assets/cast/face-pinkbomber.webp";
import face_creamsuit from "./assets/cast/face-creamsuit.webp";
import face_lilachoodie from "./assets/cast/face-lilachoodie.webp";
import face_midnight from "./assets/cast/face-midnight.webp";
import face_sheerlilac from "./assets/cast/face-sheerlilac.webp";
import face_tealvarsity from "./assets/cast/face-tealvarsity.webp";
import face_blackbomber from "./assets/cast/face-blackbomber.webp";

export type Top =
  | "sweater" // closed oversized knit with ribbed hem
  | "jacket" // open jacket over an inner layer
  | "blazer" // long open blazer with lapels
  | "shirt" // button-up shirt, tucked in
  | "vest" // puffer vest over a hoodie
  | "coat"; // long coat to the knee
export type Bottom = "cargo" | "techcargo" | "wide" | "straight";

export type Preset = {
  id: string;
  name: string;
  fit: "f" | "m" | "u"; // which default hairstyles it is offered to
  face: { hair: number; hairColor: number; facial?: number; accessory?: number }; // used when no face was designed
  top: Top;
  topC: string;
  trimC?: string; // cuffs, hem, collar
  innerC?: string; // tee / hoodie / top underneath
  crop?: boolean; // short top: a little midriff shows
  cropOuter?: boolean; // the jacket itself ends at the waist
  hood?: string; // hood colour behind the neck
  sleeve?: "long" | "puffy" | "rolled";
  zip?: boolean;
  star?: boolean; // small glowing star emblem
  patches?: string; // sleeve patches
  sheer?: boolean; // translucent-looking jacket
  bottom: Bottom;
  bottomC: string;
  strapC?: string; // tech cargo straps
  belt?: string;
  shoes: "sneaker" | "heels";
  shoeC: string; // sneaker accent panels
  bag?: { c: string; kind: "box" | "chain" | "sling" };
  headphones?: string;
  beanie?: string;
  cap?: string;
  flower?: string;
  scrunchie?: string;
  earrings?: { c: string; kind: "hoop" | "drop" };
  watch?: string;
  bracelet?: string;
  necklace?: string;
  outfit: number; // nearest colour in the 2D avatar palette (faces.ts OUTFIT)
  art?: { face: string; skin: number; member?: string }; // character-sheet portrait
};

export const PRESETS: Preset[] = [
  {
    id: "lavender", name: "Lavender Knit", fit: "f", face: { hair: 1, hairColor: 1 },
    top: "sweater", topC: "#c3a6f2", trimC: "#b294ea", innerC: "#f6f2ee", sleeve: "puffy",
    bottom: "cargo", bottomC: "#efe8dd", shoes: "sneaker", shoeC: "#c3a6f2",
    bag: { c: "#d8c6f5", kind: "box" }, flower: "#b98cf0", earrings: { c: "#e2b660", kind: "hoop" }, outfit: 4, art: { face: face_lavender, member: "Leila", skin: 0 },
  },
  {
    id: "pinkbomber", name: "Pink Cropped Jacket", fit: "f", face: { hair: 2, hairColor: 2 },
    top: "jacket", topC: "#f6b4cf", trimC: "#f09cc0", innerC: "#fbf8f6", crop: true, cropOuter: true, hood: "#f6b4cf", sleeve: "puffy",
    bottom: "cargo", bottomC: "#efe6da", shoes: "sneaker", shoeC: "#f39cc2",
    bag: { c: "#f8d3e2", kind: "box" }, scrunchie: "#fbf6f8", earrings: { c: "#f3f0f5", kind: "drop" }, outfit: 0, art: { face: face_pinkbomber, member: "Sara", skin: 0 },
  },
  {
    id: "creamsuit", name: "Cream Suit", fit: "f", face: { hair: 1, hairColor: 3, accessory: 3 },
    top: "blazer", topC: "#efe6d8", trimC: "#e4d8c6", innerC: "#f1e9de", crop: true, sleeve: "rolled",
    bottom: "wide", bottomC: "#efe6d8", belt: "#d9c7ae", shoes: "heels", shoeC: "#f3ece2",
    bag: { c: "#1e1a20", kind: "chain" }, earrings: { c: "#d9a640", kind: "drop" }, bracelet: "#d9a640", necklace: "#d9a640", outfit: 5, art: { face: face_creamsuit, member: "Maya", skin: 1 },
  },
  {
    id: "lilachoodie", name: "Lilac Hoodie Jacket", fit: "m", face: { hair: 0, hairColor: 1 },
    top: "jacket", topC: "#f4f1f8", trimC: "#c3a6f2", innerC: "#2a2233", hood: "#c3a6f2", zip: true, star: true, patches: "#9fd3f5", sleeve: "long",
    bottom: "techcargo", bottomC: "#2c2833", strapC: "#b994f2", shoes: "sneaker", shoeC: "#8f6ae0", watch: "#1c1a22", outfit: 4, art: { face: face_lilachoodie, member: "Karan", skin: 1 },
  },
  {
    id: "midnight", name: "Midnight Shirt", fit: "m", face: { hair: 4, hairColor: 0, facial: 1 },
    top: "shirt", topC: "#2a2629", innerC: "#2a2629", sleeve: "rolled",
    bottom: "straight", bottomC: "#2f2b2e", belt: "#1a1718", shoes: "sneaker", shoeC: "#a9a6ad", watch: "#1c1a1c", outfit: 5, art: { face: face_midnight, member: "Arjun", skin: 2 },
  },
  {
    id: "sheerlilac", name: "Sheer Lilac", fit: "f", face: { hair: 1, hairColor: 1, accessory: 3 },
    top: "jacket", topC: "#ecd7fb", trimC: "#9b5ce0", innerC: "#fbf8fb", crop: true, cropOuter: true, sheer: true, sleeve: "puffy",
    bottom: "techcargo", bottomC: "#3b2a3d", strapC: "#b67ff0", shoes: "sneaker", shoeC: "#a774ec",
    earrings: { c: "#a774ec", kind: "drop" }, bracelet: "#8fc6f5", outfit: 4, art: { face: face_sheerlilac, member: "Zara", skin: 0 },
  },
  {
    id: "tealvarsity", name: "Teal Varsity", fit: "m", face: { hair: 3, hairColor: 0 },
    top: "jacket", topC: "#6f98a4", trimC: "#f2eef0", innerC: "#f2eef0", hood: "#f2eef0", patches: "#f2eef0", sleeve: "puffy",
    bottom: "cargo", bottomC: "#3a302c", shoes: "sneaker", shoeC: "#8f6ae0",
    bag: { c: "#1f1c22", kind: "sling" }, headphones: "#2a2638", beanie: "#26232a", outfit: 3, art: { face: face_tealvarsity, member: "Omar", skin: 1 },
  },
  {
    id: "blackbomber", name: "Black Bomber", fit: "m", face: { hair: 3, hairColor: 0 },
    top: "jacket", topC: "#27242b", trimC: "#27242b", innerC: "#f3f0f4", hood: "#d9c7f5", patches: "#7fb6f0", sleeve: "puffy",
    bottom: "cargo", bottomC: "#2c2930", shoes: "sneaker", shoeC: "#9d7be6",
    bag: { c: "#1e1b21", kind: "sling" }, watch: "#1c1a20", outfit: 5, art: { face: face_blackbomber, member: "Vikram", skin: 1 },
  },
  {
    id: "mintcardigan", name: "Mint Cardigan", fit: "f", face: { hair: 6, hairColor: 0 },
    top: "jacket", topC: "#a9e3cf", trimC: "#93d6bf", innerC: "#fbfaf7", sleeve: "puffy",
    bottom: "wide", bottomC: "#a9c3e4", shoes: "sneaker", shoeC: "#8fd8c0",
    bag: { c: "#f4efe6", kind: "box" }, earrings: { c: "#e2b660", kind: "hoop" }, outfit: 3,
  },
  {
    id: "butterpuffer", name: "Butter Puffer", fit: "m", face: { hair: 5, hairColor: 1 },
    top: "vest", topC: "#f6dc8c", trimC: "#e9c96e", innerC: "#8b8a99", hood: "#8b8a99", sleeve: "long",
    bottom: "cargo", bottomC: "#2c2a33", shoes: "sneaker", shoeC: "#f2cf6a", beanie: "#f1ebe0", outfit: 2,
  },
  {
    id: "rosedenim", name: "Rose Denim", fit: "f", face: { hair: 3, hairColor: 2 },
    top: "jacket", topC: "#9fbbe0", trimC: "#88a8d4", innerC: "#f5b8cf", crop: true, cropOuter: true, sleeve: "long",
    bottom: "wide", bottomC: "#f3eee6", shoes: "sneaker", shoeC: "#f39cc2",
    bag: { c: "#f5b8cf", kind: "box" }, necklace: "#e2b660", outfit: 1,
  },
  {
    id: "skytrack", name: "Sky Track Jacket", fit: "u", face: { hair: 4, hairColor: 1 },
    top: "jacket", topC: "#8ec5f2", trimC: "#ffffff", innerC: "#fbfbfd", zip: true, sleeve: "long",
    bottom: "cargo", bottomC: "#8ec5f2", shoes: "sneaker", shoeC: "#6aa9e8", cap: "#f5f2ee", outfit: 1,
  },
  {
    id: "coraloverhirt", name: "Coral Overshirt", fit: "m", face: { hair: 0, hairColor: 2, accessory: 1 },
    top: "jacket", topC: "#f39b86", trimC: "#e9866f", innerC: "#fbf9f6", sleeve: "rolled",
    bottom: "cargo", bottomC: "#e5d6bf", shoes: "sneaker", shoeC: "#f39b86",
    bag: { c: "#3a3237", kind: "sling" }, watch: "#2a2428", outfit: 0,
  },
  {
    id: "plumcoat", name: "Plum Coat", fit: "f", face: { hair: 2, hairColor: 0, accessory: 3 },
    top: "coat", topC: "#7e5a9c", trimC: "#6d4b8a", innerC: "#231f27", sleeve: "long",
    bottom: "straight", bottomC: "#231f27", shoes: "sneaker", shoeC: "#b38fe0",
    bag: { c: "#e9e2ec", kind: "chain" }, scrunchie: "#b38fe0", earrings: { c: "#d9a640", kind: "hoop" }, outfit: 4,
  },
  {
    id: "sagehoodie", name: "Sage Hoodie", fit: "u", face: { hair: 4, hairColor: 2 },
    top: "sweater", topC: "#a8c2a2", trimC: "#97b391", innerC: "#a8c2a2", hood: "#a8c2a2", sleeve: "puffy",
    bottom: "cargo", bottomC: "#ece4d6", shoes: "sneaker", shoeC: "#8fb487", headphones: "#f2eff4", outfit: 3,
  },
];

export const LOOK_NAMES = PRESETS.map((p) => p.name);
/** The characters with full character-sheet art, for the gallery and as faces of fictional members. */
export const CAST_WITH_ART = PRESETS.filter((p) => p.art);
export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The look someone wears: the one they picked, otherwise one that suits their hairstyle. */
export function presetFor(spec: { look?: number; hair?: number; facial?: number } | undefined, seed: string): Preset {
  if (spec?.look && spec.look >= 1 && spec.look <= PRESETS.length) return PRESETS[spec.look - 1];
  const hair = spec?.hair ?? 0;
  const fem = [1, 2, 6, 8].includes(hair) && !spec?.facial;
  const pool = PRESETS.filter((p) => p.fit === "u" || p.fit === (fem ? "f" : "m"));
  return pool[hashStr(seed) % pool.length];
}

/** For people without a designed face: a whole character, picked from the seed. */
export function castFor(seed: string) {
  const i = hashStr(seed + ":cast") % PRESETS.length;
  return { index: i, preset: PRESETS[i] };
}

// handy for visual checks in the browser console
if (typeof window !== "undefined") (window as any).__soulplexCast = PRESETS;
