# Health Connect & Biometrics Dashboard for Obsidian

Turn daily-note health metrics into charts in desktop Obsidian. Start with your own Markdown data, then optionally connect Google Health cloud data or ingest Apple Health JSON exports.

**Beta · desktop only · MIT.** The manifest declares Obsidian 0.15.0 as its minimum; that is not a tested compatibility guarantee.

**[Install with BRAT](#installation)** · **[Try the account-free demo](docs/TRY-THE-DASHBOARD.md)** · **[Get setup help](SUPPORT.md)**

---

![Readiness & Health Dashboard Preview](assets/dashboard-preview.png)

---

## Which project should I use?

Use Health Connect for health-specific daily-note charts, field mappings, food logging, and the supported ingestion paths below. Omni-Logger is a broader source-and-parser framework covering other telemetry and capture workflows. The projects overlap on health ingestion; configure only one writer for a given daily-note metric to avoid competing updates. This does not imply either project has been superseded.

## ✨ Features

- **⚡ Automated & Manual Tracking**: Chart manually tracked daily-note metrics, connect Google Health cloud data, or ingest prepared Apple Health JSON exports. Cloud availability depends on the account and granted access.
- **📊 Responsive Visual Dashboard**: Embed ````health-dashboard```` anywhere in your vault to render interactive KPI cards, rolling averages, total intake calculations, tooltips, and smooth zero-dependency SVG sparklines, multi-line trends, and grouped bar charts matching your theme.
- **📝 Supported Data Formats**: The dashboard parses data from **YAML frontmatter (`Key: Value`)**, **inline Dataview fields (`Key:: Value`, `- [ ] Key:: Value`)**, and **bullet lists (`- Key: Value`)**.
- **🧮 Custom Calculated Metrics**: Define new metrics using spreadsheet-style mathematical formulas combining existing variables (e.g. `(protein * 4) + (carbs * 4) + (fat * 9)` or `(HRV / 60) * (Sleep_hours / 8) * 100`) with an optional toggle to write results back to your daily note frontmatter.
- **🏋️ Smart Workout Parsing**: Automatically parses exercise sessions (e.g. `Strength Training (8m), Strength Training (14m)`) into aggregated durations, chartable minutes, and detailed hover tooltips.
- **🥗 Food & Beverage Quick Logger**: Built-in visual logger with custom servings, presets, and local registry management that posts nutrition records directly to Google Health API and keeps your daily frontmatter synchronized.
- **🔒 Data handling**: Notes and charts live in your vault. Optional cloud sync sends requests to Google; your vault sync provider may also transmit notes, exports, and plugin settings. See the privacy notes below.
- **🗺️ Fully Configurable Field Mappings**: Map incoming biometrics to any custom YAML frontmatter or inline property names in your vault.

---

## 🔄 How Syncing Works

Choose a data path explicitly:

| Path | Implementation and limits |
| --- | --- |
| Manual daily notes | Reads YAML, inline fields, and bullet properties for local charts; no Google account required. |
| Google Health cloud | Uses Google OAuth and `health.googleapis.com`. Available data depends on the account, device data reaching that service, scopes, and API responses. This is not direct Android Health Connect access. |
| Apple Health JSON | Reads prepared exports in a vault folder on desktop. Requires a separate Shortcut/export workflow; no direct HealthKit connection. |
| Android Health Connect | No direct on-device reader is included. Do not assume every connected wearable uploads compatible cloud data. |
| Mobile Obsidian | Disabled by the current desktop-only manifest. |

Cloud nutrition writes are implemented but need account-specific verification. Source inspection does not establish successful end-to-end sync for every metric or device.

### Privacy and credentials

The plugin attempts to use Obsidian SecretStorage for credentials. If unavailable or unsuccessful, it saves full settings, including credentials and tokens, in the plugin's local `data.json`. Keep that file out of public repositories and support attachments. Review what your vault backup/sync service copies.

Apple JSON ingestion writes to the date identified by the export or filename, falling back to today. Archiving is configurable. Supply normalized daily values: the importer does not convert units, and repeated numeric metrics are summed, including metrics such as HRV that should not normally be added. Prepare one daily value per metric for the flat JSON path.

---

<a id="installation"></a>
## 📦 Installation via BRAT (Beta Testing)

1. Install the **[BRAT (Obsidian42 - BRAT)](https://github.com/TfTHacker/obsidian42-brat)** plugin from Obsidian Community Plugins.
2. In Obsidian Settings, go to **BRAT > Add Beta plugin**.
3. Enter the repository URL:
   ```text
   https://github.com/jare0014/obsidian-health-connect
   ```
4. Click **Add Plugin**, then enable **Health Connect & Biometrics Dashboard** under **Installed Plugins**.

---

## 🚀 Quick Setup Guide

Try the [account-free dashboard walkthrough](docs/TRY-THE-DASHBOARD.md) first. For optional cloud sync, follow [Google's current setup instructions](https://developers.google.com/health/setup) and [scope documentation](https://developers.google.com/health/scopes). Setup time and access depend on your project and account:

### Part 1: Create GCP Project & Enable Health API
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown at top-left → **New Project** → Name it `Obsidian-Health` → Click **Create**.
3. Go to **APIs & Services > Library**, search for **Google Health API** (v4 REST API), and click **Enable**.

### Part 2: Configure OAuth Consent Screen & Scopes
1. Go to **APIs & Services > OAuth consent screen**.
2. Select **Audience / User Type: External** → Click **Create / Next**.
3. Enter an App Name (e.g. `Obsidian Health Connect`) and your email for Developer & Support contact.
4. Under **Scopes**, click **Add or Remove Scopes** and enable:
   - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
   - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
   - `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
   - `https://www.googleapis.com/auth/googlehealth.nutrition.readonly`
   - `https://www.googleapis.com/auth/googlehealth.nutrition.writeonly`
5. Under **Test users**, click **+ Add Users** and enter your personal Gmail address.  
   *Google documents seven-day refresh-token expiry for external apps in Testing using these scopes. Publishing does not guarantee permanent tokens; tokens can expire or be revoked. See [Google OAuth documentation](https://developers.google.com/identity/protocols/oauth2#expiration).*

### Part 3: Create OAuth Client ID & Connect
1. Go to **APIs & Services > Credentials** → Click **+ Create Credentials > OAuth client ID**.
2. Application type: **Web application**.
3. Name: `Obsidian Client`.
4. Authorized redirect URIs: `http://localhost:8092`.
5. Click **Create** → Click **Download JSON** (or copy the Client ID and Client Secret).
6. Open **Obsidian Settings > Health Connect & Readiness**, paste the Client ID/Secret or the full downloaded JSON into the box, and click **Connect Google Account**.
7. Approve the permissions in your browser. The status badge will switch to `🟢 Connected`!

---

## 📊 Dashboard Usage

Add this codeblock anywhere in your Daily Notes, Weekly Reviews, or Health Dashboard note:

````markdown
```health-dashboard
```
````

### Custom Date Ranges & Options
You can override rolling windows or filter specific date ranges:

````markdown
```health-dashboard
days: 30
excludeWeekends: true
```
````

Or filter with exact start/end dates:

````markdown
```health-dashboard
from: 2026-08-01
to: 2026-08-19
```
````

---

## 🥗 Food & Beverage Logger

- **Quick Modal Access**: Open via ribbon icon 🍎 or command palette: `Health Connect: Quick Log Food / Beverage`.
- **Item Presets & Servings**: Select an item (e.g. *Americano*, *Espresso*, *Water*, *Protein Shake*) and adjust quantity.
- **Google Health API Sync**: Clicking **Log to Google Health** writes the nutrition event directly to the Google Health v4 REST API and updates your active daily note frontmatter in real time.
- **Custom Food Registry**: Manage custom items, calories, protein, caffeine, and volume presets in the **Manage Registry** tab.

---

## 🧮 Custom Calculated Metrics (Formula Builder)

Want to create composite health scores or compute macro calories from separate fields? Use the built-in **Formula Builder** in settings:

- **Spreadsheet-Style Math**: Write standard arithmetic formulas (e.g., `(protein * 4) + (carbs * 4) + (fat * 9)` or `(HRV / 60) * (Sleep_hours / 8) * 100`).
- **Clickable Variable Chips**: Quick-insert detected variables into your formula.
- **Frontmatter Writeback**:
  - *Display Only*: Calculated on the fly when rendering the ````health-dashboard```` codeblock.
  - *Write to Note*: Automatically saved into your daily note frontmatter during sync!

---

## 🍏 Apple Health & iOS Shortcuts Ingestion

If you track your health, nutrition, or workouts on an **iPhone or Apple Watch**, you can automatically sync your daily Apple Health data into Obsidian via **Apple Shortcuts** and cloud sync (iCloud Drive, Obsidian Sync, Google Drive, or OneDrive):

1. In plugin settings, turn on **Enable Apple Health Ingestion**.
2. Specify your drop folder (e.g. `00_Imports/Health`).
3. In the iOS **Shortcuts app** on your iPhone:
   - Create a Shortcut querying daily samples: *Dietary Protein, Dietary Energy, Steps, Sleep Analysis, HRV, Water*.
   - Combine them into a JSON dictionary:
     ```json
     {
       "date": "2026-08-23",
       "protein": 140,
       "calories": 2200,
       "steps": 10500,
       "hydration": 80,
       "Sleep_hours": 7.8,
       "HRV": 65
     }
     ```
   - Save the file as `Health_YYYY-MM-DD.json` into your synced drop folder.
   - Set an iOS Automation to run nightly at 11:59 PM.
4. When Obsidian opens or syncs the file, the plugin automatically parses the metrics, updates the daily note selected by the export date, and attempts to archive the JSON file when auto-archive is enabled. Check the target note and archive before deleting your source export.

## ⌨️ Command Palette Actions

Open the Obsidian Command Palette (`Ctrl/Cmd + P`) to trigger any of the following actions:

| Command | Description |
| :--- | :--- |
| **`Health Connect: Sync Today's Google Health Biometrics`** | Immediately syncs today's sleep, HRV, steps, and workouts into today's daily note. |
| **`Health Connect: Backfill & Sync Last 14 Days Biometrics`** | Queries the past 14 days from Google Health API and backfills missing historical daily notes. |
| **`Health Connect: Quick Log Food / Beverage`** | Opens the visual food logger modal to log meals, caffeine, hydration, or custom macros. |
| **`Health Connect: Scan & Ingest Apple Health Drop Folder (JSON)`** | Manually scans your configured drop folder for any pending Apple Health JSON drops. |

---

## ☕ Support the Project

If this plugin helps you maintain healthy habits and quantified-self insights, consider supporting future development:

[![Buy Me a Coffee](https://img.shields.io/badge/Donate-Buy%20Me%20A%20Coffee-yellow.svg?style=for-the-badge)](https://buymeacoffee.com/jare0014)

---

## 📄 License

MIT License © 2026 Alex Jarecki
