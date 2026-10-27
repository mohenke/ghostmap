// Info cards float next to the clicked object on desktop. On phones that would
// push them off-screen, so they open as a sheet at the bottom of the screen
// instead (rendered through a portal, outside the 3D canvas).
import { css } from "@emotion/react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "./useIsMobile.ts";

export function CardSheet({ children }: { children: ReactNode }) {
  const mobile = useIsMobile();
  if (!mobile) return <>{children}</>;
  return createPortal(
    <div
      data-card-sheet=""
      css={css({
        position: "absolute",
        left: 8,
        right: 8,
        bottom: 8,
        zIndex: 2500,
        maxHeight: "62vh",
        overflowY: "auto",
        borderRadius: 14,
        boxShadow: "0 -6px 30px rgba(0,0,0,0.45)",
        // the cards have a fixed desktop width – let them fill the sheet
        "& > div": { width: "100% !important", maxWidth: "none !important", boxSizing: "border-box" },
      })}
    >
      {children}
    </div>,
    document.getElementById("root") ?? document.body
  );
}
