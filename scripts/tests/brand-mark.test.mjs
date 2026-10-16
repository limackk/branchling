/** The inlined symbol stays the versioned brand symbol (TL-471). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, isolateHome } from "./_repo.mjs";
import {
  AI_DISCLOSURE, SYMBOL_SHOOT_PATH, SYMBOL_STEM_PATH, faviconDataUri, faviconSvg, headerMarkSvg,
} from "../brand-mark.mjs";

isolateHome("brand-mark");

const SOURCE = join(REPO_ROOT, "docs", "brand", "logo", "branchling-symbol-color.svg");

test("the inlined paths are the paths of the versioned symbol, in order", () => {
  const svg = readFileSync(SOURCE, "utf8");
  const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(paths.length, 2, "the versioned symbol is expected to be a stem and a shoot");
  assert.deepEqual(paths, [SYMBOL_STEM_PATH, SYMBOL_SHOOT_PATH]);
});

test("the favicon carries the same AI disclosure as the versioned symbol", () => {
  const svg = readFileSync(SOURCE, "utf8");
  assert.ok(svg.includes(`<desc>${AI_DISCLOSURE}</desc>`));
  assert.ok(faviconSvg().includes(`<desc>${AI_DISCLOSURE}</desc>`));
});

test("the favicon is a data URI the page can carry without a file", () => {
  const uri = faviconDataUri();
  assert.match(uri, /^data:image\/svg\+xml,/);
  assert.equal(decodeURIComponent(uri.slice("data:image/svg+xml,".length)), faviconSvg());
  assert.ok(!uri.includes('"'), "a double quote would end the href attribute early");
});

test("the header mark takes its colours from page tokens, not literals", () => {
  const svg = headerMarkSvg();
  assert.match(svg, /class="brand-stem"/);
  assert.match(svg, /class="brand-shoot"/);
  assert.doesNotMatch(svg, /#[0-9A-Fa-f]{6}/);
  assert.match(svg, /role="img" aria-label="[^"]+"/);
});
