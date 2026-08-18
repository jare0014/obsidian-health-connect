# Health Connect & Readiness Dashboard for Obsidian

A sleek, privacy-first Obsidian plugin that automatically syncs **Sleep, HRV, Readiness, Hydration, and Nutrition** from **Google Health & Fitbit** directly into your Daily Notes frontmatter and provides an instant, interactive visual dashboard.

[![Buy Me a Coffee](https://img.shields.io/badge/Donate-Buy%20Me%20A%20Coffee-yellow.svg)](https://buymeacoffee.com/alexjarecki)
[![Obsidian Community](https://img.shields.io/badge/Obsidian-Community%20Plugin-purple.svg)](https://obsidian.md)

---

## ✨ Features

- **⚡ Automated Biometric Sync**: Pulls Sleep duration (H:MM), Wakeup time, Heart Rate Variability (RMSSD ms), calculated Readiness Index, Caffeine (mg), and Hydration (fl oz) with one click.
- **📊 Instant Visual Dashboard**: Embed \`\`\`health-dashboard\`\`\` anywhere in your vault to get responsive KPI cards, rolling 14-day averages, percent trend indicators (▲/▼), and smooth SVG sparkline charts matching your Obsidian theme.
- **🔒 100% Local & Private**: Connects directly from your machine to Google APIs using your own free Google Cloud OAuth client. Zero middleman servers or third-party subscriptions.
- **⚙️ Configurable Field Mappings**: Map data to your preferred daily note frontmatter property names (e.g. \`Sleep_hours\`, \`HRV\`, \`Readiness\`).

---

## 🚀 Quick Setup Guide

1. Create a free OAuth Client ID in the [Google Cloud Console](https://console.cloud.google.com/):
   - Application type: **Web Application**
   - Redirect URI: \`http://localhost:8092\`
2. Enable the **Fitness API** in your Google Cloud project.
3. Open **Obsidian Settings > Health Connect & Readiness**:
   - Paste your **Client ID** and **Client Secret**.
   - Click **Login with Google** and approve the permissions.
   - Paste the authorization code back into settings.
4. Click the Activity icon on the ribbon or run \`Sync Today's Health Data\` from the Command Palette!

---

## 📊 Dashboard Usage

Add this codeblock to your Daily Note, Weekly Review, or Health Dashboard note:

\`\`\`health-dashboard
\`\`\`

---

## ☕ Support the Project

If this plugin saves you time or enhances your personal knowledge management, please consider supporting its development:

- [Buy Me a Coffee](https://buymeacoffee.com/alexjarecki)
- [GitHub Sponsors](https://github.com/sponsors/alexjarecki)

---

## License

MIT License © 2026 Alex Jarecki
