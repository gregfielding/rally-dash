/**
 * Rally design-file generator — typographic print files from the Drop 1 manifest.
 *
 * Renders SVG text via sharp (librsvg) with locally installed fonts
 * (Helvetica Neue Bold for house copy, Genty for the Rally wordmark), trims to
 * content, pads, and emits:
 *   - upload/   production transparent PNGs named to the bulk-upload convention
 *               rally_{token}_rally_{tone}.png (validated via parseDesignFilename)
 *   - previews/ JPEGs composited on garment-color backgrounds for eyeballing
 *   - UPLOAD_CHECKLIST.md  review-day table (label, ink color, target blanks)
 *
 * House typography: left-justified ragged-right for stacked copy, centered for
 * designs that opt in; ALL CAPS + period; curly apostrophes.
 *
 * Usage (from functions/):
 *   node scripts/generate-design-files.js --full     # entire Drop 1 set
 *   node scripts/generate-design-files.js --proofs   # 2-design layout proof set
 */
"use strict";

const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { COLORWAYS, DESIGNS, CITIES, INK_FOR_LIGHT_GARMENTS, INK_FOR_DARK_GARMENTS } = require("./drop1Manifest");
const { parseDesignFilename } = require("../lib/bulkDesignImportPreviewEngine");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "design_exports", "drop1");
const UPLOAD_DIR = path.join(OUT_DIR, "upload");
const PREV_DIR = path.join(OUT_DIR, "previews");

const FONTS = {
  helvetica: { family: "Helvetica Neue", weight: 700 },
  genty: { family: "Genty", weight: 400 },
};

/** Target production width in px for a full-chest print (12" @ 300dpi). */
const TARGET_WIDTH = 3600;
const PAD = 60;
const LINE_HEIGHT = 1.28;

const GARMENT_DARK = "#1A1A1A";
const GARMENT_CREME = "#F0E9D6";

function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function relLuminance(hex) {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Preview bg that contrasts with the ink. */
function previewBgForInk(hex) {
  return relLuminance(hex) > 0.55 ? GARMENT_DARK : GARMENT_CREME;
}

/** Build an oversized SVG; exact bounds don't matter — we trim after raster. */
function buildSvg({ lines, font, ink, align }) {
  const f = FONTS[font];
  const F = 400;
  const maxChars = Math.max(...lines.map((l) => l.length));
  const width = Math.ceil(maxChars * F * 0.85) + 200;
  const height = Math.ceil(lines.length * F * LINE_HEIGHT) + F;
  const anchor = align === "left" ? "start" : "middle";
  const xPos = align === "left" ? "20" : "50%";

  const texts = lines
    .map((line, i) => {
      const y = Math.round(F + i * F * LINE_HEIGHT);
      const copy = line.replace(/'/g, "’"); // curly apostrophes in print
      return `<text x="${xPos}" y="${y}" text-anchor="${anchor}" font-family="${xmlEscape(f.family)}" font-weight="${f.weight}" font-size="${F}" fill="${ink}">${xmlEscape(copy)}</text>`;
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">\n  ${texts}\n</svg>`;
}

async function renderArtwork(spec) {
  const svg = Buffer.from(buildSvg(spec));
  const trimmed = await sharp(svg).png().trim().toBuffer();
  const padded = await sharp(trimmed)
    .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  return sharp(padded).resize({ width: TARGET_WIDTH, withoutEnlargement: false }).png().toBuffer();
}

async function writePreview(productionBuf, bg, outPath) {
  const PREVIEW_W = 1200;
  const art = await sharp(productionBuf).resize({ width: Math.round(PREVIEW_W * 0.62) }).png().toBuffer();
  const artMeta = await sharp(art).metadata();
  // Tall artwork (stacked lists) can exceed the square — grow the canvas.
  const canvasH = Math.max(PREVIEW_W, artMeta.height + 200);
  const preview = await sharp({
    create: { width: PREVIEW_W, height: canvasH, channels: 3, background: bg },
  })
    .composite([{ input: art, left: Math.round((PREVIEW_W - artMeta.width) / 2), top: Math.round((canvasH - artMeta.height) / 2) }])
    .jpeg({ quality: 88 })
    .toBuffer();
  fs.writeFileSync(outPath, preview);
}

function assertUniqueSkuSegments() {
  const seen = new Map();
  const all = [
    ...DESIGNS.map((d) => d.token),
    ...COLORWAYS.map((c) => c.token),
    ...CITIES.flatMap((c) => [c.nameToken, c.initToken]),
  ];
  for (const t of all) {
    const seg = t.toUpperCase().slice(0, 8);
    if (seen.has(seg)) throw new Error(`SKU segment collision: ${t} vs ${seen.get(seg)} (both → ${seg})`);
    seen.set(seg, t);
  }
}

const KNOWN_BRAND_LEAGUES = new Set(["rally", "city"]);

function assertParses(filename, brand) {
  const r = parseDesignFilename(filename);
  if (!r.parsed) throw new Error(`Filename fails parser: ${filename} → ${r.status}: ${r.message}`);
  const league = String(r.parsed.league || r.parsed.leagueCode || "").toLowerCase();
  if (league && league !== brand) throw new Error(`Unexpected league for ${filename}: ${league}`);
  if (!KNOWN_BRAND_LEAGUES.has(brand)) throw new Error(`Unknown brand prefix: ${brand}`);
  return r;
}

async function emit(design, tone, ink, font, align, files, brand = "rally") {
  const filename = `${brand}_${design.token}_${brand}_${tone}.png`;
  assertParses(filename, brand);
  const buf = await renderArtwork({ lines: design.lines, font, ink, align });
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  await writePreview(buf, previewBgForInk(ink), path.join(PREV_DIR, filename.replace(/\.png$/, "_preview.jpg")));
  files.push(filename);
}

async function runFull() {
  assertUniqueSkuSegments();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(PREV_DIR, { recursive: true });

  const checklist = [];

  for (const d of DESIGNS) {
    const align = d.align || (d.lines.length > 1 ? "left" : "center");
    const files = [];
    // Tone = the garment the file is used on: _light gets dark text, _dark gets white text.
    await emit(d, "light", INK_FOR_LIGHT_GARMENTS, "helvetica", align, files);
    await emit(d, "dark", INK_FOR_DARK_GARMENTS, "helvetica", align, files);
    checklist.push({ token: d.token, label: d.label, ink: "", blanks: d.blanks.join(" + "), files });
    console.log(`✓ ${d.token}  (${files.length} files)`);
  }

  for (const c of COLORWAYS) {
    const files = [];
    const design = { token: c.token, lines: ["Rally"] };
    await emit(design, "light", c.hex, "genty", "center", files);
    await emit(design, "dark", c.hex, "genty", "center", files);
    await emit(design, "white", "#FFFFFF", "genty", "center", files);
    checklist.push({
      token: c.token,
      label: c.label,
      ink: c.ink,
      blanks: "all garments",
      files,
      note: c.existsInLibrary ? "ALREADY IN LIBRARY (uploaded from logo files) — skip or replace deliberately" : "",
    });
    console.log(`✓ colorway ${c.token}  (${files.length} files)${c.existsInLibrary ? "  [already in library]" : ""}`);
  }

  // City line — colored art in _light/_dark, white-fill _white (colorway pattern).
  for (const c of CITIES) {
    const nameFiles = [];
    await emit({ token: c.nameToken, lines: [c.name] }, "light", c.hex, "helvetica", "center", nameFiles, "city");
    await emit({ token: c.nameToken, lines: [c.name] }, "dark", c.hex, "helvetica", "center", nameFiles, "city");
    await emit({ token: c.nameToken, lines: [c.name] }, "white", "#FFFFFF", "helvetica", "center", nameFiles, "city");
    checklist.push({ token: `city/${c.nameToken}`, label: c.label, ink: c.ink, blanks: "crew (name)", files: nameFiles });

    const initFiles = [];
    await emit({ token: c.initToken, lines: [c.initials] }, "light", c.hex, "helvetica", "center", initFiles, "city");
    await emit({ token: c.initToken, lines: [c.initials] }, "dark", c.hex, "helvetica", "center", initFiles, "city");
    await emit({ token: c.initToken, lines: [c.initials] }, "white", "#FFFFFF", "helvetica", "center", initFiles, "city");
    checklist.push({ token: `city/${c.initToken}`, label: `${c.label} Initials`, ink: c.ink, blanks: "thong (initials)", files: initFiles });
    console.log(`✓ city ${c.nameToken} + ${c.initToken}  (6 files)`);
  }

  const md = [
    "# Drop 1 — Upload-Day Checklist",
    "",
    `Generated ${new Date().toISOString().slice(0, 10)} by generate-design-files.js. Files in \`upload/\`, previews in \`previews/\`.`,
    "",
    "Review-screen settings per row (Team resolves to **Rally** automatically):",
    "",
    "| Token | Label | Ink color field | Blanks to check | Files | Note |",
    "|---|---|---|---|---|---|",
    ...checklist.map((r) => `| ${r.token} | ${r.label} | ${r.ink || "—"} | ${r.blanks} | ${r.files.length} | ${r.note || ""} |`),
    "",
    "**Blank key:** tanks = TR3008 (+1822GD once its photos/masks/tuning are done) · crew = HF07 · panty = 8394 · thong = 8390.",
    "**Post-spawn pruning:** archive low-contrast variants (white-ink files on White/Oatmeal garments; black-ink on Black/Vintage Black; eyeball Navy/Royal/Powder colorways on blue garments).",
    "**City rows:** Team resolves to **City** (city_brand, created 2026-07-05); colored ink on NEUTRAL garments only — prune any garment+ink combo that recreates a team pairing.",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "UPLOAD_CHECKLIST.md"), md);

  const total = checklist.reduce((n, r) => n + r.files.length, 0);
  console.log(`\n${checklist.length} designs, ${total} files → ${path.relative(REPO_ROOT, UPLOAD_DIR)}`);
  console.log(`Checklist → ${path.relative(REPO_ROOT, path.join(OUT_DIR, "UPLOAD_CHECKLIST.md"))}`);
}

async function runProofs() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(PREV_DIR, { recursive: true });
  const picks = [DESIGNS.find((d) => d.token === "mansplain"), DESIGNS.find((d) => d.token === "tailgate")];
  for (const d of picks) {
    const buf = await renderArtwork({ lines: d.lines, font: "helvetica", ink: INK_LIGHT, align: "left" });
    await writePreview(buf, GARMENT_DARK, path.join(PREV_DIR, `${d.token}_proof.jpg`));
    console.log(`✓ proof ${d.token}`);
  }
}

(async () => {
  if (process.argv.includes("--full")) await runFull();
  else await runProofs();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
