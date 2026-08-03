import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** react-router doesn't reset scroll position on navigation like a full page load would —
 *  without this, clicking a link while scrolled down leaves the next page scrolled down too. */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
