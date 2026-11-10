/*
 * Real 3D character models (GLB), e.g. made from the character sheets with Meshy, Tripo
 * or Rodin and rigged/animated with Mixamo.
 *
 * Drop the files in `frontend/public/models/` (served at /models/) and list them in
 * `models.json`, keyed by outfit look id (see characters.ts):
 *
 *   { "lavender": "lavender.glb", "blackbomber": "black-bomber.glb", "*": "fallback.glb" }
 *
 * "*f" / "*m" (optional) are used for every women's / men's look without its own model, and
 * "*" for anything still left. Looks without a model keep the code-built character, so models
 * can be added one at a time, and a model that fails to load also keeps it.
 *
 * Shared animations: Mixamo characters all use the same skeleton, so one set of movement files
 * can drive every model. List them under "_anims"; each file's clips are named after the file:
 *
 *   { "_anims": ["idle.glb", "walk.glb", "sit.glb", "talk.glb"], "lavender": "lavender.glb" }
 *
 * Animations are matched by clip name: idle ("idle"/"standing"), walk ("walking"/"walk"/"run"),
 * sit ("sitting"/"sit") and talk ("talking"/"talk"). Any missing clip falls back to idle.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

export type ModelEntry = { scene: THREE.Object3D; clips: THREE.AnimationClip[]; height: number; minY: number; file: string };

export const MODEL_BASE = "models/";
let manifest: Promise<Record<string, any>> | null = null;
let sharedClips: Promise<THREE.AnimationClip[]> | null = null;
const cache = new Map<string, Promise<ModelEntry | null>>();
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/** A page can carry its models inline (the single-file demo): { "midnight": "data:model/gltf-binary;base64,…" }. */
const inlineModels = () => (globalThis as any).__soulplexModels as Record<string, any> | undefined;
const urlOf = (file: string) => (/^(data:|blob:|https?:)/.test(file) ? file : MODEL_BASE + file);

function getManifest() {
  const inline = inlineModels();
  if (inline) return (manifest ??= Promise.resolve(inline));
  manifest ??= fetch(MODEL_BASE + "models.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return manifest;
}

const loadGlb = (file: string) => new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] } | null>((resolve) => loader.load(urlOf(file), (g) => resolve(g), undefined, () => resolve(null)));

/** Movements shared by all models (each clip renamed after its file: idle, walk, sit, talk). */
function getSharedClips() {
  sharedClips ??= getManifest().then(async (m) => {
    const files: string[] = Array.isArray(m._anims) ? m._anims : [];
    const out: THREE.AnimationClip[] = [];
    for (const f of files) {
      const g = await loadGlb(f);
      const clip = g?.animations[0];
      if (clip) {
        clip.name = f.replace(/^.*\//, "").replace(/\.glb$/i, "");
        out.push(clip);
      }
    }
    return out;
  });
  return sharedClips;
}

/** The model for an outfit look, loaded once and shared (null when there is none). */
/** "midnight.glb" for a file path or an inline model (inline ones are named by their manifest key). */
const inlineNames = new Map<string, string>();
const fileName = (file: string) => inlineNames.get(file) ?? file.replace(/^.*\//, "");

export async function modelFor(lookId: string, fit?: "f" | "m"): Promise<ModelEntry | null> {
  const m = await getManifest();
  // "@midnight" points at another entry, so an inline model is only carried once
  const val = (k: string | false | undefined) => {
    let v = k && typeof m[k] === "string" ? (m[k] as string) : undefined;
    if (v?.startsWith("@")) v = typeof m[v.slice(1)] === "string" ? m[v.slice(1)] : undefined;
    return v;
  };
  const file = [lookId, fit && "*" + fit, "*"].map(val).find(Boolean);
  if (file && file.startsWith("data:") && !inlineNames.has(file)) {
    const key = Object.keys(m).find((k) => m[k] === file && !k.startsWith("*")) ?? "model";
    inlineNames.set(file, key + ".glb");
  }
  if (!file) return null;
  const shared = await getSharedClips();
  if (!cache.has(file))
    cache.set(
      file,
      new Promise((resolve) =>
        loader.load(
          urlOf(file),
          (g) => {
            g.scene.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(g.scene);
            // the model's own clips win; shared movements fill in the rest
            const clips = [...g.animations, ...shared.filter((c) => !g.animations.some((o) => o.name.toLowerCase().includes(c.name.toLowerCase())))];
            resolve({ scene: g.scene, clips, height: Math.max(0.01, box.max.y - box.min.y), minY: box.min.y, file: fileName(file) });
          },
          undefined,
          () => resolve(null),
        ),
      ),
    );
  return cache.get(file)!;
}

/** A clip by name, preferring an exact match, then a partial one. */
export function findClip(clips: THREE.AnimationClip[], names: string[]) {
  const low = clips.map((c) => [c.name.toLowerCase().replace(/^.*\|/, ""), c] as const);
  for (const n of names) for (const [k, c] of low) if (k === n) return c;
  for (const n of names) for (const [k, c] of low) if (k.includes(n)) return c;
  return null;
}

/** An independent, animatable copy of a model, scaled to the characters' height with feet on the ground. */
export function instance(e: ModelEntry, height = 1.62) {
  const obj = cloneSkinned(e.scene);
  const k = height / e.height;
  obj.scale.setScalar(k);
  obj.position.y = -e.minY * k;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.frustumCulled = false; // skinned meshes move outside their bind-pose bounds
    }
  });
  return obj;
}

/*
 * One model, many people. A Meshy figure has skin, hair and clothes fused into one texture, so
 * every man (or woman) would look identical. `personalize` gives each copy its own material that
 * recolours the texture in the shader: skin toward the person's skin tone, hair toward their hair
 * colour, the top and the trousers toward their outfit's colours. Regions are found by colour
 * (skin is warm and moderately saturated) and by height on the body in the bind pose (above the
 * neck is hair, below the ankles are shoes, the waist splits top from trousers).
 */
export type Look = { skin?: string; hair?: string; top?: string; bottom?: string; keepClothes?: boolean; debug?: boolean };

type Stats = { neck: number; waist: number; ankle: number; skin: THREE.Color; hairLum: number; topLum: number; bottomLum: number; mask: THREE.DataTexture };
const statsCache = new WeakMap<THREE.Object3D, Stats | null>();

const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const median = (a: number[]) => (a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
/** Plausibly skin, on 0..255 sRGB: warm, moderately saturated, not dark. */
function skinLike(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 90 || mx === mn) return false;
  const sat = (mx - mn) / mx;
  let h = mx === r ? ((g - b) / (mx - mn)) * 60 : mx === g ? (2 + (b - r) / (mx - mn)) * 60 : (4 + (r - g) / (mx - mn)) * 60;
  if (h < 0) h += 360;
  return (h < 45 || h > 345) && sat > 0.15 && sat < 0.7 && r >= g && g >= b * 0.85;
}

/**
 * Grow a region over the texture from seed texels, across neighbours of similar colour. Texture
 * islands for skin, hair and each garment are separated by clear colour edges, so the fill stays
 * on the skin (or the hair) and never spills onto clothes of a similar tone.
 */
function grow(px: Uint8ClampedArray, size: number, seeds: number[], out: Uint8Array, stepTol: number, seedTol: number, allow?: Uint8Array) {
  const seen = new Uint8Array(size * size);
  const queue: number[] = [];
  for (const sd of seeds) {
    if (seen[sd]) continue;
    seen[sd] = 1;
    queue.length = 0;
    queue.push(sd);
    const r0 = px[sd * 4], g0 = px[sd * 4 + 1], b0 = px[sd * 4 + 2];
    while (queue.length) {
      const i = queue.pop()!;
      out[i] = 255;
      const x = i % size, y = (i / size) | 0;
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        if (seen[j] || (allow && !allow[j])) continue;
        const R = px[j * 4], G = px[j * 4 + 1], B = px[j * 4 + 2];
        const step = Math.abs(R - r) + Math.abs(G - g) + Math.abs(B - b);
        const far = Math.abs(R - r0) + Math.abs(G - g0) + Math.abs(B - b0);
        if (step > stepTol || far > seedTol) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
  }
}

/** Where the neck, waist and ankles are, a skin and hair mask, and the typical colours of each part. */
function measure(scene: THREE.Object3D): Stats | null {
  if (statsCache.has(scene)) return statsCache.get(scene)!;
  let out: Stats | null = null;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (out || !sm.isSkinnedMesh) return;
    const img = (sm.material as THREE.MeshStandardMaterial).map?.image as CanvasImageSource & { width: number; height: number };
    if (!img) return;
    const bindY = (re: RegExp) => {
      const i = sm.skeleton.bones.findIndex((b) => re.test(b.name));
      return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(sm.skeleton.boneInverses[i].clone().invert()).y;
    };
    const neck = bindY(/neck/i), hips = bindY(/hips|pelvis/i), foot = bindY(/leftfoot|foot/i), head = bindY(/^head$|head/i);
    if (neck == null || hips == null || foot == null) return;
    const size = 512;
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const g = cv.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, size, size);
    const px = g.getImageData(0, 0, size, size).data;
    const pos = sm.geometry.attributes.position, uv = sm.geometry.attributes.uv;
    const n = pos.count;
    const P = new Float32Array(n * 3), T = new Int32Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(sm.bindMatrix);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
      const x = Math.min(size - 1, Math.max(0, Math.floor(uv.getX(i) * size)));
      const y = Math.min(size - 1, Math.max(0, Math.floor(uv.getY(i) * size))); // glTF: v grows down the image
      T[i] = y * size + x;
    }
    const neckY = neck + (head != null ? (head - neck) * 0.75 : 0.05); // just under the jaw line
    const waist = hips + 0.06, ankle = foot + 0.02;
    let top = -Infinity, nose = -1, noseZ = -Infinity, crown = -1;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      if (y > top) { top = y; crown = i; }
      if (y > neckY && Math.abs(x) < 0.03 && z > noseZ) { noseZ = z; nose = i; }
    }
    if (nose < 0) return;
    const col = (t: number) => [px[t * 4], px[t * 4 + 1], px[t * 4 + 2]] as const;
    const isSkin = (t: number) => skinLike(...col(t));
    // skin seeds: skin-coloured texels on the front of the face, and on the hands (vertices bound to hand bones)
    const skinSeeds: number[] = [];
    for (let i = 0; i < n; i++) {
      const y = P[i * 3 + 1], z = P[i * 3 + 2];
      if (y > neckY && y < neckY + (top - neckY) * 0.6 && z > noseZ - 0.06 && isSkin(T[i])) skinSeeds.push(T[i]);
    }
    const handBones = new Set(sm.skeleton.bones.map((b, i) => (/hand|finger|thumb|index|middle|ring|pinky/i.test(b.name) ? i : -1)).filter((i) => i >= 0));
    const si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
    if (si && sw)
      for (let i = 0; i < n; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (handBones.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
        if (w > 0.9 && isSkin(T[i])) skinSeeds.push(T[i]);
      }
    if (skinSeeds.length < 5) return;
    // the chin, jaw and neck: anything on the head or neck that matches the face's typical colour
    const fr = [0, 1, 2].map((k) => median(skinSeeds.map((t) => px[t * 4 + k])));
    for (let i = 0; i < n; i++) {
      if (P[i * 3 + 1] < neck - 0.04) continue;
      const t = T[i];
      if (Math.abs(px[t * 4] - fr[0]) + Math.abs(px[t * 4 + 1] - fr[1]) + Math.abs(px[t * 4 + 2] - fr[2]) < 75) skinSeeds.push(t);
    }
    const hairSeeds = [crown].map((i) => T[i]);
    for (let i = 0; i < n; i++) if (P[i * 3 + 1] > top - (top - neckY) * 0.15 || (P[i * 3 + 1] > neckY && P[i * 3 + 2] < -0.06)) hairSeeds.push(T[i]);
    const skinM = new Uint8Array(size * size), hairM = new Uint8Array(size * size);
    grow(px, size, skinSeeds, skinM, 30, 115);
    const near = (a: number, b: number, tol: number) => Math.abs(px[a * 4] - px[b * 4]) + Math.abs(px[a * 4 + 1] - px[b * 4 + 1]) + Math.abs(px[a * 4 + 2] - px[b * 4 + 2]) < tol;
    const hair0 = T[crown];
    // hair may only grow over parts that move with the head (long hair included), never onto clothes
    const headish = new Uint8Array(size * size);
    const headBones = new Set(sm.skeleton.bones.map((b, i) => (/head/i.test(b.name) && !/end|top/i.test(b.name) ? i : -1)).filter((i) => i >= 0));
    // when the hair is clearly a different colour from the top (dark hair on a light jacket), long hair may run
    // down the back; when they are alike (dark hair, black shirt) hair stays on the head
    const h0 = col(T[crown]);
    const dist = (c: readonly number[], d: readonly number[]) => Math.abs(c[0] - d[0]) + Math.abs(c[1] - d[1]) + Math.abs(c[2] - d[2]);
    // weigh by surface area: long hair has far more vertices than a jacket, but much less surface
    let topA = 0, unlikeA = 0;
    {
      const idx = sm.geometry.index;
      const tri = idx ? idx.count / 3 : n / 3;
      const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
      for (let f = 0; f < tri; f++) {
        const a = idx ? idx.getX(f * 3) : f * 3, b = idx ? idx.getX(f * 3 + 1) : f * 3 + 1, c = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
        const y = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3;
        if (y <= waist || y >= neckY || skinM[T[a]]) continue;
        e1.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
        e2.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]);
        const area = e1.cross(e2).length();
        topA += area;
        if (dist(col(T[a]), h0) > 150) unlikeA += area;
      }
    }
    const hairDiffers = topA > 0 && unlikeA / topA > 0.35;
    const hw = new Float32Array(n);
    const handV = new Uint8Array(n);
    if (si && sw)
      for (let i = 0; i < n; i++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (handBones.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
        if (w > 0.3) handV[i] = 1;
      }
    if (si && sw) for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) if (headBones.has(si.getComponent(i, k))) hw[i] += sw.getComponent(i, k);
    const index = sm.geometry.index;
    const tri = index ? index.count / 3 : n / 3;
    const U = (i: number) => uv.getX(i) * size, V = (i: number) => uv.getY(i) * size;
    for (let f = 0; f < tri; f++) {
      const a = index ? index.getX(f * 3) : f * 3, b = index ? index.getX(f * 3 + 1) : f * 3 + 1, c = index ? index.getX(f * 3 + 2) : f * 3 + 2;
      const w = (hw[a] + hw[b] + hw[c]) / 3;
      if (handV[a] || handV[b] || handV[c]) continue;
      const head = w > 0.5 || Math.min(P[a * 3 + 1], P[b * 3 + 1], P[c * 3 + 1]) > neckY || (hairDiffers && Math.min(P[a * 3 + 1], P[b * 3 + 1], P[c * 3 + 1]) > waist);
      if (!head) continue;
      const x0 = Math.floor(Math.min(U(a), U(b), U(c))), x1 = Math.ceil(Math.max(U(a), U(b), U(c)));
      const y0 = Math.floor(Math.min(V(a), V(b), V(c))), y1 = Math.ceil(Math.max(V(a), V(b), V(c)));
      if (x1 - x0 > 64 || y1 - y0 > 64) continue; // a triangle spanning the atlas is a seam artefact
      // fill the triangle itself (plus a one-texel rim), not its bounding box
      const ax = U(a), ay = V(a), bx = U(b), by = V(b), cx = U(c), cy = V(c);
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-6) continue;
      for (let y = Math.max(0, y0 - 1); y <= Math.min(size - 1, y1 + 1); y++)
        for (let x = Math.max(0, x0 - 1); x <= Math.min(size - 1, x1 + 1); x++) {
          const qx = x + 0.5, qy = y + 0.5;
          const w0 = ((bx - qx) * (cy - qy) - (by - qy) * (cx - qx)) / area;
          const w1 = ((cx - qx) * (ay - qy) - (cy - qy) * (ax - qx)) / area;
          const w2 = 1 - w0 - w1;
          const rim = 1.2 / Math.sqrt(Math.abs(area));
          if (w0 >= -rim && w1 >= -rim && w2 >= -rim) headish[y * size + x] = 1;
        }
    }
    for (let i = 0; i < size * size; i++) if (skinM[i]) headish[i] = 0;
    // loose strands: every head-bound vertex of hair colour starts a fill, and with long hair on a light
    // top, every hair-coloured vertex above the waist does too
    for (let i = 0; i < n; i++)
      if ((hw[i] > 0.5 || (hairDiffers && P[i * 3 + 1] > waist)) && !handV[i] && near(T[i], hair0, 95)) hairSeeds.push(T[i]);
    grow(px, size, hairSeeds.filter((t) => headish[t] && near(t, hair0, 110)), hairM, 30, 165, headish);
    // pack into one small texture: R = skin, G = hair, slightly softened at the edges
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      data[i * 4] = skinM[i];
      data[i * 4 + 1] = skinM[i] ? 0 : hairM[i];
      data[i * 4 + 3] = 255;
    }
    const mask = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    mask.flipY = false;
    mask.magFilter = mask.minFilter = THREE.LinearFilter;
    mask.needsUpdate = true;
    // reference colours from the masks and the regions
    const sr: number[] = [], sg: number[] = [], sb: number[] = [], hl: number[] = [], tl: number[] = [], bl: number[] = [];
    for (let i = 0; i < n; i += 2) {
      const t = T[i], y = P[i * 3 + 1];
      const r = toLin(px[t * 4] / 255), gg = toLin(px[t * 4 + 1] / 255), b = toLin(px[t * 4 + 2] / 255);
      if (skinM[t]) { sr.push(r); sg.push(gg); sb.push(b); }
      else if (hairM[t]) hl.push(lum(r, gg, b));
      else if (y > waist && y < neckY) tl.push(lum(r, gg, b));
      else if (y > ankle && y <= waist) bl.push(lum(r, gg, b));
    }
    if (sr.length < 20) return;
    out = {
      neck: neckY, waist, ankle, mask,
      skin: new THREE.Color(median(sr), median(sg), median(sb)),
      hairLum: Math.max(0.004, median(hl)), topLum: Math.max(0.004, median(tl)), bottomLum: Math.max(0.004, median(bl)),
    };
  });
  statsCache.set(scene, out);
  return out;
}

/** Recolour one instance for one person. Safe to skip: without measurements the model keeps its texture. */
export function personalize(obj: THREE.Object3D, source: THREE.Object3D, look: Look) {
  const st = measure(source);
  if (!st) return [] as THREE.Material[];
  const col = (c: string | undefined) => (c ? new THREE.Color(c) : null);
  const skin = col(look.skin), hair = col(look.hair), top = col(look.top), bottom = col(look.bottom);
  const mats: THREE.Material[] = [];
  obj.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const mat = (sm.material as THREE.MeshStandardMaterial).clone();
    const u = {
      uNeck: { value: st.neck }, uWaist: { value: st.waist }, uAnkle: { value: st.ankle },
      uRefSkin: { value: st.skin }, uSkin: { value: skin ?? st.skin }, uSkinOn: { value: skin ? 1 : 0 },
      uMask: { value: st.mask },
      uHair: { value: hair ?? new THREE.Color(0, 0, 0) }, uHairOn: { value: hair ? 1 : 0 }, uRefHair: { value: st.hairLum },
      uTop: { value: top ?? new THREE.Color(0, 0, 0) }, uTopOn: { value: top && !look.keepClothes ? 1 : 0 }, uRefTop: { value: st.topLum },
      uBot: { value: bottom ?? new THREE.Color(0, 0, 0) }, uBotOn: { value: bottom && !look.keepClothes ? 1 : 0 }, uRefBot: { value: st.bottomLum },
    };
    if (look.debug) (mat as any).defines = { ...((mat as any).defines ?? {}), SP_DEBUG: "" };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vBindY;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n#ifdef USE_SKINNING\nvBindY = (bindMatrix * vec4(position, 1.0)).y;\n#else\nvBindY = position.y;\n#endif");
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying float vBindY;
uniform float uNeck, uWaist, uAnkle, uSkinOn, uHairOn, uTopOn, uBotOn, uRefHair, uRefTop, uRefBot;
uniform sampler2D uMask;
uniform vec3 uRefSkin, uSkin, uHair, uTop, uBot;
`,
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
{
  vec3 c = diffuseColor.rgb;
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec4 mk = texture2D(uMask, vMapUv);
  float sk = mk.r;
  float hairM = mk.g;
  float headR = smoothstep(uNeck - 0.01, uNeck + 0.01, vBindY);
  float feetR = 1.0 - smoothstep(uAnkle - 0.01, uAnkle + 0.01, vBindY);
  float topR = smoothstep(uWaist - 0.015, uWaist + 0.015, vBindY) * (1.0 - headR);
  float botR = (1.0 - headR) * (1.0 - feetR) * (1.0 - topR);
  vec3 cs = clamp(c * (uSkin / max(uRefSkin, vec3(0.003))), 0.0, 1.0);
  vec3 ch = uHair * clamp(0.35 + 0.65 * L / uRefHair, 0.0, 2.2);
  vec3 ct = uTop * clamp(0.3 + 0.7 * L / uRefTop, 0.0, 1.6);
  vec3 cb = uBot * clamp(0.3 + 0.7 * L / uRefBot, 0.0, 1.6);
  c = mix(c, cs, sk * uSkinOn);
  // hair: the mask (long hair included), or anything else above the neck that is not skin
  float hr = max(hairM, headR) * (1.0 - sk);
  c = mix(c, ch, hr * uHairOn);
  topR *= 1.0 - hairM;
  botR *= 1.0 - hairM;
  c = mix(c, ct, (1.0 - sk) * (1.0 - hr) * topR * uTopOn);
  c = mix(c, cb, (1.0 - sk) * (1.0 - hr) * botR * uBotOn);
  diffuseColor.rgb = c;
  #ifdef SP_DEBUG
  diffuseColor.rgb = sk * vec3(1.0, 0.2, 0.2) + (1.0 - sk) * (hr * vec3(0.1, 0.9, 0.2) + (1.0 - hr) * (topR * vec3(0.2, 0.3, 1.0) + botR * vec3(1.0, 0.9, 0.1) + feetR * vec3(0.5)));
  #endif
}`,
        );
    };
    mat.customProgramCacheKey = () => "soulplex-personalize" + (look.debug ? "-debug" : "");
    sm.material = mat;
    mats.push(mat);
  });
  return mats;
}

/*
 * Small gestures layered on top of a model's own clips, applied after the mixer each frame:
 * a wave hello and a listening nod. They rotate bones about axes in world space, so they work
 * whatever the rig's local bone orientations are.
 */
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _ax = new THREE.Vector3();
function turn(bone: THREE.Object3D | undefined, axis: THREE.Vector3, angle: number) {
  if (!bone?.parent || !angle) return;
  bone.parent.getWorldQuaternion(_qp);
  _q.setFromAxisAngle(axis, angle);
  // new world rotation = q * old world rotation, expressed in the parent's frame
  bone.quaternion.premultiply(_qp.clone().invert().multiply(_q).multiply(_qp));
  bone.updateMatrixWorld(true);
}
export type Rig = Record<string, THREE.Bone>;
export function rigOf(obj: THREE.Object3D): Rig {
  const r: Rig = {};
  obj.traverse((o) => {
    if ((o as THREE.Bone).isBone) r[o.name.replace(/^mixamorig:?/i, "")] = o as THREE.Bone;
  });
  return r;
}
/** Raise the right hand and wave. k: 0..1 how far into the gesture; t: time for the waving. */
export function wave(rig: Rig, root: THREE.Object3D, k: number, t: number) {
  if (k <= 0) return;
  root.getWorldQuaternion(_qp);
  const fwd = _ax.set(0, 0, 1).applyQuaternion(_qp).clone();
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(_qp);
  turn(rig.RightArm, fwd, -2.25 * k); // the arm swings up and out to the side (the right hand is on -x)
  turn(rig.RightArm, side, -0.3 * k); // a little forward, toward the person greeted
  turn(rig.RightForeArm, fwd, (-0.5 + Math.sin(t * 11) * 0.4) * k); // the forearm waves
}
/** A gentle listening nod. k: 0..1 strength. */
export function nod(rig: Rig, root: THREE.Object3D, k: number, t: number, ph: number) {
  if (k <= 0) return;
  root.getWorldQuaternion(_qp);
  const side = _ax.set(1, 0, 0).applyQuaternion(_qp).clone();
  turn(rig.Head, side, (Math.max(0, Math.sin(t * 2.4 + ph)) * 0.16 + 0.03) * k);
}
