"""Merge the real data fetched in the browser (NASA POWER climatology 2001-2025 and
Cesium World Terrain slope/roughness) into data/sites.json.

Usage: python3 tools/merge_data.py
Inputs: data/sites_base.json, data/raw/chunk1..3.json
       data/raw/power_cell_elev.json (tools/fetch_power_elev.py: POWER grid-cell elevation)
Row format in chunks: [id, T2M, T2M_RANGE, TS_RANGE, WS10M, WS10M_MAX, ALLSKY, CLRSKY,
                       elev_m, slope_deg, frac_le15, slope_2km_deg, rough_m]
"""
import json, math, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
base = json.load(open(root / "data/sites_base.json", encoding="utf-8"))
rows = {}
for i in (1, 2, 3):
    for r in json.load(open(root / f"data/raw/chunk{i}.json")):
        rows[r[0]] = r[1:]

# POWER's T2M is the air temperature at its ~50 km grid cell's average height, not at the site.
# Correct it to the site's own height with the standard atmosphere lapse rate (6.5 °C per km).
# Checks: Death Valley 19.1 -> 25.2 °C (Furnace Creek normal ~25), Dallol 26.0 -> 33.5 (~34.5),
# Mauna Kea summit 20.9 -> -2.0 (summit ~0-3), Dry Valleys -27.2 -> -21.9 (Lake Vanda ~-20).
LAPSE_C_PER_M = 0.0065
cell_elev = json.load(open(root / "data/raw/power_cell_elev.json"))

def daylight_fraction(lat):
    """Share of the year the Sun is above the horizon (refraction included), from latitude."""
    phi = math.radians(lat)
    h0 = math.radians(-0.833)
    total = 0.0
    for d in range(365):
        dec = math.radians(23.44) * math.sin(2 * math.pi * (284 + d) / 365)
        c = (math.sin(h0) - math.sin(phi) * math.sin(dec)) / (math.cos(phi) * math.cos(dec))
        if c <= -1: total += 1.0          # midnight sun
        elif c >= 1: total += 0.0         # polar night
        else: total += math.acos(c) / math.pi
    return total / 365

def ice_level(maat, geology):
    """0-4 ground-ice level estimated from mean annual air temperature (permafrost rule of thumb)."""
    if geology == "ice": return 4
    if maat <= -8: return 4   # continuous permafrost
    if maat <= -4: return 3   # discontinuous
    if maat <= -1: return 2   # sporadic
    if maat <= 0: return 1    # isolated patches
    return 0

def on_ice(s, rough, slope, t_site):
    """Sampled polar points that fall on an ice sheet, ice cap or frozen fjord instead of bare ground.
    The land mask counts ice as land, but the terrain gives it away: glassy smooth over the whole 2 km box.
    (Found: north Greenland ice sheet / fjords in the Peary Land box, Austfonna ice cap on Svalbard.)"""
    return s["kind"] == "sampled" and abs(s["lat"]) > 60 and t_site < -5 and rough < 0.5 and slope < 1.5

out, missing = [], []
for s in base:
    r = rows.get(s["id"])
    if r is None:
        missing.append(s["id"]); continue
    t2m, t2m_rng, ts_rng, ws, ws_max, allsky, clrsky, elev, slope, frac15, slope2k, rough = r
    cloud = allsky / clrsky if clrsky else 1
    cell = cell_elev[s["id"]][0]
    t_site = round(t2m - LAPSE_C_PER_M * (elev - cell), 2)
    if on_ice(s, rough, slope, t_site):
        s.update({"geology": "ice", "surface": "loose", "minerals": ["ice"],
                  "description": s["description"] + " This point falls on ice (ice sheet, ice cap or frozen fjord), not bare ground."})
    s.update({
        "elev_m": round(elev),
        "slope_deg": slope,             # mean slope, 100 m cells, 2 km box
        "flat_frac": frac15,            # share of 100 m cells at or under 15 degrees
        "slope_2km_deg": slope2k,       # tilt of the best-fit plane over 2 km
        "rough_m": rough,               # RMS height off that plane (m)
        "air_temp_C": t_site,           # mean annual air temperature at the site's height
        "air_temp_power_C": t2m,        # as POWER reports it, at the grid cell's height
        "power_cell_elev_m": round(cell),
        "air_swing_C": t2m_rng,         # mean daily air temperature range
        "surface_swing_C": ts_rng,      # mean daily ground-surface temperature range
        "wind_ms": ws,                  # mean 10 m wind
        "wind_max_ms": ws_max,
        "illum_pct": round(100 * daylight_fraction(s["lat"]) * min(cloud, 1), 1),
        "ice_level": ice_level(t_site, s["geology"]),
        "measured": ["elev_m", "slope_deg", "flat_frac", "slope_2km_deg", "rough_m",
                     "air_temp_C", "air_swing_C", "surface_swing_C", "wind_ms", "illum_pct"],
    })
    s["estimated"] = sorted(set(s.get("estimated", [])) | {"ice_level"})
    out.append(s)


# ---------- Geology from a real geologic map (Macrostrat, fetched in the browser) ----------
# data/raw/geology.json: "u" = unique results "class|rock types|mineral codes|source id|scale", "ix" = one index per site.
G = json.load(open(root / "data/raw/geology.json"))
SRC = {r[0]: r for r in G["S"]}
CLS = {"b": "basalt", "v": "volcanic_other", "p": "plutonic_metamorphic", "c": "carbonate", "e": "evaporite",
       "u": "unconsolidated", "s": "sedimentary", "i": "ice"}
FAMILY = {"basalt": "volcanic", "volcanic_other": "volcanic", "plutonic_metamorphic": "crystalline",
          "sedimentary": "sedimentary", "unconsolidated": "sedimentary", "evaporite": "sedimentary",
          "carbonate": "sedimentary", "ice": "ice", "impact": "impact"}
MIN = {"M": "mafic", "P": "plagioclase", "S": "sulfate", "H": "chloride", "C": "carbonate", "Y": "clay", "F": "iron_oxide"}
GENERIC = {"sedimentary", "siliciclastic", "metamorphic", "igneous", "plutonic", "volcanic", "volcaniclastic"}
SCALE = {"l": "large", "m": "medium", "s": "small", "t": "tiny"}
FINE = {"sand", "silt", "clay", "mud", "loess"}
stats = {"map": 0, "map_family": 0, "estimate": 0, "agree": 0, "compared": 0}
for s, i in zip(out, map(int, G["ix"].split())):
    rec = G["u"][i]
    est = set(s["estimated"])
    s["geology_src"] = "estimate"
    if s["geology"] == "ice":            # already found to be on ice from the terrain and temperature
        s["geology_src"] = "terrain"; est.discard("geology"); est.discard("minerals")
        s["estimated"] = sorted(est); stats.setdefault("terrain", 0); stats["terrain"] += 1
        continue
    if rec:
        code, rocks, mins, sid, sc = rec.split("|")
        cls = CLS[code]
        names = [x.strip() for x in rocks.split(",")]
        if cls == "volcanic_other" and "mafic" in names and "andesite" not in names: cls = "basalt"
        specific = any(n not in GENERIC for n in names)
        src = SRC[int(sid)]
        s["map_unit"] = rocks
        s["map_source"] = f"{src[1]}{' (' + src[3] + ')' if src[3] else ''}, {SCALE[sc]} scale, via Macrostrat"
        stats["compared"] += 1
        same_family = FAMILY[cls] == FAMILY[s["geology"]]
        stats["agree"] += same_family
        named = s["kind"] == "named"
        if named:
            # named sites keep their hand-checked class; the map confirms it (or not)
            if same_family: s["geology_src"] = "map_family"; est.discard("geology")
        elif specific or cls == "ice":
            s["geology"] = cls; s["geology_src"] = "map"; est.discard("geology")
            s["minerals"] = [MIN[c] for c in mins]; s["minerals_src"] = "map"; est.discard("minerals")
            if cls == "unconsolidated":
                s["surface"] = "loose" if all(n in FINE for n in names) else "mixed"
            if cls == "ice": s["ice_level"] = 4; s["surface"] = "loose"; s["minerals"] = ["ice"]
        elif same_family:
            s["geology_src"] = "map_family"; est.discard("geology")
        else:
            s["geology"] = cls; s["geology_src"] = "map"; est.discard("geology")
    stats[s["geology_src"]] = stats.get(s["geology_src"], 0) + 1
    s["estimated"] = sorted(est)
print("geology:", stats)

# ---------- What space agencies actually use the known sites for (for the validation check) ----------
USED = {
    "haughton": (["eva", "mobility", "habitat"], "Haughton-Mars Project and FMARS station"),
    "devon": (["eva", "mobility", "habitat"], "Haughton-Mars Project traverses"),
    "mdrs": (["habitat", "eva"], "Mars Desert Research Station crews"),
    "blackpoint": (["mobility", "eva"], "NASA Desert RATS rover and spacewalk tests"),
    "maunakea": (["isru", "mobility"], "NASA/PISCES ISRU field tests (RESOLVE)"),
    "yungay": (["mobility", "isru"], "NASA rover and drill tests (LITA, ARADS)"),
    "riotinto": (["isru"], "MARTE drilling experiment"),
    "dryvalleys": (["isru"], "IceBreaker drill tests in ice-cemented ground"),
    "kilbourne": (["eva"], "Apollo crew training; RIS4E field science"),
    "meteorcrater": (["eva"], "Apollo crew geology training"),
    "iceland": (["eva", "mobility"], "Apollo training; SAND-E rover tests"),
    "lanzarote": (["eva"], "ESA PANGAEA astronaut geology training"),
    "deathvalley": (["mobility"], "Mars rover mobility tests"),
    "cotm": (["eva"], "NASA FINESSE and BASALT field programs"),
    "svalbard": (["eva"], "AMASE instrument and procedure tests"),
    "spcrater": (["eva", "mobility"], "Desert RATS / Apollo training area"),
}
for s in out:
    if s.get("known_analog") and s["id"] in USED:
        s["used_for"], s["used_note"] = USED[s["id"]]
print("known:", [(s["id"], s.get("used_for")) for s in out if s.get("known_analog")])

json.dump(out, open(root / "data/sites.json", "w", encoding="utf-8"), indent=0, ensure_ascii=False)
print(len(out), "sites written; missing:", missing)
