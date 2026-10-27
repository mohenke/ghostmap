"""Builds blender/decor-input.json from the bundled OSM snapshot.

Projects Haga Nygata, parks/lawns and the sensor coordinates into scene units
with the same projection Mapforge uses (see src/three/geo.ts), but in Blender's
axes: X = east, Y = north.   Run:  python3 blender/make_decor_input.py
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(ROOT, "public/data/haga-osm.json")))
b = d["_bbox"]
ref_lat, ref_lng = (b["south"] + b["north"]) / 2, (b["west"] + b["east"]) / 2
sx, sy = 51000 * math.cos(math.radians(ref_lat)), 51000


def project(lat, lon):
    return [round((lon - ref_lng) * sx, 3), round((lat - ref_lat) * sy, 3)]


def in_bbox(p):
    return b["south"] <= p["lat"] <= b["north"] and b["west"] <= p["lon"] <= b["east"]


streets = {}
parks = []
for e in d["elements"]:
    t = e.get("tags", {})
    if t.get("name") == "Haga Nygata" and e.get("geometry"):
        streets.setdefault("Haga Nygata", []).append([project(p["lat"], p["lon"]) for p in e["geometry"] if in_bbox(p)])
    if t.get("leisure") == "park" or t.get("landuse") == "grass":
        g = e.get("geometry") or next((m["geometry"] for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")), None)
        if g:
            parks.append({"name": t.get("name"), "ring": [project(p["lat"], p["lon"]) for p in g]})

# Keep in sync with HAGA_SENSORS in src/ghost/sensors.ts
sensors = [("GP-01", 57.69852, 11.95722), ("GP-02", 57.69601, 11.95533), ("GP-03", 57.70101, 11.9578),
           ("GP-04", 57.69955, 11.95709), ("GP-05", 57.69988, 11.95325), ("GP-06", 57.69805, 11.95385)]

out = {
    "streets": streets,
    "parks": parks,
    "sensors": [{"id": i, "xy": project(la, lo)} for i, la, lo in sensors],
    "bbox": [project(b["south"], b["west"]), project(b["north"], b["east"])],
}
json.dump(out, open(os.path.join(ROOT, "blender/decor-input.json"), "w"))
print("wrote blender/decor-input.json:", len(parks), "parks,", len(sensors), "sensors")
