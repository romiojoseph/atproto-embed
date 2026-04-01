const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT_DIR, "src");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DIST_DIR = path.join(ROOT_DIR, "dist");

function ensureDist() {
  if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR);
}

function normalizeLF(text) {
  return text.replace(/\r\n/g, "\n");
}

function buildRuntime(name) {
  const srcJs = path.join(SRC_DIR, name + ".js");
  const srcCss = path.join(SRC_DIR, name + ".css");
  const outJs = path.join(DIST_DIR, name + ".js");
  const outCss = path.join(DIST_DIR, name + ".css");

  let js = normalizeLF(fs.readFileSync(srcJs, "utf8"));
  let css = normalizeLF(fs.readFileSync(srcCss, "utf8"));

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
    .filter((f) => f.endsWith(".svg"))
    .filter((f) => usedIcons.has(f.replace(".svg", "")));

  const iconEntries = svgFiles
    .map((f) => {
      const iconName = f.replace(".svg", "");
      const raw = fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8").trim();
      const optimized = raw
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<\?xml[\s\S]*?\?>/i, "")
        .replace(/<!DOCTYPE[\s\S]*?>/i, "")
        .replace(/\s+/g, " ")
        .replace(/>\s+</g, "><")
        .trim();
      if (!optimized) return null;
      const encoded = "data:image/svg+xml," + encodeURIComponent(optimized);
      return `    ${JSON.stringify(iconName)}: ${JSON.stringify(encoded)}`;
    })
    .filter(Boolean);

  const iconsBlock = `  var ICONS = {\n${iconEntries.join(",\n")}\n  };\n`;

  const iconsRegex =
    /\/\* ─+ Icons ─+ \*\/\n\n\s*function getBasePath\(\)[\s\S]*?function getIconUrl\(name\) \{[^\}]*\}\n/;

  if (!iconsRegex.test(js)) {
    console.error(`✗ ERROR: Could not find Icons section in src/${name}.js`);
    process.exit(1);
  }

  js = js.replace(
    iconsRegex,
    iconsBlock + "\n  function getIconUrl(name) {\n    return ICONS[name] || \"\";\n  }\n"
  );

  const cssMinified = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();

  const injectStylesFn = `  function injectStyles(root) {\n    var style = document.createElement(\"style\");\n    style.textContent = ${JSON.stringify(
      cssMinified
    )};\n    root.appendChild(style);\n  }`;

  const injectRegex =
    /function injectStyles\(root\) \{[\s\S]*?root\.appendChild\(link\);\s*\}/;

  if (!injectRegex.test(js)) {
    console.error(`✗ ERROR: Could not find injectStyles(root) in src/${name}.js`);
    process.exit(1);
  }

  js = js.replace(injectRegex, injectStylesFn);

  ensureDist();
  fs.writeFileSync(outJs, js, "utf8");
  fs.writeFileSync(outCss, css, "utf8");

  const outSize = fs.statSync(outJs).size;
  console.log(`✓ dist/${name}.js written — ${(outSize / 1024).toFixed(1)} KB`);
  console.log(`✓ dist/${name}.css written`);
}

function buildLoader() {
  const srcLoader = path.join(SRC_DIR, "loader.js");
  const outEmbed = path.join(DIST_DIR, "embed.js");
  ensureDist();
  const loader = normalizeLF(fs.readFileSync(srcLoader, "utf8"));
  fs.writeFileSync(outEmbed, loader, "utf8");
  const size = fs.statSync(outEmbed).size;
  console.log(`✓ dist/embed.js written (loader) — ${(size / 1024).toFixed(1)} KB`);
}

buildRuntime("post");
buildRuntime("profile");
buildRuntime("members");
buildLoader();

// Backward-compat: keep dist/embed.css available for existing consumers.
fs.copyFileSync(path.join(DIST_DIR, "post.css"), path.join(DIST_DIR, "embed.css"));
console.log("✓ dist/embed.css copied from dist/post.css (backward compatibility)");
console.log("");
