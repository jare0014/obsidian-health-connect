import { Plugin, Notice, TFile } from "obsidian";
import { HealthPluginSettings, DEFAULT_SETTINGS } from "./models/HealthSettings";
import { GoogleOAuthService } from "./services/GoogleOAuthService";
import { GoogleHealthService } from "./services/GoogleHealthService";
import { DailyNoteWriter } from "./services/DailyNoteWriter";
import { MetaBindService } from "./services/MetaBindService";
import { AppleHealthIngestService } from "./services/AppleHealthIngestService";
import { HealthDashboardProcessor } from "./views/HealthDashboardProcessor";
import { FoodLoggerModal } from "./views/FoodLoggerModal";
import { HealthSettingsTab } from "./settings/HealthSettingsTab";

export default class HealthConnectPlugin extends Plugin {
    settings: HealthPluginSettings;
    oauthService: GoogleOAuthService;
    healthService: GoogleHealthService;
    noteWriter: DailyNoteWriter;
    metaBindService: MetaBindService;
    appleHealthService: AppleHealthIngestService;

    async onload() {
        await this.loadSettings();

        this.oauthService = new GoogleOAuthService(this.app, this.settings, () => this.saveSettings());
        this.healthService = new GoogleHealthService(this.settings, this.oauthService);
        this.noteWriter = new DailyNoteWriter(this.app, this.settings);
        this.metaBindService = new MetaBindService(this.app);
        this.appleHealthService = new AppleHealthIngestService(this.app, this.settings, this.noteWriter);

        // Ribbon Icon: Daily Biometric Sync
        this.addRibbonIcon("activity", "Sync Health & Biometrics", async () => {
            await this.syncTodayHealth();
        });

        // Ribbon Icon: Quick Log Food & Drink
        this.addRibbonIcon("apple", "Quick Log Food & Drink", () => {
            new FoodLoggerModal(this.app, this).open();
        });

        // Command Palette Actions
        this.addCommand({
            id: "health-connect-sync-today",
            name: "Sync Today's Google Health Biometrics",
            callback: async () => {
                await this.syncTodayHealth();
            }
        });

        this.addCommand({
            id: "health-connect-log-food",
            name: "Quick Log Food / Beverage (Google Health)",
            callback: () => {
                new FoodLoggerModal(this.app, this).open();
            }
        });

        this.addCommand({
            id: "health-connect-scan-apple-health",
            name: "Scan & Ingest Apple Health Drop Folder (JSON)",
            callback: async () => {
                await this.appleHealthService.scanAndIngestDropFolder();
            }
        });

        this.addCommand({
            id: "health-connect-backfill-14d",
            name: "Backfill & Sync Last 14 Days Biometrics (Google Health)",
            callback: async () => {
                await this.syncHealthHistory(14);
            }
        });

        // Register Real-Time Ingestion Event on Dropped Files
        this.registerEvent(
            this.app.vault.on("create", async (file) => {
                if (file instanceof TFile && this.appleHealthService.isTargetDropFile(file)) {
                    console.log(`[Health Connect] Detected new Apple Health drop: ${file.path}`);
                    setTimeout(async () => {
                        const success = await this.appleHealthService.processFile(file);
                        if (success) {
                            new Notice(`[Health Connect] Ingested Apple Health file: ${file.name} 🍎`);
                        }
                    }, 500);
                }
            })
        );

        // Background Check on Startup
        if (this.settings.enableAppleHealthIngest) {
            setTimeout(async () => {
                await this.appleHealthService.scanAndIngestDropFolder();
            }, 3000);
        }

        // Register ```health-dashboard``` Markdown Processor
        const dashboardProcessor = new HealthDashboardProcessor(this.app, this.settings, () => this.syncTodayHealth());
        this.registerMarkdownCodeBlockProcessor("health-dashboard", (source, el, ctx) => {
            dashboardProcessor.render(source, el, ctx);
        });

        // Settings Tab
        this.addSettingTab(new HealthSettingsTab(this.app, this));
    }

    public async getRawScannedKeys(): Promise<string[]> {
        const keysSet = new Set<string>();
        const defaultPool = this.settings.customAvailableKeys || [
            "Sleep_hours", "Sleep_score", "Readiness", "HRV", "caffeine", "alcohol", "hydration", "protein", "calories", "wake_up"
        ];
        defaultPool.forEach(k => keysSet.add(k));

        const files = this.app.vault.getMarkdownFiles()
            .filter(f => /\d{4}-\d{2}-\d{2}/.test(f.basename))
            .slice(0, 30);

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter) {
                Object.keys(cache.frontmatter).forEach(k => {
                    if (!['position', 'tags', 'aliases'].includes(k)) {
                        keysSet.add(k);
                    }
                });
            }
        }
        return Array.from(keysSet);
    }

    public async getAvailableKeys(): Promise<string[]> {
        const raw = await this.getRawScannedKeys();
        const blacklisted = this.settings.blacklistedKeys || [];
        return raw.filter(k => !blacklisted.includes(k));
    }

    async syncTodayHealth(): Promise<void> {
        if (!this.oauthService.isConnected()) {
            new Notice("Please connect Google Health in settings first!");
            return;
        }

        new Notice("Fetching Google Health v4 biometrics... ⏳");
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        try {
            const data = await this.healthService.fetchDailyHealth(today);
            if (Object.keys(data).length > 0) {
                await this.noteWriter.writeData(dateStr, data);
                new Notice("Synced Health data into daily note! 🩺");
            } else {
                new Notice("No new health data found for today.");
            }
        } catch (e) {
            console.error("Health sync error:", e);
            new Notice("Health sync error: " + e.message);
        }
    }

    async syncHealthHistory(days: number = 14): Promise<void> {
        if (!this.oauthService.isConnected()) {
            new Notice("Please connect Google Health in settings first!");
            return;
        }

        const notice = new Notice(`Backfilling Google Health data (1/${days})... ⏳`, 0);
        let syncedCount = 0;

        for (let i = 0; i < days; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            notice.setMessage(`Backfilling Google Health data (${i + 1}/${days}): ${dateStr}... ⏳`);

            try {
                const data = await this.healthService.fetchDailyHealth(d);
                if (Object.keys(data).length > 0) {
                    const ok = await this.noteWriter.writeData(dateStr, data, false);
                    if (ok) syncedCount++;
                }
            } catch (e) {
                console.error(`Error backfilling ${dateStr}:`, e);
            }

            // Yield control to Electron event loop between dates to prevent UI freezing
            await new Promise(resolve => setTimeout(resolve, 80));
        }

        notice.hide();
        new Notice(`Completed Google Health backfill! Synced ${syncedCount} day(s) 🟢`);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        if (this.settings.requestedScopes) {
            this.settings.requestedScopes = this.settings.requestedScopes.filter(s => s !== "https://www.googleapis.com/auth/googlehealth.activity.readonly");
            if (!this.settings.requestedScopes.includes("https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly")) {
                this.settings.requestedScopes.push("https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly");
            }
        }
    }

    async saveSettings() {
        if (this.settings.requestedScopes) {
            this.settings.requestedScopes = this.settings.requestedScopes.filter(s => s !== "https://www.googleapis.com/auth/googlehealth.activity.readonly");
        }
        await this.saveData(this.settings);
    }
}
