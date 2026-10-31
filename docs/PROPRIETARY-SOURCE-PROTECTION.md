# LightNAS proprietary-source access and release protections

## Current status (October 2026)

**The LightNAS source repository is public.** The LICENSE limits authorized
activities, but GitHub visitors can currently read, clone, and copy the
published backend and browser source. The license and browser-side obfuscation
are not technical access controls. Changes in repository visibility cannot
revoke copies or prevent already-public forks from remaining public.

## Actual source-access control (repository owner action)

To restrict future access to the main source repository:

1. Plan the transition to a **private GitHub repository** and audit team,
   collaborator, bot, deploy-key, workflow, and Actions access.
2. Prepare a **separate public download and update channel** before switching
   visibility: the current install.sh clones the public Git repository, README
   links raw public install.sh, and some installation/update flows run git pull.
   Making this repository private without replacing those paths breaks access
   for users without repository credentials.
3. Publish release artifacts through a separate, trusted distribution service,
   not by exposing private source or handing customer machines broad GitHub
   credentials. Sign releases, provide per-architecture hashes, and validate
   signed update metadata before privileged installation. Keep the safe
   deployment/update and rollback gates in the NAS update plan.
4. Use minimal, release-specific packaged backend assets; omit source maps,
   development fixtures, internal tests, repository metadata, credentials and
   build-only files. Assess bundling or executables for backend code **after**
   compatibility, upgrade, and crash-recovery tests; packaging makes casual
   browsing harder but cannot make code unextractable.
5. Keep the public interactive demo independent from the private backend.
   Frontend JavaScript, HTML and CSS sent to any browser remain inspectable
   and must not contain secrets or trust-enforcement logic.
6. Once user downloads, demo deploys, CI, and signed updates are verified,
   the GitHub repository owner changes visibility using Settings > General >
   Danger Zone > Change repository visibility > Private and reviews the GitHub
   warning. Recheck access from an unauthenticated session.

## Appliance HTTP protections

The browser static file service is restricted to a canonical approved asset
root and refuses hidden paths, source maps and symlink escapes. This protects
against accidental disclosure through the appliance's HTTP server, **not**
public source already published on GitHub. The client-facing JS must remain
accessible so the browser can function.

Never assume minification, JavaScript obfuscation, disabling DevTools,
robots.txt, a right-click blocker or an HTTP header protects proprietary code.
Keep credentials server-side, enforce authorization on privileged endpoints,
and avoid source maps in release artifacts.

This is a technical deployment plan, not a change to licensing terms or a
claim that repository privacy or proprietary release packaging is complete.
