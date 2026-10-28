# LightNAS application redesign — acceptance and QA

**Status:** In progress. This file is a completion gate, not a claim of visual parity.

## Approved direction

- Keep the original LightNAS logo and green/charcoal identity; use an Apple-inspired, clean, compact control-panel layout without copying Apple assets.
- Respect the available viewport width **and height**; avoid oversized cards, headings, inputs, and fixed-width panels.
- Preserve every existing NAS workflow, permission check, API call, and navigation route.
- Keep the background Tasks dock fixed at the bottom of the **main workspace only**, never underneath the sidebar.
- Keep Overview focused on system health, CPU/load/memory/network graphs, compute and recent activity. Storage capacity belongs on Storage.
- All desktop and mobile pages must work without hidden controls, clipped dialogs, horizontal page overflow, or inaccessible tabs.

## Page and sub-tab verification matrix

No row is complete until it has been checked visually **and** functionally on a running LightNAS installation. CSS presence or a merged PR does not count as verification.

| Area | Screens / workflows to verify | Status |
| --- | --- | --- |
| Overview | System status, live graph tabs, compute inventory, recent activity, task dock | Not verified |
| Storage | Storage inventory, add/manage storage, storage operations, capacity states | Not verified |
| Pools & datasets | Pool list, dataset actions, properties, dialogs | Not verified |
| Files & media | All files, Documents, Photos, Videos, Audio, Folders, list/grid/gallery, settings | Not verified |
| File operations | Upload/select all, multi-file progress, folder upload, delete, previews, phone sync | Not verified |
| Shares | SMB/SFTP list, create/edit, permissions, addresses | Not verified |
| Backups | Jobs, schedules, selection, status, restore, logs | Not verified |
| App Store | Search/category, app cards, install, multiple instances, progress | Not verified |
| AI | Chat composer, long responses, mobile keyboard, tool panels, settings | Not verified |
| Containers | Inventory, actions, details, console, network controls | Not verified |
| Kubernetes | Overview, cluster management, workload tabs | Not verified |
| Virtual machines | Inventory, actions, configuration, console | Not verified |
| Networking | Interfaces, bridges, VLANs, bonds, routes, DNS, edit forms | Not verified |
| Firewall | Rules, actions, safety confirmations | Not verified |
| Integrations | Providers, connection states, setup and automation forms | Not verified |
| Admin Center | General, Users & groups, Permissions, Email/SMTP, Settings & security | Not verified |
| Admin Center advanced | Analytics, Capabilities, Integrations, Migration Center | Not verified |
| Shell | Terminal sizing, mobile access, keyboard focus | Not verified |
| Global dialogs | Validation, scrolling, close/cancel, focus, destructive-action confirmations | Not verified |
| Global navigation | Sidebar expanded/collapsed, page search, breadcrumbs, keyboard, mobile menu | Not verified |
| Mobile | Files/media gallery, bulk photo upload, background tasks, AI chat, every accessible view | Not verified |

Hypervisor-only edition work is outside the current NAS-only redesign scope.

## Required responsive matrix

Check at least **320×568, 390×844, 430×932, 768×1024, 1024×768, 1280×720, 1366×768, 1696×864, and 1920×1080**. Also check mobile landscape and both light/dark themes. Compare the approved dashboard mockup to the live dashboard at equivalent browser zoom and viewport.

## Verification gates

1. Run npm test, npm run check:platform, and node --check for modified JavaScript modules.
2. Confirm no failing required GitHub checks and no unresolved merge conflicts.
3. Verify navigation and action permissions with both administrator and restricted accounts.
4. Test real user flows (including uploads, create/delete dialogs, backup controls and App Store actions) on a safe staging instance, not just static markup.
5. Verify keyboard navigation, focus visibility, labels, empty/loading/error states and scroll containment.
6. Capture and review screenshots for **each** page and sub-tab at desktop and mobile widths. Fix all material differences from the approved design.
7. Recheck bottom task dock positioning with expanded and collapsed sidebar and during background transfers.
8. Mark the redesign complete only when all relevant rows above are verified; otherwise continue iterative PRs.

## Work completed so far

- PRs #372–#376 introduced dashboard composition, compact shell sizing and scoped per-page styling.
- PR #377 adds a functional navigation search and consistent SVG icons, plus targeted rules for actual Files & media, App Store, Users, Admin Center, Settings, Networking and Backups markup.
- **Browser-level verification remains outstanding**. The running user's private LAN instance cannot be reached from GitHub source access alone.

## Continuation: management editors

- Standard `showEditor` dialogs now use a header, scrolling field area and action footer. Mobile controls use 44px minimum heights; media viewers and VM hardware editors keep their specialized layouts.
- Editors expose their title and description to assistive technology, focus submission errors, and restore loaded input/select values when Revert is pressed.
- Validation against baseline `8cbde18018e643e2a78fe247e32010fb0efb14e2`: platform contract passes; JavaScript syntax passes; 11 focused workspace-navigation, workspace-page, VM-settings and user-management tests pass.
- The unchanged baseline full suite reports 618 tests: 528 pass, 89 fail, 1 skipped. These failures were recorded before this continuation's edits; the suite is not green.
- Local staging starts successfully. Browser verification is blocked because this workspace has no Chromium executable and the browser download returned an invalid archive. No matrix row is promoted to verified by these checks.
