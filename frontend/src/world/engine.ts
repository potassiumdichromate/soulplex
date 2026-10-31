/*
 * Soulplex world engine.
 * An archipelago at dusk above a living sea. Idle agents wander the home island;
 * every kind of date has its own island with 2-3 date spots. On a date two
 * characters walk to their spot and a thread of light flows between them.
 * Everything is procedural (no external assets).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { DATE_TYPES } from "../dateTypes";

export type WorldMode = "landing" | "home" | "date" | "calm";
export type AgentInfo = { id: string; name: string; hue: number; self?: boolean; face?: string; skin?: string; hair?: string; hairStyle?: number; outfit?: string };
export type DateInfo = {
  id?: string; // the date's id, so the same date isn't drawn twice
  type: string; // date type = island id
  spot?: number; // which of the island's 2-3 spots
  mode?: "sit" | "stand" | "walk";
  a: AgentInfo;
  b: AgentInfo;
  phase: "walking" | "talking" | "done";
  score?: number;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Phones: cheap materials, no bloom or shadows, and much smaller people. */
let MOBILE = false;
function detectMobile() {
  const coarse = matchMedia("(pointer: coarse)").matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return innerWidth < 820 || (coarse && innerWidth < 1100) || (mem != null && mem <= 4 && coarse);
}
function bodyScale(self: boolean) {
  return MOBILE ? (self ? 0.34 : 0.28) : self ? 1.5 : 1.4;
}
function dateScale() {
  return MOBILE ? 0.24 : 1.25;
}
const sharedGeos = new Map<string, THREE.BufferGeometry>();
function sharedGeo(key: string, make: () => THREE.BufferGeometry) {
  let g = sharedGeos.get(key);
  if (!g) sharedGeos.set(key, (g = make()));
  return g;
}
const capsule = (r: number, len: number, key: string) =>
  sharedGeo(key, () => new THREE.CapsuleGeometry(r, len, MOBILE ? 1 : 4, MOBILE ? 5 : 10));
const MOON_DIR = new THREE.Vector3(-0.45, 0.42, -0.78).normalize();

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function glowTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, inner.replace(/[\d.]+\)$/, "0.55)"));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelSprite(text: string, color: string) {
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = "600 44px Manrope, Inter, system-ui, sans-serif";
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 56;
  c.width = w;
  c.height = 84;
  g.font = font;
  g.fillStyle = "rgba(14,10,34,0.62)";
  const r = 40;
  g.beginPath();
  g.roundRect(2, 2, w - 4, 80, r);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = "#fff";
  g.textBaseline = "middle";
  g.fillText(text, 28, 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, sizeAttenuation: false }),
  );
  s.scale.set((w / 84) * 0.024, 0.024, 1);
  s.renderOrder = 10;
  return s;
}

/* ------------------------------------------------------------------ */
/*  Person: one agent, a small walking character with the chosen face  */
/* ------------------------------------------------------------------ */
const angleLerp = (a: number, b: number, t: number) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

class Wisp {
  /** Things idle agents walk around on the home island. */
  static obstacles: { p: THREE.Vector3; r: number }[] = [];
  group = new THREE.Group();
  root = new THREE.Group(); // body, rotates to face walking direction
  head = new THREE.Group();
  label: THREE.Sprite;
  marker: THREE.Mesh;
  legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  arms: { shoulder: THREE.Group; elbow: THREE.Group }[] = [];
  ghostLegs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  ghostArms: { shoulder: THREE.Group; elbow: THREE.Group }[] = [];
  ghostHead: THREE.Group | null = null;
  target = new THREE.Vector3();
  vel = new THREE.Vector3();
  phase = Math.random() * 10;
  walk = 0;
  wait = Math.random() * 2;
  pinned: THREE.Vector3 | null = null;
  lookAt: THREE.Vector3 | null = null;
  seated = false;
  pose: "sit" | "stand" = "sit";
  follow = false; // walking-date mode: pinned is a moving target
  greet = 0;
  wasSeated = false;
  color: THREE.Color;
  speed = rand(0.75, 1.0);
  size = 1;
  mats: THREE.Material[] = [];

  constructor(public info: AgentInfo, _glow: THREE.Texture, islandR: number) {
    this.color = new THREE.Color().setHSL(info.hue / 360, 0.75, 0.6);
    const mat = (c: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, ...extra });
      this.mats.push(m);
      return m;
    };
    const style = info.hairStyle ?? 0;
    const long = style === 1 || style === 2 || style === 3 || style === 6;
    const feminine = long || style === 8;
    const skin = mat(info.skin ?? "#d6a07a", { roughness: 0.48, metalness: 0.02 });
    const hair = mat(style === 7 || style === 8 ? (info.hair ?? "#2b1d18") : feminine ? "#6a4332" : "#241c1a", { roughness: 0.62, metalness: 0.03 });
    const hoodie = mat("#f6f3fb", { roughness: 0.55, metalness: 0.02 });
    const shirt = mat(feminine ? "#fffdfb" : "#1b1824", { roughness: 0.5 });
    const pants = mat(feminine ? "#cbb6ea" : "#2c3140", { roughness: 0.6 });
    const shoes = mat("#f7f4ef", { roughness: 0.35, metalness: 0.08 });
    const sole = mat("#efe7ff", { roughness: 0.3, emissive: feminine ? "#e7b6ff" : "#9fd4ff", emissiveIntensity: 0.85 });
    const ghostMat = new THREE.MeshBasicMaterial({
      color: feminine ? "#ff8ec8" : "#8fd7ff",
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mats.push(ghostMat);
    const part = (geo: THREE.BufferGeometry, m: THREE.Material, y: number, parent: THREE.Object3D, x = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = !MOBILE;
      parent.add(mesh);
      return mesh;
    };
    // legs: hip -> thigh -> knee -> shin -> shoe
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.085, 0.5, 0);
      part(capsule(0.068, 0.15, "thigh"), pants, -0.125, hip);
      const knee = new THREE.Group();
      knee.position.y = -0.25;
      part(capsule(0.06, 0.15, "shin"), pants, -0.12, knee);
      part(sharedGeo("shoe", () => new THREE.BoxGeometry(0.12, 0.055, 0.2)), shoes, -0.24, knee, 0, 0.04);
      part(sharedGeo("sole", () => new THREE.BoxGeometry(0.1, 0.02, 0.16)), sole, -0.275, knee, 0, 0.045);
      hip.add(knee);
      this.root.add(hip);
      this.legs.push({ hip, knee });
    }
    // hoodie over a shirt, with a small pack like the island twins
    const torso = part(capsule(0.165, 0.22, "torso"), hoodie, 0.78, this.root);
    torso.scale.set(1.05, 1, 0.82);
    part(sharedGeo("shirt", () => new THREE.SphereGeometry(0.07, MOBILE ? 6 : 10, MOBILE ? 5 : 8)), shirt, 0.9, this.root, 0, 0.06).scale.set(1.3, 0.7, 0.4);
    const hood = part(sharedGeo("hood", () => new THREE.SphereGeometry(0.11, MOBILE ? 8 : 12, MOBILE ? 6 : 10)), hoodie, 1.08, this.root, 0, -0.06);
    hood.scale.set(1.15, 0.7, 0.7);
    const pack = part(sharedGeo("pack", () => new THREE.BoxGeometry(0.16, 0.2, 0.07)), hoodie, 0.8, this.root, 0, -0.14);
    pack.rotation.x = 0.08;
    part(sharedGeo("neck", () => new THREE.CylinderGeometry(0.06, 0.07, 0.1, MOBILE ? 6 : 10)), skin, 1.03, this.root);
    // arms: shoulder -> upper arm -> elbow -> forearm -> hand
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.215, 0.93, 0);
      part(sharedGeo("shoulder", () => new THREE.SphereGeometry(0.072, MOBILE ? 6 : 12, MOBILE ? 5 : 10)), hoodie, 0.01, shoulder);
      part(capsule(0.052, 0.13, "arm"), hoodie, -0.1, shoulder);
      const elbow = new THREE.Group();
      elbow.position.y = -0.2;
      part(capsule(0.045, 0.11, "forearm"), skin, -0.085, elbow);
      part(sharedGeo("hand", () => new THREE.SphereGeometry(0.052, MOBILE ? 6 : 10, MOBILE ? 5 : 8)), skin, -0.175, elbow);
      shoulder.add(elbow);
      shoulder.rotation.z = side * 0.08;
      this.root.add(shoulder);
      this.arms.push({ shoulder, elbow });
    }
    // Rounded head. Hair is a solid volume over the forehead, not a cap stuck on the back.
    // Longer styles continue that volume down to the shoulders.
    this.head.position.y = 1.28;
    const skull = part(sharedGeo("skull", () => new THREE.SphereGeometry(0.2, MOBILE ? 12 : 24, MOBILE ? 10 : 18)), skin, 0.01, this.head);
    skull.scale.set(0.96, 1.02, 0.9);
    skull.position.z = 0.02;
    const covered = style === 7 || style === 8;
    const segs = MOBILE ? 10 : 18;
    const crown = part(
      sharedGeo("hair-crown" + (long ? "-long" : ""), () => new THREE.SphereGeometry(long ? 0.268 : 0.236, segs, MOBILE ? 8 : 14)),
      hair,
      long ? 0.07 : 0.055,
      this.head,
    );
    crown.scale.set(long ? 1.04 : 1.0, long ? 0.78 : 0.72, long ? 0.98 : 1.02);
    crown.position.set(0, long ? 0.1 : 0.085, long ? -0.07 : -0.055);
    if (style === 5) crown.scale.set(1.0, 0.55, 1.04);
    if (!covered) {
      const fringe = part(
        sharedGeo("hair-fringe-ball", () => new THREE.SphereGeometry(long ? 0.12 : 0.09, segs, MOBILE ? 8 : 12)),
        hair,
        0.09,
        this.head,
        style === 4 ? 0.04 : 0,
        0.12,
      );
      fringe.scale.set(long ? 1.25 : 1.35, long ? 0.72 : 0.78, 0.55);
      for (const side of [-1, 1]) {
        const temple = part(
          sharedGeo("hair-temple", () => new THREE.SphereGeometry(0.07, segs, MOBILE ? 6 : 10)),
          hair,
          0.02,
          this.head,
          side * (style === 4 ? 0.12 : 0.155) + (style === 4 ? 0.02 : 0),
          0.04,
        );
        temple.scale.set(0.72, 1.25, 0.85);
      }
    }
    if (long) {
      for (const side of [-1, 1]) {
        const lock = part(capsule(0.07, 0.46, "hair-lock"), hair, -0.16, this.head, side * 0.19, 0.04);
        lock.rotation.z = side * -0.12;
        lock.rotation.x = 0.18;
      }
      const fall = part(sharedGeo("hair-fall", () => new THREE.SphereGeometry(0.18, segs, MOBILE ? 6 : 10)), hair, -0.18, this.head, 0, -0.05);
      fall.scale.set(1.15, 1.7, 0.48);
    }
    if (style === 2) part(sharedGeo("hair-bun", () => new THREE.SphereGeometry(0.08, segs, MOBILE ? 6 : 10)), hair, 0.22, this.head, 0, -0.01);
    if (style === 7) {
      const band = part(sharedGeo("hair-turban", () => new THREE.TorusGeometry(0.16, 0.055, MOBILE ? 6 : 8, MOBILE ? 12 : 18)), hair, 0.03, this.head);
      band.rotation.x = Math.PI / 2;
    }
    if (style === 8) {
      for (const side of [-1, 1]) part(capsule(0.09, 0.42, "hair-hijab"), hair, -0.14, this.head, side * 0.15, 0.03);
    }
    const eyeWhite = mat("#fff8f4", { roughness: 0.35 });
    const pupil = mat("#241820", { roughness: 0.3 });
    const catchlight = mat("#ffffff", { roughness: 0.2, emissive: "#ffffff", emissiveIntensity: 0.35 });
    for (const side of [-1, 1]) {
      const eye = part(sharedGeo("eye-white", () => new THREE.SphereGeometry(0.036, MOBILE ? 8 : 14, MOBILE ? 6 : 12)), eyeWhite, 0.012, this.head, side * 0.07, 0.185);
      eye.scale.set(1.2, 1.05, 0.42);
      const dot = part(sharedGeo("eye-pupil", () => new THREE.SphereGeometry(0.016, MOBILE ? 6 : 10, MOBILE ? 5 : 8)), pupil, 0.01, this.head, side * 0.07, 0.198);
      dot.scale.z = 0.4;
      part(sharedGeo("eye-light", () => new THREE.SphereGeometry(0.006, 6, 5)), catchlight, 0.02, this.head, side * 0.08, 0.204);
    }
    part(sharedGeo("nose", () => new THREE.SphereGeometry(0.028, MOBILE ? 6 : 10, MOBILE ? 5 : 8)), skin, -0.02, this.head, 0, 0.175).scale.set(0.75, 0.55, 0.65);
    const smile = part(
      sharedGeo("smile", () => new THREE.TorusGeometry(0.038, 0.008, MOBILE ? 4 : 6, MOBILE ? 8 : 12, Math.PI)),
      mat("#c45b6e", { roughness: 0.45 }),
      -0.07,
      this.head,
      0,
      0.175,
    );
    smile.rotation.z = Math.PI;
    smile.rotation.x = -0.35;
    this.root.add(this.head);

    // A luminous twin walks just beside them, the way the island art shows.
    const ghost = new THREE.Group();
    ghost.position.set(feminine ? -0.46 : 0.46, 0, -0.08);
    const gpart = (geo: THREE.BufferGeometry, y: number, parent: THREE.Object3D, x = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, ghostMat);
      mesh.position.set(x, y, z);
      mesh.castShadow = false;
      parent.add(mesh);
      return mesh;
    };
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.085, 0.5, 0);
      gpart(capsule(0.068, 0.15, "thigh"), -0.125, hip);
      const knee = new THREE.Group();
      knee.position.y = -0.25;
      gpart(capsule(0.06, 0.15, "shin"), -0.12, knee);
      gpart(sharedGeo("shoe", () => new THREE.BoxGeometry(0.12, 0.055, 0.2)), -0.24, knee, 0, 0.04);
      hip.add(knee);
      ghost.add(hip);
      this.ghostLegs.push({ hip, knee });
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.215, 0.93, 0);
      gpart(capsule(0.052, 0.13, "arm"), -0.1, shoulder);
      const elbow = new THREE.Group();
      elbow.position.y = -0.2;
      gpart(capsule(0.045, 0.11, "forearm"), -0.085, elbow);
      shoulder.add(elbow);
      ghost.add(shoulder);
      this.ghostArms.push({ shoulder, elbow });
    }
    gpart(capsule(0.165, 0.22, "torso"), 0.78, ghost);
    this.ghostHead = new THREE.Group();
    this.ghostHead.position.y = 1.28;
    gpart(sharedGeo("skull", () => new THREE.SphereGeometry(0.2, MOBILE ? 8 : 12, MOBILE ? 6 : 10)), 0.02, this.ghostHead);
    if (!covered) gpart(sharedGeo("hair-crown" + (long ? "-long" : ""), () => new THREE.SphereGeometry(long ? 0.26 : 0.22, 8, 6)), long ? 0.1 : 0.08, this.ghostHead);
    ghost.add(this.ghostHead);
    this.root.add(ghost);
    this.group.add(this.root);
    // ground marker: soft shadow + ring in the person's colour
    const shadow = new THREE.Mesh(
      sharedGeo("shadow", () => new THREE.CircleGeometry(0.3, MOBILE ? 10 : 24)),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.group.add(shadow);
    this.marker = new THREE.Mesh(
      sharedGeo(info.self ? "ring-self" : "ring", () => new THREE.RingGeometry(0.3, info.self ? 0.37 : 0.34, MOBILE ? 16 : 40)),
      new THREE.MeshBasicMaterial({
        color: info.self ? 0xff4d9a : this.color,
        transparent: true,
        opacity: info.self ? 0.95 : 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.025;
    this.group.add(this.marker);
    if (info.self) {
      const halo = new THREE.Mesh(
        sharedGeo("ring-cyan", () => new THREE.RingGeometry(0.4, 0.46, MOBILE ? 16 : 40)),
        new THREE.MeshBasicMaterial({ color: 0x2ec8ea, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.mats.push(halo.material);
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.02;
      this.group.add(halo);
    }
    this.label = labelSprite(info.self ? info.name + " · you" : info.name, "#" + this.color.getHexString());
    if (!info.self) (this.label.material as THREE.SpriteMaterial).opacity = 0.82;
    this.label.position.y = 1.68;
    this.group.add(this.label);
    this.setSize(bodyScale(!!info.self));
    const a = Math.random() * Math.PI * 2,
      r = 2.2 + Math.random() * islandR * 0.55;
    this.group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    this.root.rotation.y = Math.random() * Math.PI * 2;
    this.pickTarget(islandR);
  }
  setSize(k: number) {
    const worldH = MOBILE ? 0.012 : 0.024;
    const aspect = this.label.scale.x / Math.max(this.label.scale.y, 0.0001);
    this.label.scale.set((aspect * worldH) / k, worldH / k, 1);
    this.size = k;
    this.group.scale.setScalar(k);
  }
  chest() {
    return this.group.position.clone().add(new THREE.Vector3(0, (this.seated ? 0.6 : 0.95) * this.size, 0));
  }
  static faceTexture(info: AgentInfo, color: THREE.Color) {
    const c = document.createElement("canvas");
    const px = MOBILE ? 96 : 256;
    c.width = c.height = px;
    const g = c.getContext("2d")!;
    if (MOBILE) g.scale(px / 256, px / 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const ring = "#" + color.getHexString();
    const photo = !!info.face && !info.face.startsWith("data:image/svg");
    const frame = (img?: HTMLImageElement) => {
      g.clearRect(0, 0, 256, 256);
      g.save();
      g.beginPath();
      g.arc(128, 128, 126, 0, Math.PI * 2);
      g.clip();
      if (img) g.drawImage(img, 0, 0, 256, 256);
      g.restore();
      if (!photo) {
        tex.needsUpdate = true;
        return;
      }
      g.lineWidth = 10;
      g.strokeStyle = ring;
      g.beginPath();
      g.arc(128, 128, 122, 0, Math.PI * 2);
      g.stroke();
      tex.needsUpdate = true;
    };
    frame();
    if (info.face) {
      const img = new Image();
      img.onload = () => {
        try {
          frame(img);
        } catch {
          frame();
        }
      };
      img.src = info.face;
    }
    return tex;
  }
  pickTarget(R: number) {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2,
        r = 1.8 + Math.sqrt(Math.random()) * (R * 0.8 - 1.8);
      const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      if (Wisp.obstacles.every((o) => o.p.distanceTo(p) > o.r + 0.3)) {
        this.target.copy(p);
        return;
      }
    }
  }
  update(dt: number, t: number, R: number, motion: number, cam?: THREE.Vector3) {
    const pos = this.group.position;
    const dest = this.pinned ?? this.target;
    const to = new THREE.Vector3(dest.x - pos.x, 0, dest.z - pos.z);
    const d = to.length();
    let desired = new THREE.Vector3();
    if (this.pinned && this.follow) {
      this.seated = false;
      desired = to.normalize().multiplyScalar(Math.min(this.speed * 1.9, d * 3.2));
    } else if (this.pinned) {
      if (d < 0.08) {
        pos.x = dest.x;
        pos.z = dest.z;
        this.seated = this.pose === "sit";
      } else {
        this.seated = false;
        desired = to.normalize().multiplyScalar(Math.min(this.speed * 1.5, d * 2.5));
      }
    } else if (this.wait > 0) {
      this.wait -= dt * motion;
    } else if (d < 0.25) {
      this.wait = rand(1, 5);
      this.pickTarget(R);
    } else {
      desired = to.normalize().multiplyScalar(this.speed);
      // step around buildings, the soul tree and the island edge
      for (const o of Wisp.obstacles) {
        const away = new THREE.Vector3(pos.x - o.p.x, 0, pos.z - o.p.z);
        const dist = away.length();
        if (dist < o.r + 0.6) desired.addScaledVector(away.normalize(), ((o.r + 0.6 - dist) / 0.6) * this.speed * 1.4);
      }
      const rr = Math.hypot(pos.x, pos.z);
      if (rr > R * 0.86) desired.add(new THREE.Vector3(-pos.x, 0, -pos.z).normalize().multiplyScalar(this.speed));
    }
    this.vel.lerp(desired, Math.min(1, dt * 4));
    if (!this.seated) pos.addScaledVector(this.vel, dt * motion);
    const sp = this.vel.length();
    this.walk = THREE.MathUtils.lerp(this.walk, sp > 0.08 && !this.seated ? 1 : 0, Math.min(1, dt * 6));

    // face where we're going, or the partner on a date
    if (sp > 0.08 && !this.seated) this.root.rotation.y = angleLerp(this.root.rotation.y, Math.atan2(this.vel.x, this.vel.z), Math.min(1, dt * 8));
    else if (this.lookAt) {
      const lx = this.lookAt.x - pos.x, lz = this.lookAt.z - pos.z;
      this.root.rotation.y = angleLerp(this.root.rotation.y, Math.atan2(lx, lz), Math.min(1, dt * 4));
    }

    // gait
    this.phase += dt * motion * (4 + sp * 6);
    const w = this.walk, ph = this.phase;
    if (this.seated && !this.wasSeated) this.greet = 1.15;
    this.wasSeated = this.seated;
    if (this.greet > 0) this.greet = Math.max(0, this.greet - dt);
    if (this.seated) {
      this.legs.forEach(({ hip, knee }) => {
        hip.rotation.x = THREE.MathUtils.lerp(hip.rotation.x, -1.45, dt * 6);
        knee.rotation.x = THREE.MathUtils.lerp(knee.rotation.x, 1.45, dt * 6);
      });
      this.arms.forEach(({ shoulder, elbow }, i) => {
        if (this.greet > 0 && i === 1) {
          const wave = Math.sin((1.15 - this.greet) * 14);
          shoulder.rotation.x = THREE.MathUtils.lerp(shoulder.rotation.x, -2.15 + wave * 0.28, dt * 8);
          shoulder.rotation.z = THREE.MathUtils.lerp(shoulder.rotation.z, -0.35, dt * 8);
          elbow.rotation.x = THREE.MathUtils.lerp(elbow.rotation.x, -0.45, dt * 8);
          return;
        }
        shoulder.rotation.x = THREE.MathUtils.lerp(shoulder.rotation.x, -0.55 + Math.sin(t * 1.3 + i) * 0.05, dt * 5);
        shoulder.rotation.z = THREE.MathUtils.lerp(shoulder.rotation.z, (i === 0 ? -1 : 1) * 0.08, dt * 5);
        elbow.rotation.x = THREE.MathUtils.lerp(elbow.rotation.x, -0.7, dt * 5);
      });
      pos.y = THREE.MathUtils.lerp(pos.y, 0.46 - 0.5 * this.size, dt * 6);
      this.root.position.y = 0;
      this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, 0.12, dt * 5);
    } else {
      this.legs.forEach(({ hip, knee }, i) => {
        const s = Math.sin(ph + i * Math.PI);
        hip.rotation.x = -s * 0.62 * w;
        knee.rotation.x = Math.max(0, Math.sin(ph + i * Math.PI - 1.05)) * 1.05 * w;
      });
      this.arms.forEach(({ shoulder, elbow }, i) => {
        shoulder.rotation.x = Math.sin(ph + i * Math.PI) * 0.55 * w + Math.sin(t * 1.2 + i) * 0.03;
        shoulder.rotation.z = (i === 0 ? -1 : 1) * 0.08;
        elbow.rotation.x = -0.22 - 0.32 * w;
      });
      pos.y = THREE.MathUtils.lerp(pos.y, 0, dt * 6);
      this.root.position.y = Math.abs(Math.sin(ph)) * 0.045 * w + Math.sin(t * 2 + this.phase) * 0.004;
      this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, 0.07 * w, dt * 6);
    }
    this.root.rotation.z = Math.sin(ph) * 0.055 * w;

    // the head turns toward the viewer (within a natural range) so faces stay readable
    if (cam) {
      const yaw = Math.atan2(cam.x - pos.x, cam.z - pos.z) - this.root.rotation.y;
      const rel = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      const want = this.lookAt && this.seated ? THREE.MathUtils.clamp(rel, -0.9, 0.9) : THREE.MathUtils.clamp(rel, -1.15, 1.15);
      this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, want, Math.min(1, dt * 5));
    }
    this.head.rotation.x = Math.sin(t * 1.7 + this.phase) * 0.03;
    this.ghostLegs.forEach((g, i) => {
      g.hip.rotation.copy(this.legs[i].hip.rotation);
      g.knee.rotation.copy(this.legs[i].knee.rotation);
    });
    this.ghostArms.forEach((g, i) => {
      g.shoulder.rotation.copy(this.arms[i].shoulder.rotation);
      g.elbow.rotation.copy(this.arms[i].elbow.rotation);
    });
    if (this.ghostHead) this.ghostHead.rotation.copy(this.head.rotation);
    const m = this.marker.material as THREE.MeshBasicMaterial;
    if (this.info.self) m.opacity = 0.65 + Math.sin(t * 3) * 0.25;
  }
  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.mats.forEach((m) => {
      (m as any).map?.dispose?.();
      m.dispose();
    });
    (this.label.material as THREE.SpriteMaterial).map?.dispose();
  }
}

/* ------------------------------------------------------------------ */
/*  Archipelago                                                        */
/* ------------------------------------------------------------------ */
type Mode3D = "sit" | "stand" | "walk";
type SpotDef = { seats: [THREE.Vector3, THREE.Vector3]; focus: THREE.Vector3; route?: THREE.Vector3[] };
type Spot = { seats: [THREE.Vector3, THREE.Vector3]; focus: THREE.Vector3; route?: THREE.Vector3[]; perimeter: number; center: THREE.Vector3 };
type Isle = { id: string; group: THREE.Group; pos: THREE.Vector3; front: THREE.Vector3; side: THREE.Vector3; color: THREE.Color; mode: Mode3D; spots: Spot[]; label: THREE.Sprite; ring: THREE.Mesh };
type Couple = {
  id: string;
  type: string;
  spot: number;
  a: Wisp;
  b: Wisp;
  mode: Mode3D;
  walkT: number;
  targets: [THREE.Vector3, THREE.Vector3];
  started: number;
  mine: boolean;
};
type View = { kind: "overview" } | { kind: "island"; id: string; offset: number } | { kind: "spot"; id: string; spot: number; offset: number };

export const ISLAND_IDS = Object.keys(DATE_TYPES);
export const RING = 34;
const ISLE_R = 6.2;
const HUB_R = 8.5;
const GRASS: Record<string, number> = {
  cafe: 0x6a9a58, walk: 0x4f9a55, bookshop: 0x5f8f6a, garden: 0x6aa35a, cooking: 0x8c8a5c,
  streetfood: 0x7d7a58, gallery: 0x6f9a7a, sunset: 0xc9a46a, stars: 0x3f6a5e, games: 0x5d8f62,
};
/** Most dates on an island that are drawn at once (2 couples = 4 agents), so nothing feels crowded. */
const MAX_VISIBLE = 2;

export function islandAngle(i: number) {
  return Math.PI / 2 + (i / ISLAND_IDS.length) * Math.PI * 2;
}

/* ------------------------------------------------------------------ */
/*  World                                                             */
/* ------------------------------------------------------------------ */
export class SoulWorld {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer?: EffectComposer;
  bloom?: UnrealBloomPass;
  lite = false;
  clock = new THREE.Clock();
  uniforms = { uTime: { value: 0 } };
  islandR = HUB_R; // the home island where idle agents wander
  agents = new Map<string, Wisp>();
  isles = new Map<string, Isle>();
  couples = new Map<string, Couple>();
  /** Kept for tests and older callers: the two characters of the featured date. */
  dateWisps: Wisp[] = [];
  featured: Couple | null = null;
  selected: string | null = null;
  thread?: THREE.Points;
  sways: { o: THREE.Object3D; ph: number; amp: number }[] = [];
  floaters: { o: THREE.Object3D; ph: number; r: number; a: number; y: number; sp: number }[] = [];
  bobbers: { o: THREE.Object3D; ph: number; y: number }[] = [];
  glow = glowTexture();
  mode: WorldMode = "landing";
  view: View = { kind: "overview" };
  camGoal = { pos: new THREE.Vector3(40, 30, 90), look: new THREE.Vector3(0, -1, 0) };
  flying = 0;
  date: DateInfo | null = null;
  bursts: { p: THREE.Points; life: number; vel: Float32Array }[] = [];
  petals!: THREE.InstancedMesh;
  petalData: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; s: number }[] = [];
  fireflyPts!: THREE.Points;
  moonLight!: THREE.DirectionalLight;
  focusLights: THREE.PointLight[] = [];
  focusCenter = new THREE.Vector3();
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  hovered: string | null = null;
  onIsland?: (id: string) => void;
  onCouple?: (id: string) => void;
  motion = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.25 : 1;
  raf = 0;
  running = true;
  disposed = false;
  down = { x: 0, y: 0, t: 0 };

  constructor(public host: HTMLElement) {
    this.lite = MOBILE = detectMobile();
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.lite, powerPreference: this.lite ? "low-power" : "high-performance" });
    const pr = this.lite ? 1 : Math.min(devicePixelRatio, innerWidth < 800 ? 1.25 : 1.6);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = !this.lite;
    if (!this.lite) this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.1, 3000);
    this.camera.position.set(40, 30, 90);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 170;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.42;
    this.controls.autoRotateSpeed = 0.25;
    this.controls.enabled = false;

    if (!this.lite) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(pr);
      this.composer.setSize(host.clientWidth, host.clientHeight);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(host.clientWidth / 2, host.clientHeight / 2), 0.6, 0.5, 0.86);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    this.build();
    this.bind();
    this.loop();
  }

  /* ----------------------------- build ----------------------------- */
  build() {
    this.scene.fog = new THREE.FogExp2(0x2b1b4a, 0.0036);
    this.sky();
    this.stars();
    this.moon();
    this.ocean();
    this.lights();
    this.hub();
    ISLAND_IDS.forEach((id, i) => this.buildIsle(id, i));
    this.fireflies();
    this.petalSystem();
    this.floatingRocks();
    this.clouds();
  }

  sky() {
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uMoon: { value: MOON_DIR } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 uMoon;
        void main(){
          float y = vDir.y;
          vec3 horizon = vec3(1.0,0.56,0.42);
          vec3 rose = vec3(0.78,0.30,0.52);
          vec3 violet = vec3(0.30,0.16,0.48);
          vec3 night = vec3(0.05,0.04,0.15);
          vec3 c = mix(horizon, rose, smoothstep(-0.02,0.10,y));
          c = mix(c, violet, smoothstep(0.08,0.32,y));
          c = mix(c, night, smoothstep(0.30,0.85,y));
          // warm glow opposite the moon (last light of sunset)
          float sunset = pow(max(dot(normalize(vec3(vDir.x,0.,vDir.z)), -normalize(vec3(uMoon.x,0.,uMoon.z))),0.),4.);
          c += vec3(1.,0.45,0.25)*sunset*smoothstep(0.35,0.,y)*0.55;
          float m = max(dot(vDir,uMoon),0.);
          c += vec3(0.75,0.7,1.)*pow(m,60.)*0.6;
          if(y<0.) c = horizon*.82;
          gl_FragColor = vec4(c,1.);
        }`,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1300, MOBILE ? 20 : 48, MOBILE ? 12 : 24), m));
  }
  stars() {
    const n = MOBILE ? 420 : 1800,
      pos = new Float32Array(n * 3),
      size = new Float32Array(n),
      ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random(),
        v = rand(0.08, 1);
      const th = u * Math.PI * 2,
        y = v;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * r * 1150, y * 1150, Math.sin(th) * r * 1150], i * 3);
      size[i] = Math.random() < 0.06 ? rand(3.5, 5.5) : rand(1.2, 2.6);
      ph[i] = Math.random() * 20;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aPh", new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uPR: { value: this.renderer.getPixelRatio() } },
      vertexShader: `attribute float aSize; attribute float aPh; uniform float uTime; uniform float uPR; varying float vA;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv;
        float tw = .65+.35*sin(uTime*1.3+aPh); gl_PointSize = aSize*uPR*tw;
        vA = smoothstep(0.05,0.35,normalize(position).y)*tw; }`,
      fragmentShader: `varying float vA; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard;
        gl_FragColor = vec4(vec3(1.,.95,.9)*1.3, smoothstep(.5,.0,d)*vA); }`,
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    this.scene.add(new THREE.Points(g, m));
  }
  moon() {
    const p = MOON_DIR.clone().multiplyScalar(1000);
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(34, MOBILE ? 12 : 32, MOBILE ? 8 : 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.7), fog: false }),
    );
    moon.position.copy(p);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glow,
        color: 0xb9a8ff,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    halo.scale.setScalar(380);
    halo.position.copy(p);
    this.scene.add(moon, halo);
  }
  ocean() {
    const seaSeg = MOBILE ? 36 : 240;
    const g = new THREE.PlaneGeometry(2400, 2400, seaSeg, seaSeg);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uMoon: { value: MOON_DIR } },
      vertexShader: `uniform float uTime; varying vec3 vW;
        void main(){ vec3 p = position;
          p.y += sin(p.x*.08+uTime*.55)*.55 + sin(p.z*.11+uTime*.7)*.4;
          vec4 w = modelMatrix*vec4(p,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 uMoon; uniform float uTime; varying vec3 vW;
        vec2 grad(vec2 p, float t){
          float dx = .08*.55*cos(p.x*.08+t*.55) + .25*.12*cos((p.x+p.y)*.25+t*1.25) + .43*.06*cos((p.x-p.y)*.43+t*1.7) + 1.1*.025*cos(p.x*1.1+p.y*.6+t*2.3);
          float dz = .11*.4*cos(p.y*.11+t*.7) + .25*.12*cos((p.x+p.y)*.25+t*1.25) - .43*.06*cos((p.x-p.y)*.43+t*1.7) + .6*.025*cos(p.x*1.1+p.y*.6+t*2.3) + 1.3*.02*cos(p.y*1.3-p.x*.4+t*2.9);
          return vec2(dx,dz);
        }
        void main(){
          vec2 gr = grad(vW.xz, uTime);
          float d = length(vW.xz-cameraPosition.xz);
          gr *= 1.-smoothstep(60.,300.,d)*.8;
          vec3 n = normalize(vec3(-gr.x, 1., -gr.y));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.-max(dot(n,v),0.),5.);
          vec3 deep = vec3(.05,.035,.14);
          vec3 refl = mix(vec3(.80,.38,.45), vec3(.26,.14,.42), clamp(reflect(-v,n).y*2.5,0.,1.));
          vec3 c = mix(deep, refl, .18+fres*.75);
          vec3 r = reflect(-uMoon, n);
          c += vec3(1.,.93,1.)*pow(max(dot(r,v),0.),400.)*1.6;
          c += vec3(.6,.5,1.)*pow(max(dot(r,v),0.),30.)*.12;
          vec3 horizon = vec3(1.0,0.56,0.42)*.82;
          c = mix(c, horizon, smoothstep(150.,1100.,d));
          gl_FragColor = vec4(c,1.);
        }`,
    });
    const sea = new THREE.Mesh(g, m);
    sea.position.y = -11;
    this.scene.add(sea);
  }

  lights() {
    this.scene.add(new THREE.HemisphereLight(0x8f7cf0, 0xc0705a, 0.75));
    const moon = new THREE.DirectionalLight(0xcfc4ff, 1.5);
    moon.position.copy(MOON_DIR.clone().multiplyScalar(30));
    moon.castShadow = !MOBILE;
    moon.shadow.mapSize.set(MOBILE ? 256 : 1536, MOBILE ? 256 : 1536);
    const c = moon.shadow.camera;
    c.left = c.bottom = -12;
    c.right = c.top = 12;
    c.near = 1;
    c.far = 80;
    moon.shadow.normalBias = 0.05;
    moon.shadow.radius = 4;
    this.moonLight = moon;
    this.scene.add(moon, moon.target);
    const sunset = new THREE.DirectionalLight(0xff8a5c, 1.1);
    sunset.position.set(30, 6, 26);
    this.scene.add(sunset);
    // two warm lights travel with the camera's focus (cheaper than a light per venue)
    for (const [y, k] of [[2.4, 5], [1.6, 3]] as const) {
      const l = new THREE.PointLight(0xffa860, k, 10, 1.6);
      l.position.y = y;
      this.focusLights.push(l);
      this.scene.add(l);
    }
    this.setFocusCenter(new THREE.Vector3());
  }

  setFocusCenter(p: THREE.Vector3) {
    this.focusCenter.copy(p);
    this.moonLight.position.copy(p).addScaledVector(MOON_DIR, 30);
    this.moonLight.target.position.copy(p);
    this.focusLights[0].position.set(p.x, 2.6, p.z);
    this.focusLights[1].position.set(p.x + 1.5, 1.6, p.z + 2.5);
    if (this.fireflyPts) this.fireflyPts.position.set(p.x, 0, p.z);
  }

  /** A floating island: grassy top, rocky underside, glowing crystals. */
  base(parent: THREE.Object3D, R: number, grassColor: number, crystal: number, seed: number) {
    const rnd = seeded(seed);
    const top = new THREE.CylinderGeometry(R, R * 0.92, 1.0, MOBILE ? 18 : 48, MOBILE ? 1 : 2);
    const pa = top.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), z = pa.getZ(i);
      if (Math.hypot(x, z) > R * 0.85) {
        const a = Math.atan2(z, x);
        const wob = 1 + Math.sin(a * 5 + seed) * 0.035 + Math.sin(a * 11 + 1) * 0.02;
        pa.setX(i, x * wob);
        pa.setZ(i, z * wob);
      }
    }
    top.computeVertexNormals();
    const grass = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ color: grassColor, roughness: 0.95, flatShading: true }));
    grass.position.y = -0.5;
    grass.receiveShadow = true;
    const lip = new THREE.Mesh(
      new THREE.TorusGeometry(R * 0.985, 0.16, MOBILE ? 4 : 6, MOBILE ? 24 : 56),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(grassColor).offsetHSL(0, 0, 0.06), flatShading: true }),
    );
    lip.rotation.x = Math.PI / 2;
    lip.position.y = -0.04;
    const h = R * 1.15;
    const under = new THREE.ConeGeometry(R * 0.93, h, MOBILE ? 12 : 32, MOBILE ? 3 : 6);
    under.rotateX(Math.PI);
    const ua = under.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(ua.count * 3);
    const cTop = new THREE.Color(0x6b4a3d), cMid = new THREE.Color(0x4a3657), cBot = new THREE.Color(0x2a1f3d);
    for (let i = 0; i < ua.count; i++) {
      const y = ua.getY(i);
      const k = (h / 2 - y) / h;
      if (k > 0.02 && k < 0.98) {
        const j = 1 + (rnd() - 0.5) * 0.35;
        ua.setX(i, ua.getX(i) * j);
        ua.setZ(i, ua.getZ(i) * j);
        ua.setY(i, y + (rnd() - 0.5) * 0.4);
      }
      const c = k < 0.4 ? cTop.clone().lerp(cMid, k / 0.4) : cMid.clone().lerp(cBot, (k - 0.4) / 0.6);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    under.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    under.computeVertexNormals();
    const rock = new THREE.Mesh(under, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    rock.position.y = -1 - h / 2;
    parent.add(grass, lip, rock);
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      const y = -1.8 - rnd() * h * 0.5;
      const r = R * 0.93 * (1 - (-(y + 1) / h)) * 0.95;
      const cr = new THREE.Mesh(
        new THREE.OctahedronGeometry(rand(0.22, 0.45), 0),
        new THREE.MeshStandardMaterial({ color: 0x9be7ff, emissive: crystal, emissiveIntensity: 2.2 }),
      );
      cr.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      cr.rotation.set(rnd(), rnd(), rnd());
      parent.add(cr);
    }
  }

  box(w: number, h: number, d: number, color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...opts }),
    );
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
  windowMat() {
    return new THREE.MeshStandardMaterial({ color: 0xffd59a, emissive: 0xffa94d, emissiveIntensity: 1.5 });
  }
  stringLights(from: THREE.Vector3, to: THREE.Vector3, sag: number, n: number, parent: THREE.Object3D) {
    const colors = [0xffd27a, 0xff9fc2, 0xa8e6ff, 0xffe9a8];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = from.clone().lerp(to, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 6),
        new THREE.MeshStandardMaterial({ color: colors[i % 4], emissive: colors[i % 4], emissiveIntensity: 2.2 }),
      );
      b.position.copy(p);
      parent.add(b);
    }
  }

  lamp(parent: THREE.Object3D, x: number, z: number, color = 0xffb860, h = 1.0) {
    const post = this.box(0.06, h, 0.06, 0x2c2238);
    post.position.set(x, h / 2, z);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffe0a8, emissive: color, emissiveIntensity: 2.6 }),
    );
    bulb.position.set(x, h + 0.08, z);
    parent.add(post, bulb);
  }

  tree(blossom: boolean, scale = 1) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08 * scale, 0.14 * scale, 1.1 * scale, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a3b2e, flatShading: true }),
    );
    trunk.position.y = 0.55 * scale;
    trunk.castShadow = true;
    g.add(trunk);
    const crown = new THREE.Group();
    crown.position.y = 1.1 * scale;
    const palette = blossom ? [0xffa3c4, 0xff8db8, 0xffc2da] : [0x3f7d4c, 0x4f9156, 0x2f6844];
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rand(0.45, 0.65) * scale, 0),
        new THREE.MeshStandardMaterial({
          color: palette[i],
          flatShading: true,
          emissive: blossom ? 0xff6fa5 : 0x000000,
          emissiveIntensity: blossom ? 0.12 : 0,
        }),
      );
      c.position.set(rand(-0.3, 0.3) * scale, rand(0, 0.45) * scale, rand(-0.3, 0.3) * scale);
      c.castShadow = true;
      crown.add(c);
    }
    g.add(crown);
    this.sways.push({ o: crown, ph: Math.random() * 10, amp: 0.05 });
    return g;
  }
  awning(colors: [string, string], w = 1.6, d = 0.9) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 8;
    const x = c.getContext("2d")!;
    for (let i = 0; i < 8; i++) {
      x.fillStyle = i % 2 ? colors[0] : colors[1];
      x.fillRect(i * 16, 0, 16, 8);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }));
    m.castShadow = true;
    return m;
  }


  /**
   * Merge an island's static scenery into two meshes (lit + glowing). Thousands of little
   * meshes become a handful of draw calls; swaying or bobbing parts are merged in place.
   */
  bake(root: THREE.Object3D) {
    const dynamic = new Set<THREE.Object3D>([...this.sways.map((x) => x.o), ...this.bobbers.map((x) => x.o)]);
    root.updateMatrixWorld(true);
    const inv = root.matrixWorld.clone().invert();
    const lit: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];
    const gone: THREE.Mesh[] = [];
    const visit = (o: THREE.Object3D) => {
      for (const ch of o.children) {
        if (dynamic.has(ch)) {
          this.bake(ch);
          continue;
        }
        const m = ch as THREE.Mesh;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (m.isMesh && mat?.isMeshStandardMaterial && !mat.map && !mat.transparent && !mat.vertexColors && !m.children.length) {
          const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
          for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
          if (!g.attributes.normal) g.computeVertexNormals();
          g.applyMatrix4(inv.clone().multiply(m.matrixWorld));
          const glowing = mat.emissiveIntensity >= 0.9 && mat.emissive.getHex() !== 0;
          const c = glowing
            ? mat.emissive.clone().multiplyScalar(Math.min(3, mat.emissiveIntensity) * 0.8).add(mat.color.clone().multiplyScalar(0.3))
            : mat.color.clone().add(mat.emissive.clone().multiplyScalar(mat.emissiveIntensity * 0.6));
          const n = g.attributes.position.count;
          const col = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
          g.setAttribute("color", new THREE.BufferAttribute(col, 3));
          (glowing ? glow : lit).push(g);
          gone.push(m);
          continue;
        }
        visit(ch);
      }
    };
    visit(root);
    for (const m of gone) {
      m.parent?.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    if (lit.length) {
      const mesh = new THREE.Mesh(mergeGeometries(lit), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }));
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    }
    if (glow.length) root.add(new THREE.Mesh(mergeGeometries(glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
    lit.concat(glow).forEach((g) => g.dispose());
  }

  /* ---------------------------- home island ---------------------------- */
  hub() {
    const g = new THREE.Group();
    this.scene.add(g);
    this.base(g, HUB_R, 0x5c8f55, 0x7b6cff, 7);
    this.soulTree(g);
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xd9c7b0, roughness: 1, flatShading: true });
    const obstacles: { p: THREE.Vector3; r: number }[] = [{ p: new THREE.Vector3(), r: 1.5 }];
    ISLAND_IDS.forEach((id, i) => {
      const a = islandAngle(i);
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const t = DATE_TYPES[id];
      const col = new THREE.Color(t.color);
      // a path from the soul tree to a little gateway facing each island
      for (let r = 1.9; r < HUB_R - 1.4; r += 0.6) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(rand(0.16, 0.22), 0.24, 0.05, 7), pathMat);
        s.position.copy(dir).multiplyScalar(r);
        s.position.y = 0.025;
        s.receiveShadow = true;
        g.add(s);
      }
      const gate = new THREE.Group();
      gate.position.copy(dir).multiplyScalar(HUB_R - 0.9);
      gate.rotation.y = Math.atan2(dir.x, dir.z);
      for (const x of [-0.45, 0.45]) {
        const post = this.box(0.09, 1.3, 0.09, 0x4a3657);
        post.position.set(x, 0.65, 0);
        gate.add(post);
      }
      const beam = this.box(1.08, 0.1, 0.12, 0x4a3657);
      beam.position.y = 1.33;
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 12, 10),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.4 }),
      );
      orb.position.y = 1.52;
      gate.add(beam, orb);
      g.add(gate);
      obstacles.push({ p: gate.position.clone(), r: 0.7 });
      // floating stepping stones out to the island
      const from = HUB_R + 0.9, to = RING - ISLE_R - 0.7;
      const n = 9;
      for (let k = 0; k < n; k++) {
        const r = from + ((to - from) * k) / (n - 1);
        const stone = new THREE.Group();
        const top = new THREE.Mesh(
          new THREE.CylinderGeometry(0.42, 0.34, 0.16, 7),
          new THREE.MeshStandardMaterial({ color: 0xcdb9a0, flatShading: true }),
        );
        const under = new THREE.Mesh(
          new THREE.ConeGeometry(0.34, 0.7, 7),
          new THREE.MeshStandardMaterial({ color: 0x4d3a5c, flatShading: true }),
        );
        under.rotation.x = Math.PI;
        under.position.y = -0.43;
        stone.add(top, under);
        if (k % 2 === 0) {
          const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 8, 6),
            new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.6 }),
          );
          dot.position.y = 0.12;
          stone.add(dot);
        }
        const y = -0.25 - Math.sin((k / (n - 1)) * Math.PI) * 0.6;
        stone.position.set(dir.x * r, y, dir.z * r);
        g.add(stone);
        this.bobbers.push({ o: stone, ph: i * 1.3 + k * 0.7, y });
      }
    });
    Wisp.obstacles = obstacles;
    // a few trees and lanterns, away from the paths
    const rnd = seeded(42);
    let placed = 0;
    for (let i = 0; i < 200 && placed < 12; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 3.2 + rnd() * (HUB_R - 4.2);
      const nearPath = ISLAND_IDS.some((_, k) => Math.abs(Math.atan2(Math.sin(a - islandAngle(k)), Math.cos(a - islandAngle(k)))) < 0.22);
      if (nearPath) continue;
      const t = this.tree(rnd() < 0.35, 0.7 + rnd() * 0.5);
      t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      g.add(t);
      obstacles.push({ p: t.position.clone(), r: 0.6 });
      placed++;
    }
    for (let i = 0; i < 10; i++) {
      const a = islandAngle(i) + Math.PI / 10;
      this.lamp(g, Math.cos(a) * HUB_R * 0.9, Math.sin(a) * HUB_R * 0.9);
    }
    this.bake(g);
  }

  soulTree(parent: THREE.Object3D) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.38, 2.6, 7), new THREE.MeshStandardMaterial({ color: 0x4a2f3a, flatShading: true }));
    trunk.position.y = 1.3;
    trunk.castShadow = true;
    g.add(trunk);
    const crown = new THREE.Group();
    crown.position.y = 2.9;
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rand(0.7, 1.1), 0),
        new THREE.MeshStandardMaterial({ color: [0xffa6c9, 0xff8fbf, 0xffc4dc][i % 3], emissive: 0xff5fa2, emissiveIntensity: 0.55, flatShading: true }),
      );
      const a = (i / 9) * Math.PI * 2;
      c.position.set(Math.cos(a) * 1.0, rand(-0.3, 0.7), Math.sin(a) * 1.0);
      c.castShadow = true;
      crown.add(c);
    }
    for (let i = 0; i < 14; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe3f0, emissive: 0xffc0dd, emissiveIntensity: 3.5 }));
      const a = rand(0, 6.28), r = rand(1.2, 1.8);
      f.position.set(Math.cos(a) * r, rand(-0.6, 0.5), Math.sin(a) * r);
      crown.add(f);
    }
    g.add(crown);
    this.sways.push({ o: crown, ph: 1, amp: 0.025 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.16, 6, 18), new THREE.MeshStandardMaterial({ color: 0xb8a9a0, flatShading: true }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    g.add(ring);
    parent.add(g);
  }

  /* ---------------------------- date islands ---------------------------- */
  buildIsle(id: string, i: number) {
    const t = DATE_TYPES[id];
    const a = islandAngle(i);
    const front = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const g = new THREE.Group();
    g.position.copy(front).multiplyScalar(RING);
    g.rotation.y = Math.atan2(front.x, front.z); // local +z faces outward, toward the camera
    g.userData.isle = id;
    this.scene.add(g);
    const color = new THREE.Color(t.color);
    this.base(g, ISLE_R, GRASS[id] ?? 0x5c8f55, color.getHex(), 11 + i * 7);
    // the venue sits a little toward the front so the dates are close to the camera
    const content = new THREE.Group();
    content.position.z = 0.9;
    g.add(content);
    const defs: SpotDef[] = (this as any)["isle_" + id](content, color);
    // dressing: trees around the back, lanterns along the rim
    const rnd = seeded(100 + i);
    for (let k = 0; k < 7; k++) {
      const ang = Math.PI * (1.12 + (k / 6) * 0.76) + (rnd() - 0.5) * 0.12; // back arc (local -z)
      const r = ISLE_R - 0.9 - rnd() * 0.7;
      const tr = this.tree(rnd() < 0.4, 0.65 + rnd() * 0.45);
      tr.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
      tr.rotation.y = rnd() * 6;
      g.add(tr);
    }
    if (id !== "sunset")
      for (const x of [-1, 1]) this.lamp(g, x * (ISLE_R - 0.5) * 0.7, (ISLE_R - 0.5) * 0.7);
    // hover / focus ring and the island's name for the overview
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ISLE_R + 0.15, ISLE_R + 0.45, 64),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    const label = labelSprite(`${t.icon}  ${t.island}`, t.color);
    label.userData.baseScale = label.scale.clone();
    label.position.set(0, 4.6, 0);
    label.visible = false;
    g.add(label);
    this.bake(g);
    g.updateMatrixWorld(true);
    const w = (v: THREE.Vector3) => content.localToWorld(v.clone());
    const spots: Spot[] = defs.map((d) => {
      const route = d.route?.map(w);
      let perimeter = 0;
      route?.forEach((p, k) => (perimeter += p.distanceTo(route[(k + 1) % route.length])));
      const center = route ? route.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / route.length) : w(d.focus);
      return { seats: [w(d.seats[0]), w(d.seats[1])], focus: w(d.focus), route, perimeter, center };
    });
    this.isles.set(id, {
      id, group: g, pos: g.position.clone(), front, side: new THREE.Vector3(front.z, 0, -front.x),
      color, mode: t.mode, spots, label, ring,
    });
  }

  /** Two chairs facing each other across a small table. Returns the seat spots. */
  tableFor2(g: THREE.Object3D, x: number, z: number, opts: { top?: number; chair?: number; game?: boolean } = {}): SpotDef {
    const table = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 20), new THREE.MeshStandardMaterial({ color: opts.top ?? 0xffffff }));
    top.position.y = 0.62;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6), new THREE.MeshStandardMaterial({ color: 0x333344 }));
    leg.position.y = 0.3;
    table.add(top, leg);
    if (opts.game) {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const x2 = c.getContext("2d")!;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        x2.fillStyle = (i + j) % 2 ? "#2b2440" : "#f3e9dc";
        x2.fillRect(i * 8, j * 8, 8, 8);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshStandardMaterial({ map: tex }));
      board.rotation.x = -Math.PI / 2;
      board.position.y = 0.648;
      table.add(board);
      for (let k = 0; k < 4; k++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 8), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xffd166 : 0xe0576b, emissive: k % 2 ? 0xffd166 : 0xe0576b, emissiveIntensity: 0.3 }));
        p.position.set(-0.12 + k * 0.08, 0.68, (k % 2 ? 1 : -1) * 0.1);
        table.add(p);
      }
    } else {
      for (const s of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 10), new THREE.MeshStandardMaterial({ color: 0xfff1e0 }));
        cup.position.set(s * 0.14, 0.7, 0.05 * s);
        table.add(cup);
      }
    }
    table.position.set(x, 0, z);
    g.add(table);
    for (const s of [-1, 1]) {
      const chair = this.box(0.35, 0.05, 0.35, opts.chair ?? 0xb5654f);
      chair.position.set(x + s * 0.72, 0.4, z);
      const back = this.box(0.05, 0.45, 0.35, opts.chair ?? 0xb5654f);
      back.position.set(x + s * 0.9, 0.62, z);
      g.add(chair, back);
    }
    return { seats: [new THREE.Vector3(x - 0.72, 0, z), new THREE.Vector3(x + 0.72, 0, z)], focus: new THREE.Vector3(x, 0, z) };
  }

  /** Standing spot: two people face each other in front of something. */
  standAt(x: number, z: number, gap = 0.48): SpotDef {
    return { seats: [new THREE.Vector3(x - gap, 0, z), new THREE.Vector3(x + gap, 0, z)], focus: new THREE.Vector3(x, 0, z) };
  }

  loopRoute(cx: number, cz: number, rx: number, rz = rx, n = 20) {
    return Array.from({ length: n }, (_, k) => {
      const a = -Math.PI / 2 + (k / n) * Math.PI * 2;
      return new THREE.Vector3(cx + Math.cos(a) * rx, 0, cz + Math.sin(a) * rz);
    });
  }

  house(g: THREE.Object3D, z: number, wall: number, roofC: number, awning: [string, string]) {
    const body = this.box(2.6, 1.8, 2, wall);
    body.position.set(0, 0.9, z);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.15, 1.1, 4), new THREE.MeshStandardMaterial({ color: roofC, flatShading: true }));
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 2.35, z);
    roof.castShadow = true;
    const win1 = this.box(0.7, 0.6, 0.05, 0);
    win1.material = this.windowMat();
    win1.position.set(-0.65, 1.05, z + 1.01);
    const win2 = win1.clone();
    win2.position.x = 0.65;
    const door = this.box(0.5, 0.9, 0.06, 0x6b3f36);
    door.position.set(0, 0.45, z + 1.02);
    const aw = this.awning(awning, 2.8, 0.8);
    aw.position.set(0, 1.62, z + 1.32);
    aw.rotation.x = -0.75;
    const ch = this.box(0.3, 0.6, 0.3, 0x8a5a4c);
    ch.position.set(0.7, 2.6, z - 0.4);
    g.add(body, roof, win1, win2, door, aw, ch);
  }

  terraceLights(g: THREE.Object3D, z: number) {
    for (const x of [-4.1, 4.1]) {
      const p = this.box(0.06, 1.9, 0.06, 0x3a2c3f);
      p.position.set(x, 0.95, z);
      g.add(p);
    }
    this.stringLights(new THREE.Vector3(-4.1, 1.88, z), new THREE.Vector3(0, 1.75, z - 1.4), 0.2, 8, g);
    this.stringLights(new THREE.Vector3(0, 1.75, z - 1.4), new THREE.Vector3(4.1, 1.88, z), 0.2, 8, g);
  }

  isle_cafe(g: THREE.Object3D) {
    this.house(g, -2.5, 0xf3e3cf, 0xd7735f, ["#fff3e6", "#e0576b"]);
    this.terraceLights(g, 2.6);
    return [this.tableFor2(g, -2.7, 1.3), this.tableFor2(g, 0, 1.8), this.tableFor2(g, 2.7, 1.3)];
  }

  isle_games(g: THREE.Object3D) {
    this.house(g, -2.5, 0x2f6f73, 0x5b4b8a, ["#f3e9dc", "#2a9d8f"]);
    // a giant die by the door
    const die = this.box(0.6, 0.6, 0.6, 0xf3e9dc);
    die.position.set(-1.9, 0.3, -1.2);
    die.rotation.y = 0.5;
    g.add(die);
    for (const [dx, dy, dz] of [[0, 0.31, 0], [0.12, 0.31, 0.12], [-0.12, 0.31, -0.12]]) {
      const pip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2b2440 }));
      pip.position.set(-1.9 + dx, 0.3 + dy, -1.2 + dz);
      g.add(pip);
    }
    this.terraceLights(g, 2.6);
    const o = { game: true, top: 0x8b5e3c, chair: 0x2a9d8f };
    return [this.tableFor2(g, -2.7, 1.3, o), this.tableFor2(g, 0, 1.8, o), this.tableFor2(g, 2.7, 1.3, o)];
  }

  isle_bookshop(g: THREE.Object3D) {
    const z = -2.4;
    const body = this.box(2.1, 2.8, 1.9, 0x5f7f8f);
    body.position.set(0, 1.4, z);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1.55, 1.2, 4, 1), new THREE.MeshStandardMaterial({ color: 0x2f3b5a, flatShading: true }));
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 3.4, z);
    roof.scale.set(1, 1, 0.9);
    roof.castShadow = true;
    const win = this.box(1.1, 0.8, 0.04, 0);
    win.material = this.windowMat();
    win.position.set(0, 1.15, z + 0.96);
    const upper = this.box(0.45, 0.45, 0.04, 0);
    upper.material = this.windowMat();
    upper.position.set(-0.5, 2.35, z + 0.96);
    const upper2 = upper.clone();
    upper2.position.x = 0.5;
    const sign = this.box(0.9, 0.3, 0.05, 0xf2d0a4, { emissive: 0xf2c48a, emissiveIntensity: 0.6 });
    sign.position.set(0, 2.0, z + 1.0);
    g.add(body, roof, win, upper, upper2, sign);
    const cols = [0xe76f51, 0xf4a261, 0x2a9d8f, 0xe9c46a, 0x9d4edd];
    const bench = (x: number, zz: number, color = 0x8b5e3c) => {
      const b = this.box(1.7, 0.08, 0.4, color);
      b.position.set(x, 0.42, zz);
      g.add(b);
      for (const s of [-0.7, 0.7]) {
        const l = this.box(0.06, 0.4, 0.32, 0x5b3c2a);
        l.position.set(x + s, 0.2, zz);
        g.add(l);
      }
      for (let k = 0; k < 4; k++) {
        const bk = this.box(0.28, 0.07, 0.2, cols[(k + Math.abs(Math.round(x))) % 5]);
        bk.position.set(x + 1.15, 0.035 + k * 0.07, zz - 0.1);
        bk.rotation.y = k * 0.25;
        g.add(bk);
      }
      return { seats: [new THREE.Vector3(x - 0.6, 0, zz), new THREE.Vector3(x + 0.6, 0, zz)] as [THREE.Vector3, THREE.Vector3], focus: new THREE.Vector3(x, 0, zz) };
    };
    return [bench(-2.8, 1.2), this.tableFor2(g, 0, 1.8, { top: 0xe9c46a, chair: 0x9d4edd }), bench(2.8, 1.2, 0x6b4a3d)];
  }

  isle_garden(g: THREE.Object3D) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.08, 8, 32, Math.PI), new THREE.MeshStandardMaterial({ color: 0xf5efe6 }));
    arch.position.set(0, 0.2, -2.6);
    arch.castShadow = true;
    g.add(arch);
    const flowerCols = [0xff8fb1, 0xffd166, 0xffffff, 0xc77dff, 0xff6b6b];
    for (let i = 0; i < 22; i++) {
      const a = (i / 21) * Math.PI;
      const f = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rand(0.09, 0.16), 0),
        new THREE.MeshStandardMaterial({ color: flowerCols[i % 5], emissive: flowerCols[i % 5], emissiveIntensity: 0.45, flatShading: true }),
      );
      f.position.set(Math.cos(a) * 1.25, 0.2 + Math.sin(a) * 1.25, -2.6 + rand(-0.1, 0.1));
      g.add(f);
    }
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1.0, 28), new THREE.MeshStandardMaterial({ color: 0x3a4f9a, roughness: 0.1, metalness: 0.3 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(-3.1, 0.02, -1.4);
    g.add(pond);
    for (let i = 0; i < 36; i++) {
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), new THREE.MeshStandardMaterial({ color: flowerCols[i % 5], flatShading: true }));
      f.position.set(rand(-4.6, 4.6), 0.08, rand(-0.6, 3.6));
      if (Math.abs(f.position.x) % 2.8 < 1.1 && f.position.z > 0.4 && f.position.z < 2.6) continue;
      g.add(f);
    }
    const blanket = (x: number, z: number, c1: string) => {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const x2 = c.getContext("2d")!;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        x2.fillStyle = (i + j) % 2 ? "#fff6ee" : c1;
        x2.fillRect(i * 8, j * 8, 8, 8);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.1), new THREE.MeshStandardMaterial({ map: tex }));
      b.rotation.x = -Math.PI / 2;
      b.position.set(x, 0.03, z);
      b.receiveShadow = true;
      const basket = this.box(0.32, 0.22, 0.24, 0xb07d4f);
      basket.position.set(x, 0.14, z - 0.25);
      g.add(b, basket);
      for (const s of [-1, 1]) {
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0x8b5e3c, flatShading: true }));
        stool.position.set(x + s * 0.62, 0.2, z);
        stool.castShadow = true;
        g.add(stool);
      }
      return { seats: [new THREE.Vector3(x - 0.62, 0, z), new THREE.Vector3(x + 0.62, 0, z)] as [THREE.Vector3, THREE.Vector3], focus: new THREE.Vector3(x, 0, z) };
    };
    return [blanket(-2.8, 1.3, "#e0576b"), blanket(0, 1.9, "#7ec8ff"), blanket(2.8, 1.3, "#ffd166")];
  }

  isle_walk(g: THREE.Object3D) {
    for (const x of [-0.7, 0.7]) {
      const post = this.box(0.12, 1.6, 0.12, 0x6b4a3d);
      post.position.set(x, 0.8, ISLE_R - 2.0);
      g.add(post);
    }
    const beam = this.box(1.7, 0.14, 0.18, 0x6b4a3d);
    beam.position.set(0, 1.62, ISLE_R - 2.0);
    g.add(beam);
    const mat = new THREE.MeshStandardMaterial({ color: 0xcdb9a0, roughness: 1, flatShading: true });
    const loops: [number, number][] = [[-2.5, 0.6], [2.5, 0.6]];
    for (const [cx, cz] of loops) {
      const r = 1.9;
      const n = Math.round((r * Math.PI * 2) / 0.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.05, 7), mat);
        s.position.set(cx + Math.cos(a) * r, 0.025, cz + Math.sin(a) * r);
        s.receiveShadow = true;
        g.add(s);
      }
      const t = this.tree(true, 1.15);
      t.position.set(cx, 0, cz);
      g.add(t);
    }
    const pond = new THREE.Mesh(new THREE.CircleGeometry(0.75, 24), new THREE.MeshStandardMaterial({ color: 0x3a4f9a, roughness: 0.1, metalness: 0.3 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(0, 0.02, -1.6);
    g.add(pond);
    return loops.map(([cx, cz]) => {
      const route = this.loopRoute(cx, cz, 1.9);
      return { seats: [route[0].clone().add(new THREE.Vector3(0, 0, 0.3)), route[0].clone().add(new THREE.Vector3(0, 0, -0.3))] as [THREE.Vector3, THREE.Vector3], focus: new THREE.Vector3(cx, 0, cz), route };
    });
  }

  stall(g: THREE.Object3D, x: number, z: number, cols: [string, string], kind: "kitchen" | "spice" | "sweets") {
    const s = new THREE.Group();
    s.position.set(x, 0, z);
    const counter = this.box(1.2, 0.75, 0.55, 0x8b5e3c);
    counter.position.set(0, 0.375, 0.3);
    for (const px of [-0.55, 0.55])
      for (const pz of [0.05, 0.55]) {
        const post = this.box(0.05, 1.6, 0.05, 0x3a2c3f);
        post.position.set(px, 0.8, pz);
        s.add(post);
      }
    const aw = this.awning(cols, 1.4, 0.9);
    aw.rotation.x = -Math.PI / 2 + 0.25;
    aw.position.set(0, 1.62, 0.35);
    s.add(counter, aw);
    if (kind === "kitchen") {
      const stove = this.box(0.4, 0.08, 0.3, 0x222233);
      stove.position.set(0, 0.79, 0.3);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.14, 14), new THREE.MeshStandardMaterial({ color: 0xb8b8c8, metalness: 0.6, roughness: 0.3 }));
      pot.position.set(0, 0.9, 0.3);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a1a, emissiveIntensity: 3 }));
      flame.position.set(0, 0.84, 0.3);
      s.add(stove, pot, flame);
    } else {
      const cols2 = kind === "spice" ? [0xd62828, 0xf77f00, 0xfcbf49] : [0xff8fb8, 0xffd166, 0xc77dff];
      cols2.forEach((cc, i) => {
        const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: cc, emissive: cc, emissiveIntensity: 0.3 }));
        bowl.position.set(-0.35 + i * 0.35, 0.76, 0.3);
        s.add(bowl);
      });
    }
    this.stringLights(new THREE.Vector3(-0.6, 1.55, 0.6), new THREE.Vector3(0.6, 1.55, 0.6), 0.12, 5, s);
    g.add(s);
  }

  isle_cooking(g: THREE.Object3D) {
    this.stall(g, 0, -2.8, ["#fff3e6", "#2a9d8f"], "spice");
    this.stall(g, -2.4, -0.6, ["#fff3e6", "#e0576b"], "kitchen");
    this.stall(g, 2.4, -0.6, ["#fff3e6", "#f4a261"], "kitchen");
    return [this.standAt(-2.4, 0.75, 0.45), this.standAt(2.4, 0.75, 0.45)];
  }

  isle_streetfood(g: THREE.Object3D) {
    this.stall(g, -3.2, -0.9, ["#fff3e6", "#d62828"], "spice");
    this.stall(g, -1.8, -1.2, ["#fff3e6", "#f77f00"], "kitchen");
    this.stall(g, 1.8, -1.2, ["#fff3e6", "#c77dff"], "sweets");
    this.stall(g, 3.2, -0.9, ["#fff3e6", "#ff8fb8"], "sweets");
    // paper lanterns over the lanes
    this.stringLights(new THREE.Vector3(-4.2, 1.9, 1.6), new THREE.Vector3(4.2, 1.9, 1.6), 0.3, 14, g);
    for (const x of [-4.2, 4.2]) {
      const p = this.box(0.06, 1.95, 0.06, 0x3a2c3f);
      p.position.set(x, 0.97, 1.6);
      g.add(p);
    }
    const lane = (cx: number) => {
      const route = [
        new THREE.Vector3(cx - 1.4, 0, 0.55), new THREE.Vector3(cx - 0.5, 0, 1.25), new THREE.Vector3(cx + 0.5, 0, 1.25),
        new THREE.Vector3(cx + 1.4, 0, 0.55), new THREE.Vector3(cx + 0.5, 0, 0.35), new THREE.Vector3(cx - 0.5, 0, 0.35),
      ];
      return { seats: [route[0].clone(), route[1].clone()] as [THREE.Vector3, THREE.Vector3], focus: new THREE.Vector3(cx, 0, 0.8), route };
    };
    return [lane(-2.5), lane(2.5)];
  }

  isle_gallery(g: THREE.Object3D) {
    const z = -2.6;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.0, 0.14, 24), new THREE.MeshStandardMaterial({ color: 0xe9e1d6, roughness: 0.8 }));
    base.position.set(0, 0.07, z);
    base.receiveShadow = true;
    g.add(base);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.1, 10), new THREE.MeshStandardMaterial({ color: 0xf7f2ea }));
      pillar.position.set(Math.cos(a) * 1.7, 1.15, z + Math.sin(a) * 1.7);
      pillar.castShadow = true;
      g.add(pillar);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.25, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x5b4b8a, flatShading: true }));
    roof.position.set(0, 2.65, z);
    roof.rotation.y = Math.PI / 6;
    roof.castShadow = true;
    const sculpt = new THREE.Mesh(new THREE.TorusKnotGeometry(0.32, 0.1, 64, 8), new THREE.MeshStandardMaterial({ color: 0xffd6a8, emissive: 0xff9f6b, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.3 }));
    sculpt.position.set(0, 1.0, z);
    g.add(roof, sculpt);
    this.sways.push({ o: sculpt, ph: 0, amp: 0.2 });
    const art = (seed: number) => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const x = c.getContext("2d")!;
      const r = seeded(seed);
      x.fillStyle = ["#1d1b3a", "#f3e9dc", "#0b3c5d"][seed % 3];
      x.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 9; i++) {
        x.fillStyle = `hsl(${Math.floor(r() * 360)} 75% ${45 + r() * 25}%)`;
        x.globalAlpha = 0.85;
        if (r() > 0.5) {
          x.beginPath();
          x.arc(r() * 128, r() * 128, 8 + r() * 30, 0, Math.PI * 2);
          x.fill();
        } else x.fillRect(r() * 100, r() * 100, 10 + r() * 50, 10 + r() * 50);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const wall = (x: number, zz: number, seed: number) => {
      const panel = this.box(1.5, 1.5, 0.12, 0xf7f2ea);
      panel.position.set(x, 0.95, zz);
      const frame = this.box(0.9, 0.7, 0.05, 0xc9a227);
      frame.position.set(x, 1.15, zz + 0.08);
      const tex = art(seed);
      const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveIntensity: 0.15, emissiveMap: tex }));
      canvas.position.set(x, 1.15, zz + 0.11);
      g.add(panel, frame, canvas);
      return this.standAt(x, zz + 0.9);
    };
    return [wall(-2.8, 0.3, 3), wall(0, 0.8, 4), wall(2.8, 0.3, 5)];
  }

  isle_sunset(g: THREE.Object3D) {
    // a beach hut at the back
    const hut = this.box(1.6, 1.2, 1.3, 0xf2d0a4);
    hut.position.set(0, 0.6, -2.6);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.8, 4), new THREE.MeshStandardMaterial({ color: 0xc0705a, flatShading: true }));
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 1.6, -2.6);
    g.add(hut, roof);
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.9, flatShading: true });
    const pier = (x: number) => {
      const z0 = ISLE_R - 2.9;
      for (let i = 0; i < 13; i++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.24), wood);
        plank.position.set(x + (i % 2) * 0.03, 0.02, z0 + i * 0.27);
        plank.receiveShadow = true;
        plank.castShadow = true;
        g.add(plank);
      }
      for (let i = 0; i < 2; i++)
        for (const s of [-0.62, 0.62]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.9, 8), wood);
          post.position.set(x + s, -0.55, z0 + 1.9 + i * 1.3);
          g.add(post);
        }
      for (const s of [-0.62, 0.62]) {
        const bar = this.box(0.05, 0.05, 2.4, 0x5b3c2a);
        bar.position.set(x + s, 0.6, z0 + 2.2);
        g.add(bar);
      }
      this.lamp(g, x + 0.62, z0 + 3.4, 0xffb860, 0.9);
      return this.standAt(x, z0 + 2.9, 0.36);
    };
    // beach umbrellas and a small bonfire in the middle
    for (const [ux, uz, uc] of [[-3.2, -0.6, 0xff7a59], [3.2, -0.6, 0x7ec8ff]] as const) {
      const pole = this.box(0.05, 1.5, 0.05, 0xf3e9dc);
      pole.position.set(ux, 0.75, uz);
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.35, 8), new THREE.MeshStandardMaterial({ color: uc, flatShading: true }));
      top.position.set(ux, 1.55, uz);
      const towel = this.box(0.6, 0.02, 1.1, 0xfff3e6);
      towel.position.set(ux + 0.5, 0.02, uz + 0.5);
      g.add(pole, top, towel);
    }
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff6a1a, emissiveIntensity: 3 }));
    fire.position.set(0, 0.3, 0.2);
    g.add(fire);
    for (let k = 0; k < 6; k++) {
      const st = this.box(0.16, 0.1, 0.16, 0x6b6b7a);
      const a = (k / 6) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.38, 0.05, 0.2 + Math.sin(a) * 0.38);
      g.add(st);
    }
    return [pier(-1.8), pier(1.8)];
  }

  isle_stars(g: THREE.Object3D) {
    const mound = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x35594f, flatShading: true }));
    mound.scale.y = 0.35;
    mound.position.set(0, 0, -2.6);
    mound.receiveShadow = true;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 1.3, 16), new THREE.MeshStandardMaterial({ color: 0xe9e1d6, flatShading: true }));
    tower.position.set(0, 1.4, -2.7);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.95, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8f9bb8, metalness: 0.5, roughness: 0.4 }));
    dome.position.set(0, 2.05, -2.7);
    const slit = this.box(0.25, 0.9, 0.2, 0x1a1530, { emissive: 0x6c8cff, emissiveIntensity: 0.6 });
    slit.position.set(0, 2.45, -1.95);
    slit.rotation.x = -0.6;
    g.add(mound, tower, dome, slit);
    const scope = (x: number, z: number, color: number) => {
      const s = new THREE.Group();
      s.position.set(x, 0, z - 0.5);
      for (let k = 0; k < 3; k++) {
        const leg = this.box(0.04, 0.95, 0.04, 0x2c2238);
        const a = (k / 3) * Math.PI * 2;
        leg.position.set(Math.cos(a) * 0.18, 0.45, Math.sin(a) * 0.18);
        leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
        s.add(leg);
      }
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.9, 12), new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.3 }));
      tube.position.y = 1.05;
      tube.rotation.x = -0.9;
      s.add(tube);
      g.add(s);
      return this.standAt(x, z + 0.2);
    };
    const blanketSpot = (x: number, z: number) => {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), new THREE.MeshStandardMaterial({ color: 0x3b3170 }));
      b.rotation.x = -Math.PI / 2;
      b.position.set(x, 0.03, z);
      g.add(b);
      for (let k = 0; k < 6; k++) {
        const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 3 }));
        st.position.set(x + rand(-0.8, 0.8), 0.06, z + rand(-0.45, 0.45));
        g.add(st);
      }
      return this.standAt(x, z);
    };
    return [scope(-2.8, 1.3, 0xc9a227), scope(0, 1.9, 0xb8b8c8), blanketSpot(2.8, 1.3)];
  }

  fireflies() {
    const n = MOBILE ? 48 : 260,
      pos = new Float32Array(n * 3),
      ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        r = Math.sqrt(Math.random()) * 9.5;
      pos.set([Math.cos(a) * r, rand(0.3, 4.5), Math.sin(a) * r], i * 3);
      ph[i] = Math.random() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aPh", new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uPR: { value: this.renderer.getPixelRatio() } },
      vertexShader: `attribute float aPh; uniform float uTime; uniform float uPR; varying float vA;
        void main(){ vec3 p = position; float t = uTime*.5;
          p += vec3(sin(t*.9+aPh)*.9, sin(t*1.3+aPh*2.)*.45, cos(t*.7+aPh)*.9);
          vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
          vA = pow(.5+.5*sin(uTime*2.+aPh*3.),3.);
          gl_PointSize = (8.+6.*vA)*uPR*(10./-mv.z); }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-.5); if(d>.5) discard;
        gl_FragColor = vec4(vec3(1.,.92,.45)*2.2, smoothstep(.5,0.,d)*(.25+vA*.75)); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    this.fireflyPts = pts;
    this.scene.add(pts);
  }
  petalSystem() {
    const n = MOBILE ? 28 : 140;
    const geo = new THREE.PlaneGeometry(0.09, 0.06);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffb7d5,
      emissive: 0xff7fb5,
      emissiveIntensity: 0.6,
      side: THREE.DoubleSide,
    });
    this.petals = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) this.petalData.push(this.newPetal(true));
    this.scene.add(this.petals);
  }
  newPetal(anyY = false) {
    const a = Math.random() * Math.PI * 2,
      r = Math.random() * 2.2;
    return {
      p: new THREE.Vector3(Math.cos(a) * r, anyY ? rand(0, 4.5) : rand(3.4, 4.6), Math.sin(a) * r),
      v: new THREE.Vector3(rand(0.15, 0.5), -rand(0.25, 0.45), rand(-0.15, 0.25)),
      r: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
      s: rand(0.7, 1.4),
    };
  }
  floatingRocks() {
    const rnd = seeded(99);
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const s = 0.6 + rnd() * 1.1;
      const rock = new THREE.Mesh(
        new THREE.ConeGeometry(s, s * 2.2, 7, 2),
        new THREE.MeshStandardMaterial({ color: 0x4d3a5c, flatShading: true }),
      );
      rock.rotation.x = Math.PI;
      rock.position.y = -s * 1.1;
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(s, s * 0.95, 0.25, 7),
        new THREE.MeshStandardMaterial({ color: 0x6f9a6a, flatShading: true }),
      );
      g.add(rock, top);
      if (rnd() > 0.35) {
        const t = this.tree(rnd() > 0.5, 0.5 * s + 0.2);
        t.position.y = 0.1;
        g.add(t);
      }
      const r = 46 + rnd() * 14,
        a = rnd() * Math.PI * 2,
        y = -3 + rnd() * 7;
      this.floaters.push({ o: g, ph: rnd() * 10, r, a, y, sp: 0.01 + rnd() * 0.02 });
      this.scene.add(g);
    }
  }
  clouds() {
    const mat = new THREE.SpriteMaterial({
      map: glowTexture("rgba(255,190,210,0.55)", "rgba(255,190,210,0)"),
      transparent: true,
      depthWrite: false,
      opacity: 0.35,
    });
    for (let i = 0; i < (MOBILE ? 8 : 26); i++) {
      const s = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2,
        r = rand(60, 220);
      s.position.set(Math.cos(a) * r, rand(-6, 10), Math.sin(a) * r);
      s.scale.set(rand(40, 90), rand(8, 16), 1);
      this.scene.add(s);
      this.floaters.push({ o: s, ph: 0, r, a, y: s.position.y, sp: rand(0.002, 0.006) });
    }
  }

  /* ---------------------------- public API ---------------------------- */
  setMode(mode: WorldMode) {
    this.mode = mode;
    this.controls.enabled = mode === "home";
    if (mode === "home" || mode === "calm" || mode === "landing") this.view = { kind: "overview" };
    this.refocus();
    if (this.bloom) this.bloom.strength = mode === "date" ? 0.7 : 0.6;
  }

  /** Island name plates stay on screen: smaller on a phone, full size on a desktop. */
  fitLabels() {
    const w = innerWidth;
    const s = w < 700 ? 0.7 : w < 1100 ? 0.9 : 1.25;
    for (const isle of this.isles.values()) {
      const base = isle.label.userData.baseScale as THREE.Vector3 | undefined;
      if (base) isle.label.scale.copy(base).multiplyScalar(s);
    }
  }

  /** Re-aim the camera at whatever we are looking at (also after a resize). */
  refocus() {
    const aspect = innerWidth / Math.max(innerHeight, 1);
    const portrait = aspect < 1.05;
    const small = innerWidth < 800 || portrait;
    this.controls.maxDistance = portrait ? 560 : 170;
    this.fitLabels();
    const v = this.view;
    this.controls.autoRotate = v.kind === "overview" && (this.mode === "home" || this.mode === "calm") && this.motion === 1;
    if (v.kind === "island") {
      const isle = this.isles.get(v.id)!;
      const look = isle.pos.clone().addScaledVector(isle.front, 1.6);
      look.y = portrait ? -7 : small ? -2.5 : 0;
      if (!small) look.addScaledVector(isle.side, 3 * v.offset);
      this.camGoal.look.copy(look);
      this.camGoal.pos.copy(look).addScaledVector(isle.front, portrait ? 26 : small ? 23 : 15.5).add(new THREE.Vector3(0, portrait ? 22 : small ? 19 : 11.5, 0));
      this.setFocusCenter(isle.pos);
    } else if (v.kind === "spot") {
      const isle = this.isles.get(v.id)!;
      const s = isle.spots[v.spot] ?? isle.spots[0];
      const look = (s.route ? s.center : s.focus).clone();
      look.y = portrait ? -4.2 : small ? -1.6 : 0.9;
      if (!small) look.addScaledVector(isle.side, 1.6 * v.offset);
      this.camGoal.look.copy(look);
      this.camGoal.pos
        .copy(look)
        .addScaledVector(isle.front, portrait ? 16 : small ? 10 : (s.route ? 8.5 : 7.2) + Math.max(0, v.offset - 1) * 2.3)
        .add(new THREE.Vector3(0, portrait ? 13 : small ? 7.5 : 3.6, 0))
        .addScaledVector(isle.side, 1.1);
      this.setFocusCenter(isle.pos);
    } else {
      const k = small ? 0 : Math.min(1, Math.max(0, (innerWidth - 900) / 900));
      if (this.mode === "landing") {
        this.camGoal.pos.set(small ? 18 : 6, small ? 34 : 24, small ? 70 : 62);
        this.camGoal.look.set(small ? 0 : -24, small ? 2 : 2, small ? 0 : 2);
      } else if (this.mode === "calm") {
        this.camGoal.pos.set(small ? 0 : -8, small ? 90 : 70, small ? 120 : 96);
        this.camGoal.look.set(small ? 0 : 20 + 6 * (1 - k), small ? -6 : -6, small ? 0 : 4);
      } else if (portrait) {
        const R = RING + ISLE_R + 3;
        const vHalf = (this.camera.fov * Math.PI) / 360;
        const hHalf = Math.atan(Math.tan(vHalf) * aspect);
        const half = Math.min(Math.tan(hHalf) * 0.9, Math.tan(vHalf) * 0.52);
        const dist = R / Math.max(half, 0.05);
        const pitch = 0.74;
        this.camGoal.pos.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
        this.camGoal.look.set(0, -48, 0);
      } else {
        this.camGoal.pos.set(0, small ? 110 : 66, small ? 130 : 92);
        this.camGoal.look.set(0, small ? -12 : -6, small ? 0 : 2);
      }
      this.setFocusCenter(new THREE.Vector3());
    }
    this.flying = 1;
  }

  /** Fly to one island (null: back to the whole archipelago). */
  focusIsland(id: string | null, offset = 0) {
    if (!id || !this.isles.has(id)) {
      this.view = { kind: "overview" };
      this.selected = null;
    } else this.view = { kind: "island", id, offset };
    this.applyVisibility();
    this.refocus();
  }

  /** Fly to one date spot on an island. */
  focusSpot(id: string, spot: number, offset = 1) {
    if (!this.isles.has(id)) return;
    this.view = { kind: "spot", id, spot, offset };
    this.refocus();
  }

  /** Watch one live date: everyone else on that island steps out of view. */
  focusCouple(id: string | null, offset = 0) {
    const prevIsland = this.selected ? this.couples.get(this.selected)?.type : null;
    this.selected = id && this.couples.has(id) ? id : null;
    const c = this.selected ? this.couples.get(this.selected)! : null;
    this.setFeatured(this.date ? this.featured : c);
    this.applyVisibility();
    if (c) this.focusSpot(c.type, c.spot, offset);
    else if (prevIsland && this.view.kind === "spot") this.focusIsland(prevIsland, offset);
    return !!c;
  }

  setAgents(list: AgentInfo[]) {
    const keep = new Set(list.map((a) => a.id));
    for (const [id, w] of this.agents) {
      if (!keep.has(id)) {
        this.scene.remove(w.group);
        w.dispose();
        this.agents.delete(id);
      }
    }
    for (const a of list) {
      const old = this.agents.get(a.id);
      if (old && (old.info.face !== a.face || old.info.name !== a.name)) {
        this.scene.remove(old.group);
        old.dispose();
        this.agents.delete(a.id);
      }
      if (this.agents.has(a.id)) continue;
      const w = new Wisp(a, this.glow, this.islandR);
      this.agents.set(a.id, w);
      this.scene.add(w.group);
    }
    this.hideBusyWanderers();
  }

  /** Agents who are away on a date don't also wander the home island. */
  hideBusyWanderers() {
    const away = new Set<string>();
    if (this.date) away.add(this.date.a.id).add(this.date.b.id);
    for (const w of this.agents.values()) w.group.visible = !away.has(w.info.id);
  }

  spawnCouple(o: { id: string; type: string; spot: number; a: AgentInfo; b: AgentInfo; started: number; mode?: Mode3D; mine?: boolean; walkIn?: boolean }) {
    const isle = this.isles.get(o.type);
    if (!isle) return null;
    const spotIdx = Math.max(0, Math.min(isle.spots.length - 1, o.spot));
    const spot = isle.spots[spotIdx];
    const mode = o.mode ?? isle.mode;
    const targets: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
    const c: Couple = { id: o.id, type: o.type, spot: spotIdx, a: null!, b: null!, mode, walkT: Math.random(), targets, started: o.started, mine: !!o.mine };
    if (mode === "walk") this.advanceWalk(c, 0, spot);
    const make = (info: AgentInfo, i: 0 | 1) => {
      const w = new Wisp({ ...info }, this.glow, this.islandR);
      w.setSize(dateScale());
      w.speed = 1.2;
      w.pose = mode === "sit" ? "sit" : "stand";
      w.follow = mode === "walk";
      const seat = mode === "walk" ? targets[i] : spot.seats[i];
      const other = mode === "walk" ? targets[1 - i] : spot.seats[1 - i];
      if (o.walkIn) {
        const away = seat.clone().sub(other).setY(0).normalize();
        w.group.position.copy(seat).addScaledVector(away, 2.4).setY(0);
      } else w.group.position.copy(seat).setY(0);
      w.root.rotation.y = Math.atan2(other.x - seat.x, other.z - seat.z);
      w.pinned = seat;
      w.lookAt = mode === "walk" ? null : other;
      w.label.visible = false;
      w.group.userData.couple = o.id;
      this.scene.add(w.group);
      return w;
    };
    c.a = make(o.a, 0);
    c.b = make(o.b, 1);
    this.couples.set(o.id, c);
    return c;
  }

  removeCouple(id: string) {
    const c = this.couples.get(id);
    if (!c) return;
    for (const w of [c.a, c.b]) {
      this.scene.remove(w.group);
      w.dispose();
    }
    this.couples.delete(id);
    if (this.featured === c) this.setFeatured(null);
    if (this.selected === id) this.selected = null;
  }

  /** Dates happening right now on the islands. Couples come and go as the list changes. */
  setLive(list: { id: string; type: string; spot: number | null; started: number; a: AgentInfo; b: AgentInfo }[]) {
    const dateId = this.date?.id;
    const want = new Map(list.filter((x) => x.spot !== null && x.id !== dateId && this.isles.has(x.type)).map((x) => [x.id, x]));
    for (const [id, c] of [...this.couples]) if (!c.mine && !want.has(id)) this.removeCouple(id);
    const nowS = Date.now() / 1000;
    for (const x of want.values()) {
      if (this.couples.has(x.id)) continue;
      this.spawnCouple({ ...x, spot: x.spot!, walkIn: nowS - x.started < 6 });
    }
    this.applyVisibility();
  }

  /** At most two couples per island are drawn; a watched couple or your own date is shown alone. */
  applyVisibility() {
    const byIsle = new Map<string, Couple[]>();
    for (const c of this.couples.values()) {
      const arr = byIsle.get(c.type) ?? [];
      arr.push(c);
      byIsle.set(c.type, arr);
    }
    const mineC = [...this.couples.values()].find((c) => c.mine);
    const sel = this.selected ? this.couples.get(this.selected) : null;
    for (const [isle, arr] of byIsle) {
      let shown: Couple[];
      if (mineC && mineC.type === isle) shown = [mineC];
      else if (sel && sel.type === isle) shown = [sel];
      else {
        const seen = new Set<number>();
        shown = arr
          .sort((x, y) => x.started - y.started)
          .filter((c) => !seen.has(c.spot) && seen.add(c.spot))
          .slice(0, MAX_VISIBLE);
      }
      for (const c of arr) {
        const on = shown.includes(c);
        c.a.group.userData.shown = c.b.group.userData.shown = on;
      }
    }
  }

  setFeatured(c: Couple | null) {
    this.featured = c;
    this.dateWisps = c ? [c.a, c.b] : [];
    if (this.thread) {
      this.scene.remove(this.thread);
      this.thread.geometry.dispose();
      this.thread = undefined;
    }
    for (const x of this.couples.values()) for (const w of [x.a, x.b]) w.label.visible = x === c;
    if (!c) return;
    const n = 70;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(n).map((_, i) => i / n), 1));
    const ca = new THREE.Color().setHSL(c.a.info.hue / 360, 0.85, 0.65);
    const cb = new THREE.Color().setHSL(c.b.info.hue / 360, 0.85, 0.65);
    this.thread = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uA: { value: ca }, uB: { value: cb }, uOn: { value: 0 }, uPR: { value: this.renderer.getPixelRatio() } },
        vertexShader: `attribute float aT; uniform float uTime; uniform float uOn; uniform float uPR; varying float vT; varying float vA;
          void main(){ vT = aT; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv;
          float pulse = .5+.5*sin(aT*25.-uTime*5.);
          vA = uOn*(.35+.65*pulse); gl_PointSize = (5.+7.*pulse)*uPR*(10./-mv.z); }`,
        fragmentShader: `uniform vec3 uA; uniform vec3 uB; varying float vT; varying float vA;
          void main(){ float d = length(gl_PointCoord-.5); if(d>.5) discard;
          gl_FragColor = vec4(mix(uA,uB,vT)*2., smoothstep(.5,0.,d)*vA); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.thread.frustumCulled = false;
    this.scene.add(this.thread);
  }

  advanceWalk(c: Couple, dt: number, spot?: Spot) {
    const s = spot ?? this.isles.get(c.type)?.spots[c.spot];
    if (!s?.route) return;
    const talking = !c.mine || this.date?.phase !== "walking";
    c.walkT += (dt * (talking ? 0.5 : 0.75)) / Math.max(1, s.perimeter);
    const pts = s.route, n = pts.length;
    const f = (((c.walkT % 1) + 1) % 1) * n;
    const i = Math.floor(f);
    const p0 = pts[i], p1 = pts[(i + 1) % n];
    const p = p0.clone().lerp(p1, f - i);
    const fwd = p1.clone().sub(p0).normalize();
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(0.36);
    c.targets[0].copy(p).add(side);
    c.targets[1].copy(p).sub(side);
  }

  /** Your own agent's date: shown alone at its spot, with the thread of light. */
  setDate(info: DateInfo | null) {
    const prev = this.date;
    for (const [id, c] of [...this.couples]) if (c.mine) this.removeCouple(id);
    this.date = info;
    if (!info) {
      this.setFeatured(this.selected ? this.couples.get(this.selected) ?? null : null);
      this.hideBusyWanderers();
      this.applyVisibility();
      return;
    }
    const type = this.isles.has(info.type) ? info.type : ISLAND_IDS[0];
    if (info.id) this.removeCouple(info.id); // drop the live copy of the same date
    const isle = this.isles.get(type)!;
    const c = this.spawnCouple({
      id: info.id ?? "my-date", type, spot: (info.spot ?? 0) % isle.spots.length, a: info.a, b: info.b,
      started: Date.now() / 1000, mode: info.mode, mine: true, walkIn: true,
    })!;
    c.walkT = 0;
    if (c.mode === "walk") this.advanceWalk(c, 0);
    this.setFeatured(c);
    this.hideBusyWanderers();
    this.applyVisibility();
    if (!prev || prev.type !== info.type || prev.spot !== info.spot || this.view.kind !== "spot") this.focusSpot(type, c.spot, 1);
  }

  updateDatePhase(phase: DateInfo["phase"], score?: number) {
    if (!this.date) return;
    const wasDone = this.date.phase === "done";
    this.date = { ...this.date, phase, score };
    if (phase === "done" && !wasDone) this.celebrate(score ?? 70);
  }

  celebrate(score: number) {
    const [a, b] = this.dateWisps;
    if (!a || !b) return;
    const mid = a.chest().add(b.chest()).multiplyScalar(0.5);
    const n = Math.round(30 + score * 1.4);
    const pos = new Float32Array(n * 3),
      vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([mid.x, mid.y + 0.3, mid.z], i * 3);
      const th = Math.random() * Math.PI * 2,
        up = rand(1.2, 3.2);
      vel.set([Math.cos(th) * rand(0.4, 1.6), up, Math.sin(th) * rand(0.4, 1.6)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        color: new THREE.Color(2.2, 1.0, 1.5),
        size: 0.14,
        map: this.glow,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(p);
    this.bursts.push({ p, life: 2.6, vel });
  }

  /* ----------------------------- events ----------------------------- */
  bind() {
    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointerup", this.onUp);
    addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVis);
  }
  onVis = () => {
    this.running = !document.hidden;
    if (this.running) {
      this.clock.getDelta();
      this.loop();
    }
  };
  onResize = () => {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.bloom?.resolution.set(w / 2, h / 2);
    const mobile = detectMobile();
    if (mobile !== MOBILE) {
      MOBILE = mobile;
      for (const person of this.agents.values()) person.setSize(bodyScale(!!person.info.self));
      for (const couple of this.couples.values()) {
        couple.a.setSize(dateScale());
        couple.b.setSize(dateScale());
      }
    }
    this.refocus();
  };
  pick(e: PointerEvent): { kind: "isle" | "couple"; id: string } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const people = [...this.couples.values()].flatMap((c) => [c.a.group, c.b.group]).filter((g) => g.visible);
    const targets = [...people, ...[...this.isles.values()].map((i) => i.group)];
    for (const h of this.raycaster.intersectObjects(targets, true)) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.couple && !o.userData.isle) o = o.parent;
      if (o?.userData.couple) return { kind: "couple", id: o.userData.couple };
      if (o?.userData.isle) return { kind: "isle", id: o.userData.isle };
    }
    return null;
  }
  onMove = (e: PointerEvent) => {
    if (this.mode !== "home") {
      this.hovered = null;
      return;
    }
    const p = this.pick(e);
    this.hovered = p?.kind === "isle" ? p.id : p ? this.couples.get(p.id)?.type ?? null : null;
    this.renderer.domElement.style.cursor = p ? "pointer" : "grab";
  };
  onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  onUp = (e: PointerEvent) => {
    if (this.mode !== "home") return;
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) return;
    const p = this.pick(e);
    if (p?.kind === "couple") this.onCouple?.(p.id);
    else if (p) this.onIsland?.(p.id);
  };

  /* ------------------------------ loop ------------------------------ */
  loop = () => {
    if (!this.running || this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const m = this.motion;
    const t = (this.uniforms.uTime.value += dt * m);

    for (const s of this.sways) {
      s.o.rotation.z = Math.sin(t * 1.1 + s.ph) * s.amp;
      s.o.rotation.x = Math.cos(t * 0.9 + s.ph) * s.amp * 0.6;
    }
    for (const f of this.floaters) {
      f.a += f.sp * dt * m;
      f.o.position.set(Math.cos(f.a) * f.r, f.y + Math.sin(t * 0.6 + f.ph) * 0.5, Math.sin(f.a) * f.r);
    }
    for (const b of this.bobbers) b.o.position.y = b.y + Math.sin(t * 0.8 + b.ph) * 0.08;
    const cam = this.camera.position;
    const camK = Math.max(m, 0.6);

    // couples: walk routes, the featured couple gets a following camera
    for (const c of this.couples.values()) {
      if (c.mode === "walk") this.advanceWalk(c, dt * camK);
      const near = c.a.group.position.distanceTo(cam) < 48;
      const on = !!c.a.group.userData.shown && near;
      c.a.group.visible = c.b.group.visible = on;
      if (on) {
        if (c.mode === "walk") {
          c.a.lookAt = c.b.group.position;
          c.b.lookAt = c.a.group.position;
        }
        c.a.update(dt, t, this.islandR, camK, cam);
        c.b.update(dt, t, this.islandR, camK, cam);
      }
    }
    const f = this.featured;
    if (f && f.mode === "walk" && this.view.kind === "spot" && this.view.id === f.type) {
      const isle = this.isles.get(f.type)!;
      const aspect = innerWidth / Math.max(innerHeight, 1);
      const portrait = aspect < 1.05;
      const small = innerWidth < 800 || portrait;
      const mid = f.a.group.position.clone().add(f.b.group.position).multiplyScalar(0.5);
      const look = mid.clone().add(new THREE.Vector3(0, portrait ? -3.2 : small ? -0.8 : 0.9, 0));
      if (!small) look.addScaledVector(isle.side, 2.2 * this.view.offset);
      this.camGoal.look.copy(look);
      const back = portrait ? 15 : small ? 10 : 7.5 + Math.max(0, this.view.offset - 1) * 2.3;
      this.camGoal.pos.copy(look).addScaledVector(isle.front, back).add(new THREE.Vector3(0, portrait ? 12 : small ? 7 : 3.8, 0)).addScaledVector(isle.side, 0.8);
      this.flying = 1;
    }
    const hubNear = cam.length() < 60;
    for (const w of this.agents.values()) {
      if (!w.group.visible) continue;
      w.update(dt, t, this.islandR, m, cam);
      w.label.visible = this.mode !== "landing" && hubNear && w.group.position.distanceTo(cam) < 30;
    }

    // island labels in the overview, rings on hover / focus
    const focusIsle = this.view.kind === "overview" ? null : this.view.id;
    for (const isle of this.isles.values()) {
      isle.label.visible = this.mode !== "landing" && focusIsle !== isle.id && isle.pos.distanceTo(cam) > 24;
      const mat = isle.ring.material as THREE.MeshBasicMaterial;
      const want = this.hovered === isle.id ? 0.85 : focusIsle === isle.id ? 0.5 : 0;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, want, dt * 6);
    }

    // petals around the soul tree
    const dummy = new THREE.Object3D();
    this.petalData.forEach((p, i) => {
      p.p.addScaledVector(p.v, dt * m);
      p.p.x += Math.sin(t + i) * 0.003 * m;
      p.r.x += dt * 1.5 * m;
      p.r.y += dt * m;
      if (p.p.y < 0.05 || p.p.length() > 13) this.petalData[i] = this.newPetal();
      dummy.position.copy(p.p);
      dummy.rotation.copy(p.r);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      this.petals.setMatrixAt(i, dummy.matrix);
    });
    this.petals.instanceMatrix.needsUpdate = true;

    // thread of light between the featured couple
    if (this.thread && this.dateWisps.length === 2) {
      const [a, b] = this.dateWisps.map((w) => w.chest());
      const close = a.distanceTo(b) < 2.4;
      const on = this.thread.material as THREE.ShaderMaterial;
      on.uniforms.uOn.value = THREE.MathUtils.lerp(on.uniforms.uOn.value, close && this.dateWisps[0].group.visible ? 1 : 0, dt * 2);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y += 0.35 + Math.sin(t * 2) * 0.08;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const arr = this.thread.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < arr.count; i++) {
        const p = curve.getPoint(i / (arr.count - 1));
        arr.setXYZ(i, p.x, p.y, p.z);
      }
      arr.needsUpdate = true;
    }

    // bursts
    this.bursts = this.bursts.filter((b) => {
      b.life -= dt;
      const arr = b.p.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < arr.count; i++) {
        b.vel[i * 3 + 1] -= dt * 1.2;
        arr.setXYZ(i, arr.getX(i) + b.vel[i * 3] * dt, arr.getY(i) + b.vel[i * 3 + 1] * dt, arr.getZ(i) + b.vel[i * 3 + 2] * dt);
      }
      arr.needsUpdate = true;
      (b.p.material as THREE.PointsMaterial).opacity = Math.max(0, b.life / 2.6);
      if (b.life <= 0) {
        this.scene.remove(b.p);
        b.p.geometry.dispose();
        return false;
      }
      return true;
    });

    // camera
    if (this.flying > 0) {
      const k = 1 - Math.pow(0.0015, dt);
      this.camera.position.lerp(this.camGoal.pos, k * 1.2);
      this.controls.target.lerp(this.camGoal.look, k * 1.2);
      if (this.camera.position.distanceTo(this.camGoal.pos) < 0.08) this.flying = 0;
    } else if (this.mode === "landing" && m === 1) {
      const r = Math.hypot(this.camGoal.pos.x, this.camGoal.pos.z);
      const a = Math.atan2(this.camGoal.pos.z, this.camGoal.pos.x) + Math.sin(t * 0.05) * 0.18;
      this.camera.position.set(Math.cos(a) * r, this.camGoal.pos.y + Math.sin(t * 0.13) * 1.2, Math.sin(a) * r);
    } else if (this.mode === "date") {
      this.camera.position.x += Math.sin(t * 0.25) * 0.002 * m;
    }
    this.controls.update();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVis);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
