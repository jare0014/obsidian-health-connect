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

- [x] Scaffold standalone TypeScript project with `esbuild`, `@types/obsidian`, and strict TS config (Completed: 2026-08-18)
- [x] Implement Google OAuth 2.0 Auth Service & Token Refresh manager (Completed: 2026-08-18)
- [x] Implement Google Health REST API fetchers for Sleep, RMSSD HRV, Readiness, Caffeine/Alcohol mg, and Hydration (Completed: 2026-08-18)
- [x] Implement Daily Note frontmatter writer for automated biometric property syncing (Completed: 2026-08-18)
- [x] Implement lightweight zero-dependency SVG sparkline and area trend charts (Completed: 2026-08-18)
- [x] Implement ````health-dashboard```` codeblock processor with responsive KPI cards and trend indicators (Completed: 2026-08-18)
- [x] Build Settings tab with OAuth setup wizard, field key mappings, and Buy Me a Coffee donation banner (Completed: 2026-08-18)
- [ ] Create marketplace release screenshots and submit to Obsidian Community Plugins registry
