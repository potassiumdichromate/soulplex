/*
 * Stylised 3D characters (soft, animated-film proportions): a big round head with sculpted
 * eyes, brows, nose and mouth taken from the person's face spec, real 3D hair, an open
 * hoodie over a tee, cargo joggers and chunky sneakers with a glowing stripe.
 *
 * Each body part is built from simple shapes and merged into one or two meshes per joint
 * (lit + glowing), so a character is about a dozen draw calls.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HAIR_COLOR, type FaceSpec } from "../faces";
import { presetFor } from "../characters";

export type Look = {
  seed: string;
  hue: number;
  skin?: string;
  hair?: string;
  outfit?: string;
  spec?: FaceSpec; // illustrated face: sculpt it; missing: show the photo on the face
  face?: string; // photo / image URL for the face
  holo?: boolean; // the agent's glowing hologram twin
};

export type Character = {
  root: THREE.Group;
  legs: { hip: THREE.Group; knee: THREE.Group }[];
  arms: { shoulder: THREE.Group; elbow: THREE.Group }[];
  head: THREE.Group;
  eyes: THREE.Group | null;
  mouth: THREE.Group | null;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
  holoTime?: { value: number };
};

type V3 = [number, number, number];
type Part = { g: THREE.BufferGeometry; c: THREE.Color; glow: boolean };

/** Collects shapes per joint, then merges them into a lit and a glowing mesh. */
class Kit {
  parts = new Map<THREE.Object3D, Part[]>();
  add(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: V3, o: { rot?: V3; scale?: V3; glow?: boolean } = {}) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rot ?? [0, 0, 0]))),
      new THREE.Vector3(...(o.scale ?? [1, 1, 1])),
    );
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    g.applyMatrix4(m);
    const list = this.parts.get(parent) ?? [];
    list.push({ g, c: new THREE.Color(color), glow: !!o.glow });
    this.parts.set(parent, list);
  }
  /** Reshape every part on a joint vertically: fn returns the new y and the local stretch (for normals). */
  mapY(parent: THREE.Object3D, fn: (y: number) => [number, number]) {
    for (const part of this.parts.get(parent) ?? []) {
      const p = part.g.attributes.position as THREE.BufferAttribute, n = part.g.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const [y, k] = fn(p.getY(i));
        p.setY(i, y);
        if (n && k !== 1) {
          const v = new THREE.Vector3(n.getX(i), n.getY(i) / k, n.getZ(i)).normalize();
          n.setXYZ(i, v.x, v.y, v.z);
        }
      }
    }
  }
  bake(lit: THREE.Material, glow: THREE.Material, geos: THREE.BufferGeometry[], shadow: boolean, depthOnly?: THREE.Material) {
    for (const [parent, list] of this.parts) {
      for (const kind of [false, true]) {
        const ps = list.filter((p) => p.glow === kind);
        if (!ps.length) continue;
        for (const p of ps) {
          const n = p.g.attributes.position.count;
          const col = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) col.set([p.c.r, p.c.g, p.c.b], i * 3);
          p.g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        }
        const merged = mergeGeometries(ps.map((p) => p.g));
        ps.forEach((p) => p.g.dispose());
        geos.push(merged);
        const mesh = new THREE.Mesh(merged, kind ? glow : lit);
        mesh.castShadow = shadow && !kind;
        parent.add(mesh);
        if (depthOnly) {
          // hologram: write depth first so only the outer shell glows, not every inner part
          const pre = new THREE.Mesh(merged, depthOnly);
          pre.renderOrder = 4;
          mesh.renderOrder = 5;
          parent.add(pre);
        }
      }
    }
  }
}

/** A soft rim of light in the agent's colour, like the glow around the characters in the references. */
function withRim(mat: THREE.MeshStandardMaterial, rim: THREE.Color, k: number) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: rim };
    sh.uniforms.uRimK = { value: k };
    sh.fragmentShader =
      "uniform vec3 uRim;\nuniform float uRimK;\n" +
      sh.fragmentShader.replace(
        "#include <dithering_fragment>",
        `float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        gl_FragColor.rgb += uRim * pow(rimF, 3.0) * uRimK;
        gl_FragColor.rgb += vColor.rgb * 0.16; // soft fill so faces stay bright at dusk
        #include <dithering_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => "soulplex-rim";
  return mat;
}

/** Translucent, scan-lined hologram for the agent twin. */
export function holoMaterial(color: THREE.Color, time: { value: number }) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uTime: time },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vY = (modelMatrix*vec4(position,1.)).y; vec4 mv = modelViewMatrix*vec4(position,1.);
        vN = normalize(normalMatrix*normal); vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float scan = 0.72 + 0.28*sin(vY*90.0 - uTime*5.0);
        float flick = 0.92 + 0.08*sin(uTime*23.0);
        gl_FragColor = vec4(uColor*(0.55 + f*1.9), (0.1 + f*0.75)*scan*flick); }`,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    blending: THREE.AdditiveBlending,
  });
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const S = (r: number, ws = 24, hs = 18) => new THREE.SphereGeometry(r, ws, hs);
const C = (r: number, len: number, rs = 14) => new THREE.CapsuleGeometry(r, len, 6, rs);
const Cyl = (rt: number, rb: number, h: number, rs = 18) => new THREE.CylinderGeometry(rt, rb, h, rs);
const B = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const T = (r: number, tube: number, arc = Math.PI * 2, rs = 10, ts = 28) => new THREE.TorusGeometry(r, tube, rs, ts, arc);

export function buildCharacter(look: Look): Character {
  const h = hash(look.seed);
  const spec = look.spec;
  const skin = new THREE.Color(look.skin ?? "#d6a07a");
  // buzz cuts are stored with skin-coloured "hair"; use the real hair colour as short stubble
  const hairC =
    spec?.hair === 5
      ? new THREE.Color(HAIR_COLOR[spec.hairColor] ?? "#2b1d18").lerp(new THREE.Color(look.skin ?? "#d6a07a"), 0.25)
      : new THREE.Color(look.hair ?? "#2b1d18");
  const browC = spec && (spec.hair === 7 || spec.hair === 8) ? new THREE.Color(HAIR_COLOR[spec.hairColor] ?? "#2b1d18") : hairC.clone().multiplyScalar(0.8);
  const P = presetFor(spec, look.seed);
  const col = (c: string | undefined, d: string) => new THREE.Color(c ?? d);
  const topC = col(P.topC, "#f3f0f6");
  const topShade = topC.clone().multiplyScalar(0.86);
  const trimC = col(P.trimC, P.topC);
  const innerC = col(P.innerC, "#f3f0f6");
  const pants = col(P.bottomC, "#35313f");
  const pantsShade = pants.clone().multiplyScalar(0.84);
  const shoeAccent = col(P.shoeC, "#c3a6f2");
  const glowC = col(P.strapC ?? P.trimC, P.topC).lerp(new THREE.Color("#ffffff"), 0.25).multiplyScalar(1.5);
  const white = new THREE.Color("#f6f4f8");
  const sole = new THREE.Color("#ffffff");
  const ink = new THREE.Color("#2a2633");
  const gold = new THREE.Color("#d9a640");
  const puffy = P.sleeve === "puffy";
  const kit = new Kit();
  const root = new THREE.Group();

  /* legs: hip -> thigh -> knee -> shin -> shoe */
  const legs: Character["legs"] = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.086, 0.5, 0);
    const knee = new THREE.Group();
    knee.position.y = -0.25;
    if (P.bottom === "wide") {
      kit.add(hip, C(0.09, 0.13), pants, [0, -0.12, 0]);
      kit.add(knee, Cyl(0.086, 0.112, 0.24, 20), pants, [0, -0.11, 0]);
      kit.add(knee, B(0.004, 0.22, 0.004), pantsShade, [0, -0.11, 0.096]); // pressed crease
    } else if (P.bottom === "straight") {
      kit.add(hip, C(0.081, 0.13), pants, [0, -0.12, 0]);
      kit.add(hip, B(0.004, 0.2, 0.004), pantsShade, [0, -0.13, 0.081]);
      kit.add(knee, Cyl(0.075, 0.071, 0.22, 18), pants, [0, -0.1, 0]);
      kit.add(knee, B(0.004, 0.2, 0.004), pantsShade, [0, -0.1, 0.074]);
    } else {
      // roomy cargo joggers: big pockets, gathered ankle cuffs
      kit.add(hip, C(0.092, 0.13), pants, [0, -0.12, 0]);
      kit.add(hip, B(0.046, 0.12, 0.108), pantsShade, [s * 0.086, -0.16, 0.004]);
      kit.add(hip, B(0.052, 0.026, 0.112), pantsShade.clone().multiplyScalar(0.92), [s * 0.087, -0.1, 0.004]);
      kit.add(knee, C(0.086, 0.1), pants, [0, -0.075, 0]);
      kit.add(knee, T(0.068, 0.024, Math.PI * 2, 8, 20), pants, [0, -0.168, 0], { rot: [Math.PI / 2, 0, 0] });
      kit.add(knee, Cyl(0.064, 0.06, 0.04), pantsShade, [0, -0.198, 0]);
      kit.add(knee, Cyl(0.052, 0.052, 0.03), white, [0, -0.214, 0]); // sock
      if (P.bottom === "techcargo") {
        const strap = col(P.strapC, "#b994f2");
        kit.add(hip, B(0.014, 0.17, 0.014), strap, [s * 0.1, -0.11, 0.04]);
        kit.add(hip, B(0.03, 0.02, 0.016), strap, [s * 0.1, -0.2, 0.045]);
        kit.add(hip, B(0.006, 0.09, 0.006), glowC, [s * 0.133, -0.16, 0.02], { glow: true });
      }
    }
    if (P.shoes === "heels") {
      kit.add(knee, C(0.046, 0.07), shoeAccent, [0, -0.238, 0.032], { rot: [Math.PI / 2, 0, 0], scale: [0.95, 1, 0.55] });
      kit.add(knee, B(0.034, 0.05, 0.034), shoeAccent, [0, -0.27, -0.03]);
      kit.add(knee, T(0.04, 0.008, Math.PI * 2, 6, 18), shoeAccent, [0, -0.215, 0.0], { rot: [Math.PI / 2, 0, 0] });
      kit.add(knee, S(0.038), skin, [0, -0.222, 0.05], { scale: [1, 0.55, 1.3] });
    } else {
      kit.add(knee, C(0.072, 0.12), sole, [0, -0.258, 0.04], { rot: [Math.PI / 2, 0, 0], scale: [1.12, 1, 0.52] });
      kit.add(knee, C(0.063, 0.09), white, [0, -0.221, 0.036], { rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.86] });
      for (const t of [-1, 1]) kit.add(knee, B(0.006, 0.036, 0.1), shoeAccent, [t * 0.066, -0.235, 0.042]);
      kit.add(knee, B(0.052, 0.036, 0.03), shoeAccent, [0, -0.214, -0.048]); // heel tab
      kit.add(knee, B(0.044, 0.008, 0.06), shoeAccent.clone().lerp(white, 0.5), [0, -0.19, 0.06]); // laces
      kit.add(knee, S(0.03, 12, 10), shoeAccent, [0, -0.236, 0.118], { scale: [1.5, 0.55, 0.7] }); // toe cap
      kit.add(knee, B(0.006, 0.012, 0.09), glowC, [s * 0.075, -0.262, 0.04], { glow: true });
    }
    hip.add(knee);
    root.add(hip);
    legs.push({ hip, knee });
  }

  /* torso */
  kit.add(root, S(0.124), pants, [0, 0.545, 0], { scale: [1.06, 0.7, 0.86] });
  if (P.belt) {
    kit.add(root, T(0.126, 0.016, Math.PI * 2, 8, 30), col(P.belt, "#1a1718"), [0, 0.585, 0], { rot: [Math.PI / 2, 0, 0], scale: [1, 0.86, 1] });
    kit.add(root, B(0.04, 0.03, 0.012), gold, [0, 0.585, 0.11]);
  }
  const R = puffy ? 0.172 : 0.162;
  const front = (r: number) => r * 0.82; // z of the front surface of a torso of radius r
  // what is worn underneath
  if (P.crop) {
    kit.add(root, C(0.14, 0.05, 18), skin, [0, 0.645, 0], { scale: [1, 1, 0.8] });
    kit.add(root, C(0.15, 0.09, 18), innerC, [0, 0.82, 0], { scale: [1, 1, 0.8] });
  } else {
    kit.add(root, C(R - 0.012, 0.2, 18), innerC, [0, 0.77, 0], { scale: [1, 1, 0.8] });
  }
  const opening = (y0: number, y1: number, w = 0.072) => {
    // the open front of a jacket: the layer underneath shows through
    const cy = (y0 + y1) / 2, len = Math.max(0.01, y1 - y0 - 2 * w);
    if (P.crop && y0 < 0.7) {
      kit.add(root, C(w, Math.max(0.01, y1 - 0.72 - 2 * w), 12), innerC, [0, (0.72 + y1) / 2, front(R) - 0.034], { scale: [1, 1, 0.45] });
      kit.add(root, C(w * 0.9, Math.max(0.01, 0.7 - y0 - 2 * w), 12), skin, [0, (y0 + 0.7) / 2, front(R) - 0.04], { scale: [1, 1, 0.42] });
    } else kit.add(root, C(w, len, 12), innerC, [0, cy, front(R) - 0.034], { scale: [1, 1, 0.45] });
    for (const t of [-1, 1]) kit.add(root, B(0.008, y1 - y0 - 0.04, 0.01), P.zip ? ink : topShade, [t * (w - 0.004), cy, front(R) + 0.002]);
  };
  if (P.top === "sweater") {
    kit.add(root, C(R, 0.2, 18), topC, [0, 0.77, 0], { scale: [1, 1, 0.82] });
    kit.add(root, T(R - 0.008, 0.03, Math.PI * 2, 8, 30), trimC, [0, 0.578, 0], { rot: [Math.PI / 2, 0, 0], scale: [1, 0.82, 1] });
    kit.add(root, T(0.082, 0.03), trimC, [0, 1.0, 0], { rot: [Math.PI / 2, 0, 0] });
    for (let k = -2; k <= 2; k++) kit.add(root, B(0.004, 0.18, 0.004), topShade, [k * 0.05, 0.74, front(R) + 0.002 - Math.abs(k) * 0.012]);
  } else if (P.top === "jacket") {
    if (P.cropOuter) {
      kit.add(root, C(R + 0.004, 0.11, 18), topC, [0, 0.835, 0], { scale: [1, 1, 0.83] });
      kit.add(root, T(R - 0.004, 0.026, Math.PI * 2, 8, 30), trimC, [0, 0.72, 0], { rot: [Math.PI / 2, 0, 0], scale: [1, 0.83, 1] });
      opening(0.72, 0.99);
    } else {
      kit.add(root, C(R, 0.2, 18), topC, [0, 0.77, 0], { scale: [1, 1, 0.82] });
      kit.add(root, T(R - 0.006, 0.028, Math.PI * 2, 8, 30), trimC, [0, 0.585, 0], { rot: [Math.PI / 2, 0, 0], scale: [1, 0.82, 1] });
      opening(0.6, 0.99);
    }
    kit.add(root, T(0.088, 0.034), trimC, [0, 1.0, -0.005], { rot: [Math.PI / 2, 0, 0] });
    if (P.sheer) for (const t of [-1, 1]) kit.add(root, B(0.006, 0.2, 0.006), glowC, [t * 0.12, 0.84, front(R) - 0.02], { glow: true });
  } else if (P.top === "blazer") {
    kit.add(root, C(R + 0.006, 0.26, 18), topC, [0, 0.74, 0], { scale: [1.02, 1, 0.84] });
    opening(0.56, 0.99, 0.07);
    for (const t of [-1, 1]) {
      kit.add(root, B(0.05, 0.17, 0.012), trimC, [t * 0.07, 0.9, front(R) + 0.004], { rot: [0, 0, t * 0.32] }); // lapels
      kit.add(root, B(0.06, 0.012, 0.01), topShade, [t * 0.1, 0.62, front(R) + 0.004]); // pocket flaps
    }
  } else if (P.top === "shirt") {
    kit.add(root, C(R - 0.004, 0.2, 18), topC, [0, 0.77, 0], { scale: [1, 1, 0.82] });
    kit.add(root, B(0.014, 0.3, 0.006), topShade, [0, 0.76, front(R) + 0.002]);
    for (let k = 0; k < 4; k++) kit.add(root, S(0.007, 8, 6), "#6d6670", [0, 0.88 - k * 0.075, front(R) + 0.006]);
    kit.add(root, S(0.032, 12, 10), skin, [0, 0.955, front(0.15) - 0.01], { scale: [1, 1.4, 0.5] }); // open collar
    for (const t of [-1, 1]) kit.add(root, B(0.06, 0.02, 0.05), topC, [t * 0.05, 0.99, 0.075], { rot: [0.3, 0, -t * 0.5] });
  } else if (P.top === "vest") {
    kit.add(root, C(R + 0.014, 0.18, 18), topC, [0, 0.78, 0], { scale: [1, 1, 0.84] });
    for (const y of [0.66, 0.78, 0.9]) kit.add(root, T(R + 0.006, 0.014, Math.PI * 2, 6, 30), topShade, [0, y, 0], { rot: [Math.PI / 2, 0, 0], scale: [1, 0.84, 1] });
    kit.add(root, B(0.008, 0.32, 0.01), ink, [0, 0.78, front(R + 0.014) + 0.004]);
    kit.add(root, T(0.088, 0.036), topC, [0, 1.0, -0.005], { rot: [Math.PI / 2, 0, 0] });
  } else if (P.top === "coat") {
    kit.add(root, C(R + 0.008, 0.2, 18), topC, [0, 0.77, 0], { scale: [1, 1, 0.84] });
    kit.add(root, new THREE.CylinderGeometry(0.168, 0.21, 0.3, 22, 1, true), topC, [0, 0.44, 0], { scale: [1, 1, 0.84] });
    opening(0.58, 0.99, 0.06);
    kit.add(root, Cyl(0.075, 0.08, 0.07), innerC, [0, 1.0, 0]); // turtleneck
    for (const t of [-1, 1]) kit.add(root, B(0.05, 0.16, 0.012), trimC, [t * 0.07, 0.9, front(R) + 0.006], { rot: [0, 0, t * 0.3] });
  }
  if (P.hood) {
    const hc = col(P.hood, "#ffffff");
    kit.add(root, T(0.096, 0.05, Math.PI), hc, [0, 0.99, -0.085], { rot: [-0.25, 0, 0] });
    kit.add(root, S(0.07), hc.clone().multiplyScalar(0.9), [0, 1.0, -0.1], { scale: [1.1, 0.7, 0.6] });
  }
  if (P.star) kit.add(root, new THREE.OctahedronGeometry(0.02), glowC, [-0.1, 0.87, front(R) + 0.004], { glow: true, scale: [1, 1, 0.3] });
  kit.add(root, Cyl(0.052, 0.06, 0.1), skin, [0, 1.03, 0]);
  if (P.necklace) {
    kit.add(root, T(0.075, 0.004, Math.PI * 2, 6, 30), col(P.necklace, "#d9a640"), [0, 0.985, 0.02], { rot: [Math.PI / 2 - 0.45, 0, 0] });
    kit.add(root, S(0.012, 8, 6), col(P.necklace, "#d9a640"), [0, 0.93, 0.115]);
  }
  // bags and headphones
  if (P.bag) {
    const bc = col(P.bag.c, "#1e1b21");
    const strapC = P.bag.kind === "chain" ? gold : P.bag.kind === "sling" ? ink : bc.clone().multiplyScalar(0.9);
    const side = P.bag.kind === "chain" ? 1 : -1;
    kit.add(root, B(0.016, 0.52, 0.01), strapC, [0, 0.78, front(R) + 0.006], { rot: [0, 0, -side * 0.78] });
    if (P.bag.kind === "sling") {
      kit.add(root, C(0.044, 0.08, 10), bc, [side * 0.15, 0.63, front(R) - 0.02], { rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.62] });
      kit.add(root, B(0.06, 0.008, 0.006), "#8e8a94", [side * 0.15, 0.645, front(R) + 0.008]);
    } else {
      kit.add(root, B(0.1, 0.075, 0.042), bc, [side * 0.17, 0.62, front(R) - 0.025]);
      kit.add(root, B(0.104, 0.032, 0.046), bc.clone().multiplyScalar(0.9), [side * 0.17, 0.646, front(R) - 0.024]);
      kit.add(root, B(0.018, 0.014, 0.006), gold, [side * 0.17, 0.632, front(R) - 0.0]);
    }
  }
  if (P.headphones) {
    const hp = col(P.headphones, "#2a2638");
    kit.add(root, T(0.1, 0.017, Math.PI * 2, 8, 24), hp, [0, 1.0, 0.02], { rot: [Math.PI / 2 + 0.3, 0, 0] });
    for (const t of [-1, 1]) {
      kit.add(root, Cyl(0.038, 0.038, 0.034, 16), hp, [t * 0.106, 0.985, 0.05], { rot: [0, 0, Math.PI / 2] });
      kit.add(root, Cyl(0.024, 0.024, 0.036, 14), hp.clone().lerp(new THREE.Color("#b994f2"), 0.5), [t * 0.108, 0.985, 0.05], { rot: [0, 0, Math.PI / 2] });
    }
  }

  /* arms: shoulder -> sleeve -> elbow -> sleeve, cuff, hand */
  const arms: Character["arms"] = [];
  const sleeveC = P.top === "vest" ? innerC : topC;
  const cuffC = P.top === "vest" ? innerC.clone().multiplyScalar(0.9) : trimC;
  const sR = puffy ? 0.068 : 0.059;
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.205, 0.93, 0);
    kit.add(shoulder, S(sR + 0.008), sleeveC, [0, 0, 0]);
    kit.add(shoulder, C(sR, 0.12), sleeveC, [0, -0.1, 0]);
    if (P.patches) kit.add(shoulder, B(0.006, 0.036, 0.042), col(P.patches, "#ffffff"), [s * (sR - 0.001), -0.07, 0]);
    const elbow = new THREE.Group();
    elbow.position.y = -0.2;
    if (P.sleeve === "rolled") {
      kit.add(elbow, Cyl(sR + 0.006, sR + 0.002, 0.05), sleeveC.clone().multiplyScalar(0.9), [0, -0.005, 0]);
      kit.add(elbow, C(0.043, 0.1), skin, [0, -0.09, 0]);
    } else {
      kit.add(elbow, C(sR - 0.005, 0.09), sleeveC, [0, -0.065, 0]);
      if (puffy) {
        kit.add(elbow, T(0.05, 0.02, Math.PI * 2, 8, 20), cuffC, [0, -0.135, 0], { rot: [Math.PI / 2, 0, 0] });
        kit.add(elbow, Cyl(0.05, 0.047, 0.04), cuffC, [0, -0.145, 0]);
      } else kit.add(elbow, Cyl(sR - 0.002, sR - 0.008, 0.04), cuffC, [0, -0.132, 0]);
    }
    if (s < 0 && P.watch) {
      kit.add(elbow, Cyl(0.046, 0.046, 0.022), col(P.watch, "#1c1a20"), [0, -0.165, 0]);
      kit.add(elbow, B(0.026, 0.02, 0.01), glowC, [0, -0.165, 0.045], { glow: true });
    }
    if (s > 0 && P.bracelet) kit.add(elbow, T(0.044, 0.006, Math.PI * 2, 6, 18), col(P.bracelet, "#d9a640"), [0, -0.168, 0], { rot: [Math.PI / 2, 0, 0] });
    kit.add(elbow, S(0.053), skin, [0, -0.198, 0.005], { scale: [0.9, 1.05, 0.85] });
    kit.add(elbow, S(0.02), skin, [-s * 0.035, -0.183, 0.025]);
    shoulder.add(elbow);
    shoulder.rotation.z = s * 0.08;
    root.add(shoulder);
    arms.push({ shoulder, elbow });
  }

  /* head: pivots at the neck so nods look natural */
  const head = new THREE.Group();
  head.position.y = 1.07;
  const HC: V3 = [0, 0.21, 0]; // centre of the skull inside the head group
  kit.add(head, S(0.25, 40, 30), skin, HC, { scale: [1, 0.98, 0.95] });
  kit.add(head, S(0.165, 28, 20), skin, [0, 0.12, 0.06], { scale: [1.05, 0.85, 0.95] }); // round cheeks and chin
  const covered = spec ? spec.hair === 8 : false;
  if (!covered) for (const s of [-1, 1]) kit.add(head, S(0.045, 14, 10), skin, [s * 0.245, 0.2, 0], { scale: [0.5, 1, 0.8] });

  let eyes: THREE.Group | null = null;
  let mouth: THREE.Group | null = null;
  const extra: THREE.Mesh[] = [];
  if (spec) {
    const ink = new THREE.Color("#2a1a22");
    const iris = new THREE.Color(["#5a3524", "#3b2a20", "#6b4a2c", "#2f3f5c"][h % 4]);
    eyes = new THREE.Group();
    eyes.position.set(0, 0.205, 0);
    head.add(eyes);
    for (const s of [-1, 1]) {
      const x = s * 0.088;
      if (spec.eyes === 2) {
        kit.add(eyes, T(0.033, 0.0085, Math.PI, 8, 18), ink, [x, -0.008, 0.232]); // smiling closed eyes
      } else {
        kit.add(eyes, S(0.061, 24, 18), "#fbfbff", [x, 0, 0.21], { scale: [0.82, 1, 0.42] });
        kit.add(eyes, S(0.041, 20, 14), iris, [x, -0.004, 0.231], { scale: [1, 1.08, 0.3] });
        kit.add(eyes, S(0.023, 14, 10), "#120a10", [x, -0.004, 0.239], { scale: [1, 1, 0.3] });
        kit.add(eyes, S(0.013, 10, 8), "#ffffff", [x + 0.015, 0.017, 0.244], { glow: true });
        kit.add(eyes, S(0.006, 8, 6), "#ffffff", [x - 0.011, -0.016, 0.244], { glow: true });
        kit.add(eyes, T(0.045, 0.006, Math.PI * 0.8, 6, 16), ink, [x, 0.004, 0.226], { rot: [0, 0, Math.PI * 0.1] }); // upper lid line
        if (spec.eyes === 1)
          for (let k = 0; k < 3; k++)
            kit.add(eyes, C(0.004, 0.022, 6), ink, [x + s * (0.03 + k * 0.009), 0.036 - k * 0.008, 0.226], { rot: [0, 0, -s * (0.5 + k * 0.35)] });
      }
    }
    const browY = 0.28 + (spec.brows === 2 ? 0.014 : 0);
    for (const s of [-1, 1]) {
      const tilt = spec.brows === 1 ? 0.04 : spec.brows === 2 ? 0.3 : 0.16;
      kit.add(head, C(spec.brows === 1 ? 0.012 : 0.0085, 0.05, 8), browC, [s * 0.09, browY, 0.226], { rot: [0, 0, Math.PI / 2 - s * tilt] });
    }
    kit.add(head, S(0.02, 16, 12), skin.clone().multiplyScalar(0.96), [0, 0.152, 0.247], { scale: [1.1, 0.8, 0.75] });
    for (const s of [-1, 1]) kit.add(head, S(0.03, 14, 10), skin.clone().lerp(new THREE.Color("#ff8a9a"), 0.45), [s * 0.135, 0.135, 0.196], { scale: [1, 0.7, 0.25] });
    const beard = spec.facial === 1;
    if (beard) kit.add(head, new THREE.SphereGeometry(0.262, 32, 14, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.4), hairC, HC, { scale: [1, 1, 0.97] });
    if (spec.facial === 2) {
      kit.add(head, C(0.011, 0.05, 8), hairC, [0, 0.122, 0.238], { rot: [0, 0, Math.PI / 2] });
      for (const s of [-1, 1]) kit.add(head, S(0.014, 10, 8), hairC, [s * 0.03, 0.117, 0.236]);
    }
    mouth = new THREE.Group();
    mouth.position.set(0, 0.097, beard ? 0.244 : 0.224);
    head.add(mouth);
    const lip = new THREE.Color("#7a2f3a");
    if (spec.mouth === 1) {
      kit.add(mouth, new THREE.SphereGeometry(0.04, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lip, [0, 0.01, 0], { scale: [1, 0.85, 0.35] });
      kit.add(mouth, B(0.05, 0.012, 0.012), "#ffffff", [0, 0.003, 0.006]);
    } else if (spec.mouth === 2) {
      kit.add(mouth, T(0.022, 0.0068, Math.PI, 6, 16), lip, [0, 0.012, 0], { rot: [0, 0, Math.PI] });
    } else {
      kit.add(mouth, T(0.035, 0.0078, Math.PI, 6, 20), lip, [0, 0.022, 0], { rot: [0, 0, Math.PI] });
    }
    if (spec.accessory === 1) {
      const frame = new THREE.Color("#1d1530");
      for (const s of [-1, 1]) {
        kit.add(head, T(0.05, 0.0065, Math.PI * 2, 8, 28), frame, [s * 0.088, 0.205, 0.252]);
        kit.add(head, B(0.006, 0.006, 0.2), frame, [s * 0.14, 0.215, 0.15], { rot: [0, -s * 0.25, 0] });
      }
      kit.add(head, B(0.035, 0.006, 0.006), frame, [0, 0.212, 0.256]);
    }
    if (spec.accessory === 2) kit.add(head, S(0.009, 10, 8), "#d6203f", [0, 0.26, 0.246]);
    if (spec.accessory === 3 && !covered) for (const s of [-1, 1]) kit.add(head, S(0.016, 10, 8), "#ffd27a", [s * 0.248, 0.135, 0.01]);
    if (spec.accessory === 4) {
      const fl: V3 = [0.15, 0.4, 0.11];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        kit.add(head, S(0.022, 10, 8), "#ff8fb8", [fl[0] + Math.cos(a) * 0.024, fl[1] + Math.sin(a) * 0.024, fl[2]]);
      }
      kit.add(head, S(0.015, 10, 8), "#ffd58a", [fl[0], fl[1], fl[2] + 0.01]);
    }
  } else if (look.face) {
    // photo faces: the photo wraps the front of the head
    const tex = new THREE.TextureLoader().load(look.face);
    tex.colorSpace = THREE.SRGBColorSpace;
    const cap = 1.0;
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.258, 32, 24, Math.PI / 2 - cap, cap * 2, Math.PI / 2 - cap, cap * 2),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    m.position.set(...HC);
    head.add(m);
    extra.push(m);
  }

  /* hair */
  const hs = spec?.hair ?? 0;
  const short = hs === 0 || hs === 3 || hs === 4 || hs === 5;
  const beanie = !!P.beanie && short;
  const cap = !!P.cap && short && !beanie;
  const top = (r = 0.264, thetaLen = 0.3) => kit.add(head, new THREE.SphereGeometry(r, 36, 14, 0, Math.PI * 2, 0, Math.PI * thetaLen), hairC, HC, { scale: [1.02, 1, 0.98] });
  const back = (r = 0.266, thetaLen = 0.66, open = 1.22) =>
    kit.add(head, new THREE.SphereGeometry(r, 36, 20, Math.PI / 2 + open, Math.PI * 2 - open * 2, 0, Math.PI * thetaLen), hairC, HC, { scale: [1.02, 1, 0.98] });
  const lump = (pos: V3, r: number, scale: V3, rot: V3 = [0, 0, 0], c = hairC) => kit.add(head, S(r, 18, 14), c, pos, { scale, rot });
  if (hs === 7) {
    // turban
    kit.add(head, T(0.235, 0.062, Math.PI * 2, 12, 36), hairC, [0, 0.33, -0.01], { rot: [Math.PI / 2 - 0.15, 0, 0] });
    kit.add(head, T(0.19, 0.06, Math.PI * 2, 12, 32), hairC.clone().multiplyScalar(0.92), [0, 0.39, -0.02], { rot: [Math.PI / 2 + 0.12, 0, 0] });
    lump([0, 0.42, -0.02], 0.2, [1, 0.62, 1]);
    lump([0, 0.37, 0.235], 0.05, [1.2, 0.9, 0.7], [0, 0, 0], hairC.clone().multiplyScalar(0.85));
  } else if (hs === 8) {
    // hijab
    kit.add(head, new THREE.SphereGeometry(0.288, 36, 24, Math.PI / 2 + 1.05, Math.PI * 2 - 2.1, 0, Math.PI * 0.9), hairC, HC);
    kit.add(head, new THREE.SphereGeometry(0.29, 36, 14, 0, Math.PI * 2, 0, Math.PI * 0.32), hairC, HC);
    kit.add(head, T(0.205, 0.028, Math.PI * 2, 10, 40), hairC.clone().multiplyScalar(0.92), [0, 0.18, 0.13], { scale: [1, 1.22, 1] });
    kit.add(head, new THREE.CylinderGeometry(0.18, 0.3, 0.26, 28, 1, true), hairC, [0, -0.03, 0]);
  } else if (beanie) {
    back(0.262, 0.62, 1.3);
    const knit = new THREE.Color(P.beanie ?? "#2c2934");
    kit.add(head, new THREE.SphereGeometry(0.276, 36, 16, 0, Math.PI * 2, 0, Math.PI * 0.4), knit, [0, 0.215, -0.01], { scale: [1.0, 1.22, 0.98] });
    kit.add(head, S(0.05, 12, 10), knit.clone().multiplyScalar(0.9), [0, 0.55, -0.03], { scale: [1.1, 0.7, 1.1] }); // soft fold at the top
    kit.add(head, T(0.257, 0.026, Math.PI * 2, 10, 40), knit.clone().multiplyScalar(0.82), [0, 0.33, -0.006], { rot: [Math.PI / 2 + 0.1, 0, 0] });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      kit.add(head, B(0.008, 0.06, 0.008), knit.clone().multiplyScalar(0.9), [Math.cos(a) * 0.256, 0.335, Math.sin(a) * 0.25], { rot: [0, -a, 0] });
    }
    for (const t of [-1, 1]) lump([t * 0.218, 0.27, 0.07], 0.05, [0.7, 1.1, 0.9]); // hair peeking out
  } else if (cap) {
    back(0.262, 0.62, 1.3);
    const cc = new THREE.Color(P.cap ?? "#f5f2ee");
    kit.add(head, new THREE.SphereGeometry(0.274, 36, 14, 0, Math.PI * 2, 0, Math.PI * 0.4), cc, [0, 0.215, -0.01], { scale: [1, 1.08, 1] });
    kit.add(head, Cyl(0.15, 0.15, 0.014, 24), cc.clone().multiplyScalar(0.94), [0, 0.37, 0.2], { rot: [-0.18, 0, 0], scale: [1, 1, 0.85] });
    kit.add(head, S(0.016, 8, 6), cc.clone().multiplyScalar(0.85), [0, 0.5, -0.01]);
    for (const t of [-1, 1]) lump([t * 0.218, 0.27, 0.06], 0.05, [0.7, 1.1, 0.9]);
  } else if (hs === 5) {
    // buzz cut
    top(0.253, 0.32);
    back(0.254, 0.6, 1.25);
  } else {
    top();
    back(0.266, hs === 2 ? 0.58 : 0.66);
    if (hs === 3) {
      // curls all over
      const n = 46;
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 1.25;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const a = i * 2.39996;
        const p = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
        if (p.z > 0.25 && p.y < 0.5) continue; // keep the face clear
        if (p.y < -0.05) continue; // short and tousled, not a full afro
        lump([p.x * 0.262, HC[1] + p.y * 0.262, p.z * 0.262], 0.054 + (i % 3) * 0.008, [1.15, 0.85, 1.05], [i * 0.7, i * 1.3, 0]);
      }
    } else if (hs === 4) {
      lump([0.06, 0.39, 0.15], 0.12, [1.6, 0.52, 0.9], [0, 0, -0.32]);
      lump([-0.05, 0.44, 0.04], 0.15, [1.35, 0.55, 1.3]);
    } else if (hs === 1 || hs === 6) {
      // long or wavy: curtain fringe, side locks, hair down the back
      lump([-0.08, 0.37, 0.16], 0.11, [1.25, 0.55, 0.8], [0, 0, 0.38]);
      lump([0.08, 0.37, 0.16], 0.11, [1.25, 0.55, 0.8], [0, 0, -0.38]);
      for (const s of [-1, 1]) kit.add(head, C(0.055, hs === 1 ? 0.24 : 0.14), hairC, [s * 0.205, hs === 1 ? 0.05 : 0.1, 0.05], { rot: [0.1, 0, s * 0.08] });
      if (hs === 1) {
        kit.add(head, C(0.19, 0.24, 18), hairC, [0, 0.02, -0.11], { scale: [1.18, 1, 0.5] });
        for (const t of [-1, 0, 1]) lump([t * 0.13, -0.16, -0.1 + Math.abs(t) * 0.03], 0.085, [1, 1, 0.7]); // soft ends
        for (const t of [-1, 1]) lump([t * 0.215, -0.1, 0.07], 0.058, [0.9, 1.2, 0.9]); // face-framing locks
        // full, wavy volume over the shoulders, like the character sheets
        for (const t of [-1, 1])
          for (let k = 0; k < 4; k++) lump([t * (0.235 + (k % 2) * 0.02), 0.12 - k * 0.09, -0.02 - (k % 2) * 0.03], 0.075, [0.9, 1.15, 1]);
        for (let k = 0; k < 5; k++) lump([-0.16 + k * 0.08, -0.06 - (k % 2) * 0.05, -0.17], 0.08, [1, 1.3, 0.8]);
      }
      else {
        // wavy: shoulder-length waves all round
        for (let k = 0; k < 9; k++) {
          const a = Math.PI * (-0.12 + (k / 8) * 1.24);
          for (const dy of [0.07, -0.05]) lump([Math.cos(a) * 0.215, dy + (k % 2) * 0.025, -Math.sin(a) * 0.17], 0.08, [1, 1.15, 0.9]);
        }
      }
    } else if (hs === 2) {
      // bun
      lump([0.0, 0.36, 0.17], 0.1, [1.6, 0.5, 0.8]);
      lump([0, 0.49, -0.09], 0.11, [1, 1, 1]);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        lump([Math.cos(a) * 0.08, 0.5 + Math.sin(a) * 0.06, -0.09 + Math.sin(a * 2) * 0.03], 0.055, [1, 1, 1]); // messy bun
      }
      kit.add(head, T(0.075, 0.018), new THREE.Color(P.scrunchie ?? P.trimC ?? P.topC), [0, 0.43, -0.07], { rot: [1.2, 0, 0] }); // scrunchie
      for (const t of [-1, 1]) kit.add(head, C(0.014, 0.14, 6), hairC, [t * 0.2, 0.2, 0.15], { rot: [0.2, 0, -t * 0.14] }); // loose strands
    } else {
      // short, with a soft swoop at the front
      for (let i = -2; i <= 2; i++)
        lump([i * 0.058, 0.375 - Math.abs(i) * 0.012, 0.165 - Math.abs(i) * 0.022], 0.075, [1.15, 0.55, 0.8], [0, 0, -i * 0.22]);
      lump([0.0, 0.44, 0.02], 0.15, [1.4, 0.58, 1.3]);
      lump([0.07, 0.45, 0.13], 0.07, [1.3, 0.8, 1], [0.4, 0, -0.4]);
      for (const t of [-1, 1]) lump([t * 0.19, 0.34, 0.03], 0.08, [0.8, 0.95, 1.15]); // side volume
      lump([-0.07, 0.48, 0.07], 0.07, [1.2, 0.75, 1], [0.3, 0, 0.5]); // messy tufts on top
      lump([0.03, 0.49, -0.05], 0.075, [1.2, 0.7, 1.1], [-0.3, 0, -0.3]);
      lump([0.12, 0.44, 0.03], 0.065, [1, 0.8, 1], [0, 0, -0.7]);
    }
  }

  /* hair clips and earrings from the outfit */
  if (P.flower && hs !== 7 && hs !== 8) {
    const fc = new THREE.Color(P.flower);
    const fl: V3 = [-0.16, 0.4, 0.15];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      kit.add(head, S(0.022, 10, 8), fc, [fl[0] + Math.cos(a) * 0.024, fl[1] + Math.sin(a) * 0.024, fl[2]], { scale: [1, 1, 0.6] });
    }
    kit.add(head, S(0.014, 10, 8), "#fff3c4", [fl[0], fl[1], fl[2] + 0.01]);
  }
  if (P.earrings && !covered && spec?.accessory !== 3) {
    const ec = new THREE.Color(P.earrings.c);
    for (const t of [-1, 1]) {
      if (P.earrings.kind === "hoop") kit.add(head, T(0.016, 0.0045, Math.PI * 2, 6, 16), ec, [t * 0.25, 0.13, 0.01], { rot: [0, Math.PI / 2, 0] });
      else {
        kit.add(head, S(0.01, 8, 6), ec, [t * 0.25, 0.145, 0.01]);
        kit.add(head, new THREE.OctahedronGeometry(0.016), ec, [t * 0.25, 0.115, 0.01], { scale: [0.8, 1.2, 0.8] });
      }
    }
  }

  /* materials */
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const rimC = new THREE.Color().setHSL(look.hue / 360, 0.85, 0.66);
  let holoTime: { value: number } | undefined;
  let lit: THREE.Material, glow: THREE.Material;
  let depthOnly: THREE.Material | undefined;
  if (look.holo) {
    holoTime = { value: 0 };
    lit = glow = holoMaterial(rimC, holoTime);
    extra.forEach((m) => (m.visible = false));
    depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
    mats.push(depthOnly);
  } else {
    lit = withRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 }), rimC, 0.32);
    glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  }
  mats.push(lit);
  if (glow !== lit) mats.push(glow);
  for (const m of extra) mats.push(m.material as THREE.Material), geos.push(m.geometry);
  /* proportions like the character sheets: longer legs and arms, a taller torso, a smaller head */
  const DY = 0.11, TS = 1.12;
  kit.mapY(root, (y) => [0.54 + DY + (y - 0.54) * TS, TS]);
  for (const { hip, knee } of legs) {
    hip.position.y = 0.61;
    knee.position.y = -0.31;
    kit.mapY(hip, (y) => [y * 1.24, 1.24]);
    kit.mapY(knee, (y) => (y > -0.2 ? [y * 1.25, 1.25] : [y - 0.05, 1])); // the shin stretches, the shoe keeps its shape
  }
  for (const { shoulder, elbow } of arms) {
    shoulder.position.y = 0.54 + DY + (0.93 - 0.54) * TS;
    elbow.position.y = -0.236;
    kit.mapY(shoulder, (y) => [y * 1.18, 1.18]);
    kit.mapY(elbow, (y) => (y > -0.14 ? [y * 1.18, 1.18] : [y - 0.0252, 1]));
  }
  head.position.y = 0.54 + DY + (1.07 - 0.54) * TS;
  head.scale.setScalar(0.8);
  kit.bake(lit, glow, geos, !look.holo, depthOnly);

  root.add(head);
  return { root, legs, arms, head, eyes, mouth, mats, geos, holoTime };
}
