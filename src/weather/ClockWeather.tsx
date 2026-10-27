// Live clock and current weather for Haga – top left of the 3D view.
import { css } from "@emotion/react";
import { useIsMobile } from "@/components/useIsMobile";
import { useGhostStore } from "@/ghost/ghostStore";
import { useEffect, useMemo, useState } from "react";
import { SYMBOLS, compass } from "./smhi.ts";
import { sunPosition, sunTimes } from "./sun.ts";
import { WEATHER_POINT, useWeatherStore } from "./weatherStore.ts";
import { daysToFullMoon, moonAge, moonIllumination, moonPhaseName, moonPosition } from "@/opendata/moon";
import { useOpenData } from "@/opendata/openDataStore";
import { interpolatePm25, pmLabel } from "@/opendata/airSensors";
import { moonBoost } from "@/ghost/useGhostFeed";

const TZ = "Europe/Stockholm"; // always show Göteborg time
const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
const fmt = (d: Date | null, opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" }) =>
  d ? d.toLocaleTimeString("sv-SE", { ...opts, timeZone: TZ }) : "–";

export function ClockWeather({ ghostMode }: { ghostMode: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const mobile = useIsMobile();
  const [expandedRaw, setExpandedRaw] = useState(false);
  const mobileFocus = useGhostStore((s) => s.mobileFocus);
  const expanded = expandedRaw && mobileFocus !== "panel";
  const setExpanded = (on: boolean) => {
    setExpandedRaw(on);
    useGhostStore.getState().setMobileFocus(on ? "clock" : null);
    if (on) useGhostStore.setState({ selectedId: null, selectedEntityId: null, selectedAcousticId: null }); // one overlay at a time
  };
  const weather = useWeatherStore((s) => s.weather);
  const status = useWeatherStore((s) => s.status);
  const air = useOpenData((s) => s.air);
  const airStatus = useOpenData((s) => s.airStatus);
  const pm = interpolatePm25(air, WEATHER_POINT.lat, WEATHER_POINT.lon);
  const pmStations = air.filter((a) => a.pm25 !== undefined).length;
  const illum = moonIllumination(now);
  const moonUp = moonPosition(now, WEATHER_POINT.lat, WEATHER_POINT.lon).elevation > 0;
  const toFull = daysToFullMoon(now);

  const day = now.toDateString();
  const sun = useMemo(() => sunTimes(now, WEATHER_POINT.lat, WEATHER_POINT.lon), [day]); // eslint-disable-line react-hooks/exhaustive-deps
  const elevation = sunPosition(now, WEATHER_POINT.lat, WEATHER_POINT.lon).elevation;
  const phase = elevation > 6 ? "Dag" : elevation > -6 ? (now.getHours() < 12 ? "Gryning" : "Skymning") : "Natt";

  const [icon, label] = SYMBOLS[weather.symbol] ?? ["☁️", "Väder"];
  const live = status === "live" || status === "simulated";
  const windTo = (weather.windFrom + 180) % 360;

  // dark in Ghost Mode, and in day mode once the sun has set
  const dark = ghostMode || elevation < -4;
  const c = {
    bg: dark ? "rgba(7, 8, 20, 0.82)" : "rgba(255, 255, 255, 0.82)",
    border: dark ? "rgba(139, 92, 246, 0.35)" : "rgba(0, 0, 0, 0.08)",
    text: dark ? "#eef0ff" : "#111827",
    muted: dark ? "#9ca3c7" : "#6b7280",
    accent: dark ? "#22d3ee" : "#7c3aed",
  };

  // Phones: a slim strip (time · weather · wind) that expands into the full panel on tap.
  if (mobile && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        aria-label="Visa klocka, väder, måne och luft"
        css={css({
          position: "absolute", top: "3.5rem", left: 8, zIndex: 1450, display: "flex", alignItems: "center", gap: 8,
          padding: "5px 10px", borderRadius: 999, background: c.bg, border: `1px solid ${c.border}`, color: c.text,
          backdropFilter: "blur(12px)", fontSize: 12, fontFamily: "inherit",
        })}
      >
        <b css={css({ fontFamily: mono, fontSize: 14 })}>{fmt(now)}</b>
        {live && (
          <>
            <span>{icon} {weather.temperature.toFixed(0)}°</span>
            <span css={css({ color: c.muted })}>{weather.windSpeed.toFixed(0)} m/s</span>
          </>
        )}
        <span css={css({ color: c.muted })}>▾</span>
      </button>
    );
  }

  return (
    <div
      onClick={mobile ? () => setExpanded(false) : undefined}
      css={css({
        position: "absolute",
        top: mobile ? "3.5rem" : "3.6rem",
        left: mobile ? 8 : "1rem",
        zIndex: 1450,
        width: 300,
        padding: "12px 14px",
        borderRadius: 14,
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
        backdropFilter: "blur(12px)",
        boxShadow: dark ? "0 0 30px rgba(88, 28, 235, 0.2)" : "0 6px 24px rgba(0,0,0,0.12)",
        userSelect: "none",
        "@media (max-width: 768px)": { width: "auto", right: 8, padding: "10px 12px", maxHeight: "70vh", overflowY: "auto" },
      })}
    >
      {/* clock */}
      <div css={css({ display: "flex", justifyContent: "space-between", alignItems: "flex-end" })}>
        <div>
          <div css={css({ fontFamily: mono, fontSize: 34, fontWeight: 700, lineHeight: 1, letterSpacing: "0.02em" })}>
            {fmt(now, { hour: "2-digit", minute: "2-digit" })}
            <span css={css({ fontSize: 16, color: c.muted, marginLeft: 4 })}>{fmt(now, { second: "2-digit" }).padStart(2, "0")}</span>
          </div>
          <div css={css({ fontSize: 11, color: c.muted, marginTop: 4, textTransform: "capitalize" })}>
            {now.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })} · Haga, Göteborg
          </div>
        </div>
        <div css={css({ textAlign: "right", fontSize: 11, color: c.muted, lineHeight: 1.5 })}>
          <div css={css({ color: c.accent, fontWeight: 700 })}>{phase}</div>
          <div title="Soluppgång">☀↑ {fmt(sun.sunrise)}</div>
          <div title="Solnedgång">☀↓ {fmt(sun.sunset)}</div>
        </div>
      </div>

      <div css={css({ height: 1, background: c.border, margin: "10px 0" })} />

      {/* weather */}
      {live ? (
        <>
          <div css={css({ display: "flex", alignItems: "center", gap: 12 })}>
            <span css={css({ fontSize: 40, lineHeight: 1 })} aria-hidden>{icon}</span>
            <div css={css({ flex: 1 })}>
              <div css={css({ fontSize: 30, fontWeight: 700, lineHeight: 1 })}>{weather.temperature.toFixed(0)}°</div>
              <div css={css({ fontSize: 12, color: c.muted, marginTop: 2 })}>{label}</div>
            </div>
            <div css={css({ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 })} title={`Vind från ${compass(weather.windFrom)}`}>
              <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
                <circle cx="17" cy="17" r="15" fill="none" stroke={c.border} strokeWidth="1.5" />
                <g transform={`rotate(${windTo} 17 17)`}>
                  <path d="M17 5 L22 16 L17 13 L12 16 Z" fill={c.accent} />
                  <line x1="17" y1="13" x2="17" y2="28" stroke={c.accent} strokeWidth="2" strokeLinecap="round" />
                </g>
              </svg>
              <span css={css({ fontSize: 11, fontWeight: 700 })}>{weather.windSpeed.toFixed(0)} m/s</span>
            </div>
          </div>
          <div css={css({ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 10, fontSize: 11 })}>
            {[
              ["Byar", `${weather.windGust.toFixed(0)} m/s`],
              ["Sikt", weather.visibilityKm >= 10 ? `${weather.visibilityKm.toFixed(0)} km` : `${weather.visibilityKm.toFixed(1)} km`],
              ["Nederbörd", `${weather.precipitation.toFixed(1)} mm/h`],
            ].map(([k, v]) => (
              <div key={k} css={css({ background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", borderRadius: 8, padding: "5px 7px" })}>
                <div css={css({ color: c.muted, fontSize: 10 })}>{k}</div>
                <div css={css({ fontWeight: 700, fontFamily: mono })}>{v}</div>
              </div>
            ))}
          </div>
          <div css={css({ fontSize: 10, color: c.muted, marginTop: 8 })}>
            {status === "simulated" ? "Simulerat väder (testläge)" : `Live från SMHI · prognos för ${fmt(new Date(weather.time))}`}
          </div>
        </>
      ) : (
        <div css={css({ fontSize: 12, color: c.muted })}>{status === "error" ? "Vädret kunde inte hämtas just nu" : "Hämtar väder från SMHI…"}</div>
      )}

      <div css={css({ height: 1, background: c.border, margin: "10px 0 8px" })} />
      {/* moon */}
      <div css={css({ display: "flex", alignItems: "center", gap: 10, fontSize: 12 })}>
        <span css={css({ fontSize: 22, lineHeight: 1 })} aria-hidden>{["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"][Math.round(moonAge(now) * 8) % 8]}</span>
        <div css={css({ flex: 1 })}>
          <div><b>{moonPhaseName(now)}</b> · {Math.round(illum * 100)} % belyst</div>
          <div css={css({ fontSize: 10.5, color: c.muted })}>
            {moonUp ? "Ovan horisonten" : "Under horisonten"} · {toFull < 0.6 || toFull > 28.9 ? "fullmåne nu" : `fullmåne om ${Math.round(toFull)} dagar`}
            {ghostMode && <span css={css({ color: "#c4b5fd" })}> · spökeffekt +{moonBoost().toFixed(0)}</span>}
          </div>
        </div>
      </div>
      {/* air */}
      <div css={css({ display: "flex", alignItems: "center", gap: 10, fontSize: 12, marginTop: 8 })}>
        <span css={css({ fontSize: 22, lineHeight: 1 })} aria-hidden>🌫</span>
        <div css={css({ flex: 1 })}>
          {pm !== null ? (
            <>
              <div><b>Luft: {pmLabel(pm)}</b> · PM2.5 {pm.toFixed(1)} µg/m³</div>
              <div css={css({ fontSize: 10.5, color: c.muted })}>
                {pmStations} luftsensorer · Sensor.community
                {ghostMode && <span css={css({ color: "#c4b5fd" })}> · styr ektoplasman</span>}
              </div>
            </>
          ) : (
            <div css={css({ color: c.muted })}>{airStatus === "error" ? "Luftsensorerna svarar inte" : "Hämtar luftsensorer…"}</div>
          )}
        </div>
      </div>
      <div css={css({ fontSize: 9.5, color: "#2dd4bf", marginTop: 8, letterSpacing: "0.05em" })}>● ALLT I DEN HÄR RUTAN ÄR VERKLIG DATA</div>
    </div>
  );
}
