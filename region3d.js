// ============================================================
// Analog Atlas: 3D region view (Three.js)
// Renders the elevation grid around the selected site as a block of land, and repaints it
// whenever a "what if" factor changes, so each factor's effect on the place is visible:
//   Steepness    -> vertical relief             Roughness    -> small bumps and scattered rocks
//   Temp. swing  -> frost in shadowed slopes    Ground ice   -> ice patches filling low ground
//   Illumination -> sunlight strength           Wind         -> dust streaks along the wind
//   Ground colour comes from the site's geologic setting and surface material (not sliders).
// Accuracy: the SHAPE is real (Cesium World Terrain, an 81 x 81 grid), heights are stretched (the label shows
// by how much), and a dashed square marks the 2 km box the slope/roughness numbers were measured in.
// Colours, frost, ice and dust are illustrations of the factor values, not imagery.
// ============================================================
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const S = 10;          // world size of the block (units)
const BASE = -0.6;     // bottom of the block
const host = document.getElementById("regionCanvas");

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
host.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
camera.position.set(9, 8.5, 10.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.4, 0);
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 5;
controls.maxDistance = 32;
let userMoved = false; // once the user drags, stop auto re-centring
controls.addEventListener("start", () => (userMoved = true));

const hemi = new THREE.HemisphereLight(0xdde6f5, 0x3a3128, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-7, 9, 3);
scene.add(sun);
const SUN_DIR = sun.position.clone().normalize();

const landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: false });
const sideMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

// dashed square: the 2 km box the site's steepness and roughness were measured in
const boxMat = new THREE.LineDashedMaterial({ color: 0xfde725, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.9, depthTest: false });
let box2k = null;
const scaleEl = document.getElementById("regionScale");

// little pin marking the exact site
const pin = new THREE.Group();
const pinMat = new THREE.MeshStandardMaterial({ color: 0xfde725, emissive: 0x6b5f00, roughness: 0.5 });
const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), pinMat);
stick.position.y = 0.5;
const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), pinMat);
head.position.y = 1.05;
pin.add(stick, head);
pin.visible = false;
scene.add(pin);

let land = null, sides = null;
let H = null, n = 0, spanM = 1, lo = 0, hi = 1, sorted = null, noiseA = null, noiseB = null;
let vals = null, site = null, needFit = false, lastFitH = 1;

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (land && !userMoved) fitView(lastFitH); // re-centre on resize unless the user has moved it
}
new ResizeObserver(resize).observe(host);
resize();
renderer.setAnimationLoop(() => {
  if (!host.offsetParent) return; // hidden panel: skip work
  controls.update();
  renderer.render(scene, camera);
});

// ---------- helpers ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const mix = (c, d, t) => { c[0] += (d[0] - c[0]) * t; c[1] += (d[1] - c[1]) * t; c[2] += (d[2] - c[2]) * t; };
const tmp = new THREE.Color();
const C = {
  rock: hex(0x2f2d2c), dust: hex(0xc9b48e), frost: hex(0xe6edf5), ice: hex(0xf4f8fc), streak: hex(0xe2d3b0),
};
// ground colour by geologic setting
const GEO = {
  basalt: 0x3a3634, volcanic_other: 0x5a4a42, anorthosite_highland: 0x9c978f, impact: 0x7d6f60,
  sedimentary: 0xb48a5e, evaporite: 0xe8e2d2, carbonate: 0xcfc4a8, plutonic_metamorphic: 0x8a7f74,
  ice: 0xe9eef3, unconsolidated: 0xc8a978,
};

// cheap smooth value-noise (deterministic per site)
function makeNoise(seed, scale) {
  const g = 12, rnd = [];
  let s = seed >>> 0;
  for (let i = 0; i < (g + 1) * (g + 1); i++) { s = (s * 1664525 + 1013904223) >>> 0; rnd.push(s / 4294967296); }
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * g * scale % g, y = (j / (n - 1)) * g * scale % g;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const v = (a, b) => rnd[(b % (g + 1)) * (g + 1) + (a % (g + 1))];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    out[j * n + i] = (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  }
  return out;
}

// ---------- public API ----------
function setTerrain(data) {
  H = data.heights; n = data.n; spanM = data.spanM;
  lo = Infinity; hi = -Infinity;
  for (const h of H) { if (h < lo) lo = h; if (h > hi) hi = h; }
  sorted = Float32Array.from(H).sort();
  const seed = Math.round(H[Math.floor(H.length / 2)] * 13 + H.length + spanM);
  noiseA = makeNoise(seed, 0.5);
  noiseB = makeNoise(seed * 7 + 3, 1);

  if (land) { scene.remove(land); land.geometry.dispose(); }
  const geo = new THREE.PlaneGeometry(S, S, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2); // row 0 = north (-z)
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  land = new THREE.Mesh(geo, landMat);
  scene.add(land);
  userMoved = false;
  needFit = true;
  pin.visible = true;
  if (vals) update();
}

function setValues(v, s) {
  vals = { ...v };
  site = s;
  if (H) update();
}

// ---------- repaint ----------
function update() {
  const geo = land.geometry, pos = geo.attributes.position, col = geo.attributes.color;

  // Steepness: relief scales with (what-if slope / real slope). Base view is 2x true scale.
  const k = clamp(vals.slope_deg / Math.max(0.5, site.slope_deg), 0.05, 12);
  const relief = (hi - lo) || 1;
  let scale = (S / spanM) * 2 * k;
  scale = Math.min(scale, 5.5 / relief * Math.max(1, k / 2)); // keep very tall places on screen
  // Roughness: extra (or less) small-scale bumpiness, in metres
  const dRough = clamp((vals.rough_m - (site.rough_m || 0)), -200, 200);
  const bump = Math.max(0, dRough) * 0.9;
  const calm = dRough < 0 ? clamp(-dRough / Math.max(1, site.rough_m), 0, 0.85) : 0;
  const mean = sorted[Math.floor(sorted.length / 2)];
  for (let i = 0; i < n * n; i++) {
    let h = H[i] + (noiseB[i] - 0.5) * 2 * bump;
    h = h + (mean - h) * calm;
    pos.setY(i, (h - lo) * scale);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const nor = geo.attributes.normal;

  // factor amounts, 0..1
  // Frost: from the day-night swing, or (resource-prospecting view, average-temperature slider) from cold ground
  const frostT = vals.coldMode ? smooth(5, -15, vals.air_temp_C) : smooth(1.0, 2.45, Math.log10(Math.max(0, vals.temp_swing_C) + 1));
  const iceT = clamp(vals.ice_level / 4, 0, 1);
  const illumT = clamp(vals.illum_pct / 100, 0, 1);
  const windT = clamp((vals.wind_ms || 0) / 12, 0, 1);
  const rockT = clamp(Math.log10((vals.rough_m || 0) + 1) / 2.2, 0, 1);
  const base = hex(GEO[site.geology] || 0x9a8a74);
  const surf = site.surface === "loose" ? 0.45 : site.surface === "bedrock" ? -0.35 : 0.1; // + dusty, - rocky

  const c = [0, 0, 0];
  for (let i = 0; i < n * n; i++) {
    const hn = (H[i] - lo) / relief;
    const ny = nor.getY(i), steep = 1 - ny;
    const a = noiseA[i], b = noiseB[i];
    c[0] = base[0]; c[1] = base[1]; c[2] = base[2];
    mix(c, C.dust, clamp(surf, 0, 1) * (0.7 + 0.4 * (b - 0.5)));
    mix(c, C.rock, clamp(-surf, 0, 1) * (0.6 + 0.6 * a) + rockT * smooth(0.55, 0.9, b) * 0.6 + smooth(0.15, 0.45, steep) * 0.35);
    // Wind: pale dust streaks running across the block
    const streak = 0.5 + 0.5 * Math.sin((i % n) * 0.35 + Math.floor(i / n) * 0.08 + a * 3);
    mix(c, C.streak, windT * smooth(0.75, 1, streak) * (1 - smooth(0.05, 0.25, steep)) * 0.5);
    // Day-night swing: frost settles where the sun doesn't reach, and on high ground
    const lit = nor.getX(i) * SUN_DIR.x + ny * SUN_DIR.y + nor.getZ(i) * SUN_DIR.z;
    const shade = smooth(0.75, 0.35, lit) * 0.8 + hn * 0.2;
    mix(c, C.frost, clamp(frostT * shade * (0.6 + 0.5 * a), 0, 0.75));
    // Ground ice: fills low, flat ground first
    const low = 1 - smooth(iceT * 0.6 - 0.1, iceT * 0.6 + 0.15, hn);
    mix(c, C.ice, clamp(iceT * low * (0.7 + 0.5 * a) * (1 - smooth(0.1, 0.4, steep)), 0, 0.92));
    tmp.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    col.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  col.needsUpdate = true;

  // Illumination: dimmer sun and more sky light for cloudy / low-light places
  sun.intensity = 0.8 + illumT * 3.4;
  sun.color.set(0xfff1de);
  hemi.intensity = 0.7 + illumT * 0.5;

  buildSides(scale);
  buildBox(scale, bump, calm, mean);
  if (scaleEl) {
    const ex = (scale * spanM) / S; // 1 = true scale
    const grid = Math.round(spanM / (n - 1));
    scaleEl.textContent = `${grid} m grid · heights ×${ex >= 10 ? ex.toFixed(0) : ex.toFixed(1)}${Math.abs(k - 1) > 0.02 ? " (what-if)" : ""} · relief ${Math.round(hi - lo)} m`;
  }
  const mid = Math.floor(n / 2) * n + Math.floor(n / 2);
  pin.position.set(0, (H[mid] - lo) * scale, 0);
  if (needFit) { fitView(relief * scale); needFit = false; }
}

// Frame the whole block in the middle of the canvas, viewed straight on from the south
// (north at the back), looking down at ~33° so the relief still reads.
const VIEW_DIR = new THREE.Vector3(0, 0.65, 1).normalize();
function fitView(height) {
  lastFitH = height;
  const top = Math.max(0.2, height);
  const center = new THREE.Vector3(0, (BASE + top) / 2, 0);
  const radius = Math.hypot(S / 2, S / 2, (top - BASE) / 2);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 0.8;
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(VIEW_DIR, dist);
  camera.lookAt(center);
  controls.update();
}

// Height of the (what-if) surface at any point, by bilinear interpolation of the grid
function heightAt(u, v, scale, bump, calm, mean) {
  const x = u * (n - 1), y = v * (n - 1), i = Math.min(n - 2, Math.floor(x)), j = Math.min(n - 2, Math.floor(y)), fx = x - i, fy = y - j;
  const at = (a, b) => { const q = b * n + a; let h = H[q] + (noiseB[q] - 0.5) * 2 * bump; return h + (mean - h) * calm; };
  const h = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
  return (h - lo) * scale;
}
function buildBox(scale, bump, calm, mean) {
  if (box2k) { scene.remove(box2k); box2k.geometry.dispose(); }
  const half = 1000 / spanM; // 2 km box, as a share of the block
  if (half >= 0.5) return;
  const pts = [], N = 40;
  const corners = [[0.5 - half, 0.5 - half], [0.5 + half, 0.5 - half], [0.5 + half, 0.5 + half], [0.5 - half, 0.5 + half]];
  for (let e = 0; e < 4; e++) {
    const [u0, v0] = corners[e], [u1, v1] = corners[(e + 1) % 4];
    for (let t = 0; t < N; t++) {
      const u = u0 + ((u1 - u0) * t) / N, v = v0 + ((v1 - v0) * t) / N;
      pts.push(new THREE.Vector3((u - 0.5) * S, heightAt(u, v, scale, bump, calm, mean) + 0.03, (v - 0.5) * S));
    }
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  box2k = new THREE.LineLoop(g, boxMat);
  box2k.computeLineDistances();
  box2k.renderOrder = 2;
  scene.add(box2k);
}

// Side walls give the "block of land" look
function buildSides(scale) {
  if (sides) { scene.remove(sides); sides.geometry.dispose(); }
  const edges = [];
  for (let i = 0; i < n; i++) edges.push([i, 0]);
  for (let j = 1; j < n; j++) edges.push([n - 1, j]);
  for (let i = n - 2; i >= 0; i--) edges.push([i, n - 1]);
  for (let j = n - 2; j > 0; j--) edges.push([0, j]);
  edges.push([0, 0]);
  const p = [], c = [], idx = [];
  const lin = (h) => { const k = new THREE.Color(h); return [k.r, k.g, k.b]; }; // sRGB hex -> linear
  const top = lin(0x5a4c40), bot = lin(0x1f1915);
  edges.forEach(([i, j], e) => {
    const x = (i / (n - 1) - 0.5) * S, z = (j / (n - 1) - 0.5) * S, y = (H[j * n + i] - lo) * scale;
    p.push(x, y, z, x, BASE, z);
    c.push(...top, ...bot);
    if (e > 0) { const a = (e - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  sides = new THREE.Mesh(g, sideMat);
  scene.add(sides);
}

window.Region3D = { setTerrain, setValues };
window.dispatchEvent(new Event("region3d-ready"));
