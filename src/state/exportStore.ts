import { create } from "zustand";

type ActionStore = {
  action: boolean;
  exportType: "glb";
  includeGroundPlane: boolean;

  setAction: (action: boolean) => void;
  setIncludeGroundPlane: (v: boolean) => void;
};

export const useActionStore = create<ActionStore>((set) => ({
  action: false,
  exportType: "glb",
  includeGroundPlane: true,
  setAction: (action) => set(() => ({ action: action })),
  setIncludeGroundPlane: (v) => set(() => ({ includeGroundPlane: v })),
}));
