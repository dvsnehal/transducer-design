"use strict";
// Browser build only (github.io): runs the ustx engine in Pyodide instead of calling the Python server.
// app.js calls window.USTX_PY(path, body) in place of fetch(); the answer is a normal Response.
(() => {
  const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
  const say = (text) => {
    const m = document.getElementById("main");
    if (m && !m.querySelector("#view")) m.innerHTML = `<p class="muted">${text}</p>`;
  };
  const ready = (async () => {
    say("Starting the simulation engine in your browser. The first visit downloads about 40 MB and takes 20 to 60 seconds; later visits are faster.");
    const py = await loadPyodide({ indexURL: PYODIDE });
    await py.loadPackage(["numpy", "scipy", "pandas", "matplotlib", "micropip"]);
    say("Loading the transducer model and the material database…");
    const zip = await (await fetch("ustx_bundle.zip")).arrayBuffer();
    py.unpackArchive(zip, "zip", { extractDir: "/home/pyodide/proj" });
    await py.runPythonAsync(`
import sys
sys.path[:0] = ["/home/pyodide/proj/src", "/home/pyodide/proj/vendor"]
import micropip
await micropip.install("alive-progress==3.3.0")
await micropip.install("SALib==1.6.0", deps=False)
`);
    return py.pyimport("ustx.application.server").handle;
  })();
  ready.catch((e) => say(`The simulation engine could not start in this browser: ${e.message}. Try a recent Chrome, Edge, Firefox or Safari.`));

  window.USTX_PY = async (path, body) => {
    const handle = await ready;
    // shortcut: Python runs on the page's main thread, so the page pauses during long runs; move it to a Web Worker if that matters
    await new Promise((r) => setTimeout(r, 30));  // let the button show its busy label first
    const out = handle(path.split("?")[0], body === undefined ? null : JSON.stringify(body));
    const [status, bytes, mime, filename] = out.toJs();
    out.destroy();
    const headers = { "Content-Type": mime };
    if (filename) headers["Content-Disposition"] = `attachment; filename="${filename}"`;
    return new Response(bytes, { status, headers });
  };
})();
