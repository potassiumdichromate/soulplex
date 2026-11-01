/*
 * Agent faces: illustrated avatars (SVG built from a small spec) and
 * photo processing (crop, style, soft-focus public variant), all client-side.
 */

import { LOOK_NAMES, castFor, presetById, presetFor, PRESETS } from "./characters";

export type FaceSpec = {
  skin: number; hair: number; hairColor: number; eyes: number; brows: number;
  mouth: number; facial: number; accessory: number; outfit: number;
  look?: number; // 0 or missing: auto; 1-15: one of the cast's outfit styles (characters.ts)
};
export type FaceView =
  | { kind: "illustrated"; spec: Partial<FaceSpec> }
  | { kind: "cast"; id: string } // one of the Soulplex cast (fictional members)
  | { kind: "photo"; image?: string; photo?: string; public?: string; locked?: boolean; style?: string; reveal?: string }
  | Record<string, never>;

export const SKIN = ["#f9d9c6", "#efbf9c", "#dca37c", "#bb7f58", "#8e5c3c", "#5f3b25"];
/** Natural eye colours, mostly browns. The same seed gives the same colour in 2D avatars and 3D heads. */
const IRIS = ["#6b4226", "#5a3620", "#7a4e2a", "#4a2e1c", "#8a6a34", "#3f6f9e", "#4f7d4a", "#6b7380"];
export function irisFor(seed: number) {
  return IRIS[seed % IRIS.length];
}
export function irisForSeed(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return irisFor(h >>> 0);
}

export const HAIR_COLOR = ["#1c1414", "#3a2416", "#6b4226", "#a8622c", "#dcb26c", "#a3a1ad", "#7d4bd8"];
export const OUTFIT = ["#ff7eb6", "#7ec8ff", "#ffd58a", "#7ef0c9", "#a98bff", "#f3efe6"];
export const HAIR_LABEL = ["Short", "Long", "Bun", "Curly", "Side part", "Buzz", "Wavy", "Turban", "Hijab"];
export const OPTIONS: { key: keyof FaceSpec; label: string; choices: string[] }[] = [
  { key: "skin", label: "Skin tone", choices: SKIN },
  { key: "hair", label: "Hair", choices: HAIR_LABEL },
  { key: "hairColor", label: "Hair colour", choices: HAIR_COLOR },
  { key: "eyes", label: "Eyes", choices: ["Round", "Lashes", "Smiling"] },
  { key: "brows", label: "Brows", choices: ["Soft", "Bold", "Raised"] },
  { key: "mouth", label: "Mouth", choices: ["Smile", "Grin", "Calm"] },
  { key: "facial", label: "Facial hair", choices: ["None", "Beard", "Moustache"] },
  { key: "accessory", label: "Accessory", choices: ["None", "Glasses", "Bindi", "Earrings", "Flower"] },
  { key: "outfit", label: "Avatar colour", choices: OUTFIT },
  { key: "look", label: "3D outfit style", choices: ["Auto", ...LOOK_NAMES] },
];

/** Hair, eyes and accessories that read as the gender the person chose. */
export function defaultSpec(seed: string, gender?: string): FaceSpec {
  let h = 7;
  for (const c of seed) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const roll = () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return h >>> 8;
  };
  const one = (pool: number[]) => pool[roll() % pool.length];
  const g = (gender || "").toLowerCase();
  const man = g === "man" || g === "men";
  const woman = g === "woman" || g === "women";
  // 0 short, 4 side, 5 buzz, 7 turban. Long, bun, wavy, hijab, lashes, bindi, earrings and flowers stay off a man's face.
  const hair = man ? one([0, 4, 5, 7]) : woman ? one([1, 2, 3, 6]) : one([0, 3, 4, 5]);
  const eyes = man || !woman ? one([0, 2]) : one([0, 1, 2]);
  const facial = man ? one([0, 1, 1, 2]) : 0;
  const accessory = man || !woman ? one([0, 0, 1]) : one([0, 1, 2, 3, 4]);
  const base = {
    skin: roll() % 6,
    hair,
    hairColor: roll() % 7,
    eyes,
    brows: roll() % 3,
    mouth: roll() % 3,
    facial,
    accessory,
    outfit: roll() % 6,
  };
  // people without a designed face are dressed as one of the cast (one that suits their gender), hair and all
  const { index, preset } = castFor(seed, man ? "m" : woman ? "f" : undefined);
  return { ...base, ...preset.face, facial: preset.face.facial ?? 0, accessory: preset.face.accessory ?? 0, outfit: preset.outfit, look: index + 1 };
}

function full(spec: Partial<FaceSpec>, seed = "x"): FaceSpec {
  return { ...defaultSpec(seed), facial: 0, ...spec };
}

/** Illustrated avatar as an SVG string (120×120). */
export function avatarSVG(specIn: Partial<FaceSpec>, hue = 320, seed = "x", headOnly = false): string {
  const s = full(specIn, seed);
  const skin = SKIN[s.skin] ?? SKIN[0];
  const hc = HAIR_COLOR[s.hairColor] ?? HAIR_COLOR[0];
  const out = OUTFIT[s.outfit] ?? OUTFIT[0];
  const bg1 = `hsl(${hue} 85% 72%)`, bg2 = `hsl(${(hue + 40) % 360} 70% 32%)`;
  const p: string[] = [];
  p.push(`<defs><radialGradient id="g" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></radialGradient>
  <clipPath id="c"><circle cx="60" cy="60" r="60"/></clipPath></defs>`);
  p.push(headOnly ? `<g>` : `<g clip-path="url(#c)"><rect width="120" height="120" fill="url(#g)"/>`);
  // The 3D head already has a skin skull and a hair cap, so its texture is only the features.
  if (!headOnly) {
    if (s.hair === 1) p.push(`<path d="M30 50 Q30 20 60 20 Q90 20 90 50 L93 104 Q60 112 27 104 Z" fill="${hc}"/>`);
    if (s.hair === 6) p.push(`<path d="M29 52 Q27 20 60 20 Q93 20 91 52 Q96 74 87 88 L33 88 Q24 74 29 52Z" fill="${hc}"/>`);
    if (s.hair === 2) p.push(`<circle cx="60" cy="21" r="12" fill="${hc}"/>`);
    if (s.hair === 8) p.push(`<path d="M25 62 Q22 16 60 14 Q98 16 95 62 Q97 94 106 124 L14 124 Q23 94 25 62Z" fill="${out}"/><path d="M25 62 Q22 16 60 14 Q98 16 95 62 Q97 94 106 124 L14 124 Q23 94 25 62Z" fill="#000" opacity=".12"/>`);
    p.push(`<path d="M16 124 Q20 92 60 89 Q100 92 104 124Z" fill="${out}"/>`);
    if (s.hair !== 8) p.push(`<rect x="51" y="74" width="18" height="20" rx="6" fill="${skin}"/><rect x="51" y="74" width="18" height="20" rx="6" fill="#000" opacity=".13"/>`);
    if (s.hair !== 8) p.push(`<ellipse cx="36" cy="59" rx="5" ry="7" fill="${skin}"/><ellipse cx="84" cy="59" rx="5" ry="7" fill="${skin}"/>`);
    p.push(`<ellipse cx="60" cy="56" rx="24" ry="28" fill="${skin}"/>`);
  }
  // front hair
  const front: Record<number, string> = {
    0: `<path d="M35 52 Q34 23 60 23 Q87 23 85 52 Q81 36 66 34 Q50 33 42 40 Q37 45 35 52Z" fill="${hc}"/>`,
    1: `<path d="M35 54 Q37 25 60 25 Q84 25 86 54 Q79 37 62 35 Q47 38 35 54Z" fill="${hc}"/>`,
    2: `<path d="M35 52 Q36 27 60 27 Q85 27 85 52 Q77 36 60 35 Q44 36 35 52Z" fill="${hc}"/>`,
    4: `<path d="M34 55 Q31 23 62 23 Q89 25 86 50 Q71 31 51 38 Q40 43 34 55Z" fill="${hc}"/>`,
    5: `<path d="M36 47 Q39 28 60 28 Q81 28 84 47 Q73 37 60 37 Q47 37 36 47Z" fill="${hc}" opacity=".9"/>`,
    6: `<path d="M34 54 Q34 24 60 24 Q86 24 86 54 Q82 40 72 37 Q66 44 58 38 Q50 44 44 38 Q37 44 34 54Z" fill="${hc}"/>`,
    7: `<path d="M31 47 Q29 15 60 13 Q91 15 89 47 Q77 33 60 33 Q43 33 31 47Z" fill="${out}"/><path d="M33 40 Q60 22 87 40 M38 30 Q62 16 84 31" stroke="#000" stroke-opacity=".18" stroke-width="2.4" fill="none"/>`,
    8: `<ellipse cx="60" cy="56" rx="26.5" ry="30.5" fill="none" stroke="${out}" stroke-width="4"/>`,
  };
  if (!headOnly) {
    if (s.hair === 3) {
      const curls = [[38, 44], [40, 34], [48, 27], [58, 24], [68, 25], [77, 29], [83, 37], [85, 46], [44, 30], [64, 30]];
      p.push(curls.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8" fill="${hc}"/>`).join(""));
    } else p.push(front[s.hair] ?? front[0]);
  }
  // film-style features, matching the painted 3D faces
  const iris = irisForSeed(seed);
  const fem = presetFor(s, seed).fit === "f";
  const brC = hc === "#dcb26c" || hc === "#a3a1ad" ? "#8a6a48" : hc;
  const lip = fem ? "#c25866" : "#a9625f";
  p.push(`<defs><radialGradient id="ir" cx="45%" cy="60%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient></defs>`);
  // brows: tapered, thick at the inner end
  const bt = (fem ? 1.6 : 2.6) * (s.brows === 1 ? 1.2 : 1), ba = fem ? 3.2 : s.brows === 1 ? 1 : 2;
  for (const [x, sd] of [[50, -1], [70, 1]] as const) {
    const y = s.brows === 2 ? 42 : 43;
    p.push(`<path d="M${x - sd * 7} ${y + bt * 0.5} Q${x - sd * 0.5} ${y - ba - bt * 0.6} ${x + sd * 8} ${y + 0.4} Q${x - sd * 0.5} ${y - ba + bt * 0.5} ${x - sd * 7} ${y + bt * 1.2}Z" fill="${brC}"/>`);
  }
  for (const [cx, sd] of [[50, -1], [70, 1]] as const) {
    const cy = 52.5, w = 13, h = s.eyes === 2 ? 7 : 8.4;
    const inner = cx - sd * w / 2, outer = cx + sd * w / 2;
    const shape = `M${inner} ${cy + h * 0.1} C${inner + sd * w * 0.2} ${cy - h * 0.78} ${outer - sd * w * 0.28} ${cy - h * 0.72} ${outer} ${cy} C${outer - sd * w * 0.22} ${cy + h * 0.62} ${inner + sd * w * 0.25} ${cy + h * 0.6} ${inner} ${cy + h * 0.1}Z`;
    const id = sd < 0 ? "el" : "er";
    const ix = cx + sd * 0.4, iy = cy + 0.2, ir = h * 0.56;
    p.push(`<clipPath id="${id}"><path d="${shape}"/></clipPath><path d="${shape}" fill="#fbf6f2"/>`);
    p.push(`<g clip-path="url(#${id})"><circle cx="${ix}" cy="${iy}" r="${ir}" fill="${iris}"/><circle cx="${ix}" cy="${iy}" r="${ir}" fill="url(#ir)"/><circle cx="${ix}" cy="${iy}" r="${ir * 0.42}" fill="#0d0807"/><rect x="${cx - 9}" y="${cy - h}" width="18" height="${h * 0.55}" fill="#281414" opacity=".25"/></g>`);
    p.push(`<ellipse cx="${ix - ir * 0.36}" cy="${iy - ir * 0.34}" rx="${ir * 0.3}" ry="${ir * 0.26}" fill="#fff"/><circle cx="${ix + ir * 0.38}" cy="${iy + ir * 0.36}" r="${ir * 0.12}" fill="#fff" opacity=".85"/>`);
    p.push(`<path d="M${inner} ${cy + h * 0.1} C${inner + sd * w * 0.2} ${cy - h * 0.78} ${outer - sd * w * 0.28} ${cy - h * 0.72} ${outer + sd * (fem ? 1.3 : 0.4)} ${cy - (fem ? 1.2 : 0.3)}" stroke="#2a1814" stroke-width="${fem ? 1.3 : 1}" fill="none" stroke-linecap="round"/>`);
    p.push(`<path d="M${inner + sd * w * 0.1} ${cy - h * 0.62 - 0.6} Q${cx} ${cy - h * 1.2} ${outer} ${cy - h * 0.45}" stroke="#000" stroke-opacity=".16" stroke-width=".6" fill="none"/>`);
  }
  // cheeks, nose, lips
  p.push(`<ellipse cx="43" cy="62" rx="5" ry="3.2" fill="#ff7d8c" opacity="${fem ? 0.26 : 0.14}"/><ellipse cx="77" cy="62" rx="5" ry="3.2" fill="#ff7d8c" opacity="${fem ? 0.26 : 0.14}"/>`);
  p.push(`<path d="M61.5 52 Q62.4 57 62.6 60" stroke="#000" stroke-opacity=".12" stroke-width="1" fill="none" stroke-linecap="round"/><ellipse cx="60" cy="61.6" rx="3.2" ry="1.4" fill="#000" opacity=".1"/><path d="M57.4 61 Q58.4 62.2 59.2 61.8 M62.6 61 Q61.6 62.2 60.8 61.8" stroke="#000" stroke-opacity=".3" stroke-width=".7" fill="none" stroke-linecap="round"/>`);
  if (s.mouth === 1)
    p.push(`<path d="M54 67 Q60 68.6 66 67 Q64.4 72.6 60 72.6 Q55.6 72.6 54 67Z" fill="#4d1418"/><path d="M54.4 66.8 Q60 68.4 65.6 66.8 L65.4 69 Q60 70.2 54.6 69Z" fill="#fbf8f2"/><path d="M55.4 71 Q60 74.4 64.6 71 Q60 73.2 55.4 71Z" fill="${lip}"/><path d="M54 67 Q60 68.6 66 67" stroke="${lip}" stroke-width=".9" fill="none" stroke-linecap="round"/>`);
  else {
    const mw = s.mouth === 2 ? 4.4 : 5.8;
    p.push(`<path d="M${60 - mw * 0.85} 68.6 Q60 71.6 ${60 + mw * 0.85} 68.6 Q60 69.6 ${60 - mw * 0.85} 68.6Z" fill="${lip}"/><path d="M${60 - mw} 67.8 Q60 70 ${60 + mw} 67.8" stroke="#6e2a30" stroke-width=".9" fill="none" stroke-linecap="round"/>`);
  }
  // facial hair
  if (s.facial === 1)
    p.push(`<path d="M36 58 Q37 86 60 87 Q83 86 84 58 Q80 74 70 75 Q60 70 50 75 Q40 74 36 58Z" fill="${hc}" opacity=".92"/><path d="M53 67 Q60 71 67 67" stroke="#7a2f3a" stroke-width="2" fill="none" stroke-linecap="round"/>`);
  if (s.facial === 2) p.push(`<path d="M49 64 Q55 60 60 63 Q65 60 71 64 Q66 67 60 65 Q54 67 49 64Z" fill="${hc}"/>`);
  // accessory
  if (s.accessory === 1)
    p.push(`<g fill="none" stroke="#1d1530" stroke-width="2"><circle cx="50" cy="53" r="7.5"/><circle cx="70" cy="53" r="7.5"/><path d="M57.5 53 Q60 51 62.5 53 M42.5 52 L36 50 M77.5 52 L84 50"/></g><circle cx="50" cy="53" r="7.5" fill="#fff" opacity=".12"/><circle cx="70" cy="53" r="7.5" fill="#fff" opacity=".12"/>`);
  if (s.accessory === 2) p.push(`<circle cx="60" cy="44.5" r="2.2" fill="#d6203f"/>`);
  if (s.accessory === 3 && s.hair !== 8) p.push(`<circle cx="36" cy="68" r="2.6" fill="#ffd27a"/><circle cx="84" cy="68" r="2.6" fill="#ffd27a"/>`);
  if (s.accessory === 4)
    p.push(`<g transform="translate(80 32)"><circle r="4" cx="-4" fill="#ff8fb8"/><circle r="4" cx="4" fill="#ff8fb8"/><circle r="4" cy="-4" fill="#ffb3d1"/><circle r="4" cy="4" fill="#ffb3d1"/><circle r="2.6" fill="#ffd58a"/></g>`);
  p.push(`</g>`);
  // Tight on the face so a 3D head shows eyes and mouth, not a hair ring around a tiny mask.
  const box = headOnly ? "32 31 56 56" : "0 0 120 120";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="256" height="256">${p.join("")}</svg>`;
}

export const svgUrl = (svg: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

/** One image URL for any face, with a deterministic illustrated fallback. */
export function faceUrl(face: FaceView | undefined | null, seed: string, hue: number, gender?: string): string {
  const f = (face ?? {}) as any;
  if (f.kind === "cast" && presetById(f.id)?.art) return presetById(f.id)!.art!.face;
  if (f.kind === "photo") {
    const img = f.image ?? f.photo;
    if (img) return img;
  }
  const spec = f.kind === "illustrated" ? { ...defaultSpec(seed, gender), ...f.spec } : defaultSpec(seed, gender);
  return svgUrl(avatarSVG(spec, hue, seed));
}

/** The face for a 3D head: illustrated faces drop the badge background; photos stay as they are. */
export function headUrl(face: FaceView | undefined | null, seed: string, hue: number, gender?: string): string {
  const f = (face ?? {}) as any;
  if (f.kind === "cast" && presetById(f.id)?.art) return presetById(f.id)!.art!.face;
  if (f.kind === "photo" && (f.image ?? f.photo)) return f.image ?? f.photo;
  const spec = f.kind === "illustrated" ? { ...defaultSpec(seed, gender), ...f.spec } : defaultSpec(seed, gender);
  return svgUrl(avatarSVG(spec, hue, seed, true));
}

/* ---------------------------- photo pipeline ---------------------------- */
export type Crop = { zoom: number; x: number; y: number };
export type PhotoStyle = "natural" | "dreamy" | "painted";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("That file couldn't be read as an image. Try a JPEG or PNG."));
    i.src = src;
  });
}

function canvas(n: number) {
  const c = document.createElement("canvas");
  c.width = c.height = n;
  return [c, c.getContext("2d", { willReadFrequently: true })!] as const;
}

/** Square crop of the source, sized n. */
export function cropTo(img: HTMLImageElement, crop: Crop, n = 288) {
  const [c, g] = canvas(n);
  const side = Math.min(img.naturalWidth, img.naturalHeight) / crop.zoom;
  const maxX = (img.naturalWidth - side) / 2, maxY = (img.naturalHeight - side) / 2;
  const sx = maxX + crop.x * maxX, sy = maxY + crop.y * maxY;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, sx, sy, side, side, 0, 0, n, n);
  return c;
}

/** Cheap, filter-free blur: downscale then upscale with smoothing. */
function softened(src: HTMLCanvasElement, factor: number) {
  const n = src.width;
  const small = Math.max(6, Math.round(n / factor));
  const [s, sg] = canvas(small);
  sg.imageSmoothingQuality = "high";
  sg.drawImage(src, 0, 0, small, small);
  const [c, g] = canvas(n);
  g.imageSmoothingQuality = "high";
  g.drawImage(s, 0, 0, n, n);
  return c;
}

function hslToRgb(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function stylize(base: HTMLCanvasElement, style: PhotoStyle, hue: number) {
  const n = base.width;
  const [c, g] = canvas(n);
  g.drawImage(base, 0, 0);
  if (style === "natural") return c;
  const d = g.getImageData(0, 0, n, n);
  const px = d.data;
  if (style === "dreamy") {
    const dark = hslToRgb(hue, 0.6, 0.16), light = [255, 236, 222];
    for (let i = 0; i < px.length; i += 4) {
      const l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      for (let k = 0; k < 3; k++) {
        const duo = dark[k] + (light[k] - dark[k]) * l;
        px[i + k] = duo * 0.68 + px[i + k] * 0.32;
      }
    }
    g.putImageData(d, 0, 0);
    const glow = softened(c, 10);
    g.globalCompositeOperation = "screen";
    g.globalAlpha = 0.35;
    g.drawImage(glow, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    return c;
  }
  // painted: saturate, then posterise
  const lv = 6, step = 255 / (lv - 1);
  for (let i = 0; i < px.length; i += 4) {
    const avg = (px[i] + px[i + 1] + px[i + 2]) / 3;
    for (let k = 0; k < 3; k++) {
      const sat = avg + (px[i + k] - avg) * 1.45;
      px[i + k] = Math.round(Math.max(0, Math.min(255, sat)) / step) * step;
    }
  }
  g.putImageData(d, 0, 0);
  return c;
}

/** What strangers see until a mutual match: soft focus, duotone, no detail. */
export function softFocus(base: HTMLCanvasElement, hue: number) {
  return stylize(softened(base, 22), "dreamy", hue);
}

export const toJpeg = (c: HTMLCanvasElement) => c.toDataURL("image/jpeg", 0.84);

/** Colours for the 3D body, matching the face (head covering counts as "hair"), plus the
 *  full spec so the 3D character can sculpt the same eyes, brows, mouth and hairstyle.
 *  Photo faces have no spec: the photo is shown on the head instead. */
export function bodyColors(face: FaceView | undefined | null, seed: string, hue: number, gender?: string): { skin: string; hair: string; outfit: string; hairStyle?: number; spec?: FaceSpec } {
  const f = (face ?? {}) as any;
  if (f.kind === "photo") return { skin: "#c99272", hair: "#2b1d18", outfit: `hsl(${hue}, 70%, 58%)` };
  const cp = f.kind === "cast" ? presetById(f.id) : undefined;
  if (cp) {
    // a cast member: the 3D character is dressed and styled exactly like their character sheet
    const spec = { ...defaultSpec(seed, gender), ...cp.face, facial: cp.face.facial ?? 0, accessory: cp.face.accessory ?? 0, skin: cp.art?.skin ?? 1, outfit: cp.outfit, look: PRESETS.indexOf(cp) + 1 } as FaceSpec;
    return { skin: SKIN[spec.skin], hair: HAIR_COLOR[spec.hairColor] ?? HAIR_COLOR[0], outfit: OUTFIT[spec.outfit], spec };
  }
  // a designed face without a chosen outfit style gets one that suits its hairstyle ("auto")
  const s = { ...defaultSpec(seed, gender), facial: 0, ...(f.kind === "illustrated" ? { look: 0, ...f.spec } : {}) } as FaceSpec;
  // no outfit style chosen: dress the character to match the person's gender, not a guess from the hairstyle
  const fit = gender === "man" ? "m" : gender === "woman" ? "f" : undefined;
  if (fit && !s.look) s.look = castFor(seed, fit).index + 1;
  const covered = s.hair === 7 || s.hair === 8;
  return {
    skin: SKIN[s.skin] ?? SKIN[2],
    hair: covered ? OUTFIT[s.outfit] : HAIR_COLOR[s.hairColor] ?? HAIR_COLOR[0],
    hairStyle: s.hair,
    outfit: OUTFIT[s.outfit] ?? OUTFIT[0],
    spec: s,
  };
}
