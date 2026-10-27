import * as THREE from "three";
import type { GhostEventType, RiskLevel } from "./types.ts";

export const EVENT_LABEL: Record<GhostEventType, string> = {
  temperature_drop: "Oförklarligt temperaturfall",
  ectoplasm: "Ektoplasmisk anomali",
  shadow_movement: "Skuggrörelse",
  whispers: "Registrerade viskningar",
  full_manifestation: "Full spektral manifestation",
  wisp: "Irrbloss",
  howl: "Varulvsylande",
};

export const EVENT_ICON: Record<GhostEventType, string> = {
  temperature_drop: "❄",
  ectoplasm: "◉",
  shadow_movement: "◐",
  whispers: "≋",
  full_manifestation: "☠",
  wisp: "✦",
  howl: "🐺",
};

const ACTIVITY_LABEL: Record<string, string> = {
  ...EVENT_LABEL,
  background_noise: "Bakgrundsbrus",
  emf_fluctuation: "Svag EMF-fluktuation",
  cold_spots: "Oregelbundna kallfickor",
  intense_spectral: "Intensiv spektral aktivitet",
};

export function activityLabel(key: string): string {
  return ACTIVITY_LABEL[key] ?? key;
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Låg",
  medium: "Medel",
  high: "Hög",
  critical: "Kritisk",
};

export const RISK_COLOR: Record<RiskLevel, string> = {
  low: "#22d3ee",
  medium: "#a855f7",
  high: "#fb923c",
  critical: "#f43f5e",
};

// Energy colour ramp used both in 3D and in the panel: cyan → violet → orange → red.
const RAMP: Array<[number, THREE.Color]> = [
  [0, new THREE.Color("#22d3ee")],
  [40, new THREE.Color("#a855f7")],
  [70, new THREE.Color("#fb923c")],
  [100, new THREE.Color("#f43f5e")],
];

export function energyColor(energy: number, target = new THREE.Color()): THREE.Color {
  const e = Math.max(0, Math.min(100, energy));
  for (let i = 1; i < RAMP.length; i++) {
    const [e1, c1] = RAMP[i];
    const [e0, c0] = RAMP[i - 1];
    if (e <= e1) return target.copy(c0).lerp(c1, (e - e0) / (e1 - e0));
  }
  return target.copy(RAMP[RAMP.length - 1][1]);
}

export function energyColorCss(energy: number): string {
  return "#" + energyColor(energy).getHexString();
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
