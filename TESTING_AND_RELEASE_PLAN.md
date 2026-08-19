# Health Connect & Readiness Dashboard — Testing Walkthrough & Launch Plan

This document outlines the step-by-step procedure to test the standalone plugin from scratch with a fresh Google Cloud Platform (GCP) project, verify all biometric and food sync pipelines, and proceed through public release.

---

## 📋 Phase 1: Clean Environment Isolation & Fresh GCP Setup

### Step 1: Disable Health Sync in Omni-Logger
To ensure zero port collisions (`8092`) or concurrent token overwrites:
1. Open **Obsidian Settings > Omni-Logger** (or Omni-Logger TS Test).
2. Under **Google Health Integration**, toggle **Enable Google Health API** to **OFF** (or set Sync Style to *Manual*).

---

### Step 2: Create a Fresh GCP Project & OAuth Client
1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a new project (e.g. `Obsidian-Health-Test`).
2. Go to **APIs & Services > Library**:
   - Search for **Google Health API** (NOT Fitness API).
   - Click **Enable**.
3. Go to **APIs & Services > OAuth consent screen**:
   - Select User Type: **External** -> Click **Create**.
   - App name: `Obsidian Health Connect`.
   - User support email & Developer contact: your Gmail.
   - **Scopes**: Add the 5 scopes:
     - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
     - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
     - `https://www.googleapis.com/auth/googlehealth.activity.readonly`
     - `https://www.googleapis.com/auth/googlehealth.nutrition.readonly`
     - `https://www.googleapis.com/auth/googlehealth.nutrition.writeonly`
   - **Test Users** (Critical!): Click **+ Add Users** and type your Gmail address.
   - *Pro-Tip*: On the OAuth consent screen overview, click **PUBLISH APP** to permanently bypass Google's 7-day token expiration rule.
4. Go to **APIs & Services > Credentials**:
   - Click **Create Credentials > OAuth client ID**.
   - Application type: **Web application**.
   - Name: `Obsidian Client`.
   - Authorized redirect URIs: `http://localhost:8092`.
   - Click **Create**, then click **Download JSON**.

---

### Step 3: Connect in Obsidian
1. Open **Obsidian Settings > Health Connect & Readiness**.
2. Open the downloaded JSON in Notepad, copy all text, and paste it into the **OAuth Client JSON config** box.
3. Click **Connect Google Account**:
   - Your browser will open the Google authorization screen.
   - Click your account -> Click **Advanced / Continue** (since it's your personal unverified client ID) -> Click **Allow**.
   - You should see the *"Authentication Successful"* screen.
4. In Obsidian Settings, verify the status badge shows **`🟢 Connected`**.
5. Click **Test Connection** to confirm live API handshake.

---

## 🧪 Phase 2: Functional Verification Checklist

- [ ] **Test 1: 1-Click Biometric Sync**
  - Click the **Activity icon** (`activity`) on the ribbon (or run command `Sync Today's Google Health Biometrics`).
  - Open today's Daily Note frontmatter and verify:
    - `Sleep_hours` (e.g. `7:30`)
    - `wake_up` (e.g. `06:45`)
    - `HRV` (e.g. `62`)
    - `steps` (e.g. `8420`)
    - `active_minutes` (e.g. `35`)
    - Manual `Readiness` score was NOT overwritten.

- [ ] **Test 2: Food & Beverage Logging**
  - Click the **Apple icon** (`apple`) on the ribbon (or run `Quick Log Food / Beverage`).
  - Select an item (e.g. *Americano*), adjust servings, and click **Log to Google Health**.
  - Check notice confirmation and verify Daily Note frontmatter updates with cumulative totals (`caffeine: 150`, `calories: 5`).

- [ ] **Test 3: Meta Bind Button Integration**
  - In Settings, click **Register in Meta Bind** for the Food Logger and Sync buttons.
  - Paste `BUTTON[health-food-logger-btn]` in a scratch note and click the button to verify it opens the modal instantly.

- [ ] **Test 4: Visual Dashboard & Date Overrides**
  - Create a test note and paste:
    ```health-dashboard
    ```
  - Verify that KPI cards, rolling averages, and SVG sparklines render cleanly.
  - Test static date overrides:
    ```health-dashboard
    from: 2026-08-01
    to: 2026-08-18
    ```
  - Open Settings and test the **`[👁️ Generate Live Preview]`** button.

---

## 🚀 Phase 3: Public Release Roadmap

1. **GitHub Repository Creation**:
   - Push `04_Projects/obsidian-health-connect` to `https://github.com/jare0014/obsidian-health-connect`.
2. **Create GitHub Release `v1.0.0`**:
   - Tag: `1.0.0`
   - Release assets: `main.js`, `manifest.json`, `styles.css`.
3. **BRAT Community Beta**:
   - Share repository slug `jare0014/obsidian-health-connect` with early testers.
4. **Official Community Directory Submission**:
   - Submit Pull Request to `obsidianmd/obsidian-releases` adding the plugin to `community-plugins.json`.
