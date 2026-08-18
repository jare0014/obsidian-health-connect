import { Plugin, Notice } from "obsidian";
import { HealthPluginSettings, DEFAULT_SETTINGS } from "./models/HealthSettings";
import { GoogleOAuthService } from "./services/GoogleOAuthService";
import { GoogleHealthService } from "./services/GoogleHealthService";
import { DailyNoteWriter } from "./services/DailyNoteWriter";
import { MetaBindService } from "./services/MetaBindService";
import { HealthDashboardProcessor } from "./views/HealthDashboardProcessor";
import { FoodLoggerModal } from "./views/FoodLoggerModal";
import { HealthSettingsTab } from "./settings/HealthSettingsTab";

export default class HealthConnectPlugin extends Plugin {
    settings: HealthPluginSettings;
    oauthService: GoogleOAuthService;
    healthService: GoogleHealthService;
    noteWriter: DailyNoteWriter;
    metaBindService: MetaBindService;

    async onload() {
        await this.loadSettings();

        this.oauthService = new GoogleOAuthService(this.app, this.settings, () => this.saveSettings());
        this.healthService = new GoogleHealthService(this.settings, this.oauthService);
        this.noteWriter = new DailyNoteWriter(this.app, this.settings);
        this.metaBindService = new MetaBindService(this.app);

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

        // Register ```health-dashboard``` Markdown Processor
        const dashboardProcessor = new HealthDashboardProcessor(this.app, this.settings, () => this.syncTodayHealth());
        this.registerMarkdownCodeBlockProcessor("health-dashboard", (source, el, ctx) => {
            dashboardProcessor.render(source, el, ctx);
        });

        // Settings Tab
        this.addSettingTab(new HealthSettingsTab(this.app, this));
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

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
