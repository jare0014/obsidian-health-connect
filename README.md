# Health Connect & Readiness Dashboard for Obsidian

A sleek, privacy-first Obsidian plugin that automatically syncs **Sleep, HRV, Readiness, Activity, Hydration, and Nutrition** from **Google Health & Fitbit** directly into your Daily Note frontmatter and renders responsive ````health-dashboard```` visualizations.

[![BRAT Beta](https://img.shields.io/badge/BRAT-Ready-brightgreen.svg)](https://github.com/TfTHacker/obsidian42-brat)
[![Obsidian Community](https://img.shields.io/badge/Obsidian-Community%20Plugin-purple.svg)](https://obsidian.md)
[![Buy Me a Coffee](https://img.shields.io/badge/Donate-Buy%20Me%20A%20Coffee-yellow.svg)](https://buymeacoffee.com/alexjarecki)

---

## ✨ Features

- **⚡ Automated Biometric Sync**: Pulls Sleep duration (`Sleep_hours`), Wakeup time (`wake_up`), Heart Rate Variability (`HRV`), Steps (`steps`), Active Minutes (`active_minutes`), calculated Readiness Index, and Nutrition into Daily Notes with one click.
- **🍎 Food & Beverage Quick Logger**: Built-in visual logger (with custom servings, presets, and template support) that writes nutrition data back to Google Health and updates your cumulative daily frontmatter (`caffeine`, `calories`, `protein`).
- **📊 Responsive Visual Dashboard**: Embed \`\`\`health-dashboard\`\`\` anywhere in your vault to get interactive KPI cards, rolling 14-day averages, percent trend indicators (▲/▼), and smooth SVG sparkline charts matching your Obsidian theme.
- **🔘 Meta Bind Button Integration**: Register 1-click sync and modal buttons (`BUTTON[health-sync-biometrics-btn]`, `BUTTON[health-food-logger-btn]`) directly in your Daily Note templates.
- **🔒 100% Local & Private**: Connects directly from your machine to Google Cloud APIs using your own free personal OAuth client. Zero middleman servers or cloud subscriptions.
- **⚙️ Configurable Field Mappings**: Map data to any frontmatter property names in your vault.

---

## 📦 Installation via BRAT (Beta Testing)

1. Install the **BRAT (Obsidian42 - BRAT)** plugin from Obsidian Community Plugins.
2. In Obsidian Settings, go to **BRAT > Add Beta plugin**.
3. Enter the repository URL:
   ```text
   https://github.com/jare0014/obsidian-health-connect
   ```
4. Click **Add Plugin**, then enable **Health Connect & Readiness Dashboard** in Community Plugins.

---

## 🚀 Quick Setup Guide

### 1. Create a Free Google Cloud OAuth Client
1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project (e.g. `Obsidian-Health`).
2. Navigate to **APIs & Services > Library**, search for **Google Health API**, and click **Enable**.
3. Under **APIs & Services > OAuth consent screen**:
   - User Type: **External**
   - App name: `Obsidian Health Connect`
   - Add your email under **Test Users**.
   - Add Scopes:
     - `.../auth/googlehealth.sleep.readonly`
     - `.../auth/googlehealth.health_metrics_and_measurements.readonly`
     - `.../auth/googlehealth.activity.readonly`
     - `.../auth/googlehealth.nutrition.readonly`
     - `.../auth/googlehealth.nutrition.writeonly`
4. Under **APIs & Services > Credentials**:
   - Click **Create Credentials > OAuth client ID** (Application type: **Web application**).
   - Authorized redirect URI: `http://localhost:8092`
   - Click **Create** and **Download JSON**.

### 2. Connect in Obsidian
1. Open **Obsidian Settings > Health Connect & Readiness**.
2. Paste your downloaded OAuth client JSON into the box and click **Connect Google Account**.
3. Approve the permissions in your browser. Once connected, the status badge will show `🟢 Connected`.

---

## 📊 Dashboard Usage

Add this codeblock to your Daily Note, Weekly Review, or Health Dashboard note:

\`\`\`health-dashboard
\`\`\`

### Date Range Filtering
You can filter the dashboard to specific date ranges:
\`\`\`health-dashboard
from: 2026-08-01
to: 2026-08-19
\`\`\`

---

## ☕ Support the Project

If this plugin enhances your daily workflow or quantified-self tracking, please consider supporting its development:

- [Buy Me a Coffee](https://buymeacoffee.com/alexjarecki)

---

## License

MIT License © 2026 Alex Jarecki

