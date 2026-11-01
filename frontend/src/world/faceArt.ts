/*
 * Painted faces in a soft 3D animated-film style: almond eyes with natural irises and catch
 * lights, shaped brows, a shaded nose, full lips and a warm smile. The features are painted
 * on a canvas and wrapped over the front of the head; the nose also gets a small 3D bump.
 *
 * Each face is a 2x2 atlas: [eyes open | blink] x [mouth at rest | talking]. The character
 * switches cells to blink and talk, so animation costs nothing but a texture offset.
 */
import * as THREE from "three";
import { HAIR_COLOR, type FaceSpec } from "../faces";

/** Angular size of the painted patch on the head (radians either side of the centre). */
export const CAP_X = 1.05;
export const CAP_Y = 1.0;

const CELL = 256;
const INK = "#2a1814";

type Paint = { spec: FaceSpec; iris: string; hair: string; skin: string; fem: boolean };

const cache = new Map<string, THREE.CanvasTexture>();

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/**
 * One smooth head: a sphere with fuller cheeks, a soft jaw and a little chin, so there is no
 * seam where a separate cheek shape used to meet the skull. `geo` is a sphere (or part of one)
 * centred on the skull; it is reshaped in place.
 */
export function sculptHead(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = v.length();
    const d = v.clone().divideScalar(r || 1);
    const low = smooth(0.12, -0.5, d.y) * smooth(-0.15, 0.65, d.z);
    v.multiplyScalar(1 + 0.065 * low * (1 - 0.45 * smooth(-0.6, -0.95, d.y))); // cheeks
    v.x *= 1 - 0.1 * smooth(-0.25, -0.95, d.y); // jaw narrows toward the chin
    v.z += r * 0.06 * smooth(-0.55, -0.9, d.y) * smooth(0.3, 0.9, d.z); // chin
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Angle on the head -> pixel inside one cell. ax: right is +, ay: up is +. */
function px(ax: number, ay: number): [number, number] {
  return [((ax / CAP_X + 1) / 2) * CELL, ((-ay / CAP_Y + 1) / 2) * CELL];
}

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  if (k < 1) c.multiplyScalar(k);
  else c.lerp(new THREE.Color("#ffffff"), k - 1);
  return "#" + c.getHexString();
}
function mix(a: string, b: string, t: number) {
  return "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}
function rgba(hex: string, a: number) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

function softSpot(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, a: number) {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  rg.addColorStop(0, rgba(color, a));
  rg.addColorStop(1, rgba(color, 0));
  g.fillStyle = rg;
  g.beginPath();
  g.arc(0, 0, rx, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Almond outline: inner corner, high upper arc, outer corner, flatter lower arc. */
function almond(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, side: number) {
  const inner = cx - side * w * 0.5, outer = cx + side * w * 0.5;
  g.beginPath();
  g.moveTo(inner, cy + h * 0.1);
  g.bezierCurveTo(inner + side * w * 0.2, cy - h * 0.78, outer - side * w * 0.28, cy - h * 0.72, outer, cy - h * 0.02);
  g.bezierCurveTo(outer - side * w * 0.22, cy + h * 0.62, inner + side * w * 0.25, cy + h * 0.6, inner, cy + h * 0.1);
  g.closePath();
}

function eyeOpen(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, side: number, p: Paint) {
  const inner = cx - side * w * 0.5, outer = cx + side * w * 0.5;
  // depth: a soft socket shadow and the lid crease above
  softSpot(g, cx, cy - h * 0.2, w * 0.78, h * 1.05, shade(p.skin, 0.62), 0.32);
  g.strokeStyle = rgba(shade(p.skin, 0.5), 0.55);
  g.lineWidth = 1.8;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(inner + side * w * 0.08, cy - h * 0.62);
  g.quadraticCurveTo(cx - side * w * 0.02, cy - h * 1.22, outer + side * w * 0.02, cy - h * 0.5);
  g.stroke();
  // the eye itself
  g.save();
  almond(g, cx, cy, w, h, side);
  g.fillStyle = "#fbf6f2";
  g.fill();
  g.clip();
  const ix = cx + side * w * 0.03, iy = cy + h * 0.02, ir = h * 0.56;
  const rg = g.createRadialGradient(ix - ir * 0.15, iy + ir * 0.2, ir * 0.1, ix, iy, ir);
  rg.addColorStop(0, shade(p.iris, 1.45));
  rg.addColorStop(0.55, p.iris);
  rg.addColorStop(1, shade(p.iris, 0.45));
  g.fillStyle = rg;
  g.beginPath();
  g.arc(ix, iy, ir, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = shade(p.iris, 0.3);
  g.stroke();
  g.fillStyle = "#0d0807";
  g.beginPath();
  g.arc(ix, iy, ir * 0.42, 0, Math.PI * 2);
  g.fill();
  // the upper lid casts a shadow over the top of the eye
  const sh = g.createLinearGradient(0, cy - h * 0.7, 0, cy - h * 0.05);
  sh.addColorStop(0, "rgba(40,20,20,0.55)");
  sh.addColorStop(1, "rgba(40,20,20,0)");
  g.fillStyle = sh;
  g.fillRect(cx - w, cy - h, w * 2, h);
  g.restore();
  // catch lights
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.ellipse(ix - ir * 0.36, iy - ir * 0.34, ir * 0.3, ir * 0.26, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 0.85;
  g.beginPath();
  g.arc(ix + ir * 0.38, iy + ir * 0.36, ir * 0.12, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  // upper lash line, heavier at the outer corner
  g.strokeStyle = INK;
  g.lineJoin = "round";
  g.lineWidth = p.fem ? 4.4 : 3.4;
  g.beginPath();
  g.moveTo(inner, cy + h * 0.1);
  g.bezierCurveTo(inner + side * w * 0.2, cy - h * 0.78, outer - side * w * 0.28, cy - h * 0.72, outer + side * w * (p.fem ? 0.1 : 0.03), cy - h * (p.fem ? 0.14 : 0.04));
  g.stroke();
  if (p.fem) {
    g.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const t = 0.62 + k * 0.15;
      const bx = inner + side * w * t, by = cy - h * (0.62 - k * 0.16);
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + side * w * 0.09, by - h * 0.22);
      g.stroke();
    }
  }
  // lower lid: a soft line, not a hard outline
  g.strokeStyle = rgba(shade(p.skin, 0.45), 0.6);
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(inner + side * w * 0.18, cy + h * 0.44);
  g.quadraticCurveTo(cx, cy + h * 0.66, outer - side * w * 0.06, cy + h * 0.12);
  g.stroke();
}

function eyeClosed(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, side: number, p: Paint) {
  const inner = cx - side * w * 0.5, outer = cx + side * w * 0.5;
  softSpot(g, cx, cy - h * 0.2, w * 0.78, h * 1.05, shade(p.skin, 0.62), 0.32);
  g.lineCap = "round";
  g.strokeStyle = INK;
  g.lineWidth = p.fem ? 4 : 3.2;
  g.beginPath();
  g.moveTo(inner, cy + h * 0.05);
  g.quadraticCurveTo(cx, cy + h * 0.42, outer + side * w * 0.04, cy - h * 0.02);
  g.stroke();
  g.strokeStyle = rgba(shade(p.skin, 0.5), 0.55);
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(inner + side * w * 0.1, cy - h * 0.25);
  g.quadraticCurveTo(cx, cy - h * 0.55, outer, cy - h * 0.15);
  g.stroke();
}

function brow(g: CanvasRenderingContext2D, x: number, y: number, side: number, p: Paint) {
  const s = p.spec;
  const thick = (p.fem ? 5.6 : 9) * (s.brows === 1 ? 1.2 : 1);
  const arch = p.fem ? 10 : s.brows === 1 ? 3 : 6;
  const len = 31;
  const c = mix(shade(p.hair, 0.72), "#2a1a12", 0.25);
  // a tapered stroke: thick at the inner end, thin and arched at the outer end
  g.beginPath();
  g.moveTo(x - side * len * 0.5, y + thick * 0.5);
  g.quadraticCurveTo(x - side * len * 0.05, y - arch - thick * 0.6, x + side * len * 0.55, y + 1);
  g.quadraticCurveTo(x - side * len * 0.05, y - arch + thick * 0.55, x - side * len * 0.5, y + thick * 1.15);
  g.closePath();
  g.fillStyle = c;
  g.fill();
}

function lips(g: CanvasRenderingContext2D, x: number, y: number, p: Paint, talking: boolean) {
  const lip = mix(p.skin, "#b8414f", p.fem ? 0.62 : 0.4);
  const line = shade(lip, 0.5);
  g.lineCap = "round";
  g.lineJoin = "round";
  const open = talking || p.spec.mouth === 1;
  if (open) {
    // a warm open smile: upper teeth showing, lower lip full underneath
    const w = 23, d = talking ? 21 : 13;
    const top = () => {
      g.moveTo(x - w, y - 4);
      g.quadraticCurveTo(x, y + 1, x + w, y - 4);
    };
    g.beginPath();
    top();
    g.quadraticCurveTo(x + w * 0.62, y + d, x, y + d);
    g.quadraticCurveTo(x - w * 0.62, y + d, x - w, y - 4);
    g.closePath();
    g.fillStyle = "#4d1418";
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = "#fbf8f2";
    g.beginPath();
    g.moveTo(x - w, y - 6);
    g.quadraticCurveTo(x, y - 1, x + w, y - 6);
    g.lineTo(x + w, y + 5);
    g.quadraticCurveTo(x, y + 9, x - w, y + 5);
    g.closePath();
    g.fill();
    if (talking) {
      g.fillStyle = "#d9606c";
      g.beginPath();
      g.ellipse(x, y + d, w * 0.55, d * 0.42, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // lower lip
    g.fillStyle = lip;
    g.beginPath();
    g.moveTo(x - w * 0.82, y + d * 0.5);
    g.quadraticCurveTo(x, y + d + 7, x + w * 0.82, y + d * 0.5);
    g.quadraticCurveTo(x, y + d + 1.5, x - w * 0.82, y + d * 0.5);
    g.fill();
    // upper lip edge and smile corners
    g.strokeStyle = line;
    g.lineWidth = 2.2;
    g.beginPath();
    top();
    g.stroke();
    g.lineWidth = 1.6;
    for (const sd of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + sd * (w + 1), y - 6);
      g.quadraticCurveTo(x + sd * (w + 3), y - 3, x + sd * (w + 1.5), y - 0.5);
      g.stroke();
    }
    return;
  }
  // closed smile: lip line curving up at the corners, a full lower lip with a soft highlight
  const w = p.spec.mouth === 2 ? 16 : 21;
  g.fillStyle = lip;
  g.beginPath();
  g.moveTo(x - w * 0.85, y + 1);
  g.quadraticCurveTo(x, y + 11, x + w * 0.85, y + 1);
  g.quadraticCurveTo(x, y + 4.5, x - w * 0.85, y + 1);
  g.fill();
  g.fillStyle = mix(lip, "#3a1418", 0.15);
  g.beginPath();
  g.moveTo(x - w * 0.8, y - 0.5);
  g.quadraticCurveTo(x - w * 0.35, y - 5, x, y - 3);
  g.quadraticCurveTo(x + w * 0.35, y - 5, x + w * 0.8, y - 0.5);
  g.quadraticCurveTo(x, y + 3.5, x - w * 0.8, y - 0.5);
  g.fill();
  g.strokeStyle = shade(lip, 0.42);
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(x - w, y - 3);
  g.quadraticCurveTo(x, y + 4.5, x + w, y - 3);
  g.stroke();
  softSpot(g, x - 2, y + 6.5, 4, 2, "#ffffff", 0.45);
}

function paintCell(g: CanvasRenderingContext2D, ox: number, oy: number, blink: boolean, talking: boolean, p: Paint) {
  g.save();
  g.translate(ox, oy);
  const s = p.spec;
  // gentle modelling: rosy cheeks, a little shade under the lower lip
  for (const side of [-1, 1]) {
    const [bx, by] = px(side * 0.47, -0.27);
    softSpot(g, bx, by, 24, 15, "#ff7d8c", p.fem ? 0.26 : 0.14);
  }
  const [cx0, cy0] = px(0, -0.58);
  softSpot(g, cx0, cy0, 16, 6, shade(p.skin, 0.6), 0.22);
  // brows
  for (const side of [-1, 1]) {
    const [bx, by] = px(side * 0.34, s.brows === 2 ? 0.26 : 0.23);
    brow(g, bx, by, side, p);
  }
  // eyes
  for (const side of [-1, 1]) {
    const [ex, ey] = px(side * 0.32, -0.04);
    const w = 46, h = s.eyes === 2 ? 25 : 30;
    if (blink) eyeClosed(g, ex, ey, w, h, side, p);
    else eyeOpen(g, ex, ey, w, h, side, p);
  }
  // nose: the 3D bump carries the shape; paint the shade along one side and the nostrils
  const [nx, ny] = px(0, -0.22);
  g.strokeStyle = rgba(shade(p.skin, 0.55), 0.35);
  g.lineWidth = 2.4;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(nx + 5, ny - 30);
  g.quadraticCurveTo(nx + 8, ny - 10, nx + 9, ny + 1);
  g.stroke();
  softSpot(g, nx, ny + 7, 13, 4, shade(p.skin, 0.5), 0.3);
  g.strokeStyle = rgba(shade(p.skin, 0.4), 0.7);
  g.lineWidth = 1.8;
  for (const sd of [-1, 1]) {
    g.beginPath();
    g.moveTo(nx + sd * 8.5, ny + 2);
    g.quadraticCurveTo(nx + sd * 5, ny + 5.5, nx + sd * 2.5, ny + 4);
    g.stroke();
  }
  const [mx, my] = px(0, -0.43);
  lips(g, mx, my, p, talking);
  g.restore();
}

/** The shared face atlas for this look. Characters clone it so they can blink independently. */
export function faceAtlas(spec: FaceSpec, iris: string, skin: string, fem: boolean): THREE.CanvasTexture {
  const hair = HAIR_COLOR[spec.hairColor] ?? "#2b1d18";
  const key = [spec.eyes, spec.brows, spec.mouth, spec.hairColor, iris, skin, fem].join("|");
  let tex = cache.get(key);
  if (!tex) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = CELL * 2;
    const g = cv.getContext("2d")!;
    const p: Paint = { spec, iris, hair, skin, fem };
    paintCell(g, 0, 0, false, false, p);
    paintCell(g, CELL, 0, true, false, p);
    paintCell(g, 0, CELL, false, true, p);
    paintCell(g, CELL, CELL, true, true, p);
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.repeat.set(0.5, 0.5);
    cache.set(key, tex);
  }
  return tex;
}

/**
 * The painted face patch. `eyes` and `mouth` are the empty groups the engine already animates
 * (eyes.scale.y dips to blink, mouth.scale.y rises while talking); the patch reads them.
 */
export function facePatch(spec: FaceSpec, iris: string, skin: string, fem: boolean, eyes: THREE.Object3D, mouthProxy: THREE.Object3D) {
  const tex = faceAtlas(spec, iris, skin, fem).clone(); // shares the image, own offset
  tex.needsUpdate = false;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    toneMapped: false,
  });
  const geo = sculptHead(new THREE.SphereGeometry(0.2525, 40, 32, Math.PI / 2 - CAP_X, CAP_X * 2, Math.PI / 2 - CAP_Y, CAP_Y * 2));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  const setCell = () => {
    const blink = eyes.scale.y < 0.5;
    const talk = mouthProxy.scale.y > 1.3;
    tex.offset.set(blink ? 0.5 : 0, talk ? 0 : 0.5);
  };
  setCell();
  mesh.onBeforeRender = setCell;
  return mesh;
}
