/**
 * The product symbol, as markup the viewer can inline (TL-471).
 *
 * WHY A MODULE AND NOT A FILE READ. The versioned source is
 * `docs/brand/logo/branchling-symbol-color.svg`, but `docs/` is not in the npm // product-name: allow
 * tarball, and the viewer is one self-contained page that is mailed around, so
 * the page cannot point at a file either. The two paths are copied here; the
 * test `brand-mark.test.mjs` fails if they drift from the versioned source.
 *
 * WHY THE DISCLOSURE TRAVELS WITH IT. The mark was produced with AI involvement,
 * and the brand terms require that statement to stay in every derived SVG
 * (Article 50 of the EU AI Act). The favicon is a derived SVG.
 */

import { PRODUCT_NAME as N } from "./product.mjs";

export const SYMBOL_VIEWBOX = "44 44 314 314";

export const SYMBOL_STEM_PATH =
  "M98.1 48 L143.55 48 C148.84 48 153.13 52.29 153.13 57.58 L153.13 327.65 C153.13 332.94 148.84 337.23 143.55 337.23 L98.1 337.23 C92.81 337.23 88.52 332.94 88.52 327.65 L88.52 57.58 C88.52 52.29 92.81 48 98.1 48 Z";

export const SYMBOL_SHOOT_PATH =
  "M197.67 119.32 C206.92 118.33 216.73 118.74 227.06 120.57 C247.8 124.22 265.07 132.53 278.71 145.42 C292.24 158.2 301.7 174.09 306.98 192.94 C312.18 211.5 312.87 231.63 309.06 253.24 C305.3 274.59 297.83 293.16 286.68 308.89 C275.37 324.86 261.23 336.67 244.4 344.21 C227.38 351.83 208.59 353.87 188.27 350.29 C177.67 348.42 168.09 345.41 159.56 341.27 C155.48 339.3 151.63 337.06 148.03 334.57 L160.79 262.22 C162.22 268.81 165 274.86 169.7 279.9 C175.44 286.03 183.76 288.97 191.85 290.39 C200 291.83 208.41 291.61 215.86 287.67 C222.78 284 228.43 278.36 232.93 270.64 C237.76 262.35 241.15 252.68 243.1 241.61 C245.03 230.68 245.11 220.53 243.34 211.12 C241.69 202.34 238.18 195.09 232.71 189.18 C226.77 182.75 218.53 179.58 210.06 178.09 C202.33 176.73 194.14 176.79 187.03 180.49 C180.97 183.64 176.37 188.44 172.8 194.1 L185.6 121.5 C189.51 120.5 193.53 119.77 197.67 119.32 Z";

export const AI_DISCLOSURE =
  "Generated with AI involvement (Brand Studio, Claude + VectorCraft); the design decisions were made by the client. Synthetic content within the meaning of Article 50 of the EU AI Act.";

/**
 * A standalone SVG for `<link rel="icon">`. The browser renders a favicon in
 * its own chrome, not in the page, so the page's CSS tokens do not reach it;
 * the colours follow the browser's scheme through a media query of its own.
 */
export function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SYMBOL_VIEWBOX}">` +
    `<title>${N}</title><desc>${AI_DISCLOSURE}</desc>` +
    `<style>.s{fill:#1E1C1A}.b{fill:#D9480F}` +
    `@media (prefers-color-scheme:dark){.s{fill:#F5F2EE}.b{fill:#FF7A3D}}</style>` +
    `<path class="s" d="${SYMBOL_STEM_PATH}"/><path class="b" d="${SYMBOL_SHOOT_PATH}"/></svg>`;
}

export function faviconDataUri() {
  return "data:image/svg+xml," + encodeURIComponent(faviconSvg());
}

/**
 * The inline header mark. Its colours are the page's `--brand-stem` and
 * `--brand-shoot` tokens, so it follows the same theme as everything around it.
 */
export function headerMarkSvg() {
  return `<svg class="brand-mark" viewBox="${SYMBOL_VIEWBOX}" role="img" aria-label="${N}">` +
    `<title>${N}</title>` +
    `<path class="brand-stem" d="${SYMBOL_STEM_PATH}"/><path class="brand-shoot" d="${SYMBOL_SHOOT_PATH}"/></svg>`;
}
