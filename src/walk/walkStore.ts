import { create } from "zustand";
import { useGhostStore } from "@/ghost/ghostStore";
import { useOpenData } from "@/opendata/openDataStore";

export type WalkMode = "orbit" | "entering" | "walk" | "exiting";

export type MeterReading = {
  /** 0–100 local ghost energy where you stand */
  value: number;
  /** distance to the nearest wisp in metres, or null */
  nearestWispM: number | null;
};

type WalkStore = {
  mode: WalkMode;
  /** Street name under your feet (nearest named OSM street). */
  street: string | null;
  /** Compass heading in degrees (0 = north, 90 = east). */
  heading: number;
  meter: MeterReading;
  /** Screen position of a click on empty ground – the walk controls turn it into a target. */
  pendingClick: { x: number; y: number } | null;
  /** On-screen joystick (touch): x = right, y = forward, each −1…1. */
  joystick: { x: number; y: number };
  setJoystick: (x: number, y: number) => void;
  enter: () => void;
  exit: () => void;
  setMode: (mode: WalkMode) => void;
  setStreet: (street: string | null) => void;
  setHeading: (heading: number) => void;
  setMeter: (meter: MeterReading) => void;
  requestWalkTo: (x: number, y: number) => void;
  takeClick: () => { x: number; y: number } | null;
};

export const useWalkStore = create<WalkStore>((set, get) => ({
  mode: "orbit",
  street: null,
  heading: 0,
  meter: { value: 0, nearestWispM: null },
  pendingClick: null,
  joystick: { x: 0, y: 0 },
  setJoystick: (x, y) => set({ joystick: { x, y } }),
  enter: () => {
    if (get().mode !== "orbit") return;
    // open cards would cover the street view (and on phones the walk controls)
    useGhostStore.setState({ selectedId: null, selectedEntityId: null, selectedAcousticId: null });
    useOpenData.setState({ selectedAir: null, selectedPlace: null });
    set({ mode: "entering" });
  },
  exit: () => get().mode === "walk" && set({ mode: "exiting", pendingClick: null }),
  setMode: (mode) => set({ mode }),
  setStreet: (street) => get().street !== street && set({ street }),
  setHeading: (heading) => set({ heading }),
  setMeter: (meter) => set({ meter }),
  requestWalkTo: (x, y) => get().mode === "walk" && set({ pendingClick: { x, y } }),
  takeClick: () => {
    const c = get().pendingClick;
    if (c) set({ pendingClick: null });
    return c;
  },
}));
