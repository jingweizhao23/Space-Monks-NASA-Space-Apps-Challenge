# Analog Atlas: submission notes

## One-paragraph summary (for the project page)

Before crews and robots go to the Moon or Mars, teams rehearse on Earth. Analog Atlas helps them choose where.
Pick a target (three Artemis III south-pole regions, Mare Tranquillitatis, Jezero Crater, Arcadia Planitia, Arsia Mons)
and a purpose (landing, rover driving, resource prospecting, habitat, spacewalks). The app scores 500 places on Earth:
it first applies NASA engineering limits as pass/fail filters, then scores each feature by how close it is to the
target, and adds them with purpose-specific weights. Every score comes with a plain-words reason, every value is
labelled measured / from a map / estimated, and a "Reality check" tab tests the score against sites agencies
really use and against changes in our own weights.

## Who it is for (say this in the demo)

- **A rover team** building for Mons Mouton asks where to test-drive → shortlist led by smooth, loose, gently
  sloping ground (Rub' al Khali, Atacama).
- **A drill team** preparing for Arcadia Planitia's buried ice → #1 is the McMurdo Dry Valleys, where NASA's
  IceBreaker drill really was tested. Our score found the place the experts chose.
- **Crew trainers** rehearsing moonwalks for the Artemis III ridge → volcanic and desert terrain with matching slopes.

To show one live: pick the target and purpose, then read the reason in the details panel.

## Data used (list all of these on the project page)

| Data | Used for | Source |
|---|---|---|
| NASA POWER climatology 2001–2025 (T2M, T2M_RANGE, TS_RANGE, WS10M, ALLSKY/CLRSKY_SFC_SW_DWN) | Earth temperature swing, wind, illumination, ground-ice estimate | https://power.larc.nasa.gov/ |
| LRO Diviner and LOLA results (Williams et al. 2017; Bussey et al. 2010) | Moon temperature and illumination targets | NASA / LRO |
| Perseverance MEDA (Rodriguez-Manfredi et al. 2023) | Jezero temperature swing, surface material | NASA / JPL |
| MRO CRISM, Mars Odyssey THEMIS | Mars minerals and surface material | NASA |
| SWIM subsurface water ice maps | Arcadia ice | PSI / NASA JPL, https://swim.psi.edu/ |
| NASA Artemis III and Mars landing/EVA limits; VIPER design limit | Pass/fail filters | NASA |
| USGS Unified Geologic Map of the Moon (2020), USGS SIM 3292 (Mars) | Target geology | USGS |
| Cesium World Terrain | Earth slope, roughness, elevation, 3D view | Cesium ion |
| Macrostrat geologic map service (29 published maps) | Earth rock type and derived minerals | https://macrostrat.org/ |

## Questions a judge may ask, and our answers

**How is a score built?** Filters (NASA limits) → each feature scored 0–1 by closeness
`max(0, 1 − |site − target| / tolerance)` or by category match (same 1, related 0.5) → weighted sum out of 100.

**No place on Earth swings 200 °C. How do you score that?** When a target value is outside everything on Earth,
we score that feature against Earth's own range: the closest Earth place gets 1, the furthest 0. The app tags
these "off-Earth", and the limits ("What this place can't copy") are listed on every site.

**What is measured and what is estimated?** Measured: slope, roughness, elevation (terrain model, 100 m grid over
2 km), temperature swings, wind, sunlight (NASA POWER). From maps: rock type (Macrostrat). Estimated: surface
material bin, some minerals, ground ice (from air temperature). Target values: partly measured, partly estimated,
each with its source in `data/targets.json`.

**Does it agree with experts?** For resource prospecting, yes strongly (Dry Valleys is #1 for Arcadia). For rover
and spacewalk practice, yes for volcanic and polar-highland targets, less for Jezero, because most training sites
are volcanic. For habitat, no: existing stations were chosen for isolation and access, and our score measures
environment. We show this in the app instead of hiding it.

**Did you just make up the weights?** They are our proposals, based on which features each activity depends on.
Moving any weight ±25% keeps about 9 of the top 10 the same, so the answers don't hinge on the exact numbers.

**What are the weak points?** Roughness can't see boulders (100 m grid). Climate cells are ~50 km. Ground ice is
estimated. Only 13 known sites to check against. Next: NASA EMIT minerals, ESA Permafrost CCI, more known sites.

## Before submitting (checklist)

- [ ] Deploy v2 (commands below) and open the live link in a private window on another computer.
- [ ] Confirm the GitHub repo is public (open it while signed out).
- [ ] Paste the summary and the data table above into the project page.
- [ ] Record the 30–60 s demo: target + purpose → #1 and its reason → Reality check.
- [ ] Every team member can answer the questions above without notes.

## Deploying v2 to the live site

Run in a terminal on the computer that is signed in to GitHub. This puts v2 on top of v1's history in the same
repo, so Netlify publishes it at https://analog-atlas.netlify.app (v1 stays in the git history).

```
cd C:\Users\jwz23\Downloads\newspaceappsapps
git init -b main
git remote add origin https://github.com/jingweizhao23/analog-atlas.git
git fetch origin
git reset --soft origin/main
git add -A
git commit -m "Analog Atlas v2: 500 sites, purpose scoring, real terrain, climate and geology data"
git push -u origin main
```
