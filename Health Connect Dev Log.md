---
status: 🟢 Active
type: LifeOS / Marketplace Plugin
repo: obsidian-health-connect
---

## Health Connect & Readiness Dashboard Dev Log

### Project Purpose
Standalone TypeScript Obsidian Community Plugin syncing Google Health / Fitbit biometrics (Sleep, HRV, Readiness, Hydration, Caffeine/Alcohol) directly into Daily Note frontmatter and rendering responsive ````health-dashboard```` visualizations.

## Dev Log History
```dataviewjs
const current = dv.current();
if (!current || !current.file) return;
const currentFileName = current.file.name;

const cleanName = currentFileName
    .replace(/dev log/i, "")
    .replace(/project/i, "")
    .trim()
    .toLowerCase();

const slugName = cleanName.replace(/[^a-z0-9]+/g, "-");
let candidates = new Set([cleanName, slugName, "obsidian-health-connect", "health-connect-readiness"]);

if (current.repo) {
    const repos = Array.isArray(current.repo) ? current.repo : [current.repo];
    for (const r of repos) {
        if (r) {
            candidates.add(r.trim().toLowerCase());
            candidates.add(r.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"));
        }
    }
}

const candidateList = Array.from(candidates);
const pages = dv.pages('"02_Journal/01_Daily"').sort(p => p.file.name, "desc");
const rows = [];

for (const p of pages) {
    const logs = [];
    const devLogs = [].concat(p.Dev_Log || []).concat(p.Log || []);
    for (const dl of devLogs) {
        if (!dl) continue;
        const dlStr = String(dl);
        if (candidateList.some(cand => dlStr.toLowerCase().includes(cand)) && !logs.includes(dlStr)) {
            logs.push(dlStr);
        }
    }
    if (logs.length > 0) {
        rows.push([p.file.link, logs.join("<br>")]);
    }
}

dv.table(["Date", "Notes"], rows);
```

## ToDo
- [ ] Execute fresh GCP setup and end-to-end verification checklist per [[TESTING_AND_RELEASE_PLAN]] (disable Omni-Logger health sync, authorize new OAuth client, verify sleep/HRV/steps/nutrition sync, and test dashboard preview & date overrides) (Added: 2026-08-18)
- [ ] Clean up README with visual feature showcases, screenshots, and usage demo recordings (Added: 2026-08-18)
- [ ] Run independent code and architecture review bot before final public release (Added: 2026-08-18)
- [ ] Push to GitHub (`jare0014/obsidian-health-connect`), draft `v1.0.0` release, and submit to Obsidian Community Plugins / BRAT beta testing (Added: 2026-08-18)

- [x] Test standalone health-connect-readiness plugin spin-off (GCP v4 API sync, Meta Bind buttons, food logger, and readiness dashboard) (Completed: 2026-08-18)
- [x] Scaffold standalone TypeScript project with `esbuild`, `@types/obsidian`, and strict TS config (Completed: 2026-08-18)
- [x] Implement Google OAuth 2.0 Auth Service & Token Refresh manager (Completed: 2026-08-18)
- [x] Implement Google Health REST API fetchers for Sleep, RMSSD HRV, Readiness, Caffeine/Alcohol mg, and Hydration (Completed: 2026-08-18)
- [x] Implement Daily Note frontmatter writer for automated biometric property syncing (Completed: 2026-08-18)
- [x] Implement lightweight zero-dependency SVG sparkline and area trend charts (Completed: 2026-08-18)
- [x] Implement ````health-dashboard```` codeblock processor with responsive KPI cards, date overrides, and live settings preview (Completed: 2026-08-18)
- [x] Build Settings tab with OAuth setup wizard, metric mapping sync definitions, and Buy Me a Coffee donation banner (Completed: 2026-08-18)
