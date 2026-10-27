import { css } from "@emotion/react";
import { DetailedHTMLProps, ButtonHTMLAttributes, useState } from "react";
import { useIsMobile } from "@/components/useIsMobile";
import { useGhostStore } from "@/ghost/ghostStore";
import { useWalkStore } from "@/walk/walkStore";
import { sunPosition } from "@/weather/sun";
import { WEATHER_POINT } from "@/weather/weatherStore";

const TOP_PANEL_HEIGHT = "3rem";
const BORDER_COLOR = "#ededf290";

const breakpoints = [768];
const mq = breakpoints.map((bp) => `@media (max-width: ${bp}px)`);

interface ButtonProps
  extends DetailedHTMLProps<
    ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > {
  isShow?: boolean;
}

export function TopNav({ step }: { step: number }) {
  const walkMode = useWalkStore((state) => state.mode);

  const ghostMode = useGhostStore((state) => state.ghostMode);
  // The bars turn dark in Ghost Mode and after sunset in day mode.
  const darkBar = ghostMode || sunPosition(new Date(), WEATHER_POINT.lat, WEATHER_POINT.lon).elevation < -4;
  document.body.dataset.night = String(darkBar); // dark button style (index.css)
  const setGhostMode = useGhostStore((state) => state.setGhostMode);
  const mobile = useIsMobile();
  const [sourcesOpen, setSourcesOpen] = useState(false);

  return (
    <>
      <div
        css={css({
          display: "flex",
          transition: ".5s",
          transform: "translate(0px, 0px)",
          position: "absolute", // not "fixed": some blocker extensions hide fixed full-width bars
          top: 0,
          left: 0,
          width: "100%",
          height: TOP_PANEL_HEIGHT,
          backgroundColor: darkBar ? "rgba(7, 8, 20, 0.7)" : "#ffffff50",
          backdropFilter: "blur(12px)",
          borderBottom: `1px solid ${darkBar ? "rgba(139, 92, 246, 0.25)" : BORDER_COLOR}`,
          zIndex: 2000,
          justifyContent: "space-between",
          alignItems: "center",
        })}
      >
        <div
          css={css({
            paddingLeft: mobile ? "0.7rem" : "2rem",
            alignItems: "center",
            flexDirection: "row",
            display: "flex",
            gap: "0.75rem",
          })}
        >
          <span
            css={css({
              fontSize: "14px",
              fontWeight: "600",
              color: darkBar ? "#e5e7ff" : "#5b5d63",
              letterSpacing: "0.06em",
            })}
          >
            {mobile ? "👻" : "👻 GHOST PULSE"}
          </span>
          <span css={css({ fontSize: "11px", color: darkBar ? "#8b90b8" : "#9aa0a6", "@media (max-width: 1100px)": { display: "none" } })}>
            Haga, Göteborg
          </span>
        </div>

        {/* Centre: the two main controls, big and easy to find */}
        <div
          css={css({
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            display: step == 2 ? "flex" : "none",
            alignItems: "center",
            gap: "0.6rem",
          })}
        >
          <div
            role="radiogroup"
            aria-label="Visningsläge"
            css={css({
              display: "flex",
              padding: 3,
              borderRadius: 999,
              background: darkBar ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
              border: `1px solid ${darkBar ? "rgba(139, 92, 246, 0.35)" : "rgba(0,0,0,0.1)"}`,
            })}
          >
            {([
              [true, mobile ? "👻 Ghost" : "👻 Ghost Mode"],
              [false, mobile ? "🏙 Normal" : "🏙 Normalläge"],
            ] as const).map(([on, label]) => {
              const active = ghostMode === on;
              return (
                <button
                  key={label}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setGhostMode(on)}
                  css={css({
                    padding: mobile ? "0.4rem 0.75rem" : "0.42rem 1rem",
                    borderRadius: 999,
                    border: "none",
                    cursor: active ? "default" : "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "0.03em",
                    whiteSpace: "nowrap",
                    transition: "0.2s",
                    color: active ? "#ffffff" : darkBar ? "#a5a9cf" : "#4b5563",
                    background: active
                      ? on
                        ? "linear-gradient(90deg, #6d28d9, #a855f7)"
                        : "linear-gradient(90deg, #0e7490, #22d3ee)"
                      : "transparent",
                    boxShadow: active ? (on ? "0 0 16px rgba(168,85,247,0.6)" : "0 0 12px rgba(34,211,238,0.45)") : "none",
                    "&:hover": active ? {} : { color: darkBar ? "#ffffff" : "#111827" },
                  })}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <button
            disabled={walkMode === "entering" || walkMode === "exiting"}
            onClick={() => (walkMode === "orbit" ? useWalkStore.getState().enter() : useWalkStore.getState().exit())}
            css={css({
              padding: "0.48rem 1.1rem",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: "nowrap",
              cursor: "pointer",
              border: `1px solid ${walkMode === "orbit" ? (darkBar ? "rgba(34,211,238,0.6)" : "#0e7490") : "#fb923c"}`,
              color: darkBar ? "#e6fffb" : "#0e3a44",
              background: walkMode === "orbit" ? (darkBar ? "rgba(34,211,238,0.12)" : "rgba(34,211,238,0.18)") : "rgba(251,146,60,0.2)",
              "&:hover": { background: darkBar ? "rgba(34,211,238,0.22)" : "rgba(34,211,238,0.3)" },
              "&:disabled": { opacity: 0.6, cursor: "wait" },
            })}
          >
            {walkMode === "orbit" || walkMode === "exiting"
              ? (mobile ? "🚶 Gå" : "🚶 Gå på gatan")
              : (mobile ? "⬆ Upp" : "⬆ Lämna gatan")}
          </button>
        </div>
      </div>


      {/* ── Footer (on phones: a small "Källor" button that opens the credits) ── */}
      {mobile && (
        <button
          onClick={() => setSourcesOpen(!sourcesOpen)}
          aria-expanded={sourcesOpen}
          css={css({
            position: "absolute", right: 8, top: "0.6rem", zIndex: 2100, padding: "4px 8px", borderRadius: 999, fontSize: 11,
            border: `1px solid ${darkBar ? "rgba(139, 92, 246, 0.35)" : "rgba(0,0,0,0.15)"}`,
            background: darkBar ? "rgba(7, 8, 20, 0.8)" : "rgba(255,255,255,0.8)", color: darkBar ? "#c7cbee" : "#4b5563",
          })}
        >
          ⓘ
        </button>
      )}
      <div
        css={css({

          position: "absolute", // not "fixed": some blocker extensions hide fixed full-width bars
          bottom: 0,
          left: 0,
          width: "100%",
          padding: "0.4rem 1.5rem",
          backgroundColor: darkBar ? "rgba(7, 8, 20, 0.7)" : "#ffffff50",
          backdropFilter: "blur(12px)",
          borderTop: `1px solid ${darkBar ? "rgba(139, 92, 246, 0.25)" : BORDER_COLOR}`,
          zIndex: 2000,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxSizing: "border-box",
          fontSize: "11px",
          color: "#9aa0a6",
          "& a": { color: "inherit" },
          ...(mobile
            ? { display: sourcesOpen ? "flex" : "none", flexDirection: "column", alignItems: "flex-start", gap: 6, padding: "0.8rem 1rem 2.6rem", lineHeight: 1.5 }
            : {}),
        })}
      >
        <span>
          Kartdata ©{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap-bidragsgivare
          </a>{" "}
          (ODbL) · Väderdata:{" "}
          <a href="https://www.smhi.se/data" target="_blank" rel="noreferrer">SMHI</a> (CC BY 4.0) · Luft:{" "}
          <a href="https://sensor.community" target="_blank" rel="noreferrer">Sensor.community</a> · Historia:{" "}
          <a href="https://sv.wikipedia.org" target="_blank" rel="noreferrer">Wikipedia</a> (CC BY-SA) · Höjd: AWS Terrain Tiles ·
          Spökdata: simulerade och fiktiva
        </span>
        <span>
          Baserad på{" "}
          <a href="https://github.com/stonyp/mapforge" target="_blank" rel="noreferrer">Mapforge</a>{" "}
          (MIT) av AIssacArt
        </span>
      </div>
    </>
  );
}

export function NavButton(props: ButtonProps) {
  return (
    <button
      className="mf-btn"
      css={css({
        color: "#000000",
        backgroundColor: "#ffffff96",
        backdropFilter: "blur(8px)",
        border: "none",
        padding: "0.5rem 1rem",
        borderRadius: "8px",
        fontWeight: "300",
        fontSize: "12px",
        outline: "rgba(240, 240, 244, 0.51) solid 0.1rem",
        display: props.isShow ? "" : "none",
        cursor: "pointer",
      })}
      {...props}
    >
      {props.children}
    </button>
  );
}
