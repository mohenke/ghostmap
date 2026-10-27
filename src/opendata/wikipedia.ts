// Places with history from Swedish Wikipedia (CC BY-SA 4.0, no key, CORS via origin=*).
// One geosearch generator query returns coordinates, intro extract, thumbnail and URL.

export type HistoryPlace = {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
  extract: string;
  thumbnail?: string;
  url: string;
};

const API = "https://sv.wikipedia.org/w/api.php";

type RawPage = {
  pageid: number;
  title: string;
  coordinates?: Array<{ lat: number; lon: number }>;
  extract?: string;
  thumbnail?: { source: string };
  fullurl?: string;
};

/** Pure: merge pages from several continued responses. */
export function mergePages(target: Map<number, HistoryPlace>, pages: RawPage[]) {
  for (const p of pages) {
    const c = p.coordinates?.[0];
    const prev = target.get(p.pageid);
    const place: HistoryPlace = {
      pageid: p.pageid,
      title: p.title,
      lat: c?.lat ?? prev?.lat ?? NaN,
      lon: c?.lon ?? prev?.lon ?? NaN,
      extract: p.extract || prev?.extract || "",
      thumbnail: p.thumbnail?.source ?? prev?.thumbnail,
      url: p.fullurl ?? prev?.url ?? `https://sv.wikipedia.org/?curid=${p.pageid}`,
    };
    target.set(p.pageid, place);
  }
}

export async function fetchHistoryPlaces(lat: number, lon: number, radiusM = 600): Promise<HistoryPlace[]> {
  // The API occasionally returns an empty result on the first call – try once more.
  const first = await fetchOnce(lat, lon, radiusM);
  return first.length ? first : fetchOnce(lat, lon, radiusM);
}

async function fetchOnce(lat: number, lon: number, radiusM: number): Promise<HistoryPlace[]> {
  const params: Record<string, string> = {
    action: "query", format: "json", formatversion: "2", origin: "*",
    generator: "geosearch", ggscoord: `${lat}|${lon}`, ggsradius: String(radiusM), ggslimit: "50",
    prop: "coordinates|extracts|pageimages|info", colimit: "max",
    exintro: "1", explaintext: "1", exsentences: "3", exlimit: "max",
    piprop: "thumbnail", pithumbsize: "320", inprop: "url",
  };
  const places = new Map<number, HistoryPlace>();
  let cont: Record<string, string> = {};
  // Extracts come 20 at a time – follow "continue" a few rounds.
  for (let round = 0; round < 5; round++) {
    const res = await fetch(`${API}?${new URLSearchParams({ ...params, ...cont })}`);
    if (!res.ok) throw new Error(`Wikipedia svarade ${res.status}`);
    const json = await res.json();
    mergePages(places, json.query?.pages ?? []);
    if (!json.continue) break;
    cont = json.continue;
  }
  return [...places.values()].filter((p) => isFinite(p.lat) && isFinite(p.lon));
}
