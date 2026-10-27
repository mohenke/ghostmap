"""
GHOST PULSE – turn a Mapforge GLB export into a spooky Haga model.

Run without opening the Blender UI (from the mapforge folder):

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python blender/ghostify_haga.py

Input : blender/haga-mapforge-export.glb   (Mapforge → Ghost Mode → Export GLB)
        blender/decor-input.json           (street/park/sensor coordinates, see README)
Output: blender/haga-ghost.blend
        public/models/haga-ghost.glb       (loaded by the web app)

Positions and proportions are never changed: meshes are only recoloured, merged
per material and decorated. Coordinates survive the round trip because Blender
converts Three.js Y-up to Z-up on import and back to Y-up on export.
"""
import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
IN_GLB = os.path.join(HERE, "haga-mapforge-export.glb")
IN_DECOR = os.path.join(HERE, "decor-input.json")
IN_TERRAIN = os.path.join(ROOT, "public", "data", "haga-terrain.json")
IN_SNAPSHOT = os.path.join(ROOT, "public", "data", "haga-osm.json")
OUT_BLEND = os.path.join(HERE, "haga-ghost.blend")
OUT_GLB = os.path.join(ROOT, "public", "models", "haga-ghost.glb")

LEVEL = 3.0 / 2.183  # one storey (3 m) in scene units (1 unit ≈ 2.18 m)
WALL_DROP = 0.4      # walls reach this far below the ground floor (buildingPlacement in terrain.ts)

# Mapforge does not name its materials. Buildings are recognised by their
# vertex colours (facade/roof colours from OSM); the other layers by their
# ghost-mode base colour (linear RGB) as exported from the web app.
MATERIAL_ROLES = {
    "Ground": (0.246, 0.246, 0.246),
    "Park": (0.006, 0.042, 0.033),
    "Water": (0.007, 0.030, 0.162),
    "Forest": (0.005, 0.027, 0.016),
    "Road": (0.012, 0.015, 0.054),
    "Path": (0.025, 0.019, 0.084),
    "Sett": (0.023, 0.018, 0.061),
    "BridgePillar": (0.027, 0.032, 0.117),
}


# ── helpers ────────────────────────────────────────────────────────────────

# ── terrain: identical to src/three/terrain.ts (bilinear, lowest point in bbox = 0) ──

class Terrain:
    def __init__(self):
        self.t = json.load(open(IN_TERRAIN)) if os.path.exists(IN_TERRAIN) else None
        b = json.load(open(IN_SNAPSHOT))["_bbox"]
        self.ref_lat, self.ref_lng = (b["south"] + b["north"]) / 2, (b["west"] + b["east"]) / 2
        self.sx, self.sy = 51000 * math.cos(math.radians(self.ref_lat)), 51000
        self.base = 0.0
        if self.t:
            t, lo = self.t, math.inf
            for j in range(t["ny"]):
                lat = t["south"] + (t["north"] - t["south"]) * j / (t["ny"] - 1)
                if lat < b["south"] or lat > b["north"]:
                    continue
                for i in range(t["nx"]):
                    lon = t["west"] + (t["east"] - t["west"]) * i / (t["nx"] - 1)
                    if b["west"] <= lon <= b["east"]:
                        lo = min(lo, t["heights_m"][j * t["nx"] + i])
            self.base = lo

    def ground(self, x, y):
        """Scene height at Blender (x, y) = world (x, -z)."""
        t = self.t
        if not t:
            return 0.0
        lat, lon = self.ref_lat + y / self.sy, self.ref_lng + x / self.sx
        fx = min(max((lon - t["west"]) / (t["east"] - t["west"]) * (t["nx"] - 1), 0), t["nx"] - 1)
        fy = min(max((lat - t["south"]) / (t["north"] - t["south"]) * (t["ny"] - 1), 0), t["ny"] - 1)
        i, j = min(t["nx"] - 2, int(fx)), min(t["ny"] - 2, int(fy))
        u, v = fx - i, fy - j
        h = lambda ii, jj: t["heights_m"][jj * t["nx"] + ii]
        m = (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v
        return max(0.0, m - self.base) / (111320 / 51000)


def principled(name, base, rough=0.85, emission=None, strength=0.0, metallic=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    if emission:
        b.inputs["Emission Color"].default_value = (*emission, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


def base_color(mat):
    b = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
    return tuple(b.inputs["Base Color"].default_value[:3]) if b else (0, 0, 0)


def role_of(mat):
    bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
    if bsdf and bsdf.inputs["Base Color"].is_linked:
        return "Building"  # base colour driven by the per-building colour attribute
    c = base_color(mat)
    return min(MATERIAL_ROLES, key=lambda r: sum((a - b) ** 2 for a, b in zip(c, MATERIAL_ROLES[r])))


def sub_collection(parent, name):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in parent.children:
        parent.children.link(c)
    return c


class Builder:
    """Accumulates simple primitives with bmesh and writes them as one mesh object."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def _tag(self, verts, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        idx = self.mats.index(mat)
        vs = set(verts)
        for f in self.bm.faces:
            if all(v in vs for v in f.verts):
                f.material_index = idx

    def cylinder(self, base, top, r1, r2, mat, segments=6):
        v = top - base
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segments, radius1=r1, radius2=r2, depth=v.length)
        rot = Vector((0, 0, 1)).rotation_difference(v.normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(self.bm, matrix=rot, verts=res["verts"])
        bmesh.ops.translate(self.bm, vec=(base + top) / 2, verts=res["verts"])
        self._tag(res["verts"], mat)

    def sphere(self, centre, r, mat, scale=(1, 1, 1), segments=8):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=segments, v_segments=max(4, segments // 2), radius=r)
        bmesh.ops.scale(self.bm, vec=scale, verts=res["verts"])
        bmesh.ops.translate(self.bm, vec=centre, verts=res["verts"])
        self._tag(res["verts"], mat)

    def write(self, name, collection):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        obj = bpy.data.objects.new(name, me)
        collection.objects.link(obj)
        return obj


# ── 1. scene + import ──────────────────────────────────────────────────────

def setup_scene():
    scn = bpy.data.scenes.new("GhostPulse_Haga")
    bpy.context.window_manager  # noqa: B018 – ensure context exists in background mode
    if bpy.context.window:
        bpy.context.window.scene = scn
    for s in list(bpy.data.scenes):
        if s != scn:
            bpy.data.scenes.remove(s)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    out = bpy.data.collections.new("GhostPulse")
    scn.collection.children.link(out)
    return scn, out


def import_mapforge(scn):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=IN_GLB)
    return [o for o in bpy.data.objects if o not in before]


# ── 2. materials, per-building tint, glowing windows ───────────────────────

def sensor_mounts(objects, sensors):
    """Highest point of the building under each sensor, measured before merging.

    Same rule as meshTop() in src/ghost/sensors.ts, so positions match exactly.
    """
    tops = {}
    for s in sensors:
        x, y = s["xy"]
        for o in objects:
            if o.type != "MESH" or not o.data.materials or o.data.materials[0].name != "GP_Building":
                continue
            inv = o.matrix_world.inverted()
            hit, *_ = o.ray_cast(inv @ Vector((x, y, 500)), (inv.to_3x3() @ Vector((0, 0, -1))).normalized())
            if hit:
                tops[s["id"]] = max((o.matrix_world @ v.co).z for v in o.data.vertices)
                break
    return tops


def ghostify_city(objects, out):
    random.seed(31)
    for o in objects:
        if o.type == "MESH" and o.data.materials:
            m = o.data.materials[0]
            if not m.name.startswith("GP_"):
                m.name = "GP_" + role_of(m)

    windows = [
        principled("GP_WindowWarm", (0.05, 0.03, 0.01), 0.5, (1.0, 0.55, 0.18), 2.5),
        principled("GP_WindowEerie", (0.03, 0.01, 0.06), 0.5, (0.62, 0.35, 1.0), 3.0),
        principled("GP_WindowCold", (0.01, 0.04, 0.05), 0.5, (0.35, 0.95, 1.0), 2.5),
    ]
    wverts, wfaces, wmat = [], [], []
    up = Vector((0, 0, 1))

    buildings = [o for o in objects if o.type == "MESH" and o.data.materials and o.data.materials[0].name == "GP_Building"]
    for o in buildings:
        me, mw = o.data, o.matrix_world
        tint = random.uniform(0.75, 1.15)
        hue = random.choice([(0.10, 0.11, 0.22), (0.11, 0.10, 0.20), (0.09, 0.11, 0.19), (0.12, 0.10, 0.18)])
        col = tuple(min(1, c * tint) for c in hue) + (1.0,)
        attr = me.color_attributes.get("Col") or me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        for d in attr.data:
            d.color = col
        for p in me.polygons:
            n = (mw.to_3x3() @ p.normal).normalized()
            if abs(n.z) > 0.1:
                continue  # roofs and floors
            vs = [mw @ me.vertices[i].co for i in p.vertices]
            zmin, zmax = min(v.z for v in vs), max(v.z for v in vs)
            low = [v for v in vs if v.z < zmin + 0.01]
            if len(low) < 2:
                continue
            a, b = low[0], low[1]
            width = (b - a).length
            if width < 2.2 or zmax - zmin < 2:
                continue
            t = (b - a).normalized()
            floors, cols = int((zmax - zmin - WALL_DROP - 0.4) / LEVEL), int(width / 1.7)
            for fi in range(floors):
                for ci in range(cols):
                    if random.random() >= 0.075:
                        continue
                    r = random.random()
                    mi = 0 if r < 0.8 else (1 if r < 0.93 else 2)
                    # a lies at the wall bottom (z = zmin); storeys start at the ground floor
                    # WALL_DROP above it, like the facade shader in the web app.
                    c = a + t * ((ci + 0.5) * width / cols) + Vector((0, 0, WALL_DROP + (fi + 0.55) * LEVEL)) + n * 0.04
                    i = len(wverts)
                    for dx, dz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                        wverts.append(c + t * (dx * 0.275) + up * (dz * 0.375))
                    wfaces.append((i, i + 1, i + 2, i + 3))
                    wmat.append(mi)

    # Buildings take their colour from the per-building attribute (exported as COLOR_0).
    nt = bpy.data.materials["GP_Building"].node_tree
    bsdf = nt.nodes["Principled BSDF"]
    for link in list(bsdf.inputs["Base Color"].links):
        nt.links.remove(link)  # drop the imported OSM colours – the ghost look uses dark tints
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Emission Color"].default_value = (0.06, 0.03, 0.16, 1)
    bsdf.inputs["Emission Strength"].default_value = 0.15

    for name, base, rough in [
        ("GP_Road", (0.012, 0.014, 0.04), 0.95), ("GP_Path", (0.025, 0.02, 0.06), 0.95), ("GP_Sett", (0.022, 0.018, 0.045), 0.95),
        ("GP_Ground", (0.006, 0.006, 0.014), 1.0), ("GP_Park", (0.006, 0.03, 0.022), 1.0),
        ("GP_Forest", (0.004, 0.022, 0.012), 1.0), ("GP_BridgePillar", (0.03, 0.03, 0.08), 0.8),
    ]:
        if name in bpy.data.materials:
            principled(name, base, rough)
    if "GP_Water" in bpy.data.materials:
        principled("GP_Water", (0.008, 0.025, 0.09), 0.25, (0.02, 0.05, 0.2), 0.4)

    me = bpy.data.meshes.new("Windows")
    me.from_pydata([tuple(v) for v in wverts], [], wfaces)
    for m in windows:
        me.materials.append(m)
    for p, mi in zip(me.polygons, wmat):
        p.material_index = mi
    out.objects.link(bpy.data.objects.new("Windows", me))

    # Merge all meshes per material: 1 119 objects → 8, far fewer draw calls on the web.
    names = {"GP_Building": "Buildings", "GP_Road": "Roads", "GP_Path": "Paths", "GP_Sett": "CobbleStreets", "GP_Ground": "Ground",
             "GP_Park": "Parks", "GP_Water": "Water", "GP_Forest": "Forests", "GP_BridgePillar": "BridgePillars"}
    empties = [o for o in objects if o.type == "EMPTY"]  # Mapforge's root node – not needed
    groups = {}
    for o in objects:
        if o.type == "MESH" and o.data.materials:
            groups.setdefault(o.data.materials[0].name, []).append(o)
    vl = bpy.context.view_layer
    merged = {}
    for mname, objs in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        vl.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        j = vl.objects.active
        j.name = j.data.name = names.get(mname, mname)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        for c in j.users_collection:
            c.objects.unlink(j)
        out.objects.link(j)
        merged[j.name] = len(j.data.polygons)
    for o in empties:
        bpy.data.objects.remove(o)
    return merged, len(wfaces)


# ── 3. sensors and decorations ─────────────────────────────────────────────

def decorate(scn, out, mounts):
    random.seed(7)
    data = json.load(open(IN_DECOR))

    terrain = Terrain()
    buildings = bpy.data.objects["Buildings"]  # merged, transforms applied → local = world

    def roof_z(x, y):
        """Roof height if (x, y) is on a building, else None."""
        hit, loc, *_ = buildings.ray_cast(Vector((x, y, 500)), Vector((0, 0, -1)))
        return loc.z if hit else None

    metal = principled("GP_DarkMetal", (0.02, 0.02, 0.035), 0.5, metallic=0.8)
    sensor_glow = principled("GP_SensorGlow", (0.05, 0.2, 0.25), 0.3, (0.3, 0.9, 1.0), 3.0)
    pumpkin = principled("GP_Pumpkin", (0.6, 0.18, 0.02), 0.6, (1.0, 0.35, 0.05), 0.8)
    stem = principled("GP_PumpkinStem", (0.03, 0.06, 0.02), 0.9)
    summary = {}

    # Sensors: named empties (read by the web app) + a small measuring mast below each.
    col = sub_collection(out, "Sensors")
    masts = Builder()
    for s in data["sensors"]:
        x, y = s["xy"]
        roof = roof_z(x, y)
        base = roof if roof is not None else terrain.ground(x, y)  # where the mast stands
        # same rule as src/ghost/sensors.ts
        z = mounts[s["id"]] + 2.5 if s["id"] in mounts else terrain.ground(x, y) + 3.5
        e = bpy.data.objects.new("SENSOR_" + s["id"], None)
        e.empty_display_type = "SPHERE"
        e.location = (x, y, z)
        e["sensor_id"] = s["id"]  # exported as glTF extras → userData.sensor_id
        col.objects.link(e)
        b = Vector((x, y, base))
        for k in range(3):
            a = k * 2 * math.pi / 3
            masts.cylinder(b + Vector((math.cos(a) * 0.9, math.sin(a) * 0.9, 0)), b + Vector((0, 0, 0.9)), 0.05, 0.04, metal, 5)
        masts.cylinder(b, b + Vector((0, 0, z - base - 0.9)), 0.07, 0.05, metal)
        masts.cylinder(b + Vector((0, 0, z - base - 1.0)), b + Vector((0, 0, z - base - 0.85)), 0.45, 0.45, sensor_glow, 12)
        summary[s["id"]] = [round(x, 2), round(y, 2), round(z, 2)]
    masts.write("SensorMasts", col)

    # Street lamps and trees are no longer invented here: the web app draws the
    # real ones from OpenStreetMap (304 lamps, 715 trees + avenues) on top of this model.

    # Halloween pumpkins along Haga Nygata and at the feet of street-level sensors.
    pk = Builder()
    spots = [Vector((p[0] + random.uniform(-1.4, 1.4), p[1] + random.uniform(-1.4, 1.4), 0))
             for chain in data["streets"]["Haga Nygata"] for p in chain[1:-1:2]]
    spots += [Vector((s["xy"][0] + 1.4, s["xy"][1] - 1.0, 0)) for s in data["sensors"] if roof_z(*s["xy"]) is None]
    n = 0
    for c in spots:
        if roof_z(c.x, c.y) is not None:
            continue
        c = Vector((c.x, c.y, terrain.ground(c.x, c.y) + 0.1))
        r = random.uniform(0.3, 0.45)
        pk.sphere(c + Vector((0, 0, r * 0.75)), r, pumpkin, scale=(1, 1, 0.78), segments=10)
        pk.cylinder(c + Vector((0, 0, r * 1.4)), c + Vector((0, 0, r * 1.75)), 0.05, 0.035, stem, 5)
        n += 1
    pk.write("Pumpkins", sub_collection(out, "Pumpkins"))
    summary["pumpkins"] = n
    return summary


# ── 4. night look for previews inside Blender ──────────────────────────────

def night_preview(scn, out):
    w = bpy.data.worlds.new("GP_Night")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.006, 0.006, 0.02, 1)
    scn.world = w
    sun = bpy.data.lights.new("GP_Moon", "SUN")
    sun.energy, sun.color = 1.2, (0.62, 0.7, 1.0)
    moon = bpy.data.objects.new("GP_Moon", sun)
    moon.rotation_euler = (math.radians(50), 0, math.radians(-140))
    out.objects.link(moon)
    cam_data = bpy.data.cameras.new("GP_Camera")
    cam_data.lens, cam_data.clip_end = 28, 3000
    cam = bpy.data.objects.new("GP_Camera", cam_data)
    cam.location = (110, -260, 190)
    cam.rotation_euler = (Vector((0, -10, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    out.objects.link(cam)
    scn.camera = cam


# ── 5. export ──────────────────────────────────────────────────────────────

def export(scn):
    for o in scn.objects:
        for holder in (o, o.data):
            if holder is not None:
                holder.pop("exportToGLB", None)  # Mapforge's web export flag – not meaningful here
        o.select_set(o.type in ("MESH", "EMPTY"))
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_extras=True, export_cameras=False, export_lights=False, export_vertex_color="MATERIAL",
        # Draco shrinks the terrain-following meshes a lot; drei's useGLTF decodes it automatically.
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    )
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)


if __name__ == "__main__":
    scene, root = setup_scene()
    imported = import_mapforge(scene)
    for o in imported:
        if o.type == "MESH" and o.data.materials and not o.data.materials[0].name.startswith("GP_"):
            o.data.materials[0].name = "GP_" + role_of(o.data.materials[0])
    mounts = sensor_mounts(imported, json.load(open(IN_DECOR))["sensors"])
    merged, window_count = ghostify_city(imported, root)
    deco = decorate(scene, root, mounts)
    night_preview(scene, root)
    export(scene)
    print("GHOSTIFY_RESULT", json.dumps({"merged": merged, "windows": window_count, **deco}))
