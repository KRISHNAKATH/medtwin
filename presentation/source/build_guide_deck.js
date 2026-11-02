/*
 * Builds presentation/MedTwin_Project_Review.pptx (18 slides for the project guide, speaker notes on every slide)
 * and presentation/guide_speaker_script.md from one source.
 *
 * Every number comes from the project (README.md, research_paper/, analysis results, stored app outputs), read-only.
 * Images: presentation/assets (make_assets.py, make_guide_assets.py, render_paper_pages.py).
 *
 * Needs: pptxgenjs, react, react-dom, react-icons, sharp (npm install them next to this file, or set NODE_PATH).
 * Theme colours are written by the pptx skill's apply_theme.js: set PPTX_APPLY_THEME to its path.
 * Run: node presentation/source/build_guide_deck.js
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
const OUT = path.join(ROOT, "MedTwin_Project_Review.pptx");
const SCRIPT_MD = path.join(ROOT, "guide_speaker_script.md");

const THEME = {
  name: "MedTwin Review",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "0A1622",       // page background (dark MRI navy)
    lt1: "FFFFFF",
    dk2: "13263A",       // cards
    lt2: "A9BCCD",       // secondary text on dark
    accent1: "FF7A33",   // orange: main accent, enhancing tumour
    accent2: "F0E442",   // yellow: oedema, "draft"/warning
    accent3: "2ED3A0",   // green: done
    accent4: "0072B2",   // blue: necrotic core
    accent5: "B79CFF",   // lavender: future work
    accent6: "2B4763",   // borders and connectors
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
pres.title = "MedTwin: project review";
pres.subject = "Project review for the guide: what is complete and what comes next";
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
    { placeholder: { options: { name: "kicker", type: "body", x: 0.6, y: 0.37, w: 7.2, h: 0.36, fontSize: 12, bold: true, color: C.accent1, charSpacing: 2, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.74, w: 12.13, h: 0.85, fontSize: 30, bold: true, color: C.background1, margin: 0, valign: "middle", align: "left" }, text: "" } },
    { text: { text: "MedTwin · project review", options: { x: 0.6, y: 7.02, w: 6, h: 0.3, fontSize: 10, color: C.background2, margin: 0, valign: "middle" } } },
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
function status(s, label, x, y, w, kind, name) {             // DONE / DRAFT READY / NEXT pills
  const fill = { done: C.accent3, draft: C.accent2, next: C.accent5 }[kind];
  chip(s, label, x, y, w, 0.32, name, { rectRadius: 0.16, fill: { color: fill }, line: { color: fill, width: 0.75 }, color: C.text1, fontSize: 10.5, charSpacing: 1 });
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
async function circleIcon(s, icon, x, y, d, name, fill = C.accent1, iconHex = HX.lt1) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0.75 }, objectName: name + " circle" });
  s.addImage({ data: await iconData(icon, iconHex), x: x + d * 0.25, y: y + d * 0.25, w: d * 0.5, h: d * 0.5, objectName: name + " icon", altText: name });
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
const TABS = [["WHY", 0.95], ["BUILT", 1.05], ["DELIVERS", 1.25], ["NEXT", 0.95]];
function tabs(s, active) {
  let x = 12.73 - TABS.reduce((a, [, w]) => a + w, 0) - 0.08 * (TABS.length - 1);
  TABS.forEach(([label, w], i) => {
    const on = i === active;
    chip(s, label, x, 0.4, w, 0.3, `Chapter tab ${label}`, { rectRadius: 0.15, fill: { color: on ? C.accent1 : C.text1 }, line: { color: on ? C.accent1 : C.accent6, width: 1 }, color: on ? C.text1 : C.background2, fontSize: 10, charSpacing: 1 });
    x += w + 0.08;
  });
}
const KICK = ["01 · WHY THIS PROJECT", "02 · WHAT I BUILT", "03 · WHAT IT DELIVERS", "04 · WHAT'S NEXT"];
const SECTIONS = ["Opening", "01 Why this project", "02 What I built", "03 What it delivers", "04 What's next", "Closing"];
function contentSlide(chapter, title) {
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: SECTIONS[chapter + 1] });
  s.addText(KICK[chapter], { placeholder: "kicker" });
  s.addText(title, { placeholder: "title" });
  tabs(s, chapter);
  return s;
}
const SCRIPT = [];
function addNotes(s, title, secs, notes) {
  const t = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  s.addNotes(`[About ${t}]\n\n${notes}`);
  SCRIPT.push({ title, secs, notes });
}

// ---------- slides ----------
async function build() {
  await loadAspects();
  let s;

  // 1. Title ----------------------------------------------------------------------
  pres.addSection({ title: SECTIONS[0] });
  s = pres.addSlide({ masterName: "HERO", sectionTitle: SECTIONS[0] });
  s.addText("PROJECT REVIEW", { placeholder: "kicker" });
  s.addText("MedTwin", { placeholder: "title" });
  s.addText("From a brain MRI to a 3D digital twin a doctor can trust", { placeholder: "body" });
  chip(s, "SYSTEM COMPLETE  ·  PAPER DRAFT READY", 0.7, 4.7, 4.3, 0.44, "Project status", { rectRadius: 0.22, fill: { color: C.text1 }, line: { color: C.accent3, width: 1.5 }, color: C.accent3, fontSize: 12, charSpacing: 1 });
  txt(s, "[Your name]  ·  Guide: [Guide's name]", { x: 0.7, y: 5.6, w: 5.9, h: 0.4, fontSize: 16, bold: true, objectName: "Presenter line" });
  txt(s, "[Department]  ·  [College]  ·  [Date]", { x: 0.7, y: 6.0, w: 5.9, h: 0.4, fontSize: 13, color: C.background2, objectName: "Institution line" });
  picture(s, "twin_hero.png", 6.4, 0.45, 6.7, 6.3, "MedTwin 3D twin of a test scan: fitted cortex with AI tumour regions");
  txt(s, "MedTwin's 3D twin of test scan 00449: fitted cortex with the AI's tumour regions", { x: 7.6, y: 6.85, w: 5.13, h: 0.3, fontSize: 10, italic: true, color: C.background2, align: "right", objectName: "Hero caption" });
  addNotes(s, "MedTwin: project review", 30,
    "Good morning, sir/madam. Today I will present my project, MedTwin. In one line: MedTwin takes a patient's brain MRI, finds the glioma tumour with a 3D AI model, measures it, and builds a 3D model of that patient's brain, which we call a digital twin. A doctor can then check it, correct it and sign it off.\n\n" +
    "The system itself is complete and tested, and the research paper draft is ready. I will cover four things: why I chose this problem, what I built, what it delivers, and what comes next.");

  // 2. Problem ---------------------------------------------------------------------
  pres.addSection({ title: SECTIONS[1] });
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
  txt(s, [{ text: "The gap I targeted", options: { fontSize: 18, bold: true, color: C.accent1, breakLine: true } },
    { text: "Research AI models stop in a notebook. They need clean research files, give no numbers a doctor uses, and offer no way for a doctor to check, correct or sign the result. MedTwin turns the model into a tool doctors can actually use." }],
  { x: 5.8, y: 4.75, w: 6.7, h: 1.85, fontSize: 15, objectName: "Gap text" });
  addNotes(s, "The problem", 60,
    "Glioma is the brain tumour this project covers. To plan treatment and follow-up, doctors need the size of each part of the tumour: the active enhancing part, the dead necrotic core and the swelling around it.\n\n" +
    "For one patient there are four MRI sequences, each with 155 slices: 620 images. Outlining the tumour by hand on these is slow, and two experts often draw different outlines, so the volumes vary. That makes it hard to answer the key follow-up question: is the tumour growing?\n\n" +
    "Many AI papers solve the segmentation part, but the model stays in a notebook. It needs clean research data, gives no clinical measurements, and has no way for a doctor to check or sign the result. That gap, from research model to a doctor's tool, is what I targeted.");

  // 3. Objectives ------------------------------------------------------------------
  s = contentSlide(0, "Objectives: what I set out to build");
  const objectives = [["FaBrain", C.accent1, "AI segmentation", "Train a 3D model that outlines the three glioma regions on MRI (BraTS 2023).", "done"],
    ["FaRulerCombined", C.accent4, "Clinical measurements", "Volumes, % of brain, location in plain words, RANO diameters.", "done"],
    ["FaCube", C.accent3, "3D digital twin", "A patient-specific 3D brain with colour-coded tumour regions.", "done"],
    ["FaLaptopMedical", C.accent1, "Doctor web app", "Upload → progress → review and correct → signed, printable report.", "done"],
    ["FaHospital", C.accent4, "Hospital-ready", "DICOM input, multi-doctor accounts and a secure HTTPS network mode.", "done"],
    ["FaFileLines", C.accent2, "Research paper", "Honest evaluation, literature review and a journal-ready draft.", "draft"]];
  for (let i = 0; i < 6; i++) {
    const [icon, col, head, desc, st] = objectives[i], x = 0.6 + (i % 3) * 4.115, y = 1.9 + Math.floor(i / 3) * 2.3;
    card(s, x, y, 3.9, 2.12, head + " objective card");
    await circleIcon(s, icon, x + 0.25, y + 0.25, 0.62, head, col, col === C.accent2 ? HX.dk1 : HX.lt1);
    txt(s, `0${i + 1}`, { x: x + 1.0, y: y + 0.36, w: 0.6, h: 0.4, fontSize: 16, bold: true, fontFace: HEAD, color: C.background2, objectName: head + " number" });
    status(s, st === "done" ? "DONE" : "DRAFT READY", x + 3.9 - (st === "done" ? 1.05 : 1.45), y + 0.3, st === "done" ? 0.8 : 1.2, st, head + " status");
    txt(s, head, { x: x + 0.25, y: y + 1.0, w: 3.4, h: 0.38, fontSize: 16, bold: true, objectName: head + " heading" });
    txt(s, desc, { x: x + 0.25, y: y + 1.38, w: 3.45, h: 0.7, fontSize: 13, color: C.background2, objectName: head + " text" });
  }
  txt(s, [{ text: "5 of 6 objectives complete; ", options: { bold: true, color: C.accent3 } }, { text: "the paper draft is ready for its final experiments and submission." }],
    { x: 0.6, y: 6.45, w: 12.13, h: 0.4, fontSize: 15, align: "center", valign: "middle", objectName: "Objectives summary" });
  addNotes(s, "Objectives", 55,
    "I set six objectives. One: train a 3D AI model that outlines the three glioma regions. Two: turn the outline into the measurements doctors use: volumes, percentage of the brain, location in plain words, and RANO diameters, which are the standard measurement in neuro-oncology. Three: build a patient-specific 3D brain, the digital twin. Four: a web app a doctor can use from upload to signed report. Five: make it hospital-ready: DICOM files straight from the scanner, accounts for several doctors, and a secure network mode. Six: evaluate it honestly and write a research paper.\n\n" +
    "The first five are complete. The paper draft is ready; it needs a few final experiments before submission, which I will show at the end.");

  // 4. Journey ---------------------------------------------------------------------
  pres.addSection({ title: SECTIONS[2] });
  s = contentSlide(1, "The journey: from research notebook to a doctor's tool");
  const stops = [["Explore the data", "1,251 scans, 6,255 files checked"], ["Train the 3D U-Net", "50 epochs, 42.8 h on a laptop GPU"],
    ["Measure", "volumes and location on all 188 test scans"], ["3D reconstruction", "lesion meshes in real millimetres"],
    ["Web app", "FastAPI + Three.js, one-click pipeline"], ["Clinical tools", "DICOM, review, RANO, follow-up"],
    ["Multi-doctor + security", "roles, HTTPS, password recovery"], ["Research paper", "62-paper review, full draft"]];
  const nx = (i) => 1.7 + i * 1.414, ly = 4.0;
  arrow(s, nx(0), ly, nx(6), ly, "Timeline done segment", { color: C.accent3, width: 4, noHead: true });
  arrow(s, nx(6), ly, nx(7), ly, "Timeline draft segment", { color: C.accent2, width: 4, noHead: true, dash: true });
  stops.forEach(([head, desc], i) => {
    const x = nx(i), up = i % 2 === 0, last = i === 7, col = last ? C.accent2 : C.accent3;
    arrow(s, x, up ? 3.42 : 4.31, x, up ? 3.69 : 4.58, `Milestone ${i + 1} connector`, { color: col, width: 1.5, noHead: true });
    chip(s, String(i + 1), x - 0.31, ly - 0.31, 0.62, 0.62, `Milestone ${i + 1} marker`, { rectRadius: 0.31, fill: { color: col }, line: { color: C.text1, width: 3 }, color: C.text1, fontSize: 16, fontFace: HEAD });
    txt(s, [{ text: last ? "DRAFT READY" : "DONE", options: { fontSize: 10, bold: true, color: col, charSpacing: 1, breakLine: true } },
      { text: head, options: { fontSize: 15, bold: true, breakLine: true } }, { text: desc, options: { fontSize: 12, color: C.background2 } }],
    { x: x - 1.1, y: up ? 2.12 : 4.62, w: 2.2, h: 1.28, align: "center", valign: up ? "bottom" : "top", objectName: `Milestone ${i + 1} label` });
  });
  card(s, 0.6, 6.12, 12.13, 0.62, "Journey summary card");
  txt(s, [{ text: "4 research notebooks", options: { bold: true, color: C.accent1 } }, { text: "  →  one tested Python package + doctor web app  →  ", options: {} }, { text: "a research paper", options: { bold: true, color: C.accent2 } }],
    { x: 0.8, y: 6.14, w: 11.73, h: 0.58, fontSize: 15, align: "center", valign: "middle", objectName: "Journey summary" });
  addNotes(s, "The journey", 60,
    "This is how the project grew, in eight milestones. First I explored the BraTS 2023 dataset: 1,251 scans and 6,255 files, checked for shape, orientation and label problems. Then I trained the 3D U-Net for 50 epochs, which took 42.8 hours on my laptop GPU. Third, I wrote the measurement step and ran it on all 188 test scans. Fourth, the 3D reconstruction.\n\n" +
    "Then the bigger engineering part: the notebooks became one tested Python package and a web app, and I added the clinical tools, DICOM import, review, RANO and follow-up, and then multi-doctor accounts and security. The last milestone is the research paper, which is drafted. Green means done; yellow means draft ready.");

  // 5. Architecture ----------------------------------------------------------------
  s = contentSlide(1, "System architecture: three parts working together");
  const panel = async (x, w, icon, col, head, name) => {
    card(s, x, 1.9, w, 4.25, name);
    await circleIcon(s, icon, x + 0.2, 2.05, 0.55, head, col);
    txt(s, head, { x: x + 0.88, y: 2.05, w: w - 1.0, h: 0.55, fontSize: 13, bold: true, color: col === C.accent2 ? C.accent2 : C.background1, charSpacing: 1, valign: "middle", objectName: head + " heading" });
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
  addNotes(s, "System architecture", 60,
    "The system has three parts. On the left is the doctor's browser: no installation, just a web page. The doctor uploads a DICOM zip or NIfTI files, watches the progress, then works in the 3D viewer and the slice viewer, corrects with a brush, reviews, signs off and prints the report.\n\n" +
    "In the middle is the FastAPI server. It provides the REST API, handles accounts and roles, keeps an audit trail and a security log, and runs a job queue so only one analysis uses the GPU at a time.\n\n" +
    "On the right is the MedTwin pipeline, my Python package that does the real work in eight steps. Everything for a case is stored together: results, meshes, slices, review status, audit trail and the report. The main libraries are listed at the bottom.");

  // 6. Pipeline --------------------------------------------------------------------
  s = contentSlide(1, "One click: from scanner files to a signed report");
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
  addNotes(s, "The pipeline", 60,
    "Here is what happens after one click. Step 0 reads the DICOM study from the scanner, finds the MRI series, suggests which is T1, T1 contrast, T2 and FLAIR, and never reads patient identifiers. Step 1 checks the four sequences. Step 2 aligns them and removes the skull with HD-BET when needed. Step 3 applies exactly the preprocessing used in training. Step 4, the AI step, segments the tumour with the 3D U-Net and also produces a confidence map.\n\n" +
    "Then, coming back along the bottom row: step 5 builds the 3D brain, step 6 measures volumes, location, separate lesions and RANO diameters with safety checks, step 7 builds the tumour meshes and step 8 writes the report. If the doctor corrects the outline, steps 6 to 8 rerun in about 3 seconds.\n\n" +
    "A prepared case takes about 20 to 35 seconds on a 2 GB laptop GPU; a raw hospital study that needs skull stripping takes about 5 minutes on the CPU.");

  // 7. AI model --------------------------------------------------------------------
  s = contentSlide(1, "The AI model: a compact 3D U-Net trained on BraTS 2023");
  card(s, 0.6, 1.9, 5.0, 4.85, "Model facts card");
  await circleIcon(s, "FaBrain", 0.85, 2.05, 0.55, "Model", C.accent1);
  txt(s, "3D U-Net (MONAI)", { x: 1.55, y: 2.05, w: 3.8, h: 0.55, fontSize: 17, bold: true, valign: "middle", objectName: "Model heading" });
  [["1.19 M", "parameters"], ["4 → 4", "MRI channels → classes"], ["DiceCE", "Dice + cross-entropy loss"], ["Adam", "lr 1e-4, cosine schedule"], ["50", "epochs"], ["42.8 h", "on an RTX 5050 laptop GPU"]].forEach(([v, k], i) => {
    const x = 0.85 + (i % 2) * 2.35, y = 2.8 + Math.floor(i / 2) * 0.88;
    chip(s, [{ text: v, options: { fontSize: 18, bold: true, fontFace: HEAD, color: C.accent1, breakLine: true } }, { text: k, options: { fontSize: 11, bold: false, color: C.background2 } }],
      x, y, 2.2, 0.78, "Model fact " + k, { fill: { color: C.text1 }, align: "left", margin: [10, 4, 0, 0] });
  });
  txt(s, "Data split · BraTS 2023 adult glioma · 1,251 scans", { x: 0.85, y: 5.5, w: 4.5, h: 0.3, fontSize: 11.5, bold: true, color: C.background2, objectName: "Split label" });
  const bw = 4.5, tr = (bw * 875) / 1251, va = (bw * 188) / 1251;
  chip(s, "Train 875", 0.85, 5.85, tr, 0.5, "Train segment", { rectRadius: 0, fill: { color: C.accent4 }, line: { color: C.text2, width: 1 }, fontSize: 12 });
  chip(s, "Val 188", 0.85 + tr, 5.85, va, 0.5, "Validation segment", { rectRadius: 0, fill: { color: C.accent6 }, line: { color: C.text2, width: 1 }, fontSize: 10.5 });
  chip(s, "Test 188", 0.85 + tr + va, 5.85, va, 0.5, "Test segment", { rectRadius: 0, fill: { color: C.accent1 }, line: { color: C.text2, width: 1 }, color: C.text1, fontSize: 10.5 });
  card(s, 5.85, 1.9, 6.88, 4.85, "Training curve card");
  s.addChart(pres.charts.LINE, [{ name: "Validation Dice", labels: EP, values: VAL_DICE }], {
    x: 6.0, y: 2.0, w: 6.6, h: 3.85, chartColors: [C.accent3], lineSize: 2.5, lineDataSymbol: "none",
    showTitle: true, title: "Validation Dice per epoch (higher is better)", titleFontSize: 14, titleColor: C.background1, titleFontFace: "+mj-lt", showLegend: false,
    catAxisLabelColor: C.background2, valAxisLabelColor: C.background2, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
    catAxisLabelFrequency: 5, valAxisMinVal: 0.5, valAxisMaxVal: 0.85, valAxisMajorUnit: 0.05, valAxisLabelFormatCode: "0.00",
    valGridLine: { color: HX.accent6, size: 0.5 }, catGridLine: { style: "none" },
    showCatAxisTitle: true, catAxisTitle: "Epoch", catAxisTitleFontSize: 11, catAxisTitleColor: C.background2, catAxisTitleFontFace: "+mn-lt",
    objectName: "Validation Dice chart",
  });
  txt(s, [{ text: "Best: 0.8011 at epoch 44", options: { bold: true, color: C.accent3 } }, { text: "  →  this checkpoint runs in the app. Validation Dice levelled off near 0.80 after epoch 31." }],
    { x: 6.1, y: 5.95, w: 6.45, h: 0.7, fontSize: 13, objectName: "Training takeaway" });
  addNotes(s, "The AI model", 60,
    "The AI core is a 3D U-Net from the MONAI library. It takes the four MRI sequences as four input channels and labels every voxel as background, necrotic core, oedema or enhancing tumour. It is deliberately compact, 1.19 million parameters, so it can run on a small laptop GPU.\n\n" +
    "I trained it on BraTS 2023 adult glioma data: 875 scans for training, 188 for validation and 188 for testing. The loss is Dice plus cross-entropy, which handles the fact that most voxels are background. Training took 50 epochs and 42.8 hours on an RTX 5050 laptop GPU.\n\n" +
    "The chart shows validation Dice rising from 0.54 to about 0.80 and levelling off after epoch 31. The best value, 0.8011 at epoch 44, is the checkpoint the app uses. Because it levelled off, more epochs alone will not help; a stronger model or augmentation would.");

  // 8. Results ---------------------------------------------------------------------
  pres.addSection({ title: SECTIONS[3] });
  s = contentSlide(2, "Results: accurate tumour outlines and volumes");
  [["0.78", "mean Dice", "188 test scans"], ["0.69", "mean IoU", "188 test scans"], ["0.98", "whole-tumour volume", "agreement with experts (ICC)"], ["0.97", "whole-lesion Dice", "example test scan 00449"]].forEach(([v, k, sub], i) => {
    const x = 0.6 + i * 3.08;
    card(s, x, 1.9, 2.88, 1.45, k + " tile");
    txt(s, v, { x: x + 0.2, y: 1.98, w: 1.45, h: 1.3, fontSize: 40, bold: true, fontFace: HEAD, color: i === 2 ? C.accent3 : C.accent1, valign: "middle", objectName: k + " value" });
    txt(s, [{ text: k, options: { bold: true, breakLine: true } }, { text: sub, options: { color: C.background2 } }], { x: x + 1.62, y: 1.98, w: 1.2, h: 1.3, fontSize: 12, valign: "middle", objectName: k + " label" });
  });
  card(s, 0.6, 3.6, 7.0, 3.15, "3D comparison card");
  // both renders share one scale, so place them with the same inches per pixel, bottom-aligned
  const ai = PX["twin_ai.png"], ex = PX["twin_expert.png"], sc = 2.35 / Math.max(ai.h, ex.h);
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
  addNotes(s, "Results", 65,
    "Now the results. On the 188 test scans the mean Dice score is 0.78 and the mean IoU is 0.69. Dice measures the overlap between the AI's outline and the expert's, where 1 is perfect. For doctors, volume matters most: whole-tumour volume agrees with the experts with an ICC of 0.98, and enhancing tumour 0.98 as well.\n\n" +
    "On the left you can see one test patient in 3D: the AI's result next to the expert's. The whole-lesion Dice for this scan is 0.97.\n\n" +
    "The chart on the right is honest about the weak spot: the necrotic core agrees much less, ICC 0.52, mainly because of a few scans with very large necrotic cores. I come back to this under limitations. One more point: 0.78 is averaged over separate labels, so it is not directly comparable with the region-based scores in BraTS papers.");

  // 9. Digital twin ----------------------------------------------------------------
  s = contentSlide(2, "The 3D digital twin of every patient");
  picture(s, "twin_hero.png", 0.4, 1.75, 6.6, 4.75, "Fitted cortex with AI tumour regions, test scan 00449");
  [["Necrotic core", C.accent4, 0.9, 1.3], ["Oedema", C.accent2, 2.45, 0.8], ["Enhancing tumour", C.accent1, 3.5, 1.5], ["Fitted cortex", C.background2, 5.25, 1.2]].forEach(([label, col, x, w]) => {
    s.addShape(pres.shapes.OVAL, { x, y: 6.6, w: 0.17, h: 0.17, fill: { color: col }, line: { color: col, width: 0.75 }, objectName: label + " key" });
    txt(s, label, { x: x + 0.24, y: 6.52, w, h: 0.33, fontSize: 12, valign: "middle", objectName: label + " key label" });
  });
  txt(s, "How the twin is built", { x: 7.3, y: 1.9, w: 5.4, h: 0.4, fontSize: 18, bold: true, color: C.accent1, objectName: "Twin build heading" });
  [["Template", "FreeSurfer fsaverage folded cortex (41k vertices per hemisphere)"], ["Fit", "scale and ICP alignment to the patient's brain"],
    ["Warp", "pull the gyral crowns onto the patient's outline: 7.08 → 3.81 mm"], ["Complete", "cerebellum and brainstem from the scan; tumour meshes added"]].forEach(([head, desc], i) => {
    const y = 2.45 + i * 0.75;
    chip(s, String(i + 1), 7.3, y + 0.05, 0.42, 0.42, `Twin step ${i + 1} number`, { rectRadius: 0.21, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.75 }, color: C.text1, fontSize: 13 });
    txt(s, [{ text: head + "  ", options: { bold: true } }, { text: desc, options: { color: C.background2 } }], { x: 7.9, y, w: 4.83, h: 0.68, fontSize: 13, objectName: `Twin step ${i + 1} text` });
  });
  ["Cut planes", "Opacity", "Hover details", "Expert wireframes", "Auto-rotate", "STL download"].forEach((t, i) =>
    chip(s, t, 7.3 + (i % 3) * 1.83, 5.55 + Math.floor(i / 3) * 0.47, 1.73, 0.38, "Viewer feature " + t, { rectRadius: 0.19, fill: { color: C.text2 }, fontSize: 11.5, bold: false }));
  txt(s, "Folds come from the template, not the patient; an \"Exact (from scan)\" view is also available.", { x: 7.3, y: 6.5, w: 5.43, h: 0.4, fontSize: 11, italic: true, color: C.background2, objectName: "Twin honesty note" });
  addNotes(s, "The 3D digital twin", 55,
    "This is the digital twin of one test patient. The scans are too coarse to show the brain's folds, so MedTwin takes a standard folded brain, FreeSurfer's fsaverage template, and fits it to the patient: it scales and aligns it, then warps the gyral crowns onto the patient's own brain outline. For this patient the average crown-to-surface distance dropped from 7.08 to 3.81 millimetres. The cerebellum and brainstem come from the scan itself, and the tumour regions are added as colour-coded meshes in real millimetres.\n\n" +
    "In the browser the doctor can cut through it, change opacity, hover for details, compare with expert wireframes and download STL files, for example for 3D printing. To be honest about it: the folds are the template's, not the patient's, so there is also an exact view straight from the scan.");

  // 10. Report ---------------------------------------------------------------------
  s = contentSlide(2, "What the doctor receives: a clear, printable report");
  picture(s, "report_top.png", 0.85, 2.05, 6.2, 4.3, "MedTwin report for test scan 00449", { frame: C.background1, pad: 0.12, rotate: 358 });
  txt(s, "Real MedTwin report for test scan 00449 (AI output, not yet reviewed)", { x: 0.7, y: 6.6, w: 6.5, h: 0.3, fontSize: 11, italic: true, color: C.background2, align: "center", objectName: "Report caption" });
  const reportRows = [["FaRulerCombined", "Volumes", "per region, AI vs corrected, % of brain"], ["FaLocationDot", "Location in words", "\"left hemisphere, anterior\" (side bug fixed)"],
    ["FaGaugeHigh", "Model confidence", "average certainty inside each region"], ["FaRuler", "RANO measurement", "75.1 × 54.0 mm; SPD 4,055 mm²"],
    ["FaLayerGroup", "Separate lesions", "count, size and location of each"], ["FaSignature", "Review status", "not reviewed, approved or rejected, with signature"]];
  for (let i = 0; i < reportRows.length; i++) {
    const [icon, head, desc] = reportRows[i], y = 1.95 + i * 0.78;
    await circleIcon(s, icon, 7.65, y + 0.06, 0.5, head, i % 2 ? C.accent4 : C.accent1);
    txt(s, [{ text: head, options: { bold: true, fontSize: 15, breakLine: true } }, { text: desc, options: { color: C.background2, fontSize: 12.5 } }], { x: 8.35, y, w: 4.38, h: 0.7, objectName: head + " callout" });
  }
  addNotes(s, "The report", 55,
    "This is a real report produced by MedTwin for a test patient, before any doctor has reviewed it. At the top it says clearly that this is AI decision support and not yet reviewed.\n\n" +
    "It lists the volume of each tumour region and its percentage of the brain, the location in plain words, and the model's average confidence. It gives the RANO bidimensional measurement: here 75.1 by 54.0 millimetres, a product of 4,055 square millimetres. It lists separate lesions, and after review it shows who approved or rejected the case, with a signature block.\n\n" +
    "One important fix: the original notebooks reported the tumour side and position inverted, left for right. The app computes the location in millimetres from the brain centre, and I checked it against the raw scan.");

  // 11. Doctor in control ----------------------------------------------------------
  s = contentSlide(2, "The doctor stays in control");
  const ctrl = [["FaPaintbrush", C.accent1, "Correct", "Brush and eraser for each region on any slice. Everything recalculates in about 3 s."],
    ["FaFileSignature", C.accent4, "Sign off", "Approve with name, role and time; reject with a reason. Any edit reopens the case."],
    ["FaClockRotateLeft", C.accent3, "Audit trail", "Append-only log of every analysis, correction (voxels changed) and decision."],
    ["FaChartLine", C.accent2, "Follow-up", "Timeline per patient with SPD, % change and a RANO-based category."]];
  for (let i = 0; i < 4; i++) {
    const [icon, col, head, desc] = ctrl[i], x = 0.6 + i * 3.08;
    card(s, x, 1.9, 2.88, 2.9, head + " card");
    await circleIcon(s, icon, x + 0.25, 2.12, 0.66, head, col, col === C.accent2 ? HX.dk1 : HX.lt1);
    txt(s, head, { x: x + 0.25, y: 2.95, w: 2.4, h: 0.42, fontSize: 18, bold: true, objectName: head + " heading" });
    txt(s, desc, { x: x + 0.25, y: 3.4, w: 2.43, h: 1.35, fontSize: 14, color: C.background2, objectName: head + " text" });
  }
  card(s, 0.6, 5.05, 5.85, 1.7, "Follow-up example card");
  txt(s, [{ text: "Follow-up test", options: { bold: true, fontSize: 15, color: C.accent2, breakLine: true } },
    { text: "Enhancing tumour 12.3 → 50.8 cm³ between two scans: MedTwin reports ", options: {} }, { text: "\"Progression (radiographic)\"", options: { bold: true } }, { text: ", +313% volume, +195% SPD." }],
  { x: 0.85, y: 5.2, w: 5.4, h: 1.45, fontSize: 15, objectName: "Follow-up example" });
  card(s, 6.68, 5.05, 6.05, 1.7, "Safety story card", { line: { color: C.accent1, width: 1.5 } });
  txt(s, [{ text: "Safety checks caught a real problem", options: { bold: true, fontSize: 15, color: C.accent1, breakLine: true } },
    { text: "A test study still had its skull, and the model outlined 1,315 cm³ of \"oedema\". Skull detection now catches this, and any outline over 40% of the brain shows \"do not use\"." }],
  { x: 6.93, y: 5.2, w: 5.6, h: 1.45, fontSize: 14.5, objectName: "Safety story" });
  addNotes(s, "The doctor stays in control", 60,
    "A key design principle: the AI suggests, the doctor decides. The doctor can correct the outline with a brush and eraser on any slice, and all measurements, meshes and the report recalculate in about 3 seconds. The doctor approves with name, role and time, or rejects with a reason, and any later edit reopens the case. Every analysis, correction and decision goes into an append-only audit trail.\n\n" +
    "For follow-up, scans are grouped by patient code. In my test with two scans, enhancing tumour went from 12.3 to 50.8 cubic centimetres, and MedTwin reported radiographic progression: plus 313% volume and plus 195% SPD.\n\n" +
    "Safety checks matter too. In one test the skull had not been removed, and the model outlined 1,315 cubic centimetres of 'oedema'. Now the skull is detected, and any outline over 40% of the brain gets a 'do not use' warning.");

  // 12. Hospital-ready -------------------------------------------------------------
  s = contentSlide(2, "Built for a real hospital network");
  card(s, 0.6, 1.9, 5.9, 4.85, "Network diagram card");
  const server = { x: 3.55, y: 4.15 };
  const devices = [["FaUserDoctor", "Radiologist", "review, correct, sign", 1.45, 2.65, C.accent1], ["FaUsers", "Clinician", "read-only", 5.6, 2.65, C.accent4],
    ["FaUserGear", "Administrator", "manages accounts", 1.45, 5.55, C.accent3], ["FaGlobe", "Any browser", "nothing to install", 5.6, 5.55, C.accent5]];
  devices.forEach(([, label, , x, y]) => arrow(s, server.x, server.y, x, y, `Link to ${label}`, { color: C.accent6, width: 2, noHead: true, dash: true }));
  await circleIcon(s, "FaServer", server.x - 0.65, server.y - 0.65, 1.3, "MedTwin computer", C.accent1);
  txt(s, [{ text: "MedTwin computer", options: { bold: true, breakLine: true } }, { text: "GPU · HTTPS :8443", options: { color: C.background2 } }], { x: server.x - 1.2, y: server.y + 0.7, w: 2.4, h: 0.55, fontSize: 12, align: "center", objectName: "Server label" });
  for (const [icon, label, role, x, y, col] of devices) {
    await circleIcon(s, icon, x - 0.4, y - 0.62, 0.8, label, col, col === C.accent5 ? HX.dk1 : HX.lt1);
    txt(s, [{ text: label, options: { bold: true, breakLine: true } }, { text: role, options: { color: C.background2 } }], { x: x - 0.9, y: y + 0.22, w: 1.8, h: 0.5, fontSize: 11.5, align: "center", objectName: label + " label" });
  }
  txt(s, "Security and data protection", { x: 6.85, y: 1.9, w: 5.88, h: 0.42, fontSize: 18, bold: true, color: C.accent1, objectName: "Security heading" });
  const sec = ["DICOM identifiers never read or stored; DICOM files deleted after conversion", "Passwords: PBKDF2-SHA256, 260,000 iterations; 5 wrong tries lock for 5 min",
    "Forgot password without email: one-time recovery codes or an administrator reset", "Secure sessions (HttpOnly cookies, 12-hour idle timeout) and CSRF protection",
    "Revision check: no doctor overwrites a colleague's newer work", "Runs inside the hospital network: no cloud upload"];
  for (let i = 0; i < sec.length; i++) {
    const y = 2.45 + i * 0.56;
    await circleIcon(s, "FaCheck", 6.85, y + 0.04, 0.34, "Security point " + (i + 1), C.accent3, HX.dk1);
    txt(s, sec[i], { x: 7.35, y, w: 5.38, h: 0.5, fontSize: 12.5, valign: "middle", objectName: "Security point text " + (i + 1) });
  }
  card(s, 6.85, 5.92, 5.88, 0.83, "DICOM test card");
  txt(s, [{ text: "Hospital-style DICOM test: ", options: { bold: true, color: C.accent2 } }, { text: "all four series recognised; volumes 12.26 / 4.61 / 23.38 cm³ vs 12.30 / 4.47 / 21.77 from the clean files." }],
    { x: 7.05, y: 5.95, w: 5.5, h: 0.77, fontSize: 12.5, valign: "middle", objectName: "DICOM test text" });
  addNotes(s, "Hospital-ready", 55,
    "MedTwin is designed for a hospital network. One computer with the GPU runs MedTwin; doctors open it from any browser over HTTPS on port 8443, with nothing to install. There are three roles: radiologists review, correct and sign; clinicians can view but not change; administrators manage accounts.\n\n" +
    "On security: patient identifiers in DICOM files are never read, and the DICOM files are deleted after conversion. Passwords are hashed with PBKDF2 and 260,000 iterations, and wrong attempts lock the account. Forgotten passwords work without email, through recovery codes or an administrator reset. Sessions and requests are protected, a revision check stops one doctor from overwriting another's work, and nothing leaves the hospital network.\n\n" +
    "I tested the DICOM path with a synthetic hospital-style study: all four series were recognised and the volumes matched the clean files closely.");

  // 13. Verification ---------------------------------------------------------------
  s = contentSlide(2, "Tested, not just built");
  card(s, 0.6, 1.9, 3.6, 4.85, "Test count card", { line: { color: C.accent3, width: 1.5 } });
  txt(s, [{ text: "62", options: { fontSize: 88, bold: true, fontFace: HEAD, color: C.accent3, breakLine: true } }, { text: "automated tests pass", options: { fontSize: 18, bold: true, breakLine: true } },
    { text: " ", options: { fontSize: 10, breakLine: true } },
    { text: "unit · clinical · accounts · password recovery · regression on a real patient · isolated from real data", options: { fontSize: 13, color: C.background2 } }],
  { x: 0.85, y: 2.05, w: 3.15, h: 4.5, objectName: "Test count" });
  const checks = [["FaLocationCrosshairs", C.accent1, "Side bug found and fixed", "The notebooks reported left/right, front/back and up/down inverted. Checked on the raw scan: 15.7 mm left, 42.0 mm anterior, 10.4 mm superior."],
    ["FaBrain", C.accent4, "Skull stripping checked", "HD-BET brain mask Dice 0.97 against the BraTS brain region."],
    ["FaMicrochip", C.accent3, "Runs on a 2 GB laptop GPU", "About 20–35 s per prepared case on an NVIDIA MX550 (not a formal benchmark)."],
    ["FaUserShield", C.accent5, "Three roles tested in the browser", "Setup, forced password change, radiologist sign-off, clinician read-only (API refuses with 403)."]];
  for (let i = 0; i < 4; i++) {
    const [icon, col, head, desc] = checks[i], x = 4.45 + (i % 2) * 4.2, y = 1.9 + Math.floor(i / 2) * 2.5;
    card(s, x, y, 4.08, 2.35, head + " card");
    await circleIcon(s, icon, x + 0.25, y + 0.25, 0.6, head, col, col === C.accent5 ? HX.dk1 : HX.lt1);
    txt(s, head, { x: x + 1.0, y: y + 0.25, w: 2.9, h: 0.6, fontSize: 15, bold: true, valign: "middle", objectName: head + " heading" });
    txt(s, desc, { x: x + 0.25, y: y + 1.0, w: 3.6, h: 1.25, fontSize: 12.5, color: C.background2, objectName: head + " text" });
  }
  addNotes(s, "Tested, not just built", 50,
    "I did not want a demo that only works once, so the project has 62 automated tests: unit tests, clinical tests such as RANO diameters and brush strokes landing on the right voxel, account and password-recovery tests, and a regression test on a real patient. They run in their own data folder, so they never touch real accounts or cases.\n\n" +
    "Testing found real bugs. The biggest: the original notebooks reported the tumour side inverted. I fixed it and confirmed the position against the raw scan. HD-BET skull stripping was checked at Dice 0.97. The app runs on a 2 GB laptop GPU, and I tested all three roles in the browser, including that the clinician cannot change anything even through the API.");

  // 14. Research paper -------------------------------------------------------------
  s = contentSlide(2, "Research contribution: the paper draft is ready");
  picture(s, "paper_figure_page.png", 2.75, 1.95, 3.4, 4.45, "Manuscript page 12 with Fig. 4", { frame: C.background1, pad: 0.06, rotate: 4 });
  picture(s, "paper_page1.png", 0.75, 2.25, 4.1, 4.1, "Manuscript page 1: title and abstract", { frame: C.background1, pad: 0.06, rotate: 357 });
  txt(s, "Draft manuscript: title page and Fig. 4", { x: 0.6, y: 6.55, w: 5.9, h: 0.3, fontSize: 11, italic: true, color: C.background2, align: "center", objectName: "Paper caption" });
  txt(s, [{ text: "Target journal: ", options: { color: C.background2 } }, { text: "Discover Artificial Intelligence (Springer Nature)", options: { bold: true } }], { x: 6.85, y: 1.9, w: 5.88, h: 0.4, fontSize: 14, objectName: "Target journal" });
  [["62", "papers reviewed in detail"], ["86", "verified references"], ["24", "pages, 5 colour figures"]].forEach(([v, k], i) => {
    const x = 6.85 + i * 2.0;
    card(s, x, 2.45, 1.88, 1.2, k + " tile");
    txt(s, [{ text: v, options: { fontSize: 30, bold: true, fontFace: HEAD, color: C.accent2, breakLine: true } }, { text: k, options: { fontSize: 11, color: C.background2 } }], { x: x + 0.12, y: 2.5, w: 1.64, h: 1.1, align: "center", valign: "middle", objectName: k + " value" });
  });
  txt(s, [{ text: "New analyses for the paper", options: { bold: true, color: C.accent1, breakLine: true } },
    { text: "Audit of the data split (patient overlap)", options: { bullet: true, breakLine: true } }, { text: "Volume agreement with experts (ICC, Bland–Altman)", options: { bullet: true, breakLine: true } },
    { text: "Failure analysis: large necrotic cores", options: { bullet: true } }], { x: 6.85, y: 3.85, w: 5.88, h: 1.3, fontSize: 13.5, paraSpaceAfter: 3, objectName: "New analyses" });
  card(s, 6.85, 5.25, 5.88, 1.5, "Contribution card", { line: { color: C.accent2, width: 1.25 } });
  txt(s, [{ text: "Contribution: ", options: { bold: true, color: C.accent2 } }, { text: "an open, clinician-in-the-loop workflow from DICOM to signed report on a 2 GB GPU, not a new segmentation method.", options: { breakLine: true } },
    { text: "Drafted with AI assistance from my project files; I will verify every number and rewrite Results and Discussion in my own words, as Springer Nature's policy requires.", options: { fontSize: 11.5, italic: true, color: C.background2 } }],
  { x: 7.05, y: 5.33, w: 5.5, h: 1.36, fontSize: 13, objectName: "Contribution text" });
  addNotes(s, "Research contribution", 60,
    "The research side. The paper is drafted for Discover Artificial Intelligence, a Springer Nature journal. It is backed by a literature review of 62 papers and 86 references, each checked against Crossref, PubMed or arXiv records. The manuscript is 24 pages with five colour figures; you can see the title page and Figure 4 here.\n\n" +
    "I also added new analyses: an audit of the data split, volume agreement with the experts, and a failure analysis.\n\n" +
    "I position the contribution honestly: it is not a new segmentation algorithm. It is an open, clinician-in-the-loop workflow from DICOM to a signed report that runs on a 2 GB GPU. I should also tell you that the draft was prepared with AI assistance from my project files. Before submission I will verify every number, rewrite the Results and Discussion in my own words, and keep the AI declaration, as the journal's policy requires.");

  // 15. Limitations ----------------------------------------------------------------
  pres.addSection({ title: SECTIONS[4] });
  s = contentSlide(3, "Honest limitations, and how I will fix each one");
  const limits = [["Research data only", "Accuracy shown on BraTS; the DICOM path was tested on one synthetic study.", "retrospective study on hospital scans"],
    ["Scan-level split", "28 of 188 test scans share a patient with training or validation.", "re-split by patient; report the 160 clean scans"],
    ["Necrotic-core weak spot", "Very large necrotic cores are under-segmented (ICC 0.52).", "augmentation, nnU-Net, more such examples"],
    ["Metrics incomplete", "Only label-wise mean Dice; no region-wise Dice, HD95 or confidence intervals.", "full BraTS-style evaluation"],
    ["Glioma only", "One disease model so far: adult glioma.", "meningioma, metastases, stroke, MS models"],
    ["Not clinically approved", "Decision support only; HD-BET weights are non-commercial (CC BY-NC).", "regulatory pathway (CDSCO); SynthStrip"]];
  for (let i = 0; i < 6; i++) {
    const [head, desc, fix] = limits[i], x = 0.6 + (i % 3) * 4.115, y = 1.9 + Math.floor(i / 3) * 2.45;
    card(s, x, y, 3.9, 2.28, head + " card");
    await circleIcon(s, "FaTriangleExclamation", x + 0.22, y + 0.22, 0.5, head, C.accent2, HX.dk1);
    txt(s, head, { x: x + 0.85, y: y + 0.22, w: 2.9, h: 0.5, fontSize: 15, bold: true, valign: "middle", objectName: head + " heading" });
    txt(s, desc, { x: x + 0.22, y: y + 0.85, w: 3.5, h: 0.8, fontSize: 12.5, color: C.background2, objectName: head + " text" });
    txt(s, [{ text: "Fix → ", options: { bold: true } }, { text: fix }], { x: x + 0.22, y: y + 1.7, w: 3.5, h: 0.5, fontSize: 12.5, color: C.accent5, objectName: head + " fix" });
  }
  addNotes(s, "Honest limitations", 60,
    "I want to be clear about what is not done yet, and how I plan to fix each item.\n\n" +
    "First, accuracy is shown only on BraTS research data, and the DICOM path was tested on one synthetic study, so a study on real hospital scans is needed. Second, my own audit found that the split was made per scan, not per patient: 28 of the 188 test scans come from patients who also had a scan in training or validation. I will re-split by patient. Third, very large necrotic cores are under-segmented. Fourth, I report only the mean Dice over labels, so I need region-wise Dice, HD95 and confidence intervals. Fifth, it covers only glioma. And sixth, it is decision support, not a clinically approved device, and the HD-BET weights are for non-commercial use only.");

  // 16. Future scope ---------------------------------------------------------------
  s = contentSlide(3, "Future scope: from prototype to hospital tool");
  arrow(s, 0.9, 2.12, 12.45, 2.12, "Roadmap track", { color: C.accent5, width: 3 });
  const stages = [["FaFlask", "STEP 1 · FINISH THE RESEARCH", ["Patient-level re-split and re-test", "nnU-Net baseline comparison", "Region-wise Dice, HD95, 95% confidence intervals", "Runtime benchmark and RANO agreement", "Submit to Discover Artificial Intelligence"]],
    ["FaHandshake", "STEP 2 · HOSPITAL PILOT", ["Partner hospital and ethics approval", "Retrospective study with radiologist outlines", "PACS export: DICOM SEG and structured report", "Hospital single sign-on, trusted certificate"]],
    ["FaRocket", "STEP 3 · GROW THE PLATFORM", ["More diseases: meningioma, metastases (BraTS 2023), stroke (ISLES 2022), MS lesions", "Personal anatomy: lobes, distance to eloquent areas (SynthSeg)", "Predictive twin: model tumour growth from follow-up scans", "Licence-safe tools and quality work (ISO 13485, IEC 62304, CDSCO)"]]];
  for (let i = 0; i < 3; i++) {
    const [icon, head, items] = stages[i], x = 0.6 + i * 4.09;
    s.addShape(pres.shapes.OVAL, { x: x + 1.83, y: 1.98, w: 0.28, h: 0.28, fill: { color: C.accent5 }, line: { color: C.text1, width: 2 }, objectName: `Roadmap stop ${i + 1}` });
    card(s, x, 2.5, 3.95, 4.25, head + " card", { line: { color: C.accent5, width: 1 } });
    await circleIcon(s, icon, x + 0.22, 2.68, 0.58, head, C.accent5, HX.dk1);
    txt(s, head, { x: x + 0.95, y: 2.68, w: 2.9, h: 0.58, fontSize: 12.5, bold: true, color: C.accent5, charSpacing: 1, valign: "middle", objectName: head + " heading" });
    txt(s, items.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < items.length - 1 } })), { x: x + 0.22, y: 3.45, w: 3.55, h: 3.2, fontSize: 14, paraSpaceAfter: 7, objectName: head + " list" });
  }
  addNotes(s, "Future scope", 65,
    "Here is the future plan in three steps.\n\n" +
    "Step 1 is finishing the research: re-split the data by patient and re-test, compare against nnU-Net, which is the standard strong baseline, report region-wise Dice and HD95 with confidence intervals, benchmark the runtime and check agreement with RANO measurements, and then submit the paper.\n\n" +
    "Step 2 is a hospital pilot: find a partner hospital, get ethics approval, and run a retrospective study against radiologists' outlines. For daily use it must also export to PACS, as DICOM SEG and structured reports, and connect to the hospital login.\n\n" +
    "Step 3 grows the platform: more diseases such as meningioma, metastases, stroke and multiple sclerosis; personal anatomy such as which lobe the tumour is in and its distance to critical areas; and a predictive twin that models tumour growth from follow-up scans. Commercial use would need licence-safe tools and the medical-device quality standards.");

  // 17. Purpose --------------------------------------------------------------------
  s = contentSlide(3, "Why it matters: the purpose behind MedTwin");
  txt(s, [{ text: "Fast, consistent tumour measurements and a 3D view the doctor can trust, ", options: {} },
    { text: "on a low-cost laptop GPU, inside the hospital.", options: { color: C.accent1 } }],
  { x: 0.6, y: 1.85, w: 12.13, h: 1.3, fontSize: 28, bold: true, fontFace: HEAD, valign: "middle", objectName: "Purpose statement" });
  const impact = [["FaUserDoctor", C.accent1, "For doctors", "Review and correct instead of outlining from scratch. Standard RANO numbers and volumes in one report."],
    ["FaHeartPulse", C.accent4, "For patients", "Consistent follow-up: \"is it growing?\" answered with numbers. A 3D view that helps explain the treatment."],
    ["FaHospital", C.accent3, "For hospitals", "Runs on a 2 GB GPU on the hospital network. No cloud upload, so data stays inside. Built on open-source libraries."]];
  for (let i = 0; i < 3; i++) {
    const [icon, col, head, desc] = impact[i], x = 0.6 + i * 4.115;
    card(s, x, 3.45, 3.9, 3.3, head + " card");
    await circleIcon(s, icon, x + 0.3, 3.75, 0.8, head, col);
    txt(s, head, { x: x + 0.3, y: 4.75, w: 3.3, h: 0.45, fontSize: 19, bold: true, objectName: head + " heading" });
    txt(s, desc, { x: x + 0.3, y: 5.25, w: 3.3, h: 1.4, fontSize: 15, color: C.background2, objectName: head + " text" });
  }
  addNotes(s, "Why it matters", 45,
    "So what is the purpose? MedTwin aims to give fast, consistent tumour measurements and a 3D view a doctor can trust, on a low-cost laptop GPU and inside the hospital.\n\n" +
    "For doctors, it means reviewing and correcting instead of outlining from scratch, with standard RANO numbers in the report. For patients, follow-up becomes consistent, and the 3D view helps explain the treatment. For hospitals, it runs on modest hardware on their own network, with no cloud upload, which matters for patient privacy and for hospitals with limited budgets.");

  // 18. Closing --------------------------------------------------------------------
  pres.addSection({ title: SECTIONS[5] });
  s = pres.addSlide({ masterName: "HERO", sectionTitle: SECTIONS[5] });
  s.addText("THANK YOU", { placeholder: "kicker" });
  s.addText("Questions?", { placeholder: "title" });
  s.addText("Thank you for your guidance throughout this project.", { placeholder: "body" });
  chip(s, "5 OF 6 OBJECTIVES DONE  ·  PAPER DRAFT READY", 0.7, 4.7, 4.6, 0.44, "Closing status", { rectRadius: 0.22, fill: { color: C.text1 }, line: { color: C.accent3, width: 1.5 }, color: C.accent3, fontSize: 12, charSpacing: 1 });
  txt(s, "[Your name]  ·  Guide: [Guide's name]", { x: 0.7, y: 5.6, w: 5.9, h: 0.4, fontSize: 16, bold: true, objectName: "Closing presenter line" });
  card(s, 7.0, 0.9, 5.73, 5.85, "Guidance panel", { line: { color: C.accent1, width: 1.25 } });
  txt(s, "Where I would value your guidance", { x: 7.35, y: 1.15, w: 5.1, h: 0.5, fontSize: 19, bold: true, color: C.accent1, objectName: "Guidance heading" });
  const asks = [["FaFileLines", "Review the paper draft and plan the submission timeline"], ["FaHandshake", "Help to reach a partner hospital and the ethics committee"], ["FaMicrochip", "Access to a stronger GPU for nnU-Net and the patient-level re-split"]];
  for (let i = 0; i < 3; i++) {
    const [icon, t] = asks[i], y = 1.95 + i * 1.5;
    await circleIcon(s, icon, 7.35, y, 0.75, "Guidance " + (i + 1), [C.accent1, C.accent4, C.accent3][i]);
    txt(s, [{ text: `0${i + 1}`, options: { fontSize: 12, bold: true, color: C.background2, breakLine: true } }, { text: t, options: { fontSize: 16 } }], { x: 8.35, y: y - 0.05, w: 4.1, h: 1.2, objectName: "Guidance item " + (i + 1) });
  }
  addNotes(s, "Questions", 30,
    "To summarise: the MedTwin system is complete and tested, from DICOM to a signed report with a 3D digital twin, and the paper draft is ready.\n\n" +
    "There are three things where your guidance would help most: reviewing the paper and planning the submission, helping me reach a partner hospital and the ethics committee for real-world validation, and access to a stronger GPU for the nnU-Net and re-split experiments.\n\n" +
    "Thank you. I am happy to take questions, or to show the app live.");

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
    "# MedTwin project review: speaker script (for the guide)",
    "",
    "What to say with `MedTwin_Project_Review.pptx`; the same text is in each slide's speaker notes. Say it in your own words; the times are a guide.",
    "",
    `Talk length: about ${Math.round(total / 60)} minutes, plus questions. A live demo of the app after slide 18 works well if there is time.`,
    "",
    "## Before you present",
    "",
    "- Fill in the placeholders on slides 1 and 18: your name, your guide's name, department, college and date.",
    "- Keep slides 15 (limitations) and 14 (AI-assistance note). Guides value honesty, and it protects you in the viva.",
    "- If time is short, shorten slides 5, 9 and 13.",
    "- Have the app running in a browser in case your guide asks for a demo (see the README's quick start).",
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
    "## Questions your guide may ask",
    "",
    "| Question | Suggested answer |",
    "| --- | --- |",
    "| What is new in your work? | Not a new segmentation algorithm. The contribution is a complete, clinician-in-the-loop system: DICOM to a signed report with volumes, RANO, a 3D twin, correction and audit, for several doctors, on a 2 GB GPU, plus an honest evaluation (split audit, failure analysis). |",
    "| Why is your Dice (0.78) lower than BraTS leaders? | Small network (1.19 M parameters), no data augmentation, one split, and a stricter metric: the mean over separate labels, which is not comparable with region-wise WT/TC/ET scores. An nnU-Net baseline and region-wise metrics are the next experiments. |",
    "| Is it really a digital twin? | It is a patient-specific 3D anatomical model with measurements that is updated with each follow-up scan. It does not yet predict tumour growth; a predictive twin is in the future scope. |",
    "| What about data leakage? | My own audit found that 28 of the 188 test scans share a patient with training or validation, because the split was per scan. Volume agreement was similar on the 160 independent scans. Next: re-split by patient and re-score. |",
    "| Is it clinically validated? | No. It is tested on research data and one synthetic hospital-style study. It needs a retrospective hospital study, ethics approval and regulatory clearance (CDSCO in India). The app labels itself as decision support. |",
    "| How is patient privacy protected? | DICOM identifiers are never read, DICOM files are deleted after conversion, cases use pseudonymous codes, and everything runs on the hospital network over HTTPS with roles and an audit log. The app does not encrypt files at rest, so the computer should use BitLocker. |",
    "| Why a U-Net and not a Transformer? | The U-Net is the proven baseline for 3D medical segmentation and fits a 2 GB GPU. Swin UNETR and nnU-Net are planned comparisons. |",
    "| What is your own code and what comes from libraries? | Libraries: PyTorch and MONAI (network and training tools), SimpleITK (DICOM, registration), HD-BET (skull stripping), trimesh (meshes), FastAPI (server), Three.js (3D view). The project's own code: the training set-up, the medtwin package (pipeline, measurements, RANO, location, cortex fitting, meshing, report), the server (accounts, review, audit, queue), the web interface, the 62 tests and the evaluation analyses. |",
    "| How long does an analysis take? | About 20–35 s per prepared case on the 2 GB MX550, and about 5 minutes for a raw DICOM study that needs skull stripping on the CPU. Training took 42.8 hours. These are not formal benchmarks; a runtime benchmark is planned. |",
    "| Did you use AI to write the paper? | The draft was prepared with AI assistance from my project files and analyses. Under Springer Nature's policy I must verify every number, rewrite the Results and Discussion in my own words, and declare the AI use in the manuscript, and I will. |",
    "",
    "## Where the numbers come from",
    "",
    "All numbers come from the project, read without changing anything: `README.md` (features, verification, roadmap), `research_paper/01_project_review.md` and `research_paper/analysis/results/` (training history, split audit, volume agreement, error analysis), and the stored app outputs for test scan 00449 (`medtwin_app/data/jobs/d43e76abdfac`: report, meshes). The images on the slides are real outputs: 3D renders of the stored meshes, a screenshot of the stored report, and pages of the draft manuscript.",
    "",
    "To rebuild: `presentation/source/make_guide_assets.py` (with the app's Python), `presentation/source/render_paper_pages.py` (any Python with PyMuPDF), then `node presentation/source/build_guide_deck.js`.",
    "",
  );
  fs.writeFileSync(SCRIPT_MD, parts.join("\n"), "utf8");
}

build().catch((e) => { console.error(e); process.exit(1); });
