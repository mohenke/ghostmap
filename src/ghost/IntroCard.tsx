// Short explanation shown when the demo opens; remembers when it was closed.
import { css } from "@emotion/react";
import { useState } from "react";

const STORAGE_KEY = "ghost-pulse-intro-dismissed";

export function IntroCard() {
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
          En <b>verklig 3D-modell av Haga</b> i Göteborg, byggd från OpenStreetMap: hus, tak, träd, gator och terräng.
        </li>
        <li>
          Sex <b>fiktiva spöksensorer</b>. Mätvärdena simuleras i webbläsaren var femte sekund.
        </li>
        <li>
          <b>Verkligt väder</b> från SMHI: regn, dimma, moln och vind visas i modellen.
        </li>
        <li>Klicka på en sensor för mätvärden. Dra för att rotera, scrolla för att zooma.</li>
      </ul>
      <div css={css({ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 })}>
        <span css={css({ color: "#8b90b8", fontSize: "11px" })}>Dagsläge: knappen uppe till höger</span>
        <button
          onClick={close}
          css={css({
            border: "1px solid #a855f7",
            background: "rgba(168, 85, 247, 0.2)",
            color: "#f5f3ff",
            borderRadius: "6px",
            padding: "4px 12px",
            cursor: "pointer",
            fontSize: "12px",
          })}
        >
          Okej, visa spökena
        </button>
      </div>
    </div>
  );
}
