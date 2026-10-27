// Real open data shown alongside the fictional ghost data.
import { useEffect } from "react";
import { create } from "zustand";
import { WEATHER_POINT } from "@/weather/weatherStore";
import { fetchAirSensors, type AirStation } from "./airSensors.ts";
import { fetchHistoryPlaces, type HistoryPlace } from "./wikipedia.ts";

type Status = "loading" | "live" | "error";

export type OpenDataLayers = { air: boolean; history: boolean; ectoplasm: boolean; moon: boolean };

type OpenDataStore = {
  air: AirStation[];
  airStatus: Status;
  airUpdated: number;
  history: HistoryPlace[];
  historyStatus: Status;
  selectedPlace: number | null;
  selectedAir: string | null;
  layers: OpenDataLayers;
  selectPlace: (id: number | null) => void;
  selectAir: (id: string | null) => void;
  toggleLayer: (k: keyof OpenDataLayers) => void;
};

export const useOpenData = create<OpenDataStore>((set) => ({
  air: [],
  airStatus: "loading",
  airUpdated: 0,
  history: [],
  historyStatus: "loading",
  selectedPlace: null,
  selectedAir: null,
  layers: { air: true, history: true, ectoplasm: true, moon: true },
  selectPlace: (selectedPlace) => set({ selectedPlace, selectedAir: null }),
  selectAir: (selectedAir) => set({ selectedAir, selectedPlace: null }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
}));

const AIR_REFRESH_MS = 5 * 60 * 1000; // Sensor.community updates roughly every 2–5 minutes

/** Loads Wikipedia places once and refreshes the air sensors. Mount once (in App). */
export function useOpenDataFeed() {
  useEffect(() => {
    let cancelled = false;
    const { lat, lon } = WEATHER_POINT;
    fetchHistoryPlaces(lat, lon, 650)
      .then((history) => !cancelled && useOpenData.setState({ history, historyStatus: "live" }))
      .catch((err) => {
        console.warn("Wikipedia unavailable", err);
        if (!cancelled) useOpenData.setState({ historyStatus: "error" });
      });
    const loadAir = () =>
      fetchAirSensors(lat, lon, 2.5)
        .then((air) => !cancelled && useOpenData.setState({ air, airStatus: "live", airUpdated: Date.now() }))
        .catch((err) => {
          console.warn("Sensor.community unavailable", err);
          if (!cancelled) useOpenData.setState({ airStatus: "error" });
        });
    loadAir();
    const id = setInterval(loadAir, AIR_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
}
