"""Fetch the NASA POWER (MERRA-2) grid-cell elevation for every site.

POWER's T2M is the air temperature at the *grid cell's* average height, not at the site.
For mountain sites the two can differ by kilometres (Mauna Kea: cell 636 m, summit 4166 m),
so merge_data.py corrects T2M with a lapse rate using this cell elevation.

Usage: python tools/fetch_power_elev.py   ->  data/raw/power_cell_elev.json  {id: elev_m}
"""
import json, pathlib, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

root = pathlib.Path(__file__).resolve().parent.parent
base = json.load(open(root / "data/sites_base.json", encoding="utf-8"))
out_path = root / "data/raw/power_cell_elev.json"
done = json.load(open(out_path)) if out_path.exists() else {}
URL = ("https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M&community=RE"
       "&longitude={lon}&latitude={lat}&format=JSON&start=2001&end=2025")

def get(s):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(URL.format(lat=s["lat"], lon=s["lon"]), timeout=60) as r:
                j = json.load(r)
            return s["id"], j["geometry"]["coordinates"][2], j["properties"]["parameter"]["T2M"]["ANN"]
        except Exception as e:
            time.sleep(2 + 3 * attempt)
    return s["id"], None, None

todo = [s for s in base if s["id"] not in done]
with ThreadPoolExecutor(6) as ex:
    for i, (sid, elev, t2m) in enumerate(ex.map(get, todo)):
        if elev is not None: done[sid] = [round(elev, 1), t2m]
        if i % 50 == 0:
            print(i, len(done), flush=True)
            json.dump(done, open(out_path, "w"))
json.dump(done, open(out_path, "w"))
print("done", len(done), "of", len(base))
