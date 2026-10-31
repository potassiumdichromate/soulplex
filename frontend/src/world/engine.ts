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
import type { FaceSpec } from "../faces";
import { buildCharacter, holoMaterial } from "./character";
import { modelFor, findClip, instance } from "./models";
import { presetFor } from "../characters";

export type WorldMode = "landing" | "home" | "date" | "calm";
export type AgentInfo = { id: string; name: string; hue: number; self?: boolean; face?: string; skin?: string; hair?: string; outfit?: string; spec?: FaceSpec; holo?: boolean };
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
const MOON_DIR = new THREE.Vector3(-0.45, 0.42, -0.78).normalize();
/** Where the sun is drawn: low over the city on the horizon (the light itself comes from higher up). */
const SUN_DIR = new THREE.Vector3(-0.5, 0.09, -0.86).normalize();

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
    new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, sizeAttenuation: false, fog: false, toneMapped: false }),
  );
  // labels keep a fixed share of the screen height: smaller on phones and on tall screens
  const k = (innerWidth < 800 ? 0.016 : 0.024) * Math.min(1, 900 / Math.max(innerHeight, 1));
  s.scale.set((w / 84) * k, k, 1);
  s.renderOrder = 10;
  return s;
}

/** A white speech bubble with a little tail, for what an agent is saying on a date. */
function bubbleSprite(text: string) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 30 && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
    if (lines.length === 3) break;
  }
  if (lines.length < 3 && cur) lines.push(cur);
  if (lines.length === 3 && words.join(" ").length > lines.join(" ").length) lines[2] = lines[2].replace(/[,.;:!?]?$/, "…");
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = "600 38px Manrope, Inter, system-ui, sans-serif";
  g.font = font;
  const w = Math.ceil(Math.max(...lines.map((l) => g.measureText("“" + l + "”").width))) + 64;
  const lh = 48, h = lines.length * lh + 44, tail = 26;
  c.width = w + 8;
  c.height = h + tail + 8;
  g.font = font;
  g.shadowColor = "rgba(90,50,120,0.25)";
  g.shadowBlur = 8;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.roundRect(4, 4, w, h, 30);
  g.moveTo(w * 0.42, h + 2);
  g.lineTo(w * 0.36, h + tail);
  g.lineTo(w * 0.54, h + 2);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = "#2a1d3d";
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((l, i) => g.fillText((i === 0 ? "“" : "") + l + (i === lines.length - 1 ? "”" : ""), 4 + w / 2, 4 + 22 + lh / 2 + i * lh));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false, fog: false, toneMapped: false }));
  const k = (innerWidth < 800 ? 0.036 : 0.042) * Math.min(1, 900 / Math.max(innerHeight, 1)) * (c.height / 160);
  sp.scale.set((c.width / c.height) * k, k, 1);
  sp.center.set(0.4, 0);
  sp.renderOrder = 20;
  return sp;
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
  /** Moves a point on the home island out of any tree, building or the soul tree (no walking through them). */
  static clear(p: THREE.Vector3, margin = 0.35) {
    for (let pass = 0; pass < 2; pass++)
      for (const o of Wisp.obstacles) {
        const dx = p.x - o.p.x, dz = p.z - o.p.z;
        const d = Math.hypot(dx, dz), min = o.r + margin;
        if (d < min) {
          const k = d > 1e-4 ? min / d : 0;
          p.x = d > 1e-4 ? o.p.x + dx * k : o.p.x + min;
          p.z = d > 1e-4 ? o.p.z + dz * k : p.z;
        }
      }
    return p;
  }
  group = new THREE.Group();
  root: THREE.Group; // body, rotates to face walking direction
  head: THREE.Group;
  eyes: THREE.Group | null = null;
  mouth: THREE.Group | null = null;
  geos: THREE.BufferGeometry[] = [];
  holoTime?: { value: number };
  blinkAt = 1 + Math.random() * 3;
  relax = 0;
  /** A real GLB model, when one exists for this look (replaces the code-built body). */
  model: THREE.Object3D | null = null;
  mixer: THREE.AnimationMixer | null = null;
  clips: Record<string, THREE.AnimationClip | null> = {};
  action: THREE.AnimationAction | null = null;
  state = "";
  modelMats: THREE.Material[] = [];
  hips: THREE.Object3D | null = null;
  gone = false;
  idlePose = 0; // 0 hand behind head, 1 hands in pockets, 2 arms loose
  talkPh = Math.random() * 10;
  label: THREE.Sprite;
  marker: THREE.Mesh;
  legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  arms: { shoulder: THREE.Group; elbow: THREE.Group }[] = [];
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
  color: THREE.Color;
  speed = rand(0.75, 1.0);
  size = 1;
  mats: THREE.Material[] = [];

  constructor(public info: AgentInfo, _glow: THREE.Texture, islandR: number) {
    this.color = new THREE.Color().setHSL(info.hue / 360, 0.75, 0.6);
    const ch = buildCharacter({ seed: info.id, hue: info.hue, skin: info.skin, hair: info.hair, outfit: info.outfit, spec: info.spec, face: info.face, holo: info.holo });
    this.root = ch.root;
    this.head = ch.head;
    this.legs = ch.legs;
    this.arms = ch.arms;
    this.eyes = ch.eyes;
    this.mouth = ch.mouth;
    this.mats.push(...ch.mats);
    this.geos = ch.geos;
    this.holoTime = ch.holoTime;
    this.idlePose = [...info.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 3;
    this.group.add(this.root);
    // ground marker: soft shadow + ring in the person's colour
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.group.add(shadow);
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.3, info.self ? 0.37 : 0.34, 40),
      new THREE.MeshBasicMaterial({
        color: info.self ? 0xffffff : this.color,
        transparent: true,
        opacity: info.self ? 0.9 : 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.025;
    this.group.add(this.marker);
    this.label = labelSprite(info.self ? info.name + " · you" : info.name, "#" + this.color.getHexString());
    if (!info.self) (this.label.material as THREE.SpriteMaterial).opacity = 0.82;
    this.label.position.y = 1.95;
    this.group.add(this.label);
    if (info.holo) {
      shadow.visible = false;
      this.marker.visible = false;
      this.label.visible = false;
    }
    this.setSize(info.self ? 1.5 : 1.4);
    const a = Math.random() * Math.PI * 2,
      r = 2.2 + Math.random() * islandR * 0.55;
    this.group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    this.root.rotation.y = Math.random() * Math.PI * 2;
    this.pickTarget(islandR);
    modelFor(presetFor(info.spec, info.id).id).then((e) => e && !this.gone && this.useModel(e));
  }
  useModel(e: NonNullable<Awaited<ReturnType<typeof modelFor>>>) {
    const m = instance(e);
    if (this.holoTime) {
      const hm = holoMaterial(this.color.clone().offsetHSL(0, 0.1, 0.06), this.holoTime);
      this.modelMats.push(hm);
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.material = hm;
          mesh.castShadow = false;
        }
      });
    }
    for (const ch of this.root.children) ch.visible = false; // hide the code-built body
    this.root.add(m);
    this.model = m;
    m.traverse((o) => {
      if (!this.hips && (o as THREE.Bone).isBone && /hips|pelvis/i.test(o.name)) this.hips = o;
    });
    this.mixer = new THREE.AnimationMixer(m);
    this.clips = {
      idle: findClip(e.clips, ["idle", "standing", "stand", "breathing"]),
      walk: findClip(e.clips, ["walking", "walk", "running", "run"]),
      sit: findClip(e.clips, ["sitting", "sit", "sitting idle"]),
      talk: findClip(e.clips, ["talking", "talk", "sitting talking"]),
    };
    this.state = "";
  }
  play(name: string) {
    if (!this.mixer || name === this.state) return;
    const clip = this.clips[name] ?? this.clips.idle;
    this.state = name;
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    next.reset().setEffectiveWeight(1).fadeIn(0.3).play();
    if (this.action && this.action !== next) this.action.fadeOut(0.3);
    this.action = next;
  }
  setSize(k: number) {
    this.label.scale.multiplyScalar(this.size / k);
    this.size = k;
    this.group.scale.setScalar(k);
  }
  chest() {
    return this.group.position.clone().add(new THREE.Vector3(0, (this.seated ? 0.7 : 1.1) * this.size, 0));
  }
  static faceTexture(info: AgentInfo, color: THREE.Color) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
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
      if (Wisp.obstacles.every((o) => o.p.distanceTo(p) > o.r + 0.7)) {
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
        this.vel.set(0, 0, 0); // stop dead on the spot, so it doesn't drift off and turn back and forth
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
    // walkers on the home island never end up inside a tree (dates on the islands are placed by hand)
    if (!this.pinned || this.follow) {
      const y = pos.y;
      Wisp.clear(pos).setY(y);
    }
    const sp = this.vel.length();
    this.walk = THREE.MathUtils.lerp(this.walk, sp > 0.08 && !this.seated ? 1 : 0, Math.min(1, dt * 6));

    // face where we're going, or the partner on a date
    if (sp > (this.walk > 0.5 ? 0.06 : 0.18) && !this.seated) this.root.rotation.y = angleLerp(this.root.rotation.y, Math.atan2(this.vel.x, this.vel.z), Math.min(1, dt * 8));
    else if (this.lookAt) {
      const lx = this.lookAt.x - pos.x, lz = this.lookAt.z - pos.z;
      this.root.rotation.y = angleLerp(this.root.rotation.y, Math.atan2(lx, lz), Math.min(1, dt * 4));
    }

    // gait
    this.phase += dt * motion * (4 + sp * 6);
    const w = this.walk, ph = this.phase;
    if (this.seated) {
      this.legs.forEach(({ hip, knee }) => {
        hip.rotation.x = THREE.MathUtils.lerp(hip.rotation.x, -1.45, dt * 6);
        knee.rotation.x = THREE.MathUtils.lerp(knee.rotation.x, 1.45, dt * 6);
      });
      this.arms.forEach(({ shoulder, elbow }, i) => {
        shoulder.rotation.x = THREE.MathUtils.lerp(shoulder.rotation.x, -0.55 + Math.sin(t * 1.3 + i) * 0.05, dt * 5);
        elbow.rotation.x = THREE.MathUtils.lerp(elbow.rotation.x, -0.7, dt * 5);
      });
      let seatY = 0.46 - 0.61 * this.size;
      if (this.model) {
        // models sit at whatever height their animation uses: lift or lower them so the hips meet the seat
        seatY = 0;
        if (this.hips && this.clips.sit) {
          const hipAbove = this.hips.getWorldPosition(new THREE.Vector3()).y - pos.y;
          seatY = 0.5 - hipAbove;
        }
      }
      pos.y = THREE.MathUtils.lerp(pos.y, seatY, dt * 6);
      this.root.position.y = 0;
    } else {
      this.legs.forEach(({ hip, knee }, i) => {
        const s = Math.sin(ph + i * Math.PI);
        hip.rotation.x = -s * 0.55 * w;
        knee.rotation.x = Math.max(0, Math.sin(ph + i * Math.PI - 1.1)) * 0.95 * w;
      });
      // relaxed idle poses from the reference: a hand behind the head, or hands in pockets
      const wantRelax = this.info.holo || this.lookAt || this.pinned ? 0 : Math.max(0, 1 - w * 3);
      this.relax = THREE.MathUtils.lerp(this.relax, wantRelax, Math.min(1, dt * 2.5));
      const k = this.relax;
      this.arms.forEach(({ shoulder, elbow }, i) => {
        const side = i === 0 ? -1 : 1;
        let sx = Math.sin(ph + i * Math.PI) * 0.5 * w + Math.sin(t * 1.2 + i) * 0.03;
        let sz = side * 0.08;
        let ex = -0.25 - 0.25 * w;
        if (k > 0.001) {
          let px = sx, pz = sz, qx = ex;
          if (this.idlePose === 0 && i === 1) {
            px = -2.85; pz = side * 0.55; qx = -2.1; // hand behind the head
          } else if (this.idlePose === 1 || (this.idlePose === 0 && i === 0)) {
            px = 0.16; pz = side * 0.14; qx = -0.5; // hands in pockets
          }
          sx = THREE.MathUtils.lerp(sx, px, k);
          sz = THREE.MathUtils.lerp(sz, pz, k);
          ex = THREE.MathUtils.lerp(ex, qx, k);
        }
        shoulder.rotation.x = sx;
        shoulder.rotation.z = sz;
        elbow.rotation.x = ex;
      });
      pos.y = THREE.MathUtils.lerp(pos.y, 0, dt * 6);
      this.root.position.y = Math.abs(Math.sin(ph)) * 0.035 * w + Math.sin(t * 2 + this.phase) * 0.004;
    }
    this.root.rotation.z = Math.sin(ph) * 0.03 * w;

    // the head turns toward the viewer (within a natural range) so faces stay readable
    if (cam) {
      const yaw = Math.atan2(cam.x - pos.x, cam.z - pos.z) - this.root.rotation.y;
      const rel = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      const lim = this.lookAt && this.seated ? 0.9 : 1.15;
      // camera behind the character: look ahead instead of snapping from one shoulder to the other
      const want = Math.abs(rel) > 2.2 ? 0 : THREE.MathUtils.clamp(rel, -lim, lim);
      this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, want, Math.min(1, dt * 5));
    }
    this.head.rotation.x = Math.sin(t * 1.7 + this.phase) * 0.03;
    // blink every few seconds
    if (this.eyes) {
      const bt = t - this.blinkAt;
      if (bt > 0.16) this.blinkAt = t + 2 + Math.random() * 4;
      this.eyes.scale.y = bt > 0 && bt < 0.16 ? 0.12 : THREE.MathUtils.lerp(this.eyes.scale.y, 1, Math.min(1, dt * 20));
    }
    // on a date the two take turns talking
    if (this.mouth) {
      const talking = !!this.lookAt && this.walk < 0.2 && Math.sin(t * 0.55 + this.talkPh) > 0;
      const want = talking ? 1 + Math.max(0, Math.sin(t * 11 + this.phase)) * 0.9 : 1;
      this.mouth.scale.y = THREE.MathUtils.lerp(this.mouth.scale.y, want, Math.min(1, dt * 14));
    }
    if (this.holoTime) this.holoTime.value = t;
    if (this.mixer) {
      const talking = !!this.lookAt && this.walk < 0.2 && Math.sin(t * 0.55 + this.talkPh) > 0;
      const want = this.seated ? (this.clips.sit ? "sit" : "idle") : this.walk > 0.45 ? "walk" : talking && this.clips.talk ? "talk" : "idle";
      this.play(want);
      if (this.action && this.state === "walk") this.action.timeScale = THREE.MathUtils.clamp(this.vel.length() / 0.85, 0.6, 1.7);
      this.mixer.update(dt * motion);
    }
    const m = this.marker.material as THREE.MeshBasicMaterial;
    if (this.info.self) m.opacity = 0.65 + Math.sin(t * 3) * 0.25;
  }
  dispose() {
    this.gone = true;
    if (this.model) {
      this.root.remove(this.model); // shared model geometry stays cached for other characters
      this.mixer?.stopAllAction();
      this.modelMats.forEach((m) => m.dispose());
    }
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
type Spot = { seats: [THREE.Vector3, THREE.Vector3]; focus: THREE.Vector3; route?: THREE.Vector3[]; curve?: THREE.CatmullRomCurve3; perimeter: number; center: THREE.Vector3 };
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
  cafe: 0x7cc25a, walk: 0x6cbd5c, bookshop: 0x78b866, garden: 0x84c95c, cooking: 0xa7b46a,
  streetfood: 0x9aaa62, gallery: 0x86c27e, sunset: 0xdcb87e, stars: 0x5f9a7a, games: 0x79bd68,
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
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  clock = new THREE.Clock();
  uniforms = { uTime: { value: 0 } };
  islandR = HUB_R; // the home island where idle agents wander
  agents = new Map<string, Wisp>();
  /** Your agent: a glowing hologram twin that walks beside your character. */
  twin: Wisp | null = null;
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
  /** rising wisps: coffee steam, chimney smoke */
  puffs: { o: THREE.Mesh; x: number; y: number; z: number; ph: number; h: number; s: number; sp: number; op: number; drift: number }[] = [];
  glow = glowTexture();
  mode: WorldMode = "landing";
  view: View = { kind: "overview" };
  camGoal = { pos: new THREE.Vector3(40, 30, 90), look: new THREE.Vector3(0, -1, 0) };
  flying = 0;
  followMid: THREE.Vector3 | null = null;
  followDir: THREE.Vector3 | null = null;
  ray = new THREE.Raycaster();
  followLift = 0;
  followFor = "";
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
  /** Lite mode for phones, slow connections and low-end devices: no shadows or glow pass, fewer particles. */
  low = (() => {
    const q = new URLSearchParams(location.search).get("quality");
    if (q === "high") return false; // e.g. for recording videos
    if (q === "low") return true;
    const n = navigator as any;
    const c = n.connection ?? {};
    return innerWidth < 800 || !!c.saveData || ["slow-2g", "2g", "3g"].includes(c.effectiveType) || (n.deviceMemory ?? 8) <= 2 || (n.hardwareConcurrency ?? 8) <= 2;
  })();
  /** Screen area covered by panels; the camera centres its subject in the part that stays visible. */
  insets = { bottom: 0, left: 0 };
  raf = 0;
  running = true;
  disposed = false;
  down = { x: 0, y: 0, t: 0 };

  constructor(public host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const pr = Math.min(devicePixelRatio, this.low ? 1.25 : 1.6);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.toneMapping = THREE.NeutralToneMapping; // keeps the pastels' colour (ACES greys them)
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = !this.low;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.1, 3000);
    this.camera.position.set(40, 30, 90);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 420;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.42;
    this.controls.autoRotateSpeed = 0.25;
    this.controls.enabled = false;

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(host.clientWidth, host.clientHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(host.clientWidth / 2, host.clientHeight / 2), 0.32, 0.4, 1.15);
    if (!this.low) this.composer.addPass(this.bloom); // the glow pass is the most expensive part
    this.composer.addPass(new OutputPass());

    this.build();
    this.bind();
    this.loop();
  }

  /* ----------------------------- build ----------------------------- */
  build() {
    this.scene.fog = new THREE.FogExp2(0xf0e2f2, 0.0014);
    this.sky();
    this.moon(); // a soft daytime sun
    this.ocean(); // a sea of clouds below the islands
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
      uniforms: { uMoon: { value: SUN_DIR } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 uMoon;
        void main(){
          float y = vDir.y;
          vec3 horizon = vec3(1.0,0.86,0.88);
          vec3 blush = vec3(0.97,0.80,0.90);
          vec3 lilac = vec3(0.86,0.78,0.96);
          vec3 top = vec3(0.74,0.72,0.95);
          vec3 c = mix(horizon, blush, smoothstep(-0.02,0.12,y));
          c = mix(c, lilac, smoothstep(0.10,0.38,y));
          c = mix(c, top, smoothstep(0.35,0.95,y));
          // a warm glow round the sun
          float m = max(dot(vDir,uMoon),0.);
          c += vec3(1.,0.88,0.72)*pow(m,8.)*0.22;
          c += vec3(1.,0.97,0.9)*pow(m,180.)*0.9;
          if(y<0.) c = mix(horizon, vec3(0.98,0.9,0.95), smoothstep(0.,-0.2,y));
          gl_FragColor = vec4(c,1.);
        }`,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1300, 48, 24), m));
  }
  stars() {
    const n = this.low ? 800 : 1800,
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
    const p = SUN_DIR.clone().multiplyScalar(1000);
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(34, 32, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 1.18, 1.05), fog: false }),
    );
    moon.position.copy(p);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glow,
        color: 0xffe2c4,
        transparent: true,
        opacity: 0.55,
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
    const seg = this.low ? 110 : 240;
    const g = new THREE.PlaneGeometry(2400, 2400, seg, seg);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uMoon: { value: SUN_DIR } },
      vertexShader: `uniform float uTime; varying vec3 vW;
        void main(){ vec3 p = position;
          p.y += sin(p.x*.06+uTime*.45)*.35 + sin(p.z*.08+uTime*.55)*.28;
          vec4 w = modelMatrix*vec4(p,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 uMoon; uniform float uTime; varying vec3 vW;
        vec2 grad(vec2 p, float t){
          float dx = .06*.35*cos(p.x*.06+t*.45) + .25*.08*cos((p.x+p.y)*.25+t*1.1) + .43*.04*cos((p.x-p.y)*.43+t*1.6) + 1.1*.018*cos(p.x*1.1+p.y*.6+t*2.2);
          float dz = .08*.28*cos(p.y*.08+t*.55) + .25*.08*cos((p.x+p.y)*.25+t*1.1) - .43*.04*cos((p.x-p.y)*.43+t*1.6) + 1.3*.015*cos(p.y*1.3-p.x*.4+t*2.7);
          return vec2(dx,dz);
        }
        void main(){
          vec2 gr = grad(vW.xz, uTime);
          float d = length(vW.xz-cameraPosition.xz);
          gr *= 1.-smoothstep(60.,320.,d)*.75;
          vec3 n = normalize(vec3(-gr.x, 1., -gr.y));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.-max(dot(n,v),0.),4.);
          // calm pastel water: periwinkle-lilac, a little lighter where it mirrors the pink sky
          vec3 deep = vec3(.46,.47,.86);
          vec3 sky = mix(vec3(.98,.80,.90), vec3(.74,.70,.95), clamp(reflect(-v,n).y*2.2,0.,1.));
          vec3 c = mix(deep, sky, .22+fres*.55);
          // fine ripples catch the light
          float rip = sin(vW.x*1.7+uTime*1.3+sin(vW.z*.9)*2.)*sin(vW.z*1.3-uTime*1.1);
          c += vec3(.10,.09,.12)*smoothstep(.55,1.,rip)*(1.-smoothstep(40.,220.,d));
          // a path of sun glitter
          vec3 r = reflect(-uMoon, n);
          float sp = max(dot(r,v),0.);
          c += vec3(1.,.95,.88)*pow(sp,220.)*1.6;
          c += vec3(1.,.9,.85)*pow(sp,14.)*.22;
          vec3 horizon = vec3(1.0,0.86,0.9);
          c = mix(c, horizon, smoothstep(220.,1100.,d));
          gl_FragColor = vec4(c,1.);
        }`,
    });
    const sea = new THREE.Mesh(g, m);
    sea.position.y = -14;
    this.scene.add(sea);
    this.sailboats();
    this.skyline();
  }

  /** A few little sailboats drifting on the water. */
  sailboats() {
    const rnd = seeded(77);
    for (let i = 0; i < (this.low ? 5 : 9); i++) {
      const b = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.25, 0.5, 6, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0xfaf4ee, flatShading: true }));
      hull.rotation.set(0, 0, Math.PI / 2);
      hull.scale.set(1, 2.6, 1);
      hull.position.y = 0.15;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 5), new THREE.MeshStandardMaterial({ color: 0x8a6a5a }));
      mast.position.y = 1.5;
      const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.2, 0), new THREE.Vector2(0, 2.2)]);
      const sail = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshStandardMaterial({ color: i % 3 ? 0xfffaf5 : 0xffd6e4, side: THREE.DoubleSide, roughness: 0.9 }));
      sail.position.set(0.06, 0.45, 0);
      sail.rotation.y = Math.PI / 2;
      const jib = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-0.8, 0), new THREE.Vector2(0, 1.7)])), sail.material);
      jib.position.set(0.06, 0.45, 0);
      jib.rotation.y = Math.PI / 2;
      b.add(hull, mast, sail, jib);
      const a = rnd() * Math.PI * 2, r = 55 + rnd() * 120;
      b.position.set(Math.cos(a) * r, -13.9, Math.sin(a) * r);
      b.rotation.y = rnd() * Math.PI * 2;
      b.scale.setScalar(1.4 + rnd() * 0.8);
      this.bake(b);
      this.scene.add(b);
      this.floaters.push({ o: b, ph: rnd() * 10, r, a, y: -13.85, sp: 0.004 + rnd() * 0.004 });
    }
  }

  /** A hazy city skyline far away on the horizon. */
  skyline() {
    const base = SUN_DIR.clone().setY(0).normalize();
    const side = new THREE.Vector3(base.z, 0, -base.x);
    const rnd = seeded(31);
    // two layers of towers: a crisper one in front, a paler one behind it
    for (const [dist, color, opacity, count, spread] of [[560, 0xa58bc9, 0.82, 52, 6.5], [700, 0xc4b0e0, 0.6, 40, 9]] as [number, number, number, number, number][]) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color, fog: false, transparent: true, opacity, depthWrite: false });
      for (let i = 0; i < count; i++) {
        const off = (i - count / 2) * spread + (rnd() - 0.5) * 4;
        const centre = Math.max(0, 1 - Math.abs(off) / 120);
        const h = 14 + rnd() * rnd() * 60 + centre * 45;
        const w = 5 + rnd() * 6;
        const tower = new THREE.Mesh(rnd() > 0.8 ? new THREE.CylinderGeometry(w * 0.45, w * 0.55, h, 8) : new THREE.BoxGeometry(w, h, w), mat);
        tower.position.copy(base).multiplyScalar(dist + rnd() * 30).addScaledVector(side, off).setY(-14 + h / 2);
        g.add(tower);
        if (rnd() > 0.75) {
          const tip = new THREE.Mesh(new THREE.ConeGeometry(w * 0.3, h * 0.25, 6), mat);
          tip.position.copy(tower.position).setY(-14 + h + h * 0.12);
          g.add(tip);
        }
      }
      if (dist === 560) {
        // one needle-thin landmark tower, stepping up to a spire
        const spire = new THREE.Group();
        [[11, 70], [8.5, 60], [6, 50], [4, 38], [2.2, 34], [0.7, 40]].reduce((y, [w, h]) => {
          const m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.72, w, h, 6), mat);
          m.position.y = y + h / 2;
          spire.add(m);
          return y + h;
        }, -14);
        spire.position.copy(base).multiplyScalar(dist + 20).addScaledVector(side, 22);
        g.add(spire);
      }
      g.updateMatrixWorld(true);
      const parts: THREE.BufferGeometry[] = [];
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const gg = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
        for (const k of Object.keys(gg.attributes)) if (k !== "position" && k !== "normal") gg.deleteAttribute(k);
        parts.push(gg);
      });
      this.scene.add(new THREE.Mesh(mergeGeometries(parts), mat));
    }
  }

  lights() {
    this.scene.add(new THREE.HemisphereLight(0xfff2f8, 0xc79a8a, 1.25));
    const moon = new THREE.DirectionalLight(0xfff1e2, 2.3);
    moon.position.copy(MOON_DIR.clone().multiplyScalar(30));
    moon.castShadow = true;
    moon.shadow.mapSize.set(1536, 1536);
    const c = moon.shadow.camera;
    c.left = c.bottom = -12;
    c.right = c.top = 12;
    c.near = 1;
    c.far = 80;
    moon.shadow.normalBias = 0.05;
    moon.shadow.radius = 4;
    this.moonLight = moon;
    this.scene.add(moon, moon.target);
    const sunset = new THREE.DirectionalLight(0xffc6a8, 0.7);
    sunset.position.set(30, 6, 26);
    this.scene.add(sunset);
    // two warm lights travel with the camera's focus (cheaper than a light per venue)
    for (const [y, k] of [[2.4, 3.2], [1.6, 1.8]] as const) {
      const l = new THREE.PointLight(0xffc28a, k * 0.45, 10, 1.6);
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
    const top = new THREE.CylinderGeometry(R, R * 0.92, 1.0, 48, 2);
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
      new THREE.TorusGeometry(R * 0.985, 0.16, 6, 56),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(grassColor).offsetHSL(0, 0, 0.06), flatShading: true }),
    );
    lip.rotation.x = Math.PI / 2;
    lip.position.y = -0.04;
    const h = R * 1.15;
    const under = new THREE.ConeGeometry(R * 0.93, h, 32, 6);
    under.rotateX(Math.PI);
    const ua = under.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(ua.count * 3);
    const cTop = new THREE.Color(0xf0bccb), cMid = new THREE.Color(0xd9a0ba), cBot = new THREE.Color(0xb98cb6);
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
    g.userData.scale = scale;
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
    const lit: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [], litDS: THREE.BufferGeometry[] = [];
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
          (glowing ? glow : mat.side === THREE.DoubleSide ? litDS : lit).push(g);
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
    if (litDS.length) {
      const mesh = new THREE.Mesh(mergeGeometries(litDS), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide }));
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    }
    if (glow.length) root.add(new THREE.Mesh(mergeGeometries(glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
    lit.concat(glow, litDS).forEach((g) => g.dispose());
  }

  /** A sagging plank-and-rope bridge from radius r0 to r1 along dir, with posts and fairy lights. */
  ropeBridge(g: THREE.Object3D, dir: THREE.Vector3, r0: number, r1: number) {
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const L = r1 - r0, sag = 1.1;
    const at = (t: number, off = 0, lift = 0) => dir.clone().multiplyScalar(r0 + L * t).addScaledVector(side, off).setY(-Math.sin(Math.PI * t) * sag + lift);
    const yaw = Math.atan2(dir.x, dir.z);
    const n = Math.round(L / 0.34);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = at(t);
      const slope = Math.atan2(-Math.cos(Math.PI * t) * sag * Math.PI / L, 1);
      const plank = this.box(1.15, 0.06, 0.26, k % 2 ? 0xb17d55 : 0xa06e4a, { roughness: 0.95 });
      plank.position.copy(p).setY(p.y - 0.03);
      plank.rotation.set(0, yaw, 0);
      plank.rotateX(-slope);
      g.add(plank);
    }
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1 });
    for (const off of [-0.58, 0.58]) {
      const pts = Array.from({ length: 24 }, (_, i) => at(i / 23, off, 0.62 + Math.sin((Math.PI * i) / 23) * 0.25));
      const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.028, 5), ropeMat);
      g.add(rail);
      const posts = 6;
      for (let k = 0; k <= posts; k++) {
        const t = k / posts, base = at(t, off), topP = at(t, off, 0.62 + Math.sin(Math.PI * t) * 0.25);
        const post = this.box(0.07, topP.y - base.y + 0.06, 0.07, 0x6e4a32);
        post.position.copy(base).lerp(topP, 0.5);
        g.add(post);
      }
      const cols = [0xffe2a0, 0xffc2d8, 0xfff4d6];
      for (let k = 1; k < 22; k++) {
        const t = k / 22;
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), new THREE.MeshStandardMaterial({ color: cols[k % 3], emissive: cols[k % 3], emissiveIntensity: 2.2 }));
        b.position.copy(at(t, off, 0.6 + Math.sin(Math.PI * t) * 0.25 - 0.05));
        g.add(b);
      }
    }
  }

  /* ---------------------------- home island ---------------------------- */
  hub() {
    const g = new THREE.Group();
    this.scene.add(g);
    this.base(g, HUB_R, 0x79c25e, 0x7b6cff, 7);
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
      // a wooden rope bridge out to the island, strung with fairy lights
      this.ropeBridge(g, dir, HUB_R - 0.35, RING - ISLE_R + 0.35);
    });
    Wisp.obstacles = obstacles;
    {
      const ring = new THREE.Mesh(new THREE.RingGeometry(HUB_R - 0.6, HUB_R - 0.06, 96), new THREE.MeshStandardMaterial({ color: 0xf4c5d4, roughness: 0.9 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.014;
      ring.receiveShadow = true;
      g.add(ring);
    }
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
      // the crown reaches about 0.9 x scale from the trunk
      obstacles.push({ p: t.position.clone(), r: 0.95 * t.scale.x * (t.userData.scale ?? 1) });
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
      const tr = this.tree(rnd() < 0.62, 0.65 + rnd() * 0.45);
      tr.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
      tr.rotation.y = rnd() * 6;
      g.add(tr);
    }
    if (id !== "sunset")
      for (const x of [-1, 1]) this.lamp(g, x * (ISLE_R - 0.5) * 0.7, (ISLE_R - 0.5) * 0.7);
    this.pinkRim(g, ISLE_R, id === "sunset" ? 0xf6d2c4 : 0xf4c5d4, rnd);
    // hover / focus ring and the island's name for the overview
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ISLE_R + 0.15, ISLE_R + 0.45, 64),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    const label = labelSprite(`${t.icon}  ${t.island}`, t.color);
    label.scale.multiplyScalar(1.25);
    label.position.set(0, 4.6, 0);
    label.visible = false;
    g.add(label);
    this.clearTreesFromPaths(g, content, defs, id);
    this.bake(g);
    g.updateMatrixWorld(true);
    const w = (v: THREE.Vector3) => content.localToWorld(v.clone());
    const spots: Spot[] = defs.map((d) => {
      const route = d.route?.map(w);
      let perimeter = 0;
      route?.forEach((p, k) => (perimeter += p.distanceTo(route[(k + 1) % route.length])));
      const center = route ? route.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / route.length) : w(d.focus);
      // a smooth closed path through the route points, walked at an even pace (no jolts at the corners)
      const curve = route && route.length > 2 ? new THREE.CatmullRomCurve3(route, true, "centripetal") : undefined;
      if (curve) perimeter = curve.getLength();
      return { seats: [w(d.seats[0]), w(d.seats[1])], focus: w(d.focus), route, curve, perimeter, center };
    });
    this.isles.set(id, {
      id, group: g, pos: g.position.clone(), front, side: new THREE.Vector3(front.z, 0, -front.x),
      color, mode: t.mode, spots, label, ring,
    });
  }

  /**
   * The pink touches round an island's edge: a band of rosy paving, a low dark railing strung with
   * fairy lights (open at the front and back for paths and the bridge), and pink flower planters.
   */
  pinkRim(g: THREE.Object3D, R: number, pave: number, rnd: () => number, gaps = [Math.PI / 2, -Math.PI / 2]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.55, R - 0.06, 72), new THREE.MeshStandardMaterial({ color: pave, roughness: 0.9 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.014;
    ring.receiveShadow = true;
    g.add(ring);
    // paving joints
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const j = this.box(0.5, 0.004, 0.03, new THREE.Color(pave).multiplyScalar(0.88).getHex());
      j.position.set(Math.cos(a) * (R - 0.3), 0.017, Math.sin(a) * (R - 0.3));
      j.rotation.y = -a;
      g.add(j);
    }
    const open = (a: number) => gaps.some((gp) => Math.abs(Math.atan2(Math.sin(a - gp), Math.cos(a - gp))) < 0.55);
    const rail = 0x5b4060, rr = R - 0.18, step = 0.16;
    const lights = [0xffe2a0, 0xffc2d8, 0xfff4d6];
    for (let a = 0, k = 0; a < Math.PI * 2; a += step, k++) {
      if (open(a) || open(a + step)) continue;
      const post = this.box(0.05, 0.5, 0.05, rail);
      post.position.set(Math.cos(a) * rr, 0.25, Math.sin(a) * rr);
      g.add(post);
      const mid = a + step / 2, len = 2 * rr * Math.sin(step / 2);
      for (const y of [0.48, 0.26]) {
        const bar = this.box(len, 0.035, 0.035, rail);
        bar.position.set(Math.cos(mid) * rr, y, Math.sin(mid) * rr);
        bar.rotation.y = -mid + Math.PI / 2;
        g.add(bar);
      }
      if (k % 2 === 0) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), new THREE.MeshStandardMaterial({ color: lights[k % 3], emissive: lights[k % 3], emissiveIntensity: 2.2 }));
        b.position.set(Math.cos(mid) * rr, 0.56, Math.sin(mid) * rr);
        g.add(b);
      }
    }
    // pink planters at the sides
    for (const a of [0.15, -0.35, Math.PI - 0.15, Math.PI + 0.35]) {
      const px = Math.cos(a) * (R - 0.85), pz = Math.sin(a) * (R - 0.85);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.32, 10), new THREE.MeshStandardMaterial({ color: 0xf2a9c0, flatShading: true }));
      pot.position.set(px, 0.16, pz);
      g.add(pot);
      const plant = new THREE.Group();
      plant.position.set(px, 0.3, pz);
      g.add(plant);
      this.bush(plant, 0, 0, 0.24, rnd() > 0.5 ? 0xff8fb8 : 0xffc2d8);
    }
  }

  /** Drops any tree whose crown would overlap a walking path or a seat, so no one walks or sits inside a tree. */
  clearTreesFromPaths(g: THREE.Object3D, content: THREE.Object3D, defs: SpotDef[], id: string) {
    g.updateMatrixWorld(true);
    const toLocal = (o: THREE.Object3D) => content.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    const pathPts: THREE.Vector3[] = [], seatPts: THREE.Vector3[] = [];
    for (const d of defs) {
      seatPts.push(d.seats[0], d.seats[1]);
      if (d.route && d.route.length > 2) {
        const c = new THREE.CatmullRomCurve3(d.route, true, "centripetal");
        for (let i = 0; i < 120; i++) pathPts.push(c.getPointAt(i / 120));
      }
    }
    const trees: THREE.Object3D[] = [];
    g.traverse((o) => o.userData.scale && trees.push(o));
    let n = 0;
    for (const t of trees) {
      const p = toLocal(t), crown = 0.9 * (t.userData.scale as number) * t.scale.x;
      const near = (q: THREE.Vector3, m: number) => Math.hypot(q.x - p.x, q.z - p.z) < crown + m;
      // walkers (two side by side, about 0.4 either side of the path) and seated agents
      if (pathPts.some((q) => near(q, 0.75)) || seatPts.some((q) => near(q, 0.35))) {
        t.parent?.remove(t);
        n++;
      }
    }
    if (n && (window as any).__soulplexDebug) console.log("trees cleared", id, n);
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

  /** A wisp that rises and fades (steam over a cup, smoke from a chimney), looping forever. */
  puff(parent: THREE.Object3D, x: number, y: number, z: number, o: { h?: number; s?: number; sp?: number; op?: number; color?: number; drift?: number; n?: number } = {}) {
    const n = this.low ? Math.min(1, o.n ?? 3) : o.n ?? 3;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 8, 6),
        new THREE.MeshBasicMaterial({ color: o.color ?? 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
      );
      m.position.set(x, y, z);
      parent.add(m);
      this.puffs.push({ o: m, x, y, z, ph: i / n + Math.random() * 0.1, h: o.h ?? 0.45, s: o.s ?? 0.045, sp: o.sp ?? 0.45, op: o.op ?? 0.35, drift: o.drift ?? 0 });
    }
  }

  /** Text painted on a small board (signs, menus). */
  signBoard(lines: { t: string; font: string; color: string; y: number }[], w: number, h: number, bg: string, frame = "#6b3f36") {
    const c = document.createElement("canvas");
    const K = 400; // canvas pixels per world unit
    c.width = Math.round(w * K);
    c.height = Math.round(h * K);
    const x = c.getContext("2d")!;
    x.fillStyle = frame;
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = bg;
    x.fillRect(14, 14, c.width - 28, c.height - 28);
    x.textAlign = "center";
    x.textBaseline = "middle";
    for (const l of lines) {
      // fonts are written for 200 px per unit; scale them and keep every line inside the board
      x.font = l.font.replace(/(\d+)px/, (_, n) => Math.round(+n * (K / 200)) + "px");
      x.fillStyle = l.color;
      x.fillText(l.t, c.width / 2, l.y * c.height, c.width - 40);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  }

  /** A little round bush, optionally dotted with flowers. */
  bush(parent: THREE.Object3D, x: number, z: number, r = 0.32, flowers?: number) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), new THREE.MeshStandardMaterial({ color: 0x4f9156, flatShading: true }));
    b.position.set(x, r * 0.75, z);
    b.scale.y = 0.8;
    b.castShadow = true;
    parent.add(b);
    if (flowers != null)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + x;
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshStandardMaterial({ color: flowers, emissive: flowers, emissiveIntensity: 0.15 }));
        f.position.set(x + Math.cos(a) * r * 0.8, r * (0.75 + 0.35 * Math.sin(i * 2.1)), z + Math.sin(a) * r * 0.8);
        parent.add(f);
      }
  }

  /** A window box spilling with flowers. */
  flowerBox(parent: THREE.Object3D, x: number, y: number, z: number, w: number) {
    const box = this.box(w, 0.16, 0.2, 0x7a4a3a);
    box.position.set(x, y, z);
    parent.add(box);
    const cols = [0xff7aa8, 0xffd166, 0xffffff, 0xff9f6b, 0xc58cff];
    for (let i = 0; i < Math.round(w * 9); i++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: 0x3f7d4c, flatShading: true }));
      const fx = x - w / 2 + 0.06 + (i / (w * 9)) * (w - 0.1);
      leaf.position.set(fx, y + 0.1, z + (i % 2 ? 0.04 : -0.03));
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], emissive: cols[i % cols.length], emissiveIntensity: 0.2 }));
      fl.position.set(fx + 0.03, y + 0.16 + (i % 3) * 0.02, z + 0.06);
      parent.add(leaf, fl);
    }
  }

  /**
   * A cosy shop: stone base, walls, a gable roof (optional dormer and smoking chimney), two big lit windows
   * with flower boxes, a glass door and lamp, a striped awning and a painted name board. Front wall at z + 1.
   */
  cottage(g: THREE.Object3D, z: number, o: {
    wall: number; roof: number; ridge?: number; awning: [string, string]; name: string; frame?: number; w?: number;
    signColor?: string; signBg?: string; font?: string; dormer?: boolean; chimney?: boolean; windowTex?: THREE.Texture; flowers?: boolean;
  }) {
    const W = o.w ?? 3.0, wood = o.frame ?? 0x8a5a44;
    const base = this.box(W + 0.2, 0.4, 2.1, 0x9b8b84);
    base.position.set(0, 0.2, z);
    const body = this.box(W, 1.75, 2.0, o.wall);
    body.position.set(0, 1.25, z);
    g.add(base, body);
    for (const sgn of [-1, 1]) {
      const slope = this.box(W + 0.4, 0.12, 1.45, o.roof);
      slope.position.set(0, 2.43, z + sgn * 0.52);
      slope.rotation.x = sgn * 0.72;
      g.add(slope);
      const tri = new THREE.Shape([new THREE.Vector2(-1.0, 0), new THREE.Vector2(1.0, 0), new THREE.Vector2(0, 0.74)]);
      const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.08, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: o.wall, flatShading: true }));
      gable.rotation.y = Math.PI / 2;
      gable.position.set(sgn * (W / 2 - 0.04) - 0.04, 2.12, z);
      gable.castShadow = true;
      g.add(gable);
    }
    const ridge = this.box(W + 0.45, 0.1, 0.12, o.ridge ?? new THREE.Color(o.roof).multiplyScalar(0.8).getHex());
    ridge.position.set(0, 2.88, z);
    g.add(ridge);
    if (o.dormer !== false) {
      const dorm = this.box(0.7, 0.55, 0.6, o.wall);
      dorm.position.set(-0.6, 2.62, z + 0.62);
      const dormRoof = this.box(0.85, 0.08, 0.72, o.roof);
      dormRoof.position.set(-0.6, 2.94, z + 0.6);
      dormRoof.rotation.x = 0.25;
      const round = new THREE.Mesh(new THREE.CircleGeometry(0.17, 16), this.windowMat());
      round.position.set(-0.6, 2.62, z + 0.93);
      g.add(dorm, dormRoof, round);
    }
    if (o.chimney !== false) {
      const ch = this.box(0.32, 0.75, 0.32, 0x8a5a4c);
      ch.position.set(0.95, 2.95, z - 0.35);
      const chTop = this.box(0.4, 0.08, 0.4, 0x6e463c);
      chTop.position.set(0.95, 3.35, z - 0.35);
      g.add(ch, chTop);
      this.puff(g, 0.95, 3.45, z - 0.35, { h: 1.6, s: 0.13, sp: 0.16, op: 0.32, color: 0xe9e2f0, drift: 0.5, n: 4 });
    }
    const wx = W * 0.307;
    for (const sx of [-wx, wx]) {
      const fr = this.box(0.9, 0.95, 0.06, wood);
      fr.position.set(sx, 1.12, z + 1.01);
      const glass = this.box(0.78, 0.83, 0.04, 0);
      glass.material = o.windowTex
        ? new THREE.MeshStandardMaterial({ map: o.windowTex, emissive: 0xffffff, emissiveMap: o.windowTex, emissiveIntensity: 0.9 })
        : this.windowMat();
      glass.position.set(sx, 1.12, z + 1.04);
      const mv = this.box(0.04, 0.83, 0.03, wood);
      mv.position.set(sx, 1.12, z + 1.065);
      const mh = this.box(0.78, 0.04, 0.03, wood);
      mh.position.set(sx, 1.25, z + 1.065);
      g.add(fr, glass, mv, mh);
      if (o.flowers !== false) this.flowerBox(g, sx, 0.6, z + 1.12, 0.86);
    }
    const door = this.box(0.62, 1.15, 0.06, 0x5b3a2e);
    door.position.set(0, 0.97, z + 1.02);
    const doorGlass = this.box(0.42, 0.5, 0.04, 0);
    doorGlass.material = this.windowMat();
    doorGlass.position.set(0, 1.18, z + 1.05);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe2b660, metalness: 0.6, roughness: 0.3 }));
    knob.position.set(0.22, 0.95, z + 1.07);
    const step = this.box(0.9, 0.1, 0.35, 0x9b8b84);
    step.position.set(0, 0.05, z + 1.18);
    g.add(door, doorGlass, knob, step);
    const wl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe0a8, emissive: 0xffb860, emissiveIntensity: 2.6 }));
    wl.position.set(0, 1.78, z + 1.12);
    g.add(wl);
    const aw = this.awning(o.awning, W + 0.2, 0.85);
    aw.position.set(0, 1.86, z + 1.36);
    aw.rotation.x = -0.82;
    g.add(aw);
    const sign = this.signBoard([{ t: o.name, font: o.font ?? "italic 600 50px Georgia, serif", color: o.signColor ?? "#6b3f36", y: 0.54 }], 1.7, 0.38, o.signBg ?? "#fff4e2");
    sign.position.set(0, 2.32, z + 1.06);
    sign.rotation.x = -0.12;
    g.add(sign);
  }

  /** Little triangular flags along a sagging line. */
  bunting(from: THREE.Vector3, to: THREE.Vector3, sag: number, n: number, parent: THREE.Object3D, cols = [0xff7aa8, 0xffd166, 0x7ec8ff, 0xc58cff, 0x7be0a8]) {
    const tri = new THREE.Shape([new THREE.Vector2(-0.09, 0), new THREE.Vector2(0.09, 0), new THREE.Vector2(0, -0.2)]);
    const geo = new THREE.ShapeGeometry(tri);
    const dir = to.clone().sub(from);
    const yaw = Math.atan2(dir.x, dir.z) - Math.PI / 2;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = from.clone().lerp(to, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      const f = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, roughness: 0.9 }));
      f.position.copy(p);
      f.rotation.y = yaw;
      parent.add(f);
    }
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, from.distanceTo(to), 4), new THREE.MeshStandardMaterial({ color: 0x3a2c3f }));
    line.position.copy(from).lerp(to, 0.5).setY((from.y + to.y) / 2 - sag * 0.6);
    line.lookAt(to.x, line.position.y, to.z);
    line.rotateX(Math.PI / 2);
    parent.add(line);
  }

  /** A glowing paper lantern that sways a little on its string. */
  paperLantern(parent: THREE.Object3D, x: number, y: number, z: number, color = 0xff5a4e, r = 0.16) {
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6 }));
    body.scale.y = 1.25;
    body.position.y = -r * 1.3;
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2a1f2e });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.04, 10), capMat);
    top.position.y = -0.02;
    const bot = top.clone();
    bot.position.y = -r * 2.6;
    const tassel = this.box(0.02, 0.12, 0.02, 0xffd166);
    tassel.position.y = -r * 2.6 - 0.08;
    holder.add(body, top, bot, tassel);
    parent.add(holder);
    return holder;
  }

  /**
   * One palm frond: an arching, drooping leaf with a folded midrib and serrated edges (the leaflets).
   * Built along +x, rising then drooping.
   */
  frondGeometry(L: number, W: number, rise: number, droop: number, segs = 14) {
    const pos: number[] = [];
    const pt = (t: number) => new THREE.Vector3(L * t, rise * t - droop * t * t, 0);
    const width = (t: number, i: number) => W * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05)), 0.8) * (i % 2 ? 0.55 : 1);
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const c0 = pt(t0), c1 = pt(t1);
      const w0 = width(t0, i), w1 = width(t1, i + 1);
      const f0 = w0 * 0.35, f1 = w1 * 0.35; // the leaf folds down from the midrib
      const l0 = new THREE.Vector3(c0.x, c0.y - f0, w0), l1 = new THREE.Vector3(c1.x, c1.y - f1, w1);
      const r0 = new THREE.Vector3(c0.x, c0.y - f0, -w0), r1 = new THREE.Vector3(c1.x, c1.y - f1, -w1);
      for (const v of [c0, l0, c1, l0, l1, c1, c0, c1, r0, r0, c1, r1]) pos.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  /** A palm tree: a smooth curving ringed trunk and a full crown of drooping fronds. */
  palm(parent: THREE.Object3D, x: number, z: number, h = 2.4, lean = 0.25) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(-x, -z);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, h * 0.55, lean * h * 0.15), new THREE.Vector3(0, h, lean * h * 0.75));
    const bark = new THREE.MeshStandardMaterial({ color: 0xa67c58, roughness: 0.95 });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x7a5638, roughness: 1 });
    const n = 10, up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const a = curve.getPoint(t0), b2 = curve.getPoint(t1);
      const len = a.distanceTo(b2);
      const r0 = 0.15 - t0 * 0.06, r1 = 0.15 - t1 * 0.06;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0 * 1.06, len * 1.04, 10), bark);
      seg.position.copy(a).lerp(b2, 0.5);
      seg.quaternion.setFromUnitVectors(up, b2.clone().sub(a).normalize());
      seg.castShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r0 * 1.04, 0.022, 5, 14), ringMat);
      ring.position.copy(a);
      ring.quaternion.copy(seg.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      g.add(seg, ring);
    }
    const top = curve.getPoint(1);
    const crown = new THREE.Group();
    crown.position.copy(top);
    const greens = [0x45a854, 0x56b860, 0x3b9a4b];
    const fronds = 11;
    for (let k = 0; k < fronds; k++) {
      const L = 1.25 + (k % 3) * 0.18;
      const leaf = new THREE.Mesh(
        this.frondGeometry(L, 0.2, 0.35 + (k % 2) * 0.12, 1.05 + (k % 3) * 0.15),
        new THREE.MeshStandardMaterial({ color: greens[k % 3], side: THREE.DoubleSide, roughness: 0.8 }),
      );
      leaf.castShadow = true;
      const holder = new THREE.Group();
      holder.rotation.y = (k / fronds) * Math.PI * 2 + (k % 2) * 0.15;
      holder.rotation.z = 0.12 - (k % 3) * 0.05;
      holder.add(leaf);
      crown.add(holder);
    }
    // a few young fronds standing up in the middle
    for (let k = 0; k < 4; k++) {
      const leaf = new THREE.Mesh(this.frondGeometry(0.8, 0.12, 0.65, 0.25, 10), new THREE.MeshStandardMaterial({ color: 0x6cc26a, side: THREE.DoubleSide }));
      const holder = new THREE.Group();
      holder.rotation.y = (k / 4) * Math.PI * 2 + 0.4;
      holder.rotation.z = 0.6;
      holder.add(leaf);
      crown.add(holder);
    }
    for (let k = 0; k < 4; k++) {
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.7 }));
      nut.position.set(Math.cos(k * 1.6) * 0.1, -0.1 - (k % 2) * 0.04, Math.sin(k * 1.6) * 0.1);
      crown.add(nut);
    }
    g.add(crown);
    this.sways.push({ o: crown, ph: x + z, amp: 0.05 });
    parent.add(g);
    return g;
  }

  /** A weeping willow: a broad soft canopy with long curtains of hanging leaves. */
  willow(parent: THREE.Object3D, x: number, z: number, s = 1) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const bark = new THREE.MeshStandardMaterial({ color: 0x6b4a36, roughness: 0.95 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * s, 0.2 * s, 1.6 * s, 9), bark);
    trunk.position.y = 0.8 * s;
    trunk.castShadow = true;
    g.add(trunk);
    // a few limbs fanning out from the top of the trunk
    for (let k = 0; k < 3; k++) {
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * s, 0.08 * s, 0.75 * s, 6), bark);
      const a = (k / 3) * Math.PI * 2 + 0.5;
      limb.position.set(Math.cos(a) * 0.2 * s, 1.75 * s, Math.sin(a) * 0.2 * s);
      limb.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
      g.add(limb);
    }
    const crown = new THREE.Group();
    crown.position.y = 2.0 * s;
    const leafA = new THREE.MeshStandardMaterial({ color: 0x86cf5e, emissive: 0x2f7a22, emissiveIntensity: 0.45, roughness: 0.85 });
    const leafB = new THREE.MeshStandardMaterial({ color: 0x6fbd4f, emissive: 0x2a6a1e, emissiveIntensity: 0.45, roughness: 0.85 });
    const leafC = new THREE.MeshStandardMaterial({ color: 0xa3df78, emissive: 0x3a8a2a, emissiveIntensity: 0.45, roughness: 0.85, side: THREE.DoubleSide });
    const strandA = leafA.clone(), strandB = leafB.clone();
    strandA.side = strandB.side = THREE.DoubleSide;
    // the soft dome of the canopy: overlapping rounded clumps
    const clumps: [number, number, number, number][] = [[0, 0.15, 0, 0.62], [0.42, 0, 0.1, 0.48], [-0.4, 0.02, -0.12, 0.5], [0.1, 0.02, 0.45, 0.46], [-0.08, 0, -0.45, 0.46], [0, 0.42, 0, 0.42]];
    clumps.forEach(([cx, cy, cz, r], i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r * s, 14, 10), i % 2 ? leafB : leafA);
      m.scale.y = 0.62;
      m.position.set(cx * s, cy * s, cz * s);
      m.castShadow = true;
      crown.add(m);
    });
    // long hanging curtains of leaves round the rim, in two rings
    const strands = 46;
    for (let k = 0; k < strands; k++) {
      const outer = k % 2 === 0;
      const a = (k / strands) * Math.PI * 2 + (outer ? 0 : 0.07);
      const r = (outer ? 0.82 : 0.62) * s;
      const len = (outer ? 1.25 : 0.95) * s * (0.85 + ((k * 37) % 10) / 30);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.14 * s, len, 1, 4), k % 3 === 0 ? leafC : outer ? strandA : strandB);
      // taper the strand to a point at the bottom
      const pa = strip.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const yy = pa.getY(i);
        const t = (len / 2 - yy) / len;
        pa.setX(i, pa.getX(i) * (1 - t * 0.75));
        pa.setZ(i, Math.sin(t * Math.PI) * 0.05 * s);
      }
      strip.geometry.computeVertexNormals();
      strip.position.set(Math.cos(a) * r, -len / 2 + 0.05 * s, Math.sin(a) * r);
      strip.rotation.y = -a + Math.PI / 2;
      strip.rotation.x = 0.06;
      strip.castShadow = true;
      crown.add(strip);
    }
    g.add(crown);
    this.sways.push({ o: crown, ph: x * 2 + z, amp: 0.03 });
    parent.add(g);
    return g;
  }

  /** A park bench, facing +z before rotation. */
  bench(parent: THREE.Object3D, x: number, z: number, rotY = 0, color = 0x8b5e3c) {
    const b = new THREE.Group();
    b.position.set(x, 0, z);
    b.rotation.y = rotY;
    for (let i = 0; i < 3; i++) {
      const slat = this.box(1.3, 0.05, 0.1, color);
      slat.position.set(0, 0.42, -0.12 + i * 0.12);
      b.add(slat);
    }
    for (let i = 0; i < 2; i++) {
      const back = this.box(1.3, 0.08, 0.04, color);
      back.position.set(0, 0.62 + i * 0.14, -0.2);
      b.add(back);
    }
    for (const sx of [-0.55, 0.55]) {
      const leg = this.box(0.06, 0.42, 0.36, 0x2c2238);
      leg.position.set(sx, 0.21, 0);
      const arm = this.box(0.06, 0.5, 0.06, 0x2c2238);
      arm.position.set(sx, 0.6, -0.2);
      b.add(leg, arm);
    }
    parent.add(b);
    return b;
  }

  /** A little duck that bobs on the water. */
  duck(parent: THREE.Object3D, x: number, z: number, rotY = 0) {
    const d = new THREE.Group();
    d.position.set(x, 0.06, z);
    d.rotation.y = rotY;
    const white = new THREE.MeshStandardMaterial({ color: 0xfff8ea, flatShading: true });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), white);
    body.scale.set(1, 0.75, 1.4);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), white);
    head.position.set(0, 0.11, 0.11);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 6), new THREE.MeshStandardMaterial({ color: 0xffa630 }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.1, 0.19);
    d.add(body, head, beak);
    parent.add(d);
    this.bobbers.push({ o: d, ph: x * 3 + z, y: 0.06 });
  }

  /** A fluttering butterfly hovering over the flowers. */
  butterfly(parent: THREE.Object3D, x: number, y: number, z: number, color = 0xffb3d9) {
    const b = new THREE.Group();
    b.position.set(x, y, z);
    const wingGeo = new THREE.CircleGeometry(0.07, 8);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
      w.position.x = s * 0.06;
      w.rotation.set(-Math.PI / 2, s * 0.5, 0);
      b.add(w);
    }
    parent.add(b);
    this.bobbers.push({ o: b, ph: x * 5 + z * 3, y });
    this.sways.push({ o: b, ph: x + z * 7, amp: 0.5 });
  }

  /** A giant die with its pips. */
  die(parent: THREE.Object3D, x: number, y: number, z: number, size: number, rot: [number, number, number], color = 0xf3e9dc, pipC = 0x2b2440) {
    const d = new THREE.Group();
    d.position.set(x, y, z);
    d.rotation.set(...rot);
    const cube = this.box(size, size, size, color);
    d.add(cube);
    const pip = new THREE.SphereGeometry(size * 0.085, 8, 6);
    const pm = new THREE.MeshStandardMaterial({ color: pipC });
    const h = size / 2 + 0.001, q = size * 0.25;
    const faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3, number][] = [
      [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), 1],
      [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), 2],
      [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 3],
      [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 4],
      [new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), 5],
      [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), 6],
    ];
    const layouts: Record<number, [number, number][]> = {
      1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
      5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
    };
    for (const [n, u, v, k] of faces)
      for (const [a, b] of layouts[k]) {
        const m = new THREE.Mesh(pip, pm);
        m.position.copy(n.clone().multiplyScalar(h)).addScaledVector(u, a * q).addScaledVector(v, b * q);
        // flatten each pip against its face
        m.scale.set(1, 1, 1).multiply(new THREE.Vector3(1, 1, 1).sub(n.clone().multiply(n).multiplyScalar(0.7)));
        d.add(m);
      }
    parent.add(d);
    return d;
  }

  isle_cafe(g: THREE.Object3D) {
    const z = -2.5; // café front wall at z + 1
    const cream = 0xf6e7d2, terracotta = 0xc8604f, wood = 0x8a5a44, dark = 0x3a2a33;

    // wooden deck for the terrace
    for (let i = 0; i < 9; i++) {
      const plank = this.box(7.8, 0.05, 0.34, i % 2 ? 0xb98a63 : 0xa97b57, { roughness: 0.95 });
      plank.position.set(0, 0.025, -0.05 + i * 0.36);
      g.add(plank);
    }
    for (const x of [-3.95, 3.95]) {
      const edge = this.box(0.1, 0.09, 3.3, 0x7a5236);
      edge.position.set(x, 0.045, 1.4);
      g.add(edge);
    }

    this.cottage(g, z, { wall: cream, roof: terracotta, ridge: 0x9e4639, awning: ["#fff3e6", "#e0576b"], name: "Coffee Cove", frame: wood });

    // a sleepy orange cat on the step
    const catMat = new THREE.MeshStandardMaterial({ color: 0xf0a04b, flatShading: true });
    const catBody = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), catMat);
    catBody.scale.set(1.35, 0.6, 0.9);
    catBody.position.set(0.32, 0.17, z + 1.22);
    const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), catMat);
    catHead.position.set(0.12, 0.17, z + 1.3);
    g.add(catBody, catHead);
    for (const e of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 4), catMat);
      ear.position.set(0.12 + e * 0.045, 0.27, z + 1.3);
      g.add(ear);
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 12, Math.PI), catMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0.48, 0.1, z + 1.28);
    g.add(tail);

    // a bike leaning on the side wall
    const bike = new THREE.Group();
    const tyre = new THREE.MeshStandardMaterial({ color: 0x2a2433 });
    for (const bx of [-0.33, 0.33]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 18), tyre);
      w.position.set(bx, 0.24, 0);
      bike.add(w);
    }
    const frame = this.box(0.62, 0.035, 0.035, 0x3fb7a6);
    frame.position.set(0, 0.42, 0);
    const down = this.box(0.42, 0.035, 0.035, 0x3fb7a6);
    down.position.set(-0.05, 0.33, 0);
    down.rotation.z = 0.7;
    const seat = this.box(0.14, 0.04, 0.07, 0x3a2a33);
    seat.position.set(-0.17, 0.52, 0);
    const bar = this.box(0.04, 0.04, 0.26, 0x3a2a33);
    bar.position.set(0.25, 0.56, 0);
    const basket = this.box(0.18, 0.12, 0.2, 0xc8a46a);
    basket.position.set(0.36, 0.52, 0);
    bike.add(frame, down, seat, bar, basket);
    bike.position.set(-1.78, 0, z + 0.2);
    bike.rotation.set(0, Math.PI / 2, 0.08);
    g.add(bike);

    // coffee cart under a little striped canopy
    const cx = 3.05, cz = -0.9;
    const cart = this.box(1.1, 0.75, 0.55, 0x6aa79a);
    cart.position.set(cx, 0.48, cz);
    const counter = this.box(1.2, 0.06, 0.62, wood);
    counter.position.set(cx, 0.88, cz);
    g.add(cart, counter);
    for (const wx of [-0.38, 0.38]) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 14), new THREE.MeshStandardMaterial({ color: dark }));
      wh.rotation.x = Math.PI / 2;
      wh.position.set(cx + wx, 0.13, cz + 0.3);
      g.add(wh);
    }
    for (const px of [-0.52, 0.52]) {
      const pole = this.box(0.04, 0.9, 0.04, dark);
      pole.position.set(cx + px, 1.35, cz - 0.22);
      g.add(pole);
    }
    const canopy = this.awning(["#fff3e6", "#2a9d8f"], 1.35, 0.8);
    canopy.position.set(cx, 1.82, cz + 0.05);
    canopy.rotation.x = -1.1;
    g.add(canopy);
    const machine = this.box(0.34, 0.3, 0.26, 0xd9dde3, { metalness: 0.7, roughness: 0.25 });
    machine.position.set(cx - 0.25, 1.06, cz - 0.08);
    const machineTop = this.box(0.36, 0.04, 0.28, 0x9aa1ab, { metalness: 0.7, roughness: 0.3 });
    machineTop.position.set(cx - 0.25, 1.23, cz - 0.08);
    g.add(machine, machineTop);
    this.puff(g, cx - 0.33, 1.26, cz - 0.08, { h: 0.55, s: 0.05, sp: 0.5, op: 0.4 });
    for (let k = 0; k < 4; k++) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.08, 10), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xfff1e0 : 0xf5c9b3 }));
      cup.position.set(cx + 0.12 + (k % 2) * 0.11, 0.95 + Math.floor(k / 2) * 0.08, cz + 0.05);
      g.add(cup);
    }
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0x6b3f2a }));
    jar.position.set(cx + 0.42, 0.99, cz - 0.1);
    g.add(jar);

    // chalkboard menu by the deck
    const menu = this.signBoard(
      [
        { t: "Today", font: "italic 600 26px Georgia, serif", color: "#ffd9a8", y: 0.2 },
        { t: "flat white", font: "500 17px sans-serif", color: "#ffffff", y: 0.45 },
        { t: "cardamom latte", font: "500 17px sans-serif", color: "#ffffff", y: 0.62 },
        { t: "date cake ♥", font: "500 17px sans-serif", color: "#ffb3cf", y: 0.8 },
      ],
      0.62, 0.8, "#2b2f33", "#7a4a3a",
    );
    menu.position.set(-3.35, 0.62, -0.75);
    menu.rotation.set(-0.18, 0.55, 0);
    g.add(menu);
    for (const lx of [-0.27, 0.27]) {
      const leg = this.box(0.04, 1.0, 0.04, 0x7a4a3a);
      leg.position.set(-3.35 + lx * Math.cos(0.55), 0.48, -0.75 - lx * Math.sin(0.55));
      leg.rotation.x = -0.18;
      g.add(leg);
    }

    // greenery: bushes by the walls, planters at the front of the deck
    this.bush(g, -1.75, z + 1.15, 0.28, 0xff7aa8);
    this.bush(g, 1.75, z + 1.15, 0.28, 0xffd166);
    this.bush(g, -1.95, z - 0.6, 0.3);
    for (const [px, col] of [[-1.35, 0xff7aa8], [1.35, 0xc58cff], [-4.1, 0xffd166], [4.1, 0xff9f6b]] as [number, number][]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.3, 10), new THREE.MeshStandardMaterial({ color: terracotta, flatShading: true }));
      pot.position.set(px, 0.2, 3.25);
      g.add(pot);
      const plant = new THREE.Group();
      plant.position.set(px, 0.35, 3.25);
      g.add(plant);
      this.bush(plant, 0, 0, 0.22, col);
    }

    // string lights: across the terrace and from the eaves to the poles
    this.terraceLights(g, 2.6);
    this.stringLights(new THREE.Vector3(-1.5, 1.98, z + 1.2), new THREE.Vector3(-4.1, 1.88, 2.6), 0.25, 9, g);
    this.stringLights(new THREE.Vector3(1.5, 1.98, z + 1.2), new THREE.Vector3(4.1, 1.88, 2.6), 0.25, 9, g);

    // tables, each with a little vase and steaming cups
    const spots = [this.tableFor2(g, -2.7, 1.3), this.tableFor2(g, 0, 1.8), this.tableFor2(g, 2.7, 1.3)];
    for (const sp of spots) {
      const f = sp.focus;
      const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0x9ad1d4 }));
      vase.position.set(f.x, 0.71, f.z - 0.12);
      const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff7aa8, emissive: 0xff7aa8, emissiveIntensity: 0.25 }));
      bloom.position.set(f.x, 0.8, f.z - 0.12);
      g.add(vase, bloom);
      for (const sx of [-1, 1]) this.puff(g, f.x + sx * 0.14, 0.76, f.z + 0.05 * sx, { h: 0.35, s: 0.035, sp: 0.42 + sx * 0.05, op: 0.35, n: 2 });
    }
    return spots;
  }

  isle_games(g: THREE.Object3D) {
    const z = -2.5;
    this.cottage(g, z, { wall: 0x2f7f84, roof: 0x5b4b8a, awning: ["#f3e9dc", "#2a9d8f"], name: "Dice Isle", signColor: "#2b2440", signBg: "#ffe9a8", font: "800 46px Manrope, sans-serif", frame: 0x2b2440 });
    // giant dice tumbling by the door
    this.die(g, -2.25, 0.35, -1.35, 0.7, [0, 0.5, 0], 0xfff4e2);
    this.die(g, -1.95, 0.95, -1.5, 0.5, [0.35, 1.1, 0.3], 0xff8fb8, 0xffffff);
    // a giant chess corner: checker patch with a king and pawns
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x2 = c.getContext("2d")!;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      x2.fillStyle = (i + j) % 2 ? "#f3e9dc" : "#4a3a6a";
      x2.fillRect(i * 16, j * 16, 16, 16);
    }
    const ct = new THREE.CanvasTexture(c);
    ct.colorSpace = THREE.SRGBColorSpace;
    ct.magFilter = THREE.NearestFilter;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshStandardMaterial({ map: ct }));
    board.rotation.x = -Math.PI / 2;
    board.position.set(3.25, 0.02, -1.4);
    board.receiveShadow = true;
    g.add(board);
    const piece = (px: number, pz: number, color: number, king: boolean) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.12, 14), m);
      base.position.set(px, 0.06, pz);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, king ? 0.75 : 0.42, 14), m);
      body.position.set(px, king ? 0.48 : 0.33, pz);
      const head = new THREE.Mesh(new THREE.SphereGeometry(king ? 0.15 : 0.13, 12, 10), m);
      head.position.set(px, king ? 0.95 : 0.62, pz);
      g.add(base, body, head);
      [base, body, head].forEach((x) => (x.castShadow = true));
      if (king) {
        const cv = this.box(0.05, 0.22, 0.05, color);
        cv.position.set(px, 1.18, pz);
        const ch = this.box(0.16, 0.05, 0.05, color);
        ch.position.set(px, 1.2, pz);
        g.add(cv, ch);
      }
    };
    piece(2.85, -1.75, 0xf3e9dc, true);
    piece(3.55, -1.0, 0x4a3a6a, false);
    piece(3.6, -1.75, 0xf3e9dc, false);
    // a stacking-block tower
    const cols = [0xff8fb8, 0xffd166, 0x7ec8ff, 0x7be0a8, 0xc58cff];
    for (let l = 0; l < 9; l++)
      for (let k = 0; k < 3; k++) {
        if (l > 2 && (l * 3 + k) % 7 === 0) continue;
        const b = this.box(l % 2 ? 0.16 : 0.5, 0.1, l % 2 ? 0.5 : 0.16, cols[(l + k) % 5]);
        b.position.set(-3.45 + (l % 2 ? (k - 1) * 0.17 : 0), 0.05 + l * 0.1, -1.0 + (l % 2 ? 0 : (k - 1) * 0.17));
        g.add(b);
      }
    // planters and a big cheerful meeple
    const mm = new THREE.MeshStandardMaterial({ color: 0xff7a59, flatShading: true });
    const mBody = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 0.6, 8), mm);
    mBody.position.set(1.95, 0.3, -1.25);
    const mHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mm);
    mHead.position.set(1.95, 0.72, -1.25);
    const mArms = this.box(0.7, 0.14, 0.16, 0xff7a59);
    mArms.position.set(1.95, 0.45, -1.25);
    g.add(mBody, mHead, mArms);
    this.bush(g, -1.75, z + 1.15, 0.26, 0xffd166);
    this.bush(g, 1.75, z + 1.15, 0.26, 0xff7aa8);
    // terrace: lights, bunting and a tiled floor
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 3; j++) {
        const t = this.box(0.92, 0.04, 0.92, (i + j) % 2 ? 0xd8cfe6 : 0xbfb3d6, { roughness: 0.9 });
        t.position.set(-3.22 + i * 0.92, 0.02, 0.45 + j * 0.92);
        g.add(t);
      }
    this.terraceLights(g, 2.6);
    this.bunting(new THREE.Vector3(-1.5, 1.98, z + 1.25), new THREE.Vector3(-4.1, 1.85, 2.6), 0.3, 10, g);
    this.bunting(new THREE.Vector3(1.5, 1.98, z + 1.25), new THREE.Vector3(4.1, 1.85, 2.6), 0.3, 10, g);
    const o = { game: true, top: 0x8b5e3c, chair: 0x2a9d8f };
    const spots = [this.tableFor2(g, -2.7, 1.3, o), this.tableFor2(g, 0, 1.8, o), this.tableFor2(g, 2.7, 1.3, o)];
    for (const sp of spots) this.puff(g, sp.focus.x + 0.24, 0.74, sp.focus.z - 0.18, { h: 0.3, s: 0.03, sp: 0.4, op: 0.3, n: 2 });
    return spots;
  }

  /** Coloured book spines for shop windows and shelves. */
  spineTexture(seed: number, bg = "#3b2a22") {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d")!;
    const r = seeded(seed);
    x.fillStyle = bg;
    x.fillRect(0, 0, 128, 128);
    const hues = [8, 28, 45, 160, 200, 260, 330];
    for (let row = 0; row < 3; row++) {
      let px = 4;
      const y0 = 6 + row * 42;
      while (px < 124) {
        const w = 5 + Math.floor(r() * 8), h = 26 + Math.floor(r() * 10);
        x.fillStyle = `hsl(${hues[Math.floor(r() * hues.length)]} ${55 + r() * 30}% ${45 + r() * 25}%)`;
        x.fillRect(px, y0 + (36 - h), w, h);
        x.fillStyle = "rgba(255,255,255,.35)";
        x.fillRect(px + 1, y0 + (36 - h) + 4, w - 2, 2);
        px += w + 1;
      }
      x.fillStyle = "#6b4a32";
      x.fillRect(0, y0 + 36, 128, 4);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  isle_bookshop(g: THREE.Object3D) {
    const z = -2.5;
    const spines = this.spineTexture(7, "#fff1d6");
    this.cottage(g, z, { wall: 0x5f7f8f, roof: 0x2f3b5a, awning: ["#f3ead8", "#2f3b5a"], name: "The Little Bookshop", signColor: "#2f3b5a", signBg: "#f7ecd6", font: "italic 600 38px Georgia, serif", windowTex: spines, frame: 0x2f3b5a });
    // a second storey of books: an upstairs reading room
    const up = this.box(1.6, 0.9, 1.5, 0x6d8d9c);
    up.position.set(0.55, 3.0, z - 0.1);
    const upRoof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0x2f3b5a, flatShading: true }));
    upRoof.rotation.y = Math.PI / 4;
    upRoof.position.set(0.55, 3.8, z - 0.1);
    const upWin = this.box(0.6, 0.45, 0.04, 0);
    upWin.material = this.windowMat();
    upWin.position.set(0.55, 3.02, z + 0.66);
    g.add(up, upRoof, upWin);
    // outdoor book trolleys and stacks
    const trolley = (x: number, zz: number, rot: number, seed: number) => {
      const t = new THREE.Group();
      t.position.set(x, 0, zz);
      t.rotation.y = rot;
      const frame = this.box(1.0, 0.9, 0.36, 0x7a4a3a);
      frame.position.y = 0.6;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.8), new THREE.MeshStandardMaterial({ map: this.spineTexture(seed), roughness: 0.9 }));
      face.position.set(0, 0.6, 0.185);
      const roofT = this.box(1.1, 0.06, 0.46, 0x2f3b5a);
      roofT.position.y = 1.08;
      t.add(frame, face, roofT);
      for (const wx of [-0.38, 0.38]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0x2a2433 }));
        wh.rotation.x = Math.PI / 2;
        wh.position.set(wx, 0.1, 0.2);
        t.add(wh);
      }
      g.add(t);
    };
    trolley(-2.35, -1.1, 0.35, 11);
    trolley(2.35, -1.1, -0.35, 12);
    const bookCols = [0xe76f51, 0xf4a261, 0x2a9d8f, 0xe9c46a, 0x9d4edd, 0x5b8def];
    for (const [sx, sz, n] of [[-3.7, -0.5, 7], [3.75, -0.4, 6], [1.6, -1.7, 4]] as [number, number, number][])
      for (let k = 0; k < n; k++) {
        const bk = this.box(0.42 - (k % 3) * 0.04, 0.09, 0.3, bookCols[(k + n) % 6]);
        bk.position.set(sx, 0.045 + k * 0.09, sz);
        bk.rotation.y = Math.sin(k * 1.7) * 0.3;
        g.add(bk);
      }
    // a reading lamp post with a little hanging sign
    this.lamp(g, -1.45, -1.1, 0xffc27a, 1.5);
    const hang = this.signBoard([{ t: "Open · read a while", font: "500 22px sans-serif", color: "#2f3b5a", y: 0.52 }], 0.7, 0.2, "#f7ecd6", "#2f3b5a");
    hang.position.set(-1.45, 1.15, -1.06);
    g.add(hang);
    // paper birds circling overhead
    for (let k = 0; k < 6; k++) {
      const bird = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 0.4, flatShading: true }));
      bird.rotation.set(Math.PI / 2, 0, k);
      bird.position.set(-2.5 + k * 1.0, 2.6 + (k % 3) * 0.35, -0.4 + (k % 2) * 0.8);
      g.add(bird);
      this.bobbers.push({ o: bird, ph: k * 1.3, y: bird.position.y });
      this.sways.push({ o: bird, ph: k, amp: 0.3 });
    }
    // cobbled square
    for (let i = 0; i < 60; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 6), new THREE.MeshStandardMaterial({ color: i % 3 ? 0xb9ae9f : 0xa59a8c, flatShading: true }));
      st.position.set(-3.8 + (i % 15) * 0.54 + ((Math.floor(i / 15) % 2) * 0.27), 0.015, 0.1 + Math.floor(i / 15) * 0.5 - 0.6);
      g.add(st);
    }
    this.bush(g, -1.75, z + 1.15, 0.26, 0xffffff);
    this.bush(g, 1.75, z + 1.15, 0.26, 0xc58cff);
    this.stringLights(new THREE.Vector3(-1.5, 1.98, z + 1.2), new THREE.Vector3(-3.9, 1.6, 0.4), 0.2, 8, g);
    this.stringLights(new THREE.Vector3(1.5, 1.98, z + 1.2), new THREE.Vector3(3.9, 1.6, 0.4), 0.2, 8, g);
    for (const x of [-3.9, 3.9]) {
      const p = this.box(0.06, 1.6, 0.06, 0x3a2c3f);
      p.position.set(x, 0.8, 0.4);
      g.add(p);
    }
    // the date spots: two book benches and a tea table
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
        const bk = this.box(0.28, 0.07, 0.2, bookCols[(k + Math.abs(Math.round(x))) % 6]);
        bk.position.set(x + 1.15, 0.035 + k * 0.07, zz - 0.1);
        bk.rotation.y = k * 0.25;
        g.add(bk);
      }
      return { seats: [new THREE.Vector3(x - 0.6, 0, zz), new THREE.Vector3(x + 0.6, 0, zz)] as [THREE.Vector3, THREE.Vector3], focus: new THREE.Vector3(x, 0, zz) };
    };
    const tea = this.tableFor2(g, 0, 1.8, { top: 0xe9c46a, chair: 0x9d4edd });
    this.puff(g, 0.14, 0.76, 1.85, { h: 0.35, s: 0.035, sp: 0.42, op: 0.35, n: 2 });
    this.puff(g, -0.14, 0.76, 1.75, { h: 0.35, s: 0.035, sp: 0.47, op: 0.35, n: 2 });
    return [bench(-2.8, 1.2), tea, bench(2.8, 1.2, 0x6b4a3d)];
  }

  isle_garden(g: THREE.Object3D) {
    // a flowering arch over a little gate
    const vine = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.1, 8, 32, Math.PI), new THREE.MeshStandardMaterial({ color: 0x4f9156, flatShading: true }));
    vine.position.set(0, 0.2, -2.6);
    vine.castShadow = true;
    g.add(vine);
    const flowerCols = [0xff8fb1, 0xffd166, 0xffffff, 0xc77dff, 0xff6b6b];
    for (let i = 0; i < 40; i++) {
      const a = (i / 39) * Math.PI;
      const f = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rand(0.08, 0.15), 0),
        new THREE.MeshStandardMaterial({ color: flowerCols[i % 5], emissive: flowerCols[i % 5], emissiveIntensity: 0.4, flatShading: true }),
      );
      f.position.set(Math.cos(a) * rand(1.15, 1.35), 0.2 + Math.sin(a) * rand(1.15, 1.35), -2.6 + rand(-0.15, 0.15));
      g.add(f);
    }
    // white picket fences either side of the arch
    for (const side of [-1, 1]) {
      for (let k = 0; k < 7; k++) {
        const pk = this.box(0.08, 0.6, 0.04, 0xfaf4ea);
        pk.position.set(side * (1.55 + k * 0.28), 0.3, -2.6);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 4), new THREE.MeshStandardMaterial({ color: 0xfaf4ea }));
        tip.position.set(side * (1.55 + k * 0.28), 0.65, -2.6);
        g.add(pk, tip);
      }
      const rail = this.box(1.95, 0.05, 0.04, 0xfaf4ea);
      rail.position.set(side * 2.4, 0.42, -2.62);
      g.add(rail);
    }
    // a lily pond with a stone rim and two ducks
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1.0, 28), new THREE.MeshStandardMaterial({ color: 0x4a78b8, roughness: 0.08, metalness: 0.35 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(-3.1, 0.03, -1.4);
    g.add(pond);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.12, 0.18), 0), new THREE.MeshStandardMaterial({ color: 0xa8a29a, flatShading: true }));
      rk.position.set(-3.1 + Math.cos(a) * 1.05, 0.06, -1.4 + Math.sin(a) * 1.05);
      g.add(rk);
    }
    for (const [lx, lz] of [[-3.5, -1.6], [-2.8, -1.0], [-3.0, -1.9]]) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.015, 10, 1, false, 0.4, Math.PI * 1.8), new THREE.MeshStandardMaterial({ color: 0x5fa35a }));
      pad.position.set(lx, 0.045, lz);
      g.add(pad);
    }
    const lily = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffc2da, emissive: 0xff8fb1, emissiveIntensity: 0.3 }));
    lily.position.set(-3.5, 0.08, -1.6);
    g.add(lily);
    this.duck(g, -3.3, -1.2, 0.8);
    this.duck(g, -2.75, -1.65, 2.6);
    // flower beds
    const bed = (bx: number, bz: number, w: number, d: number) => {
      const soil = this.box(w, 0.14, d, 0x6b4a3a);
      soil.position.set(bx, 0.07, bz);
      g.add(soil);
      for (let i = 0; i < Math.round(w * 5); i++)
        for (let j = 0; j < Math.round(d * 4); j++) {
          const fx = bx - w / 2 + 0.12 + (i / (w * 5)) * (w - 0.1), fz = bz - d / 2 + 0.12 + (j / (d * 4)) * (d - 0.1);
          const stem = this.box(0.025, 0.26, 0.025, 0x3f7d4c);
          stem.position.set(fx, 0.27, fz);
          const c = flowerCols[(i + j * 2) % 5];
          const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.2, flatShading: true }));
          bloom.position.set(fx, 0.42, fz);
          g.add(stem, bloom);
        }
    };
    bed(3.2, -1.5, 1.4, 0.8);
    bed(2.4, -3.2, 1.6, 0.6);
    // scattered wildflowers between the blankets
    for (let i = 0; i < 40; i++) {
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: flowerCols[i % 5], flatShading: true }));
      f.position.set(rand(-4.6, 4.6), 0.08, rand(-0.6, 3.6));
      if (Math.abs(f.position.x) % 2.8 < 1.2 && f.position.z > 0.3 && f.position.z < 2.7) continue;
      g.add(f);
    }
    // butterflies
    [[-1.2, 1.1, -1.6, 0xffb3d9], [1.3, 1.3, -1.9, 0xfff1a8], [3.0, 0.9, -1.2, 0xa8e6ff], [-0.4, 1.5, 0.2, 0xc58cff], [2.1, 1.2, 0.0, 0xffd6a8]].forEach(([bx, by, bz, c]) => this.butterfly(g, bx, by, bz, c));
    // lantern poles with fairy lights at the back
    for (const x of [-4.3, 4.3]) {
      const p = this.box(0.06, 1.8, 0.06, 0xfaf4ea);
      p.position.set(x, 0.9, -0.2);
      g.add(p);
    }
    this.stringLights(new THREE.Vector3(-4.3, 1.75, -0.2), new THREE.Vector3(-1.25, 1.4, -2.6), 0.2, 8, g);
    this.stringLights(new THREE.Vector3(4.3, 1.75, -0.2), new THREE.Vector3(1.25, 1.4, -2.6), 0.2, 8, g);
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
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.015, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0x8b5e3c }));
      handle.position.set(x, 0.25, z - 0.25);
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.015, 14), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      plate.position.set(x, 0.045, z + 0.12);
      g.add(b, basket, handle, plate);
      for (let k = 0; k < 4; k++) {
        const berry = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xe63946 : 0x9bd36a }));
        berry.position.set(x - 0.05 + (k % 2) * 0.08, 0.075, z + 0.08 + Math.floor(k / 2) * 0.07);
        g.add(berry);
      }
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0xffb3c6, roughness: 0.2, metalness: 0.1 }));
      bottle.position.set(x + 0.2, 0.14, z - 0.2);
      g.add(bottle);
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
    // the park gate with its name
    const gz = ISLE_R - 2.0;
    for (const x of [-0.85, 0.85]) {
      const post = this.box(0.16, 1.9, 0.16, 0x5a3b2e);
      post.position.set(x, 0.95, gz);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.2, 4), new THREE.MeshStandardMaterial({ color: 0x3f7d4c, flatShading: true }));
      cap.position.set(x, 2.0, gz);
      cap.rotation.y = Math.PI / 4;
      g.add(post, cap);
      this.paperLantern(g, x, 1.55, gz + 0.12, 0xffc27a, 0.1);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 6, 20, Math.PI), new THREE.MeshStandardMaterial({ color: 0x5a3b2e }));
    arch.position.set(0, 1.85, gz);
    g.add(arch);
    const sign = this.signBoard([{ t: "Willow Park", font: "italic 600 46px Georgia, serif", color: "#fff4e2", y: 0.55 }], 1.2, 0.3, "#3f6b4a", "#5a3b2e");
    sign.position.set(0, 2.3, gz + 0.05);
    g.add(sign);
    // two gravel loops round weeping willows
    const loops: [number, number][] = [[-2.5, 0.6], [2.5, 0.6]];
    const gravel = new THREE.MeshStandardMaterial({ color: 0xd9c7a8, roughness: 1 });
    for (const [cx, cz] of loops) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.62, 2.18, 48), gravel);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cx, 0.02, cz);
      ring.receiveShadow = true;
      g.add(ring);
      for (const rr of [1.6, 2.2]) {
        const edge = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.03, 4, 48), new THREE.MeshStandardMaterial({ color: 0xa8957a }));
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(cx, 0.03, cz);
        g.add(edge);
      }
      this.willow(g, cx, cz, 1.1);
      // flowers round the willow's foot
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const c = [0xff8fb1, 0xffd166, 0xffffff, 0xc77dff][k % 4];
        const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.2, flatShading: true }));
        f.position.set(cx + Math.cos(a) * 0.95, 0.09, cz + Math.sin(a) * 0.95);
        g.add(f);
      }
    }
    // benches outside the loops, lamps between them
    this.bench(g, -4.65, 0.6, Math.PI / 2);
    this.bench(g, 4.65, 0.6, -Math.PI / 2);
    this.lamp(g, 0, 1.6, 0xffc27a, 1.3);
    this.lamp(g, 0, -0.5, 0xffc27a, 1.3);
    // the duck pond
    const pond = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), new THREE.MeshStandardMaterial({ color: 0x4a78b8, roughness: 0.08, metalness: 0.35 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(0, 0.03, -1.9);
    g.add(pond);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.1, 0.15), 0), new THREE.MeshStandardMaterial({ color: 0xa8a29a, flatShading: true }));
      rk.position.set(Math.cos(a) * 0.9, 0.05, -1.9 + Math.sin(a) * 0.9);
      g.add(rk);
    }
    this.duck(g, -0.25, -1.75, 1.2);
    this.duck(g, 0.3, -2.1, 3.6);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.015, 10, 1, false, 0.4, Math.PI * 1.8), new THREE.MeshStandardMaterial({ color: 0x5fa35a }));
    pad.position.set(0.35, 0.045, -1.6);
    g.add(pad);
    // a kite caught in the breeze and some bushes
    this.bush(g, -1.0, -3.2, 0.34, 0xffd166);
    this.bush(g, 1.1, -3.3, 0.3, 0xff8fb1);
    this.bush(g, -4.2, -1.6, 0.32);
    this.bush(g, 4.2, -1.6, 0.32, 0xffffff);
    [[-1.0, 1.2, -1.0, 0xffb3d9], [1.1, 1.0, -0.8, 0xfff1a8], [0.2, 1.4, 2.4, 0xa8e6ff]].forEach(([bx, by, bz, c]) => this.butterfly(g, bx, by, bz, c));
    return loops.map(([cx, cz]) => {
      const route = this.loopRoute(cx, cz, 1.9);
      return { seats: [route[0].clone().add(new THREE.Vector3(0, 0, 0.3)), route[0].clone().add(new THREE.Vector3(0, 0, -0.3))] as [THREE.Vector3, THREE.Vector3], focus: new THREE.Vector3(cx, 0, cz), route };
    });
  }

  stall(g: THREE.Object3D, x: number, z: number, cols: [string, string], kind: "kitchen" | "spice" | "sweets", name?: string) {
    const s = new THREE.Group();
    s.position.set(x, 0, z);
    const counter = this.box(1.2, 0.75, 0.55, 0x8b5e3c);
    counter.position.set(0, 0.375, 0.3);
    const top = this.box(1.3, 0.05, 0.62, 0xd9b48a);
    top.position.set(0, 0.77, 0.3);
    const skirt = this.awning([cols[1], cols[0]], 1.2, 0.3);
    skirt.position.set(0, 0.55, 0.585);
    s.add(counter, top, skirt);
    for (const px of [-0.55, 0.55])
      for (const pz of [0.05, 0.55]) {
        const post = this.box(0.05, 1.6, 0.05, 0x3a2c3f);
        post.position.set(px, 0.8, pz);
        s.add(post);
      }
    const aw = this.awning(cols, 1.4, 0.9);
    aw.rotation.x = -Math.PI / 2 + 0.25;
    aw.position.set(0, 1.62, 0.35);
    s.add(aw);
    // scalloped valance along the front edge
    for (let k = 0; k < 7; k++) {
      const sc = new THREE.Mesh(new THREE.CircleGeometry(0.1, 10, 0, Math.PI), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xffffff : new THREE.Color(cols[1]).getHex(), side: THREE.DoubleSide }));
      sc.rotation.z = Math.PI;
      sc.position.set(-0.6 + k * 0.2, 1.52, 0.8);
      s.add(sc);
    }
    if (name) {
      const sign = this.signBoard([{ t: name, font: "700 30px Manrope, sans-serif", color: "#3a2c3f", y: 0.55 }], 0.9, 0.22, "#fff4e2", "#3a2c3f");
      sign.position.set(0, 1.78, 0.82);
      s.add(sign);
    }
    if (kind === "kitchen") {
      const stove = this.box(0.4, 0.08, 0.3, 0x222233);
      stove.position.set(-0.15, 0.83, 0.3);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.16, 14), new THREE.MeshStandardMaterial({ color: 0xb8b8c8, metalness: 0.6, roughness: 0.3 }));
      pot.position.set(-0.15, 0.95, 0.3);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a1a, emissiveIntensity: 3 }));
      flame.position.set(-0.15, 0.86, 0.3);
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.04, 14), new THREE.MeshStandardMaterial({ color: 0x2a2433 }));
      pan.position.set(0.3, 0.82, 0.3);
      s.add(stove, pot, flame, pan);
      for (let k = 0; k < 3; k++) {
        const veg = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: [0xe63946, 0x9bd36a, 0xffd166][k] }));
        veg.position.set(0.26 + (k - 1) * 0.06, 0.86, 0.3);
        s.add(veg);
      }
      this.puff(s, -0.15, 1.05, 0.3, { h: 0.5, s: 0.05, sp: 0.45, op: 0.4 });
      // pans hanging from the frame
      for (let k = 0; k < 3; k++) {
        const hp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 12), new THREE.MeshStandardMaterial({ color: 0x8a8f9a, metalness: 0.6, roughness: 0.3 }));
        hp.rotation.x = Math.PI / 2;
        hp.position.set(-0.3 + k * 0.3, 1.3, 0.06);
        s.add(hp);
      }
    } else {
      const cols2 = kind === "spice" ? [0xd62828, 0xf77f00, 0xfcbf49, 0x8c5a3c] : [0xff8fb8, 0xffd166, 0xc77dff, 0x7ec8ff];
      cols2.forEach((cc, i) => {
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0xf3e9dc }));
        bowl.position.set(-0.42 + i * 0.28, 0.83, 0.32);
        const heap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: cc, emissive: cc, emissiveIntensity: 0.25 }));
        heap.position.set(-0.42 + i * 0.28, 0.86, 0.32);
        s.add(bowl, heap);
      });
    }
    this.stringLights(new THREE.Vector3(-0.6, 1.55, 0.6), new THREE.Vector3(0.6, 1.55, 0.6), 0.12, 5, s);
    g.add(s);
    return s;
  }

  crate(g: THREE.Object3D, x: number, z: number, fill: number, rot = 0) {
    const c = this.box(0.42, 0.3, 0.32, 0xb08350);
    c.position.set(x, 0.15, z);
    c.rotation.y = rot;
    g.add(c);
    for (let k = 0; k < 6; k++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: fill, flatShading: true }));
      f.position.set(x - 0.12 + (k % 3) * 0.12, 0.33, z - 0.06 + Math.floor(k / 3) * 0.12);
      g.add(f);
    }
  }

  isle_cooking(g: THREE.Object3D) {
    // an open-air cooking school: a pavilion with a big counter at the back
    const pz = -2.9;
    const deck = this.box(4.2, 0.12, 2.0, 0xa97b57);
    deck.position.set(0, 0.06, pz);
    g.add(deck);
    for (const px of [-1.95, 1.95])
      for (const dz of [-0.85, 0.85]) {
        const post = this.box(0.12, 2.1, 0.12, 0x5a3b2e);
        post.position.set(px, 1.12, pz + dz);
        g.add(post);
      }
    const roof = this.box(4.6, 0.12, 2.5, 0xc8604f);
    roof.position.set(0, 2.3, pz);
    roof.rotation.x = -0.12;
    const fascia = this.box(4.6, 0.22, 0.06, 0xfff3e6);
    fascia.position.set(0, 2.15, pz + 1.2);
    g.add(roof, fascia);
    const sign = this.signBoard([{ t: "Kitchen Quay · cooking class tonight", font: "700 24px Manrope, sans-serif", color: "#fff4e2", y: 0.55 }], 2.2, 0.3, "#2a6f73", "#5a3b2e");
    sign.position.set(0, 2.15, pz + 1.24);
    g.add(sign);
    const island = this.box(2.6, 0.85, 0.7, 0xf3e9dc);
    island.position.set(0, 0.55, pz + 0.1);
    const islandTop = this.box(2.75, 0.06, 0.82, 0x8b5e3c);
    islandTop.position.set(0, 1.0, pz + 0.1);
    g.add(island, islandTop);
    const board = this.box(0.5, 0.03, 0.32, 0xd9b48a);
    board.position.set(-0.6, 1.05, pz + 0.1);
    g.add(board);
    for (let k = 0; k < 5; k++) {
      const v = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: [0xe63946, 0x9bd36a, 0xffd166, 0xf77f00, 0x7b2cbf][k] }));
      v.position.set(-0.75 + k * 0.07, 1.1, pz + 0.12);
      g.add(v);
    }
    for (const hx of [0.2, 0.75]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.22, 16), new THREE.MeshStandardMaterial({ color: 0xb8b8c8, metalness: 0.6, roughness: 0.3 }));
      pot.position.set(hx, 1.14, pz + 0.1);
      g.add(pot);
      this.puff(g, hx, 1.28, pz + 0.1, { h: 0.6, s: 0.06, sp: 0.4, op: 0.4 });
    }
    // hanging pans and herb pots
    const rail = this.box(3.4, 0.04, 0.04, 0x3a2c3f);
    rail.position.set(0, 1.9, pz - 0.6);
    g.add(rail);
    for (let k = 0; k < 6; k++) {
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.12 - (k % 2) * 0.03, 0.12 - (k % 2) * 0.03, 0.025, 14), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xc0703a : 0x6b6f7a, metalness: 0.6, roughness: 0.35 }));
      pan.rotation.x = Math.PI / 2;
      pan.position.set(-1.4 + k * 0.56, 1.7, pz - 0.6);
      g.add(pan);
    }
    for (let k = 0; k < 4; k++) {
      const hp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0xc8604f }));
      hp.position.set(1.05 + (k % 2) * 0.16, 1.09, pz - 0.05 + Math.floor(k / 2) * 0.18);
      const herb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), new THREE.MeshStandardMaterial({ color: 0x4f9156, flatShading: true }));
      herb.position.set(1.05 + (k % 2) * 0.16, 1.2, pz - 0.05 + Math.floor(k / 2) * 0.18);
      g.add(hp, herb);
    }
    this.stringLights(new THREE.Vector3(-1.95, 2.05, pz + 0.85), new THREE.Vector3(1.95, 2.05, pz + 0.85), 0.15, 10, g);
    // the two cooking stations where dates happen
    this.stall(g, -2.4, -0.6, ["#fff3e6", "#e0576b"], "kitchen", "Station 1");
    this.stall(g, 2.4, -0.6, ["#fff3e6", "#f4a261"], "kitchen", "Station 2");
    // produce crates, barrels and a quayside rope fence at the back
    this.crate(g, -3.9, -1.9, 0xe63946, 0.3);
    this.crate(g, -3.5, -2.5, 0x9bd36a, -0.2);
    this.crate(g, 3.9, -1.9, 0xffd166, -0.3);
    this.crate(g, 3.6, -2.5, 0xf77f00, 0.2);
    for (const [bx, bz] of [[-4.3, -1.2], [4.3, -1.2]]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.55, 12), new THREE.MeshStandardMaterial({ color: 0x8b5e3c, flatShading: true }));
      barrel.position.set(bx, 0.28, bz);
      g.add(barrel);
      for (const hy of [0.12, 0.44]) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.015, 4, 16), new THREE.MeshStandardMaterial({ color: 0x3a2c3f }));
        hoop.rotation.x = Math.PI / 2;
        hoop.position.set(bx, hy, bz);
        g.add(hoop);
      }
    }
    // bunting from the pavilion out to poles at the sides, well behind the cooking stations
    for (const x of [-4.0, 4.0]) {
      const p = this.box(0.06, 2.1, 0.06, 0x3a2c3f);
      p.position.set(x, 1.05, -1.9);
      g.add(p);
      this.bunting(new THREE.Vector3(Math.sign(x) * 1.95, 2.1, pz + 0.85), new THREE.Vector3(x, 2.05, -1.9), 0.25, 9, g, [0xe0576b, 0xfff3e6, 0x2a9d8f, 0xffd166]);
    }
    this.bush(g, -1.0, 2.9, 0.26, 0xffd166);
    this.bush(g, 1.0, 2.9, 0.26, 0xff7aa8);
    return [this.standAt(-2.4, 0.75, 0.45), this.standAt(2.4, 0.75, 0.45)];
  }

  isle_streetfood(g: THREE.Object3D) {
    // a red market gate at the back
    const gz = -2.9;
    const red = 0xc0392b;
    for (const x of [-1.3, 1.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.4, 10), new THREE.MeshStandardMaterial({ color: red }));
      post.position.set(x, 1.2, gz);
      post.castShadow = true;
      const foot = this.box(0.32, 0.18, 0.32, 0x2a1f2e);
      foot.position.set(x, 0.09, gz);
      g.add(post, foot);
    }
    const beam1 = this.box(3.4, 0.16, 0.24, red);
    beam1.position.set(0, 2.45, gz);
    const beam2 = this.box(3.0, 0.1, 0.2, 0x2a1f2e);
    beam2.position.set(0, 2.15, gz);
    const cap = this.box(3.7, 0.08, 0.36, 0x2a1f2e);
    cap.position.set(0, 2.57, gz);
    g.add(beam1, beam2, cap);
    const sign = this.signBoard([{ t: "Lantern Market", font: "700 34px Manrope, sans-serif", color: "#ffd166", y: 0.55 }], 1.3, 0.3, "#2a1f2e", "#c0392b");
    sign.position.set(0, 2.3, gz + 0.14);
    g.add(sign);
    for (let k = 0; k < 5; k++) this.paperLantern(g, -1.0 + k * 0.5, 2.1, gz + 0.05, k % 2 ? 0xffb347 : 0xff5a4e, 0.12);
    // the stalls
    this.stall(g, -3.2, -0.9, ["#fff3e6", "#d62828"], "spice", "Spices");
    this.stall(g, -1.8, -1.2, ["#fff3e6", "#f77f00"], "kitchen", "Dumplings");
    this.stall(g, 1.8, -1.2, ["#fff3e6", "#c77dff"], "sweets", "Sweets");
    this.stall(g, 3.2, -0.9, ["#fff3e6", "#ff8fb8"], "sweets", "Mochi");
    // rows of paper lanterns over the lanes
    for (const x of [-4.2, 4.2]) {
      const p = this.box(0.07, 2.9, 0.07, 0x2a1f2e);
      p.position.set(x, 1.45, 1.6);
      g.add(p);
    }
    const rope = this.box(8.4, 0.02, 0.02, 0x2a1f2e);
    rope.position.set(0, 2.85, 1.6);
    g.add(rope);
    const lc = [0xff5a4e, 0xffb347, 0xffd166, 0xff7aa8];
    for (let k = 0; k < 13; k++) this.paperLantern(g, -3.9 + k * 0.65, 2.84 - Math.sin((k / 12) * Math.PI) * 0.15, 1.6, lc[k % 4], 0.11);
    // a shared table with stools between the stalls
    const tbl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 18), new THREE.MeshStandardMaterial({ color: 0x8b5e3c }));
    tbl.position.set(0, 0.62, -1.0);
    const tleg = this.box(0.08, 0.6, 0.08, 0x2a1f2e);
    tleg.position.set(0, 0.3, -1.0);
    g.add(tbl, tleg);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.38, 10), new THREE.MeshStandardMaterial({ color: red }));
      st.position.set(Math.cos(a) * 0.72, 0.19, -1.0 + Math.sin(a) * 0.72);
      g.add(st);
    }
    for (let k = 0; k < 3; k++) {
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      bowl.position.set(-0.2 + k * 0.2, 0.73, -1.0 + (k % 2) * 0.12);
      g.add(bowl);
    }
    this.puff(g, 0, 0.72, -1.0, { h: 0.4, s: 0.04, sp: 0.4, op: 0.35 });
    this.crate(g, -4.1, -1.8, 0xf77f00, 0.3);
    this.crate(g, 4.1, -1.8, 0xe63946, -0.3);
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
    // a pale stone courtyard
    const floor = this.box(9.0, 0.04, 4.6, 0xe9e1d6, { roughness: 0.6 });
    floor.position.set(0, 0.02, 0.2);
    g.add(floor);
    for (let i = 1; i < 9; i++) {
      const seam = this.box(0.02, 0.045, 4.6, 0xcfc4b6);
      seam.position.set(-4.5 + i, 0.022, 0.2);
      g.add(seam);
    }
    // a white pavilion with a sculpture inside
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.0, 0.18, 24), new THREE.MeshStandardMaterial({ color: 0xf2ece3, roughness: 0.7 }));
    base.position.set(0, 0.09, z);
    base.receiveShadow = true;
    g.add(base);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.1, 12), new THREE.MeshStandardMaterial({ color: 0xfbf8f2 }));
      pillar.position.set(Math.cos(a) * 1.7, 1.2, z + Math.sin(a) * 1.7);
      pillar.castShadow = true;
      g.add(pillar);
    }
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.22, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xfbf8f2, side: THREE.DoubleSide }));
    ring.position.set(0, 2.3, z);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.08, 24), new THREE.MeshStandardMaterial({ color: 0x5b4b8a }));
    disc.position.set(0, 2.43, z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7a6aaa, flatShading: true }));
    dome.scale.y = 0.45;
    dome.position.set(0, 2.47, z);
    g.add(ring, disc, dome);
    const banner = this.signBoard([{ t: "Gallery Isle", font: "italic 600 40px Georgia, serif", color: "#5b4b8a", y: 0.55 }], 1.3, 0.22, "#fbf8f2", "#fbf8f2");
    banner.position.set(0, 2.3, z + 2.02);
    g.add(banner);
    const plinth = this.box(0.5, 0.7, 0.5, 0xfbf8f2);
    plinth.position.set(0, 0.53, z);
    const sculpt = new THREE.Mesh(new THREE.TorusKnotGeometry(0.32, 0.1, 64, 8), new THREE.MeshStandardMaterial({ color: 0xffd6a8, emissive: 0xff9f6b, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.3 }));
    sculpt.position.set(0, 1.35, z);
    g.add(plinth, sculpt);
    this.sways.push({ o: sculpt, ph: 0, amp: 0.2 });
    // outdoor sculptures on plinths
    const plinthAt = (px: number, pz: number) => {
      const p = this.box(0.45, 0.6, 0.45, 0xfbf8f2);
      p.position.set(px, 0.32, pz);
      g.add(p);
    };
    plinthAt(-1.45, -0.6);
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.Mesh(new THREE.SphereGeometry(0.17 - k * 0.04, 14, 10), new THREE.MeshStandardMaterial({ color: [0xff8fb8, 0x7ec8ff, 0xffd166][k], roughness: 0.3 }));
      sp.position.set(-1.45, 0.78 + k * 0.27, -0.6);
      g.add(sp);
    }
    plinthAt(1.45, -0.6);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 10, 24), new THREE.MeshStandardMaterial({ color: 0x7be0a8, metalness: 0.5, roughness: 0.25 }));
    hoop.position.set(1.45, 0.95, -0.6);
    hoop.rotation.y = 0.6;
    g.add(hoop);
    this.sways.push({ o: hoop, ph: 2, amp: 0.15 });
    // topiary trees
    for (const [tx, tz] of [[-4.0, -1.5], [4.0, -1.5], [-3.6, -3.0], [3.6, -3.0]]) {
      const pot = this.box(0.4, 0.35, 0.4, 0xfbf8f2);
      pot.position.set(tx, 0.18, tz);
      const stem = this.box(0.05, 0.6, 0.05, 0x5a3b2e);
      stem.position.set(tx, 0.6, tz);
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), new THREE.MeshStandardMaterial({ color: 0x4f9156, flatShading: true }));
      ball.position.set(tx, 1.05, tz);
      g.add(pot, stem, ball);
    }
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
      const panel = this.box(1.6, 1.75, 0.14, 0xfbf8f2);
      panel.position.set(x, 1.02, zz);
      const foot = this.box(1.7, 0.12, 0.36, 0xd9d0c4);
      foot.position.set(x, 0.06, zz);
      const frame = this.box(1.02, 0.82, 0.05, 0xc9a227, { metalness: 0.5, roughness: 0.35 });
      frame.position.set(x, 1.2, zz + 0.09);
      const tex = art(seed);
      const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveIntensity: 0.2, emissiveMap: tex }));
      canvas.position.set(x, 1.2, zz + 0.12);
      const plaque = this.box(0.26, 0.1, 0.02, 0xc9a227);
      plaque.position.set(x + 0.55, 0.62, zz + 0.09);
      // a spotlight on an arm above the painting
      const arm = this.box(0.04, 0.04, 0.32, 0x2c2238);
      arm.position.set(x, 1.95, zz + 0.2);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c2238, side: THREE.DoubleSide }));
      head.position.set(x, 1.9, zz + 0.36);
      head.rotation.x = 2.5;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff4e0, emissive: 0xfff0c8, emissiveIntensity: 2.5 }));
      bulb.position.set(x, 1.87, zz + 0.38);
      g.add(panel, foot, frame, canvas, plaque, arm, head, bulb);
      return this.standAt(x, zz + 0.9);
    };
    return [wall(-2.8, 0.3, 3), wall(0, 0.8, 4), wall(2.8, 0.3, 5)];
  }

  isle_sunset(g: THREE.Object3D) {
    // a sandy beach over most of the island
    const sand = new THREE.Mesh(new THREE.CircleGeometry(ISLE_R - 0.35, 40), new THREE.MeshStandardMaterial({ color: 0xedd3a3, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, 0.012, -0.9);
    sand.receiveShadow = true;
    g.add(sand);
    // a striped beach hut with surfboards
    const hz = -2.7;
    const stripes = document.createElement("canvas");
    stripes.width = 64;
    stripes.height = 8;
    const sx2 = stripes.getContext("2d")!;
    for (let i = 0; i < 8; i++) {
      sx2.fillStyle = i % 2 ? "#fff6e8" : "#5bb3d6";
      sx2.fillRect(i * 8, 0, 8, 8);
    }
    const stTex = new THREE.CanvasTexture(stripes);
    stTex.colorSpace = THREE.SRGBColorSpace;
    const hut = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 1.4), new THREE.MeshStandardMaterial({ map: stTex }));
    hut.position.set(0, 0.75, hz);
    hut.castShadow = true;
    const hutBase = this.box(2.2, 0.12, 1.9, 0xa97b57);
    hutBase.position.set(0, 0.06, hz + 0.15);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.45, 0.8, 4), new THREE.MeshStandardMaterial({ color: 0xc0705a, flatShading: true }));
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 1.8, hz);
    const hutDoor = this.box(0.5, 0.85, 0.04, 0xfff6e8);
    hutDoor.position.set(0, 0.55, hz + 0.72);
    const hutWin = this.box(0.35, 0.3, 0.04, 0);
    hutWin.material = this.windowMat();
    hutWin.position.set(0.6, 0.9, hz + 0.72);
    g.add(hut, hutBase, roof, hutDoor, hutWin);
    const sign = this.signBoard([{ t: "Sunset Pier", font: "italic 600 40px Georgia, serif", color: "#fff6e8", y: 0.55 }], 1.1, 0.26, "#c0705a", "#8a4a3a");
    sign.position.set(0, 1.35, hz + 0.74);
    g.add(sign);
    for (const [bx, bc, rot] of [[-1.1, 0xff7a59, 0.15], [-1.35, 0xffd166, -0.1], [1.15, 0x7ec8ff, -0.15]] as [number, number, number][]) {
      const board = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), new THREE.MeshStandardMaterial({ color: bc, roughness: 0.4 }));
      board.scale.set(0.32, 1.25, 0.06);
      board.position.set(bx, 0.62, hz + 0.85);
      board.rotation.z = rot;
      g.add(board);
    }
    // palms
    this.palm(g, -3.9, -2.2, 2.6, 0.3);
    this.palm(g, 3.9, -2.4, 2.3, 0.35);
    this.palm(g, -4.3, 0.9, 2.1, 0.4);
    // striped umbrellas and deck chairs
    const umbrella = (ux: number, uz: number, c1: string) => {
      const cv = document.createElement("canvas");
      cv.width = 64;
      cv.height = 8;
      const cx2 = cv.getContext("2d")!;
      for (let i = 0; i < 8; i++) {
        cx2.fillStyle = i % 2 ? "#fff6e8" : c1;
        cx2.fillRect(i * 8, 0, 8, 8);
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      const pole = this.box(0.05, 1.6, 0.05, 0xf3e9dc);
      pole.position.set(ux, 0.8, uz);
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.38, 16, 1, true), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, flatShading: true }));
      top.position.set(ux, 1.62, uz);
      g.add(pole, top);
      const chair = new THREE.Group();
      chair.position.set(ux + 0.55, 0, uz + 0.55);
      chair.rotation.y = -0.4;
      const seat = this.box(0.5, 0.04, 0.9, 0x2a9d8f);
      seat.position.set(0, 0.28, 0);
      seat.rotation.x = -0.35;
      const frameL = this.box(0.04, 0.3, 0.04, 0xa97b57);
      frameL.position.set(-0.24, 0.15, 0.3);
      const frameR = frameL.clone();
      frameR.position.x = 0.24;
      chair.add(seat, frameL, frameR);
      g.add(chair);
    };
    umbrella(-3.2, -0.6, "#ff7a59");
    umbrella(3.2, -0.6, "#5bb3d6");
    // a crackling bonfire ringed by stones and log seats
    for (let k = 0; k < 4; k++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8), new THREE.MeshStandardMaterial({ color: 0x5a3b2e }));
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (k / 4) * Math.PI;
      log.position.set(0, 0.07, 0.2);
      g.add(log);
    }
    for (const [fh, fr, fc] of [[0.55, 0.2, 0xff7a1a], [0.38, 0.13, 0xffc04a]] as [number, number, number][]) {
      const fire = new THREE.Mesh(new THREE.ConeGeometry(fr, fh, 7), new THREE.MeshStandardMaterial({ color: fc, emissive: fc, emissiveIntensity: 3 }));
      fire.position.set(0, 0.12 + fh / 2, 0.2);
      g.add(fire);
      this.sways.push({ o: fire, ph: fh * 10, amp: 0.12 });
    }
    this.puff(g, 0, 0.6, 0.2, { h: 1.0, s: 0.03, sp: 0.6, op: 0.9, color: 0xffb04a, n: 5, drift: 0.15 });
    this.puff(g, 0, 0.9, 0.2, { h: 1.4, s: 0.1, sp: 0.2, op: 0.25, color: 0xd8d0e0, n: 3, drift: 0.3 });
    for (let k = 0; k < 8; k++) {
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1, 0), new THREE.MeshStandardMaterial({ color: 0x8a8590, flatShading: true }));
      const a = (k / 8) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.42, 0.06, 0.2 + Math.sin(a) * 0.42);
      g.add(st);
    }
    for (const a of [0.6, 2.5]) {
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 10), new THREE.MeshStandardMaterial({ color: 0x8b5e3c, flatShading: true }));
      seat.rotation.z = Math.PI / 2;
      seat.rotation.y = a + Math.PI / 2;
      seat.position.set(Math.cos(a) * 1.0, 0.12, 0.2 - Math.sin(a) * 1.0);
      g.add(seat);
    }
    // shells and starfish in the sand
    for (let k = 0; k < 10; k++) {
      const sh = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.06, 5), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xffd6c9 : 0xfff6e8, flatShading: true }));
      sh.position.set(rand(-4.2, 4.2), 0.03, rand(-1.6, 2.6));
      if (Math.abs(sh.position.x) > 1.0 && Math.abs(sh.position.x) < 2.6 && sh.position.z > 2.2) continue;
      sh.rotation.x = Math.PI / 2;
      g.add(sh);
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.9, flatShading: true });
    const pier = (x: number) => {
      const z0 = ISLE_R - 2.9;
      for (let i = 0; i < 13; i++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.24), wood);
        plank.position.set(x + (i % 2) * 0.03, 0.03, z0 + i * 0.27);
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
        this.paperLantern(g, x + s, 0.95, z0 + 3.2, 0xffb347, 0.1);
        const lp = this.box(0.05, 0.95, 0.05, 0x5b3c2a);
        lp.position.set(x + s, 0.48, z0 + 3.2);
        g.add(lp);
      }
      return this.standAt(x, z0 + 2.9, 0.36);
    };
    return [pier(-1.8), pier(1.8)];
  }

  isle_stars(g: THREE.Object3D) {
    const mound = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x35594f, flatShading: true }));
    mound.scale.y = 0.35;
    mound.position.set(0, 0, -2.6);
    mound.receiveShadow = true;
    g.add(mound);
    // stone steps up the hill
    for (let k = 0; k < 5; k++) {
      const st = this.box(0.9, 0.1, 0.3, 0xb9b2c4);
      st.position.set(0, 0.05 + k * 0.12, -0.7 - k * 0.28);
      g.add(st);
    }
    // the observatory: stone tower, glowing windows, open dome and a telescope peeking out
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 1.5, 18), new THREE.MeshStandardMaterial({ color: 0xe9e1d6, flatShading: true }));
    tower.position.set(0, 1.5, -2.7);
    tower.castShadow = true;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.12, 18), new THREE.MeshStandardMaterial({ color: 0x5b4b8a }));
    band.position.set(0, 2.25, -2.7);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9aa6c4, metalness: 0.55, roughness: 0.35 }));
    dome.position.set(0, 2.3, -2.7);
    const slit = this.box(0.32, 1.0, 0.2, 0x0e0a22, { emissive: 0x4a5cff, emissiveIntensity: 0.9 });
    slit.position.set(0, 2.72, -1.95);
    slit.rotation.x = -0.6;
    const scopeBig = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 1.2, 14), new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.7, roughness: 0.3 }));
    scopeBig.position.set(0, 3.05, -1.85);
    scopeBig.rotation.x = 0.85;
    const door = this.box(0.5, 0.9, 0.06, 0x3a2c3f);
    door.position.set(0, 1.2, -1.72);
    const doorLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd27a, emissiveIntensity: 2.5 }));
    doorLight.position.set(0, 1.78, -1.68);
    g.add(tower, band, dome, slit, scopeBig, door, doorLight);
    for (const a of [-0.9, 0.9]) {
      const w = new THREE.Mesh(new THREE.CircleGeometry(0.14, 14), this.windowMat());
      w.position.set(Math.sin(a) * 1.0, 1.75, -2.7 + Math.cos(a) * 1.0);
      w.rotation.y = a;
      g.add(w);
    }
    const sign = this.signBoard([{ t: "Star Hill Observatory", font: "italic 600 30px Georgia, serif", color: "#ffe9a8", y: 0.55 }], 1.2, 0.22, "#1d1b3a", "#5b4b8a");
    sign.position.set(0, 2.0, -1.66);
    g.add(sign);
    // a constellation floating above the hill, with faint lines between its stars
    const pts = [[-2.2, 4.2, -2.0], [-1.2, 4.6, -2.4], [-0.3, 4.3, -2.1], [0.7, 4.8, -2.5], [1.6, 4.4, -2.2], [2.3, 4.9, -2.6], [0.4, 5.3, -2.8]].map(([a, b, c]) => new THREE.Vector3(a, b, c));
    const lineGeo = new THREE.BufferGeometry().setFromPoints([...pts.slice(0, 6), pts[3], pts[6]]);
    g.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xa8b8ff, transparent: true, opacity: 0.45 })));
    pts.forEach((p, k) => {
      const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.09 + (k % 3) * 0.03, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 3 }));
      st.position.copy(p);
      g.add(st);
      this.sways.push({ o: st, ph: k * 1.3, amp: 0.6 });
    });
    // star lanterns on posts around the edge
    for (const [lx, lz] of [[-4.2, -0.6], [4.2, -0.6], [-3.6, -2.6], [3.6, -2.6]]) {
      const post = this.box(0.05, 1.2, 0.05, 0x2c2238);
      post.position.set(lx, 0.6, lz);
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd27a, emissiveIntensity: 2.4 }));
      star.position.set(lx, 1.3, lz);
      g.add(post, star);
      this.sways.push({ o: star, ph: lx, amp: 0.4 });
    }
    // a little planet model and a bench
    const planet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf4a261, roughness: 0.5 }));
    planet.position.set(-1.6, 1.05, -1.2);
    const pring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 6, 28), new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd27a, emissiveIntensity: 0.4 }));
    pring.position.set(-1.6, 1.05, -1.2);
    pring.rotation.x = 1.2;
    const pstand = this.box(0.05, 0.8, 0.05, 0x2c2238);
    pstand.position.set(-1.6, 0.42, -1.2);
    g.add(planet, pring, pstand);
    this.sways.push({ o: pring, ph: 1, amp: 0.2 });
    this.bench(g, 1.7, -1.3, -0.3, 0x5b4b8a);
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
      const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0x2c2238 }));
      eye.position.set(0, 0.86, 0.32);
      eye.rotation.x = -0.9;
      s.add(tube, eye);
      g.add(s);
      return this.standAt(x, z + 0.2);
    };
    const blanketSpot = (x: number, z: number) => {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), new THREE.MeshStandardMaterial({ color: 0x3b3170 }));
      b.rotation.x = -Math.PI / 2;
      b.position.set(x, 0.03, z);
      g.add(b);
      for (const [cx, cc] of [[-0.6, 0xff8fb8], [0.6, 0x7ec8ff]] as [number, number][]) {
        const cushion = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ color: cc, roughness: 0.9 }));
        cushion.scale.set(1.1, 0.45, 0.8);
        cushion.position.set(x + cx, 0.1, z - 0.32);
        g.add(cushion);
      }
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffc27a, emissiveIntensity: 2.2 }));
      lantern.position.set(x + 0.95, 0.12, z + 0.3);
      const thermos = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.24, 10), new THREE.MeshStandardMaterial({ color: 0x2a9d8f, metalness: 0.4, roughness: 0.4 }));
      thermos.position.set(x - 0.95, 0.14, z + 0.3);
      g.add(lantern, thermos);
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
    const n = this.low ? 120 : 260,
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
        gl_FragColor = vec4(vec3(1.,.95,.7)*1.6, smoothstep(.5,0.,d)*(.12+vA*.38)); }`,
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
    const n = 140;
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
        new THREE.MeshStandardMaterial({ color: 0xe0a9bf, flatShading: true }),
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
    // fluffy pastel cumulus: clusters of soft round puffs, drifting slowly round the world
    const rnd = seeded(5);
    const mats = [0xffffff, 0xffe9f2, 0xfbd9e8, 0xf3e3fb].map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: 0xffe0ee, emissiveIntensity: 0.4, roughness: 1 }));
    const geo = new THREE.SphereGeometry(1, 14, 10);
    const n = this.low ? 18 : 30;
    for (let i = 0; i < n; i++) {
      const cl = new THREE.Group();
      const puffs = 5 + Math.floor(rnd() * 5);
      const len = 6 + rnd() * 10;
      for (let k = 0; k < puffs; k++) {
        const t = k / (puffs - 1);
        const r = (1.6 + Math.sin(t * Math.PI) * 2.6) * (0.8 + rnd() * 0.4);
        const m = new THREE.Mesh(geo, mats[k % mats.length]);
        m.scale.set(r, r * 0.8, r);
        m.position.set((t - 0.5) * len * 2, r * 0.35 + rnd() * 0.8, (rnd() - 0.5) * 3);
        cl.add(m);
      }
      // a flat soft base so the cloud doesn't look like separate balls
      const base = new THREE.Mesh(geo, mats[3]);
      base.scale.set(len * 1.15, 1.2, 2.6);
      cl.add(base);
      const near = i < n * 0.45;
      const a = rnd() * Math.PI * 2, r = near ? 48 + rnd() * 40 : 110 + rnd() * 140;
      const y = near ? -11 + rnd() * 7 : -9 + rnd() * 26;
      cl.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      cl.lookAt(0, y, 0);
      cl.scale.setScalar(near ? 0.6 + rnd() * 0.5 : 1.6 + rnd() * 1.8);
      this.bake(cl); // one mesh per cloud
      this.scene.add(cl);
      this.floaters.push({ o: cl, ph: 0, r, a, y, sp: 0.0015 + rnd() * 0.003 });
    }
    // light haze sprites to soften the horizon
    const tex = glowTexture("rgba(255,240,248,0.9)", "rgba(255,240,248,0)");
    for (let i = 0; i < (this.low ? 6 : 10); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.3 }));
      const a = Math.random() * Math.PI * 2, r = rand(160, 280);
      s.position.set(Math.cos(a) * r, rand(-6, 8), Math.sin(a) * r);
      const w = rand(50, 110);
      s.scale.set(w, w * 0.3, 1);
      this.scene.add(s);
      this.floaters.push({ o: s, ph: 0, r, a, y: s.position.y, sp: rand(0.002, 0.004) });
    }
    // little pink hearts floating up between the islands
    const heartShape = new THREE.Shape();
    heartShape.moveTo(0, -0.5);
    heartShape.bezierCurveTo(-0.9, 0.1, -0.5, 0.75, 0, 0.35);
    heartShape.bezierCurveTo(0.5, 0.75, 0.9, 0.1, 0, -0.5);
    const hGeo = new THREE.ExtrudeGeometry(heartShape, { depth: 0.18, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
    hGeo.center();

    // all the hearts (each with its little string) are one instanced batch: a single draw call
    const str = new THREE.CylinderGeometry(0.012, 0.012, 1.4, 3);
    str.translate(0, -1.15, 0);
    const heartGeo = mergeGeometries([hGeo.toNonIndexed(), str.toNonIndexed()].map((g) => { for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k); return g; }));
    const count = this.low ? 30 : 64;
    const inst = new THREE.InstancedMesh(heartGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff9ec4, emissiveIntensity: 0.3, roughness: 0.4 }), count);
    const cols = [0xff9ec4, 0xffc2d8, 0xffb3cf].map((c) => new THREE.Color(c));
    this.hearts = [];
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2, r = 9 + rnd() * 46;
      this.hearts.push({ x: Math.cos(a) * r, y: -5 + rnd() * 11, z: Math.sin(a) * r, s: 0.45 + rnd() * 0.5, ph: rnd() * 10, ry: rnd() * Math.PI });
      inst.setColorAt(i, cols[i % 3]);
    }
    inst.frustumCulled = false;
    this.heartMesh = inst;
    this.scene.add(inst);
  }
  hearts: { x: number; y: number; z: number; s: number; ph: number; ry: number }[] = [];
  heartMesh: THREE.InstancedMesh | null = null;

  /** Show what one side of a date is saying, in a speech bubble over their head (replaces the last one). */
  bubbles = new Map<string, { sp: THREE.Sprite; until: number }>();
  say(coupleId: string, side: "a" | "b", text: string) {
    const c = this.couples.get(coupleId);
    if (!c || !text) return;
    const old = this.bubbles.get(coupleId);
    if (old) {
      old.sp.parent?.remove(old.sp);
      old.sp.material.map?.dispose();
      old.sp.material.dispose();
    }
    const w = side === "a" ? c.a : c.b;
    const sp = bubbleSprite(text);
    sp.position.y = 2.25;
    w.group.add(sp);
    this.bubbles.set(coupleId, { sp, until: this.uniforms.uTime.value + 7 });
  }

  /* ---------------------------- public API ---------------------------- */
  setMode(mode: WorldMode) {
    this.mode = mode;
    this.controls.enabled = mode === "home";
    if (mode === "home" || mode === "calm" || mode === "landing") this.view = { kind: "overview" };
    this.refocus();
    this.bloom.strength = mode === "date" ? 0.36 : 0.32;
  }

  /** Re-aim the camera at whatever we are looking at (also after a resize). */
  setInsets(i: { bottom?: number; left?: number }) {
    const b = Math.max(0, Math.round(i.bottom ?? 0)), l = Math.max(0, Math.round(i.left ?? 0));
    if (b === this.insets.bottom && l === this.insets.left) return;
    this.insets = { bottom: b, left: l };
    this.applyView();
    this.refocus();
  }
  applyView() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const { bottom: b, left: l } = this.insets;
    const base = 38;
    if (b || l) {
      // a taller/wider virtual frame, rendered so its centre lands in the visible area
      this.camera.fov = (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base / 2)) * ((h + b) / h)) * 180) / Math.PI;
      this.camera.aspect = (w + l) / (h + b);
      this.camera.setViewOffset(w + l, h + b, 0, b, w, h);
    } else {
      this.camera.fov = base;
      this.camera.aspect = w / h;
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }
  refocus() {
    const small = innerWidth < 800;
    const sm = small && !this.insets.bottom; // phones without a measured sheet: push the subject up by hand
    const v = this.view;
    this.controls.autoRotate = v.kind === "overview" && (this.mode === "home" || this.mode === "calm") && this.motion === 1;
    if (v.kind === "island") {
      const isle = this.isles.get(v.id)!;
      const look = isle.pos.clone().addScaledVector(isle.front, 1.6);
      look.y = sm ? -2.5 : 0;
      if (!small) look.addScaledVector(isle.side, 3 * v.offset);
      this.camGoal.look.copy(look);
      this.camGoal.pos.copy(look).addScaledVector(isle.front, small ? 23 : 15.5).add(new THREE.Vector3(0, small ? 19 : 11.5, 0));
      this.setFocusCenter(isle.pos);
    } else if (v.kind === "spot") {
      const isle = this.isles.get(v.id)!;
      const s = isle.spots[v.spot] ?? isle.spots[0];
      const look = (s.route ? s.center : s.focus).clone();
      look.y = sm ? -1.6 : 0.9;
      if (!small) look.addScaledVector(isle.side, 1.6 * v.offset);
      this.camGoal.look.copy(look);
      this.camGoal.pos
        .copy(look)
        .addScaledVector(isle.front, small ? 10 : (s.route ? 8.5 : 7.2) + Math.max(0, v.offset - 1) * 2.3)
        .add(new THREE.Vector3(0, small ? 7.5 : 3.6, 0))
        .addScaledVector(isle.side, 1.1);
      this.setFocusCenter(isle.pos);
    } else {
      const k = small ? 0 : Math.min(1, Math.max(0, (innerWidth - 900) / 900));
      if (this.mode === "landing") {
        this.camGoal.pos.set(small ? 18 : 6, small ? 34 : 24, small ? 70 : 62);
        this.camGoal.look.set(small ? 0 : -24, small ? 2 : 2, small ? 0 : 2);
      } else if (this.mode === "calm") {
        this.camGoal.pos.set(small ? 0 : -8, small ? 90 : 70, small ? 120 : 96);
        this.camGoal.look.set(small ? 0 : 20 + 6 * (1 - k), -6, small ? 0 : 4);
      } else {
        // back off until the whole ring of islands fits the visible part of the screen
        const vw = this.host.clientWidth - this.insets.left, vh = Math.max(200, this.host.clientHeight - this.insets.bottom);
        // (the view keeps the full-screen pixel scale, so both checks use the full height)
        const H = this.host.clientHeight;
        const dist = Math.max(113, (102 * H) / vw, (62 * H) / vh);
        this.camGoal.pos.set(0, 66, 92).normalize().multiplyScalar(dist);
        this.camGoal.look.set(0, sm ? -12 : -6, small ? 0 : 2);
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
    const self = list.find((a) => a.self);
    if (this.twin && (!self || this.twin.info.id !== self.id + ":twin" || this.twin.info.face !== self.face)) {
      this.scene.remove(this.twin.group);
      this.twin.dispose();
      this.twin = null;
    }
    if (self && !this.twin) {
      const tw = new Wisp({ ...self, id: self.id + ":twin", self: false, holo: true }, this.glow, this.islandR);
      tw.setSize(1.5);
      tw.pose = "stand";
      tw.follow = true;
      tw.speed = 1.1;
      tw.pinned = new THREE.Vector3();
      tw.lookAt = new THREE.Vector3();
      const me = this.agents.get(self.id)!;
      tw.group.position.copy(me.group.position).add(new THREE.Vector3(0.8, 0, 0));
      this.twin = tw;
      this.scene.add(tw.group);
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
      w.setSize(1.25);
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
    c.b.talkPh = c.a.talkPh + Math.PI; // they take turns
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
    const u = ((c.walkT % 1) + 1) % 1;
    let p: THREE.Vector3, fwd: THREE.Vector3;
    if (s.curve) {
      p = s.curve.getPointAt(u);
      fwd = s.curve.getTangentAt(u).setY(0).normalize();
    } else {
      const pts = s.route, n = pts.length;
      const f = u * n, i = Math.floor(f);
      const p0 = pts[i], p1 = pts[(i + 1) % n];
      p = p0.clone().lerp(p1, f - i);
      fwd = p1.clone().sub(p0).normalize();
    }
    // side by side; turned a little toward the camera's right so one never hides behind the other
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    if (camRight.lengthSq() > 0.5) {
      const k = side.dot(camRight) >= 0 ? 1 : -1;
      side.lerp(camRight.multiplyScalar(k), 0.55).normalize();
    }
    side.multiplyScalar(0.4);
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
    this.applyView();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
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
  /** Recording: stop the animation loop and render exact frames with step(). */
  manual = false;
  setManual(on: boolean) {
    this.manual = on;
    cancelAnimationFrame(this.raf);
    if (!on) {
      this.clock.getDelta();
      this.loop();
    }
  }
  step(dt: number) {
    this.frame(dt);
  }
  /** Trees, gateways and the soul tree on the home island (centre and radius), for placing things clear of them. */
  get obstacles() {
    return Wisp.obstacles.map((o) => ({ x: o.p.x, z: o.p.z, r: o.r }));
  }
  /** True while the scene is only a backdrop (e.g. the home page scrolled past the hero): draw every other frame. */
  throttle = false;
  skip = false;
  loop = () => {
    if (!this.running || this.disposed || this.manual) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.throttle && (this.skip = !this.skip)) return;
    this.frame(Math.min(this.clock.getDelta(), 0.08));
  };
  frame(dt: number) {
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
    for (const [id, b] of this.bubbles)
      if (t > b.until || !this.couples.has(id)) {
        b.sp.parent?.remove(b.sp);
        b.sp.material.map?.dispose();
        b.sp.material.dispose();
        this.bubbles.delete(id);
      }
    if (this.heartMesh) {
      const d = new THREE.Object3D();
      this.hearts.forEach((h, i) => {
        d.position.set(h.x, h.y + Math.sin(t * 0.8 + h.ph) * 0.35, h.z);
        d.rotation.set(0, h.ry + Math.sin(t * 0.5 + h.ph) * 0.4, Math.sin(t * 0.7 + h.ph) * 0.12);
        d.scale.setScalar(h.s);
        d.updateMatrix();
        this.heartMesh!.setMatrixAt(i, d.matrix);
      });
      this.heartMesh.instanceMatrix.needsUpdate = true;
    }
    for (const q of this.puffs) {
      const k = (t * q.sp + q.ph) % 1;
      q.o.position.set(q.x + Math.sin(k * 5 + q.ph * 6) * 0.04 + k * q.drift, q.y + k * q.h, q.z);
      q.o.scale.setScalar(q.s * (0.5 + k * 1.1));
      (q.o.material as THREE.MeshBasicMaterial).opacity = Math.sin(k * Math.PI) * q.op;
    }
    const cam = this.camera.position;
    const camK = Math.max(m, 0.6);

    // couples: walk routes, the featured couple gets a following camera
    for (const c of this.couples.values()) {
      if (c.mode === "walk") this.advanceWalk(c, dt * camK);
      const dc = c.a.group.position.distanceTo(cam);
      const near = c.a.group.visible ? dc < 50 : dc < 46;
      const on = !!c.a.group.userData.shown && near;
      c.a.group.visible = c.b.group.visible = on;
      if (on) {
        c.a.update(dt, t, this.islandR, camK, cam);
        c.b.update(dt, t, this.islandR, camK, cam);
      }
    }
    const f = this.featured;
    if (f && f.mode === "walk" && this.view.kind === "spot" && this.view.id === f.type) {
      const isle = this.isles.get(f.type)!;
      const small = innerWidth < 800;
      const raw = f.a.group.position.clone().add(f.b.group.position).multiplyScalar(0.5).setY(0);
      // follow a smoothed point, so every little step and sway doesn't shake the camera
      const fresh = !this.followMid || this.followFor !== f.id || this.followMid.distanceTo(raw) > 6;
      if (fresh) this.followMid = raw.clone();
      this.followFor = f.id;
      this.followMid!.lerp(raw, 1 - Math.exp(-dt * 1.6));
      const mid = this.followMid!.clone();
      // their walking direction, turned slowly: the camera stays a little ahead of the couple, so we see faces, not backs
      const s0 = isle.spots[f.spot];
      let dir = isle.front.clone();
      if (s0?.curve) {
        const u = ((f.walkT % 1) + 1) % 1;
        dir = s0.curve.getTangentAt(u).setY(0).normalize();
      }
      if (fresh || !this.followDir) this.followDir = dir.clone();
      this.followDir.lerp(dir, 1 - Math.exp(-dt * 0.7)).setY(0).normalize();
      // ahead of them, swung toward the island's front so the camera never ends up over the far side
      const ahead = this.followDir.clone().multiplyScalar(1).add(isle.front.clone().multiplyScalar(0.8)).normalize();
      const right = new THREE.Vector3(ahead.z, 0, -ahead.x); // same handedness as isle.side
      const look = mid.clone().add(new THREE.Vector3(0, small && !this.insets.bottom ? -0.8 : 0.9, 0));
      if (!small) look.addScaledVector(right, 2.2 * this.view.offset);
      this.camGoal.look.copy(look);
      const back = small ? 10 : 7.5 + Math.max(0, this.view.offset - 1) * 2.3;
      this.camGoal.pos.copy(look).addScaledVector(ahead, back).add(new THREE.Vector3(0, small ? 7 : 3.4, 0)).addScaledVector(right, 0.8);
      // keep a clear view: if a stall, tree or rock sits between the couple and the camera, rise above it (eased, no jumps)
      const eye = mid.clone().add(new THREE.Vector3(0, 1.1, 0));
      let lift = 0;
      for (; lift < 5.6; lift += 1.4) {
        const cp = this.camGoal.pos.clone().add(new THREE.Vector3(0, lift, 0)).addScaledVector(ahead, -0.4 * lift);
        const to = cp.sub(eye);
        const len = to.length();
        this.ray.set(eye, to.normalize());
        this.ray.far = len;
        this.ray.camera = this.camera;
        const hit = this.ray.intersectObject(isle.group, true).some((h) => (h.object as THREE.Mesh).isMesh && h.object.visible && h.object !== isle.ring);
        if (!hit) break;
      }
      if (fresh) this.followLift = lift;
      this.followLift += (lift - this.followLift) * (1 - Math.exp(-dt * (lift > this.followLift ? 3 : 0.8)));
      this.camGoal.pos.y += this.followLift;
      this.camGoal.pos.addScaledVector(ahead, -0.4 * this.followLift);
      this.flying = 1;
    }
    const hubNear = cam.length() < 60;
    // the hologram twin keeps pace just behind your character's shoulder
    if (this.twin) {
      const me = this.agents.get(this.twin.info.id.replace(/:twin$/, ""));
      const on = !!me && me.group.visible;
      this.twin.group.visible = on;
      if (me && on) {
        const yaw = me.root.rotation.y;
        const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
        this.twin.pinned!.copy(me.group.position).addScaledVector(right, -0.85).addScaledVector(fwd, -0.45).setY(0);
        Wisp.clear(this.twin.pinned!, 0.3);
        this.twin.lookAt!.copy(me.group.position).addScaledVector(fwd, 4);
        this.twin.update(dt, t, this.islandR, m, cam);
      }
    }
    for (const w of this.agents.values()) {
      if (!w.group.visible) continue;
      w.update(dt, t, this.islandR, m, cam);
      const dl = w.group.position.distanceTo(cam);
      w.label.visible = this.mode !== "landing" && hubNear && (w.label.visible ? dl < 32 : dl < 28);
    }

    // island labels in the overview, rings on hover / focus
    const focusIsle = this.view.kind === "overview" ? null : this.view.id;
    for (const isle of this.isles.values()) {
      const di = isle.pos.distanceTo(cam);
      isle.label.visible = this.mode !== "landing" && focusIsle !== isle.id && (isle.label.visible ? di > 22 : di > 26);
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
    this.composer.render();
  }

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
