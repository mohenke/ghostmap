// Info card shown when a building is clicked.
// Everything is derived from OpenStreetMap so it works for every building –
// not only the few with an address or a name. Estimates are labelled as such.
import * as THREE from "three";
import { useAreaStore } from "@/state/areaStore";
import { useGhostStore } from "@/ghost/ghostStore";
import { localGhostEnergy, wispPosition } from "@/ghost/localEnergy";
import { nearestStreetName } from "@/ghost/streetGraph";
import { getStreetGraph } from "@/ghost/useStreetGraph";
import { energyColorCss } from "@/ghost/labels";
import { METERS_PER_UNIT, buildingLevels, pointInRing } from "./geo";
import { buildingColours, polygonArea, roofPlan } from "./roofs";
import { keepEventsInCard } from "./htmlEvents";
import { useOpenData } from "@/opendata/openDataStore";

export type BuildingInfo = {
  id: string;
  osmType?: string;
  tags: Record<string, string>;
  /** Footprint in lat/lng (for "what's inside") */
  ring: Array<{ lat: number; lng: number }>;
  /** Footprint in shape space (x east, y north) */
  pts: THREE.Vector2[];
  /** Ground-floor height in scene units */
  base: number;
};

const TYPE_LABEL: Record<string, string> = {
  apartments: "Bostadshus", residential: "Bostadshus", house: "Villa", detached: "Villa", terrace: "Radhus",
  university: "Universitetsbyggnad", school: "Skola", civic: "Offentlig byggnad", retail: "Butikshus",
  commercial: "Affärshus", office: "Kontorshus", church: "Kyrka", kiosk: "Kiosk", shed: "Bod", hut: "Stuga",
  garage: "Garage", garages: "Garage", hotel: "Hotell", industrial: "Industribyggnad", public: "Offentlig byggnad",
  service: "Teknikhus", roof: "Tak", yes: "Byggnad",
};
const AMENITY_LABEL: Record<string, string> = {
  community_centre: "Föreningshus", marketplace: "Saluhall", place_of_worship: "Kyrka", library: "Bibliotek",
  cafe: "Kafé", restaurant: "Restaurang", pub: "Pub", bar: "Bar", fast_food: "Snabbmat", ice_cream: "Glassbar",
  theatre: "Teater", cinema: "Biograf", arts_centre: "Kulturhus", school: "Skola", shelter: "Väderskydd",
};
const SHOP_LABEL: Record<string, string> = {
  clothes: "kläder", hairdresser: "frisör", gift: "presenter", art: "konst", confectionery: "godis", houseware: "hem",
  books: "böcker", supermarket: "livsmedel", bakery: "bageri", jewelry: "smycken", shoes: "skor", florist: "blommor",
  antiques: "antikt", second_hand: "second hand", tea: "te", coffee: "kaffe", beauty: "skönhet", optician: "optiker",
};
const ROOF_LABEL = { flat: "Platt tak", gabled: "Sadeltak", hipped: "Valmat tak", pyramidal: "Pyramidtak" } as const;
const MATERIAL_LABEL: Record<string, string> = { brick: "Tegel", glass: "Glas", wood: "Trä", plaster: "Puts", stone: "Sten", metal: "Metall", concrete: "Betong" };

// Fictional ghost rumours – one per building, always the same for the same building.
const RUMOURS = [
  "Boende rapporterar kalla drag i trapphuset strax efter midnatt.",
  "Någon hörs gå i trappan – men hissen står still på bottenvåningen.",
  "En doft av nybakade kanelbullar dyker upp ur tomma intet.",
  "Fönstret på tredje våningen tänds av sig självt varje torsdag.",
  "En skugga i 1800-talskläder har setts vid porten i dimma.",
  "Kranarna i tvättstugan droppar i takt, som en hjärtrytm.",
  "Grannarna hör en spinnrock från vinden, där ingen bor.",
  "Brevlådans lock slår igen när det inte blåser.",
  "En katt som ingen äger sitter ofta i fönstret och stirrar ut mot gatan.",
  "Klockan i porten stannar alltid på 03:17.",
  "Någon nynnar på en gammal sjömansvisa i källaren.",
  "Snön smälter aldrig på en viss fläck framför huset.",
  "Hissknappen till en våning som inte finns lyser ibland.",
  "Gamla fotografier i trapphuset verkar byta plats under natten.",
  "Spårvagnsljud hörs från gården – men spåren ligger två kvarter bort.",
  "Boende vaknar av att någon knackar tre gånger på väggen.",
  "Taklampan i hallen svänger, fast luften är helt stilla.",
  "En lykta lyser upp vinden, fast ingen har varit där på åratal.",
  "Brandvarnaren piper bara när det är fullmåne.",
  "Barn berättar om en vänlig gammal herre som säger god natt.",
  "Fotspår i frost leder fram till dörren – men aldrig därifrån.",
  "Radion byter av sig själv till en kanal som bara spelar 1920-talsjazz.",
];

function stableIndex(id: string, n: number) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return Math.abs(h) % n;
}

function distToRing(x: number, y: number, pts: THREE.Vector2[]) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.y + dy * t - y));
  }
  return best;
}

const c = { text: "#eef0ff", muted: "#9ca3c7", faint: "#6b7099", line: "rgba(139, 92, 246, 0.25)", accent: "#c4b5fd" };

export function BuildingCard({ info, onClose }: { info: BuildingInfo; onClose: () => void }) {
  const projection = useAreaStore((s) => s.projection);
  const pois = useAreaStore((s) => s.details.pois);
  const history = useOpenData((s) => s.history);
  const ghostMode = useGhostStore((s) => s.ghostMode);
  const sensors = useGhostStore((s) => s.sensors);
  useGhostStore((s) => s.lastUpdate); // refresh ghost values with new readings
  const { tags, pts } = info;

  const plan = roofPlan(pts, tags);
  const { roof } = buildingColours(tags, info.id, plan.kind);
  const area = Math.abs(polygonArea(pts)) * METERS_PER_UNIT ** 2;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const world = { x: cx, z: -cy };

  // Where: the real address when OSM has it, otherwise the nearest street.
  const graph = getStreetGraph();
  const address = tags["addr:street"] ? `${tags["addr:street"]} ${tags["addr:housenumber"] ?? ""}`.trim() : null;
  const street = address ?? (graph ? nearestStreetName(graph, world.x, world.z, 25) : null);

  const type = (tags.amenity && AMENITY_LABEL[tags.amenity]) || TYPE_LABEL[tags.building] || "Byggnad";
  const levelsTagged = !!tags["building:levels"];
  const levels = buildingLevels(tags);
  const heightM = plan.top * METERS_PER_UNIT;

  // What's inside: named places whose point lies in (or right at the edge of) the footprint.
  const inside = projection
    ? pois.filter((poi) => {
        if (pointInRing(poi.lat, poi.lon, info.ring)) return true;
        const x = (poi.lon - projection.refLng) * projection.scaleX;
        const y = (poi.lat - projection.refLat) * projection.scaleY;
        return distToRing(x, y, pts) < 2.5;
      })
    : [];
  // History: Wikipedia articles whose coordinates fall inside or right next to the building.
  const stories = projection
    ? history.filter((h) => {
        if (/^Haga, Göteborg$/.test(h.title)) return false;
        if (pointInRing(h.lat, h.lon, info.ring)) return true;
        const x = (h.lon - projection.refLng) * projection.scaleX;
        const y = (h.lat - projection.refLat) * projection.scaleY;
        return distToRing(x, y, pts) < 3;
      })
    : [];
  const poiLabel = (t: Record<string, string>) =>
    AMENITY_LABEL[t.amenity] ?? (t.shop ? SHOP_LABEL[t.shop] ?? "butik" : t.tourism === "museum" ? "museum" : "");

  // Ghost Mode extras
  let ghost: { energy: number; sensor: string; distM: number; wisps: number } | null = null;
  if (ghostMode) {
    const p = { x: world.x, y: info.base + plan.top / 2, z: world.z };
    const energy = localGhostEnergy(p, false).value;
    let sensor = "–", best = Infinity;
    for (const s of sensors) {
      if (!s.position) continue;
      const d = Math.hypot(s.position[0] - world.x, s.position[2] - world.z);
      if (d < best) { best = d; sensor = s.name; }
    }
    const ents = useGhostStore.getState().entities;
    const wisps = ents.filter((e) => {
      const w = wispPosition(e);
      return Math.hypot(w.x - world.x, w.z - world.z) < 23; // ≈ 50 m
    }).length;
    ghost = { energy, sensor, distM: best * METERS_PER_UNIT, wisps };
  }

  const row = (k: string, v: React.ReactNode, note?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
      <span style={{ color: c.muted }}>{k}</span>
      <span style={{ color: c.text, textAlign: "right" }}>
        {v}
        {note && <span style={{ color: c.faint, fontSize: 10 }}> {note}</span>}
      </span>
    </div>
  );
  const osmUrl = `https://www.openstreetmap.org/${info.osmType ?? "way"}/${info.id}`;

  return (
    <div
      ref={keepEventsInCard}
      role="dialog"
      aria-label={tags.name || type}
      style={{
        width: 290,
        padding: "12px 14px",
        borderRadius: 12,
        background: "rgba(9, 9, 26, 0.93)",
        border: `1px solid ${c.line}`,
        boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
        color: c.text,
        fontSize: 12,
        fontFamily: "system-ui, -apple-system, sans-serif",
        backdropFilter: "blur(8px)",
        userSelect: "text",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{tags.name || type}</div>
          <div style={{ color: c.muted, fontSize: 11 }}>
            {tags.name ? `${type} · ` : ""}
            {street ? (address ? street : `vid ${street}`) : "Haga, Göteborg"}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="Stäng"
          title="Stäng (Esc)"
          style={{ border: "none", background: "rgba(255,255,255,0.08)", color: c.text, borderRadius: 6, width: 22, height: 22, cursor: "pointer", fontSize: 15, lineHeight: "20px" }}
        >
          ×
        </button>
      </div>

      <div style={{ height: 1, background: c.line, margin: "8px 0" }} />
      {row("Våningar", levelsTagged ? `${levels}` : `≈ ${levels}`, levelsTagged ? undefined : "(uppskattat)")}
      {row("Höjd", `≈ ${heightM.toFixed(0)} m`, tags.height ? undefined : "(beräknat)")}
      {row("Grundyta", `${Math.round(area / 10) * 10} m²`)}
      {row(
        "Tak",
        <>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#" + roof.getHexString(), marginRight: 6, verticalAlign: "-1px", border: "1px solid rgba(255,255,255,0.3)" }} />
          {ROOF_LABEL[plan.kind]}
        </>,
        tags["roof:shape"] ? undefined : "(uppskattat)"
      )}
      {tags["building:material"] && row("Fasad", MATERIAL_LABEL[tags["building:material"]] ?? tags["building:material"])}
      {tags.start_date && row("Byggår", tags.start_date)}

      {inside.length > 0 && (
        <>
          <div style={{ height: 1, background: c.line, margin: "8px 0" }} />
          <div style={{ color: c.muted, marginBottom: 3 }}>I huset</div>
          {inside.slice(0, 6).map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
              <span style={{ fontWeight: 600 }}>{p.tags.name}</span>
              <span style={{ color: c.faint }}>{poiLabel(p.tags)}</span>
            </div>
          ))}
          {inside.length > 6 && <div style={{ color: c.faint }}>+ {inside.length - 6} till</div>}
        </>
      )}

      {stories.length > 0 && (
        <>
          <div style={{ height: 1, background: c.line, margin: "8px 0" }} />
          <div style={{ color: "#fbbf24", fontSize: 10, letterSpacing: "0.1em", marginBottom: 3 }}>📜 HISTORIA</div>
          {stories.slice(0, 2).map((h) => (
            <div key={h.pageid} style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>{h.title}</div>
              <div style={{ color: c.muted, lineHeight: 1.4 }}>{h.extract.length > 220 ? h.extract.slice(0, 220) + "…" : h.extract}</div>
              <a href={h.url} target="_blank" rel="noreferrer" style={{ color: "#fbbf24", fontSize: 10.5 }}>Wikipedia ↗</a>
            </div>
          ))}
        </>
      )}

      {ghost && (
        <>
          <div style={{ height: 1, background: c.line, margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ color: c.accent, letterSpacing: "0.08em", fontSize: 10, fontWeight: 700 }}>SPÖKAKTIVITET</span>
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 18, fontWeight: 700, color: energyColorCss(ghost.energy) }}>
              {Math.round(ghost.energy)}
              <span style={{ fontSize: 11, color: c.muted, fontWeight: 400 }}>
                {" · "}
                {ghost.energy >= 70 ? "mycket hög" : ghost.energy >= 45 ? "förhöjd" : ghost.energy >= 20 ? "svag" : "lugnt"}
              </span>
            </span>
          </div>
          {row("Närmaste sensor", `${ghost.sensor}, ${Math.round(ghost.distM)} m`)}
          {row("Irrbloss inom 50 m", `${ghost.wisps}`)}
          <div style={{ marginTop: 6, padding: "7px 9px", borderRadius: 8, background: "rgba(168, 85, 247, 0.12)", fontStyle: "italic", lineHeight: 1.4 }}>
            ”{RUMOURS[stableIndex(info.id, RUMOURS.length)]}”
          </div>
          <div style={{ fontSize: 10, color: "#fb923c", marginTop: 4 }}>⚠ Spökryktet och spökvärdena är fiktiva</div>
        </>
      )}

      <div style={{ height: 1, background: c.line, margin: "8px 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: c.faint, gap: 8 }}>
        <span>Data: OpenStreetMap-bidragsgivare</span>
        <a href={osmUrl} target="_blank" rel="noreferrer" style={{ color: c.accent }}>
          Visa på OSM ↗
        </a>
      </div>
    </div>
  );
}
