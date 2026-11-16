"""Build data/sites_base.json: named analog sites + points sampled across barren analog regions.

Geology, surface material and mineral groups here are ESTIMATES (from each site's or region's
published general geology), flagged "estimated" until replaced by GLiM / EMIT extractions.
Measured values (temperature, wind, sunlight, terrain) are added later by tools/fetch_data.js.
"""
import json, math, random, sys
from global_land_mask import globe

random.seed(2026)
OLD = json.load(open(sys.argv[1]))  # last night's sites.json (names, coords, descriptions, access)

# id: (geology, surface bin, mineral groups)
NAMED = {
 "yungay": ("evaporite", "loose", ["sulfate", "chloride", "iron_oxide"]),
 "haughton": ("impact", "mixed", ["carbonate", "sulfate", "ice"]),
 "devon": ("carbonate", "mixed", ["carbonate", "ice"]),
 "deathvalley": ("evaporite", "mixed", ["chloride", "sulfate", "carbonate"]),
 "dryvalleys": ("plutonic_metamorphic", "mixed", ["mafic", "chloride", "sulfate", "ice"]),
 "maunakea": ("basalt", "mixed", ["mafic", "clay", "iron_oxide"]),
 "riotinto": ("sedimentary", "mixed", ["sulfate", "iron_oxide"]),
 "iceland": ("basalt", "mixed", ["mafic", "clay"]),
 "lanzarote": ("basalt", "bedrock", ["mafic"]),
 "mdrs": ("sedimentary", "mixed", ["clay", "sulfate", "iron_oxide"]),
 "kilbourne": ("basalt", "mixed", ["mafic"]),
 "cotm": ("basalt", "bedrock", ["mafic"]),
 "dallol": ("evaporite", "mixed", ["sulfate", "chloride", "iron_oxide"]),
 "ertaale": ("basalt", "bedrock", ["mafic", "sulfate"]),
 "lut": ("sedimentary", "mixed", ["sulfate", "chloride", "iron_oxide"]),
 "uyuni": ("evaporite", "loose", ["chloride", "sulfate"]),
 "licancabur": ("volcanic_other", "mixed", ["mafic", "sulfate", "chloride"]),
 "namib": ("unconsolidated", "loose", ["iron_oxide", "carbonate"]),
 "qaidam": ("evaporite", "mixed", ["sulfate", "chloride", "clay"]),
 "changtang": ("sedimentary", "mixed", ["carbonate", "clay", "ice"]),
 "svalbard": ("basalt", "mixed", ["mafic", "carbonate", "ice"]),
 "tolbachik": ("basalt", "mixed", ["mafic", "sulfate"]),
 "pinacate": ("basalt", "mixed", ["mafic"]),
 "tindouf": ("sedimentary", "mixed", ["iron_oxide", "carbonate"]),
 "wadirum": ("sedimentary", "bedrock", ["iron_oxide"]),
 "lonar": ("impact", "mixed", ["mafic", "clay"]),
 "meteorcrater": ("impact", "mixed", ["carbonate", "iron_oxide"]),
 "spcrater": ("basalt", "mixed", ["mafic"]),
 "undara": ("basalt", "bedrock", ["mafic"]),
 "kazumura": ("basalt", "bedrock", ["mafic"]),
 "amboy": ("basalt", "mixed", ["mafic"]),
 "pilbara": ("plutonic_metamorphic", "bedrock", ["mafic", "iron_oxide"]),
 "axelheiberg": ("evaporite", "mixed", ["sulfate", "carbonate", "ice"]),
 "unionglacier": ("ice", "mixed", ["ice"]),
 "bayanzag": ("sedimentary", "mixed", ["iron_oxide", "carbonate"]),
 "hoggar": ("basalt", "bedrock", ["mafic", "iron_oxide"]),
 "richat": ("sedimentary", "bedrock", ["iron_oxide"]),
 "bluemesa": ("sedimentary", "mixed", ["clay", "iron_oxide"]),
 "monolake": ("carbonate", "mixed", ["carbonate"]),
 "salda": ("carbonate", "mixed", ["carbonate", "mafic"]),
}
EXTRA = [  # named sites added this session
 {"id": "blackpoint", "name": "Black Point Lava Flow", "country": "USA (Arizona)", "lat": 35.68, "lon": -111.48,
  "description": "A basalt lava flow north of Flagstaff where NASA ran its Desert RATS rover and spacewalk field tests, most recently in 2022.",
  "access": "Dirt roads from US-89, ~1 h from Flagstaff", "protected": False, "known_analog": True,
  "geo": ("basalt", "mixed", ["mafic"])},
]

# Barren analog regions: (name, country, [lon0, lat0, lon1, lat1], geology, surface, minerals)
REGIONS = [
 ("Atacama Desert core", "Chile", [-70.6, -26.5, -68.9, -19.5], "evaporite", "loose", ["sulfate", "chloride", "iron_oxide"]),
 ("Puna / Altiplano volcanic plateau", "Argentina / Bolivia / Chile", [-69.0, -27.0, -66.3, -19.0], "volcanic_other", "mixed", ["mafic", "chloride", "sulfate"]),
 ("Sahara — Hoggar volcanic massif", "Algeria / Chad", [4.5, 21.5, 7.5, 24.5], "basalt", "bedrock", ["mafic", "iron_oxide"]),
 ("Sahara — Tibesti", "Chad", [16.5, 19.5, 19.5, 22.0], "basalt", "bedrock", ["mafic", "iron_oxide"]),
 ("Sahara — Grand Erg Oriental", "Algeria / Tunisia", [6.0, 28.5, 9.5, 32.0], "unconsolidated", "loose", ["iron_oxide", "carbonate"]),
 ("Sahara — Tanezrouft reg", "Algeria / Mali", [-2.0, 20.0, 3.0, 25.0], "sedimentary", "mixed", ["iron_oxide", "carbonate"]),
 ("Sahara — Great Sand Sea", "Egypt / Libya", [24.0, 23.5, 28.0, 28.0], "unconsolidated", "loose", ["iron_oxide"]),
 ("Rub' al Khali (Empty Quarter)", "Saudi Arabia / Oman / UAE / Yemen", [46.0, 17.5, 55.0, 22.5], "unconsolidated", "loose", ["iron_oxide", "carbonate", "sulfate"]),
 ("Arabian lava fields (harrats)", "Saudi Arabia", [38.5, 22.0, 41.0, 27.0], "basalt", "bedrock", ["mafic"]),
 ("Lut Desert", "Iran", [57.5, 29.0, 60.0, 32.0], "sedimentary", "mixed", ["sulfate", "chloride", "iron_oxide"]),
 ("Taklamakan Desert", "China", [78.0, 37.5, 87.0, 40.5], "unconsolidated", "loose", ["carbonate", "sulfate"]),
 ("Qaidam Basin", "China", [90.0, 36.5, 96.0, 39.0], "evaporite", "mixed", ["sulfate", "chloride", "clay"]),
 ("Changtang (northern Tibetan Plateau)", "China", [80.0, 33.0, 90.0, 36.0], "sedimentary", "mixed", ["carbonate", "clay", "ice"]),
 ("Gobi Desert", "Mongolia / China", [100.0, 41.0, 110.0, 45.0], "sedimentary", "mixed", ["iron_oxide", "carbonate"]),
 ("Namib Desert", "Namibia", [14.0, -27.0, 15.6, -20.0], "unconsolidated", "loose", ["iron_oxide", "carbonate", "sulfate"]),
 ("Danakil / Afar", "Ethiopia / Eritrea", [39.8, 12.0, 42.0, 15.0], "basalt", "mixed", ["mafic", "sulfate", "chloride"]),
 ("Pilbara craton", "Australia", [117.0, -23.0, 121.0, -20.0], "plutonic_metamorphic", "bedrock", ["iron_oxide", "mafic"]),
 ("Simpson & Great Victoria deserts", "Australia", [128.0, -29.0, 138.0, -24.0], "unconsolidated", "loose", ["iron_oxide", "clay"]),
 ("Mojave & Death Valley basins", "USA", [-117.6, 34.2, -114.6, 37.0], "sedimentary", "mixed", ["carbonate", "sulfate", "mafic"]),
 ("Colorado Plateau canyonlands", "USA", [-112.0, 37.0, -109.0, 39.0], "sedimentary", "bedrock", ["iron_oxide", "clay", "sulfate"]),
 ("Snake River Plain lava fields", "USA", [-114.0, 43.0, -112.5, 43.8], "basalt", "bedrock", ["mafic"]),
 ("Iceland interior highlands", "Iceland", [-19.0, 64.3, -15.5, 65.5], "basalt", "mixed", ["mafic", "clay"]),
 ("Hawaii summit lava fields", "USA (Hawaii)", [-155.8, 19.2, -155.2, 19.9], "basalt", "bedrock", ["mafic"]),
 ("Kamchatka volcanic plateau", "Russia", [159.8, 55.4, 160.8, 56.1], "basalt", "mixed", ["mafic", "sulfate"]),
 ("Canadian High Arctic islands", "Canada", [-95.0, 74.5, -78.0, 80.0], "carbonate", "mixed", ["carbonate", "sulfate", "ice"]),
 ("Svalbard", "Norway", [11.0, 77.5, 27.0, 80.0], "sedimentary", "mixed", ["carbonate", "mafic", "ice"]),
 ("Peary Land (north Greenland)", "Greenland", [-40.0, 81.0, -20.0, 83.5], "sedimentary", "mixed", ["carbonate", "ice"]),
 ("McMurdo Dry Valleys", "Antarctica", [160.0, -78.5, 164.0, -76.8], "plutonic_metamorphic", "mixed", ["mafic", "chloride", "sulfate", "ice"]),
]

def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(d))

sites = []
for s in OLD:
    g, surf, mins = NAMED[s["id"]]
    sites.append({k: s[k] for k in ("id", "name", "country", "description", "lat", "lon", "access", "protected", "known_analog")}
                 | {"geology": g, "surface": surf, "minerals": mins, "kind": "named"})
for e in EXTRA:
    g, surf, mins = e.pop("geo")
    sites.append(e | {"geology": g, "surface": surf, "minerals": mins, "kind": "named"})

TOTAL = 500
n_sample = TOTAL - len(sites)
area = lambda b: (b[2] - b[0]) * (b[3] - b[1]) * math.cos(math.radians((b[1] + b[3]) / 2))
areas = [area(r[2]) for r in REGIONS]
# share by sqrt(area) so small volcanic fields still get several points, min 6 each
w = [math.sqrt(a) for a in areas]
alloc = [max(6, round(n_sample * x / sum(w))) for x in w]
while sum(alloc) > n_sample: alloc[alloc.index(max(alloc))] -= 1
while sum(alloc) < n_sample: alloc[alloc.index(min(alloc))] += 1

for (name, country, b, g, surf, mins), n in zip(REGIONS, alloc):
    span = max(b[2] - b[0], b[3] - b[1])
    min_km = max(4.0, 0.45 * math.sqrt(area(b) * 111 * 111 / n))
    got, tries = 0, 0
    while got < n and tries < 40000:
        tries += 1
        lat = random.uniform(b[1], b[3]); lon = random.uniform(b[0], b[2])
        if not globe.is_land(lat, lon): continue
        if any(km((lat, lon), (s["lat"], s["lon"])) < min_km for s in sites): 
            if tries < 30000: continue
        got += 1
        sites.append({"id": f"{name.split(' ')[0].lower().strip(chr(39))}-{len([s for s in sites if s.get('region') == name]) + 1}-{abs(round(lat*100))}{abs(round(lon*100))}",
                      "name": f"{name} · point {len([s for s in sites if s.get('region') == name]) + 1}",
                      "country": country, "region": name, "lat": round(lat, 3), "lon": round(lon, 3),
                      "description": f"A sampled point in the {name} analog region.",
                      "access": "", "protected": False, "known_analog": False,
                      "geology": g, "surface": surf, "minerals": mins, "kind": "sampled"})
    if got < n: print("short", name, got, n)

ids = [s["id"] for s in sites]
assert len(ids) == len(set(ids)), "duplicate ids"
for s in sites: s["estimated"] = ["geology", "surface", "minerals"]
json.dump(sites, open(sys.argv[2], "w"), indent=0)
print(len(sites), "sites;", sum(s["kind"] == "named" for s in sites), "named")
