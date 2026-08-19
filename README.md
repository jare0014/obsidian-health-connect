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

### Part 1: Create GCP Project & Enable Health API
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown at the top-left -> Click **New Project** -> Name it `Obsidian-Health` -> Click **Create**.
3. Go to **APIs & Services > Library**, search for **Google Health API** (NOT Fitness API), and click **Enable**.

### Part 2: Configure OAuth Consent Screen & Scopes
1. Go to **APIs & Services > OAuth consent screen**.
2. Select **Audience / User Type: External** -> Click **Create / Next**.
3. Enter App Name (e.g. `Obsidian Health Connect`) and your email under Developer & Support contacts.
4. Under **Scopes**, click **Add or Remove Scopes** and add:
   - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
   - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
   - `https://www.googleapis.com/auth/googlehealth.activity.readonly`
   - `https://www.googleapis.com/auth/googlehealth.nutrition.readonly` & `...writeonly`
5. Under **Test users**, click **+ Add Users** and enter your personal Gmail. *(Tip: Click **Publish App** on the OAuth overview so your refresh token never expires after 7 days)*.

### Part 3: Create OAuth Client ID & Connect
1. Go to **APIs & Services > Credentials** -> Click **+ Create Credentials > OAuth client ID**.
2. Application type: **Web application**.
3. Name: `Obsidian Client`.
4. Authorized redirect URIs: `http://localhost:8092`.
5. Click **Create** -> Click **Download JSON**.
6. Open **Obsidian Settings > Health Connect & Readiness**, paste the JSON content into the box, and click **Connect Google Account**. Approving in your browser will switch the status badge to `🟢 Connected`!

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

