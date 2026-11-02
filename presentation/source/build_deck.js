/*
 * Builds presentation/MedTwin_ML_Explained.pptx (19 slides, speaker notes on every slide)
 * and presentation/speaker_script.md from one source.
 *
 * Audience: 1st and 2nd year students. Length: about 17 minutes + questions.
 * Every number comes from the project or from research_paper/ (read-only):
 *   research_paper/01_project_review.md, analysis/results/*.json|csv, manuscript/figures/Fig4_case_statistics.json,
 *   presentation/assets/label_share.json (made by make_assets.py). Toy examples are labelled as such.
 *
 * Needs: pptxgenjs, react, react-dom, react-icons, sharp (npm install them next to this file, or set NODE_PATH).
 * Theme colours are written by the pptx skill's apply_theme.js: set PPTX_APPLY_THEME to its path.
 * Run: node presentation/source/build_deck.js
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
const OUT = path.join(ROOT, "MedTwin_ML_Explained.pptx");
const SCRIPT_MD = path.join(ROOT, "speaker_script.md");

const THEME = {
  name: "MedTwin Neuro",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "1B2430", lt1: "FFFFFF", dk2: "0F2A3D", lt2: "F4F2ED",
    accent1: "D55E00",   // vermilion: enhancing tumour, the deck's sharp accent
    accent2: "0072B2",   // blue: necrotic core
    accent3: "F0E442",   // yellow: oedema (on dark only)
    accent4: "009E73",   // green
    accent5: "56B4E9",   // sky (blue on dark backgrounds)
    accent6: "5E6B78",   // slate
    hlink: "0072B2", folHlink: "5E6B78",
  },
};
const HX = THEME.colors;
const HEAD = "+mj-lt";                                            // theme heading font for numbers and formulas

// ---------- data ----------
const hist = fs.readFileSync(path.join(RESULTS, "training_history.csv"), "utf8").trim().split(/\r?\n/).slice(1)
  .map((l) => l.split(",").map(Number));
const EP = hist.map((r) => String(r[0]));
const TRAIN_LOSS = hist.map((r) => r[1]);
const VAL_LOSS = hist.map((r) => r[2]);
const VAL_DICE = hist.map((r) => r[3]);
const SHARE = JSON.parse(fs.readFileSync(path.join(ASSETS, "label_share.json"), "utf8")).percent_of_scan;

// ---------- deck ----------
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";                                      // 13.333 x 7.5 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "MedTwin: the machine learning inside";
pres.subject = "Machine-learning walkthrough for 1st and 2nd year students";
const C = pres.SchemeColor;

pres.defineSlideMaster({
  title: "DARK",
  background: { color: C.text2 },
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: 0.8, y: 1.5, w: 7.4, h: 0.45, fontSize: 14, bold: true, color: C.accent3, charSpacing: 3, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 2.0, w: 7.4, h: 2.1, fontSize: 44, bold: true, color: C.background1, margin: 0, valign: "top", align: "left" }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.8, y: 4.25, w: 7.2, h: 1.2, fontSize: 20, color: C.accent5, margin: 0, valign: "top" }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: C.background2 },
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: 0.6, y: 0.36, w: 9, h: 0.36, fontSize: 12, bold: true, color: C.accent1, charSpacing: 2, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.72, w: 12.13, h: 0.85, fontSize: 32, bold: true, color: C.text2, margin: 0, valign: "middle", align: "left" }, text: "" } },
    { text: { text: "MedTwin · machine learning from basics to advanced", options: { x: 0.6, y: 7.02, w: 7, h: 0.3, fontSize: 10, color: C.accent6, margin: 0, valign: "middle" } } },
  ],
  slideNumber: { x: 12.13, y: 7.02, w: 0.6, h: 0.3, fontSize: 10, color: C.accent6, align: "right" },
});

// ---------- helpers ----------
function txt(s, text, o) {
  s.addText(text, Object.assign({ isTextBox: true, margin: 0, fontSize: 15, color: C.text1, valign: "top" }, o));
}
function card(s, x, y, w, h, name, o) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, Object.assign({
    x, y, w, h, rectRadius: 0.1, fill: { color: C.background1 }, line: { color: C.background1, width: 0.75 },
    shadow: { type: "outer", color: HX.dk1, opacity: 0.12, blur: 8, offset: 2, angle: 90 }, objectName: name,
  }, o));
}
function chip(s, text, x, y, w, h, name, o) {                     // rounded shape carrying its own text
  s.addText(text, Object.assign({
    isTextBox: true, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: Math.min(h / 2, 0.12), x, y, w, h, margin: 3,
    fill: { color: C.background1 }, line: { color: C.background1, width: 0.75 }, fontSize: 14, bold: true, color: C.text2,
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
async function circleIcon(s, icon, x, y, d, name, fill = C.text2, iconHex = HX.lt1) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0.75 }, objectName: name + " circle" });
  s.addImage({ data: await iconData(icon, iconHex), x: x + d * 0.25, y: y + d * 0.25, w: d * 0.5, h: d * 0.5, objectName: name + " icon", altText: name });
}
const ASPECT = {};
async function loadAspects() {
  for (const f of fs.readdirSync(ASSETS).filter((f) => f.endsWith(".png"))) {
    const m = await sharp(path.join(ASSETS, f)).metadata();
    ASPECT[f] = m.width / m.height;
  }
}
function picture(s, file, x, y, w, h, alt, frame = true) {        // contain-fit, centred, on a dark rounded frame
  let iw = w, ih = w / ASPECT[file];
  if (ih > h) { ih = h; iw = h * ASPECT[file]; }
  const ix = x + (w - iw) / 2, iy = y + (h - ih) / 2;
  if (frame) {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: ix - 0.08, y: iy - 0.08, w: iw + 0.16, h: ih + 0.16, rectRadius: 0.08, fill: { color: C.text2 }, line: { color: C.text2, width: 0.75 }, objectName: alt + " frame" });
  }
  s.addImage({ path: path.join(ASSETS, file), x: ix, y: iy, w: iw, h: ih, objectName: alt, altText: alt });
  return { x: ix, y: iy, w: iw, h: ih };
}
function levelDots(s, level) {
  for (let i = 1; i <= 5; i++) {
    const on = i <= level;
    s.addShape(pres.shapes.OVAL, { x: 11.62 + (i - 1) * 0.23, y: 0.46, w: 0.15, h: 0.15, fill: { color: on ? C.accent1 : C.background2 }, line: { color: on ? C.accent1 : C.accent6, width: 1 }, objectName: `Level marker ${i}` });
  }
}

const SCRIPT = [];                                                 // {title, secs, notes} for speaker_script.md
function addNotes(s, title, secs, notes) {
  const t = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  s.addNotes(`[About ${t}]\n\n${notes}`);
  SCRIPT.push({ title, secs, notes });
}
function contentSlide(section, kicker, title, level) {
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: section });
  s.addText(kicker, { placeholder: "kicker" });
  s.addText(title, { placeholder: "title" });
  if (level) levelDots(s, level);
  return s;
}

// ---------- slides ----------
async function build() {
  await loadAspects();
  const SEC = ["Opening", "Level 1 – Basics", "Level 2 – The model", "Level 3 – Training", "Level 4 – Evaluation and use", "Level 5 – Advanced lessons", "Wrap-up"];
  let s;

  // 1. Title ------------------------------------------------------------------
  pres.addSection({ title: SEC[0] });
  s = pres.addSlide({ masterName: "DARK", sectionTitle: SEC[0] });
  s.addText("MEDTWIN · THE MACHINE LEARNING INSIDE", { placeholder: "kicker" });
  s.addText("Teaching a computer to see brain tumours", { placeholder: "title" });
  s.addText("How MedTwin's 3D U-Net learns to outline a glioma on MRI, from the basics to the hard lessons", { placeholder: "body" });
  txt(s, "For 1st and 2nd year students · about 17 minutes + questions", { x: 0.8, y: 5.75, w: 7.2, h: 0.4, fontSize: 14, color: C.background1, objectName: "Audience line" });
  txt(s, "[Your name] · [Date]", { x: 0.8, y: 6.2, w: 7.2, h: 0.4, fontSize: 14, color: C.accent5, objectName: "Presenter line" });
  picture(s, "label_expert.png", 8.75, 0.95, 3.9, 4.6, "MRI slice with the expert's tumour label", false);
  [["Necrotic core", C.accent5, 8.75, 1.05], ["Oedema", C.accent3, 10.1, 0.7], ["Enhancing tumour", C.accent1, 11.05, 1.4]].forEach(([label, col, x, w]) => {
    s.addShape(pres.shapes.OVAL, { x, y: 5.85, w: 0.16, h: 0.16, fill: { color: col }, line: { color: col, width: 0.75 }, objectName: label + " key" });
    txt(s, label, { x: x + 0.22, y: 5.77, w, h: 0.32, fontSize: 11, color: C.background1, valign: "middle", objectName: label + " key label" });
  });
  txt(s, "Expert label on a BraTS test scan (00449)", { x: 8.75, y: 6.15, w: 3.9, h: 0.3, fontSize: 11, italic: true, color: C.accent5, objectName: "Title image caption" });
  addNotes(s, "Teaching a computer to see brain tumours", 20,
    "Hello everyone. Today I will show you the machine-learning part of our project, MedTwin. MedTwin takes a brain MRI scan and automatically outlines a brain tumour called a glioma, in 3D.\n\n" +
    "We will go step by step: from \"what is machine learning?\" up to the problems that real researchers worry about. You do not need any ML background. The picture on the right is the kind of output you will fully understand by the end: each colour is a different part of the tumour.");

  // 2. The problem ---------------------------------------------------------------
  s = contentSlide(SEC[0], "THE PROBLEM", "Why teach a computer to outline tumours?", 0);
  const rows2 = [
    ["FaBrain", C.accent1, "Glioma", "A tumour that grows from the brain's support (glial) cells: a dead core, an active rim and swelling around it."],
    ["FaClock", C.accent2, "Slow by hand", "An expert outlines it slice by slice through a 3D scan. A BraTS scan has 155 slices."],
    ["FaUsers", C.accent6, "Experts disagree", "Two experts often draw slightly different outlines of the same tumour."],
    ["FaRulerCombined", C.accent4, "Doctors need numbers", "Tumour volume, and how it changes between scans, helps guide treatment."],
  ];
  for (let i = 0; i < rows2.length; i++) {
    const [icon, col, head, desc] = rows2[i], y = 1.9 + i * 0.95;
    await circleIcon(s, icon, 0.6, y, 0.62, head, col);
    txt(s, head, { x: 1.45, y: y - 0.02, w: 5.95, h: 0.32, fontSize: 17, bold: true, color: C.text2, objectName: head + " heading" });
    txt(s, desc, { x: 1.45, y: y + 0.31, w: 5.95, h: 0.55, fontSize: 14, objectName: head + " text" });
  }
  chip(s, [
    { text: "MedTwin's ML job: ", options: { bold: true, color: C.accent3 } },
    { text: "MRI in → 3D tumour map + volumes out, in about half a minute, for a doctor to check and approve." },
  ], 0.6, 5.85, 6.9, 0.9, "Goal callout", { fill: { color: C.text2 }, line: { color: C.text2, width: 0.75 }, color: C.background1, fontSize: 15, bold: false, align: "left", margin: [14, 14, 0, 0] });
  picture(s, "label_expert.png", 8.05, 1.9, 4.6, 3.95, "Expert tumour label on a test scan");
  txt(s, "Goal: give every voxel a tumour label (expert outline, test scan 00449)", { x: 7.9, y: 6.0, w: 4.83, h: 0.5, fontSize: 12, italic: true, color: C.accent6, align: "center", objectName: "Problem image caption" });
  addNotes(s, "Why teach a computer to outline tumours?", 50,
    "First, the problem. A glioma is a tumour that grows from the brain's own support cells, called glial cells. On MRI it has different parts: a dead centre called the necrotic core, an active rim that lights up when the patient gets contrast dye (the enhancing tumour), and swelling around it, called oedema.\n\n" +
    "Doctors want to know how big each part is, and whether it grows or shrinks between scans. Doing this by hand means drawing on every slice of a 3D scan. A BraTS scan has 155 slices, so it is slow, and two experts often draw slightly different outlines.\n\n" +
    "So our goal is: give the computer the MRI, and get back a coloured 3D map plus the volumes in about half a minute. A doctor then checks it and approves it.");

  // 3. What is ML ------------------------------------------------------------------
  pres.addSection({ title: SEC[1] });
  s = contentSlide(SEC[1], "LEVEL 1 · BASICS", "What is machine learning?", 1);
  const flow = (y, label, labelCol, items, name) => {
    txt(s, label, { x: 0.6, y, w: 4, h: 0.32, fontSize: 14, bold: true, color: labelCol, objectName: name + " label" });
    const xs = [0.6, 2.75, 4.85, 7.05], ws = [1.75, 1.3, 1.45, 1.3];
    items.forEach(([t, o], i) => chip(s, t, xs[i], y + 0.4, ws[i], 0.85, `${name} step ${i + 1}`, Object.assign({ shadow: { type: "outer", color: HX.dk1, opacity: 0.12, blur: 6, offset: 2, angle: 90 } }, o)));
    txt(s, "+", { x: 2.35, y: y + 0.4, w: 0.4, h: 0.85, fontSize: 24, bold: true, color: C.accent6, align: "center", valign: "middle", objectName: name + " plus" });
    arrow(s, 6.35, y + 0.825, 7.0, y + 0.825, name + " arrow 2");
    arrow(s, 4.1, y + 0.825, 4.8, y + 0.825, name + " arrow 1");
  };
  flow(1.9, "Normal programming", C.accent6, [
    ["Rules\n(you write them)", {}], ["Data", {}], ["Computer", { fill: { color: C.text2 }, line: { color: C.text2, width: 0.75 }, color: C.background1 }], ["Answers", {}],
  ], "Normal programming");
  flow(3.4, "Machine learning", C.accent1, [
    ["Data", {}], ["Answers\n(labels)", {}], ["Computer learns", { fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.75 }, color: C.background1 }],
    ["Rules\n= the model", { line: { color: C.accent1, width: 2 } }],
  ], "Machine learning");
  card(s, 0.6, 5.05, 7.75, 1.7, "Analogy card");
  await circleIcon(s, "FaGraduationCap", 0.85, 5.35, 0.7, "Analogy", C.accent1);
  txt(s, [
    { text: "Like studying for an exam with solved examples", options: { bold: true, color: C.text2, fontSize: 16, breakLine: true } },
    { text: "Study many solved problems, then solve new ones you have never seen. This is supervised learning: every training example comes with its correct answer." },
  ], { x: 1.8, y: 5.25, w: 6.35, h: 1.35, fontSize: 14, objectName: "Analogy text" });
  card(s, 8.9, 1.9, 3.83, 4.85, "In MedTwin card");
  await circleIcon(s, "FaBrain", 9.15, 2.1, 0.55, "In MedTwin");
  txt(s, "In MedTwin", { x: 9.85, y: 2.15, w: 2.7, h: 0.45, fontSize: 18, bold: true, color: C.text2, valign: "middle", objectName: "In MedTwin heading" });
  [["EXAMPLE (INPUT)", "One MRI scan: four images of the brain"], ["ANSWER (LABEL)", "An expert's tumour outline, voxel by voxel"],
    ["WHAT IT LEARNS", "A rule for \"which tumour part is this voxel?\""], ["STUDY MATERIAL", "875 labelled scans"]].forEach(([k, v], i) => {
    txt(s, [{ text: k, options: { fontSize: 11, bold: true, color: C.accent1, charSpacing: 1, breakLine: true } }, { text: v, options: { fontSize: 14 } }],
      { x: 9.15, y: 2.9 + i * 0.93, w: 3.35, h: 0.85, objectName: "In MedTwin " + k.toLowerCase() });
  });
  addNotes(s, "What is machine learning?", 70,
    "So what is machine learning? In normal programming, you write the rules. For example: \"if the brightness is above 200, call it tumour\". That breaks quickly, because every scanner and every tumour is different.\n\n" +
    "In machine learning we flip it around. We give the computer the data AND the correct answers, and it finds the rules by itself. The rules it learns are what we call the model.\n\n" +
    "This is called supervised learning, because every example comes with the correct answer, like a teacher supervising. Think of preparing for an exam: you study many solved problems, and then you can solve new ones. In MedTwin the solved examples are 875 MRI scans, each with an expert's outline of the tumour.\n\n" +
    "[Ask the room] Can anyone think of another example of supervised learning? (Spam filters, face unlock, handwriting recognition.)");

  // 4. The input -------------------------------------------------------------------
  s = contentSlide(SEC[1], "LEVEL 1 · BASICS", "The input: one patient, four MRI images", 1);
  const seq = [["seq_t1.png", "T1", "Anatomy"], ["seq_t1c.png", "T1c (with contrast dye)", "Active tumour rim glows"],
    ["seq_t2.png", "T2", "Fluid is bright"], ["seq_flair.png", "FLAIR", "Swelling (oedema) is bright"]];
  seq.forEach(([f, name, desc], i) => {
    const x = 0.6 + i * 3.128;
    picture(s, f, x + 0.08, 1.9, 2.72, 2.98, `${name} MRI slice`);
    txt(s, [{ text: name, options: { bold: true, fontSize: 16, color: C.text2, breakLine: true } }, { text: desc, options: { fontSize: 13 } }],
      { x, y: 5.0, w: 2.88, h: 0.7, align: "center", objectName: name + " caption" });
  });
  card(s, 0.6, 5.88, 5.95, 0.87, "Channels card");
  await circleIcon(s, "FaLayerGroup", 0.78, 6.03, 0.57, "Channels", C.accent2);
  txt(s, [{ text: "4 images = 4 channels", options: { bold: true, color: C.text2 } }, { text: ", like a colour photo has 3 (red, green, blue)" }],
    { x: 1.5, y: 5.93, w: 4.95, h: 0.77, fontSize: 14, valign: "middle", objectName: "Channels text" });
  card(s, 6.78, 5.88, 5.95, 0.87, "Voxel card");
  await circleIcon(s, "FaCube", 6.96, 6.03, 0.57, "Voxel", C.accent1);
  txt(s, [{ text: "Voxel = a 3D pixel (1 mm cube).", options: { bold: true, color: C.text2 } }, { text: " One training scan: 128 × 168 × 136 ≈ 2.9 million voxels per channel" }],
    { x: 7.68, y: 5.93, w: 4.95, h: 0.77, fontSize: 14, valign: "middle", objectName: "Voxel text" });
  addNotes(s, "The input: one patient, four MRI images", 55,
    "Let's look at the input. For each patient we get four MRI images of the same brain, taken with different scanner settings.\n\n" +
    "T1 shows the anatomy. T1c is T1 after contrast dye is injected: the active tumour rim glows bright. T2 shows fluid as bright. FLAIR is like T2 but it darkens normal fluid, so swelling stands out.\n\n" +
    "Each sequence shows a different part of the tumour best, so we give all four to the model, stacked together as four channels, just like a colour photo has three channels: red, green and blue.\n\n" +
    "And these are 3D, so instead of pixels we have voxels: 3D pixels, each a 1-millimetre cube. One cropped scan in training was 128 by 168 by 136 voxels. That is about 2.9 million voxels for each channel.");

  // 5. Labels and split ------------------------------------------------------------
  s = contentSlide(SEC[1], "LEVEL 1 · BASICS", "The answer key: expert labels for every voxel", 1);
  picture(s, "label_expert.png", 0.68, 1.9, 4.2, 4.55, "Expert label overlay on T1c");
  txt(s, "Expert label on T1c, test scan 00449", { x: 0.6, y: 6.56, w: 4.36, h: 0.3, fontSize: 11, italic: true, color: C.accent6, align: "center", objectName: "Label image caption" });
  [["0", "Background", "healthy brain and empty space", "AEB6BF", C.text2], ["1", "Necrotic core", "dead tissue in the centre", C.accent2, C.background1],
    ["2", "Oedema", "swelling around the tumour", C.accent3, C.text2], ["3", "Enhancing tumour", "active rim, bright on T1c", C.accent1, C.background1]].forEach(([n, head, desc, fill, tc], i) => {
    const y = 1.95 + i * 0.56;
    chip(s, n, 5.3, y, 0.42, 0.42, `Label ${n} chip`, { fill: { color: fill }, line: { color: fill, width: 0.75 }, color: tc, fontSize: 15 });
    txt(s, [{ text: head, options: { bold: true, color: C.text2 } }, { text: "  ·  " + desc }], { x: 5.9, y, w: 6.8, h: 0.42, fontSize: 15, valign: "middle", objectName: `Label ${n} text` });
  });
  card(s, 5.3, 4.35, 7.43, 2.4, "Dataset split card");
  txt(s, "BraTS 2023 adult glioma: 1,251 labelled scans", { x: 5.55, y: 4.5, w: 7, h: 0.4, fontSize: 16, bold: true, color: C.text2, objectName: "Dataset heading" });
  const barW = 6.93, tr = (barW * 875) / 1251, va = (barW * 188) / 1251;
  chip(s, "Train · 875", 5.55, 5.0, tr, 0.62, "Train segment", { rectRadius: 0, fill: { color: C.text2 }, line: { color: C.background1, width: 1 }, color: C.background1 });
  chip(s, "Val · 188", 5.55 + tr, 5.0, va, 0.62, "Validation segment", { rectRadius: 0, fill: { color: C.accent2 }, line: { color: C.background1, width: 1 }, color: C.background1, fontSize: 13 });
  chip(s, "Test · 188", 5.55 + tr + va, 5.0, va, 0.62, "Test segment", { rectRadius: 0, fill: { color: C.accent1 }, line: { color: C.background1, width: 1 }, color: C.background1, fontSize: 13 });
  txt(s, [
    { text: "Train", options: { bold: true, color: C.text2 } }, { text: " = study material   ·   " },
    { text: "Validation", options: { bold: true, color: C.accent2 } }, { text: " = practice tests to choose the best model   ·   " },
    { text: "Test", options: { bold: true, color: C.accent1 } }, { text: " = the final exam, used once at the end" },
  ], { x: 5.55, y: 5.75, w: 6.93, h: 0.85, fontSize: 13, objectName: "Split explanation" });
  addNotes(s, "The answer key: expert labels for every voxel", 55,
    "Now the answers. For each training scan, experts gave every voxel a number: 0 for background, 1 for necrotic core, 2 for oedema and 3 for enhancing tumour. That is the answer key the model learns from.\n\n" +
    "The data comes from BraTS 2023, a public research challenge dataset with 1,251 labelled adult glioma scans. We split it into three parts: 875 scans for training (the study material), 188 for validation (practice tests that we use to choose the best version of the model), and 188 for testing (the final exam, used only once at the end).\n\n" +
    "Remember this split. It comes back in the advanced part.");

  // 6. Task types ------------------------------------------------------------------
  s = contentSlide(SEC[1], "LEVEL 1 · BASICS", "Three ways to \"see\" a tumour", 1);
  const tasks = [["Classification", "Is there a tumour?", "seq_t1c.png", "Output: one answer per scan"],
    ["Detection", "Where is it, roughly?", "task_detect.png", "Output: a box"],
    ["Segmentation", "Which voxels are tumour, and which part?", "label_expert.png", "Output: a label for every voxel"]];
  tasks.forEach(([head, q, f, out], i) => {
    const x = 0.6 + i * 4.19, mine = i === 2;
    card(s, x, 1.85, 3.75, 4.25, head + " card", mine ? { line: { color: C.accent1, width: 2.5 } } : {});
    txt(s, head, { x: x + 0.25, y: 1.97, w: 3.25, h: 0.4, fontSize: 18, bold: true, color: C.text2, objectName: head + " heading" });
    txt(s, q, { x: x + 0.25, y: 2.37, w: 3.3, h: 0.35, fontSize: 13, italic: true, color: C.accent6, objectName: head + " question" });
    const p = picture(s, f, x + 0.25, 2.85, 3.25, 2.6, head + " example image");
    if (i === 0) chip(s, "YES: tumour", p.x + p.w / 2 - 0.8, p.y + p.h - 0.5, 1.6, 0.36, "Classification answer", { fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.75 }, color: C.background1, fontSize: 13 });
    txt(s, out, { x: x + 0.25, y: 5.6, w: 3.25, h: 0.35, fontSize: 14, bold: mine, color: mine ? C.accent1 : C.text1, objectName: head + " output" });
    if (mine) chip(s, "MedTwin", x + 2.55, 1.98, 1.0, 0.34, "MedTwin tag", { fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.75 }, color: C.background1, fontSize: 12 });
  });
  txt(s, [{ text: "Segmentation = classification done for every voxel: ", options: { bold: true, color: C.text2 } }, { text: "millions of tiny decisions per scan." }],
    { x: 0.6, y: 6.25, w: 12.13, h: 0.45, fontSize: 16, align: "center", valign: "middle", objectName: "Task tagline" });
  addNotes(s, "Three ways to see a tumour", 40,
    "There are three common vision tasks. Classification answers one question for the whole image: is there a tumour, yes or no. Detection draws a box around it. Segmentation goes further: it labels every single voxel. That is what MedTwin does.\n\n" +
    "You can think of segmentation as classification done millions of times, once for every voxel. That is why the output gives exact shapes and volumes, not just a box.");

  // 7. Preprocessing ---------------------------------------------------------------
  pres.addSection({ title: SEC[2] });
  s = contentSlide(SEC[2], "LEVEL 2 · THE MODEL", "Preprocessing: make every scan speak the same language", 2);
  const steps = [["FaCompass", "Orient", [{ text: "Turn every scan to the same direction: RAS (Right, Anterior, Superior)." }]],
    ["FaRulerCombined", "Resample", [{ text: "Make every voxel exactly 1 mm, whatever slice thickness the hospital used." }]],
    ["FaSliders", "Normalise", [{ text: "Fix brightness differences, per channel, inside the head:", options: { breakLine: true } }, { text: "z = (x − mean) / std", options: { fontFace: HEAD, italic: true, color: C.accent1, fontSize: 14 } }]],
    ["FaCropSimple", "Crop", [{ text: "Cut away the empty black background to save memory." }]],
    ["FaBorderAll", "Pad", [{ text: "Grow each side to a multiple of 8, because the U-Net halves the size 3 times (2 × 2 × 2 = 8)." }]]];
  for (let i = 0; i < steps.length; i++) {
    const [icon, head, desc] = steps[i], x = 0.6 + i * 2.4575;
    card(s, x, 1.95, 2.25, 3.15, head + " step card");
    await circleIcon(s, icon, x + 0.2, 2.17, 0.7, head + " step", C.text2);
    txt(s, `STEP ${i + 1}`, { x: x + 1.05, y: 2.37, w: 1.1, h: 0.3, fontSize: 11, bold: true, color: C.accent1, charSpacing: 1, objectName: head + " step number" });
    txt(s, head, { x: x + 0.2, y: 3.05, w: 1.9, h: 0.4, fontSize: 17, bold: true, color: C.text2, objectName: head + " step heading" });
    txt(s, desc, { x: x + 0.2, y: 3.5, w: 1.9, h: 1.5, fontSize: 13, objectName: head + " step text" });
  }
  card(s, 0.6, 5.42, 12.13, 1.13, "Why preprocess card");
  await circleIcon(s, "FaTriangleExclamation", 0.85, 5.64, 0.68, "Why preprocess", C.accent1);
  txt(s, [{ text: "Why bother? ", options: { bold: true, color: C.text2 } },
    { text: "Scanners differ in angle, brightness and slice thickness. Without this step the model can end up learning the scanner instead of the tumour." }],
    { x: 1.8, y: 5.5, w: 10.7, h: 0.97, fontSize: 15, valign: "middle", objectName: "Why preprocess text" });
  addNotes(s, "Preprocessing", 55,
    "Before the model sees a scan, we clean it up so that every scan \"speaks the same language\".\n\n" +
    "One: orient. Rotate every scan to the same standard direction, called RAS: right, anterior, superior.\n" +
    "Two: resample. Make every voxel exactly 1 millimetre, because hospitals scan with different slice thicknesses.\n" +
    "Three: normalise. Scanners give different brightness numbers, so inside the head we subtract the mean and divide by the standard deviation, for each channel. That is the z-score from statistics.\n" +
    "Four: crop away the empty black background to save memory.\n" +
    "Five: pad each side to a multiple of 8, because the U-Net halves the size three times, and 2 × 2 × 2 is 8.\n\n" +
    "If we skip this, the model can end up learning the scanner instead of the tumour. In the full app there are also earlier steps: converting hospital DICOM files, aligning the four scans to each other, and removing the skull.");

  // 8. Convolution -----------------------------------------------------------------
  s = contentSlide(SEC[2], "LEVEL 2 · THE MODEL", "Convolution: a small filter sliding over the image", 2);
  card(s, 0.6, 1.9, 7.4, 4.85, "Convolution diagram card");
  const cell = 0.42;
  txt(s, "Input patch (6 × 6)", { x: 0.85, y: 2.05, w: 2.6, h: 0.3, fontSize: 13, bold: true, color: C.text2, objectName: "Input grid label" });
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    const f = c < 3 ? C.accent6 : C.background2;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.85 + c * cell, y: 2.45 + r * cell, w: cell, h: cell, fill: { color: f }, line: { color: C.background1, width: 1 }, objectName: `Input cell ${r}-${c}` });
  }
  s.addShape(pres.shapes.RECTANGLE, { x: 0.85 + cell, y: 2.45 + cell, w: 3 * cell, h: 3 * cell, fill: { color: C.accent1, transparency: 100 }, line: { color: C.accent1, width: 3 }, objectName: "Filter window on input" });
  txt(s, "×", { x: 3.45, y: 3.5, w: 0.4, h: 0.5, fontSize: 24, bold: true, color: C.accent6, align: "center", valign: "middle", objectName: "Multiply sign" });
  txt(s, "Filter (learned)", { x: 3.85, y: 2.85, w: 1.8, h: 0.3, fontSize: 13, bold: true, color: C.accent1, objectName: "Filter label" });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    txt(s, ["−1", "0", "+1"][c], { shape: pres.shapes.RECTANGLE, x: 3.9 + c * cell, y: 3.2 + r * cell, w: cell, h: cell, fill: { color: C.background1 }, line: { color: C.accent1, width: 1.5 },
      fontSize: 13, bold: true, color: C.text2, align: "center", valign: "middle", objectName: `Filter cell ${r}-${c}` });
  }
  arrow(s, 5.25, 3.83, 5.8, 3.83, "Filter to feature map arrow", { color: C.accent1 });
  txt(s, "Feature map: edge found!", { x: 5.85, y: 2.55, w: 2.1, h: 0.3, fontSize: 13, bold: true, color: C.text2, objectName: "Feature map label" });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const hot = c === 1 || c === 2;
    s.addShape(pres.shapes.RECTANGLE, { x: 5.95 + c * cell, y: 2.99 + r * cell, w: cell, h: cell, fill: { color: hot ? C.accent1 : C.background2 }, line: { color: C.background1, width: 1 }, objectName: `Output cell ${r}-${c}` });
  }
  s.addShape(pres.shapes.RECTANGLE, { x: 5.95 + cell, y: 2.99 + cell, w: cell, h: cell, fill: { color: C.accent1, transparency: 100 }, line: { color: C.text2, width: 3 }, objectName: "Current output cell" });
  txt(s, [
    { text: "Multiply each filter number by the pixel under it, add them up → one output number. Slide and repeat.", options: { breakLine: true } },
    { text: "In MedTwin: ", options: { bold: true, color: C.accent1 } }, { text: "3D filters (3 × 3 × 3) that also look at the slices above and below." },
  ], { x: 0.85, y: 5.25, w: 6.95, h: 1.35, fontSize: 14, paraSpaceAfter: 6, objectName: "Convolution explanation" });
  card(s, 8.35, 1.9, 4.38, 4.85, "Stacking layers card");
  txt(s, "Stacking layers", { x: 8.6, y: 2.05, w: 3.9, h: 0.45, fontSize: 18, bold: true, color: C.text2, valign: "middle", objectName: "Stacking heading" });
  [["1", "Early layers", "edges and bright spots"], ["2", "Middle layers", "textures, rims, blobs"], ["3", "Deep layers", "\"this looks like enhancing tumour\""]].forEach(([n, head, desc], i) => {
    const y = 2.7 + i * 0.95;
    chip(s, n, 8.6, y + 0.05, 0.5, 0.5, `Layer ${n} number`, { fill: { color: C.text2 }, line: { color: C.text2, width: 0.75 }, color: C.background1, fontSize: 15 });
    txt(s, [{ text: head, options: { bold: true, color: C.text2, breakLine: true } }, { text: desc }], { x: 9.3, y, w: 3.25, h: 0.8, fontSize: 14, objectName: `Layer ${n} text` });
  });
  txt(s, "Nobody writes the filter numbers: the network learns them from the examples.", { x: 8.6, y: 5.6, w: 3.9, h: 0.95, fontSize: 15, italic: true, bold: true, color: C.accent1, objectName: "Learned filters note" });
  addNotes(s, "Convolution", 70,
    "Now the core idea behind image models: convolution. Take a small grid of numbers, called a filter or kernel; here it is 3 by 3. Slide it over the image. At each position, multiply each filter number by the pixel under it, add everything up, and write one number into the output.\n\n" +
    "This filter has minus ones on the left and plus ones on the right, so it gives a big number exactly where dark changes to bright: an edge. The output is called a feature map. You can see the orange columns where the edge was found.\n\n" +
    "The important part: in a CNN, a convolutional neural network, nobody writes these numbers. The network learns them during training. Early layers learn simple things like edges, middle layers combine them into textures and rims, and deep layers respond to things like \"this looks like enhancing tumour\".\n\n" +
    "Because MRI is 3D, MedTwin uses 3D filters, 3 by 3 by 3, so the model also looks at the slices above and below.");

  // 9. U-Net -----------------------------------------------------------------------
  s = contentSlide(SEC[2], "LEVEL 2 · THE MODEL", "The 3D U-Net: squeeze to understand, expand to locate", 2);
  card(s, 0.6, 1.85, 8.6, 4.9, "U-Net diagram card");
  const L = [{ c: 2.5, h: 1.1 }, { c: 3.75, h: 0.85 }, { c: 4.85, h: 0.65 }, { c: 5.8, h: 0.5 }];
  const unetBox = (x, lvl, label, fill, name) => {
    const { c, h } = L[lvl];
    chip(s, label, x, c - h / 2, 0.55, h, name, { rectRadius: 0.06, fill: { color: fill }, line: { color: fill, width: 0.75 }, color: C.background1, fontSize: 12 });
  };
  chip(s, "MRI in\n4 channels", 0.82, 2.05, 1.12, 0.9, "U-Net input", { fill: { color: C.background2 }, line: { color: C.accent6, width: 1 }, fontSize: 12 });
  chip(s, "Labels out\n4 classes", 8.0, 2.05, 1.05, 0.9, "U-Net output", { fill: { color: C.background2 }, line: { color: C.accent6, width: 1 }, fontSize: 12 });
  unetBox(2.25, 0, "16", C.accent2, "Encoder level 1");
  unetBox(3.05, 1, "32", C.accent2, "Encoder level 2");
  unetBox(3.85, 2, "64", C.accent2, "Encoder level 3");
  unetBox(4.75, 3, "128", C.text2, "Bottleneck");
  unetBox(5.65, 2, "64", C.accent4, "Decoder level 3");
  unetBox(6.45, 1, "32", C.accent4, "Decoder level 2");
  unetBox(7.25, 0, "16", C.accent4, "Decoder level 1");
  arrow(s, 1.94, 2.5, 2.25, 2.5, "Input arrow");
  arrow(s, 7.8, 2.5, 8.0, 2.5, "Output arrow");
  arrow(s, 2.525, 3.05, 3.325, 3.325, "Down 1", { color: C.accent2 });
  arrow(s, 3.325, 4.175, 4.125, 4.525, "Down 2", { color: C.accent2 });
  arrow(s, 4.125, 5.175, 5.025, 5.55, "Down 3", { color: C.accent2 });
  arrow(s, 5.025, 5.55, 5.925, 5.175, "Up 1", { color: C.accent4 });
  arrow(s, 5.925, 4.525, 6.725, 4.175, "Up 2", { color: C.accent4 });
  arrow(s, 6.725, 3.325, 7.525, 3.05, "Up 3", { color: C.accent4 });
  arrow(s, 2.8, 2.5, 7.25, 2.5, "Skip connection 1", { dash: true, width: 1.5 });
  arrow(s, 3.6, 3.75, 6.45, 3.75, "Skip connection 2", { dash: true, width: 1.5 });
  arrow(s, 4.4, 4.85, 5.65, 4.85, "Skip connection 3", { dash: true, width: 1.5 });
  txt(s, "skip connections: copy fine detail across", { x: 3.0, y: 2.13, w: 4.1, h: 0.3, fontSize: 12, italic: true, color: C.accent6, align: "center", objectName: "Skip connection label" });
  txt(s, [{ text: "ENCODER", options: { bold: true, color: C.accent2, charSpacing: 1, breakLine: true } }, { text: "What is in the scan?", options: { bold: true, color: C.text2, breakLine: true } }, { text: "Halve the size, double the channels" }],
    { x: 0.85, y: 5.3, w: 2.85, h: 1.2, fontSize: 12, objectName: "Encoder label" });
  txt(s, [{ text: "DECODER", options: { bold: true, color: C.accent4, charSpacing: 1, breakLine: true } }, { text: "Where exactly is it?", options: { bold: true, color: C.text2, breakLine: true } }, { text: "Double the size back up" }],
    { x: 6.3, y: 5.3, w: 2.7, h: 1.2, fontSize: 12, align: "right", objectName: "Decoder label" });
  card(s, 9.5, 1.85, 3.23, 4.9, "Network facts card");
  txt(s, "MedTwin's network", { x: 9.72, y: 2.0, w: 2.85, h: 0.45, fontSize: 17, bold: true, color: C.text2, valign: "middle", objectName: "Network facts heading" });
  const facts = [["MONAI 3D U-Net", ""], ["4 channels in → 4 classes out", ""], ["16 → 32 → 64 → 128", " feature channels"],
    ["1.19 million", " parameters (learned numbers)"], ["Residual units:", " shortcut paths that make training easier"], ["Batch norm:", " keeps values in a stable range"]];
  txt(s, facts.map(([b, r], i) => ({ text: b, options: { bold: true, color: C.text2, bullet: true, breakLine: false } }))
    .flatMap((run, i) => [run, { text: facts[i][1], options: { breakLine: i < facts.length - 1 } }]),
  { x: 9.72, y: 2.55, w: 2.85, h: 4.05, fontSize: 14, paraSpaceAfter: 7, objectName: "Network facts list" });
  addNotes(s, "The 3D U-Net", 80,
    "The model is a 3D U-Net, named after its U shape.\n\n" +
    "The left side is the encoder. At each step it halves the size of the image and doubles the number of feature channels: 16, 32, 64, 128. Smaller image, richer description. It learns WHAT is in the scan, but it loses exact positions.\n\n" +
    "The right side is the decoder. It doubles the size back, step by step, to the original resolution, to work out WHERE exactly each part is.\n\n" +
    "The dashed lines are skip connections. They copy fine detail from the encoder straight across to the decoder, so the tumour edges stay sharp.\n\n" +
    "MedTwin's network takes 4 channels in and gives 4 classes out, and it has about 1.19 million learnable numbers, called parameters. It also uses residual units, which are shortcut paths that make training easier, and batch normalisation, which keeps the numbers in a stable range.\n\n" +
    "[Advanced] 1.19 million parameters is small for a 3D segmentation model. That is one reason it can run on a laptop GPU.");

  // 10. Softmax / argmax ----------------------------------------------------------
  s = contentSlide(SEC[2], "LEVEL 2 · THE MODEL", "From raw scores to a label: softmax and argmax", 2);
  card(s, 0.6, 1.95, 2.95, 3.3, "Raw scores card");
  txt(s, "Raw scores (one voxel)", { x: 0.8, y: 2.1, w: 2.6, h: 0.35, fontSize: 14, bold: true, color: C.text2, objectName: "Raw scores heading" });
  [["Background", "0.0"], ["Necrotic", "0.7"], ["Oedema", "1.1"], ["Enhancing", "2.6"]].forEach(([k, v], i) => {
    txt(s, k, { x: 0.8, y: 2.7 + i * 0.6, w: 1.6, h: 0.4, fontSize: 15, valign: "middle", objectName: k + " score label" });
    txt(s, v, { x: 2.45, y: 2.7 + i * 0.6, w: 0.85, h: 0.4, fontSize: 18, bold: true, fontFace: HEAD, color: C.text2, align: "right", valign: "middle", objectName: k + " score" });
  });
  txt(s, "softmax", { x: 3.6, y: 3.1, w: 0.95, h: 0.35, fontSize: 14, bold: true, color: C.accent1, align: "center", objectName: "Softmax label" });
  arrow(s, 3.65, 3.6, 4.5, 3.6, "Softmax arrow", { color: C.accent1 });
  card(s, 4.6, 1.95, 4.45, 3.3, "Probabilities card", { fill: { color: C.text2 }, line: { color: C.text2, width: 0.75 } });
  s.addChart(pres.charts.BAR, [{ name: "Probability", labels: ["Background", "Necrotic", "Oedema", "Enhancing"], values: [0.05, 0.10, 0.15, 0.69] }], {
    x: 4.75, y: 2.05, w: 4.15, h: 3.1, barDir: "col", chartColors: ["AEB6BF", HX.accent5, HX.accent3, HX.accent1], barGapWidthPct: 55,
    showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.00", dataLabelColor: C.background1, dataLabelFontSize: 12, dataLabelFontFace: "+mn-lt",
    showTitle: true, title: "Probabilities (they add up to 1)", titleColor: C.background1, titleFontSize: 14, titleFontFace: "+mj-lt",
    catAxisLabelColor: C.background1, catAxisLabelFontSize: 11, catAxisLabelFontFace: "+mn-lt", catAxisLineShow: false,
    valAxisHidden: true, valAxisMinVal: 0, valAxisMaxVal: 0.85, valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: false,
    objectName: "Softmax probabilities chart",
  });
  txt(s, "argmax", { x: 9.1, y: 3.1, w: 0.95, h: 0.35, fontSize: 14, bold: true, color: C.accent1, align: "center", objectName: "Argmax label" });
  arrow(s, 9.15, 3.6, 9.95, 3.6, "Argmax arrow", { color: C.accent1 });
  card(s, 10.05, 1.95, 2.68, 3.3, "Label result card", { line: { color: C.accent1, width: 2 } });
  txt(s, [{ text: "Label 3", options: { fontSize: 36, bold: true, color: C.accent1, fontFace: HEAD, breakLine: true } },
    { text: "Enhancing tumour", options: { fontSize: 16, bold: true, color: C.text2, breakLine: true } },
    { text: " ", options: { fontSize: 8, breakLine: true } },
    { text: "Confidence = 0.69", options: { fontSize: 15, bold: true, color: C.text2, breakLine: true } },
    { text: "(the highest probability)", options: { fontSize: 12, color: C.accent6 } }],
  { x: 10.2, y: 2.05, w: 2.4, h: 3.1, align: "center", valign: "middle", objectName: "Label result" });
  card(s, 0.6, 5.55, 12.13, 1.2, "Confidence warning card");
  await circleIcon(s, "FaTriangleExclamation", 0.85, 5.8, 0.7, "Confidence warning", C.accent1);
  txt(s, [{ text: "Toy numbers for one voxel. ", options: { bold: true, color: C.text2 } },
    { text: "MedTwin does this for every voxel and shows the top probability as a \"confidence\" map. But high confidence is not the same as correct: we come back to this in Level 5." }],
  { x: 1.8, y: 5.62, w: 10.75, h: 1.06, fontSize: 15, valign: "middle", objectName: "Confidence warning text" });
  addNotes(s, "Softmax and argmax", 40,
    "At the end, the network gives four raw scores for every voxel, one per class. Softmax turns these scores into probabilities that add up to 1.\n\n" +
    "In this made-up example voxel: 5% background, 10% necrotic, 15% oedema, 69% enhancing. Argmax just picks the biggest, so this voxel gets label 3, enhancing tumour.\n\n" +
    "The highest probability, 0.69, is what MedTwin shows as the \"confidence\" for that voxel. Keep that word, confidence, in mind. We will question it later.");

  // 11. Loss ------------------------------------------------------------------------
  pres.addSection({ title: SEC[3] });
  s = contentSlide(SEC[3], "LEVEL 3 · TRAINING", "The loss: one number that says how wrong we are", 3);
  card(s, 0.6, 1.9, 5.75, 4.85, "Class imbalance card", { fill: { color: C.text2 }, line: { color: C.text2, width: 0.75 } });
  const nOed = Math.round(SHARE.oedema), nEnh = Math.round(SHARE.enhancing), nNec = 1, nBg = 100 - nOed - nEnh - nNec;
  const waffle = [...Array(nBg).fill(C.accent6), ...Array(nOed).fill(C.accent3), ...Array(nEnh).fill(C.accent1), ...Array(nNec).fill(C.accent5)];
  waffle.forEach((col, i) => {
    const r = Math.floor(i / 10), c = i % 10;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.85 + c * 0.335, y: 2.15 + r * 0.335, w: 0.29, h: 0.29, fill: { color: col }, line: { color: col, width: 0.5 }, objectName: `Voxel share square ${i + 1}` });
  });
  txt(s, [{ text: `${Math.round(SHARE.background)}%`, options: { fontSize: 44, bold: true, fontFace: HEAD, color: C.background1, breakLine: true } },
    { text: "of all voxels are background", options: { fontSize: 13, color: C.background1, breakLine: true } },
    { text: " ", options: { fontSize: 10, breakLine: true } },
    { text: `${SHARE["necrotic core"].toFixed(1)}%`, options: { fontSize: 30, bold: true, fontFace: HEAD, color: C.accent5, breakLine: true } },
    { text: "necrotic core", options: { fontSize: 13, color: C.background1 } }],
  { x: 4.35, y: 2.15, w: 1.85, h: 3.3, objectName: "Imbalance numbers" });
  txt(s, "One test scan with a big tumour (00449). A lazy model that always says \"background\" would be 93% accurate, and useless.",
    { x: 0.85, y: 5.65, w: 5.3, h: 0.95, fontSize: 13, color: C.background1, objectName: "Imbalance caption" });
  const lossCards = [["FaBullseye", C.accent2, "Cross-entropy loss", "Checks every voxel: is the probability for the right class high? It punishes confident mistakes the most."],
    ["FaCircleHalfStroke", C.accent1, "Dice loss", "Measures the overlap between the predicted and the true tumour, so a tiny region counts as much as a big one."]];
  for (let i = 0; i < 2; i++) {
    const [icon, col, head, desc] = lossCards[i], y = 1.9 + i * 1.95;
    card(s, 6.65, y, 6.08, 1.75, head + " card");
    await circleIcon(s, icon, 6.9, y + 0.25, 0.65, head, col);
    txt(s, head, { x: 7.8, y: y + 0.2, w: 4.7, h: 0.4, fontSize: 17, bold: true, color: C.text2, objectName: head + " heading" });
    txt(s, desc, { x: 7.8, y: y + 0.65, w: 4.7, h: 0.95, fontSize: 14, objectName: head + " text" });
  }
  chip(s, [{ text: "MedTwin trains with DiceCE", options: { bold: true, color: C.accent3 } }, { text: " = Dice loss + cross-entropy", options: { bold: true } }],
    6.65, 5.8, 6.08, 0.95, "DiceCE callout", { fill: { color: C.text2 }, line: { color: C.text2, width: 0.75 }, color: C.background1, fontSize: 16 });
  addNotes(s, "The loss", 55,
    "To learn, the model needs a score for how wrong it is. That score is called the loss. But there is a trap.\n\n" +
    "In this test scan, which has a big tumour, 93% of all voxels are background, and the necrotic core is only half a percent. A lazy model that says \"background\" everywhere would be 93% accurate, and completely useless. This is called class imbalance.\n\n" +
    "So MedTwin uses two losses together. Cross-entropy looks at every voxel and punishes it when the probability for the correct class is low, especially when the model was confident and wrong. Dice loss measures the overlap between the predicted tumour and the true tumour, so a small region counts just as much as a big one. The combination is called DiceCE loss.");

  // 12. Training loop ---------------------------------------------------------------
  s = contentSlide(SEC[3], "LEVEL 3 · TRAINING", "Training: guess, check, adjust, thousands of times", 3);
  const nodes = [[2.8, 1.95, "Forward pass", "scan in → prediction out"], [5.0, 3.45, "Loss", "compare with the expert's answer"],
    [2.8, 4.95, "Backpropagation", "find each weight's share of the error"], [0.6, 3.45, "Update (Adam)", "nudge all 1.19 M weights a little"]];
  nodes.forEach(([x, y, head, desc], i) => {
    card(s, x, y, 2.3, 1.05, head + " node");
    chip(s, String(i + 1), x + 0.12, y + 0.13, 0.4, 0.4, head + " number", { fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.75 }, color: C.background1, fontSize: 13 });
    txt(s, head, { x: x + 0.62, y: y + 0.1, w: 1.6, h: 0.32, fontSize: 14, bold: true, color: C.text2, objectName: head + " heading" });
    txt(s, desc, { x: x + 0.62, y: y + 0.44, w: 1.6, h: 0.55, fontSize: 12, objectName: head + " text" });
  });
  arrow(s, 5.1, 2.47, 6.15, 3.4, "Loop arrow 1", { color: C.accent1 });
  arrow(s, 6.15, 4.55, 5.1, 5.47, "Loop arrow 2", { color: C.accent1 });
  arrow(s, 2.8, 5.47, 1.75, 4.55, "Loop arrow 3", { color: C.accent1 });
  arrow(s, 1.75, 3.4, 2.8, 2.47, "Loop arrow 4", { color: C.accent1 });
  txt(s, [{ text: "43,750", options: { fontSize: 26, bold: true, fontFace: HEAD, color: C.text2, breakLine: true } }, { text: "updates", options: { fontSize: 13, bold: true, color: C.text2, breakLine: true } },
    { text: "875 scans × 50 epochs", options: { fontSize: 11, color: C.accent6 } }], { x: 2.95, y: 3.4, w: 2.0, h: 1.2, align: "center", valign: "middle", objectName: "Update count" });
  txt(s, "One epoch = one pass over all 875 training scans.", { x: 0.6, y: 6.25, w: 6.7, h: 0.4, fontSize: 13, italic: true, color: C.accent6, objectName: "Epoch definition" });
  card(s, 7.8, 1.95, 4.93, 4.8, "Training settings card");
  await circleIcon(s, "FaGears", 8.05, 2.12, 0.55, "Training settings");
  txt(s, "Training settings", { x: 8.75, y: 2.17, w: 3.8, h: 0.45, fontSize: 17, bold: true, color: C.text2, valign: "middle", objectName: "Settings heading" });
  [["Optimiser", "Adam"], ["Learning rate", "0.0001, slowly lowered (cosine)"], ["Weight decay", "0.00001 (keeps weights small)"], ["Epochs", "50"],
    ["Batch size", "1 whole 3D scan at a time"], ["Augmentation", "none"], ["Hardware", "RTX 5050 laptop GPU"], ["Time", "42.8 hours"]].forEach(([k, v], i) => {
    const y = 2.85 + i * 0.47;
    txt(s, k, { x: 8.05, y, w: 1.6, h: 0.4, fontSize: 13, bold: true, color: C.accent6, valign: "middle", objectName: k + " setting label" });
    txt(s, v, { x: 9.7, y, w: 2.9, h: 0.4, fontSize: 13, color: i === 5 ? C.accent1 : C.text1, bold: i === 5, valign: "middle", objectName: k + " setting value" });
  });
  addNotes(s, "Training", 55,
    "Training is a loop. One, forward pass: feed in a scan and get a prediction. Two, loss: compare it with the expert's answer. Three, backpropagation: use calculus (the chain rule) to find how much each of the 1.19 million weights contributed to the error. Four, update: the Adam optimiser nudges every weight a tiny bit in the direction that reduces the error.\n\n" +
    "The size of that nudge is the learning rate, 0.0001, and a cosine schedule slowly lowers it towards zero so the model settles down at the end.\n\n" +
    "One full pass over all 875 training scans is called an epoch. We trained for 50 epochs, one whole 3D scan at a time because each scan is big. That is 43,750 updates. On a laptop RTX 5050 GPU it took about 43 hours.\n\n" +
    "One honest note: no data augmentation was used. We will come back to that.");

  // 13. Learning curves -----------------------------------------------------------
  s = contentSlide(SEC[3], "LEVEL 3 · TRAINING", "Watching it learn: training vs validation", 3);
  card(s, 0.6, 1.85, 6.0, 3.85, "Loss chart card");
  s.addChart(pres.charts.LINE, [{ name: "Training loss", labels: EP, values: TRAIN_LOSS }, { name: "Validation loss", labels: EP, values: VAL_LOSS }], {
    x: 0.75, y: 1.95, w: 5.7, h: 3.65, chartColors: [C.accent2, C.accent1], lineSize: 2, lineDataSymbol: "none",
    showTitle: true, title: "Loss (lower is better)", titleFontSize: 14, titleColor: C.text2, titleFontFace: "+mj-lt",
    showLegend: true, legendPos: "b", legendFontSize: 11, legendFontFace: "+mn-lt", legendColor: C.text1,
    catAxisLabelColor: C.accent6, valAxisLabelColor: C.accent6, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
    catAxisLabelFrequency: 5, valAxisMinVal: 0, valAxisMaxVal: 1.2, valAxisMajorUnit: 0.2, valAxisLabelFormatCode: "0.0",
    valGridLine: { color: "E4E1DA", size: 0.5 }, catGridLine: { style: "none" },
    showCatAxisTitle: true, catAxisTitle: "Epoch", catAxisTitleFontSize: 11, catAxisTitleColor: C.accent6, catAxisTitleFontFace: "+mn-lt",
    objectName: "Training and validation loss chart",
  });
  card(s, 6.73, 1.85, 6.0, 3.85, "Dice chart card");
  s.addChart(pres.charts.LINE, [{ name: "Validation Dice", labels: EP, values: VAL_DICE }], {
    x: 6.88, y: 1.95, w: 5.7, h: 3.65, chartColors: [C.accent4], lineSize: 2.25, lineDataSymbol: "none",
    showTitle: true, title: "Validation Dice (higher is better)", titleFontSize: 14, titleColor: C.text2, titleFontFace: "+mj-lt", showLegend: false,
    catAxisLabelColor: C.accent6, valAxisLabelColor: C.accent6, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
    catAxisLabelFrequency: 5, valAxisMinVal: 0.5, valAxisMaxVal: 0.85, valAxisMajorUnit: 0.05, valAxisLabelFormatCode: "0.00",
    valGridLine: { color: "E4E1DA", size: 0.5 }, catGridLine: { style: "none" },
    showCatAxisTitle: true, catAxisTitle: "Epoch", catAxisTitleFontSize: 11, catAxisTitleColor: C.accent6, catAxisTitleFontFace: "+mn-lt",
    objectName: "Validation Dice chart",
  });
  txt(s, "Training loss keeps falling; validation loss stops improving after about epoch 30. A widening gap is the start of overfitting: memorising, not learning.",
    { x: 0.6, y: 5.9, w: 6.0, h: 0.85, fontSize: 14, objectName: "Loss chart takeaway" });
  txt(s, VAL_DICE[43].toFixed(4), { x: 6.73, y: 5.85, w: 1.75, h: 0.75, fontSize: 32, bold: true, fontFace: HEAD, color: C.accent1, valign: "middle", objectName: "Best validation Dice" });
  txt(s, [{ text: "Best validation Dice, at epoch 44.", options: { bold: true, color: C.text2, breakLine: true } }, { text: "That checkpoint is saved and is the one the app uses." }],
    { x: 8.55, y: 5.9, w: 4.18, h: 0.85, fontSize: 14, objectName: "Best epoch text" });
  addNotes(s, "Watching it learn", 55,
    "How do we know it is learning? We watch two kinds of curves.\n\n" +
    "On the left is the loss: blue is training, orange is validation. Both fall fast at first. After about epoch 30, the validation loss stops improving while the training loss keeps going down. That widening gap is the start of overfitting: the model gets better at its study material without getting better at new scans.\n\n" +
    "On the right is the validation Dice score, which I will define on the next slide. Higher is better. It climbs from 0.54 to about 0.80 and then flattens.\n\n" +
    "We saved the model from the best epoch: epoch 44, with validation Dice 0.8011. That checkpoint is the one used in the app. This is why we need a validation set: to choose the model without touching the test set.");

  // 14. Dice and IoU ---------------------------------------------------------------
  pres.addSection({ title: SEC[4] });
  s = contentSlide(SEC[4], "LEVEL 4 · EVALUATION AND USE", "Measuring success: Dice and IoU", 4);
  card(s, 0.6, 1.85, 5.95, 4.9, "Dice explanation card");
  s.addShape(pres.shapes.OVAL, { x: 0.9, y: 2.05, w: 1.85, h: 1.85, fill: { color: C.accent2, transparency: 55 }, line: { color: C.accent2, width: 2 }, objectName: "Expert region" });
  s.addShape(pres.shapes.OVAL, { x: 2.1, y: 2.05, w: 1.85, h: 1.85, fill: { color: C.accent1, transparency: 55 }, line: { color: C.accent1, width: 2 }, objectName: "AI region" });
  txt(s, "Expert", { x: 1.0, y: 2.8, w: 0.95, h: 0.35, fontSize: 13, bold: true, color: C.text2, align: "center", objectName: "Expert region label" });
  txt(s, "AI", { x: 3.05, y: 2.8, w: 0.75, h: 0.35, fontSize: 13, bold: true, color: C.text2, align: "center", objectName: "AI region label" });
  txt(s, "overlap", { x: 2.08, y: 2.83, w: 0.7, h: 0.3, fontSize: 11, bold: true, color: C.background1, align: "center", objectName: "Overlap label" });
  txt(s, [{ text: "1 = perfect", options: { bold: true, color: C.text2, breakLine: true } }, { text: "0 = no overlap", options: { bold: true, color: C.text2, breakLine: true } },
    { text: "The huge background is ignored, so the 93% trap disappears." }], { x: 4.2, y: 2.15, w: 2.15, h: 1.7, fontSize: 13, objectName: "Dice range note" });
  txt(s, [{ text: "Dice", options: { bold: true, color: C.accent1 } }, { text: " = 2 × overlap ÷ (expert + AI)", options: { breakLine: true } },
    { text: "IoU", options: { bold: true, color: C.accent1 } }, { text: " = overlap ÷ area covered by either" }],
  { x: 0.9, y: 4.1, w: 5.45, h: 0.85, fontSize: 17, fontFace: HEAD, color: C.text2, paraSpaceAfter: 4, objectName: "Dice and IoU formulas" });
  chip(s, [{ text: "Toy example: ", options: { bold: true, color: C.accent1 } }, { text: "expert 100 voxels, AI 100 voxels, overlap 80", options: { breakLine: true } },
    { text: "Dice = 160 ÷ 200 = 0.80   ·   IoU = 80 ÷ 120 = 0.67", options: { bold: true, color: C.text2 } }],
  0.85, 5.1, 5.45, 1.4, "Toy example", { fill: { color: C.background2 }, line: { color: C.background2, width: 0.75 }, fontSize: 14, bold: false, align: "left", margin: [12, 12, 0, 0] });
  const pe = picture(s, "label_expert.png", 6.9, 1.9, 2.75, 2.95, "Expert label, test scan 00449");
  const pa = picture(s, "label_ai.png", 9.9, 1.9, 2.75, 2.95, "MedTwin AI label, test scan 00449");
  chip(s, "Expert", pe.x + 0.1, pe.y + pe.h - 0.45, 0.95, 0.34, "Expert image tag", { fill: { color: C.background1 }, line: { color: C.background1, width: 0.75 }, fontSize: 12 });
  chip(s, "MedTwin AI", pa.x + 0.1, pa.y + pa.h - 0.45, 1.25, 0.34, "AI image tag", { fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.75 }, color: C.background1, fontSize: 12 });
  txt(s, "Test scan 00449 · whole-tumour Dice 0.97 on this scan", { x: 6.8, y: 4.95, w: 5.93, h: 0.3, fontSize: 11, italic: true, color: C.accent6, align: "center", objectName: "Comparison caption" });
  [["0.78", "mean Dice, 188 test scans"], ["0.69", "mean IoU, 188 test scans"], ["0.98", "whole-tumour volume agreement (ICC)"]].forEach(([v, k], i) => {
    const x = 6.8 + i * 2.02;
    card(s, x, 5.38, 1.89, 1.37, k + " tile");
    txt(s, v, { x: x + 0.1, y: 5.45, w: 1.69, h: 0.62, fontSize: 30, bold: true, fontFace: HEAD, color: C.accent1, align: "center", valign: "middle", objectName: k + " value" });
    txt(s, k, { x: x + 0.1, y: 6.08, w: 1.69, h: 0.6, fontSize: 11, color: C.text1, align: "center", objectName: k + " label" });
  });
  addNotes(s, "Dice and IoU", 80,
    "Now, how good is it? Imagine the expert's outline and the AI's outline as two circles. Dice is two times the overlap, divided by the two sizes added together. IoU, intersection over union, is the overlap divided by everything covered by either one.\n\n" +
    "Toy example: the expert marks 100 voxels, the AI marks 100, and 80 overlap. Dice is 160 over 200, which is 0.80. IoU is 80 over 120, which is 0.67. Both are 1 for perfect and 0 for no overlap, and unlike accuracy they ignore the huge background.\n\n" +
    "On the 188 test scans, MedTwin got a mean Dice of 0.7822 and a mean IoU of 0.6939, averaged over the three tumour labels. For doctors, volume matters a lot: for whole-tumour volume, the agreement with the experts (ICC) was 0.98, where 1 is perfect. The images show a good case: the expert on the left and MedTwin on the right are almost the same.\n\n" +
    "[Advanced] BraTS research papers report scores on overlapping regions (whole tumour, tumour core, enhancing tumour), so our 0.78 over separate labels is not directly comparable with their numbers.");

  // 15. Sliding window -------------------------------------------------------------
  s = contentSlide(SEC[4], "LEVEL 4 · EVALUATION AND USE", "Running on a small GPU: sliding-window inference", 4);
  card(s, 0.6, 1.85, 5.6, 4.9, "Sliding window card");
  const sc = picture(s, "label_ai.png", 1.0, 2.05, 4.8, 4.0, "MedTwin AI label used as the scan behind the windows");
  const ww = sc.w / 2, wh = sc.h / 2;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    s.addShape(pres.shapes.RECTANGLE, { x: sc.x + c * ww / 2, y: sc.y + r * wh / 2, w: ww, h: wh, fill: { color: C.accent5, transparency: 100 }, line: { color: C.accent5, width: 1.25, dashType: "dash" }, objectName: `Window ${r}-${c}` });
  }
  s.addShape(pres.shapes.RECTANGLE, { x: sc.x + ww / 2, y: sc.y, w: ww, h: wh, fill: { color: C.background1, transparency: 85 }, line: { color: C.background1, width: 3 }, objectName: "Current window" });
  txt(s, "96³ cube", { x: sc.x + ww / 2 + 0.1, y: sc.y + 0.08, w: 1.2, h: 0.3, fontSize: 12, bold: true, color: C.background1, objectName: "Current window label" });
  txt(s, "Nine overlapping cubes cover this slice", { x: 0.8, y: 6.2, w: 5.2, h: 0.35, fontSize: 12, italic: true, color: C.accent6, align: "center", objectName: "Window caption" });
  const rows15 = [["FaMicrochip", C.text2, "The limit", "The app must run on an ordinary laptop GPU. It was tested on an NVIDIA MX550 with 2 GB of memory."],
    ["FaCubes", C.accent2, "Cut into cubes", "Predict 96 × 96 × 96-voxel cubes that overlap by half, one at a time."],
    ["FaObjectGroup", C.accent1, "Blend back", "Stitch the cubes together. In the overlaps, a cube's centre counts more than its edges (Gaussian weighting)."]];
  for (let i = 0; i < rows15.length; i++) {
    const [icon, col, head, desc] = rows15[i], y = 1.95 + i * 1.3;
    await circleIcon(s, icon, 6.6, y, 0.7, head, col);
    txt(s, head, { x: 7.55, y: y - 0.02, w: 5.15, h: 0.35, fontSize: 17, bold: true, color: C.text2, objectName: head + " heading" });
    txt(s, desc, { x: 7.55, y: y + 0.35, w: 5.15, h: 0.8, fontSize: 14, objectName: head + " text" });
  }
  chip(s, "Result: about 20–35 s per prepared scan on that laptop (from the project README; not a formal benchmark).", 6.6, 5.95, 6.13, 0.8, "Speed note",
    { fill: { color: C.background1 }, line: { color: C.accent6, width: 0.75 }, fontSize: 13, bold: false, italic: true, color: C.text1, align: "left", margin: [12, 12, 0, 0] });
  addNotes(s, "Sliding-window inference", 40,
    "One practical problem: the app must run on a hospital laptop. Ours was tested on an NVIDIA MX550 with only 2 GB of GPU memory.\n\n" +
    "So instead of the whole scan at once, MedTwin cuts it into cubes of 96 by 96 by 96 voxels that overlap by half, predicts each cube, and blends the results back together. In the overlaps, the centre of each cube gets more weight than its edges (Gaussian weighting), because predictions near a cube's edge have less context.\n\n" +
    "[Advanced] The test score was measured with one pass over the whole volume, but the app uses windows. A complete evaluation would also score the exact setting the app uses.");

  // 16. Data leakage ---------------------------------------------------------------
  pres.addSection({ title: SEC[5] });
  s = contentSlide(SEC[5], "LEVEL 5 · ADVANCED LESSONS", "Data leakage: when the exam has seen the answers", 5);
  card(s, 0.6, 1.85, 4.35, 4.9, "Leakage statistic card", { fill: { color: C.text2 }, line: { color: C.text2, width: 0.75 } });
  txt(s, [{ text: "28 / 188", options: { fontSize: 50, bold: true, fontFace: HEAD, color: C.accent3, breakLine: true } },
    { text: "test scans came from patients who also had a scan in training or validation", options: { fontSize: 16, color: C.background1, breakLine: true } },
    { text: " ", options: { fontSize: 10, breakLine: true } },
    { text: "= 14.9% of the test set", options: { fontSize: 18, bold: true, color: C.accent5 } }],
  { x: 0.9, y: 2.1, w: 3.85, h: 2.3, objectName: "Leakage statistic" });
  txt(s, "Tumour centres of same-patient pairs: median 8.8 mm apart. Unrelated cases: 61.4 mm.",
    { x: 0.9, y: 4.5, w: 3.85, h: 0.8, fontSize: 13, color: C.accent5, objectName: "Centroid distance note" });
  txt(s, "So the test score may be optimistic, by an amount we don't know yet.",
    { x: 0.9, y: 5.5, w: 3.85, h: 1.0, fontSize: 15, bold: true, color: C.background1, objectName: "Leakage consequence" });
  card(s, 5.25, 1.85, 7.48, 2.8, "Leakage diagram card");
  await circleIcon(s, "FaUser", 5.55, 2.55, 0.95, "One patient", C.accent6);
  txt(s, "One patient", { x: 5.3, y: 3.6, w: 1.45, h: 0.3, fontSize: 12, bold: true, color: C.text2, align: "center", objectName: "Patient label" });
  chip(s, "Scan A", 7.2, 2.1, 1.6, 0.6, "Scan A", { fill: { color: C.background2 }, line: { color: C.accent6, width: 1 } });
  chip(s, "Scan B", 7.2, 3.4, 1.6, 0.6, "Scan B", { fill: { color: C.background2 }, line: { color: C.accent6, width: 1 } });
  arrow(s, 6.5, 2.85, 7.2, 2.4, "Patient to scan A");
  arrow(s, 6.5, 3.3, 7.2, 3.7, "Patient to scan B");
  arrow(s, 8.8, 2.4, 9.6, 2.4, "Scan A to training");
  arrow(s, 8.8, 3.7, 9.6, 3.7, "Scan B to test");
  chip(s, "Training set (study)", 9.6, 2.1, 2.9, 0.6, "Training set box", { fill: { color: C.text2 }, line: { color: C.text2, width: 0.75 }, color: C.background1 });
  chip(s, "Test set (final exam)", 9.6, 3.4, 2.9, 0.6, "Test set box", { fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.75 }, color: C.background1 });
  txt(s, "The split was made per scan, not per patient, so the same tumour can sit on both sides.", { x: 5.5, y: 4.1, w: 7.0, h: 0.4, fontSize: 13, italic: true, color: C.accent1, objectName: "Leakage cause" });
  card(s, 5.25, 4.9, 7.48, 1.85, "Leakage fix card");
  await circleIcon(s, "FaCheck", 5.5, 5.15, 0.65, "The fix", C.accent4);
  txt(s, [{ text: "The fix", options: { bold: true, fontSize: 17, color: C.text2, breakLine: true } },
    { text: "Split by patient: all scans of one person go into the same set. Then re-test on the 160 clean test scans. A score only counts if the test set is truly unseen." }],
  { x: 6.4, y: 5.05, w: 6.15, h: 1.6, fontSize: 14, objectName: "Leakage fix text" });
  addNotes(s, "Data leakage", 55,
    "Now the advanced lessons: the things that matter in real research. First, data leakage.\n\n" +
    "Our split was done per scan, not per patient, and some patients have two scans. When we checked afterwards, 28 of the 188 test scans (about 15%) came from patients who also had a scan in training or validation. Same patient, same tumour: the tumour centres of these pairs were a median of 8.8 mm apart, against 61.4 mm for unrelated cases.\n\n" +
    "So for those 28 scans, the exam had partly seen the answers, and the test score may be optimistic. We do not know by how much yet.\n\n" +
    "The fix is simple: split by patient, so all scans of one person stay in one set, and report results on the 160 clean test scans. The lesson: a high score means nothing if the test set is not truly unseen.");

  // 17. Failures and confidence ---------------------------------------------------
  s = contentSlide(SEC[5], "LEVEL 5 · ADVANCED LESSONS", "Where it fails, and why confidence can lie", 5);
  card(s, 0.6, 1.85, 6.1, 4.9, "Volume agreement card");
  s.addChart(pres.charts.BAR, [{ name: "ICC", labels: ["Whole tumour", "Enhancing tumour", "Oedema", "Tumour core", "Necrotic core"], values: [0.98, 0.977, 0.912, 0.804, 0.522] }], {
    x: 0.75, y: 1.95, w: 5.8, h: 3.45, barDir: "bar", catAxisOrientation: "maxMin", barGapWidthPct: 45,
    chartColors: [HX.accent6, HX.accent6, HX.accent6, HX.accent6, HX.accent1],
    showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.00", dataLabelColor: C.text1, dataLabelFontSize: 12, dataLabelFontFace: "+mn-lt",
    showTitle: true, title: "Volume agreement with experts (ICC, 188 test scans)", titleFontSize: 13, titleColor: C.text2, titleFontFace: "+mj-lt",
    catAxisLabelColor: C.text1, catAxisLabelFontSize: 12, catAxisLabelFontFace: "+mn-lt",
    valAxisHidden: true, valAxisMinVal: 0, valAxisMaxVal: 1.15, valGridLine: { style: "none" }, catGridLine: { style: "none" }, showLegend: false,
    objectName: "Volume agreement by region chart",
  });
  txt(s, [{ text: "ICC: 1 = perfect agreement. ", options: { bold: true, color: C.text2 } }, { text: "The weak spot is the necrotic core. 10 test scans with large cores (> 50 cm³) were under-segmented: the model found a median of only 31% of the core." }],
    { x: 0.85, y: 5.5, w: 5.65, h: 1.15, fontSize: 13, objectName: "Volume agreement takeaway" });
  const fe = picture(s, "failure_expert.png", 7.05, 1.9, 2.7, 3.3, "Expert label, test scan 00012");
  const fai = picture(s, "failure_ai.png", 10.0, 1.9, 2.7, 3.3, "MedTwin AI label, test scan 00012");
  chip(s, "Expert", fe.x + 0.1, fe.y + 0.1, 0.95, 0.34, "Failure expert tag", { fill: { color: C.background1 }, line: { color: C.background1, width: 0.75 }, fontSize: 12 });
  chip(s, "MedTwin AI", fai.x + fai.w - 1.35, fai.y + 0.1, 1.25, 0.34, "Failure AI tag", { fill: { color: C.accent1 }, line: { color: C.accent1, width: 0.75 }, color: C.background1, fontSize: 12 });
  txt(s, "Test scan 00012: the expert's necrotic core is 172 cm³ (blue). MedTwin found 6 cm³ and called the rest oedema (yellow). Tumour-core Dice 0.07.",
    { x: 7.0, y: 5.3, w: 5.73, h: 0.6, fontSize: 12, italic: true, color: C.text1, objectName: "Failure caption" });
  card(s, 7.0, 6.0, 5.73, 0.75, "Calibration warning card", { line: { color: C.accent1, width: 1.5 } });
  await circleIcon(s, "FaTriangleExclamation", 7.12, 6.1, 0.55, "Calibration warning", C.accent1);
  txt(s, [{ text: "Confidence ≠ correct. ", options: { bold: true, color: C.accent1 } }, { text: "The softmax confidence is not calibrated, so a doctor reviews every result." }],
    { x: 7.8, y: 6.03, w: 4.85, h: 0.69, fontSize: 13, valign: "middle", objectName: "Calibration warning text" });
  addNotes(s, "Where it fails", 65,
    "Second lesson: always look at where the model fails, not only at the average.\n\n" +
    "This chart shows the volume agreement with the experts for each tumour part. Whole tumour and enhancing tumour are excellent, about 0.98. But the necrotic core is only 0.52. Why?\n\n" +
    "Look at this test scan on the right. The expert marked a huge necrotic core, 172 cubic centimetres, in blue. MedTwin found only 6 and called most of it oedema, in yellow. Its whole-tumour outline is still very good (Dice 0.97), but the tumour-core Dice is 0.07. In fact, 10 test scans with large necrotic cores were under-segmented like this: the model found a median of only 31% of the core.\n\n" +
    "Third lesson: the confidence number from softmax is not calibrated. A model can be confident and still wrong; in this scan the uncertainty stayed low over most of the missed core. That is why in MedTwin a doctor reviews, edits and approves every result.\n\n" +
    "[Ask the room] Why might the model be bad at very large necrotic cores? (Only about 1 in 20 test scans has one, so the model probably saw few such examples in training.)");

  // 18. Improvements ---------------------------------------------------------------
  s = contentSlide(SEC[5], "LEVEL 5 · ADVANCED LESSONS", "How to make it better: ideas for your projects", 5);
  const ideas = [["FaShuffle", C.accent2, "Data augmentation", "Randomly flip, rotate and change the brightness of training scans so the model sees more variety. MedTwin used none."],
    ["FaUsers", C.accent1, "Better splits", "Split by patient and use cross-validation: train and test on several splits, then report the average and the spread."],
    ["FaGears", C.text2, "Strong baseline: nnU-Net", "A self-configuring U-Net that is a standard benchmark in medical image segmentation. Always compare with it."],
    ["FaNetworkWired", C.accent4, "Transformers", "Models such as Swin UNETR use attention to relate distant parts of the scan; CNN filters look locally."],
    ["FaClone", C.accent2, "TTA and ensembles", "Average several predictions (flipped inputs, or several models). Usually more accurate, with better uncertainty."],
    ["FaScaleBalanced", C.accent1, "Calibration", "Make \"70% confident\" mean right 70% of the time, for example with temperature scaling."]];
  for (let i = 0; i < ideas.length; i++) {
    const [icon, col, head, desc] = ideas[i], x = 0.6 + (i % 3) * 4.115, y = 1.9 + Math.floor(i / 3) * 2.25;
    card(s, x, y, 3.9, 2.08, head + " card");
    await circleIcon(s, icon, x + 0.25, y + 0.25, 0.62, head, col);
    txt(s, head, { x: x + 1.05, y: y + 0.25, w: 2.7, h: 0.62, fontSize: 16, bold: true, color: C.text2, valign: "middle", objectName: head + " heading" });
    txt(s, desc, { x: x + 0.25, y: y + 1.0, w: 3.45, h: 1.0, fontSize: 13, objectName: head + " text" });
  }
  txt(s, "Each idea is a good mini-project for a 1st or 2nd year student.", { x: 0.6, y: 6.42, w: 12.13, h: 0.38, fontSize: 15, italic: true, bold: true, color: C.accent1, align: "center", objectName: "Ideas tagline" });
  addNotes(s, "How to make it better", 55,
    "How could we do better? These are great project ideas for you.\n\n" +
    "One, data augmentation: randomly flip, rotate and change the brightness of training scans, so the model sees more variety. MedTwin used none.\n" +
    "Two, better splits: split by patient and use cross-validation, which means training and testing several times on different splits and reporting the average and the spread.\n" +
    "Three, compare with nnU-Net, a self-configuring U-Net that is a standard strong baseline in medical segmentation.\n" +
    "Four, try Transformers such as Swin UNETR. Attention lets the model relate distant parts of the scan, while a CNN filter only looks locally.\n" +
    "Five, test-time augmentation and ensembles: average several predictions. This usually improves accuracy and gives better uncertainty.\n" +
    "Six, calibration: make sure that \"70% confident\" really means right 70% of the time, for example with temperature scaling.");

  // 19. Takeaways -----------------------------------------------------------------
  pres.addSection({ title: SEC[6] });
  s = pres.addSlide({ masterName: "DARK", sectionTitle: SEC[6] });
  s.addText("WRAP-UP", { placeholder: "kicker" });
  s.addText("Five things\nto remember", { placeholder: "title" });
  s.addText("Thank you! Questions?", { placeholder: "body" });
  txt(s, "Built with Python, PyTorch and MONAI · data: BraTS 2023 adult glioma", { x: 0.8, y: 6.2, w: 5.8, h: 0.4, fontSize: 12, color: C.background1, objectName: "Tools line" });
  card(s, 6.9, 0.85, 5.83, 5.8, "Takeaways panel", { fill: { color: C.background1, transparency: 92 }, line: { color: C.accent5, width: 0.75 }, shadow: undefined });
  ["ML learns rules from labelled examples; segmentation gives every voxel a label.",
    "A 3D U-Net encodes what, decodes where, and skip connections keep the detail.",
    "With imbalanced data, choose the right loss (DiceCE) and metric (Dice, not accuracy).",
    "Validation chooses the model; the test set must stay truly unseen: split by patient.",
    "Study the failures, don't trust confidence blindly, and keep a doctor in the loop."].forEach((t, i) => {
    const y = 1.1 + i * 1.07;
    chip(s, String(i + 1), 7.2, y + 0.12, 0.5, 0.5, `Takeaway ${i + 1} number`, { fill: { color: C.accent3 }, line: { color: C.accent3, width: 0.75 }, color: C.text2, fontSize: 16 });
    txt(s, t, { x: 7.95, y, w: 4.6, h: 0.9, fontSize: 15, color: C.background1, valign: "middle", objectName: `Takeaway ${i + 1}` });
  });
  addNotes(s, "Five things to remember", 40,
    "To wrap up, five things to remember. [Read the five points briefly.]\n\n" +
    "If you remember only one thing: a good ML project is not just a high score. It is honest data splits, the right metric, looking at the failures, and keeping a human in the loop.\n\n" +
    "Thank you. Questions?");

  await pres.writeFile({ fileName: OUT });
  const applyThemePath = process.env.PPTX_APPLY_THEME;
  if (applyThemePath) {
    const { applyTheme } = require(applyThemePath);
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
    "# MedTwin ML talk: speaker script",
    "",
    "This is what to say with `MedTwin_ML_Explained.pptx` (the same text is in each slide's speaker notes). The audience is 1st and 2nd year students; no ML background is assumed. Speak it in your own words; the times are a guide.",
    "",
    `Talk length: about ${Math.round(total / 60)} minutes, plus 3 minutes for questions.`,
    "",
    "## Before you present",
    "",
    "- Put your name and the date on slide 1 (the \"[Your name] · [Date]\" line).",
    "- Lines marked **[Ask the room]** are short questions to keep juniors involved. Skip them if you are short of time.",
    "- Lines marked **[Advanced]** are optional extras for curious students or for questions.",
    "- If you run long, shorten slides 6, 10 and 15. Don't skip slides 16 and 17: they are the most important lessons.",
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
  SCRIPT.forEach((x, i) => {
    parts.push(`### ${i + 1}. ${x.title} (${mmss(x.secs)})`, "", x.notes.replace(/\[(Ask the room|Advanced)\]/g, "**[$1]**"), "");
  });
  parts.push(
    "## Likely questions and short answers",
    "",
    "| Question | Answer |",
    "| --- | --- |",
    "| Why 3D and not 2D slices? | A tumour continues across slices; a 3D filter sees the slices above and below. 2D models are cheaper and are a fair alternative to try. |",
    "| Why not just use accuracy? | About 93% of the voxels are background, so a model that predicts \"no tumour\" everywhere looks 93% accurate. Dice only looks at the tumour. |",
    "| What is a GPU and why do we need one? | A processor with thousands of small cores that do many multiply-and-add operations at once, which is exactly what convolution needs. |",
    "| How long does one prediction take? | About 20–35 seconds per prepared scan on the 2 GB laptop GPU (from the project README; not a formal benchmark). |",
    "| Why is the score only 0.78? | Small network (1.19 M parameters), no data augmentation, one split, and the metric averages the three separate labels, which is stricter than the BraTS region scores. |",
    "| Can it replace a radiologist? | No. It is a research prototype, not approved for clinical use, and it makes mistakes (slide 17). A doctor reviews, edits and approves every result. |",
    "| Where does the data come from? | The BraTS 2023 adult glioma challenge: public, expert-labelled research data. |",
    "| What tools did you use? | Python, PyTorch and MONAI (a PyTorch library for medical imaging); the app uses FastAPI and Three.js for the 3D view. |",
    "| What is an epoch? A batch? | One epoch is one pass over all training scans. A batch is how many scans are processed before each weight update; here it is 1. |",
    "",
    "## Glossary (for students who ask afterwards)",
    "",
    "- **Voxel:** a 3D pixel; here a 1 mm cube.",
    "- **Channel:** one input image layer; MedTwin has 4 (T1, T1c, T2, FLAIR).",
    "- **Supervised learning:** learning from examples that come with the correct answers (labels).",
    "- **Convolution / filter:** a small grid of learned numbers slid over the image to detect patterns.",
    "- **U-Net:** an encoder–decoder network with skip connections, built for segmentation.",
    "- **Softmax / argmax:** turn scores into probabilities / pick the class with the highest probability.",
    "- **Loss:** one number saying how wrong the prediction is; training makes it smaller.",
    "- **Learning rate:** how big each weight update is.",
    "- **Overfitting:** doing better on training data while not improving (or getting worse) on new data.",
    "- **Dice / IoU:** overlap scores between the prediction and the expert label (1 = perfect).",
    "- **ICC:** intraclass correlation; how well two sets of measurements (here, volumes) agree (1 = perfect).",
    "- **Data leakage:** information from the test set reaching training, which makes scores look better than they are.",
    "- **Calibration:** whether a model's confidence matches how often it is actually right.",
    "",
    "## Where the numbers come from",
    "",
    "Every number in the deck comes from the project, read without changing anything: the training notebook (via `research_paper/01_project_review.md` and `research_paper/analysis/results/training_history.csv`), the post-hoc analyses in `research_paper/analysis/results/` (data split audit, volume agreement, error analysis) and `research_paper/manuscript/figures/Fig4_case_statistics.json`. The 93% / 0.5% figures are for test scan 00449 (`assets/label_share.json`). The softmax numbers and the Dice toy example are made-up teaching examples and are labelled as such on the slides.",
    "",
    "To rebuild the deck: run `presentation/source/make_assets.py` with the app's Python, then `node presentation/source/build_deck.js` (needs pptxgenjs, react, react-dom, react-icons and sharp).",
    "",
  );
  fs.writeFileSync(SCRIPT_MD, parts.join("\n"), "utf8");
}

build().catch((e) => { console.error(e); process.exit(1); });
