"""
Builds public/data/haga-terrain.json – a height grid for the bundled Haga area.

Source: Terrarium elevation tiles from AWS Open Data (Mapzen/Tilezen, free, no key):
  https://registry.opendata.aws/terrain-tiles/
Height (m) = R * 256 + G + B / 256 - 32768

Uses only the Python standard library (a tiny PNG decoder is included).
Run from the mapforge folder:   python3 scripts/make_terrain.py
"""
import json
import math
import os
import struct
import urllib.request
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAPSHOT = os.path.join(ROOT, "public/data/haga-osm.json")
OUT = os.path.join(ROOT, "public/data/haga-terrain.json")
ZOOM = 15
GRID = 97          # samples per side
MARGIN = 1.25      # grid covers the area × 1.25 so the ground plane has terrain too
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def decode_png(data):
    """Minimal PNG decoder for 8-bit RGB/RGBA images. Returns (width, height, channels, rows)."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat = 8, b""
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and ctype in (2, 6), f"unsupported PNG (depth {depth}, type {ctype})"
            ch = 3 if ctype == 2 else 4
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = w * ch
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0
            b = prev[x]
            c = prev[x - ch] if x >= ch else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return w, h, ch, rows


def tile_xy(lat, lon):
    n = 2 ** ZOOM
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def main():
    b = json.load(open(SNAPSHOT))["_bbox"]
    clat, clon = (b["south"] + b["north"]) / 2, (b["west"] + b["east"]) / 2
    hlat, hlon = (b["north"] - b["south"]) / 2 * MARGIN, (b["east"] - b["west"]) / 2 * MARGIN
    south, north, west, east = clat - hlat, clat + hlat, clon - hlon, clon + hlon

    tiles = {}

    def elevation(lat, lon):
        fx, fy = tile_xy(lat, lon)
        tx, ty = int(fx), int(fy)
        if (tx, ty) not in tiles:
            url = TILE_URL.format(z=ZOOM, x=tx, y=ty)
            tiles[(tx, ty)] = decode_png(urllib.request.urlopen(url).read())
            print("tile", url)
        w, h, ch, rows = tiles[(tx, ty)]
        px, py = min(w - 1, int((fx - tx) * w)), min(h - 1, int((fy - ty) * h))
        r, g, bl = rows[py][px * ch:px * ch + 3]
        return r * 256 + g + bl / 256 - 32768

    heights = []
    for j in range(GRID):  # rows south → north
        lat = south + (north - south) * j / (GRID - 1)
        for i in range(GRID):  # columns west → east
            lon = west + (east - west) * i / (GRID - 1)
            heights.append(round(elevation(lat, lon), 2))

    out = {
        "_source": "Terrarium elevation tiles, AWS Open Data (Mapzen/Tilezen) – https://registry.opendata.aws/terrain-tiles/",
        "south": south, "west": west, "north": north, "east": east,
        "nx": GRID, "ny": GRID,
        "heights_m": heights,
    }
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {OUT}: {GRID}x{GRID}, {min(heights):.1f}–{max(heights):.1f} m")


if __name__ == "__main__":
    main()
