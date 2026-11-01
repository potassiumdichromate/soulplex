/*
 * Painted anime faces. Big glossy eyes, bold lash lines, soft blush and a small mouth are
 * drawn on a canvas and wrapped over the front of the head, the way anime characters are
 * built: the features are painted, not modelled.
 *
 * Each face is a 2x2 atlas: [eyes open | blink] x [mouth closed | talking]. The character
 * switches cells to blink and talk, so animation costs nothing but a texture offset.
 */
import * as THREE from "three";
import { HAIR_COLOR, type FaceSpec } from "../faces";
export { irisFor, irisForSeed } from "../faces";

/** Angular size of the painted patch on the head (radians either side of the centre). */
export const CAP_X = 1.05;
export const CAP_Y = 1.0;

const CELL = 256;
const INK = "#24141f";

type Paint = { spec: FaceSpec; iris: string; hair: string; skin: string };

const cache = new Map<string, THREE.CanvasTexture>();

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

function eyeOpen(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, side: number, p: Paint) {
  const fem = p.spec.eyes === 1;
  const inner = cx - side * w * 0.5;
  const outer = cx + side * w * 0.52;
  // eye shape: a high lash arc on top, a shallow curve underneath
  const shape = () => {
    g.beginPath();
    g.moveTo(inner, cy + h * 0.02);
    g.bezierCurveTo(inner + side * w * 0.12, cy - h * 0.6, outer - side * w * 0.12, cy - h * 0.58, outer, cy - h * 0.12);
    g.bezierCurveTo(outer - side * w * 0.05, cy + h * 0.45, inner + side * w * 0.1, cy + h * 0.5, inner, cy + h * 0.02);
    g.closePath();
  };
  g.save();
  shape();
  g.fillStyle = "#fffdfd";
  g.fill();
  g.clip();
  // iris: tall, dark at the top, glowing toward the bottom
  const ix = cx + side * w * 0.04, iy = cy + h * 0.06, irx = w * 0.34, iry = h * 0.47;
  const grad = g.createLinearGradient(0, iy - iry, 0, iy + iry);
  grad.addColorStop(0, shade(p.iris, 0.32));
  grad.addColorStop(0.55, p.iris);
  grad.addColorStop(1, shade(p.iris, 1.55));
  g.beginPath();
  g.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = shade(p.iris, 0.3);
  g.stroke();
  g.beginPath();
  g.ellipse(ix, iy + h * 0.02, irx * 0.46, iry * 0.5, 0, 0, Math.PI * 2);
  g.fillStyle = shade(p.iris, 0.18);
  g.fill();
  // glowing crescent at the bottom of the iris
  g.beginPath();
  g.ellipse(ix, iy + iry * 0.55, irx * 0.7, iry * 0.3, 0, 0, Math.PI);
  g.fillStyle = "rgba(255,255,255,0.28)";
  g.fill();
  // shadow under the upper lid
  g.beginPath();
  g.ellipse(cx, cy - h * 0.42, w * 0.7, h * 0.24, 0, 0, Math.PI * 2);
  g.fillStyle = "rgba(60,20,50,0.22)";
  g.fill();
  g.restore();
  // highlights
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.ellipse(ix - side * irx * 0.32, iy - iry * 0.36, irx * 0.36, iry * 0.26, -0.4 * side, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(ix + side * irx * 0.36, iy + iry * 0.36, irx * 0.14, iry * 0.11, 0, 0, Math.PI * 2);
  g.fill();
  // bold upper lash line with a flick at the outer corner
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = INK;
  g.lineWidth = fem ? 7 : 5.5;
  g.beginPath();
  g.moveTo(inner - side * 1, cy + h * 0.04);
  g.bezierCurveTo(inner + side * w * 0.12, cy - h * 0.6, outer - side * w * 0.12, cy - h * 0.58, outer + side * w * (fem ? 0.16 : 0.08), cy - h * (fem ? 0.26 : 0.16));
  g.stroke();
  if (fem) {
    g.lineWidth = 3.5;
    for (let k = 0; k < 3; k++) {
      const bx = outer - side * w * (0.06 + k * 0.13), by = cy - h * (0.36 + k * 0.08);
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + side * w * 0.12, by - h * 0.14);
      g.stroke();
    }
  }
  // lower lash: a short line at the outer half
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(cx + side * w * 0.05, cy + h * 0.47);
  g.quadraticCurveTo(outer - side * w * 0.1, cy + h * 0.4, outer - side * w * 0.02, cy + h * 0.12);
  g.stroke();
}

function eyeClosed(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, side: number, happy: boolean, fem: boolean) {
  g.lineCap = "round";
  g.strokeStyle = INK;
  g.lineWidth = fem ? 6 : 5;
  g.beginPath();
  const inner = cx - side * w * 0.48, outer = cx + side * w * 0.5;
  if (happy) {
    // smiling closed eyes: ^ ^
    g.moveTo(inner, cy + h * 0.12);
    g.quadraticCurveTo(cx, cy - h * 0.42, outer, cy + h * 0.12);
  } else {
    g.moveTo(inner, cy + h * 0.02);
    g.quadraticCurveTo(cx, cy + h * 0.3, outer + side * w * 0.08, cy - h * 0.06);
  }
  g.stroke();
  if (fem && !happy) {
    g.lineWidth = 3;
    for (let k = 0; k < 2; k++) {
      const bx = outer - side * w * (0.04 + k * 0.16), by = cy + h * (0.04 + k * 0.08);
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + side * w * 0.08, by + h * 0.14);
      g.stroke();
    }
  }
}

function mouth(g: CanvasRenderingContext2D, x: number, y: number, kind: number, talking: boolean) {
  g.lineCap = "round";
  g.lineJoin = "round";
  if (talking || kind === 1) {
    // open smile: flat top, round bottom, tongue
    const w = talking ? 17 : 15, h = talking ? 15 : 10;
    g.beginPath();
    g.moveTo(x - w, y - h * 0.3);
    g.quadraticCurveTo(x, y - h * 0.45, x + w, y - h * 0.3);
    g.quadraticCurveTo(x + w * 0.7, y + h, x, y + h);
    g.quadraticCurveTo(x - w * 0.7, y + h, x - w, y - h * 0.3);
    g.closePath();
    g.fillStyle = "#7a2034";
    g.fill();
    g.save();
    g.clip();
    g.beginPath();
    g.ellipse(x, y + h * 0.95, w * 0.62, h * 0.5, 0, 0, Math.PI * 2);
    g.fillStyle = "#ff7b8e";
    g.fill();
    g.fillStyle = "#ffffff";
    g.fillRect(x - w, y - h * 0.5, w * 2, h * 0.32);
    g.restore();
    g.lineWidth = 2.6;
    g.strokeStyle = INK;
    g.stroke();
    return;
  }
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.beginPath();
  if (kind === 2) {
    // small cat-like smile: ω
    g.moveTo(x - 10, y - 1);
    g.quadraticCurveTo(x - 5, y + 6, x, y);
    g.quadraticCurveTo(x + 5, y + 6, x + 10, y - 1);
  } else {
    g.moveTo(x - 11, y - 2);
    g.quadraticCurveTo(x, y + 7, x + 11, y - 2);
  }
  g.stroke();
}

function paintCell(g: CanvasRenderingContext2D, ox: number, oy: number, blink: boolean, talking: boolean, p: Paint) {
  g.save();
  g.translate(ox, oy);
  const s = p.spec;
  const fem = s.eyes === 1;
  // blush: soft pink ovals with little anime hatch lines
  for (const side of [-1, 1]) {
    const [bx, by] = px(side * 0.5, -0.24);
    const rg = g.createRadialGradient(bx, by, 1, bx, by, 22);
    rg.addColorStop(0, "rgba(255,110,150,0.42)");
    rg.addColorStop(1, "rgba(255,110,150,0)");
    g.fillStyle = rg;
    g.beginPath();
    g.ellipse(bx, by, 24, 14, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(230,80,120,0.55)";
    g.lineWidth = 1.6;
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(bx + k * 7 - 2, by + 4);
      g.lineTo(bx + k * 7 + 3, by - 4);
      g.stroke();
    }
  }
  // brows: thin strokes in the hair colour
  const browC = shade(p.hair, 0.75);
  for (const side of [-1, 1]) {
    const [bx, by] = px(side * 0.34, s.brows === 2 ? 0.3 : 0.27);
    const tilt = s.brows === 1 ? 0 : s.brows === 2 ? 5 : 2.5;
    g.strokeStyle = browC;
    g.lineCap = "round";
    g.lineWidth = s.brows === 1 ? 5 : 3.5;
    g.beginPath();
    g.moveTo(bx - side * 15, by + tilt);
    g.quadraticCurveTo(bx, by - 5, bx + side * 16, by + 2);
    g.stroke();
  }
  // eyes
  for (const side of [-1, 1]) {
    const [ex, ey] = px(side * 0.33, -0.03);
    const w = 50, h = 60;
    if (blink) eyeClosed(g, ex, ey, w, h, side, false, fem);
    else {
      if (s.eyes === 2) {
        // smiling eyes: a little shorter, with the lower lid curving up
        eyeOpen(g, ex, ey - h * 0.04, w, h * 0.84, side, p);
        g.strokeStyle = INK;
        g.lineWidth = 2.6;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(ex - w * 0.4, ey + h * 0.36);
        g.quadraticCurveTo(ex, ey + h * 0.2, ex + w * 0.4, ey + h * 0.36);
        g.stroke();
      } else eyeOpen(g, ex, ey, w, h, side, p);
    }
  }
  // nose: a tiny soft mark
  const [nx, ny] = px(0.02, -0.21);
  g.strokeStyle = shade(p.skin, 0.62);
  g.lineWidth = 2.4;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(nx - 1, ny - 3);
  g.lineTo(nx + 2, ny + 2);
  g.stroke();
  const [mx, my] = px(0, -0.42);
  mouth(g, mx, my, s.mouth, talking);
  g.restore();
}

/** The shared face atlas for this look. Characters clone it so they can blink independently. */
export function faceAtlas(spec: FaceSpec, iris: string, skin: string): THREE.CanvasTexture {
  const hair = HAIR_COLOR[spec.hairColor] ?? "#2b1d18";
  const key = [spec.eyes, spec.brows, spec.mouth, spec.hairColor, iris, skin].join("|");
  let tex = cache.get(key);
  if (!tex) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = CELL * 2;
    const g = cv.getContext("2d")!;
    const p: Paint = { spec, iris, hair, skin };
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
export function facePatch(spec: FaceSpec, iris: string, skin: string, eyes: THREE.Object3D, mouthProxy: THREE.Object3D) {
  const tex = faceAtlas(spec, iris, skin).clone(); // shares the image, own offset
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
  const geo = new THREE.SphereGeometry(0.2525, 40, 32, Math.PI / 2 - CAP_X, CAP_X * 2, Math.PI / 2 - CAP_Y, CAP_Y * 2);
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
