import { BrainViewer } from './viewer3d.js';
import { SliceViewer } from './slices.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '–' : Number(v).toFixed(d));
const signed = (v, d = 0) => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : ''}${Number(v).toFixed(d)}%`);

const SEQUENCES = [['t1', 'T1'], ['t1c', 'T1 contrast'], ['t2', 'T2'], ['flair', 'FLAIR']];
const PATTERNS = [
  ['seg', /(^|[-_.])(seg|label|mask|gt)([-_.]|$)/],
  ['t1c', /(t1c|t1ce|t1gd|t1_?post|t1[-_]?contrast|gad)/],
  ['flair', /(t2f|flair)/],
  ['t2', /(t2w|t2)/],
  ['t1', /(t1n|t1w|t1)/],
];
// Follow-up chart: validated steps of the enhancing (crimson) and edema (yellow) hues for the dark panel.
const CHART_SERIES = [
  { key: 'enhancing_tumor', name: 'Enhancing tumour', color: '#f05266', dash: '', marker: 'circle' },
  { key: 'edema', name: 'Edema', color: '#b98d0c', dash: '5 4', marker: 'square' },
];
const VIEW_HINTS = {
  front: "Front view: patient's left is on your right",
  back: "Back view: patient's left is on your left",
  left: "Looking at the patient's left side: front of the brain on your left",
  right: "Looking at the patient's right side: front of the brain on your right",
  top: "Top view, front at the top: patient's left is on your left",
};

const state = { files: {}, archive: null, study: null, jobId: null, pollTimer: null, results: null, health: null, user: null, started: false };

const viewer = new BrainViewer($('#viewer'), {
  onHover: showTooltip,
  onPick: (info) => info.location && slices.goTo(info.location.centroid_voxel),
});
const slices = new SliceViewer($('#slicesPanel'), {
  onStrokesChanged: (n) => {
    $('#editStatus').textContent = n ? `${n} unsaved stroke${n === 1 ? '' : 's'}` : 'Paint on any slice, then save';
    $('#saveEdits').disabled = !n;
    $('#undoStroke').disabled = !n;
    $('#discardEdits').disabled = !n;
  },
});

// ------------------------------------------------------------------ API
async function api(path, options = {}) {
  // The X-MedTwin header is required by the server on every change (protects against forged requests).
  const res = await fetch(path, { ...options, headers: { 'X-MedTwin': '1', ...(options.headers || {}) } });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).detail || msg; } catch { /* not JSON */ }
    if (res.status === 401 && !path.startsWith('/api/auth/')) showAuth('login');
    if (res.status === 403 && /Change your password/.test(msg)) showAuth('password', true);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
const postJson = (path, body, method = 'POST') => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const can = (perm) => !!state.user && state.user.permissions.includes(perm);

function showError(el, err) {
  el.textContent = err ? err.message || String(err) : '';
  el.classList.toggle('hidden', !err);
}

// ------------------------------------------------------------------ new analysis: shared fields
function patientDetails(data) {
  const fields = { patient_code: '#patientCode', scan_date: '#scanDate', age: '#age', sex: '#sex', label: '#caseLabel' };
  for (const [name, sel] of Object.entries(fields)) {
    const v = $(sel).value.trim();
    if (v !== '') data.append(name, v);
  }
}

for (const tab of $$('.tab')) {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('.tab-body').forEach((b) => b.classList.toggle('hidden', b.dataset.body !== tab.dataset.tab));
    showError($('#formError'), null);
  });
}

async function submitJob(data, button) {
  showError($('#formError'), null);
  button.disabled = true;
  const text = button.textContent;
  button.textContent = 'Uploading…';
  try {
    const job = await api('/api/jobs', { method: 'POST', body: data });
    trackJob(job.id);
    loadHistory();
    return true;
  } catch (err) {
    showError($('#formError'), err);
    return false;
  } finally {
    button.textContent = text;
    button.disabled = false;
    if (button.id === 'uploadBtn') renderSlots();
  }
}

// ---- DICOM
async function uploadStudy(file) {
  if (!file) return;
  showError($('#formError'), null);
  $('#seriesList').innerHTML = '';
  $('#dicomBtn').classList.add('hidden');
  $('#dicomBusy').classList.remove('hidden');
  $('#dicomBusy').textContent = `Reading ${file.name} (${(file.size / 1e6).toFixed(0)} MB)…`;
  const data = new FormData();
  data.append('archive', file);
  try {
    state.study = await api('/api/studies', { method: 'POST', body: data });
    if (state.study.study_date && !$('#scanDate').value) $('#scanDate').value = state.study.study_date;
    renderSeries();
  } catch (err) {
    showError($('#formError'), err);
  } finally {
    $('#dicomBusy').classList.add('hidden');
  }
}

function renderSeries() {
  const s = state.study;
  const opts = (sel) => ['<option value="">— not used —</option>', ...SEQUENCES.map(([k, l]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${l}</option>`)].join('');
  $('#seriesList').innerHTML = `<p class="small muted">${s.series.length} series found. Check the suggested sequence for each.</p><div class="series">`
    + s.series.map((x) => `<div class="series-row ${x.suggested_role ? 'assigned' : ''}" data-index="${x.index}">
        <img src="${x.thumbnail}" alt="">
        <div class="desc"><b title="${esc(x.description)}">${esc(x.description)}</b>
          <span>${x.slices} slices · ${x.spacing_mm.map((v) => fmt(v, 1)).join('×')} mm${x.contrast ? ' · contrast' : ''}</span></div>
        <select data-series="${x.index}">${opts(x.suggested_role)}</select></div>`).join('') + '</div>';
  $('#seriesList').querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => {
    if (sel.value) $('#seriesList').querySelectorAll('select').forEach((o) => { if (o !== sel && o.value === sel.value) o.value = ''; });
    $('#seriesList').querySelectorAll('.series-row').forEach((row) => row.classList.toggle('assigned', !!row.querySelector('select').value));
    updateDicomButton();
  }));
  $('#dicomBtn').classList.remove('hidden');
  updateDicomButton();
}

function dicomRoles() {
  const roles = {};
  $('#seriesList').querySelectorAll('select').forEach((sel) => { if (sel.value) roles[sel.value] = sel.dataset.series; });
  return roles;
}

function updateDicomButton() {
  const roles = dicomRoles();
  const missing = SEQUENCES.filter(([k]) => !roles[k]).map(([, l]) => l);
  $('#dicomBtn').disabled = missing.length > 0;
  $('#dicomBtn').textContent = missing.length ? `Choose: ${missing.join(', ')}` : 'Analyse study';
}

const dicomDrop = $('#dicomDrop');
$('#dicomFile').addEventListener('change', (e) => uploadStudy(e.target.files[0]));
dicomDrop.addEventListener('dragover', (e) => { e.preventDefault(); dicomDrop.classList.add('over'); });
dicomDrop.addEventListener('dragleave', () => dicomDrop.classList.remove('over'));
dicomDrop.addEventListener('drop', (e) => { e.preventDefault(); dicomDrop.classList.remove('over'); uploadStudy(e.dataTransfer.files[0]); });

$('#dicomForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.study) return;
  const data = new FormData();
  data.append('study_id', state.study.study_id);
  data.append('roles', JSON.stringify(dicomRoles()));
  patientDetails(data);
  if (await submitJob(data, $('#dicomBtn'))) {
    state.study = null;
    $('#seriesList').innerHTML = '';
    $('#dicomBtn').classList.add('hidden');
  }
});

// ---- NIfTI
function classify(name) {
  const n = name.toLowerCase().replace(/\.nii(\.gz)?$/, '');
  for (const [key, re] of PATTERNS) if (re.test(n)) return key;
  return null;
}

function addFiles(fileList) {
  for (const file of fileList) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.zip')) { state.archive = file; state.files = {}; continue; }
    if (!/\.nii(\.gz)?$/.test(lower)) continue;
    const key = classify(file.name);
    if (key && key !== 'seg') { state.files[key] = file; state.archive = null; }
  }
  renderSlots();
}

function renderSlots() {
  const slots = $('#slots');
  if (state.archive) {
    slots.innerHTML = `<div class="slot ok"><b>Zip</b><span class="fname">${esc(state.archive.name)}</span><button type="button" class="pick" data-clear>Clear</button></div>`;
  } else {
    slots.innerHTML = SEQUENCES.map(([key, label]) => {
      const f = state.files[key];
      return `<div class="slot ${f ? 'ok' : ''}"><b>${label}</b><span class="fname">${f ? esc(f.name) : 'not selected'}</span>`
        + `<button type="button" class="pick" data-pick="${key}">Choose</button></div>`;
    }).join('');
  }
  $('#uploadBtn').disabled = !(state.archive || SEQUENCES.every(([k]) => state.files[k]));
}

$('#slots').addEventListener('click', (e) => {
  const key = e.target.dataset.pick;
  if (e.target.hasAttribute('data-clear')) { state.archive = null; renderSlots(); return; }
  if (!key) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.nii,.gz';
  input.onchange = () => { if (input.files[0]) { state.files[key] = input.files[0]; state.archive = null; renderSlots(); } };
  input.click();
});

const dz = $('#dropzone');
$('#multiFile').addEventListener('change', (e) => addFiles(e.target.files));
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer.files); });

$('#uploadForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData();
  if (state.archive) data.append('archive', state.archive);
  else for (const [key] of SEQUENCES) data.append(key, state.files[key]);
  patientDetails(data);
  submitJob(data, $('#uploadBtn'));
});

$('#demoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData();
  data.append('demo_case', $('#demoSelect').value);
  patientDetails(data);
  submitJob(data, $('#demoBtn'));
});

// ------------------------------------------------------------------ jobs
function renderSteps(job) {
  $('#progressCard').classList.remove('hidden');
  $('#progressCase').textContent = job.case_label || '';
  $('#steps').innerHTML = job.steps.map((s) => `<li class="${s.state}">${esc(s.label)}</li>`).join('');
  showError($('#jobError'), job.error ? new Error(job.error) : null);
}

function trackJob(id) {
  clearTimeout(state.pollTimer);
  state.jobId = id;
  const poll = async () => {
    let job;
    try { job = await api(`/api/jobs/${id}`); } catch (err) { showError($('#jobError'), err); return; }
    if (state.jobId !== id) return;
    renderSteps(job);
    if (job.status === 'done') { showResults(job.id, job.results); loadHistory(); }
    else if (job.status === 'failed') loadHistory();
    else state.pollTimer = setTimeout(poll, 700);
  };
  poll();
}

async function showResults(jobId, r, { keepView = false } = {}) {
  const first = !keepView;
  state.results = r;
  state.jobId = jobId;
  history.replaceState(null, '', `#job=${jobId}`);
  const base = `/api/jobs/${jobId}`;
  $('#viewerEmpty').classList.add('hidden');
  $('#toolbar').classList.remove('hidden');
  $('#toolbar2').classList.remove('hidden');
  $('#axesHint').classList.remove('hidden');
  $('#gtToggleWrap').classList.toggle('hidden', !r.has_ground_truth);
  $('#sourceGroup').classList.toggle('hidden', !r.brain.template);
  $$('.gt-only').forEach((o) => { o.disabled = !r.has_ground_truth; });
  if (!r.has_ground_truth && $('#sliceOverlay').value === 'ground_truth') $('#sliceOverlay').value = 'prediction';
  renderFindings(jobId, r);
  renderReview(r);
  loadAudit();
  loadTimeline(r);
  highlightHistory();

  if (first) {
    $('#gtToggle').checked = false;
    $('#brainSource').value = r.brain.template ? 'template' : 'patient';
    $('#axesHint').textContent = VIEW_HINTS.front;
    const channels = r.slice_channels;
    $('#sliceChannel').innerHTML = channels.map((c) => `<option value="${c}">${{ t1: 'T1', t1c: 'T1 contrast', t2: 'T2', flair: 'FLAIR' }[c] || c}</option>`).join('');
    $('#sliceChannel').value = channels.includes('flair') ? 'flair' : channels[0];
    slices.channel = $('#sliceChannel').value;
    slices.overlay = $('#sliceOverlay').value;
    $('#slicesPanel').classList.remove('hidden');
    setEditing(false);
    const main = r.diseases.find((d) => d.detected);
    slices.open(base, r.volume_shape, main ? main.location.centroid_voxel : null, r.voxel_mm[0], r.updated_at);
  } else {
    slices.setRevision(r.updated_at);
  }

  try {
    await viewer.load(base, r, { keepCamera: !first });
    viewer.setBrainSource($('#brainSource').value);
    viewer.setBrainOpacity(Number($('#brainOpacity').value) / 100);
    viewer.setClip($('#clipAxis').value, Number($('#clipPos').value) / 100);
    viewer.setGroundTruthVisible($('#gtToggle').checked);
  } catch (err) {
    showError($('#jobError'), new Error(`3D view failed to load: ${err.message}`));
  }
}

// ------------------------------------------------------------------ findings
function renderFindings(jobId, r) {
  const base = `/api/jobs/${jobId}`;
  const total = r.diseases.reduce((s, d) => s + d.total_volume_cm3, 0);
  const lesionCount = r.diseases.reduce((s, d) => s + d.lesions.length, 0);
  const edited = r.review && r.review.edited;
  let html = r.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('');
  html += `<div class="summary">
    <div class="stat"><div class="v">${fmt(total, 1)}</div><div class="k">cm³ abnormal tissue</div></div>
    <div class="stat"><div class="v">${fmt(100 * total / r.brain.volume_cm3, 1)}%</div><div class="k">of brain volume</div></div>
    <div class="stat"><div class="v">${fmt(r.brain.volume_cm3, 0)}</div><div class="k">cm³ brain volume</div></div>
    <div class="stat"><div class="v">${lesionCount}</div><div class="k">separate lesion${lesionCount === 1 ? '' : 's'}</div></div>
  </div>`;

  for (const d of r.diseases) {
    html += `<div class="disease"><h3><span>${esc(d.name)}</span><span class="muted small">${d.detected ? 'detected' : 'not detected by this model'}</span></h3>`;
    html += `<div class="loc">${d.detected ? `Centre in the ${esc(d.location.description)}` : 'No lesion found by this model. This does not rule out other disease.'}</div>`;
    for (const reg of d.regions) {
      const id = `${d.key}:${reg.key}`;
      const ai = edited && reg.ai_volume_cm3 !== undefined && Math.abs(reg.ai_volume_cm3 - reg.volume_cm3) > 0.001
        ? ` · AI ${fmt(reg.ai_volume_cm3, 2)}` : '';
      html += `<div class="region" data-goto='${reg.location ? JSON.stringify(reg.location.centroid_voxel) : ''}'>
        <input type="checkbox" data-region="${id}" ${reg.mesh ? 'checked' : 'disabled'} title="Show in 3D">
        <span class="name"><span class="sw" style="background:${reg.color}"></span>${esc(reg.name)}</span>
        <span class="vol">${fmt(reg.volume_cm3, 2)} cm³<small>${fmt(reg.percent_of_brain, 2)}% of brain${ai}</small></span>
        ${reg.location ? `<span class="where">${esc(reg.location.description)}${reg.confidence_pct != null ? ` · model confidence ${fmt(reg.confidence_pct, 0)}%` : ''}</span>` : ''}
      </div>`;
    }
    if (d.rano) {
      const t = d.rano;
      html += `<div class="sub">Diameters (RANO method, enhancing)</div>`;
      html += t.measurable_disease
        ? `<p class="small">SPD of ${t.target_count} target lesion${t.target_count === 1 ? '' : 's'}: <b>${fmt(t.sum_of_products_mm2, 0)} mm²</b></p>`
        : '<p class="small muted">No measurable enhancing lesion (both diameters ≥ 10 mm).</p>';
      if (t.lesions.length) {
        html += `<table class="tbl"><tr><th>#</th><th class="n">Longest mm</th><th class="n">Perp. mm</th><th class="n">mm²</th><th>Target</th></tr>`;
        for (const l of t.lesions.slice(0, 5)) {
          html += `<tr class="click" data-axial="${l.axial_slice}"><td>${l.index}</td><td class="n">${fmt(l.longest_mm, 1)}</td><td class="n">${fmt(l.perpendicular_mm, 1)}</td>`
            + `<td class="n">${fmt(l.product_mm2, 0)}</td><td>${l.target ? 'yes' : l.measurable ? 'no' : 'too small'}</td></tr>`;
        }
        html += '</table>';
      }
    }
    if (d.lesions.length) {
      html += `<div class="sub">Separate lesions</div><table class="tbl"><tr><th>#</th><th class="n">cm³</th><th class="n">Size mm</th><th>Location</th></tr>`;
      for (const l of d.lesions) {
        html += `<tr class="click" data-goto='${JSON.stringify(l.centroid_voxel)}'><td>${l.index}</td><td class="n">${fmt(l.volume_cm3, 2)}</td>`
          + `<td class="n">${l.extent_mm.map((v) => fmt(v, 0)).join('×')}</td><td>${esc(l.description)}</td></tr>`;
      }
      html += '</table>';
    }
    if (d.ground_truth) {
      html += `<div class="sub">Result vs expert labels</div><table class="tbl"><tr><th>Region</th><th class="n">Result</th><th class="n">Expert</th><th class="n">Dice</th></tr>`;
      for (const reg of d.regions) {
        const g = reg.ground_truth;
        html += `<tr><td>${esc(reg.name)}</td><td class="n">${fmt(reg.volume_cm3, 1)}</td><td class="n">${fmt(g.volume_cm3, 1)}</td><td class="n">${fmt(g.dice, 2)}</td></tr>`;
      }
      html += `<tr><td><b>Whole lesion</b></td><td class="n">${fmt(d.total_volume_cm3, 1)}</td><td class="n">${fmt(d.ground_truth.volume_cm3, 1)}</td><td class="n"><b>${fmt(d.ground_truth.whole_lesion_dice, 2)}</b></td></tr></table>`;
    }
    html += '</div>';
  }

  const meshes = r.brain.template ? [['brain_template', 'Realistic brain'], ['brain', 'Exact brain']] : [['brain', 'Brain']];
  for (const d of r.diseases) for (const reg of d.regions) if (reg.mesh) meshes.push([reg.mesh.replace('.glb', ''), reg.name]);
  html += `<div class="sub">Downloads</div><div class="links"><a class="primary" href="${base}/report" target="_blank" rel="noopener">Open report (PDF)</a>`;
  html += meshes.map(([name, label]) => `<a href="${base}/download/${name}.stl" title="STL in millimetres">${esc(label)} STL</a>`).join('');
  html += '</div>';
  const prep = (r.input_info || {}).preparation || {};
  const prepText = prep.already_aligned === undefined ? '' : `${prep.already_aligned ? 'Sequences were already aligned' : 'Sequences aligned automatically'}; ${prep.already_skull_stripped ? 'already skull-stripped' : 'skull removed with HD-BET'}. `;
  html += `<p class="note">${esc(prepText)}3D brain ${esc(r.brain.surface_source_label)}. Analysed on ${esc(r.model.device)}. ${esc(r.disclaimer)}</p>`;
  if (can('delete')) html += `<p class="note"><button type="button" id="deleteCurrent">Delete this case's data</button></p>`;
  $('#findings').innerHTML = html;

  $('#findings').querySelectorAll('[data-region]').forEach((cb) => {
    cb.addEventListener('change', () => viewer.setRegionVisible(cb.dataset.region, cb.checked));
    cb.addEventListener('click', (e) => e.stopPropagation());
  });
  $('#findings').querySelectorAll('[data-goto]').forEach((el) => {
    if (!el.dataset.goto) return;
    el.addEventListener('click', () => slices.goTo(JSON.parse(el.dataset.goto)));
  });
  $('#findings').querySelectorAll('[data-axial]').forEach((el) => {
    el.addEventListener('click', () => { const c = [...slices.cursor]; c[2] = Number(el.dataset.axial); slices.goTo(c); });
  });
  $('#deleteCurrent')?.addEventListener('click', () => deleteJob(jobId));
}

function showTooltip(info, x, y) {
  const tip = $('#tooltip');
  if (!info) { tip.classList.add('hidden'); return; }
  tip.innerHTML = `<b>${esc(info.disease)} · ${esc(info.name)}</b>${fmt(info.volume_cm3, 2)} cm³ · ${fmt(info.percent_of_brain, 2)}% of brain`
    + `${info.location ? `<br><span class="muted">${esc(info.location.description)} · click to show slices</span>` : ''}`;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
  tip.classList.remove('hidden');
}

// ------------------------------------------------------------------ correction tools
function buildPaintButtons() {
  const regions = (state.health?.diseases || []).flatMap((d) => d.regions);
  $('#labelButtons').innerHTML = regions.map((r) => `<button type="button" class="paint" data-paint="${r.label}" data-color="${r.color}"><span class="sw" style="background:${r.color}"></span>${esc(r.name)}</button>`).join(' ');
  $$('[data-paint]').forEach((b) => b.addEventListener('click', () => selectPaint(b)));
  const first = $('[data-paint]');
  if (first) selectPaint(first);
}

function selectPaint(btn) {
  $$('[data-paint]').forEach((b) => b.classList.toggle('on', b === btn));
  slices.setPaint(Number(btn.dataset.paint), btn.dataset.color || '#ffffff');
}

function setEditing(on) {
  slices.setEditing(on);
  $('#editBar').classList.toggle('hidden', !on);
  $('#editToggle').classList.toggle('on', on);
  $('#editToggle').textContent = on ? 'Stop correcting' : 'Correct outline';
  $('#sliceHint').textContent = on
    ? 'Paint the region you chose; Erase removes any label. Use the sliders to change slice.'
    : "Click an image to move the crosshair. Radiological view: patient's right on the image left.";
  if (on && !['prediction', 'ai'].includes($('#sliceOverlay').value)) {
    $('#sliceOverlay').value = 'prediction';
    slices.setOverlay('prediction');
  }
}

const revision = () => state.results?.review?.revision ?? 0;

async function handleConflict(err) {
  // A colleague changed the case: load their version, keep this doctor's unsaved strokes.
  if (err.status !== 409) return false;
  alert(`${err.message}`);
  const job = await api(`/api/jobs/${state.jobId}`);
  if (job.results) await showResults(state.jobId, job.results, { keepView: true });
  return true;
}

$('#editToggle').addEventListener('click', () => {
  if (slices.editing && slices.strokes.length && !confirm('Discard unsaved corrections?')) return;
  if (slices.editing) slices.clearStrokes();
  setEditing(!slices.editing);
});
$('#brushSize').addEventListener('input', (e) => {
  slices.setBrush(Number(e.target.value));
  $('#brushValue').textContent = `${e.target.value} mm`;
});
$('#undoStroke').addEventListener('click', () => slices.undo());
$('#discardEdits').addEventListener('click', () => slices.clearStrokes());
$('#saveEdits').addEventListener('click', async () => {
  try {
    const body = { strokes: slices.exportStrokes(), revision: revision() };
    $('#editStatus').textContent = 'Saving and recalculating…';
    $('#saveEdits').disabled = true;
    const r = await postJson(`/api/jobs/${state.jobId}/edits`, body);
    slices.clearStrokes();
    $('#editStatus').textContent = 'Saved. Volumes, 3D and report updated.';
    await showResults(state.jobId, r, { keepView: true });
  } catch (err) {
    if (await handleConflict(err)) $('#editStatus').textContent = 'Reloaded the latest version; your strokes are kept. Save again if still needed.';
    else $('#editStatus').textContent = err.message;
    $('#saveEdits').disabled = !slices.strokes.length;
  }
});
$('#revertAi').addEventListener('click', async () => {
  try {
    if (!confirm('Remove all corrections and go back to the original AI outline?')) return;
    const r = await postJson(`/api/jobs/${state.jobId}/revert`, { revision: revision() });
    slices.clearStrokes();
    await showResults(state.jobId, r, { keepView: true });
  } catch (err) { if (!(await handleConflict(err))) $('#editStatus').textContent = err.message; }
});

// ------------------------------------------------------------------ review & audit
const STATUS_TEXT = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected' };

function renderReview(r) {
  const rv = r.review || { status: 'pending' };
  $('#reviewCard').classList.remove('hidden');
  const badge = $('#reviewBadge');
  badge.className = `badge-status ${rv.status}`;
  badge.textContent = STATUS_TEXT[rv.status] || rv.status;
  let info = rv.edited ? `Outline corrected by a clinician (revision ${rv.revision}). ` : 'AI outline, not corrected. ';
  if (rv.status === 'approved') info += `Signed by ${rv.signed_by} (${rv.signed_role}) on ${(rv.signed_at || '').replace('T', ' ')}.`;
  else if (rv.status === 'rejected') info += `Rejected by ${rv.signed_by} on ${(rv.signed_at || '').replace('T', ' ')}.`;
  else info += 'Check the outline on the slices, correct it if needed, then approve.';
  if (rv.comment) info += ` Comment: “${rv.comment}”`;
  $('#reviewInfo').textContent = info;
  $('#approveBtn').disabled = rv.status === 'approved';
  $('#rejectBtn').disabled = rv.status === 'rejected';
  $('#reopenBtn').disabled = rv.status === 'pending';
  const reviewer = can('review');
  $('#reviewControls').classList.toggle('hidden', !reviewer);
  $('#readOnlyNote').classList.toggle('hidden', reviewer);
  $('#editToggle').classList.toggle('hidden', !reviewer);
  if (state.user) $('#signingAs').innerHTML = `Signing as <b>${esc(state.user.name)}</b> (${esc(state.user.role_label)})`;
}

async function decide(decision) {
  try {
    if (decision === 'approve' && slices.strokes.length) throw new Error('Save or discard your corrections before approving.');
    const body = { decision, comment: $('#reviewComment').value.trim(), revision: revision() };
    const r = await postJson(`/api/jobs/${state.jobId}/review`, body);
    $('#reviewComment').value = '';
    state.results = r;
    renderReview(r);
    loadAudit();
    loadHistory();
  } catch (err) { if (!(await handleConflict(err))) alert(err.message); }
}
$('#approveBtn').addEventListener('click', () => decide('approve'));
$('#rejectBtn').addEventListener('click', () => decide('reject'));
$('#reopenBtn').addEventListener('click', () => decide('reopen'));

const ACTIONS = { upload: 'Uploaded', analysis: 'AI analysis', correction: 'Outline corrected', revert_to_ai: 'Reverted to AI outline', approve: 'Approved', reject: 'Rejected', reopen: 'Reopened' };
async function loadAudit() {
  try {
    const { entries } = await api(`/api/jobs/${state.jobId}/audit`);
    $('#auditList').innerHTML = entries.slice().reverse().map((a) => {
      const extra = a.voxels_changed ? ` · ${Object.values(a.voxels_changed).reduce((s, v) => s + Math.max(v, 0), 0)} voxels changed` : '';
      return `<li><b>${esc(ACTIONS[a.action] || a.action)}</b> · ${esc(a.actor?.name)}${a.actor?.role ? ` (${esc(a.actor.role)})` : ''}`
        + `<br><span>${esc(a.time.replace('T', ' '))}${esc(extra)}${a.comment ? ` · “${esc(a.comment)}”` : ''}</span></li>`;
    }).join('');
  } catch { $('#auditList').innerHTML = ''; }
}

// ------------------------------------------------------------------ follow-up timeline
async function loadTimeline(r) {
  const card = $('#timelineCard');
  if (!r.patient_code) { card.classList.add('hidden'); return; }
  let data;
  try { data = await api(`/api/patients/${encodeURIComponent(r.patient_code)}`); } catch { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  $('#timelinePatient').textContent = `${r.patient_code} · ${data.scans.length} scan${data.scans.length === 1 ? '' : 's'}`;
  const scans = data.scans;
  let html = '';
  if (scans.length < 2) {
    html = `<p class="small muted">Baseline only. Upload later scans with patient code <b>${esc(r.patient_code)}</b> to track change.</p>`;
  } else {
    html += timelineChart(scans);
  }
  html += `<table class="tbl"><tr><th>Date</th><th class="n">Enh. cm³</th><th class="n">SPD mm²</th><th class="n">Δ enh.</th><th>Assessment</th></tr>`;
  for (const s of scans) {
    const cls = /Progression/.test(s.category) ? 'prog' : /response/i.test(s.category) ? 'resp' : 'stable';
    const delta = s.changes && s.changes.enhancing_vs_previous_pct !== undefined ? signed(s.changes.enhancing_vs_previous_pct) : '–';
    html += `<tr class="click ${s.job_id === state.jobId ? 'current' : ''}" data-job="${s.job_id}" title="${esc(s.reason)}">
      <td>${esc(s.scan_date)}</td><td class="n">${fmt(s.enhancing_cm3, 1)}</td><td class="n">${fmt(s.spd_mm2, 0)}</td>
      <td class="n">${delta}</td><td><span class="cat ${cls}">${esc(s.category.replace(' (radiographic)', ''))}</span></td></tr>`;
  }
  html += `</table><p class="note">${esc(data.note)}</p>`;
  $('#timeline').innerHTML = html;
  $('#timeline').querySelectorAll('[data-job]').forEach((row) => row.addEventListener('click', () => {
    if (row.dataset.job !== state.jobId) trackJob(row.dataset.job);
  }));
  wireChartHover();
}

function timelineChart(scans) {
  const W = 320, H = 150, L = 34, R = 74, T = 10, B = 22;
  const t = scans.map((s) => Date.parse(s.scan_date));
  const t0 = Math.min(...t), t1 = Math.max(...t);
  const x = (d) => L + (t1 === t0 ? 0.5 : (d - t0) / (t1 - t0)) * (W - L - R);
  const maxV = Math.max(1, ...scans.flatMap((s) => CHART_SERIES.map((c) => s.regions[c.key] || 0)));
  const nice = Math.pow(10, Math.floor(Math.log10(maxV)));
  const top = Math.ceil(maxV / nice) * nice;
  const y = (v) => T + (1 - v / top) * (H - T - B);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Volume over time">`;
  for (const f of [0, 0.5, 1]) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(top * f)}" y2="${y(top * f)}" stroke="#253255" stroke-width="1"/>`
      + `<text x="${L - 4}" y="${y(top * f) + 3}" text-anchor="end">${fmt(top * f, 0)}</text>`;
  }
  svg += `<text x="4" y="${T + 4}" transform="rotate(-90 4 ${T + 4})" text-anchor="end">cm³</text>`;
  scans.forEach((s, i) => {
    if (i === 0 || i === scans.length - 1 || scans.length <= 4) {
      svg += `<text x="${x(t[i])}" y="${H - 6}" text-anchor="middle">${esc(s.scan_date.slice(2))}</text>`;
    }
  });
  for (const c of CHART_SERIES) {
    const pts = scans.map((s, i) => [x(t[i]), y(s.regions[c.key] || 0)]);
    svg += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c.color}" stroke-width="2" stroke-dasharray="${c.dash}" stroke-linejoin="round"/>`;
    for (const [px, py] of pts) {
      svg += c.marker === 'square'
        ? `<rect x="${px - 4}" y="${py - 4}" width="8" height="8" rx="1" fill="${c.color}" stroke="#151e33" stroke-width="2"/>`
        : `<circle cx="${px}" cy="${py}" r="4.5" fill="${c.color}" stroke="#151e33" stroke-width="2"/>`;
    }
    const last = pts[pts.length - 1];
    svg += `<text x="${last[0] + 8}" y="${last[1] + 3}" style="fill:#e7ecf6">${c.name.replace(' tumour', '')}</text>`;
  }
  scans.forEach((s, i) => {
    const tip = [s.scan_date, ...CHART_SERIES.map((c) => `${c.name}: ${fmt(s.regions[c.key] || 0, 1)} cm³`)].join('|');
    svg += `<rect class="hit" x="${x(t[i]) - 12}" y="${T}" width="24" height="${H - T - B}" fill="transparent" data-tip="${esc(tip)}"/>`;
  });
  svg += '</svg>';
  const legend = CHART_SERIES.map((c) => `<span><i style="background:${c.color}"></i>${c.name}${c.dash ? ' (dashed)' : ''}</span>`).join('');
  return `<div class="legend">${legend}</div><div class="chart-wrap" style="position:relative">${svg}<div class="tooltip hidden" id="chartTip"></div></div>`;
}

function wireChartHover() {
  const tip = $('#chartTip');
  if (!tip) return;
  $('#timeline').querySelectorAll('rect.hit').forEach((rect) => {
    rect.addEventListener('mouseenter', () => {
      const [date, ...rows] = rect.dataset.tip.split('|');
      tip.innerHTML = `<b>${esc(date)}</b>${rows.map(esc).join('<br>')}`;
      const box = rect.getBoundingClientRect();
      const wrap = rect.closest('.chart-wrap').getBoundingClientRect();
      tip.style.left = `${Math.min(box.left - wrap.left, wrap.width - 170)}px`;
      tip.style.top = '0px';
      tip.classList.remove('hidden');
    });
    rect.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  });
}

// ------------------------------------------------------------------ 3D toolbar
for (const btn of $$('[data-view]')) {
  btn.addEventListener('click', () => {
    viewer.setView(btn.dataset.view);
    $('#axesHint').textContent = VIEW_HINTS[btn.dataset.view];
  });
}
$('#brainOpacity').addEventListener('input', (e) => viewer.setBrainOpacity(Number(e.target.value) / 100));
$('#clipAxis').addEventListener('change', (e) => {
  $('#clipPos').disabled = e.target.value === 'none';
  $('#clipPos').value = 0;
  viewer.setClip(e.target.value, 0);
});
$('#clipPos').addEventListener('input', (e) => viewer.setClip($('#clipAxis').value, Number(e.target.value) / 100));
$('#brainSource').addEventListener('change', (e) => viewer.setBrainSource(e.target.value));
$('#gtToggle').addEventListener('change', (e) => viewer.setGroundTruthVisible(e.target.checked));
$('#spinToggle').addEventListener('change', (e) => viewer.setAutoRotate(e.target.checked));
$('#shotBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = viewer.snapshot();
  a.download = `medtwin-${state.results?.case_label || 'view'}.png`;
  a.click();
});
$('#sliceChannel').addEventListener('change', (e) => slices.setChannel(e.target.value));
$('#sliceOverlay').addEventListener('change', (e) => slices.setOverlay(e.target.value));

// ------------------------------------------------------------------ history
async function loadHistory() {
  try {
    const { jobs } = await api('/api/jobs');
    const del = can('delete');
    $('#history').innerHTML = jobs.length ? jobs.map((j) => `<li data-id="${j.id}">
        <span>${esc(j.case_label)}<br><span class="muted small">${esc((j.created_at || '').replace('T', ' '))}${j.created_by ? ` · ${esc(j.created_by)}` : ''}</span></span>
        <span><span class="badge ${j.status}">${j.status}</span>${del ? `<button class="del" data-del="${j.id}" title="Delete">✕</button>` : ''}</span>
      </li>`).join('') : '<li class="muted small">None yet</li>';
    highlightHistory();
  } catch { /* server not reachable; status pill shows it */ }
}

function highlightHistory() {
  $$('#history li[data-id]').forEach((li) => li.classList.toggle('active', li.dataset.id === state.jobId));
}

$('#history').addEventListener('click', (e) => {
  const del = e.target.dataset.del;
  if (del) { e.stopPropagation(); deleteJob(del); return; }
  const li = e.target.closest('li[data-id]');
  if (li) trackJob(li.dataset.id);
});

async function deleteJob(id) {
  if (!confirm('Delete this case and all its files from the server?')) return;
  try { await api(`/api/jobs/${id}`, { method: 'DELETE' }); } catch (err) { alert(err.message); return; }
  if (state.jobId === id) {
    history.replaceState(null, '', location.pathname);
    location.reload();
  } else {
    loadHistory();
  }
}

// ------------------------------------------------------------------ accounts
const AUTH_FORMS = { login: '#loginForm', setup: '#setupForm', blocked: '#setupBlocked', password: '#passwordForm', forgot: '#forgotForm', recovery: '#recoveryForm' };

function showAuth(mode, forced = false) {
  $('#authOverlay').classList.remove('hidden');
  for (const sel of Object.values(AUTH_FORMS)) $(sel).classList.add('hidden');
  showError($('#authError'), null);
  const form = AUTH_FORMS[mode];
  $(form).classList.remove('hidden');
  if (mode === 'password') {
    $('#passwordReason').textContent = forced ? 'Your password was set by an administrator. Choose your own before continuing.' : 'Choose a new password.';
    $('#pwCancel').classList.toggle('hidden', forced);
    $('#recoveryLinkRow').classList.toggle('hidden', forced);
    $('#recoveryState').textContent = state.user?.has_recovery_code ? '(You already have one; a new code replaces it.)' : '';
  }
  if (mode === 'forgot') {
    $('#forgotDone').classList.add('hidden');
    $('#forgotUser').value = $('#loginUser').value;
    setForgotWay('code');
  }
  if (mode === 'recovery') {
    $('#recAsk').classList.remove('hidden');
    $('#recResult').classList.add('hidden');
    $('#recPass').value = '';
  }
  $(form).querySelector('input')?.focus();
}

function hideAuth() { $('#authOverlay').classList.add('hidden'); }

function setUser(user) {
  state.user = user;
  $('#userMenu').classList.toggle('hidden', !user);
  if (!user) return;
  $('#userChip').innerHTML = `<b>${esc(user.name)}</b> · ${esc(user.role_label)}`;
  $('#usersBtn').classList.toggle('hidden', !can('manage_users'));
}

async function afterSignIn(user) {
  setUser(user);
  if (user.must_change_password) { showAuth('password', true); return; }
  hideAuth();
  if (!state.started) { state.started = true; await startApp(); }
  else { loadHistory(); if (state.results) renderReview(state.results); }
  refreshResetBadge();
}

// Administrators see how many doctors are waiting for a password reset.
async function refreshResetBadge() {
  if (!can('manage_users')) return;
  try {
    const { pending_resets: n } = await api('/api/auth/me');
    $('#usersBtn').innerHTML = `Users${n ? `<span class="count" title="${n} password reset request${n === 1 ? '' : 's'}">${n}</span>` : ''}`;
  } catch { /* signed out */ }
}
setInterval(refreshResetBadge, 60000);

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { user } = await postJson('/api/auth/login', { username: $('#loginUser').value, password: $('#loginPass').value });
    $('#loginPass').value = '';
    await afterSignIn(user);
  } catch (err) { showError($('#authError'), err); }
});

$('#setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('#setupPass').value !== $('#setupPass2').value) { showError($('#authError'), new Error('The two passwords differ.')); return; }
  try {
    const { user } = await postJson('/api/auth/setup', { username: $('#setupUser').value, name: $('#setupName').value, password: $('#setupPass').value });
    $('#setupPass').value = ''; $('#setupPass2').value = '';
    await afterSignIn(user);
  } catch (err) { showError($('#authError'), err); }
});

$('#passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('#pwNew').value !== $('#pwNew2').value) { showError($('#authError'), new Error('The two new passwords differ.')); return; }
  try {
    const { user } = await postJson('/api/auth/password', { old: $('#pwOld').value, new: $('#pwNew').value });
    for (const id of ['pwOld', 'pwNew', 'pwNew2']) $(`#${id}`).value = '';
    setUser(user);
    // First sign-in: offer a recovery code before opening the app.
    if (!user.has_recovery_code && !state.started) { showAuth('recovery'); return; }
    await afterSignIn(user);
  } catch (err) { showError($('#authError'), err); }
});
$('#pwCancel').addEventListener('click', hideAuth);
$('#toRecovery').addEventListener('click', () => showAuth('recovery'));

// ---- forgotten password (sign-in screen)
function setForgotWay(way) {
  $$('input[name=forgotWay]').forEach((r) => { r.checked = r.value === way; });
  $('#codeFields').classList.toggle('hidden', way !== 'code');
  $('#adminHint').classList.toggle('hidden', way !== 'admin');
  $('#forgotSubmit').textContent = way === 'code' ? 'Set new password' : 'Send request';
}
$$('input[name=forgotWay]').forEach((r) => r.addEventListener('change', () => setForgotWay(r.value)));
$('#forgotLink').addEventListener('click', () => showAuth('forgot'));
$('#forgotBack').addEventListener('click', () => showAuth('login'));

$('#forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError($('#authError'), null);
  const way = $('input[name=forgotWay]:checked').value;
  const username = $('#forgotUser').value.trim();
  try {
    let message;
    if (way === 'code') {
      if ($('#forgotPass').value !== $('#forgotPass2').value) throw new Error('The two new passwords differ.');
      ({ message } = await postJson('/api/auth/recover', { username, code: $('#forgotCode').value, new_password: $('#forgotPass').value }));
      $('#loginUser').value = username;
    } else {
      ({ message } = await postJson('/api/auth/forgot', { username }));
    }
    for (const id of ['forgotCode', 'forgotPass', 'forgotPass2']) $(`#${id}`).value = '';
    $('#forgotDone').textContent = message;
    $('#forgotDone').classList.remove('hidden');
    if (way === 'code') setTimeout(() => showAuth('login'), 3500);
  } catch (err) { showError($('#authError'), err); }
});

// ---- recovery code (signed in)
$('#recoveryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { code } = await postJson('/api/auth/recovery-code', { password: $('#recPass').value });
    $('#recPass').value = '';
    $('#recCode').textContent = code;
    $('#recAsk').classList.add('hidden');
    $('#recResult').classList.remove('hidden');
    state.user = { ...state.user, has_recovery_code: true };
  } catch (err) { showError($('#authError'), err); }
});
$('#recCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#recCode').textContent); $('#recCopy').textContent = 'Copied'; } catch { $('#recCopy').textContent = 'Select and copy it'; }
});
$$('.rec-close').forEach((b) => b.addEventListener('click', async () => {
  $('#recCode').textContent = '';
  $('#recCopy').textContent = 'Copy';
  if (state.started) hideAuth(); else await afterSignIn(state.user);
}));
$('#passwordBtn').addEventListener('click', () => showAuth('password'));
$('#logoutBtn').addEventListener('click', async () => {
  try { await postJson('/api/auth/logout', {}); } catch { /* already signed out */ }
  location.reload();
});

// ---- account management (administrators)
async function loadUsers() {
  showError($('#usersError'), null);
  try {
    const { users, roles } = await api('/api/users');
    const roleOptions = (sel) => roles.map((r) => `<option value="${r.key}" ${r.key === sel ? 'selected' : ''}>${esc(r.label)}</option>`).join('');
    $('#newRole').innerHTML = roleOptions('radiologist');
    const waiting = users.filter((u) => u.reset_requested_at && u.active);
    $('#resetRequests').innerHTML = waiting.length
      ? `<div class="reset-req"><b>Password reset requested</b> · check who the doctor is (in person or by phone) before resetting.<ul>`
        + waiting.map((u) => `<li>${esc(u.name)} (${esc(u.username)}) · asked ${esc(u.reset_requested_at.replace('T', ' '))}<button type="button" data-reset-now="${esc(u.username)}">Reset now</button></li>`).join('')
        + '</ul></div>'
      : '';
    $('#resetRequests').querySelectorAll('[data-reset-now]').forEach((b) => b.addEventListener('click', () => resetPassword(b.dataset.resetNow)));
    $('#usersTable').innerHTML = '<tr><th>Username</th><th>Name</th><th>Role</th><th>Last sign-in</th><th>Status</th><th></th></tr>'
      + users.map((u) => `<tr class="${u.active ? '' : 'inactive'}" data-user="${esc(u.username)}">
        <td>${esc(u.username)}${u.username === state.user.username ? ' (you)' : ''}</td><td>${esc(u.name)}</td>
        <td><select data-role>${roleOptions(u.role)}</select></td>
        <td>${esc((u.last_login || '–').replace('T', ' '))}</td>
        <td>${u.active ? 'Active' : 'Deactivated'}${u.must_change_password ? ' · must change password' : ''}${u.reset_requested_at ? ' · <b>reset requested</b>' : ''}${u.has_recovery_code ? ' · recovery code set' : ''}</td>
        <td><button type="button" data-reset>Reset password</button> <button type="button" data-active>${u.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('');
    $('#usersTable').querySelectorAll('tr[data-user]').forEach((row) => {
      const username = row.dataset.user;
      const update = async (body) => {
        try { await postJson(`/api/users/${encodeURIComponent(username)}`, body, 'PATCH'); loadUsers(); } catch (err) { showError($('#usersError'), err); loadUsers(); }
      };
      row.querySelector('[data-role]').addEventListener('change', (e) => update({ role: e.target.value }));
      row.querySelector('[data-active]').addEventListener('click', () => {
        const active = row.querySelector('[data-active]').textContent === 'Activate';
        if (active || confirm(`Deactivate ${username}? They will be signed out and cannot sign in.`)) update({ active });
      });
      row.querySelector('[data-reset]').addEventListener('click', () => resetPassword(username));
    });
    const { entries } = await api('/api/security-audit');
    $('#securityLog').innerHTML = entries.slice(0, 100).map((x) => `<li><b>${esc(x.event.replace(/_/g, ' '))}</b> · ${esc(x.username || x.job || '')}${x.by ? ` by ${esc(x.by)}` : ''}${x.client ? ` from ${esc(x.client)}` : ''}<br><span>${esc(x.time.replace('T', ' '))}</span></li>`).join('');
  } catch (err) { showError($('#usersError'), err); }
}

async function resetPassword(username) {
  if (!confirm(`Create a new temporary password for ${username}?\n\nCheck that you are talking to this doctor first. Their current password stops working and they are signed out.`)) return;
  try {
    const { temporary_password: pw } = await postJson(`/api/users/${encodeURIComponent(username)}/reset-password`, {});
    const box = $('#tempPwBox');
    box.innerHTML = `Temporary password for <b>${esc(username)}</b>:<div class="code-box">${esc(pw)}</div>`
      + 'Give it to the doctor in person or by phone. It is shown only now; they must choose their own password at the next sign-in. '
      + '<button type="button" id="tempPwHide">Hide</button>';
    box.classList.remove('hidden');
    $('#tempPwHide').addEventListener('click', () => { box.classList.add('hidden'); box.innerHTML = ''; });
    loadUsers();
    refreshResetBadge();
  } catch (err) { showError($('#usersError'), err); }
}

$('#usersBtn').addEventListener('click', () => { $('#tempPwBox').classList.add('hidden'); $('#usersDialog').showModal(); loadUsers(); });
$('#usersClose').addEventListener('click', () => { $('#tempPwBox').innerHTML = ''; $('#tempPwBox').classList.add('hidden'); $('#usersDialog').close(); });
$('#addUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await postJson('/api/users', { username: $('#newUsername').value, name: $('#newName').value, role: $('#newRole').value, password: $('#newPass').value });
    for (const id of ['newUsername', 'newName', 'newPass']) $(`#${id}`).value = '';
    loadUsers();
  } catch (err) { showError($('#usersError'), err); }
});

// ------------------------------------------------------------------ start
async function startApp() {
  buildPaintButtons();
  try {
    const { cases } = await api('/api/demo-cases');
    $('#demoSelect').innerHTML = cases.map((c) => `<option>${esc(c)}</option>`).join('') || '<option disabled>No dataset found</option>';
    $('#demoBtn').disabled = !cases.length;
  } catch { $('#demoBtn').disabled = true; }
  await loadHistory();
  openFromHash();
}

async function init() {
  renderSlots();
  try {
    state.health = await api('/api/health');
    const h = state.health;
    $('#serverStatus').textContent = `Ready · ${h.device.toUpperCase()} · ${h.diseases.map((d) => d.name).join(', ')}${h.skull_stripping ? ' · HD-BET' : ''}`;
    $('#serverStatus').classList.add('ok');
    $('#disclaimer').textContent = h.disclaimer;
  } catch {
    $('#serverStatus').textContent = 'Server offline';
    return;
  }
  const status = await api('/api/auth/status');
  if (status.authenticated) await afterSignIn(status.user);
  else if (status.setup_allowed) showAuth('setup');
  else if (status.setup_required) showAuth('blocked');
  else showAuth('login');
}

function openFromHash() {
  const match = location.hash.match(/job=([a-f0-9]{12})/);
  if (match && match[1] !== state.jobId) trackJob(match[1]);
}

window.addEventListener('hashchange', openFromHash);
init();
