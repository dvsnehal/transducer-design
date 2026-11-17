"use strict";
// Front end of the ustx application. It draws what the server computes; it contains no physics.
const INK = "#0e3b43", TEAL = "#1f7a8c", CORAL = "#f2654a", OCHRE = "#b98a2f", SLATE = "#6e8589", RULE = "#e3eaeb";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let main = $("#main");  // render target of the current view; route() points it at #view
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, p = 4) => v == null ? "–" : typeof v !== "number" ? esc(v)
  : Number.isInteger(v) ? String(v) : Math.abs(v) >= 1000 ? v.toFixed(0) : String(+v.toPrecision(p));
const fix = (v, d) => v == null ? "–" : v.toFixed(d);
const LABELS = {
  fc_mhz: "Centre frequency (MHz)", fbw6_pe_pct: "−6 dB fractional bandwidth (%)",
  il2_db_at_fc: "Two-way insertion loss (dB)", tau20_us: "−20 dB pulse length (µs)",
};
const V = { fc: "<i class=v>f</i><sub>c</sub>", tau: "<i class=v>τ</i><sub>−20</sub>" };

let META, S, SIM, SIMERR = null, OPT = null, simSeq = 0;

// ------------------------------------------------------------------ server
async function api(path, body) {
  let r;
  if (window.USTX_PY) {  // browser build: the engine runs in the page (web/pybridge.js)
    try { r = await window.USTX_PY(path, body); } catch (e) { throw new Error(`The simulation engine failed: ${e.message}`); }
  } else {
    try {
      r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      throw new Error("The server is not responding. Start it again with: python -m ustx.application.server");
    }
  }
  if (!r.ok) {
    let m = `The request failed (status ${r.status}).`;
    try { m = (await r.json()).error || m; } catch { /* body was not JSON */ }
    throw new Error(m);
  }
  return r;
}
const getJSON = async (path, body) => (await api(path, body)).json();

async function simulate() {
  const seq = ++simSeq;
  try {
    const r = await getJSON("/api/simulate", S);
    if (seq !== simSeq) return false;  // a newer request is in flight
    SIM = r; SIMERR = null;
  } catch (e) {
    if (seq !== simSeq) return false;
    SIMERR = e.message;
  }
  try { localStorage.setItem("ustx.design", JSON.stringify(S)); } catch { /* storage unavailable */ }
  rail();
  return true;
}

function rail() {
  if (!SIM) return;
  const h = SIM.headline, n = SIM.stack.filter(b => b.role === "matching").length;
  $("#loaded").innerHTML = `<b>Loaded design</b>${esc(SIM.piezo_name)}, ${n} matching layer${n === 1 ? "" : "s"}<br>
    ${fix(h.fc, 2)} MHz · ${fix(h.fbw, 0)} % · ${fix(h.il, 1)} dB`;
}

async function loadDesign(state) {
  S = structuredClone(state);
  await simulate();
  location.hash = "#workbench";
}

async function busy(btn, label, fn) {
  const text = btn.textContent, err = $(".err");
  if (err) err.innerHTML = "";
  btn.disabled = true; btn.textContent = label;
  try { await fn(); } catch (e) { if (err) err.innerHTML = `<p class="alert">${esc(e.message)}</p>`; }
  btn.disabled = false; btn.textContent = text;
}

// ------------------------------------------------------------------ building blocks
function table(rows, cols, empty = "No rows.") {
  if (!rows || !rows.length) return `<p class="muted">${empty}</p>`;
  cols = (cols || Object.keys(rows[0])).map(c => typeof c === "string" ? { k: c } : c);
  for (const c of cols) c.n = !c.html && rows.some(r => typeof r[c.k] === "number");
  const cell = (r, c, i) => c.html ? c.html(r, i) : c.fmt ? c.fmt(r[c.k]) : num(r[c.k]);
  const wide = (r, c) => typeof r[c.k] === "string" && r[c.k].length > 60 ? " wide" : "";
  return `<div class="tw" tabindex="0"><table><thead><tr>${cols.map(c => `<th class="${c.n ? "n" : ""}">${c.label ?? esc(c.k)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr>${cols.map(c => `<td class="${c.n ? "n" : ""}${wide(r, c)}">${cell(r, c, i)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
const fig = (id, caption, h = 340) => `<figure class="fig"><div class="plot" id="${id}" style="height:${h}px"></div><figcaption>${caption}</figcaption></figure>`;
const tab = (caption, html) => `<figure class="tab"><figcaption>${caption}</figcaption>${html}</figure>`;
const ax = (title, extra = {}) => ({ title: { text: title, standoff: 8 }, ...extra });
const AX = { showline: true, linecolor: INK, linewidth: 1, mirror: true, ticks: "inside", ticklen: 4, tickcolor: INK, gridcolor: RULE, zeroline: false, automargin: true };

function plot(id, traces, layout = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const legend = layout.showlegend ?? traces.length > 1;
  const L = {
    font: { family: getComputedStyle(document.body).fontFamily, size: 12.5, color: "#12292e" },
    paper_bgcolor: "#fff", plot_bgcolor: "#fff", colorway: [INK, CORAL, TEAL, OCHRE, SLATE],
    margin: { l: 58, r: 14, t: legend ? 30 : 10, b: 44 }, showlegend: legend,
    legend: { orientation: "h", y: 1.02, yanchor: "bottom", x: 0 },
    hoverlabel: { bgcolor: "#fff", bordercolor: INK, font: { color: "#12292e" } }, ...layout,
  };
  for (const k of ["xaxis", "yaxis", "yaxis2"]) if (k !== "yaxis2" || L[k]) L[k] = { ...AX, ...L[k] };
  Plotly.react(el, traces, L, { displaylogo: false, responsive: true, toImageButtonOptions: { format: "svg" } });
}
const lineTrace = (x, y, name, color) => ({ x, y, name, mode: "lines", line: { width: 1.6, ...(color ? { color } : {}) } });

function readout(h) {
  const item = (label, value, unit) => `<div><dt>${label}</dt><dd>${value}<small>${unit}</small></dd></div>`;
  return item("Centre frequency", fix(h.fc, 3), "MHz") + item("−6 dB bandwidth, pulse-echo", fix(h.fbw, 1), "%")
    + item("Two-way insertion loss", fix(h.il, 2), "dB") + item("Pulse length, −20 dB", fix(h.tau, 3), "µs")
    + item("|Z| at centre frequency", fix(h.zin, 1), "Ω");
}

// The acoustic stack as an engineering figure: cross-section to scale, dimension lines, and the
// impedance staircase the matching layers build between ceramic and tissue.
function stackHTML(blocks, sourceOhm) {
  const T = blocks.reduce((a, b) => a + (b.t || 0), 0);
  const cols = blocks.map(b => b.t == null ? "minmax(120px, 20fr)" : `minmax(84px, ${(100 * b.t / T).toFixed(2)}fr)`).join(" ");
  let m = 0;
  const B = blocks.map(b => ({ ...b, cls: b.role === "matching" ? `matching m${++m}` : b.role,
    title: { backing: "Backing", rear: "Rear layer", piezo: "Piezoelectric plate", load: "Load" }[b.role] ?? `Matching layer ${m}` }));
  const row = (cls, cell) => `<div class="srow ${cls}">${B.map(cell).join("")}</div>`;
  const bar = z => 12 + 88 * Math.min(1, Math.max(0, Math.log10(Math.max(z, 1e6) / 1e6) / Math.log10(40)));  // 1 to 40 MRayl, log
  return `<div class="stackfig" style="--cols:${cols}" role="img" aria-label="Cross-section and impedance profile of the acoustic stack: ${esc(B.map(b => `${b.title}, ${(b.z / 1e6).toFixed(2)} megarayl`).join("; "))}">
    ${row("wires", b => b.role === "piezo" ? `<div class="lead"><span>${num(sourceOhm)} Ω source and receiver</span></div>` : "<div></div>")}
    ${row("device", b => `<div class="blk ${b.cls}"></div>`)}
    ${row("dims", b => b.t == null ? `<div class="dim open ${b.role}"><span>half-space</span></div>` : `<div class="dim"><span>${(b.t * 1e6).toFixed(0)} µm</span></div>`)}
    ${row("zrow", b => `<div class="zcell"><b>${(b.z / 1e6).toFixed(2)}<small>MRayl</small></b><div class="zbar ${b.cls}" style="height:${bar(b.z).toFixed(0)}px"></div></div>`)}
    ${row("names", b => `<div><b>${b.title}</b><span>${esc(b.name)}</span></div>`)}
  </div>`;
}
const STACK_CAPTION = "Top: cross-section of the acoustic stack with finite layers to scale; sound radiates to the right. Bottom: specific acoustic impedance of each layer on a logarithmic scale, the staircase that the matching layers build between ceramic and tissue.";
function drawStack(id) {
  const el = document.getElementById(id);
  if (el && SIM) el.innerHTML = stackHTML(SIM.stack, SIM.source_ohm);
}

// ------------------------------------------------------------------ home
function home() {
  const h = SIM.headline, n = SIM.stack.filter(b => b.role === "matching").length;
  main.innerHTML = `
    <section class="hero">
      <h1>A simulation workbench for piezoelectric ultrasound transducers</h1>
      <p class="lede">Choose materials, build the transducer stack and see its impedance, bandwidth, sensitivity and pulse
      within milliseconds. Then let a multi-objective genetic algorithm search the design space, and test the best designs against
      manufacturing tolerances.</p>
      <div class="actions"><a class="button primary" href="#materials">Start the workflow</a><a class="button" href="#workbench">Go straight to the designer</a></div>
    </section>
    <section class="loaded-now">
      <p>Loaded now: ${esc(SIM.piezo_name)} plate with ${n} matching layer${n === 1 ? "" : "s"}, centred at ${fix(h.fc, 2)} MHz with
      ${fix(h.fbw, 0)} % bandwidth and ${fix(h.il, 1)} dB insertion loss. <a href="#workbench">Change it</a></p>
      <div id="home-stack"></div>
    </section>
    <section>
      <h2>The workflow, in seven steps</h2>
      <p class="muted">Work through the pages in order, or jump to any step. Each page starts with a short guide.</p>
      <ol class="contents">${STEPS.map((v, i) => `<li><a href="#${v.id}"><span class="cn">${i + 1}</span><span class="ct">${v.title}</span>
        <span class="cd">${v.blurb}</span><span class="ca" aria-hidden="true">→</span></a></li>`).join("")}</ol>
    </section>
    <section class="cols scope">
      <div><h2>What the model covers</h2><ul class="plain">
        <li>The thickness-mode transducer in one dimension (KLM model), checked against two independent formulations.</li>
        <li>Any number of matching layers with attenuation; backing; source, receiver and tuning inductor.</li>
        <li>${META.counts.piezo} piezoelectric and ${META.counts.passive} passive materials, every value traced to a published source.</li></ul></div>
      <div><h2>What it does not</h2><ul class="plain">
        <li>Beam shape, diffraction, focusing and lateral modes.</li>
        <li>Losses along the path in tissue; temperature effects.</li>
        <li>Any measured device: this is a simulation study.</li></ul></div>
    </section>`;
  drawStack("home-stack");
}

// ------------------------------------------------------------------ workbench (designer + simulation)
const cid = path => "c-" + path.replace(/\./g, "-");
const select = (path, label, options, value, attrs = "") => `<label for="${cid(path)}">${label}</label>
  <select id="${cid(path)}" data-path="${path}" ${attrs}>${options.map(([v, t]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
const number = (path, label, value, { min, max, step, scale = 1 }, attrs = "") => `<label for="${cid(path)}">${label}</label>
  <input type="number" id="${cid(path)}" data-path="${path}" data-scale="${scale}" value="${+(value / scale).toPrecision(6)}" min="${min}" max="${max}" step="${step}" ${attrs}>`;
const range = (path, label, value, { min, max, step, digits = 2, scale = 1, unit = "" }) => `<div class="rangehead"><label for="${cid(path)}">${label}</label>
  <output id="o-${cid(path)}">${(value / scale).toFixed(digits)}${unit}</output></div>
  <input type="range" id="${cid(path)}" data-path="${path}" data-scale="${scale}" data-digits="${digits}" data-unit="${unit}" value="${value / scale}" min="${min}" max="${max}" step="${step}">`;

function controls() {
  const apps = Object.entries(META.applications), preset = apps.find(([, a]) => Math.abs(a.f_target - S.f_target) < 1)?.[0] ?? "custom";
  const matIds = META.matching.map(m => m.id);
  const layers = S.layers.map((L, i) => {
    if (L.kind === "database" && !matIds.includes(L.material)) L.material = matIds[0];
    return `<div class="layer">
      ${select(`layers.${i}.kind`, `Layer ${i + 1}`, [["ideal", "Ideal, free impedance"], ["database", "Database material"]], L.kind, "data-structural")}
      ${L.kind === "database"
        ? select(`layers.${i}.material`, "Material", META.matching.map(m => [m.id, `${m.name} (${(m.z / 1e6).toFixed(2)} MRayl)`]), L.material)
        : number(`layers.${i}.z`, "Impedance (MRayl)", L.z, { min: 1, max: 40, step: 0.1, scale: 1e6 })}
      ${range(`layers.${i}.q`, "Thickness (quarter waves)", L.q, { min: 0.3, max: 2, step: 0.01 })}</div>`;
  }).join("");
  $("#controls").innerHTML = `
    <fieldset><legend>Target</legend>
      <label for="c-preset">Application preset</label>
      <select id="c-preset" data-special="preset" data-structural>${[["custom", { name: "Custom frequency" }], ...apps].map(([k, a]) => `<option value="${k}"${k === preset ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
      ${number("f_target", "Design frequency (MHz)", S.f_target, { min: 0.5, max: 50, step: 0.5, scale: 1e6 }, "data-structural")}
      <p class="note" id="wb-aperture"></p></fieldset>
    <fieldset><legend>Piezoelectric plate</legend>
      ${select("piezo", "Material", META.piezo.map(p => [p.id, p.name]), S.piezo)}
      ${range("s", "Thickness (fraction of λ/2 at target)", S.s, { min: 0.4, max: 1.3, step: 0.005, digits: 3 })}
      <p class="note" id="wb-plate"></p></fieldset>
    <fieldset><legend>Front matching layers, inner to outer</legend>
      <label for="c-nlayers">Number of layers</label>
      <input type="number" id="c-nlayers" data-special="nlayers" data-structural value="${S.layers.length}" min="0" max="3" step="1">
      ${layers}</fieldset>
    <fieldset><legend>Backing and load</legend>
      <label class="check"><input type="checkbox" data-special="custom" data-structural ${S.backing_custom != null ? "checked" : ""}>Custom backing impedance</label>
      ${S.backing_custom != null
        ? number("backing_custom", "Backing impedance (MRayl)", S.backing_custom, { min: 0, max: 40, step: 0.1, scale: 1e6 })
        : select("backing", "Backing material", META.backing.map(m => [m.id, `${m.name} (${(m.z / 1e6).toFixed(2)} MRayl)`]), S.backing)}
      ${number("load_z", "Acoustic load (MRayl)", S.load_z, { min: 0.1, max: 10, step: 0.01, scale: 1e6 })}</fieldset>
    <fieldset><legend>Electrical port</legend>
      <div class="row"><div>${number("rs", "Source resistance (Ω)", S.rs, { min: 1, max: 1e4, step: 1 })}</div>
      <div>${number("rl", "Receiver resistance (Ω)", S.rl, { min: 1, max: 1e7, step: 1 })}</div></div>
      ${select("tuning", "Tuning inductor", [["none", "None"], ["series_L", "Series inductor"], ["shunt_L", "Shunt inductor"]], S.tuning, "data-structural")}
      ${S.tuning !== "none" ? range("kappa", "Inductance factor κ, where L = κ / ω²C₀", S.kappa, { min: 0.25, max: 4, step: 0.01 }) : ""}</fieldset>
    <div class="actions"><button type="button" id="wb-reset">Reset to the baseline design</button></div>`;
}

function setPath(obj, path, value) {
  const keys = path.split("."), last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

function onControl(e) {
  const el = e.target, sp = el.dataset.special;
  if (sp === "preset") { if (el.value !== "custom") S.f_target = META.applications[el.value].f_target; }
  else if (sp === "nlayers") {
    const n = Math.min(3, Math.max(0, Math.round(+el.value || 0)));
    while (S.layers.length < n) S.layers.push({ kind: "ideal", material: "PARYLENE_C", z: 3e6, q: 1.0 });
    S.layers.length = n;
  }
  else if (sp === "custom") S.backing_custom = el.checked ? (S.backing_custom ?? 5e6) : null;
  else if (el.dataset.path) {
    let v = el.value;
    if (el.type !== "select-one") {
      v = parseFloat(v) * (+el.dataset.scale || 1);
      if (!Number.isFinite(v) || (el.min !== "" && !el.checkValidity())) return;  // wait for a usable number
    }
    setPath(S, el.dataset.path, v);
    if (el.type === "range") $("#o-" + el.id).textContent = (+el.value).toFixed(+el.dataset.digits) + el.dataset.unit;
  } else return;
  if (e.type === "change" && "structural" in el.dataset) {
    const id = el.id;
    controls();
    if (id) document.getElementById(id)?.focus();
  }
  clearTimeout(onControl.timer);
  onControl.timer = setTimeout(async () => { if (await simulate()) results(); }, 40);
}

function results() {
  if (!$("#wb-stack")) return;
  $("#wb-alert").innerHTML = SIMERR ? `<p class="alert">${esc(SIMERR)}</p>`
    : !SIM.valid ? `<p class="alert">No −6 dB band lies inside the frequency grid, so the metrics are undefined. Check the design.</p>`
    : SIM.flags.length ? `<p class="warn">Material flags: ${esc(SIM.flags.join("; "))}</p>` : "";
  if (SIMERR) return;
  drawStack("wb-stack");
  $("#wb-readout").innerHTML = readout(SIM.headline);
  $("#wb-aperture").textContent = `Aperture: disc of ${SIM.aperture_mm.toFixed(2)} mm (20 wavelengths in tissue), area ${SIM.area_mm2.toFixed(2)} mm².`;
  $("#wb-plate").textContent = `Plate thickness ${SIM.thickness_um.toFixed(1)} µm.`;
  plot("wb-h", [lineTrace(SIM.f, SIM.pe, "pulse-echo"), lineTrace(SIM.f, SIM.tx, "transmit"), lineTrace(SIM.f, SIM.rx, "receive")], {
    xaxis: ax("Frequency (MHz)"), yaxis: ax("Magnitude (dB re own peak)", { range: [-40, 3] }),
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: -6, y1: -6, line: { color: SLATE, width: 1, dash: "dot" } }],
  });
  plot("wb-p", [lineTrace(SIM.t, SIM.pulse, "pulse-echo")], { xaxis: ax("Time relative to envelope peak (µs)"), yaxis: ax("Normalised amplitude") });
  $("#wb-res").innerHTML = table(SIM.resonances, [{ k: "Quantity" }, { k: "MHz", fmt: v => fix(v, 4) }]);
  $("#wb-metrics").innerHTML = table(SIM.metrics, [{ k: "metric", label: "Metric" }, { k: "value", label: "Value" }]);
}

function workbench() {
  main.innerHTML = `<div class="bench"><form id="controls" autocomplete="off" onsubmit="return false"></form>
    <div><div id="wb-alert" role="alert"></div>
      <figure class="fig"><div id="wb-stack"></div><figcaption>${STACK_CAPTION}</figcaption></figure>
      <dl class="readout" id="wb-readout"></dl>
      <div class="pair">
        ${fig("wb-h", "Transmit, receive and pulse-echo responses. The dotted line is the −6 dB level that defines bandwidth.", 360)}
        ${fig("wb-p", "Pulse-echo impulse response.", 360)}
      </div>
      <div style="max-width:620px"><h3>Resonances</h3><div id="wb-res"></div></div>
      <details><summary>Metric definitions</summary>
        <p class="eq">${V.fc} = ½ (<i>f</i><sub>lo</sub> + <i>f</i><sub>hi</sub>),&emsp; FBW = 100 (<i>f</i><sub>hi</sub> − <i>f</i><sub>lo</sub>) / ${V.fc}</p>
        <p class="note"><i class=v>f</i><sub>lo</sub> and <i class=v>f</i><sub>hi</sub> are the −6 dB edges of the pulse-echo magnitude |<i class=v>H</i><sub>pe</sub>|.</p>
        <p class="eq">IL<sub>2</sub> = −10 log<sub>10</sub> ( 4 (<i>R</i><sub>s</sub> / <i>R</i><sub>L</sub>) |<i>H</i><sub>pe</sub>(${V.fc})|<sup>2</sup> )</p>
        <p class="note">Two-way insertion loss relative to the power available from the source. The −20 dB pulse length ${V.tau}
        is the width of the Hilbert envelope of the impulse response at −20 dB of its peak.</p></details>
      <details><summary>All metrics</summary><div id="wb-metrics"></div></details>
    </div></div>`;
  controls();
  const form = $("#controls");
  form.addEventListener("input", onControl);
  form.addEventListener("change", onControl);
  form.addEventListener("click", async e => {
    if (e.target.id !== "wb-reset") return;
    S = structuredClone(META.default_state);
    controls();
    if (await simulate()) results();
  });
  results();
}

// ------------------------------------------------------------------ materials
const MAT = { tab: "record", cat: "piezo", id: null, prop: "Z (MRayl)" };
function materials() {
  const tabs = [["record", "Property record"], ["compare", "Piezoelectric comparison"], ["gaps", "Data gaps"], ["sources", "Sources"]];
  let body = "";
  if (MAT.tab === "record") {
    const cats = [...new Set(META.table.map(r => r.category))].sort();
    const rows = META.table.filter(r => r.category === MAT.cat);
    const ids = [...new Map(rows.map(r => [r.material_id, r.material_name])).entries()];
    if (!ids.some(([id]) => id === MAT.id)) MAT.id = ids[0]?.[0];
    const flags = META.piezo.find(p => p.id === MAT.id)?.flags ?? [];
    body = `<div class="row" style="max-width:640px">
        <div><label for="m-cat">Category</label><select id="m-cat" data-k="cat">${cats.map(c => `<option${c === MAT.cat ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
        <div><label for="m-id">Material</label><select id="m-id" data-k="id">${ids.map(([id, n]) => `<option value="${esc(id)}"${id === MAT.id ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></div></div>
      ${META.excluded[MAT.id] ? `<p class="warn">Excluded from simulation: ${esc(META.excluded[MAT.id])}.</p>` : ""}
      ${flags.length ? `<p class="warn">${esc(flags.join("; "))}</p>` : ""}
      ${tab("Every value carries its source, where it appears in that source, its status and its stated uncertainty.",
        table(rows.filter(r => r.material_id === MAT.id), [
          { k: "property", label: "Property" }, { k: "value", label: "Value" }, { k: "unit", label: "Unit" }, { k: "status", label: "Status" },
          { k: "confidence", label: "Confidence" }, { k: "source_id", label: "Source" }, { k: "source_location", label: "Location in source" },
          { k: "uncertainty_rel", label: "Rel. uncertainty" }, { k: "notes", label: "Notes" }]))}`;
  } else if (MAT.tab === "compare") {
    const props = Object.keys(META.piezo[0]).filter(k => !["id", "name", "flags"].includes(k));
    body = tab("Model-ready constants of the simulatable piezoelectric materials.", table(META.piezo, [{ k: "name", label: "Material" }, ...props]))
      + `<div style="max-width:300px"><label for="m-prop">Property to plot</label><select id="m-prop" data-k="prop">${props.map(p => `<option${p === MAT.prop ? " selected" : ""}>${esc(p)}</option>`).join("")}</select></div>`
      + fig("m-bar", `${esc(MAT.prop)} of each material.`, 320);
  } else if (MAT.tab === "gaps") {
    body = `<h2>Missing or approximated</h2>${table(META.missing, [{ k: "material_id", label: "Material" }, { k: "property", label: "Property" }, { k: "status", label: "Status" }, { k: "notes", label: "Notes" }])}
      <h2>Derived by a named rule</h2>${table(META.derived, [{ k: "material_id", label: "Material" }, { k: "quantity", label: "Quantity" }, { k: "value", label: "Value" }, { k: "rule", label: "Rule" }, { k: "status", label: "Status" }, { k: "note", label: "Note" }])}`;
  } else {
    body = table(META.sources, [{ k: "source_id", label: "Source" }, { k: "citation", label: "Citation" }, { k: "access_level", label: "Access" },
      { k: "accessed", label: "Accessed" }, { k: "notes", label: "Notes" },
      { k: "url", label: "Link", html: r => /^https?:\/\//.test(r.url ?? "") ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">open</a>` : "–" }]);
  }
  main.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" aria-selected="${k === MAT.tab}" data-tab="${k}">${t}</button>`).join("")}</div>${body}`;
  $$("[data-tab]").forEach(b => b.onclick = () => { MAT.tab = b.dataset.tab; materials(); });
  $$("select[data-k]").forEach(s => s.onchange = () => { MAT[s.dataset.k] = s.value; materials(); document.getElementById(s.id)?.focus(); });
  if (MAT.tab === "compare") plot("m-bar", [{ type: "bar", x: META.piezo.map(p => p.name), y: META.piezo.map(p => p[MAT.prop]), marker: { color: INK }, width: 0.55 }],
    { xaxis: {}, yaxis: ax(MAT.prop), margin: { l: 58, r: 14, t: 10, b: 90 } });
}

// ------------------------------------------------------------------ optimisation
const designCols = load => [
  { k: "fbw", label: "FBW (%)", fmt: v => fix(v, 1) }, { k: "il", label: "IL (dB)", fmt: v => fix(v, 2) }, { k: "tau", label: `${V.tau} (µs)`, fmt: v => fix(v, 3) },
  { k: "label", label: "Design" }, { k: "i", label: "", html: r => `<button class="small" data-load="${r.i}">${load}</button>` }];

function optResults() {
  const el = $("#opt-out");
  if (!el) return;
  if (!OPT) { el.innerHTML = `<p class="muted">No run in this session yet. Set the budget and run the optimiser.</p>`; return; }
  const rows = OPT.designs.map((d, i) => ({ ...d, i })).sort((a, b) => b.fbw - a.fbw);
  el.innerHTML = (OPT.feasible ? "" : `<p class="alert">No feasible design was found. Relax the constraints or increase the budget, then run again.</p>`)
    + fig("opt-conv", `Convergence of the NSGA-II front; ${rows.length} feasible non-dominated designs at the end.`, 300)
    + (rows.length ? table(rows, designCols("Load")) + `<p class="note" style="margin-top:12px">This front is also available under <a href="#pareto">Pareto analysis</a>.</p>` : "");
  plot("opt-conv", [lineTrace(OPT.evals, OPT.history, "")], { xaxis: ax("Model evaluations"), yaxis: ax("Normalised hypervolume") });
  $$("[data-load]", el).forEach(b => b.onclick = () => loadDesign(OPT.designs[+b.dataset.load].state));
}

function optimise() {
  const apps = Object.entries(META.applications);
  main.innerHTML = `<form id="opt" autocomplete="off"><div class="cols3">
      <div><label for="o-app">Application</label><select id="o-app" name="app">${apps.map(([k, a]) => `<option value="${k}"${k === "general" ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>
      <div class="row"><div><label for="o-pop">Population</label><input type="number" id="o-pop" name="pop" value="40" min="8" max="400" required></div>
        <div><label for="o-gens">Generations</label><input type="number" id="o-gens" name="gens" value="30" min="2" max="500" required></div>
        <div><label for="o-seed">Seed</label><input type="number" id="o-seed" name="seed" value="1" min="0" max="10000" required></div></div>
      <div><div class="rangehead"><label for="o-tol">Centre-frequency tolerance</label><output>5.0 %</output></div><input type="range" id="o-tol" name="tol" min="1" max="15" step="0.5" value="5" data-unit=" %">
        <div class="rangehead"><label for="o-rip">Maximum passband ripple</label><output>3.0 dB</output></div><input type="range" id="o-rip" name="ripple" min="0.5" max="6" step="0.5" value="3" data-unit=" dB"></div>
    </div>
    <fieldset><legend>Allowed piezoelectric materials</legend><div class="checks">
      ${META.piezo.map(p => `<label class="check"><input type="checkbox" name="piezos" value="${esc(p.id)}" checked>${esc(p.name)}</label>`).join("")}</div></fieldset>
    <div class="actions"><button class="primary" id="o-run">Run optimisation</button><span class="note" id="o-budget"></span></div></form>
    <div class="err" role="alert"></div><div id="opt-out"></div>`;
  const form = $("#opt"), val = n => form.elements[n].value;
  const sync = () => {
    $("#o-budget").textContent = `Budget: ${val("pop") * val("gens")} model evaluations, about 1 ms each.`;
    $$("input[type=range]", form).forEach(r => r.previousElementSibling.lastElementChild.textContent = (+r.value).toFixed(1) + r.dataset.unit);
  };
  form.oninput = sync;
  form.onsubmit = e => {
    e.preventDefault();
    const piezos = $$("input[name=piezos]:checked", form).map(c => c.value);
    busy($("#o-run"), "Optimising…", async () => {
      if (!piezos.length) throw new Error("Select at least one piezoelectric material.");
      OPT = await getJSON("/api/optimise", { app: val("app"), pop: +val("pop"), gens: +val("gens"), seed: +val("seed"),
        tol: +val("tol"), ripple: +val("ripple"), piezos });
      optResults();
    });
  };
  sync();
  optResults();
}

// ------------------------------------------------------------------ Pareto analysis
const PAR = { name: null, margin: 3, designs: [], k: 0, seq: 0 };
const frontName = n => n === "session" ? "This session" : n.replace(/_/g, ", ").replace(/^./, c => c.toUpperCase());

async function paretoSelect() {
  const seq = ++PAR.seq, r = await getJSON("/api/select", { F: PAR.designs.map(d => [d.fbw, d.il, d.tau]), margin: PAR.margin });
  if (seq !== PAR.seq || !$("#par-sel")) return;
  PAR.k = r.k;
  const D = PAR.designs, s = D[PAR.k], labels = D.map(d => d.label);
  $("#par-sel").innerHTML = `<b>Selected design:</b> ${esc(s.label)}<br>FBW ${fix(s.fbw, 1)} %, IL ${fix(s.il, 2)} dB, ${V.tau} ${fix(s.tau, 3)} µs.
    The rule is maximum bandwidth among designs whose insertion loss is within ${PAR.margin} dB of the lowest on the front; no weighted score is used.`;
  const axes = { fbw: "FBW (%)", il: "IL (dB)", tau: "τ<sub>−20</sub> (µs)" };
  [["fbw", "il"], ["fbw", "tau"], ["il", "tau"]].forEach(([a, b], i) => plot("par-" + i, [
    { x: D.map(d => d[a]), y: D.map(d => d[b]), text: labels, mode: "markers", marker: { size: 5, color: TEAL, opacity: 0.75 }, hovertemplate: "%{text}<br>%{x:.3g}, %{y:.3g}<extra></extra>" },
    { x: [s[a]], y: [s[b]], mode: "markers", marker: { size: 12, color: CORAL, symbol: "diamond", line: { color: INK, width: 1 } }, hoverinfo: "skip" },
  ], { showlegend: false, xaxis: ax(axes[a]), yaxis: ax(axes[b]) }));
  if ($("#par-3d-box").open) plot3d();
}
function plot3d() {
  const D = PAR.designs, s = D[PAR.k];
  Plotly.react("par-3d", [
    { type: "scatter3d", mode: "markers", name: "front", x: D.map(d => d.fbw), y: D.map(d => d.il), z: D.map(d => d.tau), text: D.map(d => d.label),
      marker: { size: 3, color: D.map(d => d.tau), colorscale: [[0, "#a9cdd3"], [1, INK]] } },
    { type: "scatter3d", mode: "markers", name: "selected", x: [s.fbw], y: [s.il], z: [s.tau], marker: { size: 7, color: CORAL, symbol: "diamond" } },
  ], { margin: { l: 0, r: 0, t: 0, b: 0 }, font: { family: getComputedStyle(document.body).fontFamily },
    scene: { xaxis: { title: { text: "FBW (%)" } }, yaxis: { title: { text: "IL (dB)" } }, zaxis: { title: { text: "τ−20 (µs)" } } } },
  { displaylogo: false, responsive: true });
}
async function paretoFront() {
  PAR.designs = PAR.name === "session" ? OPT.designs : (await getJSON("/api/front", { name: PAR.name })).designs;
  $("#par-cap").textContent = `Pairwise projections of the ${PAR.designs.length} non-dominated designs. The diamond is the selected design; hover a point for its configuration.`;
  await paretoSelect();
}
function pareto() {
  const names = [...(OPT?.kind === "pareto" && OPT.designs.length ? ["session"] : []), ...META.fronts];
  if (!names.length) {
    main.innerHTML = `<p class="muted">No fronts are stored. Run experiments/run_all.py exp10 exp11, or an NSGA-II run under <a href="#optimise">Optimisation</a>.</p>`;
    return;
  }
  if (!names.includes(PAR.name)) PAR.name = names[0];
  main.innerHTML = `<div class="row" style="max-width:720px"><div><label for="par-name">Front</label><select id="par-name">${names.map(n => `<option value="${esc(n)}"${n === PAR.name ? " selected" : ""}>${esc(frontName(n))}</option>`).join("")}</select></div>
      <div><div class="rangehead"><label for="par-margin">Selection rule: IL within this margin of the front minimum</label><output>${PAR.margin.toFixed(1)} dB</output></div>
      <input type="range" id="par-margin" min="0" max="15" step="0.5" value="${PAR.margin}"></div></div>
    <div class="err" role="alert"></div>
    <p id="par-sel" style="margin-top:16px;max-width:90ch"></p>
    <figure class="fig"><div class="cols3"><div class="plot" id="par-0" style="height:300px"></div><div class="plot" id="par-1" style="height:300px"></div><div class="plot" id="par-2" style="height:300px"></div></div>
      <figcaption id="par-cap"></figcaption></figure>
    <div class="actions"><button class="primary" id="par-load">Load the selected design</button></div>
    <details id="par-3d-box"><summary>Three-objective view</summary><div class="plot" id="par-3d" style="height:520px"></div></details>`;
  const fail = e => { $(".err").innerHTML = `<p class="alert">${esc(e.message)}</p>`; };
  $("#par-name").onchange = e => { PAR.name = e.target.value; paretoFront().catch(fail); };
  $("#par-margin").oninput = e => { PAR.margin = +e.target.value; e.target.previousElementSibling.lastElementChild.textContent = PAR.margin.toFixed(1) + " dB"; paretoSelect().catch(fail); };
  $("#par-3d-box").ontoggle = e => { if (e.target.open && PAR.designs.length) plot3d(); };
  $("#par-load").onclick = () => PAR.designs.length && loadDesign(PAR.designs[PAR.k].state);
  paretoFront().catch(fail);
}

// ------------------------------------------------------------------ robustness
const ROB = { vary_load: true, n: 250, seed: 1, mc: null, sobol: null, out: "fc_mhz",
  spec: { plate_thickness: 1, layer_thickness: 5, c33d: 5, eps33s: 10, kt: 3, qm: 20, layer_z: 5, backing_z: 5 } };
const TOL = [["plate_thickness", "Plate thickness", 5], ["layer_thickness", "Layer thickness", 15], ["c33d", "Stiffness c<sub>33</sub><sup>D</sup>", 10], ["eps33s", "Permittivity", 20],
  ["kt", "Coupling k<sub>t</sub>", 10], ["qm", "Q<sub>m</sub> (log)", 50], ["layer_z", "Layer impedance", 15], ["backing_z", "Backing impedance", 15]];
const robPayload = () => ({ state: S, vary_load: ROB.vary_load, n: ROB.n, seed: ROB.seed, spec: Object.fromEntries(Object.entries(ROB.spec).map(([k, v]) => [k, v / 100])) });

function robResults() {
  const mc = ROB.mc, el = $("#rob-mc");
  if (!el) return;
  if (!mc) el.innerHTML = `<p class="muted">No Monte Carlo run yet for this session.</p>`;
  else {
    el.innerHTML = `<dl class="readout" style="grid-template-columns:1fr"><div><dt>Yield: centre frequency within ±${num(mc.tolerance_pct)} % of target, over ${mc.n} simulated copies</dt><dd>${fix(mc.yield_pct, 1)}<small>%</small></dd></div></dl>
      <figure class="fig"><div class="cols3">${Object.keys(mc.samples).map(k => `<div class="plot" id="rob-${k}" style="height:270px"></div>`).join("")}</div>
      <figcaption>Distributions over ${mc.n} simulated copies. The vertical line is the nominal design.</figcaption></figure>
      ${table(mc.summary.map(r => ({ ...r, output: LABELS[r.output] ?? r.output })), [{ k: "output", label: "Output" }, { k: "nominal", label: "Nominal" }, { k: "mean", label: "Mean" }, { k: "std", label: "Std. dev." },
        { k: "p05", label: "5th pct." }, { k: "p95", label: "95th pct." }, { k: "ci95_mean_low", label: "Mean 95 % CI, low" }, { k: "ci95_mean_high", label: "high" }])}`;
    for (const [k, v] of Object.entries(mc.samples)) plot("rob-" + k, [{ type: "histogram", x: v, nbinsx: 40, marker: { color: TEAL } }], {
      bargap: 0.05, xaxis: ax(LABELS[k]), yaxis: ax("Samples"),
      shapes: [{ type: "line", yref: "paper", y0: 0, y1: 1, x0: mc.nominal[k], x1: mc.nominal[k], line: { color: CORAL, width: 2 } }] });
  }
  const sb = $("#rob-sobol");
  if (!ROB.sobol) { sb.innerHTML = ""; return; }
  const outs = [...new Set(ROB.sobol.map(r => r.output))];
  if (!outs.includes(ROB.out)) ROB.out = outs[0];
  sb.innerHTML = `<div style="max-width:320px"><label for="rob-out">Output</label><select id="rob-out">${outs.map(o => `<option value="${esc(o)}"${o === ROB.out ? " selected" : ""}>${esc(LABELS[o] ?? o)}</option>`).join("")}</select></div>
    ${fig("rob-bars", "Share of output variance attributed to each tolerance (Saltelli sampling; 95 % intervals shown on the total-order index).", 400)}`;
  $("#rob-out").onchange = e => { ROB.out = e.target.value; robResults(); };
  const rows = ROB.sobol.filter(r => r.output === ROB.out).sort((a, b) => a.ST - b.ST);
  plot("rob-bars", [
    { type: "bar", orientation: "h", name: "total-order", y: rows.map(r => r.parameter), x: rows.map(r => r.ST), marker: { color: INK }, error_x: { array: rows.map(r => r.ST_conf), color: SLATE, thickness: 1 } },
    { type: "bar", orientation: "h", name: "first-order", y: rows.map(r => r.parameter), x: rows.map(r => r.S1), marker: { color: TEAL } },
  ], { barmode: "group", xaxis: ax("Sobol index"), yaxis: {} });
}

function robustness() {
  main.innerHTML = `<p class="note">Applies to the design currently loaded. Standard deviations are relative to the nominal value.</p>
    <form id="rob" autocomplete="off" onsubmit="return false"><div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      ${TOL.map(([k, label, max]) => `<div><div class="rangehead"><label for="t-${k}">${label}</label><output>${ROB.spec[k].toFixed(1)} %</output></div>
        <input type="range" id="t-${k}" data-k="${k}" min="0" max="${max}" step="0.5" value="${ROB.spec[k]}"></div>`).join("")}</div>
      <div class="row" style="max-width:720px;margin-top:8px">
        <div><label for="rob-n">Monte Carlo samples</label><select id="rob-n">${[100, 250, 500, 1000, 2000].map(n => `<option${n === ROB.n ? " selected" : ""}>${n}</option>`).join("")}</select></div>
        <div><label for="rob-seed">Seed</label><input type="number" id="rob-seed" min="0" max="10000" value="${ROB.seed}"></div>
        <label class="check" style="height:34px"><input type="checkbox" id="rob-load" ${ROB.vary_load ? "checked" : ""}>Vary tissue load, 1.38 to 1.66 MRayl</label></div>
      <div class="actions"><button class="primary" id="rob-run">Run Monte Carlo</button><button id="rob-sob">Compute Sobol indices</button><span class="note">Sobol indices take 3 to 10 s.</span></div></form>
    <div class="err" role="alert"></div><div id="rob-mc"></div><div id="rob-sobol"></div>
    ${META.robust_vs_nominal.length ? `<h2>Nominal versus robust optimisation</h2>${tab("Stored result of Experiment 14.", table(META.robust_vs_nominal))}` : ""}`;
  $("#rob").oninput = e => {
    const el = e.target;
    if (el.dataset.k) { ROB.spec[el.dataset.k] = +el.value; el.previousElementSibling.lastElementChild.textContent = (+el.value).toFixed(1) + " %"; }
    ROB.n = +$("#rob-n").value; ROB.seed = +$("#rob-seed").value || 0; ROB.vary_load = $("#rob-load").checked;
  };
  $("#rob-run").onclick = e => busy(e.target, "Sampling…", async () => { ROB.mc = await getJSON("/api/montecarlo", robPayload()); robResults(); });
  $("#rob-sob").onclick = e => busy(e.target, "Computing…", async () => { ROB.sobol = (await getJSON("/api/sobol", robPayload())).rows; robResults(); });
  robResults();
}

// ------------------------------------------------------------------ application designs
let APPS = null;
async function applications() {
  main.innerHTML = `<div class="err" role="alert"></div><div id="apps"><p class="muted">Simulating the stored designs…</p></div>`;
  try { APPS = APPS || (await getJSON("/api/applications")).designs; } catch (e) { $(".err").innerHTML = `<p class="alert">${esc(e.message)}</p>`; return; }
  const el = $("#apps");
  if (!el) return;
  if (!APPS.length) { el.innerHTML = `<p class="muted">No stored designs. Run experiments/run_all.py exp10 exp11 to produce them.</p>`; return; }
  el.innerHTML = tab("Selected from the NSGA-II fronts by a stated rule per application (Experiment 11). Insertion loss is idealised; the last column repeats it with worst-case layer attenuation.", table(META.recommended, [
        { k: "application", label: "Application" }, { k: "priority", label: "Priority" }, { k: "f_target_MHz", label: "Target (MHz)" },
        { k: "piezo", label: "Piezoelectric" }, { k: "tuning", label: "Tuning" },
        { k: "FBW6_pe_pct", label: "FBW (%)", fmt: v => fix(v, 1) }, { k: "IL2_dB", label: "IL (dB)", fmt: v => fix(v, 2) },
        { k: "tau20_cycles", label: "Pulse (cycles)", fmt: v => fix(v, 1) }, { k: "stress_IL2_dB", label: "IL, lossy layers (dB)", fmt: v => fix(v, 2) }]))
    + fig("apps-h", "Pulse-echo responses of the recommended designs on a frequency axis normalised to each target.", 400)
    + `<div class="actions">${APPS.map((a, i) => `<button data-app="${i}">Load the ${esc(a.name.toLowerCase())} design</button>`).join("")}</div>`
    + (META.transfer.length ? `<h2>Each design at the other applications' frequencies</h2>${table(META.transfer)}` : "");
  plot("apps-h", APPS.map(a => lineTrace(a.x, a.y, a.name)), { xaxis: ax("f / f<sub>target</sub>", { range: [0, 2.5] }), yaxis: ax("|H<sub>pe</sub>| (dB re peak)", { range: [-40, 2] }) });
  $$("[data-app]").forEach(b => b.onclick = () => loadDesign(APPS[+b.dataset.app].state));
}

// ------------------------------------------------------------------ export
function saveBlob(blob, name) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportView() {
  const group = (title, items) => `<div><h2>${title}</h2><div class="actions" style="flex-direction:column;align-items:flex-start">
    ${items.map(([k, t]) => `<button data-kind="${k}">${t}</button>`).join("")}</div></div>`;
  main.innerHTML = `<p class="note">Everything here refers to the design currently loaded: ${esc(SIM.piezo_name)}, ${fix(SIM.headline.fc, 2)} MHz.</p>
    <div class="err" role="alert"></div><div class="cols">
    ${group("Data", [["metrics", "Metrics (CSV)"], ["response", "Frequency response (CSV)"], ["design", "Design configuration (JSON)"],
      ...(OPT?.designs.length ? [["optimised", "Optimised configurations (CSV)"]] : [])])}
    ${group("Figures", [["fig:impedance", "Impedance (PNG)"], ["fig:response", "Frequency response (PNG)"], ["fig:pulse", "Pulse (PNG)"]])}
    ${group("Report", [["pdf", "Build the PDF report"]])}</div>
    <h2>Experiment records</h2>
    ${table(META.experiments, null, "No experiment records. Run experiments/run_all.py to produce them.")}`;
  $$("[data-kind]").forEach(b => b.onclick = () => busy(b, "Preparing…", async () => {
    const kind = b.dataset.kind;
    if (kind === "optimised") {
      const q = s => `"${String(s).replace(/"/g, '""')}"`;
      return saveBlob(new Blob(["FBW6_pct,IL2_dB,tau20_us,design\n" + OPT.designs.map(d => [d.fbw, d.il ?? "", d.tau ?? "", q(d.label)].join(",")).join("\n")], { type: "text/csv" }), "optimised.csv");
    }
    const r = await api("/api/export", { state: S, kind });
    saveBlob(await r.blob(), /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? kind);
  }));
}

// ------------------------------------------------------------------ routing
// The pages in the order of a design study: inputs, design, search, choice, check, compare, report.
const STEPS = [
  { id: "materials", title: "Materials", render: materials, blurb: "Browse the ceramics and layer materials, where every value comes from, and which data are missing.",
    lede: "Every simulation starts from measured material constants. Browse the piezoelectric ceramics and the passive layer materials, see the source of each value, and check which data are missing.",
    how: ["Pick a category and a material to see each property with its source.", "Compare the piezoelectric materials side by side and plot any constant.",
      "Check the data gaps: a missing value is either derived by a named rule or the material is excluded."] },
  { id: "workbench", title: "Design and simulate", render: workbench, blurb: "Build a transducer layer by layer; impedance, bandwidth and pulse update as you drag.",
    lede: "Build a transducer layer by layer and see how it behaves. Every change re-runs the full KLM model in about 10 ms, so the figures follow as you drag.",
    how: ["Choose an application preset: it sets the design frequency and the aperture.", "Set the ceramic and its thickness, the matching layers, the backing and the electrical port.",
      "Read the result: the headline numbers first, then the frequency responses and the pulse."] },
  { id: "optimise", title: "Optimisation", render: optimise, blurb: "Let the NSGA-II algorithm search the twelve design variables and map the trade-off.",
    lede: "Instead of tuning by hand, let NSGA-II, a multi-objective genetic algorithm, search the twelve design variables: ceramic, plate thickness, up to three matching layers, backing and tuning. It returns the whole trade-off, not a single answer.",
    how: ["Pick the application and the constraints: how far the centre frequency may drift and how much passband ripple is allowed.",
      "Set the budget: population × generations model runs, about 1 ms each.", "Run it, then load any design from the table, or choose one from the front in the next step."] },
  { id: "pareto", title: "Pareto analysis", render: pareto, blurb: "Choose a design from the trade-off between bandwidth, sensitivity and pulse length.",
    lede: "There is no single best transducer: wider bandwidth costs sensitivity, and a shorter pulse costs both. The Pareto front holds every design that cannot improve one goal without losing another.",
    how: ["Pick a stored front, or the one from your own optimisation run.", "Move the selection rule: how much insertion loss you accept in exchange for bandwidth.",
      "Load the selected design to inspect it, then test its robustness."] },
  { id: "robustness", title: "Robustness", render: robustness, blurb: "Simulate manufactured copies of the design and see how many still meet the target.",
    lede: "A design that works on paper may not survive manufacturing. Simulate hundreds of slightly different copies of the loaded design and see how many still meet the target.",
    how: ["Set how much each quantity varies: thicknesses, material constants and the tissue load.", "Run Monte Carlo to see the spread of performance and the yield.",
      "Compute Sobol indices to find the tolerance that matters most."] },
  { id: "applications", title: "Application designs", render: applications, blurb: "Compare with the study's recommended designs for three clinical uses.",
    lede: "The study's answer for three clinical uses: abdominal, general soft-tissue and superficial imaging. Each design was chosen from its own Pareto front by a stated priority.",
    how: ["Compare the recommended designs in the table and their responses in the figure.", "Load one into the designer to explore or modify it.",
      "Check the lossy-layer column: it shows the cost if matching-layer attenuation is worse than assumed."] },
  { id: "export", title: "Export", render: exportView, blurb: "Download the data, the figures or a complete PDF report of the loaded design.",
    lede: "Take the loaded design and its results out of the app: data for your own analysis, figures for a report, or a complete PDF.",
    how: ["Data: metrics, the full frequency response and the design configuration.", "Figures: impedance, frequency response and pulse, as PNG.",
      "Report: a multi-page PDF with every metric and figure."] },
];
const HOME = { id: "home", title: "Home", render: home };

function intro(v, i) {
  return `<header class="intro"><h1>${v.title}</h1><p class="lede">${v.lede}</p>
    <ol class="howto" aria-label="How to use this page">${v.how.map(t => `<li>${t}</li>`).join("")}</ol></header>`;
}
function pager(i) {
  const prev = i > 0 ? STEPS[i - 1] : HOME, next = STEPS[i + 1];
  return `<nav class="pager" aria-label="Workflow">
    <a href="#${prev.id}"><small>Previous</small>← ${prev.title}</a>
    <span class="muted">Step ${i + 1} of ${STEPS.length}</span>
    ${next ? `<a class="next" href="#${next.id}"><small>Next step</small>${next.title} →</a>` : `<a class="next" href="#home"><small>Done</small>Back to home →</a>`}</nav>`;
}

function route() {
  const id = location.hash.slice(1), i = STEPS.findIndex(v => v.id === id), v = i < 0 ? HOME : STEPS[i];
  $$("#nav a").forEach(a => a.getAttribute("href") === "#" + v.id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  document.title = `${v.title} · Transducer design`;
  $("#main").innerHTML = (i < 0 ? "" : intro(v, i)) + `<div id="view"></div>` + (i < 0 ? "" : pager(i));
  main = $("#view");
  window.scrollTo(0, 0);
  v.render();
}

(async () => {
  try { META = await getJSON("/api/meta"); } catch (e) { main.innerHTML = `<p class="alert">${esc(e.message)}</p>`; return; }
  $("#disclaimer").textContent = `ustx ${META.version}. ${META.disclaimer}`;
  $("#nav").innerHTML = `<li><a href="#home">Home</a></li>` + STEPS.map((v, i) => `<li><a href="#${v.id}"><span class="num">${i + 1}</span>${v.title}</a></li>`).join("");
  try { S = JSON.parse(localStorage.getItem("ustx.design")); } catch { /* storage unavailable or corrupt */ }
  if (!S) S = structuredClone(META.default_state);
  await simulate();
  if (SIMERR) { S = structuredClone(META.default_state); await simulate(); }  // a stale saved design must not block the app
  if (SIMERR) { main.innerHTML = `<p class="alert">${esc(SIMERR)}</p>`; return; }
  window.addEventListener("hashchange", route);
  route();
})();
