(function demoApp() {
  "use strict";
  const STORAGE_KEY = "lightnas:interactive-demo:v1";
  const $ = (selector) => document.querySelector(selector);
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const initial = () => ({
    theme: "dark",
    nextId: 20,
    folder: "",
    files: [
      { id: 1, parent: "", name: "Documents", folder: true, size: "—", date: "Today" },
      { id: 2, parent: "", name: "Photos", folder: true, size: "—", date: "Today" },
      { id: 3, parent: "", name: "Videos", folder: true, size: "—", date: "Yesterday" },
      { id: 4, parent: "", name: "Shared Projects", folder: true, size: "—", date: "Yesterday" },
      { id: 5, parent: "Documents", name: "Welcome to LightNAS.txt", folder: false, size: "2 KB", date: "Today" },
      { id: 6, parent: "Documents", name: "Q4 Sample Report.pdf", folder: false, size: "1.4 MB", date: "Yesterday" },
      { id: 7, parent: "Documents", name: "Installation Guide.pdf", folder: false, size: "640 KB", date: "Oct 24" },
      { id: 8, parent: "Photos", name: "Holiday Album", folder: true, size: "—", date: "Oct 23" },
      { id: 9, parent: "Photos", name: "IMG_0042.jpg", folder: false, size: "3.1 MB", date: "Oct 23" },
      { id: 10, parent: "Videos", name: "lightnas-tour.mp4", folder: false, size: "84 MB", date: "Oct 20" },
      { id: 11, parent: "Shared Projects", name: "Product Roadmap.pdf", folder: false, size: "2.8 MB", date: "Oct 20" },
      { id: 12, parent: "Photos/Holiday Album", name: "Beach Sunset.jpg", folder: false, size: "4.6 MB", date: "Oct 23" }
    ],
    users: [
      { id: 1, name: "demo-admin", role: "Administrator", status: "Active" },
      { id: 2, name: "alex", role: "Standard user", status: "Active" },
      { id: 3, name: "maria", role: "Standard user", status: "Active" }
    ],
    installed: ["Uptime Kuma"],
    backups: [{ id: 1, name: "Daily NAS Backup", destination: "Backup Vault", schedule: "Every day · 2:00 AM", status: "Healthy", last: "Today · 2:00 AM" }, { id: 2, name: "Photo Library", destination: "Remote Archive", schedule: "Every Sunday", status: "Healthy", last: "Oct 25 · 3:00 AM" }],
    tasks: []
  });
  let state;
  try {
    const cached = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    state = cached && Array.isArray(cached.files) && Array.isArray(cached.users) && Array.isArray(cached.tasks) && Array.isArray(cached.installed) && Array.isArray(cached.backups) ? cached : initial();
  } catch { state = initial(); }
  const save = () => { try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} };
  const names = { overview: "Overview", files: "Files & media", storage: "Storage & pools", backups: "Backups", apps: "App Store", users: "Users & groups", network: "Networking", system: "System settings" };
  const catalog = [
    { name: "Jellyfin", category: "Media", icon: "▶", description: "Organize and stream your personal media library." },
    { name: "Immich", category: "Photos", icon: "✿", description: "Back up and browse your sample photo collection." },
    { name: "Nextcloud", category: "Productivity", icon: "☁", description: "Private file sharing and collaboration." },
    { name: "Uptime Kuma", category: "Monitoring", icon: "◈", description: "Track the uptime of your services." },
    { name: "Home Assistant", category: "Automation", icon: "⌂", description: "Manage smart-home automations in one place." },
    { name: "Paperless-ngx", category: "Productivity", icon: "▤", description: "Organize and search scanned documents." }
  ];
  let currentPage = "overview";
  let appFilter = "";
  let modalAction = "";
  let taskDockOpen = false;
  let toastTimer;
  const status = (value, variant = "") => `<span class="status-chip ${variant}">${escapeHTML(value)}</span>`;
  const pageHeader = (title, subtitle, action = "") => `<div class="page-head"><div><div class="eyebrow">LightNAS · Interactive demo</div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(subtitle)}</p></div><div class="actions">${action}</div></div>`;
  const card = (title, body) => `<section class="card"><h2>${title}</h2>${body}</section>`;
  const metric = (title, value, note, bar = null) => `<article class="card"><div class="stat-caption">${title}</div><div class="stat-value">${value}</div>${bar === null ? "" : `<div class="progress"><span style="width:${bar}%"></span></div>`}<div class="stat-bottom">${note}</div></article>`;
  const rows = (items) => `<div class="list">${items.join("")}</div>`;
  const listItem = (icon, name, desc, right) => `<div class="list-item"><span class="item-icon">${icon}</span><div class="item-main"><b>${name}</b><small>${desc}</small></div><div class="item-end">${right}</div></div>`;
  const sampleNote = `<p class="sample-footnote">All measurements, inventory, jobs, and status information on this site are illustrative—not live NAS telemetry.</p>`;
  const table = (headers, body) => `<div class="table-wrap"><table class="table"><thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
  const action = (type, label, style = "secondary", attrs = "") => `<button class="button ${style}" data-action="${type}" ${attrs}>${label}</button>`;
  function overview() {
    const bars = [21, 27, 33, 23, 30, 45, 36, 28, 34, 24, 31, 18, 29, 37, 23, 30, 27, 18, 24, 21, 32, 26, 20, 17].map((h) => `<span style="height:${h + 18}%"></span>`).join("");
    return pageHeader("Your NAS at a glance", "A guided preview of the LightNAS control center.", `<a href="#apps" class="button primary">Explore App Store</a>`)
      + `<div class="callout"><span>ⓘ</span><div><strong>Welcome to your private-cloud demo</strong><p>Explore the sidebar and try sample actions. Changes only affect this browser session; they cannot access disks, servers, or real accounts.</p></div></div>`
      + `<div class="grid cols-4">${metric("System health", `<span class="success">Healthy</span>`, "All sample services operational")}${metric("CPU utilization", "18%", "Illustrative live-style metric", 18)}${metric("Memory", "6.2 / 16 GB", "39% of sample capacity", 39)}${metric("Network", "1.2 Gb/s", "Example uplink activity")}</div>`
      + `<div class="two-columns" style="margin-top:16px"><section class="card"><div class="section-row"><h2>Performance overview</h2><span class="status-chip">Sample activity</span></div><div class="metric-title"><span class="stat-caption">CPU activity · recent sample</span><b>18%</b></div><div class="metric-bars">${bars}</div><div class="kv"><span>Appliance uptime</span><strong>14 days, 8 hours</strong></div><div class="kv"><span>Processor</span><strong>8 logical cores</strong></div><div class="kv"><span>System temperature</span><strong>42°C</strong></div></section>`
      + `<section class="card"><div class="section-row"><h2>Storage overview</h2><a href="#storage">Explore storage</a></div><div class="stat-value">12 TiB <small>usable sample capacity</small></div><div class="progress"><span style="width:39%"></span></div><div class="kv"><span>Used</span><strong>4.7 TiB</strong></div><div class="kv"><span>Available</span><strong>7.3 TiB</strong></div><div class="kv"><span>Pool state</span>${status("Healthy")}</div></section></div>`
      + `<div class="grid cols-3" style="margin-top:16px">${card("Recent activity", rows([listItem("↶", "Scheduled backup completed", "Today at 2:00 AM", status("Success")), listItem("▤", "Files indexed", "Yesterday at 6:41 PM", "64 files"), listItem("✦", "App catalog updated", "Oct 26", "6 sample apps")]))}${card("Apps", rows([listItem("✦", "Installed sample apps", "Try installing an app", `<b>${state.installed.length}</b>`), listItem("◈", "Monitoring", "Example service status", status("Online"))]) + `<p style="margin:16px 0 0"><a href="#apps" class="button secondary">Browse apps</a></p>`)}${card("Backup protection", rows([listItem("↶", "Daily NAS Backup", "Next: tomorrow 2:00 AM", status("Healthy")), listItem("▣", "Photo Library", "Next: Sunday", status("Healthy"))]) + `<p style="margin:16px 0 0"><a href="#backups" class="button secondary">View backup jobs</a></p>`)}</div>${sampleNote}`;
  }
  function files() {
    const folder = state.folder || "All files";
    const entries = state.files.filter((f) => f.parent === state.folder).slice().sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
    const tr = entries.map((f) => `<tr><td><span class="title-with-icon"><span class="drive-icon">${f.folder ? "📁" : "📄"}</span><b>${escapeHTML(f.name)}</b></span></td><td>${f.folder ? "Folder" : "File"}</td><td>${escapeHTML(f.size)}</td><td>${escapeHTML(f.date)}</td><td>${f.folder ? action("open-folder", "Open", "quiet", `data-id="${f.id}"`) : action("preview-file", "Preview", "quiet", `data-id="${f.id}"`)}</td></tr>`).join("");
    return pageHeader("Files & media", "Browse a sample file library and create temporary demo folders.", `${action("new-folder", "+ New folder", "primary")} ${action("upload-info", "Upload files")}`)
      + `<div class="callout"><span>▤</span><div><strong>Try the file manager safely</strong><p>Sample folders can be opened or created. Uploads and downloads to real storage are intentionally unavailable in this public demo.</p></div></div>`
      + `<section class="card"><div class="section-row"><h2>${escapeHTML(folder)}</h2>${state.folder ? action("folder-up", "← Back") : `<span class="muted">Demo Library</span>`}</div>${table(["Name", "Type", "Size", "Modified", "Actions"], tr || `<tr><td colspan="5"><div class="empty">This demo folder is empty. Use “New folder” to try organizing it.</div></td></tr>`)}</section>${sampleNote}`;
  }
  function storage() {
    const drives = [
      ["Disk 01", "SATA 4 TB", "Serial DEMO-0001", "Healthy"],
      ["Disk 02", "SATA 4 TB", "Serial DEMO-0002", "Healthy"],
      ["Disk 03", "SATA 4 TB", "Serial DEMO-0003", "Healthy"],
      ["Disk 04", "SATA 4 TB", "Serial DEMO-0004", "Healthy"]
    ];
    return pageHeader("Storage & pools", "Example storage inventory with clear protection boundaries.", action("storage-info", "Create pool", "primary"))
      + `<div class="callout"><span>🔒</span><div><strong>Hardware operations are disabled</strong><p>No disks are attached to this demo. Detection, formatting, pool creation, deletion, and provisioning never access real hardware.</p></div></div>`
      + `<div class="grid cols-3">${metric("Sample disks", "4", "Illustrative inventory only")}${metric("Sample pool capacity", "12 TiB", "4.7 TiB used", 39)}${metric("Drive health", `<span class="success">4 / 4</span>`, "All sample disks healthy")}</div>`
      + `<section class="card" style="margin-top:16px"><div class="section-row"><h2>Pool inventory</h2>${status("Healthy")}</div>${table(["Pool", "Layout", "Capacity", "Usage", "Health"], `<tr><td><b>tank</b><small style="display:block">Example primary storage</small></td><td>RAIDZ1 · sample</td><td>12 TiB</td><td>4.7 TiB / 12 TiB</td><td>${status("Online")}</td></tr>`)}</section>`
      + `<section class="card" style="margin-top:16px"><div class="section-row"><h2>Detected drives</h2><span class="muted">Sample devices only</span></div>${table(["Drive", "Model", "Identification", "Condition"], drives.map((d) => `<tr><td><b>${d[0]}</b></td><td>${d[1]}</td><td class="code">${d[2]}</td><td>${status(d[3])}</td></tr>`).join(""))}</section>${sampleNote}`;
  }
  function backups() {
    const tr = state.backups.map((b) => `<tr><td><b>${escapeHTML(b.name)}</b></td><td>${escapeHTML(b.destination)}</td><td>${escapeHTML(b.schedule)}</td><td>${escapeHTML(b.last)}</td><td>${status(b.status)}</td><td>${action("run-backup", "Run now", "secondary", `data-id="${b.id}"`)}</td></tr>`).join("");
    return pageHeader("Backups", "Explore scheduled backups and simulate a manual backup.", action("new-backup", "+ Create backup", "primary"))
      + `<div class="callout"><span>ⓘ</span><div><strong>Backup simulations only</strong><p>Running a backup here updates an example task. It never copies, modifies, or transmits any real data.</p></div></div>`
      + `<div class="grid cols-3">${metric("Backup jobs", String(state.backups.length), "Sample schedules")}${metric("Last successful run", "Today", "02:00 AM · demo record")}${metric("Protection status", `<span class="success">Healthy</span>`, "No outstanding sample failures")}</div>`
      + `<section class="card" style="margin-top:16px"><div class="section-row"><h2>Backup jobs</h2>${status("All healthy")}</div>${table(["Backup name", "Destination", "Schedule", "Last run", "Status", "Action"], tr)}</section>${sampleNote}`;
  }
  function renderCatalogCards() {
    const filtered = catalog.filter((app) => [app.name, app.category, app.description].join(" ").toLowerCase().includes(appFilter.toLowerCase()));
    return filtered.length ? filtered.map((app) => `<article class="card catalog-card"><div class="catalog-icon">${app.icon}</div><div><h2>${escapeHTML(app.name)}</h2><small>${escapeHTML(app.category)}</small></div><p>${escapeHTML(app.description)}</p>${state.installed.includes(app.name) ? status("Installed in demo") : action("install-app", "Install (simulate)", "primary", `data-name="${escapeHTML(app.name)}"`)}</article>`).join("") : `<div class="empty">No sample apps match your search.</div>`;
  }
  function apps() {
    return pageHeader("App Store", "Experience one-click app installation with a simulated catalog.")
      + `<div class="callout"><span>✦</span><div><strong>Sample app catalog</strong><p>These are demonstration entries, not a statement of verified production compatibility. “Install” simulates a task without pulling images or launching containers.</p></div></div>`
      + `<div class="filter-row"><label for="app-filter" class="muted">Search apps</label><input id="app-filter" type="search" placeholder="Search sample apps…" value="${escapeHTML(appFilter)}" autocomplete="off"></div>`
      + `<div id="app-grid" class="grid cols-3">${renderCatalogCards()}</div>${sampleNote}`;
  }
  function users() {
    const tr = state.users.map((u) => `<tr><td><b>${escapeHTML(u.name)}</b></td><td>${escapeHTML(u.role)}</td><td>${status(u.status, u.status === "Disabled" ? "slate" : "")}</td><td>${u.name === "demo-admin" ? `<span class="muted">Protected sample admin</span>` : action("toggle-user", u.status === "Active" ? "Disable" : "Enable", "secondary", `data-id="${u.id}"`)}</td></tr>`).join("");
    return pageHeader("Users & groups", "Review example access controls and try temporary account changes.", action("new-user", "+ Add user", "primary"))
      + `<div class="callout"><span>♙</span><div><strong>Demo identities, not real accounts</strong><p>Creating or disabling a sample user only changes this browser session. No passwords, email addresses, or real credentials are collected.</p></div></div>`
      + `<div class="grid cols-3">${metric("Sample users", String(state.users.length), "One protected sample administrator")}${metric("Active users", String(state.users.filter((u) => u.status === "Active").length), "Illustrative account statuses")}${metric("Sample groups", "3", "Administrators · Staff · Guests")}</div>`
      + `<section class="card" style="margin-top:16px"><div class="section-row"><h2>Users</h2><span class="muted">Demo directory</span></div>${table(["Username", "Role", "Status", "Actions"], tr)}</section>`
      + `<section class="card" style="margin-top:16px"><h2>Groups & permissions</h2>${rows([listItem("♙", "Administrators", "Full demo administration", "1 user"), listItem("♧", "Staff", "Standard file access", "2 users"), listItem("♧", "Guests", "Read-only demo role", "0 users")])}</section>${sampleNote}`;
  }
  function network() {
    return pageHeader("Networking", "See how an appliance network dashboard is organized.")
      + `<div class="callout"><span>🔒</span><div><strong>Read-only sample network</strong><p>IP addresses use documentation-only ranges. Network configuration, firewall changes, and remote access are disabled in this demo.</p></div></div>`
      + `<div class="grid cols-3">${metric("Active connections", "1", "Example wired interface")}${metric("Link speed", "1 Gb/s", "Example interface capability")}${metric("Firewall", `<span class="success">Enabled</span>`, "Illustrative state")}</div>`
      + `<div class="grid cols-2" style="margin-top:16px">${card("Primary connection", `<div class="kv"><span>Interface</span><strong>enp3s0</strong></div><div class="kv"><span>IPv4 address</span><strong class="code">192.0.2.10/24</strong></div><div class="kv"><span>Gateway</span><strong class="code">192.0.2.1</strong></div><div class="kv"><span>DNS</span><strong class="code">192.0.2.53</strong></div><div class="kv"><span>Connection</span>${status("Connected")}</div>`)}${card("Network services", rows([listItem("▥", "SMB file sharing", "Example service", status("Enabled")), listItem("⌁", "NFS", "Example service", status("Enabled")), listItem("◇", "Firewall", "Example policy", status("Active"))]))}</div>${sampleNote}`;
  }
  function system() {
    return pageHeader("System settings", "Explore a sample appliance configuration.")
      + `<div class="callout"><span>ⓘ</span><div><strong>Configuration preview</strong><p>These values are illustrative. Host settings, device identity, security configuration, and OS updates cannot be modified here.</p></div></div>`
      + `<div class="grid cols-2">${card("Appliance", `<div class="kv"><span>Device name</span><strong>lightnas-demo</strong></div><div class="kv"><span>Edition</span><strong>LightNAS NAS</strong></div><div class="kv"><span>Platform</span><strong>Sample Linux host</strong></div><div class="kv"><span>Time zone</span><strong>America/New_York</strong></div>`)}${card("Security", rows([listItem("◈", "Session access", "Local sample state", status("Isolated")), listItem("🔒", "Physical device access", "No host agents connected", status("Disabled", "slate")), listItem("↶", "Reset", "Restore the sample environment", action("reset-demo", "Reset demo"))]))}</div>${sampleNote}`;
  }
  const views = { overview, files, storage, backups, apps, users, network, system };
  function setMobileMenu(open) {
    $("#sidebar").classList.toggle("show", Boolean(open));
    $("#mobile-backdrop").classList.toggle("show", Boolean(open));
    $("#mobile-backdrop").hidden = !open;
    $("#menu-toggle").setAttribute("aria-expanded", open ? "true" : "false");
  }
  function render() {
    currentPage = names[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
    $("#top-page").textContent = names[currentPage];
    document.title = `LightNAS Demo — ${names[currentPage]}`;
    $("#content").innerHTML = views[currentPage]();
    document.querySelectorAll("[data-page]").forEach((link) => link.classList.toggle("active", link.dataset.page === currentPage));
    document.documentElement.dataset.theme = state.theme === "light" ? "light" : "dark";
    $("#theme-toggle").textContent = state.theme === "light" ? "☀" : "◐";
    renderTasks();
    save();
  }
  function renderTasks() {
    const active = state.tasks.filter((t) => t.status === "Running").length;
    $("#task-count").textContent = String(active);
    $("#task-summary").textContent = active ? `${active} simulated task${active === 1 ? "" : "s"} running` : state.tasks.length ? `${state.tasks.length} recent demo task${state.tasks.length === 1 ? "" : "s"}` : "No active tasks";
    $(".task-dock").classList.toggle("open", taskDockOpen);
    $("#task-toggle").setAttribute("aria-expanded", taskDockOpen ? "true" : "false");
    $("#task-body").hidden = !taskDockOpen;
    $("#task-list").innerHTML = state.tasks.length ? state.tasks.slice().reverse().map((t) => `<div class="task-list-row"><span><b>${escapeHTML(t.label)}</b><br><small>Simulation only · ${escapeHTML(t.when)}</small></span>${status(t.status, t.status === "Running" ? "amber" : "")}</div>`).join("") : `<div class="empty">Simulated app installations and backup runs appear here.</div>`;
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").hidden = false;
    toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 4100);
  }
  function resetDemo() {
    state = initial();
    appFilter = "";
    save();
    render();
    toast("Demo reset. All sample data has been restored.");
  }
  function runTask(label, onComplete = () => {}) {
    const id = ++state.nextId;
    state.tasks.push({ id, label, when: "just now", status: "Running" });
    taskDockOpen = true;
    renderTasks(); save();
    setTimeout(() => {
      const task = state.tasks.find((t) => t.id === id);
      if (!task) return;
      task.status = "Completed";
      onComplete();
      render();
      toast(`${label} completed (simulation).`);
    }, 1400);
  }
  function showDialog(mode) {
    modalAction = mode;
    const config = mode === "new-folder" ? ["Create sample folder", "Creates a folder only in your demo session.", "Folder name", "Create folder"] : mode === "new-user" ? ["Add sample user", "No real account or password will be created.", "Username (letters, numbers, dashes)", "Add user"] : ["Create sample backup", "This only adds a demonstration backup job.", "Job name", "Create backup"];
    $("#dialog-title").textContent = config[0];
    $("#dialog-desc").textContent = config[1];
    $("#dialog-label").textContent = config[2];
    $("#dialog-submit").textContent = config[3];
    $("#dialog-input").value = "";
    $("#dialog-error").hidden = true;
    $("#demo-dialog").showModal();
    $("#dialog-input").focus();
  }
  $("#demo-form").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "confirm") return;
    event.preventDefault();
    const name = $("#dialog-input").value.trim();
    const invalid = !name || name.length > 50 || /[\\/:*?"<>|]/.test(name);
    const duplicate = modalAction === "new-folder" ? state.files.some((f) => f.parent === state.folder && f.name.toLowerCase() === name.toLowerCase()) : modalAction === "new-user" ? state.users.some((u) => u.name.toLowerCase() === name.toLowerCase()) : state.backups.some((b) => b.name.toLowerCase() === name.toLowerCase());
    if (invalid || duplicate || (modalAction === "new-user" && !/^[a-zA-Z][a-zA-Z0-9_-]{1,31}$/.test(name))) {
      $("#dialog-error").textContent = duplicate ? "That sample name already exists." : "Use a valid unique name (no path characters).";
      $("#dialog-error").hidden = false; return;
    }
    const id = ++state.nextId;
    if (modalAction === "new-folder") state.files.push({ id, parent: state.folder, name, folder: true, size: "—", date: "Just now" });
    else if (modalAction === "new-user") state.users.push({ id, name, role: "Standard user", status: "Active" });
    else state.backups.push({ id, name, destination: "Sample Backup Vault", schedule: "Manual", status: "Healthy", last: "Never" });
    $("#demo-dialog").close(); render(); toast(`Sample ${modalAction === "new-folder" ? "folder" : modalAction === "new-user" ? "user" : "backup job"} created.`);
  });
  $("#demo-form").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.id === "dialog-input") {
      event.preventDefault(); $("#dialog-submit").click();
    }
  });
  function handleAction(button) {
    const name = button.dataset.action;
    if (["new-folder", "new-user", "new-backup"].includes(name)) return showDialog(name);
    if (name === "reset-demo") return resetDemo();
    if (name === "upload-info") return toast("Uploads are disabled in the public demo to keep your data private.");
    if (name === "storage-info") return toast("Pool creation is disabled: no real disks are connected.");
    if (name === "folder-up") { state.folder = state.folder.includes("/") ? state.folder.split("/").slice(0, -1).join("/") : ""; render(); return; }
    if (name === "open-folder") {
      const f = state.files.find((x) => x.id === Number(button.dataset.id));
      if (!f || !f.folder) return;
      state.folder = [f.parent, f.name].filter(Boolean).join("/"); render(); return;
    }
    if (name === "preview-file") return toast("File preview is represented by a sample entry; no actual document is stored.");
    if (name === "toggle-user") {
      const u = state.users.find((x) => x.id === Number(button.dataset.id));
      if (!u || u.name === "demo-admin") return;
      u.status = u.status === "Active" ? "Disabled" : "Active";
      render(); toast(`Sample user ${u.name} is now ${u.status.toLowerCase()}.`); return;
    }
    if (name === "install-app") {
      const app = catalog.find((x) => x.name === button.dataset.name);
      if (!app || state.installed.includes(app.name) || state.tasks.some((t) => t.label === `Install ${app.name}` && t.status === "Running")) return;
      runTask(`Install ${app.name}`, () => { if (!state.installed.includes(app.name)) state.installed.push(app.name); }); return;
    }
    if (name === "run-backup") {
      const b = state.backups.find((x) => x.id === Number(button.dataset.id));
      if (!b) return;
      runTask(`Backup ${b.name}`, () => { b.last = "Just now (simulated)"; b.status = "Healthy"; }); return;
    }
  }
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (target) handleAction(target);
    if (event.target.closest("[data-page]")) setMobileMenu(false);
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "app-filter") { appFilter = event.target.value.slice(0, 70); $("#app-grid").innerHTML = renderCatalogCards(); }
  });
  window.addEventListener("hashchange", () => { render(); window.scrollTo({ top: 0 }); });
  $("#reset-demo").addEventListener("click", resetDemo);
  $("#theme-toggle").addEventListener("click", () => { state.theme = state.theme === "dark" ? "light" : "dark"; render(); });
  $("#menu-toggle").addEventListener("click", () => setMobileMenu(true));
  $("#close-menu").addEventListener("click", () => setMobileMenu(false));
  $("#mobile-backdrop").addEventListener("click", () => setMobileMenu(false));
  $("#task-toggle").addEventListener("click", () => { taskDockOpen = !taskDockOpen; renderTasks(); });
  $("#clear-tasks").addEventListener("click", () => { state.tasks = state.tasks.filter((t) => t.status === "Running"); renderTasks(); save(); });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") setMobileMenu(false); });
  // Tasks restored after a refresh cannot continue; mark them as ended simulations.
  state.tasks.forEach((t) => { if (t.status === "Running") t.status = "Completed"; });
  render();
})();