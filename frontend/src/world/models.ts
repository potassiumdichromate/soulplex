/*
 * Real 3D character models (GLB), e.g. made from the character sheets with Meshy, Tripo
 * or Rodin and rigged/animated with Mixamo.
 *
 * Drop the files in `frontend/public/models/` (served at /models/) and list them in
 * `models.json`, keyed by outfit look id (see characters.ts):
 *
 *   { "lavender": "lavender.glb", "blackbomber": "black-bomber.glb", "*": "fallback.glb" }
 *
 * "*" (optional) is used for every look without its own model. Looks without a model keep
 * the code-built character, so models can be added one at a time.
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

export type ModelEntry = { scene: THREE.Object3D; clips: THREE.AnimationClip[]; height: number; minY: number };

export const MODEL_BASE = "models/";
let manifest: Promise<Record<string, any>> | null = null;
let sharedClips: Promise<THREE.AnimationClip[]> | null = null;
const cache = new Map<string, Promise<ModelEntry | null>>();
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function getManifest() {
  manifest ??= fetch(MODEL_BASE + "models.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return manifest;
}

const loadGlb = (file: string) => new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] } | null>((resolve) => loader.load(MODEL_BASE + file, (g) => resolve(g), undefined, () => resolve(null)));

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
export async function modelFor(lookId: string): Promise<ModelEntry | null> {
  const m = await getManifest();
  const file: string | undefined = typeof m[lookId] === "string" ? m[lookId] : typeof m["*"] === "string" ? m["*"] : undefined;
  if (!file) return null;
  const shared = await getSharedClips();
  if (!cache.has(file))
    cache.set(
      file,
      new Promise((resolve) =>
        loader.load(
          MODEL_BASE + file,
          (g) => {
            g.scene.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(g.scene);
            // the model's own clips win; shared movements fill in the rest
            const clips = [...g.animations, ...shared.filter((c) => !g.animations.some((o) => o.name.toLowerCase().includes(c.name.toLowerCase())))];
            resolve({ scene: g.scene, clips, height: Math.max(0.01, box.max.y - box.min.y), minY: box.min.y });
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
