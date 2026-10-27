import { css, keyframes } from "@emotion/react";
import { Space } from "../three/Space";
import { FullscreenModal } from "../components/FullscreenModal";
import { Title } from "@/components/text/Title";
import { Description } from "@/components/text/Description";
import { Column } from "@/components/flex/Column";
import { MapComponent, MapComponentRef } from "@/components/map/SelectMap";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  NextButton,
  PrevButton,
} from "@/components/button/BottomButton";
import { Building } from "@/components/map/Processing";
import { ChevronLeft, ChevronRight, Download, Loader2, Search } from "lucide-react";
import L from "leaflet";
import { useAreaStore } from "@/state/areaStore";
import type { PointElem, PolygonRing, PolylineElem } from "@/state/areaStore";
import { useActionStore } from "@/state/exportStore";
import { Modal } from "@/components/modal/Modal";
import { TopNav } from "@/components/nav/TopNav";
import { Row } from "@/components/flex/Row";
import { useGhostStore } from "@/ghost/ghostStore";
import { useGhostFeed } from "@/ghost/useGhostFeed";
import { GhostPanel } from "@/ghost/GhostPanel";
import { IntroCard } from "@/ghost/IntroCard";
import { useWeatherFeed } from "@/weather/weatherStore";
import { useWalkStore } from "@/walk/walkStore";
import { WalkHud } from "@/walk/WalkHud";
import { GhostMeter } from "@/walk/GhostMeter";
import { ClockWeather } from "@/weather/ClockWeather";
import { useOpenDataFeed } from "@/opendata/openDataStore";
import { fetchTerrainGrid, withBase } from "@/three/terrain";

const IconSize = css({
  width: "14px",
  height: "14px",
});

const spinAnimation = keyframes`
from { transform: rotate(0deg); }
to { transform: rotate(360deg); }
`;

// ── OSM polygon helpers ────────────────────────────────────────────────────────

/**
 * Given an OSM element (way or relation), return one or more closed rings
 * of lat/lon points representing its outer boundary.
 *
 * - Way: geometry is directly on the element.
 * - Relation: outer boundary lives in members with role="outer".
 */
function extractOuterRings(el: any): Array<Array<{ lat: number; lon: number }>> {
  if (el.type === "way" && el.geometry?.length >= 3) {
    return [el.geometry.map((pt: any) => ({ lat: pt.lat, lon: pt.lon }))];
  }
  if (el.type === "relation" && Array.isArray(el.members)) {
    return el.members
      .filter((m: any) => m.role === "outer" && m.geometry?.length >= 3)
      .map((m: any) => m.geometry.map((pt: any) => ({ lat: pt.lat, lon: pt.lon })));
  }
  return [];
}

/**
 * Converts a list of OSM elements into flat PolygonRing items.
 * Each ring gets a unique key from element id + ring index.
 */
function toPolygonRings(els: any[]): PolygonRing[] {
  const out: PolygonRing[] = [];
  for (const el of els) {
    const rings = extractOuterRings(el);
    rings.forEach((ring, ri) => {
      out.push({ key: `${el.id}-${ri}`, ring, tags: el.tags ?? {} });
    });
  }
  return out;
}

// ── ──────────────────────────────────────────────────────────────────────────

// Public Overpass servers are often busy – try them in order.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function fetchOverpass(query: string): Promise<any> {
  let lastError: unknown = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        body: query,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      return await response.json();
    } catch (err) {
      lastError = err;
      console.warn(`Overpass endpoint failed: ${url}`, err);
    }
  }
  throw lastError ?? new Error("All Overpass endpoints failed");
}

// Places shown in the building card ("I huset: Café Husaren").
const POI_AMENITIES = new Set(["cafe", "restaurant", "pub", "bar", "fast_food", "ice_cream", "library", "place_of_worship", "theatre", "cinema", "arts_centre", "community_centre"]);
const POI_TOURISM = new Set(["museum", "hotel", "attraction"]);

/** Bundled OSM snapshot of Haga, Göteborg – lets the demo start without Overpass. */
const HAGA_SNAPSHOT_URL = "/data/haga-osm.json";
/** Height grid for Haga (see scripts/make_terrain.py). */
const HAGA_TERRAIN_URL = "/data/haga-terrain.json";
/** Haga model enhanced in Blender (see blender/README.md). */
const HAGA_MODEL_URL = "/models/haga-ghost.glb";

const BOX_HALF_LAT: Record<"small" | "medium" | "large", number> = {
  small: 0.0018,
  medium: 0.0072,
  large: 0.029,
};

const bootPulse = keyframes`0%,100%{opacity:.35;transform:scale(.96)}50%{opacity:1;transform:scale(1)}`;

function BootScreen() {
  return (
    <div
      css={css({
        position: "absolute", inset: 0, zIndex: 3000, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 14, background: "radial-gradient(circle at 50% 40%, #1a1240, #04040b 70%)",
        color: "#e5e7ff", textAlign: "center",
      })}
    >
      <div css={css({ fontSize: 54, animation: `${bootPulse} 1.6s ease-in-out infinite` })}>👻</div>
      <div css={css({ fontSize: 26, fontWeight: 800, letterSpacing: "0.2em", background: "linear-gradient(90deg,#22d3ee,#a855f7)", WebkitBackgroundClip: "text", color: "transparent" })}>
        GHOST PULSE
      </div>
      <div css={css({ fontSize: 13, color: "#9ca3c7" })}>Kalibrerar spöksensorerna i Haga…</div>
    </div>
  );
}

function App() {
  const [isNextButtonDisabled, setIsNextButtonDisabled] = useState(true);
  const [areaData, setAreaData] = useState([]);
  const [steps, setSteps] = useState(["front", "processing"]);
  const [step, setStep] = useState(0);
  // While the Haga snapshot loads, show a dark boot screen instead of Mapforge's area picker.
  const [booting, setBooting] = useState(true);
  const [isWarnModal, setIsWarnModal] = useState(false);
  const [isExportModal, setIsExportModal] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [isFetchingBuildings, setIsFetchingBuildings] = useState(false);
  const [hasFetchedBuildings, setHasFetchedBuildings] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [externalBounds, setExternalBounds] = useState<L.LatLngBounds | null>(null);
  const [boxSize, setBoxSize] = useState<"small" | "medium" | "large">("small");
  const [buildProgress, setBuildProgress] = useState(0);
  const [buildStatus, setBuildStatus] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [hagaError, setHagaError] = useState("");
  const mapRef = useRef<MapComponentRef>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const buildBoundsFromCenter = (lat: number, lon: number, size: "small" | "medium" | "large") => {
    const dLat = BOX_HALF_LAT[size];
    const dLng = dLat / Math.cos((lat * Math.PI) / 180);
    return new L.LatLngBounds([lat - dLat, lon - dLng], [lat + dLat, lon + dLng]);
  };

  const setCenter = useAreaStore((state) => state.setCenter);
  const appendAreas = useAreaStore((state) => state.appendAreas);
  const setRoads = useAreaStore((state) => state.setRoads);
  const setParks = useAreaStore((state) => state.setParks);
  const setWaterPolygons = useAreaStore((state) => state.setWaterPolygons);
  const setRivers = useAreaStore((state) => state.setRivers);
  const setStreams = useAreaStore((state) => state.setStreams);
  const setForests = useAreaStore((state) => state.setForests);
  const setRailways = useAreaStore((state) => state.setRailways);
  const setDetails = useAreaStore((state) => state.setDetails);
  const setTerrain = useAreaStore((state) => state.setTerrain);
  const setProjection = useAreaStore((state) => state.setProjection);
  const ghostMode = useGhostStore((state) => state.ghostMode);
  const walking = useWalkStore((state) => state.mode !== "orbit");
  const setAction = useActionStore((state) => state.setAction);
  const includeGroundPlane = useActionStore((state) => state.includeGroundPlane);
  const setIncludeGroundPlane = useActionStore((state) => state.setIncludeGroundPlane);

  const checkIsBig = () => {
    const a = areaData[0].lat - areaData[1].lat;
    const b = areaData[0].lng - areaData[1].lng;

    console.log(a + b);

    if (a + b > 0.2) {
      return true;
    } else {
      return false;
    }
  };

  const exportFile = () => {
    setAction(true);
  };

  const handleDone = (data) => {
    setAreaData(data);
    setCenter(data);
    console.log(data, "AAEE");
    setIsNextButtonDisabled(false);
    setBuildings([]);
    setHasFetchedBuildings(false);
  };

  const handleRemove = () => {
    setAreaData([]);
    setIsNextButtonDisabled(true);
    setBuildings([]);
    setHasFetchedBuildings(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchError("");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1`,
        { headers: { "Accept-Language": "en" } }
      );
      const results = await res.json();
      if (!results.length) {
        setSearchError("No results found. Try a different name.");
        return;
      }
      const { lat, lon } = results[0];
      const bounds = buildBoundsFromCenter(parseFloat(lat), parseFloat(lon), boxSize);
      setExternalBounds(bounds);
      mapRef.current?.flyToBounds(bounds);
    } catch {
      setSearchError("Search failed. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  /** Locks the projection for a bbox and loads OSM elements into the stores. */
  const loadOsmData = (data: any, south: number, west: number, north: number, east: number) => {
    // Lock projection parameters at generation time — never recalculated on resize.
    const SCENE_SCALE = 51000;
    const refLat = (north + south) / 2;
    const refLng = (east + west) / 2;
    setProjection({
      refLat,
      refLng,
      scaleX: SCENE_SCALE * Math.cos((refLat * Math.PI) / 180),
      scaleY: SCENE_SCALE,
      bbox: {
        minLat: Math.min(south, north),
        maxLat: Math.max(south, north),
        minLng: Math.min(west, east),
        maxLng: Math.max(west, east),
      },
    });

    const blds: Building[] = data.elements
      .filter((el: any) => el.tags?.building)
      .map((element: any) => {
        // Multipolygon buildings: use the first outer ring as footprint.
        const ring = element.geometry ?? extractOuterRings(element)[0];
        return {
          id: element.id,
          osmType: element.type,
          tags: element.tags,
          geometry: ring ? ring.map((pt: any) => ({ lat: pt.lat, lng: pt.lon })) : undefined,
        };
      });
    const rdElems = data.elements
      .filter((el: any) => el.tags?.highway && el.geometry?.length >= 2)
      .map((el: any) => ({
        id: el.id,
        tags: el.tags,
        geometry: el.geometry.map((pt: any) => ({ lat: pt.lat, lon: pt.lon })),
      }));

    // ── Phase 1: Parks (leisure=park + landuse=grass + natural=grassland) ──
    const parkElems = data.elements.filter(
      (el: any) =>
        el.tags?.leisure === "park" ||
        el.tags?.landuse === "grass" ||
        el.tags?.natural === "grassland"
    );
    const parsedParks: PolygonRing[] = toPolygonRings(parkElems);

    // ── Phase 1: Water polygons (natural=water) ──────────────────────────
    const waterPolyElems = data.elements.filter(
      (el: any) => el.tags?.natural === "water"
    );

    // ── Diagnostic: water polygon extraction ─────────────────────────────
    {
      const waterWays = waterPolyElems.filter((e: any) => e.type === "way");
      const waterRels = waterPolyElems.filter((e: any) => e.type === "relation");
      console.group(`Water polygons diagnostic (${waterPolyElems.length} total)`);
      console.log(`  ways:      ${waterWays.length}`);
      console.log(`  relations: ${waterRels.length}`);

      let relSucceeded = 0;
      let relSkipped = 0;
      for (const rel of waterRels) {
        const members = Array.isArray(rel.members) ? rel.members : [];
        const outerWithGeom  = members.filter((m: any) => m.role === "outer" && m.geometry?.length >= 3);
        const outerNoGeom    = members.filter((m: any) => m.role === "outer" && !(m.geometry?.length >= 3));
        const innerCount     = members.filter((m: any) => m.role === "inner").length;
        const otherCount     = members.filter((m: any) => m.role !== "outer" && m.role !== "inner").length;

        if (outerWithGeom.length > 0) {
          relSucceeded++;
        } else {
          relSkipped++;
        }

        console.group(
          `  relation ${rel.id} "${rel.tags?.name ?? "(unnamed)"}" — ` +
          `outer: ${outerWithGeom.length} ok / ${outerNoGeom.length} no-geom, ` +
          `inner: ${innerCount}, other-role: ${otherCount}`
        );
        if (outerNoGeom.length > 0) {
          console.warn(`    ⚠ ${outerNoGeom.length} outer member(s) missing geometry:`,
            outerNoGeom.map((m: any) => ({ ref: m.ref, role: m.role, geomLen: m.geometry?.length ?? 0 }))
          );
        }
        if (members.length === 0) {
          console.warn(`    ⚠ relation has no members at all — out body geom may not have returned member geometry`);
        }
        console.groupEnd();
      }

      console.log(`  ─────────────────────────────`);
      console.log(`  relations succeeded (≥1 outer ring): ${relSucceeded}`);
      console.log(`  relations skipped   (0 outer rings):  ${relSkipped}`);
      console.groupEnd();
    }

    const parsedWaterPolygons: PolygonRing[] = toPolygonRings(waterPolyElems);

    // ── Phase 2: Rivers (waterway=river|canal) ────────────────────────────
    const riverElems: PolylineElem[] = data.elements
      .filter(
        (el: any) =>
          (el.tags?.waterway === "river" || el.tags?.waterway === "canal") &&
          el.geometry?.length >= 2
      )
      .map((el: any) => ({
        id: el.id,
        tags: el.tags,
        geometry: el.geometry.map((pt: any) => ({ lat: pt.lat, lon: pt.lon })),
      }));

    // ── Phase 2: Streams ──────────────────────────────────────────────────
    const streamElems: PolylineElem[] = data.elements
      .filter(
        (el: any) => el.tags?.waterway === "stream" && el.geometry?.length >= 2
      )
      .map((el: any) => ({
        id: el.id,
        tags: el.tags,
        geometry: el.geometry.map((pt: any) => ({ lat: pt.lat, lon: pt.lon })),
      }));

    // ── Phase 3: Forests (natural=wood + landuse=forest) ─────────────────
    const forestElems = data.elements.filter(
      (el: any) => el.tags?.natural === "wood" || el.tags?.landuse === "forest"
    );
    const parsedForests: PolygonRing[] = toPolygonRings(forestElems);

    // ── Phase 4: Railways ─────────────────────────────────────────────────
    const railwayElems: PolylineElem[] = data.elements
      .filter(
        (el: any) => el.tags?.railway === "rail" && el.geometry?.length >= 2
      )
      .map((el: any) => ({
        id: el.id,
        tags: el.tags,
        geometry: el.geometry.map((pt: any) => ({ lat: pt.lat, lon: pt.lon })),
      }));

    // ── Feature counts for console survey ─────────────────────────────────────
    const els = data.elements as any[];
    const count = (pred: (el: any) => boolean) => els.filter(pred).length;
    console.group("OSM Features Available:");
    console.log(`  buildings:      ${count((e) => !!e.tags?.building)}`);
    console.log(`  roads/paths:    ${count((e) => !!e.tags?.highway)}`);
    console.log(`  bridges:        ${count((e) => !!e.tags?.highway && e.tags?.bridge === "yes")}`);
    console.log(`  railways:       ${count((e) => e.tags?.railway === "rail")}`);
    console.log(`  water polygons: ${count((e) => e.tags?.natural === "water")}`);
    console.log(`  rivers:         ${count((e) => e.tags?.waterway === "river")}`);
    console.log(`  streams:        ${count((e) => e.tags?.waterway === "stream")}`);
    console.log(`  canals:         ${count((e) => e.tags?.waterway === "canal")}`);
    console.log(`  dams:           ${count((e) => e.tags?.waterway === "dam")}`);
    console.log(`  coastline:      ${count((e) => e.tags?.natural === "coastline")}`);
    console.log(`  forests/woods:  ${count((e) => e.tags?.natural === "wood" || e.tags?.landuse === "forest")}`);
    console.log(`  grass:          ${count((e) => e.tags?.landuse === "grass")}`);
    console.log(`  parks:          ${count((e) => e.tags?.leisure === "park")}`);
    console.log(`  beaches:        ${count((e) => e.tags?.natural === "beach")}`);
    console.log(`  parking lots:   ${count((e) => e.tags?.landuse === "parking")}`);
    console.log(`  ─────────────────────────────`);
    console.log(`  total elements: ${els.length}`);
    console.groupEnd();

    setBuildings(blds);
    appendAreas(blds);
    setRoads(rdElems);
    setParks(parsedParks);
    setWaterPolygons(parsedWaterPolygons);
    setRivers(riverElems);
    setStreams(streamElems);
    setForests(parsedForests);
    setRailways(railwayElems);

    // ── Street details: trees, tram tracks, walls, benches, street lamps ──
    const polylines = (pred: (t: any) => boolean): PolylineElem[] =>
      data.elements
        .filter((el: any) => el.type === "way" && el.tags && pred(el.tags) && el.geometry?.length >= 2)
        .map((el: any) => ({ id: el.id, tags: el.tags, geometry: el.geometry.map((pt: any) => ({ lat: pt.lat, lon: pt.lon })) }));
    const points = (pred: (t: any) => boolean): PointElem[] =>
      data.elements
        .filter((el: any) => el.type === "node" && el.tags && pred(el.tags))
        .map((el: any) => ({ id: el.id, lat: el.lat, lon: el.lon, tags: el.tags }));
    setDetails({
      trees: points((t) => t.natural === "tree"),
      treeRows: polylines((t) => t.natural === "tree_row"),
      tramways: polylines((t) => t.railway === "tram"),
      walls: polylines((t) => t.barrier === "wall" || t.barrier === "retaining_wall"),
      benches: points((t) => t.amenity === "bench"),
      lamps: points((t) => t.highway === "street_lamp"),
      pois: points((t) => !!(t.name && (POI_AMENITIES.has(t.amenity) || t.shop || POI_TOURISM.has(t.tourism)))),
    });
    setHasFetchedBuildings(true);
  };

  const requestBuildings = async (): Promise<boolean> => {
    setIsFetchingBuildings(true);
    setFetchError("");
    setBuildProgress(0);
    setBuildStatus("Fetching map data from OpenStreetMap...");

    let p = 0;
    progressIntervalRef.current = setInterval(() => {
      p = p + (85 - p) * 0.05;
      setBuildProgress(p);
    }, 200);

    const south = areaData[1].lat;
    const west = areaData[1].lng;
    const north = areaData[0].lat;
    const east = areaData[0].lng;

    const bbox = `${south},${west},${north},${east}`;
    const query = `[out:json][timeout:90];(` +
      // ── existing ──────────────────────────────────────
      `way["building"](${bbox});` +
      `relation["building"](${bbox});` +
      `way["highway"](${bbox});` +
      // ── water ─────────────────────────────────────────
      `way["natural"="water"](${bbox});` +
      `relation["natural"="water"](${bbox});` +
      `way["waterway"="river"](${bbox});` +
      `way["waterway"="stream"](${bbox});` +
      `way["waterway"="canal"](${bbox});` +
      `way["waterway"="dam"](${bbox});` +
      `way["natural"="coastline"](${bbox});` +
      // ── vegetation / green space ───────────────────────
      `way["natural"="wood"](${bbox});` +
      `relation["natural"="wood"](${bbox});` +
      `way["landuse"="forest"](${bbox});` +
      `relation["landuse"="forest"](${bbox});` +
      `way["landuse"="grass"](${bbox});` +
      `way["natural"="grassland"](${bbox});` +
      `way["leisure"="park"](${bbox});` +
      `relation["leisure"="park"](${bbox});` +
      `way["natural"="beach"](${bbox});` +
      // ── infrastructure ────────────────────────────────
      `way["railway"="rail"](${bbox});` +
      `way["landuse"="parking"](${bbox});` +
      // ── street details ────────────────────────────────
      `node["natural"="tree"](${bbox});` +
      `way["natural"="tree_row"](${bbox});` +
      `way["railway"="tram"](${bbox});` +
      `way["barrier"="wall"](${bbox});` +
      `way["barrier"="retaining_wall"](${bbox});` +
      `node["amenity"="bench"](${bbox});` +
      `node["highway"="street_lamp"](${bbox});` +
      `node["amenity"~"^(cafe|restaurant|pub|bar|fast_food|ice_cream|library|place_of_worship|theatre|cinema|arts_centre|community_centre)$"](${bbox});` +
      `node["shop"](${bbox});` +
      `node["tourism"~"^(museum|hotel|attraction)$"](${bbox});` +
    `);out body geom;`;
    try {
      const data = await fetchOverpass(query);
      // The Blender model only matches the bundled Haga area.
      useGhostStore.getState().setModelUrl(null);
      setTerrain(null);
      loadOsmData(data, south, west, north, east);
      // Terrain arrives a moment later; the scene is flat until then (or if it fails).
      const projection = useAreaStore.getState().projection!;
      fetchTerrainGrid(projection)
        .then((grid) => setTerrain(grid))
        .catch((err) => console.warn("Terrain unavailable – using flat ground.", err));

      clearInterval(progressIntervalRef.current!);
      progressIntervalRef.current = null;
      setBuildStatus("Building 3D scene...");
      setBuildProgress(92);
      await new Promise((r) => setTimeout(r, 500));
      setBuildProgress(100);
      await new Promise((r) => setTimeout(r, 300));
      return true;
    } catch (error) {
      clearInterval(progressIntervalRef.current!);
      progressIntervalRef.current = null;
      const msg = error instanceof Error ? error.message : "Unknown error";
      setFetchError(`Failed to fetch map data: ${msg}. Please try again.`);
      setBuildProgress(0);
      setBuildStatus("");
      return false;
    } finally {
      setIsFetchingBuildings(false);
    }
  };

  const generate = async () => {
    setStep(1);
    const ok = await requestBuildings();
    if (ok) setStep(2);
    else setStep(0);
  };

  const handleClickNextStep = () => {
    if (step === 0) {
      if (checkIsBig()) { setIsWarnModal(true); return; }
      generate();
    }
  };

  const handleClickPrevStep = () => {
    // From the 3D view, go straight back to area selection.
    setStep(step === 2 ? 0 : step - 1);
  };

  const loadHagaDemo = async () => {
    setHagaError("");
    try {
      const res = await fetch(HAGA_SNAPSHOT_URL);
      if (!res.ok) throw new Error(`${HAGA_SNAPSHOT_URL} svarade ${res.status}`);
      const data = await res.json();
      const { south, west, north, east } = data._bbox;
      // Load terrain first so the scene is built once, already on the terrain.
      const terrainRes = await fetch(HAGA_TERRAIN_URL).catch(() => null);
      const grid = terrainRes?.ok ? await terrainRes.json() : null;
      loadOsmData(data, south, west, north, east);
      const projection = useAreaStore.getState().projection!;
      setTerrain(grid ? withBase(grid, projection) : null);
      useGhostStore.getState().setModelUrl(HAGA_MODEL_URL);
      setCenter([{ lat: north, lng: east }, { lat: south, lng: west }]);
      setStep(2);
      setBooting(false);
    } catch (err) {
      console.error("Could not load Haga snapshot", err);
      setHagaError(err instanceof Error ? err.message : String(err));
      setBooting(false);
    }
  };

  useGhostFeed();
  useWeatherFeed();
  useOpenDataFeed();

  useEffect(() => {
    loadHagaDemo();
  }, []);

  const handleClickExport = () => {
    setIsExportModal(true);
  };

  return (
    <div css={css({ height: "100%", width: "100%" })}>
      <TopNav step={step} />

      {booting && <BootScreen />}

      <FullscreenModal isOpen={!booting && steps[step] == "front"}>
        <Column gap="1rem">
          <Column gap="0.5rem">
            <Title>Generate 3d map</Title>
            <Description>
              Tools to create 3D maps based on maps and export them in GLB
              format
            </Description>
          </Column>
          <div css={css({ display: "flex", gap: "0.5rem", alignItems: "center" })}>
            <input
              type="text"
              placeholder="Search city or place..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              css={css({
                flex: 1,
                padding: "0.5rem 0.75rem",
                borderRadius: "8px",
                border: "1px solid rgba(0,0,0,0.15)",
                fontSize: "14px",
                outline: "none",
                "&:focus": { borderColor: "#007bff", boxShadow: "0 0 0 2px rgba(0,123,255,0.2)" },
              })}
            />
            <button
              onClick={handleSearch}
              disabled={isSearching}
              css={css({
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 1rem",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "#007bff",
                color: "#fff",
                fontSize: "14px",
                cursor: isSearching ? "not-allowed" : "pointer",
                opacity: isSearching ? 0.7 : 1,
                "&:hover": { backgroundColor: "#0069d9" },
              })}
            >
              {isSearching ? <Loader2 css={css({ width: 14, height: 14, animation: `${spinAnimation} 1s linear infinite` })} /> : <Search css={css({ width: 14, height: 14 })} />}
              Search
            </button>
          </div>
          {searchError && (
            <div css={css({ color: "#ef4444", fontSize: "13px", marginTop: "-0.25rem" })}>
              {searchError}
            </div>
          )}
          {fetchError && (
            <div css={css({ color: "#ef4444", fontSize: "13px", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px" })}>
              {fetchError}
            </div>
          )}
          <div css={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
            <span css={css({ fontSize: "13px", color: "#5f6368", fontWeight: 500 })}>Area size:</span>
            {(["small", "medium", "large"] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setBoxSize(s); mapRef.current?.snapToPreset(BOX_HALF_LAT[s]); }}
                css={css({
                  padding: "0.3rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid",
                  fontSize: "13px",
                  cursor: "pointer",
                  transition: "0.15s",
                  borderColor: boxSize === s ? "#007bff" : "rgba(0,0,0,0.15)",
                  backgroundColor: boxSize === s ? "#007bff" : "transparent",
                  color: boxSize === s ? "#fff" : "#333",
                  fontWeight: boxSize === s ? 600 : 400,
                  "&:hover": {
                    borderColor: "#007bff",
                    color: boxSize === s ? "#fff" : "#007bff",
                  },
                })}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            <span css={css({ fontSize: "12px", color: "#9aa0a6", marginLeft: "0.25rem" })}>
              {boxSize === "small" ? "~¼ mi" : boxSize === "medium" ? "~1 mi" : "~4 mi"} per side
            </span>
          </div>
          {/* Only mount the 2D map when the picker is actually shown – saves needless OSM tile requests */}
          {!booting && steps[step] == "front" && <MapComponent
            ref={mapRef}
            onRemove={handleRemove}
            onDone={handleDone}
            externalBounds={externalBounds}
          />}
        </Column>
      </FullscreenModal>

      <FullscreenModal isOpen={steps[step] == "processing"}>
        <Column gap="2rem">
          <Column gap="0.5rem">
            <Title>Generating 3D Map</Title>
            <Description>{buildStatus}</Description>
          </Column>
          <div css={css({ width: "100%" })}>
            <div css={css({ background: "#e5e7eb", borderRadius: "100px", height: "8px", overflow: "hidden" })}>
              <div css={css({
                width: `${buildProgress}%`,
                height: "100%",
                background: "linear-gradient(90deg, #007bff, #0057cc)",
                borderRadius: "100px",
                transition: "width 0.25s ease",
              })} />
            </div>
            <div css={css({ marginTop: "0.5rem", fontSize: "13px", color: "#9aa0a6", textAlign: "right" })}>
              {Math.round(buildProgress)}%
            </div>
          </div>
        </Column>
      </FullscreenModal>

      <Modal isOpen={!!hagaError} onClose={() => setHagaError("")}>
        <Column gap="0.5rem">
          <Title>Haga kunde inte laddas</Title>
          <Description>{hagaError}</Description>
          <Button isShow={true} onClick={loadHagaDemo}>
            Försök igen
          </Button>
        </Column>
      </Modal>

      {/* The demo stays in Haga: no "new area" or export buttons in the 3D view */}
      <PrevButton isShow={step === 1 && !isFetchingBuildings} onClick={handleClickPrevStep}>
        <ChevronLeft css={IconSize} /> {step === 2 ? "Välj nytt område" : "Prev Step"}
      </PrevButton>

      <NextButton
        isShow={step === 0 && !booting}
        disabled={isNextButtonDisabled}
        onClick={handleClickNextStep}
      >
        Generate <ChevronRight css={IconSize} />
      </NextButton>

      <NextButton
        isShow={false}
        onClick={handleClickExport}
        style={ghostMode ? { right: "calc(380px + 2.5rem)" } : undefined}
      >
        Export GLB <Download css={IconSize} />
      </NextButton>

      <Modal isOpen={isWarnModal} onClose={() => setIsWarnModal(false)}>
        <Column gap="0.5rem">
          <Title>The area is too big </Title>
          <Description>Do you want to proceed?</Description>
          <Button
            isShow={true}
            disabled={isNextButtonDisabled}
            onClick={() => {
              setIsWarnModal(false);
              generate();
            }}
          >
            Generate Anyway <ChevronRight css={IconSize} />
          </Button>
        </Column>
      </Modal>

      <Modal isOpen={isExportModal} onClose={() => setIsExportModal(false)}>
        <Column gap="0.5rem">
          <Title>Export</Title>

          <label css={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "13px", color: "#374151", cursor: "pointer", userSelect: "none" })}>
            <input
              type="checkbox"
              checked={includeGroundPlane}
              onChange={(e) => setIncludeGroundPlane(e.target.checked)}
              css={css({ width: "14px", height: "14px", cursor: "pointer", accentColor: "#007bff" })}
            />
            Include ground plane
          </label>

          <Row gap="0.5rem">
            <Button isShow={true} onClick={exportFile}>
              GLB Download <Download css={IconSize} />
            </Button>

          </Row>
        </Column>
      </Modal>


      {step === 2 && ghostMode && <GhostPanel />}
      {step === 2 && !walking && <IntroCard />}
      {step === 2 && <WalkHud ghostMode={ghostMode} />}
      {step === 2 && <ClockWeather ghostMode={ghostMode} />}
      {step === 2 && ghostMode && <GhostMeter />}

      <Space></Space>
    </div>
  );
}

export default App;
