// Short explanation shown when the demo opens; remembers when it was closed.
import { css } from "@emotion/react";
import { useState } from "react";
import { useGhostStore } from "./ghostStore.ts";

const STORAGE_KEY = "ghost-pulse-intro-dismissed";

export function IntroCard() {
  const ghostMode = useGhostStore((s) => s.ghostMode);
  const setGhostMode = useGhostStore((s) => s.setGhostMode);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "1";
    } catch {
      return true;
    }
  });
  if (!open) return null;

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* private mode – fine */
    }
  };

  return (
    <div
      css={css({
        position: "absolute",
        bottom: "2.8rem",
        left: "1rem",
        width: "340px",
        maxWidth: "calc(100vw - 2rem)",
        zIndex: 1500,
        padding: "14px 16px",
        borderRadius: "12px",
        background: "rgba(7, 8, 20, 0.88)",
        border: "1px solid rgba(139, 92, 246, 0.35)",
        boxShadow: "0 0 30px rgba(88, 28, 235, 0.25)",
        color: "#e5e7ff",
        fontSize: "12.5px",
        lineHeight: 1.5,
        backdropFilter: "blur(10px)",
        userSelect: "text",
        "@media (max-width: 768px)": { display: "none" },
      })}
    >
      <div css={css({ fontWeight: 800, letterSpacing: "0.14em", fontSize: "13px", color: "#c4b5fd", marginBottom: 6 })}>
        VÄLKOMMEN TILL GHOST PULSE
      </div>
      <ul css={css({ margin: "0 0 10px", paddingLeft: "1.1em", "& li": { marginBottom: 3 } })}>
        <li>
          En <b>verklig 3D-modell av Haga</b> i Göteborg, byggd från öppen data: hus, tak, träd, gator och terräng.
        </li>
        <li>
          <b>Verklig live-data</b>: väder från SMHI, luftsensorer, historia från Wikipedia och månen.
        </li>
        <li>
          Slå på <b>Ghost Mode</b> för att se spöksensorer, irrbloss och en varulvsdetektor – med <b>fiktiv</b> spökdata.
        </li>
        <li>Dra för att rotera, scrolla för att zooma, klicka på hus och markörer. Eller gå ned på gatan.</li>
      </ul>
      <div css={css({ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 })}>
        <button
          onClick={close}
          css={css({ border: "1px solid rgba(139, 92, 246, 0.35)", background: "transparent", color: "#9ca3c7", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "12px" })}
        >
          Stäng
        </button>
        {!ghostMode && (
          <button
            onClick={() => { setGhostMode(true); close(); }}
            css={css({
              border: "1px solid #a855f7",
              background: "linear-gradient(90deg, #6d28d9, #a855f7)",
              color: "#ffffff",
              fontWeight: 700,
              borderRadius: "6px",
              padding: "5px 12px",
              cursor: "pointer",
              fontSize: "12px",
              boxShadow: "0 0 14px rgba(168,85,247,0.5)",
            })}
          >
            👻 Slå på Ghost Mode
          </button>
        )}
      </div>
    </div>
  );
}
