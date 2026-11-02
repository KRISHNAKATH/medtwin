/*
 * Builds presentation/MedTwin_Pitch_Deck.pptx (20 slides, dark theme, speaker notes on every slide)
 * and presentation/pitch_speaker_script.md from one source.
 *
 * Audience: mentor and HOD. Hackathon-style story: problem → solution → how it works (flow diagrams)
 * → why a 3D U-Net → results → product → how to implement it in every hospital → future.
 * Every number comes from the project (README.md, analysis results, stored app outputs), read-only.
 * Images: presentation/assets (make_assets.py, make_guide_assets.py).
 *
 * Needs: pptxgenjs, react, react-dom, react-icons, sharp (npm install them next to this file, or set NODE_PATH).
 * Theme colours are written by the pptx skill's apply_theme.js: set PPTX_APPLY_THEME to its path.
 * Run: node presentation/source/build_pitch_deck.js
 */
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa6");

const ROOT = path.resolve(__dirname, "..");                       // presentation/
const ASSETS = path.join(ROOT, "assets");
const RESULTS = path.resolve(ROOT, "..", "research_paper", "analysis", "results");
const OUT = path.join(ROOT, "MedTwin_Pitch_Deck.pptx");
const SCRIPT_MD = path.join(ROOT, "pitch_speaker_script.md");

const THEME = {
  name: "MedTwin Pitch",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "0A1622",       // page background
    lt1: "FFFFFF",
    dk2: "13263A",       // cards
    lt2: "A9BCCD",       // secondary text
    accent1: "FF7A33",   // orange: main accent, doctor, enhancing tumour
    accent2: "F0E442",   // yellow: oedema, caution
    accent3: "2ED3A0",   // green: works today, MedTwin system
    accent4: "0072B2",   // blue: necrotic core
    accent5: "B79CFF",   // lavender: next steps
    accent6: "2B4763",   // borders, connectors, highlighted rows
    hlink: "56B4E9", folHlink: "A9BCCD",
  },
};
const HX = THEME.colors;
const HEAD = "+mj-lt";

const hist = fs.readFileSync(path.join(RESULTS, "training_history.csv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(",").map(Number));
const EP = hist.map((r) => String(r[0]));
const VAL_DICE = hist.map((r) => r[3]);

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "MedTwin: brain MRI to 3D digital twin";
pres.subject = "Project presentation for the mentor and HOD: how it works and how to implement it in hospitals";
const C = pres.SchemeColor;

pres.defineSlideMaster({
  title: "HERO",
  background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: 0.7, y: 1.3, w: 6, h: 0.4, fontSize: 14, bold: true, color: C.accent1, charSpacing: 3, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.7, y: 1.75, w: 6.2, h: 1.35, fontSize: 66, bold: true, color: C.background1, margin: 0, valign: "middle", align: "left" }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.7, y: 3.15, w: 5.9, h: 1.3, fontSize: 24, color: C.background2, margin: 0, valign: "top" }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: 0.6, y: 0.37, w: 5.5, h: 0.36, fontSize: 12, bold: true, color: C.accent1, charSpacing: 2, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.74, w: 12.13, h: 0.85, fontSize: 30, bold: true, color: C.background1, margin: 0, valign: "middle", align: "left" }, text: "" } },
    { text: { text: "MedTwin · brain MRI to 3D digital twin", options: { x: 0.6, y: 7.02, w: 6, h: 0.3, fontSize: 10, color: C.background2, margin: 0, valign: "middle" } } },
  ],
  slideNumber: { x: 12.13, y: 7.02, w: 0.6, h: 0.3, fontSize: 10, color: C.background2, align: "right" },
});

// ---------- helpers ----------
function txt(s, text, o) {
  s.addText(text, Object.assign({ isTextBox: true, margin: 0, fontSize: 14, color: C.background1, valign: "top" }, o));
}
function card(s, x, y, w, h, name, o) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, Object.assign({ x, y, w, h, rectRadius: 0.1, fill: { color: C.text2 }, line: { color: C.accent6, width: 0.75 }, objectName: name }, o));
}
function chip(s, text, x, y, w, h, name, o) {
  s.addText(text, Object.assign({
    isTextBox: true, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: Math.min(h / 2, 0.12), x, y, w, h, margin: 3,
    fill: { color: C.text2 }, line: { color: C.accent6, width: 0.75 }, fontSize: 13, bold: true, color: C.background1,
    align: "center", valign: "middle", objectName: name,
  }, o));
}
function arrow(s, x1, y1, x2, y2, name, o = {}) {
  s.addShape(pres.shapes.LINE, {
    x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), flipH: x2 < x1, flipV: y2 < y1,
    line: { color: o.color || C.accent6, width: o.width || 2, dashType: o.dash ? "dash" : "solid", endArrowType: o.noHead ? undefined : "triangle" },
    objectName: name,
  });
}
const ICONS = {};
async function iconData(icon, hex) {
  const key = icon + hex;
  if (!ICONS[key]) {
    const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(fa[icon], { color: "#" + hex, size: 256 }));
    ICONS[key] = "image/png;base64," + (await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64");
  }
  return ICONS[key];
}
const DARK_ICON = new Set([C.accent2, C.accent3, C.accent5]);    // light circles get a dark icon
async function circleIcon(s, icon, x, y, d, name, fill = C.accent1) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0.75 }, objectName: name + " circle" });
  s.addImage({ data: await iconData(icon, DARK_ICON.has(fill) ? HX.dk1 : HX.lt1), x: x + d * 0.25, y: y + d * 0.25, w: d * 0.5, h: d * 0.5, objectName: name + " icon", altText: name });
}
const ASPECT = {}, PX = {};
async function loadAspects() {
  for (const f of fs.readdirSync(ASSETS).filter((f) => f.endsWith(".png"))) {
    const m = await sharp(path.join(ASSETS, f)).metadata();
    ASPECT[f] = m.width / m.height;
    PX[f] = { w: m.width, h: m.height };
  }
}
function picture(s, file, x, y, w, h, alt, o = {}) {              // contain-fit, centred
  let iw = w, ih = w / ASPECT[file];
  if (ih > h) { ih = h; iw = h * ASPECT[file]; }
  const ix = x + (w - iw) / 2, iy = y + (h - ih) / 2;
  if (o.frame) {
    const p = o.pad ?? 0.08;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: ix - p, y: iy - p, w: iw + 2 * p, h: ih + 2 * p, rectRadius: 0.06, fill: { color: o.frame }, line: { color: o.frame, width: 0.75 }, rotate: o.rotate, objectName: alt + " frame" });
  }
  s.addImage({ path: path.join(ASSETS, file), x: ix, y: iy, w: iw, h: ih, rotate: o.rotate, objectName: alt, altText: alt });
  return { x: ix, y: iy, w: iw, h: ih };
}
function pill(s, label, x, y, w, fill, name) {
  chip(s, label, x, y, w, 0.32, name, { rectRadius: 0.16, fill: { color: fill }, line: { color: fill, width: 0.75 }, color: C.text1, fontSize: 10.5, charSpacing: 1 });
}
const TABS = [["PROBLEM", 1.05], ["SOLUTION", 1.1], ["AI", 0.6], ["PRODUCT", 1.05], ["HOSPITALS", 1.2], ["FUTURE", 0.95]];
function tabs(s, active) {
  let x = 12.73 - TABS.reduce((a, [, w]) => a + w, 0) - 0.08 * (TABS.length - 1);
  TABS.forEach(([label, w], i) => {
    const on = i === active;
    chip(s, label, x, 0.4, w, 0.3, `Chapter tab ${label}`, { rectRadius: 0.15, fill: { color: on ? C.accent1 : C.text1 }, line: { color: on ? C.accent1 : C.accent6, width: 1 }, color: on ? C.text1 : C.background2, fontSize: 10, charSpacing: 1 });
    x += w + 0.08;
  });
}
const KICK = ["01 · THE PROBLEM", "02 · OUR SOLUTION", "03 · THE AI", "04 · THE PRODUCT", "05 · IN EVERY HOSPITAL", "06 · WHAT'S NEXT"];
const SECTIONS = ["Opening", "01 The problem", "02 Our solution", "03 The AI", "04 The product", "05 In every hospital", "06 What's next", "Closing"];
function contentSlide(chapter, title) {
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: SECTIONS[chapter + 1] });
  s.addText(KICK[chapter], { placeholder: "kicker" });
  s.addText(title, { placeholder: "title" });
  tabs(s, chapter);
  return s;
}
let lastSection = -1;
function section(chapter) {                                       // declare each section once, before its first slide
  if (chapter !== lastSection) { pres.addSection({ title: SECTIONS[chapter + 1] }); lastSection = chapter; }
}
const SCRIPT = [];
function addNotes(s, title, secs, notes) {
  const t = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  s.addNotes(`[About ${t}]\n\n${notes}`);
  SCRIPT.push({ title, secs, notes });
}
function flowNode(s, x, y, w, h, num, head, desc, name, col = C.accent3) {   // numbered card used in flow diagrams
  card(s, x, y, w, h, name, { line: { color: col, width: 1.25 } });
  chip(s, String(num), x + 0.14, y + 0.14, 0.4, 0.4, name + " number", { rectRadius: 0.2, fill: { color: col }, line: { color: col, width: 0.75 }, color: C.text1, fontSize: 12, fontFace: HEAD });
  txt(s, head, { x: x + 0.62, y: y + 0.12, w: w - 0.72, h: 0.44, fontSize: 13, bold: true, valign: "middle", objectName: name + " heading" });
  txt(s, desc, { x: x + 0.14, y: y + 0.62, w: w - 0.26, h: h - 0.7, fontSize: 11.5, color: C.background2, objectName: name + " text" });
}

// ---------- slides ----------
async function build() {
  await loadAspects();
  let s;

  // 1. Title ----------------------------------------------------------------------
  pres.addSection({ title: SECTIONS[0] });
  s = pres.addSlide({ masterName: "HERO", sectionTitle: SECTIONS[0] });
  s.addText("PROJECT PRESENTATION", { placeholder: "kicker" });
  s.addText("MedTwin", { placeholder: "title" });
  s.addText("AI that turns a brain MRI into a 3D digital twin, measured by AI and signed by the doctor", { placeholder: "body" });
  chip(s, "WORKING SYSTEM  ·  62 TESTS PASSING", 0.7, 4.75, 3.9, 0.44, "Project status", { rectRadius: 0.22, fill: { color: C.text1 }, line: { color: C.accent3, width: 1.5 }, color: C.accent3, fontSize: 12, charSpacing: 1 });
  txt(s, "[Your name / team]  ·  Mentor: [Mentor's name]", { x: 0.7, y: 5.6, w: 5.9, h: 0.4, fontSize: 16, bold: true, objectName: "Presenter line" });
  txt(s, "[Department]  ·  [College]  ·  [Date]", { x: 0.7, y: 6.0, w: 5.9, h: 0.4, fontSize: 13, color: C.background2, objectName: "Institution line" });
  picture(s, "twin_hero.png", 6.4, 0.45, 6.7, 6.3, "MedTwin 3D twin of a test scan: fitted cortex with AI tumour regions");
  txt(s, "MedTwin's 3D twin of test scan 00449: fitted cortex with the AI's tumour regions", { x: 7.6, y: 6.85, w: 5.13, h: 0.3, fontSize: 10, italic: true, color: C.background2, align: "right", objectName: "Hero caption" });
  addNotes(s, "MedTwin", 30,
    "Good morning, sir and madam. Our project is MedTwin. MedTwin takes a patient's brain MRI, uses a 3D AI model to find the brain tumour, measures it, and builds a 3D model of that patient's brain, which we call a digital twin. The doctor checks it, corrects it if needed, and signs the report.\n\n" +
    "It is a working system with 62 automated tests passing. I will explain the problem, how our solution works, why we chose a U-Net, what the doctor sees, and, most importantly, how it can be implemented in any hospital.");

  // 2. Problem ---------------------------------------------------------------------
  section(0);
  s = contentSlide(0, "The problem: brain tumours are measured slowly and by hand");
  card(s, 0.6, 1.9, 3.7, 4.85, "Images per patient card");
  txt(s, [{ text: "620", options: { fontSize: 60, bold: true, fontFace: HEAD, color: C.accent1, breakLine: true } },
    { text: "MRI images to read for one patient", options: { fontSize: 15, bold: true, breakLine: true } },
    { text: "4 sequences × 155 slices", options: { fontSize: 13, color: C.background2 } }], { x: 0.85, y: 2.0, w: 3.3, h: 1.85, objectName: "Images per patient" });
  ["seq_t1.png", "seq_t1c.png", "seq_t2.png", "seq_flair.png"].forEach((f, i) => {
    picture(s, f, 1.25 + (i % 2) * 1.22, 4.0 + Math.floor(i / 2) * 1.33, 1.14, 1.25, ["T1", "T1c", "T2", "FLAIR"][i] + " MRI slice");
  });
  const pains = [["FaClock", C.accent1, "Slow", "An expert outlines the tumour by hand, slice by slice."],
    ["FaUsers", C.accent4, "Inconsistent", "Two experts often draw different outlines, so volumes vary."],
    ["FaChartLine", C.accent3, "Hard to follow up", "\"Is it growing?\" needs exact, repeatable volumes across scans."]];
  for (let i = 0; i < 3; i++) {
    const [icon, col, head, desc] = pains[i], x = 4.6 + i * 2.775;
    card(s, x, 1.9, 2.6, 2.4, head + " card");
    await circleIcon(s, icon, x + 0.25, 2.12, 0.62, head, col);
    txt(s, head, { x: x + 0.25, y: 2.9, w: 2.15, h: 0.4, fontSize: 17, bold: true, objectName: head + " heading" });
    txt(s, desc, { x: x + 0.25, y: 3.32, w: 2.15, h: 0.9, fontSize: 13, color: C.background2, objectName: head + " text" });
  }
  card(s, 4.6, 4.55, 8.13, 2.2, "Gap card", { line: { color: C.accent1, width: 1.5 } });
  await circleIcon(s, "FaBridge", 4.85, 4.8, 0.7, "The gap");
  txt(s, [{ text: "The gap", options: { fontSize: 18, bold: true, color: C.accent1, breakLine: true } },
    { text: "AI models for tumour segmentation exist, but they stay in research code: they need clean research files, give no numbers a doctor uses, and offer no way for a doctor to check, correct or sign the result." }],
  { x: 5.8, y: 4.75, w: 6.7, h: 1.85, fontSize: 15, objectName: "Gap text" });
  addNotes(s, "The problem", 55,
    "Glioma is a serious brain tumour. To plan treatment and follow-up, doctors need the size of each part of the tumour.\n\n" +
    "For one patient the MRI has four sequences of 155 slices each: 620 images. Outlining the tumour by hand on these is slow, two experts often draw different outlines, and so the most important follow-up question, 'is the tumour growing?', is hard to answer with exact numbers.\n\n" +
    "AI models for this exist, but they stay in research code. They need clean research files, they do not give the measurements doctors use, and a doctor cannot check, correct or sign their output. That is the gap MedTwin fills.");

  // 3. Solution in one picture -----------------------------------------------------
  section(1);
  s = contentSlide(1, "Our solution in one picture");
  card(s, 0.6, 1.9, 3.0, 4.1, "Input card");
  txt(s, [{ text: "INPUT", options: { fontSize: 11, bold: true, color: C.accent1, charSpacing: 2, breakLine: true } }, { text: "4 MRI sequences", options: { fontSize: 16, bold: true, breakLine: true } }, { text: "DICOM from the scanner, or NIfTI", options: { fontSize: 12, color: C.background2 } }],
    { x: 0.85, y: 2.05, w: 2.6, h: 1.0, objectName: "Input label" });
  ["seq_t1.png", "seq_t1c.png", "seq_t2.png", "seq_flair.png"].forEach((f, i) => {
    picture(s, f, 0.92 + (i % 2) * 1.2, 3.3 + Math.floor(i / 2) * 1.32, 1.12, 1.24, ["T1", "T1c", "T2", "FLAIR"][i] + " input slice");
  });
  arrow(s, 3.7, 3.95, 4.35, 3.95, "Input to MedTwin arrow", { color: C.accent1, width: 3 });
  card(s, 4.45, 1.9, 2.55, 4.1, "MedTwin core card", { fill: { color: C.text2 }, line: { color: C.accent1, width: 2.5 } });
  await circleIcon(s, "FaBrain", 5.27, 2.12, 0.9, "MedTwin core");
  txt(s, "MedTwin", { x: 4.55, y: 3.1, w: 2.35, h: 0.5, fontSize: 22, bold: true, fontFace: HEAD, align: "center", objectName: "MedTwin core title" });
  txt(s, ["AI segmentation", "3D reconstruction", "Measurements", "Report"].map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < 3 } })), { x: 4.7, y: 3.7, w: 2.15, h: 1.35, fontSize: 13, paraSpaceAfter: 3, objectName: "MedTwin core steps" });
  chip(s, "≈ 20–35 s per prepared case", 4.6, 5.25, 2.25, 0.5, "Core speed", { fill: { color: C.text1 }, color: C.accent3, fontSize: 11.5 });
  arrow(s, 7.1, 3.95, 7.7, 3.95, "MedTwin to outputs arrow", { color: C.accent1, width: 3 });
  const outs = [["twin_hero.png", "3D digital twin"], ["label_ai.png", "Tumour map on every slice"], ["report_top.png", "Printable report"]];
  outs.forEach(([f, label], i) => {
    const x = 7.8 + (i % 2) * 2.5, y = 1.9 + Math.floor(i / 2) * 2.1;
    card(s, x, y, 2.4, 2.0, label + " card");
    picture(s, f, x + 0.12, y + 0.12, 2.16, 1.38, label);
    txt(s, label, { x: x + 0.1, y: y + 1.55, w: 2.2, h: 0.35, fontSize: 12.5, bold: true, align: "center", objectName: label + " label" });
  });
  card(s, 10.3, 4.0, 2.4, 2.0, "Numbers card");
  txt(s, [{ text: "Numbers doctors use", options: { fontSize: 12.5, bold: true, breakLine: true } },
    { text: "Enhancing 50.8 cm³", options: { color: C.accent1, breakLine: true } }, { text: "Necrotic 23.6 cm³", options: { color: C.background2, breakLine: true } },
    { text: "Oedema 152.5 cm³", options: { color: C.accent2, breakLine: true } }, { text: "RANO SPD 4,055 mm²", options: { color: C.accent3 } }],
  { x: 10.45, y: 4.12, w: 2.15, h: 1.8, fontSize: 12, objectName: "Numbers text" });
  chip(s, [{ text: "AI suggests, the doctor decides: ", options: { bold: true, color: C.accent1 } }, { text: "the doctor reviews, corrects and signs before anything is final." }],
    0.6, 6.2, 12.13, 0.55, "Solution tagline", { fontSize: 15, bold: false });
  addNotes(s, "Our solution", 55,
    "Here is the whole idea in one picture. The input is the patient's four MRI sequences, straight from the scanner as DICOM, or as NIfTI files.\n\n" +
    "MedTwin then does four things: the AI segments the tumour, it reconstructs the brain and tumour in 3D, it measures everything, and it writes a report. For a prepared case this takes about 20 to 35 seconds on a small laptop GPU.\n\n" +
    "The outputs are a 3D digital twin, the tumour map on every slice, a printable report, and the numbers doctors use. For this test patient: enhancing tumour 50.8 cubic centimetres, necrotic core 23.6, oedema 152.5, and a RANO measurement of 4,055 square millimetres.\n\n" +
    "Our principle: AI suggests, the doctor decides. Nothing is final until the doctor signs.");

  // 4. Hospital journey flow -------------------------------------------------------
  s = contentSlide(1, "Where MedTwin fits in the hospital's flow");
  const journey = [["FaUser", "Patient", "comes for an MRI", C.accent6], ["FaMagnet", "MRI scanner", "4 sequences", C.accent6], ["FaDatabase", "PACS", "stores the DICOM study", C.accent6],
    ["FaBrain", "MedTwin", "AI outline, 3D, numbers, report", C.accent1], ["FaUserDoctor", "Radiologist", "reviews, corrects, signs", C.accent4], ["FaFileMedical", "Clinician", "gets the signed report", C.accent6],
    ["FaArrowsRotate", "Follow-up", "next scan, same flow", C.accent3]];
  const jx = (i) => 1.4 + i * 1.72;
  for (let i = 0; i < journey.length - 1; i++) arrow(s, jx(i) + 0.55, 2.55, jx(i + 1) - 0.55, 2.55, `Journey arrow ${i + 1}`, { color: i === 2 || i === 3 ? C.accent1 : C.background2, width: 2 });
  for (let i = 0; i < journey.length; i++) {
    const [icon, head, desc, col] = journey[i], d = i === 3 ? 1.1 : 0.95;
    await circleIcon(s, icon, jx(i) - d / 2, 2.55 - d / 2, d, head, col);
    txt(s, [{ text: head, options: { bold: true, fontSize: 14, color: i === 3 ? C.accent1 : C.background1, breakLine: true } }, { text: desc, options: { fontSize: 11.5, color: C.background2 } }],
      { x: jx(i) - 0.8, y: 3.25, w: 1.6, h: 0.85, align: "center", objectName: head + " label" });
  }
  arrow(s, jx(6), 4.15, jx(6), 4.45, "Loop down", { color: C.accent3, width: 1.5, dash: true, noHead: true });
  arrow(s, jx(6), 4.45, jx(1), 4.45, "Loop back", { color: C.accent3, width: 1.5, dash: true, noHead: true });
  arrow(s, jx(1), 4.45, jx(1), 4.15, "Loop up", { color: C.accent3, width: 1.5, dash: true });
  txt(s, "follow-up scans run through the same flow: \"is it growing?\"", { x: jx(2), y: 4.5, w: jx(5) - jx(2), h: 0.3, fontSize: 11.5, italic: true, color: C.accent3, align: "center", objectName: "Loop label" });
  card(s, 0.6, 5.0, 5.95, 1.75, "Today card");
  txt(s, [{ text: "TODAY", options: { fontSize: 11, bold: true, color: C.background2, charSpacing: 2, breakLine: true } },
    { text: "The radiologist reads every slice and measures by hand; comparing with the previous scan is manual." }], { x: 0.85, y: 5.15, w: 5.5, h: 1.5, fontSize: 14.5, objectName: "Today text" });
  card(s, 6.78, 5.0, 5.95, 1.75, "With MedTwin card", { line: { color: C.accent1, width: 1.5 } });
  txt(s, [{ text: "WITH MEDTWIN", options: { fontSize: 11, bold: true, color: C.accent1, charSpacing: 2, breakLine: true } },
    { text: "Outline, volumes, RANO and 3D are ready when the radiologist opens the case; they check, correct and sign." }], { x: 7.03, y: 5.15, w: 5.5, h: 1.5, fontSize: 14.5, objectName: "With MedTwin text" });
  addNotes(s, "Where MedTwin fits", 55,
    "This is the normal hospital flow, and where MedTwin fits into it. The patient is scanned, the MRI scanner produces four sequences, and the study is stored in the PACS, the hospital's image archive.\n\n" +
    "MedTwin sits right after the PACS. It prepares the outline, the 3D model, the numbers and a draft report. The radiologist then reviews, corrects and signs, and the clinician receives the signed report. When the patient comes back for a follow-up scan, it goes through the same flow, and MedTwin compares it with the earlier scans.\n\n" +
    "So we do not change how the hospital works. Today the radiologist reads every slice and measures by hand. With MedTwin, the work is ready when they open the case; their job becomes checking and signing.");

  // 5. Architecture ----------------------------------------------------------------
  s = contentSlide(1, "System architecture: three parts working together");
  const panel = async (x, w, icon, col, head, name) => {
    card(s, x, 1.9, w, 4.25, name);
    await circleIcon(s, icon, x + 0.2, 2.05, 0.55, head, col);
    txt(s, head, { x: x + 0.88, y: 2.05, w: w - 1.0, h: 0.55, fontSize: 13, bold: true, charSpacing: 1, valign: "middle", objectName: head + " heading" });
  };
  await panel(0.6, 3.6, "FaDisplay", C.accent1, "DOCTOR'S BROWSER", "Browser panel");
  ["Upload: DICOM zip, NIfTI or demo case", "3D viewer (Three.js)", "Slices + correction brush", "Review · sign-off · follow-up", "Printable report + STL files"].forEach((t, i) =>
    chip(s, t, 0.8, 2.8 + i * 0.66, 3.2, 0.54, "Browser item " + (i + 1), { fill: { color: C.text1 }, fontSize: 12, bold: false, align: "left", margin: [10, 6, 0, 0] }));
  arrow(s, 4.25, 3.7, 4.8, 3.7, "Browser to server arrow", { color: C.accent1 });
  arrow(s, 4.8, 4.3, 4.25, 4.3, "Server to browser arrow", { color: C.accent1 });
  txt(s, "HTTPS", { x: 4.2, y: 3.3, w: 0.65, h: 0.3, fontSize: 10, bold: true, color: C.accent1, align: "center", objectName: "HTTPS label" });
  await panel(4.85, 3.4, "FaServer", C.accent4, "FASTAPI SERVER", "Server panel");
  ["REST API", "Accounts and roles", "Job queue: one GPU job at a time", "Audit trail + security log", "HTTPS on the hospital network"].forEach((t, i) =>
    chip(s, t, 5.05, 2.8 + i * 0.66, 3.0, 0.54, "Server item " + (i + 1), { fill: { color: C.text1 }, fontSize: 12, bold: false, align: "left", margin: [10, 6, 0, 0] }));
  arrow(s, 8.3, 4.0, 8.8, 4.0, "Server to pipeline arrow", { color: C.accent4 });
  await panel(8.85, 3.88, "FaMicrochip", C.accent3, "MEDTWIN PIPELINE (GPU)", "Pipeline panel");
  ["1 Check", "2 Align + strip skull", "3 Preprocess", "4 Segment (3D U-Net)", "5 Build 3D brain", "6 Measure + RANO", "7 Lesion meshes", "8 Report"].forEach((t, i) =>
    chip(s, t, 9.05 + Math.floor(i / 4) * 1.78, 2.8 + (i % 4) * 0.66, 1.7, 0.54, "Pipeline step " + t, { fill: { color: C.text1 }, fontSize: 11.5, bold: false, align: "left", margin: [8, 4, 0, 0] }));
  txt(s, "after DICOM import and de-identification", { x: 9.05, y: 5.5, w: 3.5, h: 0.4, fontSize: 11, italic: true, color: C.background2, objectName: "Pipeline note" });
  card(s, 0.6, 6.3, 6.3, 0.48, "Storage card");
  txt(s, [{ text: "Stored per case: ", options: { bold: true, color: C.accent3 } }, { text: "results · meshes · slices · review · audit · report" }],
    { x: 0.8, y: 6.3, w: 6.0, h: 0.48, fontSize: 12.5, valign: "middle", objectName: "Storage text" });
  txt(s, "Python · PyTorch · MONAI · SimpleITK · HD-BET · trimesh · FastAPI · Three.js", { x: 7.1, y: 6.3, w: 5.63, h: 0.48, fontSize: 12, color: C.background2, align: "right", valign: "middle", objectName: "Technology line" });
  addNotes(s, "System architecture", 55,
    "Technically, MedTwin has three parts. On the left, the doctor's browser: nothing to install. The doctor uploads a study, watches the progress, works in the 3D and slice viewers, corrects with a brush, signs off and prints the report.\n\n" +
    "In the middle, a FastAPI server. It provides the API, accounts and roles, the audit trail and security log, and a queue so only one analysis uses the GPU at a time.\n\n" +
    "On the right, the MedTwin pipeline, our Python package, which does the real work in eight steps on the GPU. Everything for a case is stored together. The main open-source libraries are listed at the bottom.");

  // 6. AI pipeline -----------------------------------------------------------------
  s = contentSlide(1, "How it works: from scanner files to a signed report");
  const steps = [["DICOM import", "find MR series, suggest roles, de-identify"], ["Check", "four readable 3D sequences"], ["Align + strip skull", "rigid registration; HD-BET when needed"],
    ["Preprocess", "RAS, 1 mm, z-score, crop, pad"], ["Segment", "3D U-Net, 96³ windows + confidence"], ["Build 3D brain", "exact surface + fitted cortex"],
    ["Measure", "volumes, location, lesions, RANO, checks"], ["Lesion meshes", "marching cubes, smoothing, GLB / STL"], ["Report", "results, slices, printable report"]];
  const cx = (i) => 0.6 + i * 2.47;
  arrow(s, 1.7, 2.82, 11.6, 2.82, "Row 1 connector", { color: C.accent6, width: 2.5, noHead: true });
  arrow(s, 11.6, 2.82, 11.6, 4.92, "Turn connector", { color: C.accent6, width: 2.5, noHead: true });
  arrow(s, 11.6, 4.92, 1.7, 4.92, "Row 2 connector", { color: C.accent6, width: 2.5, noHead: true });
  steps.forEach(([head, desc], i) => {
    const row2 = i >= 5, x = row2 ? cx(4 - (i - 5)) : cx(i), y = row2 ? 4.05 : 1.95;
    card(s, x, y, 2.25, 1.75, `Step ${i} card`);
    chip(s, String(i), x + 0.18, y + 0.18, 0.46, 0.46, `Step ${i} number`, { rectRadius: 0.23, fill: { color: i === 4 ? C.accent1 : C.accent6 }, line: { color: i === 4 ? C.accent1 : C.accent6, width: 0.75 }, fontSize: 14, fontFace: HEAD });
    txt(s, head, { x: x + 0.18, y: y + 0.74, w: 1.95, h: 0.36, fontSize: 15, bold: true, objectName: `Step ${i} heading` });
    txt(s, desc, { x: x + 0.18, y: y + 1.1, w: 1.95, h: 0.6, fontSize: 11.5, color: C.background2, objectName: `Step ${i} text` });
  });
  card(s, cx(0), 4.05, 2.25, 1.75, "Doctor review card", { line: { color: C.accent1, width: 2 } });
  await circleIcon(s, "FaUserDoctor", cx(0) + 0.18, 4.23, 0.46, "Doctor review");
  txt(s, "Doctor review", { x: cx(0) + 0.18, y: 4.79, w: 1.95, h: 0.36, fontSize: 15, bold: true, color: C.accent1, objectName: "Doctor review heading" });
  txt(s, "brush corrections rerun steps 6–8 in about 3 s; then sign off", { x: cx(0) + 0.18, y: 5.15, w: 1.95, h: 0.6, fontSize: 11.5, color: C.background2, objectName: "Doctor review text" });
  chip(s, [{ text: "≈ 20–35 s ", options: { bold: true, color: C.accent3 } }, { text: "per prepared case on a 2 GB MX550 laptop GPU" }], 0.6, 6.08, 5.95, 0.62, "Speed prepared", { bold: false, fontSize: 13 });
  chip(s, [{ text: "≈ 5 min ", options: { bold: true, color: C.accent2 } }, { text: "for a raw DICOM study that needs skull stripping (CPU)" }], 6.78, 6.08, 5.95, 0.62, "Speed raw DICOM", { bold: false, fontSize: 13 });
  addNotes(s, "How it works", 60,
    "Here is the pipeline after one click. Step 0 reads the DICOM study, finds the MRI series, suggests which is T1, T1 contrast, T2 and FLAIR, and never reads patient identifiers. Step 1 checks the four sequences. Step 2 aligns them and removes the skull with HD-BET when needed. Step 3 applies exactly the preprocessing used in training. Step 4 is the AI: the 3D U-Net segments the tumour and gives a confidence map.\n\n" +
    "Along the bottom row: step 5 builds the 3D brain, step 6 measures volumes, location, separate lesions and RANO diameters, with safety checks, step 7 builds the tumour meshes and step 8 writes the report. If the doctor corrects the outline, steps 6 to 8 rerun in about 3 seconds.\n\n" +
    "A prepared case takes about 20 to 35 seconds on a 2 GB laptop GPU; a raw hospital study that needs skull stripping takes about 5 minutes on the CPU.");

  // 7. Training flow ---------------------------------------------------------------
  section(2);
  s = contentSlide(2, "How we built the AI: the training flow");
  const train = [["Data", "BraTS 2023 adult glioma: 1,251 scans, 4 sequences + expert labels"], ["Check", "6,255 files checked: shape, orientation, labels"],
    ["Preprocess", "RAS orientation, 1 mm voxels, z-score, crop, pad"], ["Split", "875 train · 188 validation · 188 test scans"],
    ["Train", "3D U-Net, Dice + cross-entropy loss, Adam 1e-4, 50 epochs"], ["Validate", "score every epoch; keep the best: 0.8011 at epoch 44"],
    ["Test", "188 held-out scans: mean Dice 0.78"], ["Deploy", "model bundle (4.6 MB weights + settings) loaded by the app"]];
  arrow(s, 0.88, 2.2, 0.88, 6.35, "Training flow spine", { color: C.accent6, width: 2.5, noHead: true });
  train.forEach(([head, desc], i) => {
    const y = 1.92 + i * 0.6, col = i >= 6 ? C.accent1 : C.accent3;
    chip(s, String(i + 1), 0.65, y + 0.05, 0.46, 0.46, `Training step ${i + 1} number`, { rectRadius: 0.23, fill: { color: col }, line: { color: C.text1, width: 2 }, color: C.text1, fontSize: 13, fontFace: HEAD });
    txt(s, [{ text: head + "  ", options: { bold: true, fontSize: 15, color: col } }, { text: desc, options: { fontSize: 13 } }], { x: 1.3, y, w: 4.9, h: 0.56, valign: "middle", objectName: `Training step ${i + 1}` });
  });
  card(s, 6.45, 1.9, 6.28, 4.85, "Training curve card");
  s.addChart(pres.charts.LINE, [{ name: "Validation Dice", labels: EP, values: VAL_DICE }], {
    x: 6.6, y: 2.0, w: 6.0, h: 3.85, chartColors: [C.accent3], lineSize: 2.5, lineDataSymbol: "none",
    showTitle: true, title: "Validation Dice per epoch (higher is better)", titleFontSize: 14, titleColor: C.background1, titleFontFace: "+mj-lt", showLegend: false,
    catAxisLabelColor: C.background2, valAxisLabelColor: C.background2, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
    catAxisLabelFrequency: 5, valAxisMinVal: 0.5, valAxisMaxVal: 0.85, valAxisMajorUnit: 0.05, valAxisLabelFormatCode: "0.00",
    valGridLine: { color: HX.accent6, size: 0.5 }, catGridLine: { style: "none" },
    showCatAxisTitle: true, catAxisTitle: "Epoch", catAxisTitleFontSize: 11, catAxisTitleColor: C.background2, catAxisTitleFontFace: "+mn-lt",
    objectName: "Validation Dice chart",
  });
  txt(s, [{ text: "42.8 hours ", options: { bold: true, color: C.accent3 } }, { text: "of training on an RTX 5050 laptop GPU. The score levelled off near 0.80 after epoch 31." }],
    { x: 6.7, y: 5.95, w: 5.85, h: 0.7, fontSize: 13, objectName: "Training takeaway" });
  addNotes(s, "How we built the AI", 60,
    "This is how we built the AI, step by step. We used the BraTS 2023 adult glioma dataset: 1,251 scans, each with four sequences and an expert's label for every voxel. We checked all 6,255 files, then preprocessed them the same way every time: same orientation, 1-millimetre voxels, normalised brightness, cropped and padded.\n\n" +
    "We split the scans into 875 for training, 188 for validation and 188 for testing. The 3D U-Net trained for 50 epochs with a Dice plus cross-entropy loss and the Adam optimiser. After every epoch we scored it on the validation set and kept the best: 0.8011 at epoch 44. That model scored a mean Dice of 0.78 on the 188 test scans, and it is packed into a model bundle, 4.6 megabytes of weights plus settings, which the app loads.\n\n" +
    "Training took 42.8 hours on a laptop GPU, and the curve shows the score levelling off near 0.80.");

  // 8. Why 3D U-Net ----------------------------------------------------------------
  s = contentSlide(2, "Why we chose a 3D U-Net");
  card(s, 0.6, 1.9, 5.8, 4.85, "U-Net diagram card");
  txt(s, "MedTwin's 3D U-Net: 4 MRI channels → 4 classes", { x: 0.8, y: 2.0, w: 5.4, h: 0.35, fontSize: 13, bold: true, objectName: "U-Net card heading" });
  const L = [{ c: 2.9, h: 1.0 }, { c: 3.95, h: 0.78 }, { c: 4.85, h: 0.6 }, { c: 5.65, h: 0.46 }];
  const ub = (x, lvl, label, fill, name) => chip(s, label, x, L[lvl].c - L[lvl].h / 2, 0.42, L[lvl].h, name, { rectRadius: 0.05, fill: { color: fill }, line: { color: fill, width: 0.75 }, color: fill === C.accent3 ? C.text1 : C.background1, fontSize: 10 });
  chip(s, "MRI\n4 ch", 0.75, 2.52, 0.85, 0.76, "U-Net input", { fill: { color: C.text1 }, fontSize: 11 });
  chip(s, "Labels\n4 classes", 5.42, 2.52, 0.88, 0.76, "U-Net output", { fill: { color: C.text1 }, fontSize: 11 });
  ub(1.75, 0, "16", C.accent4, "Encoder 1"); ub(2.27, 1, "32", C.accent4, "Encoder 2"); ub(2.79, 2, "64", C.accent4, "Encoder 3");
  ub(3.31, 3, "128", C.accent1, "Bottleneck");
  ub(3.83, 2, "64", C.accent3, "Decoder 3"); ub(4.35, 1, "32", C.accent3, "Decoder 2"); ub(4.87, 0, "16", C.accent3, "Decoder 1");
  arrow(s, 1.6, 2.9, 1.75, 2.9, "Input arrow", { width: 1.5, color: C.background2 });
  arrow(s, 5.29, 2.9, 5.42, 2.9, "Output arrow", { width: 1.5, color: C.background2 });
  arrow(s, 1.96, 3.4, 2.48, 3.56, "Down 1", { color: C.accent4, width: 1.5 }); arrow(s, 2.48, 4.34, 3.0, 4.55, "Down 2", { color: C.accent4, width: 1.5 }); arrow(s, 3.0, 5.15, 3.52, 5.42, "Down 3", { color: C.accent4, width: 1.5 });
  arrow(s, 3.52, 5.42, 4.04, 5.15, "Up 1", { color: C.accent3, width: 1.5 }); arrow(s, 4.04, 4.55, 4.56, 4.34, "Up 2", { color: C.accent3, width: 1.5 }); arrow(s, 4.56, 3.56, 5.08, 3.4, "Up 3", { color: C.accent3, width: 1.5 });
  arrow(s, 2.17, 2.9, 4.87, 2.9, "Skip 1", { dash: true, width: 1.25, color: C.background2 }); arrow(s, 2.69, 3.95, 4.35, 3.95, "Skip 2", { dash: true, width: 1.25, color: C.background2 }); arrow(s, 3.21, 4.85, 3.83, 4.85, "Skip 3", { dash: true, width: 1.25, color: C.background2 });
  txt(s, "skip connections keep the detail", { x: 2.2, y: 2.5, w: 2.65, h: 0.28, fontSize: 10, italic: true, color: C.background2, align: "center", objectName: "Skip label" });
  txt(s, [{ text: "ENCODER", options: { bold: true, color: C.accent4, charSpacing: 1, breakLine: true } }, { text: "what is in the scan?" }], { x: 0.8, y: 6.0, w: 2.3, h: 0.6, fontSize: 11.5, objectName: "Encoder label" });
  txt(s, [{ text: "DECODER", options: { bold: true, color: C.accent3, charSpacing: 1, breakLine: true } }, { text: "where exactly is it?" }], { x: 3.9, y: 6.0, w: 2.3, h: 0.6, fontSize: 11.5, align: "right", objectName: "Decoder label" });
  const why = [["FaBullseye", C.accent1, "Built for medical images", "Designed for biomedical segmentation; works with a limited number of labelled scans (we had 875 to train on)."],
    ["FaPuzzlePiece", C.accent4, "Exact outlines", "Skip connections carry fine detail from the encoder to the decoder, so tumour edges stay sharp."],
    ["FaCube", C.accent3, "Sees in 3D", "3D filters use the slices above and below: the tumour is a 3D object, not a set of pictures."],
    ["FaBolt", C.accent2, "Small and fast", "1.19 million parameters: fits a 2 GB laptop GPU; a prepared case in about 20–35 s."],
    ["FaScaleBalanced", C.accent5, "Proven in BraTS", "U-Net-style encoder–decoders underpin most top BraTS methods, including nnU-Net."],
    ["FaBoxOpen", C.accent1, "Ready and upgradable", "MONAI provides a tested 3D U-Net; the pipeline can later swap in nnU-Net or a Transformer."]];
  for (let i = 0; i < 6; i++) {
    const [icon, col, head, desc] = why[i], x = 6.65 + (i % 2) * 3.08, y = 1.9 + Math.floor(i / 2) * 1.64;
    card(s, x, y, 2.98, 1.52, head + " card");
    await circleIcon(s, icon, x + 0.15, y + 0.15, 0.48, head, col);
    txt(s, head, { x: x + 0.72, y: y + 0.15, w: 2.18, h: 0.48, fontSize: 13.5, bold: true, valign: "middle", objectName: head + " heading" });
    txt(s, desc, { x: x + 0.15, y: y + 0.7, w: 2.72, h: 0.78, fontSize: 11.5, color: C.background2, objectName: head + " text" });
  }
  addNotes(s, "Why a 3D U-Net", 65,
    "Why did we choose a U-Net? The diagram shows its U shape. The encoder on the left shrinks the scan step by step and learns WHAT is in it; the decoder on the right grows it back and works out WHERE exactly each part is. The dashed skip connections copy fine detail across, so the tumour edges stay sharp.\n\n" +
    "Six reasons. One, U-Net was designed for biomedical segmentation and works with a limited number of labelled scans; we had 875 to train on. Two, exact outlines, thanks to the skip connections, and we need exact outlines to measure volume. Three, the 3D version uses the slices above and below. Four, it is small: 1.19 million parameters, so it runs on a 2 GB laptop GPU. Five, it is proven: most top BraTS methods, including nnU-Net, are U-Net-style networks. Six, MONAI gives a tested implementation, and we can upgrade later to nnU-Net or a Transformer without changing the rest of the system.");

  // 9. U-Net vs alternatives -------------------------------------------------------
  s = contentSlide(2, "U-Net compared with the other options");
  const Y = (t) => ({ text: t, options: { color: C.accent3, bold: true } });
  const P = (t) => ({ text: t, options: { color: C.accent2, bold: true } });
  const N = (t) => ({ text: t, options: { color: C.accent1, bold: true } });
  const head = ["Approach", "Exact voxel outline", "Uses 3D context", "Works with ~1,000 labelled scans", "Runs on a 2 GB GPU", "Verdict"]
    .map((t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: C.accent6 }, fontSize: 12 } }));
  const rowsT = [
    ["Thresholding / region growing (classic)", P("Partly"), N("No"), Y("Yes (no training)"), Y("Yes"), "Breaks across scanners and contrasts"],
    ["2D CNN, slice by slice", Y("Yes"), N("No"), Y("Yes"), Y("Yes"), "Misses the 3D shape"],
    ["Box detection (YOLO-style)", N("No (box only)"), P("Partly"), Y("Yes"), Y("Yes"), "No volume, no shape"],
    ["3D U-Net (MedTwin)", Y("Yes"), Y("Yes"), Y("Yes"), Y("Yes (1.19 M params)"), "Best fit for our goal"],
    ["Transformers (UNETR, Swin UNETR)", Y("Yes"), Y("Yes"), P("Partly (often pre-trained)"), P("Partly (heavy)"), "Future experiment"],
    ["nnU-Net (self-configuring U-Net)", Y("Yes"), Y("Yes"), Y("Yes"), P("Partly (bigger GPU to train)"), "Planned upgrade"],
  ];
  const tableRows = [head, ...rowsT.map((r, ri) => r.map((c, ci) => {
    const ours = ri === 3, base = { fill: { color: ours ? C.accent6 : C.text2 }, fontSize: 12, color: C.background1 };
    if (typeof c === "string") return { text: c, options: Object.assign(base, ci === 0 ? { bold: true, color: ours ? C.accent1 : C.background1 } : { color: ci === 5 ? (ours ? C.accent3 : C.background2) : C.background1, bold: ours }) };
    return { text: c.text, options: Object.assign(base, c.options) };
  }))];
  s.addTable(tableRows, { x: 0.6, y: 1.9, w: 12.13, colW: [3.0, 1.7, 1.6, 2.0, 1.9, 1.93], rowH: 0.6, valign: "middle", margin: [4, 8, 4, 8],
    border: { type: "solid", pt: 0.75, color: HX.dk1 }, fontFace: "+mn-lt", objectName: "Approach comparison table" });
  txt(s, [{ text: "Our goal: ", options: { bold: true, color: C.accent1 } }, { text: "exact 3D tumour volumes, trained on about a thousand labelled scans, running on modest hospital hardware. Qualitative comparison; nnU-Net and Transformers are the next experiments." }],
    { x: 0.6, y: 6.25, w: 12.13, h: 0.55, fontSize: 13, valign: "middle", objectName: "Comparison note" });
  addNotes(s, "U-Net vs other options", 55,
    "This table compares the options against our goal: exact 3D volumes, trained on about a thousand labelled scans, on modest hardware.\n\n" +
    "Classic thresholding needs no training, but it breaks when the scanner or contrast changes. A 2D network that works slice by slice misses the 3D shape. Box detection like YOLO only draws a box, so there is no volume. Transformers such as Swin UNETR are powerful, but they usually need more data or pre-training and much more memory. nnU-Net is itself a U-Net that configures itself and is very strong, but it needs a bigger GPU to train.\n\n" +
    "The 3D U-Net is the only option that ticks every box today. nnU-Net and Transformers are our next experiments, and our pipeline is built so we can swap the model without changing anything else.");

  // 10. Results --------------------------------------------------------------------
  s = contentSlide(2, "Results: accurate tumour outlines and volumes");
  [["0.78", "mean Dice", "188 held-out test scans"], ["0.69", "mean IoU", "188 held-out test scans"], ["0.98", "whole-tumour volume", "agreement with experts (ICC)"], ["0.97", "whole-lesion Dice", "example test scan 00449"]].forEach(([v, k, sub], i) => {
    const x = 0.6 + i * 3.08;
    card(s, x, 1.9, 2.88, 1.45, k + " tile");
    txt(s, v, { x: x + 0.2, y: 1.98, w: 1.45, h: 1.3, fontSize: 40, bold: true, fontFace: HEAD, color: i === 2 ? C.accent3 : C.accent1, valign: "middle", objectName: k + " value" });
    txt(s, [{ text: k, options: { bold: true, breakLine: true } }, { text: sub, options: { color: C.background2 } }], { x: x + 1.62, y: 1.98, w: 1.2, h: 1.3, fontSize: 12, valign: "middle", objectName: k + " label" });
  });
  card(s, 0.6, 3.6, 7.0, 3.15, "3D comparison card");
  const ai = PX["twin_ai.png"], ex = PX["twin_expert.png"], sc = 2.35 / Math.max(ai.h, ex.h);   // both renders share one scale
  s.addImage({ path: path.join(ASSETS, "twin_ai.png"), x: 0.95, y: 6.13 - ai.h * sc, w: ai.w * sc, h: ai.h * sc, objectName: "AI segmentation in 3D", altText: "AI segmentation of test scan 00449 in 3D" });
  s.addImage({ path: path.join(ASSETS, "twin_expert.png"), x: 4.45, y: 6.13 - ex.h * sc, w: ex.w * sc, h: ex.h * sc, objectName: "Expert segmentation in 3D", altText: "Expert segmentation of test scan 00449 in 3D" });
  txt(s, "MedTwin AI", { x: 0.95, y: 6.25, w: 2.7, h: 0.35, fontSize: 13, bold: true, color: C.accent1, align: "center", objectName: "AI render label" });
  txt(s, "Expert", { x: 4.2, y: 6.25, w: 2.5, h: 0.35, fontSize: 13, bold: true, align: "center", objectName: "Expert render label" });
  card(s, 7.85, 3.6, 4.88, 3.15, "Volume agreement card");
  s.addChart(pres.charts.BAR, [{ name: "ICC", labels: ["Whole tumour", "Enhancing", "Oedema", "Tumour core", "Necrotic core"], values: [0.98, 0.977, 0.912, 0.804, 0.522] }], {
    x: 7.95, y: 3.68, w: 4.68, h: 3.0, barDir: "bar", catAxisOrientation: "maxMin", barGapWidthPct: 45,
    chartColors: ["5B7A99", "5B7A99", "5B7A99", "5B7A99", HX.accent1],
    showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.00", dataLabelColor: C.background1, dataLabelFontSize: 11, dataLabelFontFace: "+mn-lt",
    showTitle: true, title: "Volume agreement by region (ICC)", titleFontSize: 13, titleColor: C.background1, titleFontFace: "+mj-lt",
    catAxisLabelColor: C.background2, catAxisLabelFontSize: 11, catAxisLabelFontFace: "+mn-lt", catAxisLineShow: false,
    valAxisHidden: true, valAxisMinVal: 0, valAxisMaxVal: 1.18, valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: false,
    objectName: "Volume agreement chart",
  });
  addNotes(s, "Results", 60,
    "The results. On the 188 held-out test scans, the mean Dice score is 0.78 and the mean IoU is 0.69. Dice measures how much the AI's outline overlaps the expert's, where 1 is perfect. For doctors, volume matters most: whole-tumour volume agrees with the experts with an ICC of 0.98.\n\n" +
    "On the left is one test patient in 3D, our AI next to the expert's outline. For this scan the whole-lesion Dice is 0.97.\n\n" +
    "The chart is honest about our weak spot: the necrotic core agrees less, 0.52, mainly because of a few scans with very large necrotic cores. A stronger model and more training examples are the fix, which I will show in the future plan.");

  // 11. Digital twin ---------------------------------------------------------------
  section(3);
  s = contentSlide(3, "The 3D digital twin of every patient");
  picture(s, "twin_hero.png", 0.4, 1.75, 6.6, 4.75, "Fitted cortex with AI tumour regions, test scan 00449");
  [["Necrotic core", C.accent4, 0.9, 1.3], ["Oedema", C.accent2, 2.45, 0.8], ["Enhancing tumour", C.accent1, 3.5, 1.5], ["Fitted cortex", C.background2, 5.25, 1.2]].forEach(([label, col, x, w]) => {
    s.addShape(pres.shapes.OVAL, { x, y: 6.6, w: 0.17, h: 0.17, fill: { color: col }, line: { color: col, width: 0.75 }, objectName: label + " key" });
    txt(s, label, { x: x + 0.24, y: 6.52, w, h: 0.33, fontSize: 12, valign: "middle", objectName: label + " key label" });
  });
  txt(s, "How the twin is built", { x: 7.3, y: 1.9, w: 5.4, h: 0.4, fontSize: 18, bold: true, color: C.accent1, objectName: "Twin build heading" });
  [["Template", "FreeSurfer fsaverage folded cortex (41k vertices per hemisphere)"], ["Fit", "scale and ICP alignment to the patient's brain"],
    ["Warp", "pull the gyral crowns onto the patient's outline: 7.08 → 3.81 mm"], ["Complete", "cerebellum and brainstem from the scan; tumour meshes added"]].forEach(([h, desc], i) => {
    const y = 2.45 + i * 0.75;
    chip(s, String(i + 1), 7.3, y + 0.05, 0.42, 0.42, `Twin step ${i + 1} number`, { rectRadius: 0.21, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.75 }, color: C.text1, fontSize: 13 });
    txt(s, [{ text: h + "  ", options: { bold: true } }, { text: desc, options: { color: C.background2 } }], { x: 7.9, y, w: 4.83, h: 0.68, fontSize: 13, objectName: `Twin step ${i + 1} text` });
  });
  ["Cut planes", "Opacity", "Hover details", "Expert wireframes", "Auto-rotate", "STL download"].forEach((t, i) =>
    chip(s, t, 7.3 + (i % 3) * 1.83, 5.55 + Math.floor(i / 3) * 0.47, 1.73, 0.38, "Viewer feature " + t, { rectRadius: 0.19, fill: { color: C.text2 }, fontSize: 11.5, bold: false }));
  txt(s, "Folds come from the template, not the patient; an \"Exact (from scan)\" view is also available.", { x: 7.3, y: 6.5, w: 5.43, h: 0.4, fontSize: 11, italic: true, color: C.background2, objectName: "Twin honesty note" });
  addNotes(s, "The 3D digital twin", 50,
    "This is the digital twin of one test patient. MRI scans are too coarse to show the brain's folds, so MedTwin takes a standard folded brain, FreeSurfer's fsaverage template, and fits it to the patient: it scales and aligns it, then warps the gyral crowns onto the patient's own brain outline. For this patient the average distance dropped from 7.08 to 3.81 millimetres. The cerebellum and brainstem come from the scan, and the tumour regions are added as colour-coded meshes in real millimetres.\n\n" +
    "The doctor can cut through it, change opacity, hover for details and download STL files, for example for 3D printing or surgical planning. The folds are the template's, so there is also an exact view straight from the scan.");

  // 12. Doctor workflow (swimlane) -------------------------------------------------
  s = contentSlide(3, "The doctor's workflow: who does what");
  const lanes = [["DOCTOR", C.accent1, 1.9], ["MEDTWIN", C.accent3, 3.95]];
  lanes.forEach(([label, col, y]) => {
    card(s, 0.6, y, 12.13, 1.9, label + " lane", { fill: { color: C.text2 }, line: { color: C.accent6, width: 0.75 } });
    txt(s, label, { x: 0.6, y, w: 0.55, h: 1.9, fontSize: 12, bold: true, color: col, charSpacing: 2, align: "center", valign: "middle", vert: "vert270", objectName: label + " lane label" });
  });
  const colX = (i) => 1.35 + i * 1.62, cardW = 1.48, cardH = 1.25;
  const lane = [
    [0, 0, "Sign in", "role-based account"], [0, 1, "Upload", "DICOM zip + patient code"], [1, 2, "Detect series", "suggest T1, T1c, T2, FLAIR; thumbnails"],
    [0, 3, "Confirm", "check the four series"], [1, 4, "Analyse", "8-step pipeline, live progress"], [0, 5, "Inspect + correct", "3D, slices, brush"],
    [1, 5, "Recalculate", "volumes, meshes, report in about 3 s"], [0, 6, "Approve or reject", "name, role, reason"], [1, 6, "Record", "audit trail + follow-up timeline"],
  ];
  const pos = lane.map(([l, c]) => ({ x: colX(c), y: l === 0 ? 2.22 : 4.27 }));
  const order = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]];
  order.forEach(([a, b], k) => {
    const A = pos[a], B = pos[b];
    if (A.y === B.y) arrow(s, A.x + cardW, A.y + cardH / 2, B.x, B.y + cardH / 2, `Flow ${k + 1}`, { color: C.background2, width: 1.5 });
    else if (A.x === B.x) arrow(s, A.x + cardW / 2, A.y < B.y ? A.y + cardH : A.y, B.x + cardW / 2, A.y < B.y ? B.y : B.y + cardH, `Flow ${k + 1}`, { color: C.background2, width: 1.5 });
    else arrow(s, A.x + cardW, A.y < B.y ? A.y + cardH - 0.2 : A.y + 0.2, B.x, A.y < B.y ? B.y + 0.2 : B.y + cardH - 0.2, `Flow ${k + 1}`, { color: C.background2, width: 1.5 });
  });
  lane.forEach(([l, , h, desc], i) => {
    const { x, y } = pos[i], col = l === 0 ? C.accent1 : C.accent3;
    card(s, x, y, cardW, cardH, `${h} step`, { fill: { color: C.text1 }, line: { color: col, width: 1.25 } });
    txt(s, [{ text: h, options: { bold: true, fontSize: 14, color: col, breakLine: true } }, { text: desc, options: { fontSize: 12, color: C.background2 } }],
      { x: x + 0.1, y: y + 0.1, w: cardW - 0.2, h: cardH - 0.2, objectName: `${h} step text` });
  });
  chip(s, [{ text: "Print the signed report ", options: { bold: true, color: C.accent1 } }, { text: "→ the clinician receives it; the next scan of this patient appears on the follow-up timeline with % change and a RANO-based category." }],
    0.6, 6.05, 12.13, 0.7, "Workflow outcome", { bold: false, fontSize: 13.5 });
  addNotes(s, "The doctor's workflow", 60,
    "This swimlane shows who does what. The top lane is the doctor, the bottom lane is MedTwin.\n\n" +
    "The doctor signs in with their own account and uploads the DICOM zip with a patient code. MedTwin detects the series and suggests which is which, with thumbnails. The doctor confirms, and MedTwin runs the eight-step analysis with live progress. The doctor inspects the result in 3D and on the slices and corrects anything with the brush; MedTwin recalculates volumes, meshes and the report in about 3 seconds. Finally the doctor approves, or rejects with a reason, and MedTwin records everything in the audit trail and on the patient's follow-up timeline.\n\n" +
    "In our follow-up test, the enhancing tumour grew from 12.3 to 50.8 cubic centimetres, and MedTwin reported radiographic progression automatically.");

  // 13. Report ---------------------------------------------------------------------
  s = contentSlide(3, "What the doctor receives: a clear, printable report");
  picture(s, "report_top.png", 0.85, 2.05, 6.2, 4.3, "MedTwin report for test scan 00449", { frame: C.background1, pad: 0.12, rotate: 358 });
  txt(s, "Real MedTwin report for test scan 00449 (AI output, not yet reviewed)", { x: 0.7, y: 6.6, w: 6.5, h: 0.3, fontSize: 11, italic: true, color: C.background2, align: "center", objectName: "Report caption" });
  const reportRows = [["FaRulerCombined", "Volumes", "per region, AI vs corrected, % of brain"], ["FaLocationDot", "Location in words", "\"left hemisphere, anterior\", checked against the raw scan"],
    ["FaGaugeHigh", "Model confidence", "average certainty inside each region"], ["FaRuler", "RANO measurement", "75.1 × 54.0 mm; SPD 4,055 mm²"],
    ["FaLayerGroup", "Separate lesions", "count, size and location of each"], ["FaSignature", "Review status", "not reviewed, approved or rejected, with signature"]];
  for (let i = 0; i < reportRows.length; i++) {
    const [icon, h, desc] = reportRows[i], y = 1.95 + i * 0.78;
    await circleIcon(s, icon, 7.65, y + 0.06, 0.5, h, i % 2 ? C.accent4 : C.accent1);
    txt(s, [{ text: h, options: { bold: true, fontSize: 15, breakLine: true } }, { text: desc, options: { color: C.background2, fontSize: 12.5 } }], { x: 8.35, y, w: 4.38, h: 0.7, objectName: h + " callout" });
  }
  addNotes(s, "The report", 50,
    "This is a real report produced by MedTwin for a test patient, before review. The top clearly says it is AI decision support and not yet reviewed.\n\n" +
    "It gives the volume of each region and its share of the brain, the location in plain words, the model's confidence, and the RANO measurement: 75.1 by 54.0 millimetres, product 4,055 square millimetres, the standard measurement in neuro-oncology. It lists separate lesions, and after review it shows who approved it, with a signature block.\n\n" +
    "While testing we found that the original research code reported the tumour side inverted, left for right. We fixed it in the app and checked the location against the raw scan.");

  // 14. Deployment architecture ----------------------------------------------------
  section(4);
  s = contentSlide(4, "Inside the hospital: deployment architecture");
  card(s, 0.6, 1.9, 7.75, 4.85, "Hospital network boundary", { fill: { color: C.text1 }, line: { color: C.accent3, width: 1.5, dashType: "dash" } });
  txt(s, "HOSPITAL NETWORK (LAN): NOTHING LEAVES THE HOSPITAL", { x: 0.8, y: 1.98, w: 7.4, h: 0.3, fontSize: 10.5, bold: true, color: C.accent3, charSpacing: 1, objectName: "Boundary label" });
  const NODE = { scanner: [1.75, 3.05], pacs: [1.75, 5.35], server: [4.55, 4.2], rad: [7.2, 2.85], cli: [7.2, 4.2], adm: [7.2, 5.55] };
  arrow(s, NODE.scanner[0], 3.55, NODE.pacs[0], 4.85, "Scanner to PACS", { color: C.background2 });
  txt(s, "DICOM", { x: 1.85, y: 4.0, w: 0.8, h: 0.3, fontSize: 10.5, bold: true, color: C.background2, objectName: "DICOM label" });
  arrow(s, 2.3, 5.1, 3.85, 4.55, "PACS to MedTwin", { color: C.accent3, width: 2 });
  txt(s, "study (zip today)", { x: 2.45, y: 5.18, w: 1.6, h: 0.28, fontSize: 10, color: C.accent3, objectName: "Study label" });
  arrow(s, 3.85, 3.85, 2.3, 4.85, "MedTwin to PACS (next)", { color: C.accent5, width: 1.5, dash: true });
  txt(s, "results back (next)", { x: 2.55, y: 3.62, w: 1.6, h: 0.28, fontSize: 10, color: C.accent5, objectName: "Results back label" });
  for (const k of ["rad", "cli", "adm"]) arrow(s, 5.25, NODE.server[1], NODE[k][0] - 0.45, NODE[k][1], `MedTwin to ${k}`, { color: C.accent1, width: 1.5 });
  await circleIcon(s, "FaMagnet", NODE.scanner[0] - 0.45, NODE.scanner[1] - 0.5, 0.9, "MRI scanner", C.accent6);
  txt(s, "MRI scanner", { x: 2.3, y: 2.9, w: 1.3, h: 0.3, fontSize: 11.5, bold: true, objectName: "Scanner label" });
  await circleIcon(s, "FaDatabase", NODE.pacs[0] - 0.45, NODE.pacs[1] - 0.5, 0.9, "PACS", C.accent6);
  txt(s, "PACS archive", { x: 0.75, y: 5.85, w: 2.0, h: 0.3, fontSize: 11.5, bold: true, align: "center", objectName: "PACS label" });
  await circleIcon(s, "FaServer", NODE.server[0] - 0.7, NODE.server[1] - 0.7, 1.4, "MedTwin GPU server", C.accent1);
  txt(s, [{ text: "MedTwin server", options: { bold: true, breakLine: true } }, { text: "NVIDIA GPU PC · HTTPS :8443", options: { color: C.background2 } }], { x: 3.3, y: 4.95, w: 2.5, h: 0.55, fontSize: 11.5, align: "center", objectName: "Server label" });
  await circleIcon(s, "FaKey", 4.32, 5.75, 0.46, "Hospital login", C.accent5);
  txt(s, "hospital login / SSO (next)", { x: 4.85, y: 5.8, w: 2.0, h: 0.36, fontSize: 10.5, color: C.accent5, valign: "middle", objectName: "SSO label" });
  for (const [k, label, role, col] of [["rad", "Radiologist", "review, correct, sign", C.accent1], ["cli", "Clinician", "read-only", C.accent4], ["adm", "Administrator", "accounts", C.accent3]]) {
    await circleIcon(s, "FaDesktop", NODE[k][0] - 0.45, NODE[k][1] - 0.4, 0.8, label + " workstation", col);
    txt(s, [{ text: label, options: { bold: true, breakLine: true } }, { text: role, options: { color: C.background2 } }], { x: NODE[k][0] - 0.75, y: NODE[k][1] + 0.42, w: 1.5, h: 0.5, fontSize: 10.5, align: "center", objectName: label + " workstation label" });
  }
  txt(s, "Security built in", { x: 8.7, y: 1.9, w: 4.03, h: 0.42, fontSize: 18, bold: true, color: C.accent1, objectName: "Security heading" });
  const sec = ["DICOM identifiers never read or stored", "Passwords hashed (PBKDF2-SHA256); lockout after 5 wrong tries", "Recovery codes or admin reset: no email needed",
    "Secure sessions, CSRF protection, security headers", "Audit trail of every action; revision check between doctors", "Runs on the hospital LAN: no cloud upload"];
  for (let i = 0; i < sec.length; i++) {
    const y = 2.45 + i * 0.6;
    await circleIcon(s, "FaCheck", 8.7, y + 0.06, 0.34, "Security point " + (i + 1), C.accent3);
    txt(s, sec[i], { x: 9.15, y, w: 3.58, h: 0.55, fontSize: 12, valign: "middle", objectName: "Security point text " + (i + 1) });
  }
  arrow(s, 8.7, 6.4, 9.15, 6.4, "Legend works today line", { color: C.accent3, width: 2, noHead: true });
  txt(s, "works today", { x: 9.25, y: 6.25, w: 1.2, h: 0.3, fontSize: 12, color: C.background2, valign: "middle", objectName: "Legend works today" });
  arrow(s, 10.55, 6.4, 11.0, 6.4, "Legend next step line", { color: C.accent5, width: 2, noHead: true, dash: true });
  txt(s, "next step", { x: 11.1, y: 6.25, w: 1.2, h: 0.3, fontSize: 12, color: C.background2, valign: "middle", objectName: "Legend next step" });
  addNotes(s, "Deployment architecture", 60,
    "This is how MedTwin sits inside a hospital. Everything stays on the hospital's own network; nothing goes to the cloud.\n\n" +
    "The MRI scanner sends DICOM to the PACS archive, as it does today. One PC with an NVIDIA GPU runs the MedTwin server. Today, the study is exported from the PACS as a zip and uploaded; the next step is automatic sending from the PACS to MedTwin, and sending the results back to the PACS. Doctors use their existing workstations: radiologists review, correct and sign, clinicians view, and an administrator manages accounts, all through the browser over HTTPS.\n\n" +
    "Security is built in: identifiers are never read, passwords are hashed with lockout, recovery works without email, sessions are protected, every action is audited, and a revision check stops one doctor from overwriting another's work.");

  // 15. Rollout plan ---------------------------------------------------------------
  s = contentSlide(4, "How to implement it in any hospital: step by step");
  const roll = [["FaToolbox", "Install", "One GPU PC in radiology; start_network.bat (HTTPS); create admin and doctor accounts"],
    ["FaEye", "Silent pilot", "Runs alongside normal reporting; radiologists compare AI with their own reads; no clinical decisions"],
    ["FaVial", "Local validation", "Hospital scans vs radiologist outlines on local scanners; ethics committee approval"],
    ["FaChalkboardUser", "Train the team", "Radiologists: review and sign · clinicians: view · admin: accounts and backups"],
    ["FaPlug", "Connect", "PACS auto-send, results back to PACS, hospital login (single sign-on)"],
    ["FaCheckDouble", "Go live + monitor", "Doctor signs every case; audit trail; regular accuracy checks; feedback to improve the model"]];
  arrow(s, 1.5, 2.25, 11.9, 2.25, "Rollout spine", { color: C.accent6, width: 2.5, noHead: true });
  for (let i = 0; i < roll.length; i++) {
    const [icon, h, desc] = roll[i], x = 0.6 + i * 2.045, col = i < 1 ? C.accent3 : C.accent5;
    await circleIcon(s, icon, x + 0.62, 1.92, 0.66, h, col);
    card(s, x, 2.75, 1.9, 2.55, h + " card", { line: { color: col, width: 1 } });
    txt(s, `STEP ${i + 1}`, { x: x + 0.15, y: 2.85, w: 1.6, h: 0.28, fontSize: 10, bold: true, color: col, charSpacing: 1, objectName: h + " step number" });
    txt(s, h, { x: x + 0.15, y: 3.12, w: 1.65, h: 0.4, fontSize: 14.5, bold: true, objectName: h + " heading" });
    txt(s, desc, { x: x + 0.15, y: 3.55, w: 1.65, h: 1.7, fontSize: 11.5, color: C.background2, objectName: h + " text" });
  }
  card(s, 0.6, 5.55, 5.95, 1.2, "Approval card", { line: { color: C.accent2, width: 1.25 } });
  await circleIcon(s, "FaGavel", 0.82, 5.82, 0.62, "Approval", C.accent2);
  txt(s, [{ text: "Before clinical use: ", options: { bold: true, color: C.accent2 } }, { text: "ethics approval for the pilot and regulatory clearance (CDSCO) before AI results guide decisions." }],
    { x: 1.6, y: 5.62, w: 4.8, h: 1.06, fontSize: 13, valign: "middle", objectName: "Approval text" });
  card(s, 6.78, 5.55, 5.95, 1.2, "Scaling card", { line: { color: C.accent5, width: 1.25 } });
  await circleIcon(s, "FaSitemap", 7.0, 5.82, 0.62, "Scaling", C.accent5);
  txt(s, [{ text: "Scale: ", options: { bold: true, color: C.accent5 } }, { text: "big hospitals run their own server; smaller hospitals can share one regional server over a secure network (hub and spoke)." }],
    { x: 7.78, y: 5.62, w: 4.8, h: 1.06, fontSize: 13, valign: "middle", objectName: "Scaling text" });
  addNotes(s, "Implementation step by step", 65,
    "How would a hospital actually adopt MedTwin? In six steps, the traditional way new tools enter radiology.\n\n" +
    "Step one, install: one GPU PC in the radiology department, run the network start script, create the administrator and doctor accounts. This already works today. Step two, a silent pilot: MedTwin runs alongside normal reporting and radiologists compare its results with their own, with no clinical decisions based on it. Step three, local validation: test on the hospital's own scanners against radiologists' outlines, with ethics committee approval. Step four, train the team. Step five, connect it to the PACS and the hospital login. Step six, go live and keep monitoring: the doctor signs every case, everything is audited, and feedback improves the model.\n\n" +
    "Before AI results guide clinical decisions, regulatory clearance from CDSCO is needed. To reach every hospital: large hospitals run their own server, and smaller ones can share a regional server, hub and spoke.");

  // 16. Requirements ---------------------------------------------------------------
  s = contentSlide(4, "What a hospital needs to start");
  const needs = [["FaMicrochip", C.accent1, "Hardware", ["One PC with an NVIDIA GPU (2 GB works)", "4 GB or more lets skull stripping run on the GPU too (faster than the 5-minute CPU path)", "Existing doctor PCs and the hospital LAN"]],
    ["FaLayerGroup", C.accent4, "Software", ["Windows, Python environment (requirements.txt), MedTwin", "Open-source libraries: PyTorch, MONAI, FastAPI…", "Hospital HTTPS certificate; BitLocker for stored cases"]],
    ["FaUsers", C.accent3, "People", ["One administrator for accounts", "Radiologists to review, correct and sign", "Clinicians with read-only access; short training"]],
    ["FaGavel", C.accent2, "Approvals", ["Ethics committee for the pilot", "Regulatory clearance (CDSCO) before clinical use", "Licences: swap HD-BET (non-commercial weights) for SynthStrip before commercial use"]]];
  for (let i = 0; i < 4; i++) {
    const [icon, col, h, items] = needs[i], x = 0.6 + i * 3.08;
    card(s, x, 1.9, 2.92, 4.85, h + " card", { line: { color: col, width: 1 } });
    await circleIcon(s, icon, x + 0.25, 2.12, 0.72, h, col);
    txt(s, h, { x: x + 0.25, y: 3.0, w: 2.45, h: 0.45, fontSize: 19, bold: true, color: col, objectName: h + " heading" });
    txt(s, items.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < items.length - 1 } })), { x: x + 0.22, y: 3.55, w: 2.55, h: 3.1, fontSize: 13, paraSpaceAfter: 8, objectName: h + " list" });
  }
  addNotes(s, "What a hospital needs", 50,
    "What does a hospital need to start? Very little. Hardware: one PC with an NVIDIA GPU; 2 GB already works, and with 4 GB or more the skull-stripping step also runs on the GPU; on a desktop GPU that takes under a minute instead of about five. Doctors keep using their existing PCs.\n\n" +
    "Software: Windows, the Python environment and MedTwin, all built on open-source libraries, plus a hospital certificate for HTTPS and disk encryption for stored cases. People: one administrator, the radiologists who review and sign, and clinicians with read-only access, after a short training.\n\n" +
    "Approvals: the ethics committee for the pilot, regulatory clearance before clinical use, and for any commercial version we would replace HD-BET, whose weights are non-commercial, with SynthStrip.");

  // 17. Tested ---------------------------------------------------------------------
  s = contentSlide(4, "Tested, not just built");
  card(s, 0.6, 1.9, 3.6, 4.85, "Test count card", { line: { color: C.accent3, width: 1.5 } });
  txt(s, [{ text: "62", options: { fontSize: 88, bold: true, fontFace: HEAD, color: C.accent3, breakLine: true } }, { text: "automated tests pass", options: { fontSize: 18, bold: true, breakLine: true } },
    { text: " ", options: { fontSize: 10, breakLine: true } },
    { text: "unit · clinical · accounts · password recovery · regression on a real patient · isolated from real data", options: { fontSize: 13, color: C.background2 } }],
  { x: 0.85, y: 2.05, w: 3.15, h: 4.5, objectName: "Test count" });
  const checks = [["FaLocationCrosshairs", C.accent1, "Side bug found and fixed", "The research code reported left/right, front/back and up/down inverted. Checked on the raw scan: 15.7 mm left, 42.0 mm anterior, 10.4 mm superior."],
    ["FaBrain", C.accent4, "Skull stripping checked", "HD-BET brain mask Dice 0.97 against the BraTS brain region. Hospital-style DICOM test: all four series recognised."],
    ["FaShieldHalved", C.accent2, "Safety checks caught a real problem", "A test study kept its skull and the model outlined 1,315 cm³ of \"oedema\". Now detected; outlines over 40% of the brain say \"do not use\"."],
    ["FaUserShield", C.accent5, "Three roles tested in the browser", "Setup, forced password change, radiologist sign-off, clinician read-only (the API refuses with 403)."]];
  for (let i = 0; i < 4; i++) {
    const [icon, col, h, desc] = checks[i], x = 4.45 + (i % 2) * 4.2, y = 1.9 + Math.floor(i / 2) * 2.5;
    card(s, x, y, 4.08, 2.35, h + " card");
    await circleIcon(s, icon, x + 0.25, y + 0.25, 0.6, h, col);
    txt(s, h, { x: x + 1.0, y: y + 0.25, w: 2.95, h: 0.6, fontSize: 15, bold: true, valign: "middle", objectName: h + " heading" });
    txt(s, desc, { x: x + 0.25, y: y + 0.98, w: 3.62, h: 1.3, fontSize: 12.5, color: C.background2, objectName: h + " text" });
  }
  addNotes(s, "Tested, not just built", 50,
    "For a hospital, reliability matters as much as accuracy. MedTwin has 62 automated tests: unit tests, clinical tests such as RANO diameters and brush strokes landing on the right voxel, account and password-recovery tests, and a regression test on a real patient.\n\n" +
    "Testing found real problems. The original research code reported the tumour side inverted; we fixed it and checked against the raw scan. Skull stripping was checked at Dice 0.97, and a hospital-style DICOM study was read correctly. In one test the skull was not removed and the model outlined 1,315 cubic centimetres of 'oedema'; now that is detected and flagged 'do not use'. And all three roles were tested in the browser.");

  // 18. Future ---------------------------------------------------------------------
  section(5);
  s = contentSlide(5, "Future scope: where MedTwin goes next");
  arrow(s, 0.9, 2.12, 12.45, 2.12, "Roadmap track", { color: C.accent5, width: 3 });
  const stages = [["FaBrain", "SMARTER AI", ["Compare nnU-Net and Transformer models", "Data augmentation; more and more varied training data", "Fine-tune on each hospital's own scans", "Accuracy reported per tumour region"]],
    ["FaHospital", "DEEPER HOSPITAL LINK", ["Receive studies from PACS automatically", "Send results back as DICOM SEG and structured reports", "Radiology worklist and hospital single sign-on", "Hospital-issued HTTPS certificate"]],
    ["FaRocket", "MORE DISEASES, SMARTER TWIN", ["Meningioma, metastases (BraTS 2023), stroke (ISLES 2022), MS lesions", "Anatomy: which lobe, distance to critical areas (SynthSeg)", "Predictive twin: tumour growth from follow-up scans"]]];
  for (let i = 0; i < 3; i++) {
    const [icon, h, items] = stages[i], x = 0.6 + i * 4.09;
    s.addShape(pres.shapes.OVAL, { x: x + 1.83, y: 1.98, w: 0.28, h: 0.28, fill: { color: C.accent5 }, line: { color: C.text1, width: 2 }, objectName: `Roadmap stop ${i + 1}` });
    card(s, x, 2.5, 3.95, 3.45, h + " card", { line: { color: C.accent5, width: 1 } });
    await circleIcon(s, icon, x + 0.22, 2.68, 0.58, h, C.accent5);
    txt(s, h, { x: x + 0.95, y: 2.68, w: 2.9, h: 0.58, fontSize: 12.5, bold: true, color: C.accent5, charSpacing: 1, valign: "middle", objectName: h + " heading" });
    txt(s, items.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < items.length - 1 } })), { x: x + 0.22, y: 3.45, w: 3.55, h: 2.4, fontSize: 13.5, paraSpaceAfter: 6, objectName: h + " list" });
  }
  chip(s, [{ text: "To reach every hospital: ", options: { bold: true, color: C.accent5 } }, { text: "regional hub servers for district hospitals · medical-device quality standards (ISO 13485, IEC 62304) · CDSCO approval" }],
    0.6, 6.15, 12.13, 0.6, "Scale banner", { bold: false, fontSize: 13 });
  addNotes(s, "Future scope", 55,
    "Where does MedTwin go next? Three directions.\n\n" +
    "Smarter AI: compare nnU-Net and Transformer models, add data augmentation and more varied data, fine-tune on each hospital's own scans, and report accuracy for every tumour region. This also fixes the necrotic-core weak spot.\n\n" +
    "A deeper hospital link: receive studies from the PACS automatically, send results back as DICOM SEG and structured reports, and connect to the radiology worklist and hospital login.\n\n" +
    "More diseases and a smarter twin: meningioma, metastases, stroke and multiple sclerosis; anatomy such as which lobe is affected and how close the tumour is to critical areas; and a predictive twin that models tumour growth from follow-up scans.\n\n" +
    "To reach every hospital we need regional hub servers, the medical-device quality standards, and CDSCO approval.");

  // 19. Impact ---------------------------------------------------------------------
  s = contentSlide(5, "Why it matters: the impact");
  txt(s, [{ text: "Fast, consistent tumour measurements and a 3D view the doctor can trust, ", options: {} },
    { text: "on a low-cost laptop GPU, inside the hospital.", options: { color: C.accent1 } }],
  { x: 0.6, y: 1.85, w: 12.13, h: 1.3, fontSize: 28, bold: true, fontFace: HEAD, valign: "middle", objectName: "Purpose statement" });
  const impact = [["FaUserDoctor", C.accent1, "For doctors", "Review and correct instead of outlining from scratch. Standard RANO numbers and volumes in one report."],
    ["FaHeartPulse", C.accent4, "For patients", "Consistent follow-up: \"is it growing?\" answered with numbers. A 3D view that helps explain the treatment."],
    ["FaHospital", C.accent3, "For hospitals", "Runs on a 2 GB GPU on the hospital network. No cloud upload, so data stays inside. Built on open-source libraries."]];
  for (let i = 0; i < 3; i++) {
    const [icon, col, h, desc] = impact[i], x = 0.6 + i * 4.115;
    card(s, x, 3.45, 3.9, 3.3, h + " card");
    await circleIcon(s, icon, x + 0.3, 3.75, 0.8, h, col);
    txt(s, h, { x: x + 0.3, y: 4.75, w: 3.3, h: 0.45, fontSize: 19, bold: true, objectName: h + " heading" });
    txt(s, desc, { x: x + 0.3, y: 5.25, w: 3.3, h: 1.4, fontSize: 15, color: C.background2, objectName: h + " text" });
  }
  addNotes(s, "Impact", 40,
    "So why does it matter? MedTwin gives fast, consistent tumour measurements and a 3D view a doctor can trust, on a low-cost laptop GPU, inside the hospital.\n\n" +
    "Doctors review and correct instead of outlining from scratch. Patients get consistent follow-up and a 3D view that helps them understand their treatment. Hospitals can run it on modest hardware on their own network, with no cloud upload, which protects privacy and suits hospitals with limited budgets.");

  // 20. Closing --------------------------------------------------------------------
  pres.addSection({ title: SECTIONS[7] });
  s = pres.addSlide({ masterName: "HERO", sectionTitle: SECTIONS[7] });
  s.addText("THANK YOU", { placeholder: "kicker" });
  s.addText("Questions?", { placeholder: "title" });
  s.addText("Happy to show MedTwin live: upload, 3D twin, correction and signed report.", { placeholder: "body" });
  chip(s, "LIVE DEMO READY", 0.7, 4.75, 2.4, 0.44, "Demo status", { rectRadius: 0.22, fill: { color: C.text1 }, line: { color: C.accent3, width: 1.5 }, color: C.accent3, fontSize: 12, charSpacing: 1 });
  txt(s, "[Your name / team]  ·  Mentor: [Mentor's name]", { x: 0.7, y: 5.6, w: 5.9, h: 0.4, fontSize: 16, bold: true, objectName: "Closing presenter line" });
  card(s, 7.0, 0.9, 5.73, 5.85, "Next steps panel", { line: { color: C.accent1, width: 1.25 } });
  txt(s, "What we need to take it to a hospital", { x: 7.35, y: 1.15, w: 5.1, h: 0.5, fontSize: 19, bold: true, color: C.accent1, objectName: "Needs heading" });
  const asks = [["FaHandshake", "A pilot hospital: a radiology department willing to run the silent pilot", C.accent1], ["FaVial", "Local scans with radiologist outlines, with ethics approval, to validate and fine-tune", C.accent4], ["FaMicrochip", "A stronger GPU to train nnU-Net and larger models", C.accent3]];
  for (let i = 0; i < 3; i++) {
    const [icon, t, col] = asks[i], y = 1.95 + i * 1.5;
    await circleIcon(s, icon, 7.35, y, 0.75, "Need " + (i + 1), col);
    txt(s, [{ text: `0${i + 1}`, options: { fontSize: 12, bold: true, color: C.background2, breakLine: true } }, { text: t, options: { fontSize: 16 } }], { x: 8.35, y: y - 0.05, w: 4.1, h: 1.2, objectName: "Need " + (i + 1) + " text" });
  }
  addNotes(s, "Questions", 30,
    "To summarise: MedTwin is a working, tested system that takes a brain MRI to a measured 3D digital twin and a signed report, and it fits into the normal hospital flow.\n\n" +
    "To take it into a hospital we need three things: a pilot hospital willing to run the silent pilot, local scans with radiologist outlines to validate and fine-tune the model, and a stronger GPU for the next models. With your support, sir and madam, we would like to start with a pilot.\n\n" +
    "Thank you. We are happy to take questions or show MedTwin live.");

  await pres.writeFile({ fileName: OUT });
  if (process.env.PPTX_APPLY_THEME) {
    const { applyTheme } = require(process.env.PPTX_APPLY_THEME);
    await applyTheme(OUT, THEME);
  } else {
    console.warn("PPTX_APPLY_THEME not set: theme colours not written");
  }
  writeScript();
  console.log("wrote", OUT);
}

// ---------- speaker script ----------
function writeScript() {
  const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  const total = SCRIPT.reduce((a, b) => a + b.secs, 0);
  let start = 0;
  const rows = SCRIPT.map((x, i) => { const r = `| ${i + 1} | ${x.title} | ${mmss(x.secs)} | ${mmss(start)} |`; start += x.secs; return r; });
  const parts = [
    "# MedTwin pitch: speaker script (mentor and HOD)",
    "",
    "What to say with `MedTwin_Pitch_Deck.pptx`; the same text is in each slide's speaker notes. Say it in your own words; the times are a guide.",
    "",
    `Talk length: about ${Math.round(total / 60)} minutes, plus questions and an optional live demo.`,
    "",
    "## Before you present",
    "",
    "- Fill in the placeholders on slides 1 and 20: your name or team, your mentor's name, department, college and date.",
    "- Keep the app running in a browser for the live demo (see the README's quick start).",
    "- If time is short, shorten slides 5, 11 and 17. Slides 8–9 (why U-Net) and 14–16 (hospital implementation) are the heart of this talk.",
    "",
    "## Timing plan",
    "",
    "| # | Slide | Time | Starts at |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Script",
    "",
  ];
  SCRIPT.forEach((x, i) => parts.push(`### ${i + 1}. ${x.title} (${mmss(x.secs)})`, "", x.notes, ""));
  parts.push(
    "## Questions your mentor or HOD may ask",
    "",
    "| Question | Suggested answer |",
    "| --- | --- |",
    "| Why U-Net and not something newer? | U-Net was designed for biomedical segmentation, gives exact outlines, works with about a thousand labelled scans and fits a 2 GB GPU. Newer options (Transformers, nnU-Net) need more data or a bigger GPU; they are our next experiments, and the pipeline lets us swap the model without changing anything else. |",
    "| Is 0.78 Dice good enough? | It is the mean over three separate tumour labels, which is a strict measure. Whole-tumour volume agrees with experts at ICC 0.98, which is what matters for follow-up. The weak spot is the necrotic core in very large tumours; nnU-Net, augmentation and more data are the fix. And a doctor reviews every result. |",
    "| Were the test scans completely new to the model? | They were never used for training. A few BraTS patients have two scans, and our split was by scan, so 28 of the 188 test scans come from patients who also had a scan in training or validation. Splitting by patient is part of the next round of training. |",
    "| How do we put this in a hospital that has no GPU? | Two options: buy one PC with an NVIDIA GPU (2 GB works), or share a regional hub server over a secure network (hub and spoke). |",
    "| Is patient data safe? | Identifiers in DICOM files are never read, DICOM files are deleted after conversion, and everything stays on the hospital network over HTTPS, with roles, password hashing, lockout and an audit trail. Stored cases should be on an encrypted disk (BitLocker). |",
    "| Can doctors trust the AI? | They do not have to trust it blindly: they see a confidence map, can correct anything with the brush, and nothing is final until they sign. The report says clearly that it is decision support. |",
    "| Is it approved for clinical use? | Not yet. It needs a local validation study with ethics approval and regulatory clearance (CDSCO). Our rollout plan starts with a silent pilot so no clinical decision depends on it until then. |",
    "| How is it different from existing tools? | It is open, runs on low-cost hardware inside the hospital, covers the whole flow from DICOM to a signed report with a 3D twin and follow-up, and keeps the doctor in control. |",
    "| What did you build yourselves and what comes from libraries? | Libraries: PyTorch and MONAI (network and training), SimpleITK (DICOM, registration), HD-BET (skull stripping), trimesh (meshes), FastAPI (server), Three.js (3D view). The project's own code: training set-up, the medtwin package (pipeline, measurements, RANO, location, cortex fitting, meshes, report), the server (accounts, review, audit, queue), the web interface and the 62 tests. |",
    "",
    "## Where the numbers come from",
    "",
    "All numbers come from the project, read without changing anything: `README.md` (features, verification, roadmap, requirements), `research_paper/analysis/results/` (training history, volume agreement) and the stored app outputs for test scan 00449 (`medtwin_app/data/jobs/d43e76abdfac`: report, meshes). The images are real outputs: 3D renders of the stored meshes and a screenshot of the stored report. The U-Net comparison table is qualitative.",
    "",
    "To rebuild: `presentation/source/make_assets.py` and `make_guide_assets.py` (with the app's Python), then `node presentation/source/build_pitch_deck.js`.",
    "",
  );
  fs.writeFileSync(SCRIPT_MD, parts.join("\n"), "utf8");
}

build().catch((e) => { console.error(e); process.exit(1); });
