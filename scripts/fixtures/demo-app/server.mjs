// A tiny product to test against (D-084): a contacts page and its REST API, in memory, no dependencies. `make e2e`
// (scripts/e2e.mjs) starts it on a free local port. One contact exists before any test runs ("Pre Existing", id 1),
// so a guard that lets a test delete pre-existing data is caught.
//   GET  /contacts                the page: a table of contacts with a Delete button each, and a New contact form
//   GET  /api/contacts            [{id, name}]
//   POST /api/contacts {name}     201 {id, name}
//   GET  /api/contacts/:id        200 {id, name} | 404
//   DELETE /api/contacts/:id      204 | 404
import http from "node:http";

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Contacts</title></head>
<body>
<h1>Contacts</h1>
<form id="new"><label>Name <input name="name" required></label> <button type="submit">Save</button></form>
<table><thead><tr><th>Name</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table>
<p role="status" id="status"></p>
<script>
const status = (t) => (document.getElementById("status").textContent = t);
async function load() {
  const list = await (await fetch("/api/contacts")).json();
  document.getElementById("rows").innerHTML = list.map((c) => '<tr><td>' + c.name + '</td><td><button data-id="' + c.id + '" aria-label="Delete ' + c.name + '">Delete</button></td></tr>').join("");
  for (const b of document.querySelectorAll("button[data-id]"))
    b.onclick = async () => {
      try {
        const r = await fetch("/api/contacts/" + b.dataset.id, { method: "DELETE" });
        status(r.ok ? "Deleted" : "Delete failed: " + r.status);
      } catch {
        status("Delete failed");
      }
      load();
    };
}
document.getElementById("new").onsubmit = async (e) => {
  e.preventDefault();
  const name = new FormData(e.target).get("name");
  try {
    const r = await fetch("/api/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    status(r.ok ? "Saved" : "Save failed: " + r.status);
  } catch {
    status("Save failed");
  }
  e.target.reset();
  load();
};
load();
</script>
</body></html>`;

export function startDemoApp({ port = 0, host = "127.0.0.1" } = {}) {
  const contacts = new Map([[1, { id: 1, name: "Pre Existing" }]]);
  let next = 2;
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://demo");
    const one = /^\/api\/contacts\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/contacts")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    if (url.pathname === "/api/contacts" && req.method === "GET") return json(res, 200, [...contacts.values()]);
    if (url.pathname === "/api/contacts" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let name;
        try {
          name = String(JSON.parse(body || "{}").name ?? "").trim();
        } catch {}
        if (!name) return json(res, 400, { error: "name is required" });
        const c = { id: next++, name };
        contacts.set(c.id, c);
        json(res, 201, c);
      });
      return;
    }
    if (one && req.method === "GET") return contacts.has(+one[1]) ? json(res, 200, contacts.get(+one[1])) : json(res, 404, { error: "not found" });
    if (one && req.method === "DELETE") return contacts.delete(+one[1]) ? json(res, 204) : json(res, 404, { error: "not found" });
    json(res, 404, { error: "not found" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const { port: actual } = server.address();
      resolve({ url: `http://${host}:${actual}`, contacts: () => [...contacts.values()], close: () => new Promise((r) => server.close(r)) });
    });
  });
}
