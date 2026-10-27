// One breakpoint for the whole app: phones (and small portrait tablets) get the mobile layout.
import { useEffect, useState } from "react";

export const MOBILE_QUERY = "(max-width: 768px)";

export function isMobileNow() {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile() {
  const [mobile, setMobile] = useState(isMobileNow);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}
