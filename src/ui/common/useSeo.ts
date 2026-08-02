import { useEffect } from "react";

export const SITE_NAME = "まんがDB";
export const SITE_ORIGIN = "https://izenmi.github.io";
export const BASE_PATH = import.meta.env.BASE_URL;
export const SITE_URL = `${SITE_ORIGIN}${BASE_PATH}`;
export const DEFAULT_DESCRIPTION =
  "日本語コミック(漫画)作品を原作者・作画家・出版社(レーベル)・受賞歴・テーマから検索できるファンデータベース。";
export const DEFAULT_OG_IMAGE = `${SITE_URL}og-image.png`;

function setMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/** Replaces every previously-injected JSON-LD block with the current page's set, so navigating
 *  from a page with structured data to one without doesn't leave stale data behind. */
function setJsonLd(blocks: Record<string, unknown>[]) {
  document.head.querySelectorAll('script[data-seo-jsonld="1"]').forEach((el) => el.remove());
  for (const data of blocks) {
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.dataset.seoJsonld = "1";
    el.textContent = JSON.stringify(data);
    document.head.appendChild(el);
  }
}

export interface SeoOptions {
  /** Page-specific title; the site name is appended automatically. Pass undefined for the home page. */
  title?: string;
  description?: string;
  image?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

/** Sets document.title, meta description, canonical link, OGP/Twitter card tags, and JSON-LD
 *  structured data for the current page. The canonical/og:url is built from SITE_ORIGIN, not
 *  window.location.origin: scripts/prerender.mjs captures pages from a local `vite preview`
 *  server (http://localhost:PORT), and a canonical URL must always point at the real production
 *  domain regardless of what host actually served the request. Only the *path* comes from
 *  window.location, which also has the effect of stripping query strings from the canonical
 *  URL — filtered/sorted/paginated list views are variants of the same page, not distinct
 *  content, so they should all canonicalize to one URL. */
export function useSeo({ title, description = DEFAULT_DESCRIPTION, image = DEFAULT_OG_IMAGE, jsonLd }: SeoOptions) {
  useEffect(() => {
    const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} | 日本語コミック検索データベース`;
    document.title = fullTitle;

    const url = `${SITE_ORIGIN}${window.location.pathname}`;

    setMeta("name", "description", description);
    setCanonical(url);

    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", description);
    setMeta("property", "og:type", "website");
    setMeta("property", "og:url", url);
    setMeta("property", "og:site_name", SITE_NAME);
    setMeta("property", "og:image", image);
    setMeta("property", "og:locale", "ja_JP");

    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", image);

    setJsonLd(jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, image, JSON.stringify(jsonLd)]);
}

/** Builds a schema.org BreadcrumbList for a detail page: home → list → current item. */
export function breadcrumbJsonLd(trail: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: `${SITE_ORIGIN}${step.path}`,
    })),
  };
}
