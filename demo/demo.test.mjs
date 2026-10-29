(async function demoTests() {
  "use strict";
  const { test, after, before } = await import("node:test");
  const assert = (await import("node:assert/strict")).default;
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const { readFile } = await import("node:fs/promises");
  const here = dirname(fileURLToPath(import.meta.url));
  let child, base;
  before(async () => {
    child = spawn(process.execPath, [join(here, "server.mjs")], {
      env: { ...process.env, LIGHTNAS_DEMO_HOST: "127.0.0.1", LIGHTNAS_DEMO_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("Demo server did not start")), 8000);
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      child.on("error", (error) => { clearTimeout(timeout); reject(error); });
      child.on("exit", (code) => { clearTimeout(timeout); reject(Error(`Demo process exited early: ${code}`)); });
    });
  });
  after(() => { if (child && child.exitCode === null) child.kill(); });
  test("Demo homepage serves branded, clearly labelled simulated UI", async () => {
    const response = await fetch(base + "/");
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /LIGHTNAS DEMO/);
    assert.match(body, /No real hardware/);
    assert.match(body, /Users & groups/);
    assert.match(body, /Backups/);
  });
  test("Demo script is served without a live backend", async () => {
    const response = await fetch(base + "/demo.js");
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /javascript/);
    assert.match(body, /sessionStorage/);
    assert.doesNotMatch(body, /\bfetch\s*\(/);
  });
  test("Server only exposes allowlisted static assets and health", async () => {
    assert.equal((await fetch(base + "/healthz")).status, 200);
    assert.equal((await fetch(base + "/logo.png")).status, 200);
    assert.equal((await fetch(base + "/api/system")).status, 404);
    assert.equal((await fetch(base + "/src/server.mjs")).status, 404);
    assert.equal((await fetch(base + "/../data/state.json")).status, 404);
  });
  test("Server refuses all mutation methods", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await fetch(base + "/", { method });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("allow"), "GET, HEAD");
    }
  });
  test("Browser isolation security headers are present", async () => {
    const response = await fetch(base + "/");
    assert.match(response.headers.get("content-security-policy"), /connect-src 'none'/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
  test("Demo source uses only sample documentation addresses", async () => {
    const app = await readFile(join(here, "app.js"), "utf8");
    assert.match(app, /192\.0\.2\.10/);
    assert.doesNotMatch(app, /localStorage|XMLHttpRequest|WebSocket/);
  });
})();