/**
 * build.js — ATProto Embed build script
 *
 * Produces a single self-contained dist/embed.js that can be loaded via a
 * <script> tag (e.g. from jsDelivr) with zero external dependencies:
 *
 *  1. Inlines all SVGs from public/ as data-URI strings in an ICONS map
 *  2. Replaces getBasePath() + getIconUrl() with a static ICONS lookup
 *  3. Inlines the CSS as a <style> tag (replaces the <link> approach)
 *  4. Writes the final self-contained embed.js to dist/
 *  5. Also copies embed.css to dist/ for users who prefer <link> loading
 *
 * Usage:
 *   node scripts/build.js
 *
 * No npm dependencies required.
 */

const fs = require("fs");
const path = require("path");

const SRC_JS = path.join(__dirname, "..", "src", "embed.js");
const SRC_CSS = path.join(__dirname, "..", "src", "embed.css");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const DIST_DIR = path.join(__dirname, "..", "dist");
const OUT_JS = path.join(DIST_DIR, "embed.js");
const OUT_CSS = path.join(DIST_DIR, "embed.css");

// ── 1. Read source files ──────────────────────────────────────────────────────
// Normalize to LF so all regex patterns work on any OS.

let js = fs.readFileSync(SRC_JS, "utf8").replace(/\r\n/g, "\n");
let css = fs.readFileSync(SRC_CSS, "utf8").replace(/\r\n/g, "\n");

// ── 2. Build ICONS map from public/*.svg ──────────────────────────────────────
// Only inline icons that are actually referenced in src/embed.js

const usedIcons = new Set();

const iconCallRegex = /getIconUrl\(([^)]*)\)/g;
let match;
while ((match = iconCallRegex.exec(js)) !== null) {
  const args = match[1];
  const strRe = /['"]([^'"]+)['"]/g;
  let sm;
  while ((sm = strRe.exec(args)) !== null) {
    usedIcons.add(sm[1]);
  }
}

function collectObjectIcons(label) {
  const re = new RegExp(`var ${label} = ([\\s\\S]*?);\\n`);
  const m = js.match(re);
  if (!m) return;
  const objText = m[1];
  const strRe = /['"]([^'"]+)['"]/g;
  let sm;
  while ((sm = strRe.exec(objText)) !== null) {
    usedIcons.add(sm[1]);
  }
}

collectObjectIcons("METRIC_ICONS");
collectObjectIcons("BADGE_ICONS");

const svgFiles = fs
  .readdirSync(PUBLIC_DIR)
  .filter(f => f.endsWith(".svg"))
  .filter(f => usedIcons.has(f.replace(".svg", "")));
const iconEntries = svgFiles.map(f => {
  const name = f.replace(".svg", "");
  const raw = fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8").trim();

  // Simple SVG optimization: strip comments, redundant spaces, and XML headers
  const optimized = raw
    .replace(/<!--[\s\S]*?-->/g, "")      // remove comments
    .replace(/<\?xml[\s\S]*?\?>/i, "")     // remove XML declaration
    .replace(/<!DOCTYPE[\s\S]*?>/i, "")    // remove DOCTYPE
    .replace(/\s+/g, " ")                  // collapse multiple spaces
    .replace(/>\s+</g, "><")               // remove space between tags
    .trim();

  if (!optimized) return null;

  // URL-encode for use as data URI (safe, no base64 bloat)
  const encoded = "data:image/svg+xml," + encodeURIComponent(optimized);
  return `    ${JSON.stringify(name)}: ${JSON.stringify(encoded)}`;
}).filter(Boolean);

const iconsBlock = `  var ICONS = {\n${iconEntries.join(",\n")}\n  };\n`;

// ── 3. Replace getBasePath + getIconUrl with ICONS lookup ─────────────────────
// Match the entire Icons section: the comment, getBasePath(), and getIconUrl()

const iconsRegex = /\/\* ─+ Icons ─+ \*\/\n\n\s*function getBasePath\(\)[\s\S]*?function getIconUrl\(name\) \{[^\}]*\}\n/;

if (!iconsRegex.test(js)) {
  console.error("✗ ERROR: Could not find Icons section to replace.");
  console.error("  Make sure src/embed.js has the /* ───── Icons ───── */ comment block");
  console.error("  followed by getBasePath() and getIconUrl() functions.");
  process.exit(1);
}

js = js.replace(
  iconsRegex,
  iconsBlock + "\n  function getIconUrl(name) {\n    return ICONS[name] || \"\";\n  }\n"
);

// ── 4. Inline CSS — replace injectStyles() <link> tag with <style> injection ──

// Minify CSS
const cssMinified = css
  .replace(/\/\*[\s\S]*?\*\//g, "")   // remove block comments
  .replace(/\s+/g, " ")               // collapse all whitespace
  .replace(/\s*([{}:;,])\s*/g, "$1")  // remove whitespace around delimiters
  .replace(/;}/g, "}")                // remove trailing semicolons
  .trim();

const injectStylesFn = `  function injectStyles(root) {
    var style = document.createElement("style");
    style.textContent = ${JSON.stringify(cssMinified)};
    root.appendChild(style);
  }`;

const injectRegex = /function injectStyles\(root\) \{[\s\S]*?root\.appendChild\(link\);\s*\}/;

if (!injectRegex.test(js)) {
  console.error("✗ ERROR: Could not find injectStyles(root) function to replace.");
  console.error("  Make sure src/embed.js has the injectStyles(root) function");
  console.error("  that ends with root.appendChild(link);");
  process.exit(1);
}

js = js.replace(injectRegex, injectStylesFn);

// ── 5. Ensure dist/ exists and write output ───────────────────────────────────

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR);

fs.writeFileSync(OUT_JS, js, "utf8");
// Also copy CSS to dist/ for users who prefer the <link> approach
fs.writeFileSync(OUT_CSS, css, "utf8");

// ── 6. Verify & Report ───────────────────────────────────────────────────────

// Quick sanity checks on the output
const output = fs.readFileSync(OUT_JS, "utf8");
const hasICONS = output.includes("var ICONS = {");
const hasStyleInject = output.includes('document.createElement("style")');
const hasNoBasePath = !output.includes("function getBasePath()");
const hasNoLinkTag = !output.includes('rel = "stylesheet"');

if (!hasICONS || !hasStyleInject || !hasNoBasePath || !hasNoLinkTag) {
  console.error("✗ WARNING: Build output may be incomplete:");
  if (!hasICONS) console.error("  - ICONS map not found");
  if (!hasStyleInject) console.error("  - Style injection not found");
  if (!hasNoLinkTag) console.error("  - <link> stylesheet injection was not replaced");
}

const srcSize = fs.statSync(SRC_JS).size;
const outSize = fs.statSync(OUT_JS).size;
console.log(`✓ SVGs inlined: ${svgFiles.length} icons`);
console.log(`✓ CSS inlined into JS (${(Buffer.byteLength(cssMinified, "utf8") / 1024).toFixed(1)} KB)`);
console.log(`✓ dist/embed.js written — ${(outSize / 1024).toFixed(1)} KB (src was ${(srcSize / 1024).toFixed(1)} KB)`);
console.log(`✓ dist/embed.css written (standalone copy)`);
console.log(`\nDone. Single file: dist/embed.js (everything inlined)`);
