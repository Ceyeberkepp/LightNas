(async function demoServer() {
  "use strict";
  const { createServer } = await import("node:http");
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const assets = new Map([
    ["/", [join(here, "index.html"), "text/html; charset=utf-8"]],
    ["/index.html", [join(here, "index.html"), "text/html; charset=utf-8"]],
    ["/demo.css", [join(here, "styles.css"), "text/css; charset=utf-8"]],
    ["/demo.js", [join(here, "app.js"), "application/javascript; charset=utf-8"]],
    ["/logo.png", [resolve(here, "../public/assets/lightnas-logo.png"), "image/png"]]
  ]);
  const host = process.env.LIGHTNAS_DEMO_HOST || "127.0.0.1";
  const port = Number(process.env.LIGHTNAS_DEMO_PORT || 3081);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error("LIGHTNAS_DEMO_PORT must be a valid TCP port");
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; connect-src 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'");
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" });
      res.end("Method not allowed"); return;
    }
    let pathname;
    try { pathname = new URL(req.url, "http://localhost").pathname; }
    catch { res.writeHead(400); res.end(); return; }
    if (pathname === "/healthz") {
      const payload = '{"status":"ok","mode":"simulated-demo"}';
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : payload); return;
    }
    const asset = assets.get(pathname);
    if (!asset) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Not found"); return; }
    try {
      const body = await readFile(asset[0]);
      res.writeHead(200, { "Content-Type": asset[1], "Content-Length": body.length });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Demo asset unavailable");
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 7000;
  server.listen(port, host, () => {
    const address = server.address();
    process.stdout.write(`LightNAS demo listening on http://${host}:${address.port}\n`);
  });
})();