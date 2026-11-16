# Analog Atlas: find Earth's Moon and Mars twins

**NASA Space Apps Challenge 2026.** Before astronauts and rovers go to the Moon or Mars, teams practise on Earth in
places that look and behave alike: *analogs*. Analog Atlas helps pick one. Choose a Moon or Mars target and what you
want to test there (landing, rover driving, resource prospecting, habitat or spacewalks), and the app scores
**500 places on Earth** against it. It uses measured terrain, climate and geologic-map data, and every estimated value is tagged
"est.".

- **Live site (earlier version):** https://analog-atlas.netlify.app
- **Source code (this version):** https://github.com/jingweizhao23/newspaceappsapps

A community project, not an official NASA product.

## What you can do

- **Pick a target**: 4 on the Moon (Artemis III south-pole region: Shackleton–de Gerlache ridge, Malapert Massif,
  Mons Mouton; Apollo 11's Mare Tranquillitatis) and 3 on Mars (Jezero Crater, Arcadia Planitia, Arsia Mons).
- **Pick a purpose**: each has its own pass/fail filters and feature weights. Fine-tune the weights with the sliders;
  the tick on each slider marks the default.
- **See the rankings**: *Top matches* ranks every place, *Reality check* shows how places agencies already use
  score, and *New ideas* lists the best places nobody uses yet. The best match is starred and ringed in gold on the globe.
- **Inspect a place**: its score and rank, a radar chart of every feature (the ones the purpose counts in blue, the
  rest in grey), a side-by-side table with the target's values and sources, all five purpose scores, and a live
  NASA POWER check of the stored climate numbers.
- **3D view and "what if"**: the real terrain around the site (4, 12 or 30 km), with a dashed square marking the
  2 km box the slope numbers come from. The sliders change one feature at a time and show how the land and score change.
- **Share a view**: the link button copies a URL that opens the same target, purpose, weights and site.
- Light and dark themes, and a stacked layout for phones.

## Run it

```bash
npx serve -l 3000 .
```

Open http://localhost:3000. There is no build step: the app is `index.html`, `app.js`, `region3d.js`, `style.css`
and the JSON files in `data/`. CesiumJS 1.120, Chart.js 4.4.1 and Three.js 0.160 load from jsDelivr.

The Cesium ion token in `app.js` only works on `localhost:3000` and `analog-atlas.netlify.app`. Anywhere else, or if
Cesium ion can't be reached, the app shows a notice and switches to the offline Natural Earth map and an illustrative
3D shape. If the site data can't load or the browser can't run WebGL, the loading card says what went wrong.

## How the score works

Each purpose is scored in three steps.

**1. Filters (pass/fail).** A place that fails gets no score for that purpose and shows as a grey dot.

| Purpose | Filter | Source |
|---|---|---|
| Landing & descent | mean slope < 10° (Moon) / ≤ 5° (Mars) | Moon: NASA Artemis III, < 10° over 100 m. Mars: team rule (MSL used ≤ 3° over 2–5 km) |
| Mobility & navigation | ≥ 70% of 100 m cells at ≤ 15° | NASA VIPER 15° design limit (the 70% share is our choice) |
| Resource prospecting & ISRU | ground ice, or at least one of the target's minerals | team rule |
| Habitat & shelter | none | |
| EVA & crew operations | tilt over 2 km < 20° | NASA Artemis EVA limit |

**2. Feature scores, 0–1.**
- Numbers score by closeness: `max(0, 1 − |site − target| / tolerance)`.
- Categories: same = 1, related = 0.5, different = 0 (geology pairs in `RELATED` in `app.js`; neighbouring surface bins = 0.5).
- Minerals: the share of the target's mineral groups found at the place.
- Ground ice: levels 0–4 map to 0 / 0.1 / 0.4 / 0.75 / 1 (none → continuous), then compared.
- For ISRU, the temperature feature uses mean air temperature instead: below 0 °C = 1, 0–10 °C = 0.5, above 10 °C = 0.

**3. Purpose score** = weighted sum of the feature scores, out of 100. Default weights and tolerances are in
`PURPOSES` in `app.js`.

**Off-Earth values.** Some target values are beyond anything on Earth: the Moon's surface swings ~200–300 °C between
day and night, Jezero's air swings ~55 °C (Earth's largest average daily air swing in our data is ~19 °C), and the
Shackleton ridge is sunlit 86% of the year (Earth tops out near 50%). Closeness can't work there, so these features are
scored against Earth's own range: the Earth place closest to the target gets 1, the furthest gets 0. The app tags
these values "off-Earth".

## The data

### Earth: measured (all 500 places)

| Field | Meaning | Source |
|---|---|---|
| `slope_deg` | mean slope on a 21 × 21 grid at 100 m (2 km box) | Cesium World Terrain |
| `flat_frac` | share of those cells at ≤ 15° | Cesium World Terrain |
| `slope_2km_deg` | tilt of the best-fit plane over 2 km | Cesium World Terrain |
| `rough_m` | RMS height off that plane | Cesium World Terrain |
| `elev_m` | height at the point | Cesium World Terrain |
| `air_temp_C` | mean yearly air temperature (T2M), adjusted to the site's height | NASA POWER 2001–2025 + Cesium World Terrain |
| `air_swing_C`, `surface_swing_C` | mean daily air / ground-surface temperature range (T2M_RANGE, TS_RANGE) | NASA POWER 2001–2025 |
| `wind_ms`, `wind_max_ms` | mean and maximum 10 m wind (WS10M, WS10M_MAX) | NASA POWER |
| `illum_pct` | yearly daylight share (from latitude) × all-sky ÷ clear-sky sunlight | NASA POWER + astronomy |

**Temperature height correction.** NASA POWER reports temperature at its ~50 km grid cell's *average* height, which can
be kilometres away from a site's own height (Mauna Kea: cell 636 m, summit 4,166 m, so POWER says 20.9 °C). We fetch
each cell's height and correct with the standard-atmosphere lapse rate, −6.5 °C per km. Checks against weather
records: Death Valley 25.2 °C (Furnace Creek normal ~25), Dallol 33.5 (~34.5), Mauna Kea summit −2.0 (~0–3),
Dry Valleys −21.9 (Lake Vanda ~−20). The raw values are kept in `air_temp_power_C` and `power_cell_elev_m`.

### Earth: from published geologic maps (tagged "map")

`geology` is read from the [Macrostrat](https://macrostrat.org/) geologic map service, which serves 29 published maps
for our points (USGS state maps, Surface Geology of Australia, Geological Map of Africa, Geological Map of South
America, GMNA and others). `geology_src` records how each value was set:

| `geology_src` | Places | Meaning |
|---|---|---|
| `map` | 266 | the map names a specific rock, and we use it |
| `map_family` | 213 | the map is broad (e.g. "sedimentary") but agrees with our regional class at rock-family level, so the finer regional class is kept |
| `terrain` | 8 | on ice, detected from terrain and temperature (see below) |
| `estimate` | 13 | no map support; regional estimate |

Our first regional guesses agreed with the maps at family level 74% of the time (365 of 491). Where `minerals_src`
is `map` (196 places), minerals are worked out from the mapped rocks (basalt → olivine/pyroxene + plagioclase,
shale/mudstone → clays, limestone → carbonates, gypsum/halite → sulfates/salts, iron formation → iron oxides).

**Points on ice.** 16 places are labelled ice. For 8 of them the geologic map shows a glacier. The other 8
(`geology_src: terrain`) are Union Glacier, a named site, plus seven sampled points in the Peary Land and Svalbard boxes that fall
on the Greenland ice sheet, the Austfonna ice cap or frozen fjords. The land mask counts ice as land, so
`merge_data.py` catches these by their terrain: polar, colder than −5 °C on average, and glassy-smooth over the
whole 2 km box.

### Earth: estimated (tagged "est.")

- `surface` (loose / mixed / bedrock) for most places, and `minerals` where the map is too broad.
- `ice_level`, from mean air temperature: ≤ −8 °C continuous, ≤ −4 discontinuous, ≤ −1 sporadic, ≤ 0 isolated.

Next steps to replace these: NASA EMIT for minerals, MODIS apparent thermal inertia for surface type, ESA Permafrost
CCI for ground ice.

### Moon and Mars targets

`data/targets.json` holds each target's values with a `sources` note per value (shown when you hover the value in
the app) and a `measured` list. Values not in `measured` are estimates from published mission results.

## Checking our own score (the Reality check tab)

**Check 1: do experts agree?** The 13 places agencies already use carry `used_for`, the purposes they really serve
(e.g. Dry Valleys for ISRU drilling tests, Black Point for Desert RATS rover and spacewalk tests). The app reports
what share of passing places they beat. With default weights:

| Purpose | Used places beat… | Notes |
|---|---|---|
| ISRU | 92–100% (68% for Tranquillitatis) | Dry Valleys is #1 for Arcadia Planitia |
| Mobility | 79–85% for Artemis ridge, Mons Mouton, Arsia Mons; 39–59% elsewhere | most training sites are volcanic, so they fit volcanic targets best |
| EVA | 74–91% for Artemis ridge, Mons Mouton, Arsia Mons; 30–58% elsewhere | same reason |
| Habitat | 4–18% | stations like MDRS and Haughton were chosen for isolation and access; our score measures the environment. We report this rather than tune it away |
| Landing | n/a | none of the known sites is used for landing tests |

**Check 2: is the ranking stable?** Each weight is moved ±25% and the top 10 recomputed. Across all 35 target ×
purpose combinations, 7.3–10 of the top 10 stay the same (about 9 on average).

## Known limits

- Roughness is the terrain model's RMS height, not rock cover: a 100 m grid can't see boulders.
- NASA POWER cells are ~50 km wide, so nearby sampled points can share climate values, and coastal points can pick
  up sea air (a few Namib and Pilbara points have small temperature swings). The daily swings are cell averages and
  are not height-corrected.
- A few points sit on lakes or salt flats where the terrain is perfectly flat (Lake Salda: slope 0).
- The Mars landing filter (≤ 5°) is a team rule; we found no NASA figure for crewed landings.
- Several target values are estimates. The ~200 °C day–night swing for the south-pole targets is probably high for sunlit
  ridges, but it's beyond Earth's range either way, so it doesn't change any ranking.
- Only 13 places are ones agencies already use, so the Reality check sample is small.

## Rebuilding the data

```bash
python3 tools/make_sites.py ../newnasaspaceapps/data/sites.json data/sites_base.json   # 41 named + 459 sampled points
# Fetch NASA POWER climate + Cesium terrain in a browser on the live site, save to data/raw/chunk1-3.json
# Fetch Macrostrat map units the same way, save to data/raw/geology.json
python3 tools/fetch_power_elev.py   # POWER grid-cell heights -> data/raw/power_cell_elev.json
python3 tools/merge_data.py         # -> data/sites.json
```

`make_sites.py` reads the named sites from the first version's `data/sites.json`.

## Sharing links

The view lives in the URL, e.g. `#target=jezero&purpose=isru&site=yungay&area=4`; custom weights add `&weights=...`.
Old links with `target=shackleton` open the connecting ridge.

## Deploying

The folder is static, so it can be hosted on Netlify, GitHub Pages or Vercel with no build step (`netlify.toml`
publishes the repository root).

1. **Cesium token.** The token in `app.js` ("Analog Atlas (web)", scope `assets:read`) only works on
   `https://analog-atlas.netlify.app` and `http://localhost:3000`. To use another domain, add it under the token's
   Allowed URLs at https://ion.cesium.com/tokens.
2. **Cache versions.** Bump the `?v=` numbers on `style.css`, `app.js` and `region3d.js` in `index.html` (currently
   `v=65`) whenever those files change, so returning visitors get the new versions.
3. **Link previews.** `og-image.png` (1200 × 630) is referenced with a full `https://` address in `og:image`. To change
   it, edit and run `python tools/make_images.py .`, then bump the `?v=` on that tag. The favicon is `favicon.svg`,
   and `icon-180.png` is the Apple touch icon.

The live site currently serves the earlier version, which deploys from the `analog-atlas` repository: every push to
its `main` branch publishes automatically (deploy status: https://app.netlify.com/projects/analog-atlas/deploys).
To publish this version, link this repository to the Netlify site, or push this code to `analog-atlas`.

## Sources

**Data**
- NASA Langley Research Center POWER Project. *Prediction Of Worldwide Energy Resources (POWER)*, Climatology API, 2001–2025. https://power.larc.nasa.gov/
- Peters, S. E., Husson, J. M., & Czaplewski, J. (2018). Macrostrat: A platform for geological data integration and deep-time Earth crust research. *Geochemistry, Geophysics, Geosystems, 19*(4), 1393–1409. https://doi.org/10.1029/2018GC007467
- Cesium GS, Inc. *Cesium World Terrain*; Microsoft *Bing Maps Aerial* imagery, via Cesium ion. https://cesium.com/platform/cesium-ion/
- Natural Earth. *Natural Earth II*, 1:10m raster. https://www.naturalearthdata.com/
- Fortezzo, C. M., Spudis, P. D., & Harrel, S. L. (2020). *Unified Geologic Map of the Moon, 1:5M, 2020.* USGS Astrogeology Science Center. https://astrogeology.usgs.gov/search/map/unified_geologic_map_of_the_moon_1_5m_2020
- Bussey, D. B. J., et al. (2010). Illumination conditions of the south pole of the Moon derived using Kaguya topography. *Icarus, 208*(2), 558–564. https://doi.org/10.1016/j.icarus.2010.03.028
- Mazarico, E., et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. *Icarus, 211*(2), 1066–1081. https://doi.org/10.1016/j.icarus.2010.10.030
- Williams, J.-P., Paige, D. A., Greenhagen, B. T., & Sefton-Nash, E. (2017). The global surface temperatures of the Moon as measured by the Diviner Lunar Radiometer Experiment. *Icarus, 283*, 300–325. https://doi.org/10.1016/j.icarus.2016.08.012
- Rodríguez-Manfredi, J. A., et al. (2023). The diverse meteorology of Jezero crater over the first 250 sols of Perseverance on Mars. *Nature Geoscience, 16*, 19–28. https://doi.org/10.1038/s41561-022-01084-0
- Planetary Science Institute & NASA JPL. *Subsurface Water Ice Mapping (SWIM).* https://swim.psi.edu/
- Laboratoire de Météorologie Dynamique, ESA & CNES. *Mars Climate Database.* https://www-mars.lmd.jussieu.fr/

**Missions and instruments.** NASA Lunar Reconnaissance Orbiter (LOLA, Diviner); Moon Mineralogy Mapper on ISRO's
Chandrayaan-1; NASA Mars Reconnaissance Orbiter (CRISM); NASA 2001 Mars Odyssey (THEMIS); NASA Mars Global Surveyor
(MOLA, TES); NASA Mars 2020 Perseverance (MEDA).

**Engineering limits**
- NASA (2024). Artemis Human Landing System update. NTRS 20240009596. https://ntrs.nasa.gov/api/citations/20240009596/downloads/ArtemisHLSUpdate_2024.pdf
- NASA Science. VIPER: Lunar Operations. https://science.nasa.gov/mission/viper/lunar-operations/
- NASA (2016). Human Mars landing site constraints. NTRS 20160002370. https://ntrs.nasa.gov/api/citations/20160002370/downloads/20160002370.pdf
- NASA. Mars Science Laboratory Engineering User's Guide, v2. https://marsoweb.nas.nasa.gov/landingsites/msl/memoranda/MSL_Eng_User_Guide_v2.pdf
- ISO 2533:1975, *Standard Atmosphere* (the 6.5 °C/km lapse rate).

**Software and design.** [CesiumJS](https://cesium.com/platform/cesiumjs/) 1.120 (Apache 2.0),
[Three.js](https://threejs.org/) r160 (MIT), [Chart.js](https://www.chartjs.org/) 4.4.1 (MIT),
[global-land-mask](https://pypi.org/project/global-land-mask/) (Python); [Inter](https://fonts.google.com/specimen/Inter)
and [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) fonts (SIL OFL); the
[viridis colour scale](https://bids.github.io/colormap/) (van der Walt & Smith).
