# Obsidian Health Connect: BRAT Beta Survey & Demo Recording Guide

**Document Version:** 1.0.0  
**Date:** 2026-09-24  
**Work Packet:** `HC-MONEY-20260916` | Task `G1`  
**Authors:** Gemini & Obsidian Health Connect Team

---

## 1. Context & Purpose

This guide provides:
1. A calibrated **Beta Tester Feedback Survey** for community users installing via Obsidian BRAT.
2. A turnkey **3-Minute Video Recording Script** for demonstrating synthetic dashboard functionality and marketing the $29–$49 paid guided setup offer without revealing private health data.

---

## 2. BRAT Beta Tester Feedback Survey

Distribute this questionnaire via GitHub Discussions, Google Forms, or Typeform to users testing the plugin through BRAT:

### Section A: Hardware & Platform Profile
1. **Primary wearable ecosystem:**
   - [ ] Google Pixel Watch / Fitbit (Google Health Cloud REST API)
   - [ ] Android Wear OS / Phone (Android Health Connect companion)
   - [ ] Apple Watch / iPhone (Apple Health JSON / iOS Shortcut export)
   - [ ] Oura Ring / Whoop / Garmin (Manual or third-party sync)
   - [ ] Pure manual logging in daily notes (No wearable)

2. **Obsidian sync setup:**
   - [ ] Obsidian Sync
   - [ ] iCloud Drive (macOS / iOS)
   - [ ] Syncthing / Local Git / Tailscale
   - [ ] Desktop only

### Section B: Onboarding & Setup Friction
3. **How long did initial setup take from installation to your first rendered dashboard?**
   - [ ] Under 5 minutes (seamless)
   - [ ] 5–15 minutes (acceptable)
   - [ ] 15–30 minutes (challenging)
   - [ ] > 30 minutes / Encountered blocking error

4. **Where was the biggest friction point during setup? (Rank 1–5):**
   - `[ ]` Google Cloud Console OAuth2 project creation & credentials
   - `[ ]` Configuring daily note folder path and frontmatter property names
   - `[ ]` Installing and trusting the iOS Apple Health shortcut
   - `[ ]` Configuring the ```` ```health-dashboard ```` code block syntax
   - `[ ]` Understanding token refresh and sync intervals

### Section C: Feature Value & Daily Note Writeback
5. **Which features deliver the highest daily value to you? (Select top 2):**
   - [ ] Visual Health Dashboard cards (Sleep, Readiness, HRV, Steps)
   - [ ] Automatic daily note habit ticking (`- [x] Meditation`) and Focus Log duration
   - [ ] Sandboxed Nutrition OCR Modal (logging macros from label photos)
   - [ ] Cross-correlation between health recovery metrics and productivity/git logs

### Section D: Commercial Guided-Setup Validation
6. **If an automated 30-minute 1-on-1 concierge setup call (with custom metric card design and Google Cloud OAuth configuration) was available, would you find it valuable?**
   - [ ] Yes, would gladly pay $29–$49 to skip the OAuth and setup hurdles
   - [ ] Only if troubleshooting custom wearable integrations
   - [ ] No, prefer DIY open-source configuration

7. **What is the single biggest improvement you would like to see in the next release?**
   - _[Free text response]_

---

## 3. Three-Minute Demo Video Recording Script

> [!IMPORTANT]
> **Strict Privacy Rule:** Record this walkthrough inside a dedicated test vault using **only synthetic mock data**. Never display personal health records, live Google API client secrets, or private medical logs.

### Video Overview
- **Target Duration:** 2 minutes 45 seconds to 3 minutes 15 seconds.
- **Audio Tone:** Calm, technical, direct, privacy-focused.
- **Visual Setup:** Split screen or window switch between Obsidian daily notes and the rendered dashboard in dark theme.

---

### Shot List & Voiceover

#### Scene 1: The Problem & The Privacy-First Solution (0:00 – 0:35)
* **Visual:** Clean Obsidian workspace showing a standard Daily Note with habit checkboxes and day planner blocks.
* **Audio Voiceover:**
  > *"Most health analytics platforms lock your biometric data into proprietary cloud silos. If you track your work, habits, and research in Obsidian, you shouldn't have to leave your vault to understand your sleep, HRV, or cognitive readiness.*  
  > *Obsidian Health Connect brings local-first wearable analytics directly into your markdown notes—with zero cloud lock-in and zero third-party telemetry."*

#### Scene 2: Synthetic Data Walkthrough (0:35 – 1:20)
* **Visual:** Open `Health Demo/2026-09-16.md` and `Health Demo/2026-09-17.md`. Highlight YAML properties (`Sleep_hours: 8`, `Readiness: 78`, `HRV: 48`, `steps: 8200`). Then open `Dashboard.md` with the ```` ```health-dashboard ```` block.
* **Audio Voiceover:**
  > *"Here's how simple it is. With our synthetic test suite, you don't even need a Google Cloud account to try it out. Here are two sample daily notes with standard YAML frontmatter for sleep, readiness, and step counts.*  
  > *When we open our dashboard note, the plugin immediately aggregates and visualizes multi-day trends, rolling averages, and target completion cards. If we modify a metric in the note, the dashboard reflects the update instantly."*

#### Scene 3: Live Wearable Sync & Mindfulness Writeback (1:20 – 2:05)
* **Visual:** Trigger manual sync via command palette (`Health Connect: Sync Wearable Data`). Show terminal/notice logging session, then show today's daily note: `- [x] Meditation (20m via Headspace/Google Health)` appearing automatically under `### Focus Log` and the `- [x] Meditation` habit box checked.
* **Audio Voiceover:**
  > *"When connected to Google Health, Android Health Connect, or Apple Health, synchronization happens in the background.*  
  > *Notice here: a 20-minute morning Headspace meditation session was captured via Google Health. The plugin not only records the biometric minutes, but writes back directly to today's daily note—checking off your meditation habit and logging duration in your focus log."*

#### Scene 4: Custom Metric Cards & Correlation (2:05 – 2:40)
* **Visual:** Scroll down the dashboard displaying clinic duty metrics, git commits, and nutritional macros alongside sleep recovery.
* **Audio Voiceover:**
  > *"Because it operates inside your vault, Health Connect doesn't just measure sleep—it correlates recovery against actual output, whether that's daily git commits, clinical duties, or cognitive readiness scores.*  
  > *Every metric card is fully customizable via the plugin settings tab."*

#### Scene 5: Call to Action & Guided Setup Concierge (2:40 – 3:00)
* **Visual:** Show the GitHub README, the BRAT installation link, and the concierge setup booking page.
* **Audio Voiceover:**
  > *"Obsidian Health Connect is 100% open source and available for beta testing today via the Obsidian BRAT community plugin.*  
  > *If you'd like hands-on assistance setting up your Google Cloud OAuth credentials, configuring custom metric cards, or building a bespoke recovery dashboard, check out our concierge guided setup link below.*  
  > *Take control of your biometric data—locally, in your own vault."*

---

## 4. Acceptance Criteria
- [x] Beta survey covers wearable ecosystems, friction points, feature utility, and setup fee elasticity.
- [x] Video script adheres strictly to synthetic data demonstration avoiding real PHI or private paths.
- [x] Work Packet `HC-MONEY-20260916` Task `G1` complete.
