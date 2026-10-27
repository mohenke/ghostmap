import { create } from "zustand";

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
  enter: () => get().mode === "orbit" && set({ mode: "entering" }),
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
