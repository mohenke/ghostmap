// Real citizen-science air sensors from Sensor.community (open data, no key, CORS).
// https://sensor.community – PM2.5/PM10 (SDS011 etc.), temperature/humidity (DHT22, BME280).
// One physical station often reports several sensor types from the same location;
// they are merged per location.

export type AirStation = {
  id: string;
  lat: number;
  lon: number;
  pm25?: number; // µg/m³ ("P2")
  pm10?: number; // µg/m³ ("P1")
  temperature?: number; // °C
  humidity?: number; // %
  sensorTypes: string[];
  timestamp: number;
};

type Raw = {
  timestamp: string;
  location: { latitude: string; longitude: string; indoor?: number; id: number };
  sensor: { id: number; sensor_type: { name: string } };
  sensordatavalues: Array<{ value: string; value_type: string }>;
};

/** Pure: raw API rows → one station per location, latest values. */
export function parseAirSensors(rows: Raw[]): AirStation[] {
  const byLoc = new Map<string, AirStation>();
  for (const r of rows) {
    if (r.location.indoor) continue;
    const key = String(r.location.id);
    const ts = Date.parse(r.timestamp.replace(" ", "T") + "Z");
    const st = byLoc.get(key) ?? {
      id: key,
      lat: parseFloat(r.location.latitude),
      lon: parseFloat(r.location.longitude),
      sensorTypes: [],
      timestamp: ts,
    };
    if (!st.sensorTypes.includes(r.sensor.sensor_type.name)) st.sensorTypes.push(r.sensor.sensor_type.name);
    st.timestamp = Math.max(st.timestamp, ts);
    for (const v of r.sensordatavalues) {
      const n = parseFloat(v.value);
      if (!isFinite(n)) continue;
      if (v.value_type === "P2" && n >= 0 && n < 1000) st.pm25 = n;
      if (v.value_type === "P1" && n >= 0 && n < 1000) st.pm10 = n;
      if (v.value_type === "temperature" && n > -50 && n < 60) st.temperature = n;
      if (v.value_type === "humidity" && n >= 0 && n <= 100) st.humidity = n;
    }
    byLoc.set(key, st);
  }
  return [...byLoc.values()].filter((s) => isFinite(s.lat) && isFinite(s.lon));
}

export async function fetchAirSensors(lat: number, lon: number, radiusKm = 3): Promise<AirStation[]> {
  const res = await fetch(`https://data.sensor.community/airrohr/v1/filter/area=${lat},${lon},${radiusKm}`);
  if (!res.ok) throw new Error(`Sensor.community svarade ${res.status}`);
  return parseAirSensors(await res.json());
}

/** Distance in metres (equirectangular – fine at city scale). */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number) {
  const x = (bLon - aLon) * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180)) * 111320;
  const y = (bLat - aLat) * 111320;
  return Math.hypot(x, y);
}

/** Inverse-distance weighted PM2.5 at a point, or null without PM sensors. */
export function interpolatePm25(stations: AirStation[], lat: number, lon: number): number | null {
  let wsum = 0, vsum = 0;
  for (const s of stations) {
    if (s.pm25 === undefined) continue;
    const d = Math.max(50, distanceM(lat, lon, s.lat, s.lon));
    const w = 1 / (d * d);
    wsum += w;
    vsum += w * s.pm25;
  }
  return wsum ? vsum / wsum : null;
}

/** Swedish words for PM2.5 levels (roughly following the European Air Quality Index). */
export function pmLabel(pm25: number): string {
  if (pm25 < 5) return "Mycket bra";
  if (pm25 < 10) return "Bra";
  if (pm25 < 20) return "Måttlig";
  if (pm25 < 25) return "Dålig";
  return "Mycket dålig";
}
