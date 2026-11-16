// ============================================================
// Analog Atlas — NASA Space Apps 2026
// Paste your Cesium ion token here (https://ion.cesium.com/tokens).
// Without a token the app still runs, with offline imagery and no 3D terrain.
// ============================================================
const CESIUM_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImswaUhNUDBNSHBwRmJKVzkiLCJqdGkiOiIzZjhkNzBlZi04YmIxLTRlMjMtODY2NS00OGYwNTM4MDM1NzciLCJpZCI6NTQ5NzAyLCJzdWIiOiJqaW5nd2VpemhhbzIzIiwiaXNzIjoiaHR0cHM6Ly9hcGkuY2VzaXVtLmNvbSIsImF1ZCI6IkFuYWxvZyBBdGxhcyAod2ViKSIsImlhdCI6MTc5NDcxNTQ5NX0.YswvxVSwWSLouOiPN5HzURbybhimwNm2AVzAuS5MJFg"; // "Analog Atlas (web)": assets:read, allowed only on analog-atlas.netlify.app + localhost:3000


// ---------- Scoring model (see README "How the score works") ----------
// 1. Filters: a site must pass every filter of a purpose (NASA limits), or it gets no score for it.
// 2. Factor score 0..1: numbers score by closeness, max(0, 1 - |site - target| / tolerance);
//    categories score by match (same = 1, related = 0.5, different = 0).
// 3. Purpose score = weighted sum of factor scores, out of 100.
// If a target value lies outside everything Earth has (e.g. the Moon's ~200-300 °C day-night swing),
// closeness can't work, so that factor is scored against Earth's own range instead:
// the Earth site closest to the target gets 1, the one furthest away gets 0.
const FACTORS = [
  { key: "geology", label: "Geologic setting", short: "Geology", kind: "cat",
    help: "What the ground is made of and how it formed (lava, salt flat, sandstone, ice...). Same type = full match, related type = half." },
  { key: "slope_deg", label: "Steepness", unit: "°", range: [0, 35],
    help: "Average slope of the ground, measured on a 100 m grid over a 2 km box (Cesium World Terrain). Landers and rovers need gentle ground." },
  { key: "rough_m", label: "Surface roughness", short: "Roughness", unit: "m", range: [0, 200], logSlider: true,
    help: "How bumpy the ground is: the typical height difference (RMS) from a flat plane over 2 km. Low = smooth plain, high = broken, hilly ground." },
  { key: "temp_swing_C", label: "Day–night temperature swing", short: "Temp. swing", unit: "°C", range: [0, 300], logSlider: true,
    help: "How much the temperature changes between day and night. Moon targets use ground-surface temperature (like LRO Diviner); Mars targets use air temperature (like Perseverance's MEDA). Earth: NASA POWER 2001–2025." },
  { key: "minerals", label: "Specific minerals", short: "Minerals", kind: "set",
    help: "Share of the target's key mineral groups (olivine/pyroxene, plagioclase, sulfates, carbonates, clays, iron oxides, salts) also found here." },
  { key: "surface", label: "Surface material", short: "Surface", kind: "bin",
    help: "Three bins: loose fines (dust, sand), mixed / crusted, or exposed bedrock. Neighbouring bins count as half a match." },
  { key: "ice_level", label: "Water / ground ice", short: "Ground ice", unit: "", range: [0, 4], step: 1,
    help: "0 = none, 1 = isolated, 2 = sporadic, 3 = discontinuous, 4 = continuous ice or permafrost. Earth levels are estimated from mean air temperature." },
  { key: "illum_pct", label: "Illumination", unit: "%", range: [0, 100],
    help: "Share of the year in sunlight. Earth: daylight hours from latitude, times sunlight getting through clouds (NASA POWER all-sky ÷ clear-sky)." },
  { key: "wind_ms", label: "Wind", unit: "m/s", range: [0, 15], mars: true,
    help: "Average wind speed 10 m above ground (NASA POWER). Only used for Mars, which has wind but no thick air." },
];
const FKEY = Object.fromEntries(FACTORS.map((f) => [f.key, f]));
const NUM_FACTORS = FACTORS.filter((f) => !f.kind);

// Geologic setting match table (same = 1, related = 0.5)
const RELATED = [
  ["basalt", "volcanic_other"], ["anorthosite_highland", "plutonic_metamorphic"], ["anorthosite_highland", "impact"],
  ["sedimentary", "evaporite"], ["sedimentary", "carbonate"], ["sedimentary", "unconsolidated"],
  ["evaporite", "carbonate"], ["evaporite", "unconsolidated"], ["ice", "unconsolidated"],
];
const GEO_LABEL = {
  basalt: "Basalt lava", volcanic_other: "Other volcanic rock", anorthosite_highland: "Anorthosite highland",
  impact: "Impact crater rock", sedimentary: "Sedimentary rock", evaporite: "Salt / evaporite basin",
  carbonate: "Carbonate rock", plutonic_metamorphic: "Granite / metamorphic rock", ice: "Ice sheet",
  unconsolidated: "Loose sediment (sand, gravel)",
};
const SURF_ORDER = ["loose", "mixed", "bedrock"];
const SURF_LABEL = { loose: "Loose fines", mixed: "Mixed / crusted", bedrock: "Exposed bedrock" };
const MIN_LABEL = { mafic: "olivine/pyroxene", plagioclase: "plagioclase", sulfate: "sulfates", carbonate: "carbonates",
  clay: "clays", iron_oxide: "iron oxides", chloride: "salts", ice: "ice" };
const ICE_VALUE = [0, 0.1, 0.4, 0.75, 1]; // none, isolated, sporadic, discontinuous, continuous
const ICE_LABEL = ["None", "Isolated", "Sporadic", "Disc.", "Continuous"]; // "Disc." = discontinuous (short, to fit the panels)

// Five purposes. Weights and filters come from the team's notes ("Purpose scoring system").
// "NASA" = a real engineering limit. Tolerances are our starting proposals.
const PURPOSES = {
  landing: {
    name: "Landing & descent", hint: "Gentle, smooth, firm ground where a lander can touch down safely.",
    filters: (t) => [{ key: "slope_deg", max: t.body === "moon" ? 10 : 5,
      why: t.body === "moon" ? "Artemis III landing limit: under 10° over 100 m (NASA)" : "Mars landing: 5° or less (team rule; Curiosity's landing area needed ≤3° over 2–5 km)" }],
    weights: { moon: { slope_deg: 35, rough_m: 35, surface: 30 }, mars: { slope_deg: 30, rough_m: 30, surface: 25, wind_ms: 15 } },
    tol: { slope_deg: 3, rough_m: 15, wind_ms: 6 },
  },
  mobility: {
    name: "Mobility & navigation", hint: "Ground a rover can drive across: mostly gentle, not too rough.",
    filters: () => [{ key: "flat_frac", min: 0.7, why: "At least 70% of the area at 15° or less (VIPER rover design limit)" }],
    weights: { all: { slope_deg: 30, rough_m: 30, surface: 30, geology: 10 } },
    tol: { slope_deg: 5, rough_m: 15 },
  },
  isru: {
    name: "Resource prospecting & ISRU", hint: "Places with ice or the right minerals to practise finding and using local resources.",
    filters: (t) => [{ isru: true, why: "Needs ground ice or at least one of the target's minerals" }],
    weights: { all: { ice_level: 40, minerals: 30, surface: 15, temp_swing_C: 15 } },
    tol: {}, coldTemp: true,
  },
  habitat: {
    name: "Habitat & shelter", hint: "Practising living there: temperature swings, sunlight and a water supply.",
    filters: () => [],
    weights: { all: { temp_swing_C: 33, illum_pct: 28, ice_level: 22, geology: 17 } },
    tol: { temp_swing_C: 15, illum_pct: 15 },
  },
  eva: {
    name: "EVA & crew operations", hint: "Spacewalk practice: walking traverses, sampling and tool use on similar rock.",
    filters: () => [{ key: "slope_2km_deg", max: 20, why: "Artemis EVA limit: under 20° over 2 km (NASA)" }],
    weights: { all: { slope_deg: 30, rough_m: 25, geology: 25, temp_swing_C: 20 } },
    tol: { slope_deg: 5, rough_m: 15, temp_swing_C: 15 },
  },
};
const PURPOSE_IDS = Object.keys(PURPOSES);
function defaultWeights(pid, body) {
  const W = PURPOSES[pid].weights;
  const w = { ...(W[body] || W.all) };
  if (body === "moon") delete w.wind_ms;
  return Object.fromEntries(FACTORS.map((f) => [f.key, w[f.key] || 0]));
}

const LIMITS = {
  moon: [
    ["Gravity", "The Moon pulls only 1/6 as hard as Earth."],
    ["No air", "The Moon has no air at all, a near-perfect vacuum."],
    ["Space radiation", "No magnetic field or air to block it."],
    ["Temperature", "No place on Earth swings 200–300 °C between day and night."],
  ],
  mars: [
    ["Gravity", "Mars pulls about 1/3 as hard as Earth (0.38 g)."],
    ["Thin air", "The air is about 1% as thick as Earth's, and mostly CO₂."],
    ["Space radiation", "No global magnetic field to block it."],
    ["Toxic soil", "Mars dirt contains perchlorate salts that are harmful to people."],
  ],
};

const state = {
  targets: [], sites: [], target: null, purpose: "landing", custom: false,
  weights: defaultWeights("landing", "moon"), scored: [], selected: null,
  tab: "top", entities: new Map(), powerCache: new Map(), chart: null,
  span: 12, whatif: null, regionCache: new Map(), regionToken: 0, earthRange: {},
};

// ---------- Math ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// The numbers a site is compared on. Temperature swing depends on the target body.
function siteVals(site, body) {
  return {
    slope_deg: site.slope_deg, rough_m: site.rough_m, ice_level: site.ice_level, illum_pct: site.illum_pct,
    wind_ms: site.wind_ms, temp_swing_C: body === "moon" ? site.surface_swing_C : site.air_swing_C,
    air_temp_C: site.air_temp_C, flat_frac: site.flat_frac, slope_2km_deg: site.slope_2km_deg,
  };
}
function computeEarthRanges() {
  for (const body of ["moon", "mars"]) {
    const r = {};
    for (const f of NUM_FACTORS) {
      const v = state.sites.map((s) => siteVals(s, body)[f.key]).filter(Number.isFinite);
      r[f.key] = [Math.min(...v), Math.max(...v)];
    }
    state.earthRange[body] = r;
  }
}
const outsideEarth = (k, t) => {
  const [lo, hi] = state.earthRange[t.body][k] || [-Infinity, Infinity];
  const m = 0.02 * (hi - lo); // a hair outside (Mars 50% sunlight vs Earth's 49.8% maximum) still counts as inside
  return t[k] > hi + m || t[k] < lo - m;
};
const geoMatch = (a, b) => (a === b ? 1 : RELATED.some(([x, y]) => (x === a && y === b) || (x === b && y === a)) ? 0.5 : 0);
const targetMinerals = (t) => (t.minerals || []).filter((m) => m !== "ice");

// Score one factor, 0..1. v = the site's numbers (possibly "what if" edited).
function factorScore(f, site, v, t, pid) {
  const P = PURPOSES[pid];
  if (f.key === "geology") return geoMatch(site.geology, t.geology);
  if (f.key === "surface") return Math.max(0, 1 - 0.5 * Math.abs(SURF_ORDER.indexOf(site.surface) - SURF_ORDER.indexOf(t.surface)));
  if (f.key === "minerals") {
    const want = targetMinerals(t);
    return want.length ? want.filter((m) => site.minerals.includes(m)).length / want.length : 0;
  }
  if (f.key === "ice_level") return 1 - Math.abs(ICE_VALUE[clamp(Math.round(v.ice_level), 0, 4)] - ICE_VALUE[t.ice_level]);
  if (f.key === "temp_swing_C" && P.coldTemp) // ISRU: colder ground keeps ice; annual mean <0 °C = 1, 0–10 °C = 0.5
    return v.air_temp_C < 0 ? 1 : v.air_temp_C <= 10 ? 0.5 : 0;
  const x = v[f.key], tv = t[f.key];
  if (!Number.isFinite(x) || !Number.isFinite(tv)) return 0;
  if (outsideEarth(f.key, t)) { // score against Earth's own range
    const [lo, hi] = state.earthRange[t.body][f.key];
    return hi - lo < 1e-9 ? 1 : clamp(tv > hi ? (x - lo) / (hi - lo) : (hi - x) / (hi - lo), 0, 1);
  }
  return Math.max(0, 1 - Math.abs(x - tv) / (P.tol[f.key] || 1));
}

function failedFilters(site, v, t, pid) {
  return PURPOSES[pid].filters(t).filter((F) => {
    if (F.isru) return !(v.ice_level > 0 || targetMinerals(t).some((m) => site.minerals.includes(m)));
    const x = v[F.key];
    return (F.max != null && !(x < F.max || (F.key === "slope_deg" && t.body === "mars" && x <= F.max))) || (F.min != null && !(x >= F.min));
  });
}

// Returns { asi (0..100, or null if a filter fails), s: factor scores, fails: [filters] }
function scoreSite(site, t, pid, weights, vals) {
  const v = vals || siteVals(site, t.body);
  const s = {};
  let num = 0, den = 0;
  for (const f of FACTORS) {
    const w = weights[f.key] || 0;
    if (f.mars && t.body !== "mars") continue;
    s[f.key] = factorScore(f, site, v, t, pid);
    num += w * s[f.key]; den += w;
  }
  const fails = failedFilters(site, v, t, pid);
  return { asi: fails.length ? null : den > 0 ? (100 * num) / den : 0, raw: den > 0 ? (100 * num) / den : 0, s, fails };
}
// In ISRU the temperature factor is scored on the yearly average (cold ground keeps ice), so it is named that way
const coldMode = () => !!PURPOSES[state.purpose].coldTemp;
const fName = (f) => (f.key === "temp_swing_C" && coldMode() ? "Avg. temp." : f.short || f.label);
const fHelp = (f) => (f.key === "temp_swing_C" && coldMode()
  ? "For resource prospecting, temperature is scored on the yearly average: below 0 °C = full match (ground stays frozen), 0–10 °C = half, above 10 °C = none." : f.help);
const shownFactors = () => FACTORS.filter((f) => !(f.mars && state.target.body !== "mars"));
const activeFactors = () => shownFactors().filter((f) => (state.weights[f.key] || 0) > 0);

// ---------- Shareable links: the view lives in the URL hash ----------
// e.g. #target=jezero&purpose=isru&site=yungay&area=4
const OLD_TARGETS = { shackleton: "connecting-ridge" };
let urlReady = false;
function stateToHash() {
  const p = new URLSearchParams();
  p.set("target", state.target.id);
  p.set("purpose", state.purpose);
  if (state.custom) p.set("weights", FACTORS.map((f) => Math.round(state.weights[f.key])).join(","));
  if (state.selected) p.set("site", state.selected);
  if (state.span !== 12) p.set("area", state.span);
  return "#" + p.toString();
}
function syncUrl() {
  if (!urlReady || !state.target) return;
  const h = stateToHash();
  if (location.hash !== h) history.replaceState(null, "", h);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const t = p.get("target");
  return { target: OLD_TARGETS[t] || t, purpose: p.get("purpose"), weights: p.get("weights"), site: p.get("site"), area: +p.get("area") || null };
}
// Returns true when it selected (and flew to) a site
function applyHash(h) {
  if ([4, 12, 30].includes(h.area)) {
    state.span = h.area;
    document.querySelectorAll("#spanSeg button").forEach((x) => x.setAttribute("aria-pressed", String(+x.dataset.span === h.area)));
  }
  if (PURPOSES[h.purpose]) state.purpose = h.purpose;
  const tid = state.targets.some((t) => t.id === h.target) ? h.target : (state.target || state.targets[0]).id;
  const w = h.weights ? h.weights.split(",").map(Number) : null;
  const custom = w && w.length === FACTORS.length && w.every(Number.isFinite) ? w : null;
  setTarget(tid, custom ? Object.fromEntries(FACTORS.map((f, i) => [f.key, clamp(w[i], 0, 50)])) : null);
  if (h.site && state.sites.some((s) => s.id === h.site)) { selectSite(h.site); return true; }
  return false;
}
async function copyLink() {
  syncUrl();
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied. It opens this exact view.");
  } catch (e) {
    toast(`Copy this link: ${url}`, 8000);
  }
}

// ---------- Notices, loading and failure states ----------
let toastTimer = 0;
function toast(msg, ms = 2800, kind = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = `toast ${kind}`), ms);
}
function showLoading(msg, isError = false) {
  const el = document.getElementById("loading");
  el.classList.remove("done");
  el.classList.toggle("error", isError);
  el.querySelector(".loading-text").textContent = msg;
}
function initLoading() {
  const el = document.getElementById("loading");
  const hide = () => { if (!el.classList.contains("error")) el.classList.add("done"); };
  let started = false;
  // hide once the first wave of tiles is nearly done (a fly-in keeps the queue busy, so don't wait for zero)
  viewer.scene.globe.tileLoadProgressEvent.addEventListener((n) => {
    if (n > 0) started = true;
    if (started && n <= 4) hide();
  });
  setTimeout(hide, 8000); // never show it for long
}
// Cesium ion unreachable or token rejected: fall back to the offline map, keep everything else working
let ionDown = false;
function ionFailed(err) {
  if (ionDown || !viewer) return;
  ionDown = true;
  console.warn("[Analog Atlas] Cesium ion failed; using offline imagery.", err);
  hasTerrain = false;
  state.regionCache.clear();
  viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.add(Cesium.ImageryLayer.fromProviderAsync(
    Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"))
  ));
  tuneImagery();
  document.getElementById("loading").classList.add("done");
  toast("Couldn't reach Cesium ion (check the access token). Showing a simpler map without 3D terrain.", 9000, "error");
}

function rescore() {
  state.scored = state.sites
    .map((site) => ({ site, ...scoreSite(site, state.target, state.purpose, state.weights) }))
    .sort((a, b) => (b.asi ?? -1) - (a.asi ?? -1) || b.raw - a.raw);
  state.scored.forEach((r, i) => (r.rank = i + 1));
  const pass = state.scored.filter((r) => r.asi != null);
  state.passing = pass.length;
  state.relRange = pass.length ? [pass[pass.length - 1].asi, pass[0].asi] : [0, 0]; // sorted, so ends = min/max
  updateEntities();
  renderDrawer();
  if (state.selected) { renderDetail(state.selected, false); renderWhatIf(); }
  syncUrl();
}

// viridis-ish ramp
const VIRIDIS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
function viridis(t) {
  t = clamp(t, 0, 1) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(t)), f = t - i;
  return VIRIDIS[i].map((c, k) => Math.round(c + (VIRIDIS[i + 1][k] - c) * f));
}
const FAIL_RGB = [96, 102, 112];
const cssColor = (asi) => (asi == null ? `rgb(${FAIL_RGB.join(",")})` : `rgb(${viridis(asi / 100).join(",")})`);
// stretch colors over the current score range so the map always shows contrast
function rel(asi) {
  const [lo, hi] = state.relRange || [0, 0];
  return hi - lo < 1e-6 ? 0.5 : (asi - lo) / (hi - lo);
}
const relColor = (asi) => (asi == null ? cssColor(null) : `rgb(${viridis(rel(asi)).join(",")})`);
const scoreText = (asi) => (asi == null ? "—" : asi.toFixed(0));
const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
const pts = (d) => { const n = Math.round(d); return `${n} point${n === 1 ? "" : "s"}`; };
// "EVA & crew operations" -> "EVA & crew operations" (keeps acronyms), "Landing & descent" -> "landing & descent"
const lowerName = (n) => n.split(" ").map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
const shortTarget = () => state.target.name.split(" (")[0].split(" — ")[0];
const bodyName = () => (state.target.body === "moon" ? "Moon" : "Mars");
// ---------- Cesium ----------
let viewer, bestRing = null, hasTerrain = false, terrainReady = Promise.resolve(false);
function initGlobe() {
  const hasToken = CESIUM_TOKEN && CESIUM_TOKEN.length > 20;
  hasTerrain = hasToken;
  if (hasToken) Cesium.Ion.defaultAccessToken = CESIUM_TOKEN;
  const opts = {
    animation: false, timeline: false, geocoder: false, homeButton: false, sceneModePicker: false,
    baseLayerPicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false,
    selectionIndicator: false,
  };
  if (hasToken) {
    const terrain = Cesium.Terrain.fromWorldTerrain();
    terrain.errorEvent.addEventListener((e) => ionFailed(e));
    // resolves once world terrain is attached (or failed), so early requests don't sample a flat placeholder
    terrainReady = new Promise((res) => {
      terrain.readyEvent.addEventListener(() => res(true));
      terrain.errorEvent.addEventListener(() => res(false));
    });
    opts.terrain = terrain;
  } else {
    console.warn("[Analog Atlas] No CESIUM_TOKEN set — using offline Natural Earth imagery, no 3D terrain.");
    opts.baseLayer = Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"))
    );
  }
  try {
    viewer = new Cesium.Viewer("globe", opts);
  } catch (e) {
    console.error(e);
    showLoading("Your browser couldn't start the 3D globe. WebGL may be turned off or unsupported. The rankings and details still work.", true);
    return;
  }
  const base = viewer.imageryLayers.get(0);
  if (hasToken && base && base.errorEvent) base.errorEvent.addEventListener((e) => ionFailed(e));
  tuneImagery();
  initLoading();
  const scene = viewer.scene;
  scene.globe.enableLighting = false;
  scene.globe.depthTestAgainstTerrain = false;
  if ("verticalExaggeration" in scene) scene.verticalExaggeration = 1.6;
  scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;

  // Mouse controls: wheel = zoom, left-drag = move/spin, right-drag (or middle / Ctrl+left) = tilt & rotate
  const ctl = scene.screenSpaceCameraController;
  const E = Cesium.CameraEventType, K = Cesium.KeyboardEventModifier;
  ctl.zoomEventTypes = [E.WHEEL, E.PINCH];
  ctl.rotateEventTypes = [E.LEFT_DRAG];
  ctl.translateEventTypes = [E.LEFT_DRAG];
  ctl.tiltEventTypes = [E.RIGHT_DRAG, E.MIDDLE_DRAG, E.PINCH, { eventType: E.LEFT_DRAG, modifier: K.CTRL }];
  ctl.lookEventTypes = [{ eventType: E.LEFT_DRAG, modifier: K.SHIFT }];
  ctl.inertiaZoom = 0.85;
  ctl.maximumZoomDistance = 3.0e7; // far enough to see the whole Earth, no further
  scene.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  layoutGlobe();

  // hover tooltip
  const tip = document.createElement("div");
  tip.id = "hoverTip";
  document.body.appendChild(tip);

  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction((e) => {
    const p = scene.pick(e.position);
    if (p && p.id && p.id.siteId) selectSite(p.id.siteId);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction((e) => {
    const p = scene.pick(e.endPosition);
    if (p && p.id && p.id.siteId) {
      const r = state.scored.find((x) => x.site.id === p.id.siteId);
      tip.innerHTML = `${r.site.name}<b>${scoreText(r.asi)}</b>`;
      const cr = scene.canvas.getBoundingClientRect();
      tip.style.left = cr.left + e.endPosition.x + "px";
      tip.style.top = cr.top + e.endPosition.y + "px";
      tip.style.display = "block";
      scene.canvas.style.cursor = "pointer";
    } else {
      tip.style.display = "none";
      scene.canvas.style.cursor = "";
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  for (const site of state.sites) {
    const ent = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
      // Point markers (not image billboards): recolouring a point is instant, whereas swapping a billboard's image
      // is loaded asynchronously and every recoloured dot vanished for a frame: the flicker while dragging weights.
      point: {
        color: markerColor([33, 145, 140]),
        pixelSize: site.known_analog ? 12 : 10,
        outlineColor: site.known_analog ? Cesium.Color.WHITE.withAlpha(0.95) : Cesium.Color.fromBytes(5, 7, 10, 215),
        outlineWidth: site.known_analog ? 2.5 : 1.25,
        heightReference: hasToken ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(2e5, 1.5, 2e7, 0.9),
      },
      label: {
        text: "", font: "600 13px Inter, sans-serif", fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20), show: false,
        heightReference: hasToken ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    ent.siteId = site.id;
    state.entities.set(site.id, ent);
  }

  // "★ Best match" label on the current winner
  bestRing = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(0, 0),
    label: {
      text: "", font: "600 14px Inter, sans-serif", fillColor: Cesium.Color.fromCssColorString("#ffe6a6"),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 4, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -32), showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("#1a1408").withAlpha(0.82), backgroundPadding: new Cesium.Cartesian2(8, 5),
      heightReference: hasToken ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  // Hide markers on the far side of the planet (they'd otherwise show through the globe)
  const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, Cesium.Cartesian3.ZERO);
  const now = new Cesium.JulianDate();
  scene.preRender.addEventListener(() => {
    occluder.cameraPosition = viewer.camera.positionWC;
    for (const ent of [...state.entities.values(), bestRing]) {
      const p = ent.position.getValue(now);
      if (!p) continue;
      const lifted = Cesium.Cartesian3.multiplyByScalar(p, 1.0005, new Cesium.Cartesian3()); // allow for terrain height
      const vis = occluder.isPointVisible(lifted);
      if (ent.show !== vis) ent.show = vis;
    }
  });
}

// Mute the base map a little (more in dark mode) so data dots and panels stand out
function tuneImagery() {
  if (!viewer) return;
  const dark = document.documentElement.dataset.theme !== "light";
  for (let i = 0; i < viewer.imageryLayers.length; i++) {
    const l = viewer.imageryLayers.get(i);
    l.brightness = dark ? 0.78 : 0.95; l.saturation = dark ? 0.7 : 0.85; l.contrast = 1.08;
  }
}

// Keep the globe centred in the part of the screen the panels don't cover:
// the canvas is widened past the covered side so its centre sits mid-way between the columns.
const isMobile = () => window.matchMedia("(max-width: 860px)").matches;

function layoutGlobe() {
  if (!viewer) return;
  const g = document.getElementById("globe");
  if (isMobile()) { // stacked layout: the globe spans the top of the page, panels sit below it
    g.style.left = g.style.right = "";
    const cb = document.querySelector(".cesium-viewer-bottom");
    if (cb) cb.style.removeProperty("left");
    return;
  }
  const W = window.innerWidth;
  const vis = (id) => !document.getElementById(id).classList.contains("hidden");
  const L = vis("left") || vis("drawer") ? document.getElementById("leftCol").getBoundingClientRect().right : 0;
  const R = vis("right") || vis("region") ? W - document.getElementById("rightCol").getBoundingClientRect().left : 0;
  const d = L - R; // >0: the free area sits right of the screen centre
  g.style.left = (d < 0 ? d : 0) + "px";
  g.style.right = (d > 0 ? -d : 0) + "px";
  const cb = document.querySelector(".cesium-viewer-bottom");
  if (cb) cb.style.setProperty("left", (L + 12 - Math.min(0, d)) + "px", "important");
}

// Whole Earth in view, turned so the given point faces you
function homeView(lon = -40, lat = 20) {
  if (!viewer) return;
  const fr = viewer.camera.frustum;
  const aspect = viewer.canvas.clientWidth / Math.max(1, viewer.canvas.clientHeight);
  const fovy = aspect > 1 ? 2 * Math.atan(Math.tan(fr.fov / 2) / aspect) : fr.fov;
  const d = 6.371e6 / Math.sin((fovy / 2) * 0.8);
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(lon, clamp(lat, -35, 35), d - 6.371e6) });
}

function updateEntities() {
  if (!viewer) return;
  state.scored.forEach((r) => {
    const ent = state.entities.get(r.site.id);
    // only touch the marker when its look changes
    const col = markerColor(r.asi == null ? FAIL_RGB : viridis(Math.round(rel(r.asi) * 40) / 40));
    if (ent._col !== col) { ent._col = col; ent.point.color = col; }
    const sz = (r.site.known_analog ? 12 : 10) * (r.asi == null ? 0.75 : 1);
    if (ent._sz !== sz) { ent._sz = sz; ent.point.pixelSize = sz; }
    const isSel = state.selected === r.site.id;
    const show = r.rank === 2 || r.rank === 3 || (isSel && r.rank !== 1);
    if (ent._lshow !== show) { ent._lshow = show; ent.label.show = show; }
    if (!show) return;
    const text = isSel ? `${r.site.name} · ${scoreText(r.asi)}` : `#${r.rank} ${r.site.name.split(" — ")[0].split(" · ")[0]}`;
    if (ent._ltext !== text) { ent._ltext = text; ent.label.text = text; }
  });
  const best = state.scored[0];
  if (bestRing && best) {
    bestRing.position = Cesium.Cartesian3.fromDegrees(best.site.lon, best.site.lat);
    bestRing.siteId = best.site.id;
    bestRing.label.text = best.asi == null ? "No place passes the filters" : `★ Best match: ${best.site.name.split(" — ")[0]} · ${best.asi.toFixed(0)}`;
  }
}

const markerCache = new Map();
function markerColor([r, g, b]) {
  const key = `${r},${g},${b}`;
  if (!markerCache.has(key)) markerCache.set(key, Cesium.Color.fromBytes(r, g, b, 240));
  return markerCache.get(key);
}

// Fly so the site is seen from 80° (10° off straight down), with the ground filling the view.
async function flyToSite(site) {
  if (!viewer) return;
  let h = 0;
  try {
    if (hasTerrain) {
      const [c] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [Cesium.Cartographic.fromDegrees(site.lon, site.lat)]);
      h = c.height || 0;
    }
  } catch (e) { /* no terrain: fly to sea level */ }
  const center = Cesium.Cartesian3.fromDegrees(site.lon, site.lat, h);
  const range = Math.max(9000, state.span * 1000 * 2.2);
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 500), {
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-80), range),
    duration: 3,
  });
}

// ---------- UI: left panel ----------
function initLeft() {
  initDropdown();

  const pres = document.getElementById("presets");
  pres.innerHTML = PURPOSE_IDS.map((p) => `<button data-p="${p}">${PURPOSES[p].name}</button>`).join("");
  pres.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.purpose = b.dataset.p;
    state.custom = false;
    state.weights = defaultWeights(state.purpose, state.target.body);
    syncPresetUI();
    rescore();
  };

  document.getElementById("sliders").innerHTML = FACTORS.map(
    (f) => `<div class="wrow" data-row="${f.key}" title="${f.help}">
      <label class="wname" for="w_${f.key}">${fName(f)}</label>
      <span class="wtrack"><input type="range" id="w_${f.key}" min="0" max="50" step="1" data-k="${f.key}" aria-label="Weight of ${f.label}"><span class="wdef" title="Default for this purpose"></span></span>
      <output class="wval" id="v_${f.key}" for="w_${f.key}"></output></div>`
  ).join("");
  // Live while dragging: the percentages update at once, and the rescore (rankings, globe, details, 3D score)
  // runs at most once per animation frame, so dragging stays smooth.
  const sl = document.getElementById("sliders");
  let frame = 0;
  sl.oninput = (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    state.weights[k] = parseFloat(e.target.value);
    state.custom = true;
    const body = state.target.body;
    const total = FACTORS.reduce((a, f) => a + (f.mars && body !== "mars" ? 0 : state.weights[f.key] || 0), 0) || 1;
    for (const f of FACTORS) {
      if (f.mars && body !== "mars") continue;
      const w = state.weights[f.key] || 0;
      document.getElementById("v_" + f.key).textContent = w === 0 ? "off" : `${Math.round((100 * w) / total)}%`;
    }
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; syncPresetUI(); rescore(); });
  };
  document.getElementById("wReset").onclick = () => {
    state.custom = false;
    state.weights = defaultWeights(state.purpose, state.target.body);
    syncPresetUI();
    rescore();
  };
  syncPresetUI();
}

// Themed dropdown for the target (native <select> menus can't be styled)
function initDropdown() {
  const btn = document.getElementById("targetBtn"), list = document.getElementById("targetList");
  document.body.appendChild(list); // escape the panel (its blur effect would clip a fixed menu)
  const groups = [["moon", "Moon"], ["mars", "Mars"]];
  list.innerHTML = groups.map(([b, label]) =>
    `<li class="dd-group" role="presentation">${label}</li>` +
    state.targets.filter((t) => t.body === b).map((t) =>
      `<li class="dd-opt" role="option" id="opt_${t.id}" data-id="${t.id}" aria-selected="false">${t.name}<small>${t.description.split(". ")[0].replace(/\.$/, "")}.</small></li>`).join("")
  ).join("");
  const opts = () => [...list.querySelectorAll(".dd-opt")];
  let active = -1;
  const setActive = (i) => {
    const o = opts();
    active = (i + o.length) % o.length;
    o.forEach((x, k) => x.classList.toggle("active", k === active));
    list.setAttribute("aria-activedescendant", o[active].id);
    const el = o[active]; // scroll only the list, never the panels behind it
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop - 4;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + 4;
  };
  const open = () => {
    // fixed position so the menu floats above the scrolling panel instead of being clipped by it
    const r = btn.getBoundingClientRect();
    Object.assign(list.style, { left: r.left + "px", top: r.bottom + 4 + "px", width: r.width + "px",
      maxHeight: Math.max(160, window.innerHeight - r.bottom - 20) + "px" });
    list.hidden = false; btn.setAttribute("aria-expanded", "true");
    setActive(opts().findIndex((x) => x.dataset.id === state.target.id));
    list.focus({ preventScroll: true });
  };
  const close = (focusBtn = true) => { list.hidden = true; btn.setAttribute("aria-expanded", "false"); if (focusBtn) btn.focus(); };
  const choose = (id) => { setTarget(id); close(); };
  btn.onclick = () => (list.hidden ? open() : close());
  btn.onkeydown = (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); } };
  list.onclick = (e) => { const o = e.target.closest(".dd-opt"); if (o) choose(o.dataset.id); };
  list.onmousemove = (e) => { const o = e.target.closest(".dd-opt"); if (o) setActive(opts().indexOf(o)); };
  list.onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(opts()[active].dataset.id); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close(false);
  };
  document.getElementById("leftScroll").addEventListener("scroll", () => !list.hidden && close(false));
  window.addEventListener("scroll", () => !list.hidden && close(false), { passive: true });
  window.addEventListener("resize", () => !list.hidden && close(false));
  document.addEventListener("mousedown", (e) => {
    if (!list.hidden && !document.getElementById("targetDD").contains(e.target) && !list.contains(e.target)) close(false);
  });
}


function syncPresetUI() {
  document.querySelectorAll("#presets button").forEach((b) => b.classList.toggle("active", b.dataset.p === state.purpose));
  const P = PURPOSES[state.purpose];
  const filt = state.target ? P.filters(state.target).map((F) => F.why) : [];
  const hint = P.hint + (filt.length ? `<span class="must">Must pass: ${filt.join("; ")}.</span>` : "");
  const hintEl = document.getElementById("presetHint");
  if (hintEl.dataset.k !== hint) { hintEl.innerHTML = hint; hintEl.dataset.k = hint; } // don't reflow while dragging
  document.getElementById("wReset").hidden = !state.custom;
  document.getElementById("wState").textContent = state.custom ? "Custom" : "Default";
  const body = state.target ? state.target.body : "moon";
  const defs = defaultWeights(state.purpose, body);
  const total = FACTORS.reduce((a, f) => a + (f.mars && body !== "mars" ? 0 : state.weights[f.key] || 0), 0) || 1;
  for (const f of FACTORS) {
    const off = !!(f.mars && body !== "mars"); // must be a real boolean: toggle(x, undefined) FLIPS the class
    const row = document.querySelector(`.wrow[data-row="${f.key}"]`);
    const w = state.weights[f.key] || 0;
    const nm = row.querySelector(".wname");
    if (nm.textContent !== fName(f)) { nm.textContent = fName(f); row.title = fHelp(f); }
    if (row.classList.contains("off") !== off) row.classList.toggle("off", off);
    const inp = row.querySelector("input");
    inp.disabled = off;
    if (+inp.value !== w) inp.value = w;
    row.querySelector(".wdef").style.left = `calc(7px + (100% - 14px) * ${defs[f.key] / 50})`;
    document.getElementById("v_" + f.key).textContent = off ? "Mars" : w === 0 ? "off" : `${Math.round((100 * w) / total)}%`;
  }
}

function setTarget(id, customWeights) {
  state.target = state.targets.find((t) => t.id === id);
  const t = state.target;
  if (customWeights) { state.weights = customWeights; state.custom = true; }
  else if (!state.custom) state.weights = defaultWeights(state.purpose, t.body);
  document.querySelector("#targetBtn .dd-val").innerHTML =
    `<span class="body-tag ${t.body}">${bodyName()}</span><span class="dd-name">${t.name}</span>`;
  document.querySelectorAll("#targetList .dd-opt").forEach((o) => o.setAttribute("aria-selected", String(o.dataset.id === id)));
  const measured = new Set(t.measured || []);
  document.getElementById("targetMeta").innerHTML =
    `<span class="body-tag ${t.body}">${bodyName()}</span>${t.description}` +
    (t.outside_human_limits ? `<span class="warn">Outside NASA's human-landing limits (±50° latitude, below +2 km).</span>` : "") +
    `<span class="src">Target values: ${measured.size ? "partly measured, partly" : ""} <span class="approx">estimated</span> from published missions. See the details under "How it compares".</span>`;
  syncPresetUI();
  rescore();
}

// ---------- UI: details panel ----------
function fmtVal(f, v) {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "—";
  if (f.key === "ice_level") return ICE_LABEL[clamp(Math.round(v), 0, 4)];
  const n = +v;
  const s = Math.abs(n) < 1 && n !== 0 ? n.toFixed(2) : n >= 100 ? n.toFixed(0) : n.toFixed(Number.isInteger(n) ? 0 : 1);
  return s + (f.unit ? (f.unit === "°" || f.unit === "%" ? f.unit : " " + f.unit) : "");
}
function catText(f, obj) {
  if (f.key === "geology") return GEO_LABEL[obj.geology] || obj.geology;
  if (f.key === "surface") return SURF_LABEL[obj.surface] || obj.surface;
  if (f.key === "minerals") {
    const list = (obj.minerals || []).filter((m) => m !== "ice");
    return list.length ? list.map((m) => MIN_LABEL[m] || m).join(", ") : "—";
  }
  return "";
}
function selectSite(id) {
  state.selected = id;
  updateEntities();
  renderDetail(id, true);
  const site = state.sites.find((s) => s.id === id);
  state.whatif = pickValues(site);
  setWhatIfMode("real");
  renderWhatIf(true);
  loadRegion(site);
  renderDrawer();
  syncUrl();
}


function renderDetail(id, fly) {
  const r = state.scored.find((x) => x.site.id === id);
  if (!r) return;
  const { site, s, asi, rank, fails } = r;
  const t = state.target;
  const v = siteVals(site, t.body);
  const N = state.scored.length, NP = state.passing;
  const beats = asi == null || NP < 2 ? 0 : Math.round((100 * (NP - rank)) / (NP - 1));
  const est = new Set(site.estimated || []);
  const tag = (isEst) => (isEst ? ' <span class="approx" title="Estimated, not measured">est.</span>' : "");
  const q = (x) => String(x || "").replace(/"/g, "&quot;");
  const mapTag = (txt, title) => ` <span class="approx map" title="${q(title)}">${txt}</span>`;
  const prov = (f) => {
    if (f.key === "geology" && site.geology_src === "map") return mapTag("map", `Mapped rock here: ${site.map_unit}. ${site.map_source}`);
    if (f.key === "geology" && site.geology_src === "map_family") return mapTag("map ✓", `Checked against a geologic map, which shows: ${site.map_unit}. ${site.map_source}`);
    if (f.key === "minerals" && site.minerals_src === "map") return mapTag("map", `Worked out from the mapped rock types (${site.map_unit})`);
    return tag(est.has(f.key));
  };
  const P = PURPOSES[state.purpose];

  // Every factor is shown; the ones this purpose counts come first, the rest are dimmed for context.
  const wTotal = activeFactors().reduce((a, f) => a + state.weights[f.key], 0) || 1;
  const counted = activeFactors().sort((a, b) => state.weights[b.key] - state.weights[a.key]);
  const context = shownFactors().filter((f) => !counted.includes(f));
  const row = (f, on) => {
    const sc = s[f.key];
    let here, there;
    if (f.kind) { here = catText(f, site) + prov(f); there = catText(f, t); }
    else if (f.key === "temp_swing_C" && P.coldTemp) { here = `${fmtVal(f, v.air_temp_C)} avg` + tag(false); there = "below 0 °C"; }
    else {
      here = fmtVal(f, v[f.key]) + tag(f.key === "ice_level");
      there = fmtVal(f, t[f.key]) + (outsideEarth(f.key, t) ? ' <span class="approx" title="Outside anything on Earth: scored against Earth\'s own range">off-Earth</span>' : "");
    }
    const tsrc = t.sources && t.sources[f.key] ? ` title="${t.sources[f.key].replace(/"/g, "&quot;")}"` : "";
    const wt = on ? `<span class="fw">weight ${Math.round((100 * state.weights[f.key]) / wTotal)}%</span>` : `<span class="fw">not counted</span>`;
    return `<tr title="${fHelp(f)}" class="${on ? "on" : "ctx"}"><td class="fn">${fName(f)}${wt}</td><td class="n${f.kind ? " cat" : ""}">${here}</td><td class="n muted${f.kind ? " cat" : ""}"${tsrc}>${there}</td>
      <td class="n">${Math.round(sc * 100)}%<span class="sbar-track"><span class="sbar" style="width:${Math.round(sc * 100)}%;background:${on ? cssColor(sc * 100) : "var(--muted)"}"></span></span></td></tr>`;
  };
  const rows = counted.map((f) => row(f, true)).join("") +
    (context.length ? `<tr class="grp"><td colspan="4">Not counted for ${lowerName(P.name)}, shown for context</td></tr>` + context.map((f) => row(f, false)).join("") : "");

  // all five purpose scores for this site
  const allP = PURPOSE_IDS.map((pid) => {
    const x = scoreSite(site, t, pid, defaultWeights(pid, t.body));
    return `<tr${pid === state.purpose ? ' class="sel"' : ""}><td>${PURPOSES[pid].name}</td><td class="n">${x.asi == null ? '<span class="muted small" title="' + x.fails.map((F) => F.why).join("; ") + '">fails filter</span>' : x.asi.toFixed(0)}</td></tr>`;
  }).join("");

  const limits = LIMITS[t.body].map(([k, v]) => `<div class="badge"><b>${k}</b>${v}</div>`).join("");
  const failHtml = fails.length
    ? `<div class="fail-note">Doesn't pass for ${lowerName(P.name)}: ${fails.map((F) => `${F.why} (here: ${F.isru ? "no ice or matching minerals" : F.key === "flat_frac" ? Math.round(v.flat_frac * 100) + "% gentle" : v[F.key].toFixed(1) + "°"})`).join("; ")}. Its features would score ${r.raw.toFixed(0)} if it passed.</div>`
    : "";

  // Re-rendering for the same site (e.g. while a weight slider is dragged): keep the chart and just update it,
  // so the panel doesn't flash a new chart every frame.
  const box = document.getElementById("siteDetail");
  const keepChart = !fly && state.chart && state.chartSite === id ? box.querySelector(".chart-wrap") : null;
  if (keepChart) keepChart.remove();
  box.innerHTML = `
    <div class="site-name">${site.name}</div>
    <div class="site-country">${site.country || ""} · ${site.lat.toFixed(2)}°, ${site.lon.toFixed(2)}° · ${Math.round(site.elev_m)} m</div>
    <p class="site-desc">${site.description || ""}</p>
    <div class="asi-big"><span class="num">${scoreText(asi)}</span>
      <span class="of">out of 100: ${lowerName(P.name)} match with ${shortTarget()}<br>${asi == null ? `not ranked (fails a filter) · ${NP} of ${N} places pass` : `${ordinal(rank)} best of ${NP} places that pass · beats ${beats}% of them`}</span></div>
    <div class="meter"><i style="width:${(asi ?? 0).toFixed(0)}%;background:${cssColor(asi)}"></i></div>
    ${failHtml}
    <div class="why">${explain(r)}</div>
    ${asi == null || !state.scored[0] || state.scored[0].asi == null ? "" : rank === 1
      ? (state.scored[1] && state.scored[1].asi != null ? `<div class="best-note">★ This is the best match for ${shortTarget()}, ahead of <button data-goto="${state.scored[1].site.id}">${state.scored[1].site.name}</button> by ${pts(asi - state.scored[1].asi)}.</div>` : "")
      : `<div class="best-note">The best match is <button data-goto="${state.scored[0].site.id}">${state.scored[0].site.name}</button>, scoring ${pts(state.scored[0].asi - asi)} higher.</div>`}
    <div style="margin-top:6px">${site.known_analog ? '<span class="pill">Already used by space agencies</span>' : site.kind === "sampled" ? '<span class="pill">Sampled point</span>' : '<span class="pill">New idea</span>'}
      ${site.protected ? '<span class="pill prot">Protected: needs permits</span>' : ""}</div>
    <h3>Match on every feature <span class="h3-note">(further out = closer match)</span></h3>
    <div class="chart-wrap"><canvas id="radar"></canvas></div>
    <div class="chart-key"><span><i class="k-on"></i>Counted for ${lowerName(P.name)}</span><span><i class="k-all"></i>All features</span></div>
    <h3>How it compares</h3>
    <table class="cmp"><tr><th>Feature</th><th class="n">Here</th><th class="n">${bodyName()}</th><th class="n">Match</th></tr>${rows}</table>
    <div class="muted small" style="margin-top:4px">${site.map_unit ? `<b>Mapped rock here:</b> ${site.map_unit} (${site.map_source}). ` : ""}Measured: steepness, roughness (Cesium World Terrain), temperature, sunlight and wind (NASA POWER 2001–2025; temperature adjusted to the site's height). <span class="approx map">map</span> = from a published geologic map. <span class="approx">est.</span> = estimated. Hover a tag or a ${bodyName()} value for its source.</div>
    ${site.used_for ? `<div class="muted small" style="margin-top:4px"><b>Used by agencies for:</b> ${site.used_for.map((p) => lowerName(PURPOSES[p].name)).join(", ")} (${site.used_note}).</div>` : ""}
    <h3>All five purposes</h3>
    <table>${allP}</table>
    <h3>Live check: NASA POWER</h3>
    <div id="power" class="power"><span class="muted small">Loading from NASA POWER…</span></div>
    ${site.access ? `<h3>Getting there</h3><div class="small">${site.access}</div>` : ""}
    <h3>What this place can't copy</h3>
    <div class="badges">${limits}</div>`;

  if (keepChart) box.querySelector(".chart-wrap").replaceWith(keepChart);
  drawRadar(s, !!keepChart);
  state.chartSite = id;
  loadPower(site);
  if (fly) flyToSite(site);
}

// Plain-words reason for a score: the features that carry it and the ones that hurt it most
function explain(r) {
  const t = state.target, v = siteVals(r.site, t.body), P = PURPOSES[state.purpose];
  const fs = activeFactors().map((f) => ({ f, sc: r.s[f.key], w: state.weights[f.key] }));
  const name = (f) => (f.short || f.label).toLowerCase();
  const desc = ({ f }) => {
    if (f.kind) return `${name(f)} (${catText(f, r.site).toLowerCase()} vs ${catText(f, t).toLowerCase()})`;
    if (f.key === "temp_swing_C" && P.coldTemp) return `ground cold enough to keep ice (${fmtVal(f, v.air_temp_C)} average; below 0 is best)`;
    return `${name(f)} (${fmtVal(f, v[f.key])} vs ${fmtVal(f, t[f.key])}${outsideEarth(f.key, t) ? ", scored within Earth's range" : ""})`;
  };
  const good = fs.filter((x) => x.sc >= 0.7).sort((a, b) => b.w * b.sc - a.w * a.sc).slice(0, 3);
  const bad = fs.filter((x) => x.sc < 0.4).sort((a, b) => b.w * (1 - b.sc) - a.w * (1 - a.sc)).slice(0, 2);
  return (good.length ? `<b>Matches on</b> ${good.map(desc).join("; ")}.` : "<b>No feature matches closely.</b>") +
    (bad.length ? ` <b>Misses on</b> ${bad.map(desc).join("; ")}.` : "");
}

// Check: how many of the top 10 stay when any single weight is moved by ±25%
const stabCache = new Map();
function stability() {
  const key = [state.target.id, state.purpose, FACTORS.map((f) => state.weights[f.key]).join()].join("|");
  if (stabCache.has(key)) return stabCache.get(key);
  const top = (w) => state.sites.map((s) => ({ id: s.id, ...scoreSite(s, state.target, state.purpose, w) }))
    .filter((x) => x.asi != null).sort((a, b) => b.asi - a.asi).slice(0, 10).map((x) => x.id);
  const base = new Set(top(state.weights));
  let ov = 0, n = 0;
  for (const f of activeFactors()) for (const m of [0.75, 1.25]) {
    ov += top({ ...state.weights, [f.key]: state.weights[f.key] * m }).filter((id) => base.has(id)).length; n++;
  }
  const val = n ? ov / n : 10;
  if (stabCache.size > 200) stabCache.clear();
  stabCache.set(key, val);
  return val;
}

// Radar with two layers: grey-slate = every feature (context), accent = only the features this purpose counts.
// Every axis label shows its match value; the counted ones are bold and in the accent colour.
function radarData(s) {
  const fs = shownFactors();
  const on = fs.map((f) => (state.weights[f.key] || 0) > 0);
  return {
    on,
    labels: fs.map((f) => [fName(f), `${Math.round(s[f.key] * 100)}%`]),
    all: fs.map((f) => s[f.key]),
    counted: fs.map((f, i) => (on[i] ? s[f.key] : null)),
  };
}
function drawRadar(s, reuse) {
  const d = radarData(s);
  state.radarOn = d.on;
  if (reuse && state.chart) {
    state.chart.data.labels = d.labels;
    state.chart.data.datasets[0].data = d.counted;
    state.chart.data.datasets[1].data = d.all;
    state.chart.update("none");
    return;
  }
  if (state.chart) state.chart.destroy();
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const accent = v("--accent"), ctx = v("--ctx"), text = v("--text"), muted = v("--muted");
  const on = (i) => state.radarOn[i];
  state.chart = new Chart(document.getElementById("radar"), {
    type: "radar",
    data: {
      labels: d.labels,
      datasets: [
        { label: "Counted for this purpose", data: d.counted, spanGaps: true, order: 0,
          backgroundColor: v("--accent-soft"), borderColor: accent, borderWidth: 2,
          pointBackgroundColor: accent, pointBorderColor: accent, pointRadius: 3.5, pointStyle: "rect" },
        { label: "All features", data: d.all, order: 1,
          backgroundColor: v("--ctx-soft"), borderColor: ctx, borderWidth: 1.25, borderDash: [4, 3],
          pointBackgroundColor: ctx, pointBorderColor: ctx, pointRadius: 2.5 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      layout: { padding: 2 },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: (c) => [].concat(c[0].label)[0],
        label: (c) => ` ${c.dataset.label}: ${Math.round(c.raw * 100)}% match`,
      } } },
      scales: {
        r: {
          min: 0, max: 1, ticks: { display: false, stepSize: 0.25 },
          grid: { color: v("--border") }, angleLines: { color: v("--border") },
          pointLabels: {
            color: (c) => (on(c.index) ? accent : muted),
            font: (c) => ({ size: 11.5, family: "Inter", weight: on(c.index) ? "600" : "400" }),
          },
        },
      },
    },
  });
}

// ---------- NASA POWER (live check of the stored numbers) ----------
// Docs: https://power.larc.nasa.gov/docs/services/api/temporal/climatology/
// T2M_RANGE / TS_RANGE are average daily ranges (air / ground surface); ALLSKY vs CLRSKY gives cloudiness.
async function loadPower(site) {
  const box = () => document.getElementById("power");
  let data = state.powerCache.get(site.id);
  if (!data) {
    const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,T2M_RANGE,TS_RANGE,WS10M,ALLSKY_SFC_SW_DWN,CLRSKY_SFC_SW_DWN&community=RE&longitude=${site.lon}&latitude=${site.lat}&format=JSON`;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(to);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      const p = j?.properties?.parameter;
      if (!p) throw new Error("unexpected response");
      const fill = j?.header?.fill_value ?? -999;
      const g = (k) => (p[k] && p[k].ANN !== fill ? p[k].ANN : null);
      data = { t2m: g("T2M"), cellElev: j?.geometry?.coordinates?.[2], air: g("T2M_RANGE"), ground: g("TS_RANGE"), wind: g("WS10M"),
        sky: g("ALLSKY_SFC_SW_DWN") && g("CLRSKY_SFC_SW_DWN") ? g("ALLSKY_SFC_SW_DWN") / g("CLRSKY_SFC_SW_DWN") : null,
        period: j?.header?.range || "" };
      state.powerCache.set(site.id, data);
    } catch (err) {
      console.warn("NASA POWER request failed:", err);
      if (state.selected === site.id && box())
        box().innerHTML = `<span class="muted small">NASA POWER isn't reachable right now (${err.message}). The stored values above still work.</span>`;
      return;
    }
  }
  if (state.selected !== site.id || !box()) return;
  const f1 = (v, u) => (v == null ? "—" : v.toFixed(1) + " " + u);
  const yrs = (data.period.match(/\((.*)\)/) || [])[1] || data.period;
  box().innerHTML = `<div class="live">NASA POWER · live</div>
    <table>
      <tr><td>Average air temperature<span class="muted small" style="display:block">at the cell's average height${Number.isFinite(data.cellElev) ? ` (${Math.round(data.cellElev)} m)` : ""}</span></td><td class="n">${f1(data.t2m, "°C")}</td></tr>
      ${Number.isFinite(data.cellElev) && data.t2m != null ? `<tr><td>Adjusted to this site's height<span class="muted small" style="display:block">${Math.round(site.elev_m)} m, −6.5 °C per km</span></td><td class="n">${f1(data.t2m - 0.0065 * (site.elev_m - data.cellElev), "°C")}</td></tr>` : ""}
      <tr><td>Daily swing: air / ground</td><td class="n">${f1(data.air, "")} / ${f1(data.ground, "°C")}</td></tr>
      <tr><td>Average wind</td><td class="n">${f1(data.wind, "m/s")}</td></tr>
      <tr><td>Sunlight getting through clouds</td><td class="n">${data.sky == null ? "—" : Math.round(data.sky * 100) + "%"}</td></tr>
    </table>
    <div class="muted small" style="margin-top:4px">Averaged over a ~50 km area, ${yrs}.</div>`;
}

// ---------- 3D region + "what if" sliders ----------
// The sliders edit this place's measured numbers (the categories stay as they are). Only sliders for features the
// current purpose counts can move the match score; the others are dimmed and only change the 3D view.
// ISRU scores temperature by the yearly average (cold ground keeps ice), so it gets an average-temperature slider.
const AIR_TEMP = { key: "air_temp_C", label: "Average temperature", short: "Avg. temp.", unit: "°C", range: [-40, 40],
  help: "Mean yearly air temperature. For resource prospecting, below 0 °C scores best (ground stays frozen)." };
const WI_ALL = [...NUM_FACTORS, AIR_TEMP];
FKEY.air_temp_C = AIR_TEMP;
function wiFactors() {
  const cold = PURPOSES[state.purpose].coldTemp;
  return NUM_FACTORS.filter((f) => !(f.mars && state.target.body !== "mars")).map((f) => (cold && f.key === "temp_swing_C" ? AIR_TEMP : f));
}
const wiCounted = (f) => (state.weights[f.key === "air_temp_C" ? "temp_swing_C" : f.key] || 0) > 0;
const pickValues = (site) => siteVals(site, state.target.body);
// Share of 100 m cells at or under 15° if slopes follow a half-normal spread with this mean (a simple model)
const gentleShare = (mean) => { if (mean <= 0.01) return 1; const sig = mean * Math.sqrt(Math.PI / 2); return erf(15 / (sig * Math.SQRT2)); };
function erf(x) { const t = 1 / (1 + 0.3275911 * x); return 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); }
// The numbers to score in "what if": the edited values, plus the filter measures that follow from steepness
function whatIfVals(site) {
  const real = pickValues(site), v = { ...real, ...state.whatif };
  if (Math.abs(v.slope_deg - real.slope_deg) > 1e-6) {
    const k = v.slope_deg / Math.max(0.05, real.slope_deg);
    v.slope_2km_deg = real.slope_2km_deg * k;
    v.flat_frac = clamp(real.flat_frac + gentleShare(v.slope_deg) - gentleShare(real.slope_deg), 0, 1);
  }
  return v;
}

// slider position (0..1000) <-> value
function toPos(f, v) {
  const [a, b] = f.range;
  if (f.logSlider) return (1000 * Math.log10(clamp(v, a, b) + 1)) / Math.log10(b + 1);
  return (1000 * (clamp(v, a, b) - a)) / (b - a);
}
function fromPos(f, p) {
  const [a, b] = f.range;
  if (f.logSlider) return Math.pow(10, (p / 1000) * Math.log10(b + 1)) - 1;
  return a + ((b - a) * p) / 1000;
}
function roundVal(f, v) {
  if (f.step) return Math.round(v / f.step) * f.step;
  if (v < 10) return Math.round(v * 10) / 10;
  return Math.round(v);
}

function renderWhatIf(rebuild) {
  const box = document.getElementById("whatifSliders");
  const site = state.sites.find((s) => s.id === state.selected);
  if (!site || !state.whatif) return;
  const fs = wiFactors();
  const sig = fs.map((f) => f.key + (wiCounted(f) ? "+" : "-")).join() + state.purpose;
  if (rebuild || box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    const P = PURPOSES[state.purpose];
    box.innerHTML = `<div class="whatif-legend">Drag to change this place. <i></i>marks the ${bodyName()} value. Dimmed sliders aren't counted for ${lowerName(P.name)}: they only change the 3D view.</div>` +
      fs.map((f) => `<div class="wi${wiCounted(f) ? "" : " uncounted"}" data-k="${f.key}" title="${wiCounted(f) ? f.help : `Not counted for ${lowerName(P.name)}. ${f.help}`}">
        <span class="wi-name">${f.short || f.label}</span>
        <span class="track"><input type="range" min="0" max="1000" step="1" data-k="${f.key}" aria-label="${f.label}"><span class="tgt"></span></span>
        <span class="wv"></span></div>`).join("");
  }
  const real = pickValues(site);
  for (const f of fs) {
    const row = box.querySelector(`.wi[data-k="${f.key}"]`);
    const v = state.whatif[f.key];
    const inp = row.querySelector("input");
    inp.value = toPos(f, v);
    inp.style.setProperty("--p", `${toPos(f, v) / 10}%`);
    const tv = f.key === "air_temp_C" ? 0 : state.target[f.key]; // ISRU: the line marks 0 °C, where the score drops
    const tgt = row.querySelector(".tgt");
    tgt.hidden = !Number.isFinite(tv);
    if (Number.isFinite(tv)) tgt.style.left = (toPos(f, tv) / 10) + "%";
    row.querySelector(".wv").textContent = fmtVal(f, roundVal(f, v));
    row.classList.toggle("changed", Math.abs(toPos(f, v) - toPos(f, real[f.key])) > 4);
  }
  updateWhatIfScore();
  if (window.Region3D) window.Region3D.setValues({ ...state.whatif, coldMode: coldMode() }, { ...site, ...real });
}

function updateWhatIfScore() {
  const site = state.sites.find((s) => s.id === state.selected);
  if (!site) return;
  const b = scoreSite(site, state.target, state.purpose, state.weights);
  const a = scoreSite(site, state.target, state.purpose, state.weights, whatIfVals(site));
  const el = document.getElementById("whatifScore");
  const T = (x) => (x.asi == null ? "fails filter" : x.asi.toFixed(0));
  el.innerHTML = T(a) === T(b)
    ? `Match ${T(b)}`
    : `Match ${T(b)}<span class="arrow">→</span><span class="${(a.asi ?? -1) > (b.asi ?? -1) ? "up" : ""}">${T(a)}</span>`;
}

// Highlight whichever view the sliders show: the real place, the target values, or neither (custom)
function setWhatIfMode(mode) {
  for (const [id, m] of [["wiReset", "real"], ["wiTarget", "target"]]) {
    const b = document.getElementById(id);
    b.classList.toggle("primary", mode === m);
    b.setAttribute("aria-pressed", String(mode === m));
  }
}

function initWhatIf() {
  document.getElementById("whatifSliders").addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (!k || !state.whatif) return;
    const f = FKEY[k];
    state.whatif[k] = roundVal(f, fromPos(f, +e.target.value));
    setWhatIfMode("custom");
    renderWhatIf(false);
  });
  document.getElementById("wiReset").onclick = () => {
    const site = state.sites.find((s) => s.id === state.selected);
    if (site) { setWhatIfMode("real"); animateWhatIf(pickValues(site)); }
  };
  document.getElementById("wiTarget").onclick = () => {
    const site = state.sites.find((s) => s.id === state.selected);
    if (!site) return;
    setWhatIfMode("target");
    const to = pickValues(site);
    for (const f of NUM_FACTORS) if (!(f.mars && state.target.body !== "mars") && Number.isFinite(state.target[f.key])) to[f.key] = clamp(state.target[f.key], f.range[0], f.range[1]);
    if (state.target.ice_level >= 3) to.air_temp_C = Math.min(to.air_temp_C, -8);
    animateWhatIf(to);
  };
  document.getElementById("spanSeg").onclick = (e) => {
    const b = e.target.closest("button[data-span]");
    if (!b) return;
    state.span = +b.dataset.span;
    document.querySelectorAll("#spanSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const site = state.sites.find((s) => s.id === state.selected);
    if (site) loadRegion(site);
    syncUrl();
  };
}

// Smoothly slide all values (in slider space) to a new set
let animId = 0;
function animateWhatIf(to) {
  const from = { ...state.whatif }, id = ++animId, t0 = performance.now(), dur = 1100;
  const step = (now) => {
    if (id !== animId) return;
    const k = clamp((now - t0) / dur, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    for (const f of WI_ALL) {
      const p = toPos(f, from[f.key]) + (toPos(f, to[f.key]) - toPos(f, from[f.key])) * e;
      state.whatif[f.key] = k === 1 ? to[f.key] : roundVal(f, fromPos(f, p));
    }
    if (k === 1) Object.assign(state.whatif, to);
    renderWhatIf(false);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Elevation grid around the site: real Cesium World Terrain when available, otherwise illustrative.
const GRID = 81;
async function regionHeights(site, spanKm) {
  const key = `${site.id}:${spanKm}`;
  if (state.regionCache.has(key)) return state.regionCache.get(key);
  let out = null;
  if (hasTerrain) await terrainReady;
  if (hasTerrain) {
    try {
      const dLat = spanKm / 111.32;
      const dLon = spanKm / (111.32 * Math.max(0.1, Math.cos((site.lat * Math.PI) / 180)));
      const pts = [];
      for (let j = 0; j < GRID; j++)
        for (let i = 0; i < GRID; i++)
          pts.push(Cesium.Cartographic.fromDegrees(site.lon - dLon / 2 + (i * dLon) / (GRID - 1), site.lat + dLat / 2 - (j * dLat) / (GRID - 1)));
      const level = spanKm <= 5 ? 13 : spanKm <= 15 ? 12 : 10;
      await Cesium.sampleTerrain(viewer.terrainProvider, level, pts);
      const hs = pts.map((p) => p.height);
      const good = hs.filter((h) => Number.isFinite(h));
      if (good.length > hs.length * 0.9) {
        const mean = good.reduce((a, b) => a + b, 0) / good.length;
        out = { heights: Float32Array.from(hs, (h) => (Number.isFinite(h) ? h : mean)), real: true };
      }
    } catch (e) { console.warn("Terrain sampling failed, using illustrative terrain", e); }
  }
  if (!out) out = { heights: proceduralHeights(site, spanKm), real: false };
  out.spanM = spanKm * 1000;
  out.n = GRID;
  if (out.real || !hasTerrain) state.regionCache.set(key, out); // don't cache a temporary fallback
  return out;
}


// Illustrative terrain shaped by the site's slope and roughness (used when no real elevation is available)
function proceduralHeights(site, spanKm) {
  let seed = [...site.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const waves = Array.from({ length: 7 }, () => [rnd() * 1.4 + 0.3, rnd() * 1.4 + 0.3, rnd() * 6.28, rnd() * 6.28, rnd() * 0.5 + 0.5]);
  const relief = 20 + (site.rough_m || 5) * 4 + (site.slope_deg || 1) * 15;
  const h = new Float32Array(GRID * GRID);
  for (let j = 0; j < GRID; j++)
    for (let i = 0; i < GRID; i++) {
      const x = (i / (GRID - 1)) * 10, y = (j / (GRID - 1)) * 10;
      let z = 0;
      for (const [fx, fy, px, py, a] of waves) z += a * Math.sin(fx * x + px) * Math.cos(fy * y + py);
      z *= relief * 0.25;
      if (site.geology === "impact") { const r = Math.hypot(x - 5, y - 5); z += relief * (-1.6 * Math.exp(-(r * r) / 3) + 0.9 * Math.exp(-((r - 2.4) ** 2) / 0.4)); }
      if (site.geology === "evaporite") z *= 0.3;
      h[j * GRID + i] = z;
    }
  return h;
}

async function loadRegion(site) {
  const token = ++state.regionToken;
  const regionEl = document.getElementById("region");
  regionEl.classList.remove("empty-region");
  document.getElementById("regionSub").textContent = `${site.name.split(" — ")[0]} · ${state.span} × ${state.span} km`;
  const status = document.getElementById("regionStatus");
  status.textContent = "Loading terrain…";
  const data = await regionHeights(site, state.span);
  if (token !== state.regionToken) return;
  status.textContent = data.real ? "Real elevation · Cesium World Terrain" : "Illustrative shape (no elevation data)";
  const go = () => { window.Region3D.setTerrain(data); window.Region3D.setValues({ ...state.whatif, coldMode: coldMode() }, { ...site, ...pickValues(site) }); };
  if (window.Region3D) go();
  else window.addEventListener("region3d-ready", go, { once: true });
}

// ---------- Rankings ----------
function renderDrawer() {
  const NP = state.passing;
  const pass = state.scored.filter((r) => r.asi != null);
  const beatsOf = (r) => (r.asi == null || NP < 2 ? 0 : Math.round((100 * (NP - r.rank)) / (NP - 1)));
  const known = state.scored.filter((r) => r.site.known_analog);
  const kp = known.filter((r) => r.asi != null);
  const med = (() => { const p = kp.map(beatsOf).sort((a, b) => a - b); return p.length ? p[Math.floor(p.length / 2)] : 0; })();
  const body = document.getElementById("drawerBody");
  const sum = document.getElementById("drawerSummary");
  const bar = (v) => `<span class="pct"><i style="width:${v}%;background:${cssColor(v)}"></i></span>`;
  const sel = (r) => (r.site.id === state.selected ? ' class="sel"' : "");
  const P = PURPOSES[state.purpose];
  if (state.tab === "top") {
    sum.innerHTML = `${NP} of ${state.scored.length} places pass the ${lowerName(P.name)} filters for ${shortTarget()}. <b>#1 is your best match.</b>${state.scored[0] && state.scored[0].asi != null ? `<span class="why-top">${explain(state.scored[0])}</span>` : ""}`;
    const LIMIT = isMobile() ? 10 : 60;
    const limited = !state.showAllRanks && state.scored.length > LIMIT;
    const rows = limited ? state.scored.slice(0, LIMIT) : state.scored;
    const toggle = state.scored.length > LIMIT
      ? `<button type="button" class="btn show-all" data-toggle-ranks>${limited ? `Show all ${state.scored.length} places` : `Show top ${LIMIT} only`}</button>`
      : "";
    body.innerHTML = `<table><tr><th class="n">#</th><th>Place</th><th class="n">Score</th></tr>
      ${rows.map((r) => `<tr data-id="${r.site.id}" class="${r.rank === 1 && r.asi != null ? "top1" : ""}${r.asi == null ? " failed" : ""}${r.site.id === state.selected ? " sel" : ""}">
        <td class="n">${r.asi == null ? "–" : r.rank}</td>
        <td><span class="nm"><span class="swatch" style="background:${relColor(r.asi)}"></span><span class="nm-text">${r.site.name}${r.rank === 1 && r.asi != null ? '<span class="pill best"><span class="pill-star" aria-hidden="true">★</span>Best match</span>' : ""}</span></span></td>
        <td class="n">${r.asi == null ? '<span class="muted small">fails</span>' : r.asi.toFixed(0)}</td></tr>`).join("")}</table>${toggle}`;
  } else if (state.tab === "validation") {
    const usedHere = kp.filter((r) => (r.site.used_for || []).includes(state.purpose));
    const medOf = (arr) => { const p = arr.map(beatsOf).sort((x, y) => x - y); return p.length ? p[Math.floor(p.length / 2)] : 0; };
    const mu = medOf(usedHere), st = stability();
    const note = !usedHere.length ? "" : mu >= 60 ? " Our score agrees with the experts here."
      : state.purpose === "habitat" ? " This is low, and we know why: existing habitat stations were chosen for isolation and access, while our habitat score measures the environment (temperature swing, sunlight, water)."
      : " This is low for this target: most training sites are volcanic, so they score best against volcanic targets and worse against others.";
    sum.innerHTML = `<b>Check 1: do experts agree?</b> ${usedHere.length
      ? `The ${usedHere.length} places agencies really use for ${lowerName(P.name)} (★) typically beat <b>${mu}%</b> of the places that pass.`
      : `None of the known sites is used for ${lowerName(P.name)}.`} All ${kp.length} known sites: ${med}%. A random pick would beat 50%.${note}
      <br><b>Check 2: is the ranking stable?</b> Moving any one weight by ±25% keeps <b>${st.toFixed(1)} of the top 10</b> places the same.`;
    const isU = (x) => (x.site.used_for || []).includes(state.purpose);
    const order = [...known].sort((x, y) => (isU(y) - isU(x)) || x.rank - y.rank);
    body.innerHTML = `<table><tr><th>Place</th><th class="n">Score</th><th class="n">Rank</th><th>Beats</th></tr>
      ${order.map((r) => `<tr data-id="${r.site.id}"${sel(r)} title="${(r.site.used_note || "").replace(/"/g, "&quot;")}"><td><span class="nm"><span class="swatch" style="background:${relColor(r.asi)}"></span>${isU(r) ? "★ " : ""}${r.site.name.split(" — ")[0]}</span></td>
        <td class="n">${scoreText(r.asi)}</td><td class="n">${r.asi == null ? "–" : r.rank}</td>
        <td class="n">${r.asi == null ? '<span class="muted small">fails filter</span>' : bar(beatsOf(r)) + beatsOf(r) + "%"}</td></tr>`).join("")}</table>`;
  } else {
    const cand = pass.filter((r) => !r.site.known_analog).slice(0, 10);
    sum.innerHTML = `The 10 best-matching places that space agencies haven't used yet.`;
    body.innerHTML = `<table><tr><th class="n">#</th><th>Place</th><th class="n">Score</th><th class="n">Rank</th></tr>
      ${cand.map((r, i) => `<tr data-id="${r.site.id}"${sel(r)}><td class="n">${i + 1}</td>
        <td><span class="nm"><span class="swatch" style="background:${relColor(r.asi)}"></span>${r.site.name}</span><span class="muted small">${r.site.country || ""}</span></td>
        <td class="n">${r.asi.toFixed(0)}</td><td class="n">${r.rank}</td></tr>`).join("")}</table>`;
  }
}

function initDrawer() {
  document.querySelectorAll(".tab").forEach((b) =>
    (b.onclick = () => {
      state.tab = b.dataset.tab;
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
      renderDrawer();
    })
  );
  document.getElementById("drawerBody").onclick = (e) => {
    if (e.target.closest("[data-toggle-ranks]")) {
      const wasAll = state.showAllRanks;
      state.showAllRanks = !state.showAllRanks;
      renderDrawer();
      if (wasAll) document.getElementById("drawer").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    selectSite(tr.dataset.id);
    // on phones the rankings sit below the details, so bring the details into view
    if (isMobile()) document.getElementById("right").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  window.matchMedia("(max-width: 860px)").addEventListener("change", renderDrawer);
}

// ---------- Panel toggles, theme, help ----------
const hidden = { left: false, drawer: false, right: false, region: false };

function syncPanels() {
  for (const k of Object.keys(hidden)) document.getElementById(k).classList.toggle("hidden", hidden[k]);
  document.querySelectorAll("[data-panel]").forEach((b) => b.setAttribute("aria-pressed", String(!hidden[b.dataset.panel])));
  if (viewer) layoutGlobe();
}

function initChrome() {
  document.querySelectorAll("[data-panel]").forEach((b) =>
    (b.onclick = () => { hidden[b.dataset.panel] = !hidden[b.dataset.panel]; syncPanels(); })
  );
  document.getElementById("themeToggle").onclick = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try { localStorage.setItem("aa-theme", next); } catch (e) {}
    Chart.defaults.color = getComputedStyle(root).getPropertyValue("--muted").trim();
    state.chartSite = null; // rebuild the chart in the new colours
    tuneImagery();
    if (state.selected) renderDetail(state.selected, false);
  };

  const help = document.getElementById("help");
  document.getElementById("helpFactors").innerHTML = FACTORS.map((f) => `<div><b>${f.label}.</b> ${f.help}</div>`).join("");
  document.getElementById("helpBtn").onclick = () => { help.hidden = false; document.getElementById("helpClose").focus(); };
  document.getElementById("helpClose").onclick = () => (help.hidden = true);
  help.onclick = (e) => { if (e.target === help) help.hidden = true; };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") help.hidden = true;
    if (e.key === "?" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) help.hidden = !help.hidden;
  });
  document.getElementById("region").classList.add("empty-region");
  document.getElementById("siteDetail").addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (b) selectSite(b.dataset.goto);
  });
  window.addEventListener("resize", () => viewer && layoutGlobe());
  document.getElementById("shareBtn").onclick = copyLink;
  document.getElementById("creditsLink").onclick = () => {
    help.hidden = false;
    document.getElementById("credits").scrollIntoView({ block: "start" });
    document.getElementById("helpClose").focus({ preventScroll: true });
  };
  syncPanels();
}

// ---------- Boot ----------
(async function main() {
  const startHash = readHash(); // read before anything rewrites the URL
  let targets, sites;
  try {
    const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });
    [targets, sites] = await Promise.all([get("data/targets.json"), get("data/sites.json")]);
  } catch (e) {
    console.error(e);
    showLoading("Couldn't load the site data. Check your connection and refresh the page.", true);
    return;
  }
  state.targets = targets;
  state.sites = sites;
  computeEarthRanges();
  Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
  initGlobe();
  initLeft();
  initDrawer();
  initWhatIf();
  initChrome();
  layoutGlobe();
  const flew = applyHash(startHash);
  if (!flew) requestAnimationFrame(() => homeView(state.scored[0].site.lon, state.scored[0].site.lat));
  urlReady = true;
  syncUrl();
  window.addEventListener("hashchange", () => { if (location.hash !== stateToHash()) applyHash(readHash()); });
})();
