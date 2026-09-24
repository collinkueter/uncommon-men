import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** Remember each history entry without reacting to live data updates. */
export function RouteScroll() {
  const location = useLocation();
  const navigation = useNavigationType();
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useLayoutEffect(() => {
    const target = navigation === "POP" ? positions.current.get(location.key) ?? 0 : 0;
    let restoring = true;
    const restore = () => {
      window.scrollTo({ top: target, left: 0, behavior: "instant" });
      if (Math.abs(window.scrollY - target) < 1) {
        restoring = false;
        observer.disconnect();
      }
    };
    // A lazy route may initially be shorter than its saved scroll position.
    const observer = new ResizeObserver(restore);
    observer.observe(document.body);
    restore();
    const remember = () => {
      if (!restoring) positions.current.set(location.key, window.scrollY);
    };
    const cancelRestore = () => {
      restoring = false;
      observer.disconnect();
    };
    window.addEventListener("scroll", remember, { passive: true });
    window.addEventListener("wheel", cancelRestore, { passive: true });
    window.addEventListener("touchstart", cancelRestore, { passive: true });
    window.addEventListener("keydown", cancelRestore);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", remember);
      window.removeEventListener("wheel", cancelRestore);
      window.removeEventListener("touchstart", cancelRestore);
      window.removeEventListener("keydown", cancelRestore);
    };
  }, [location.key, navigation]);

  return null;
}
