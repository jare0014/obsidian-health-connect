import { Plugin, Notice } from "obsidian";
import { HealthPluginSettings, DEFAULT_SETTINGS } from "./models/HealthTypes";
import { GoogleAuthService } from "./services/GoogleAuthService";
import { GoogleHealthApi } from "./services/GoogleHealthApi";
import { DailyNoteWriter } from "./services/DailyNoteWriter";
import { HealthDashboardProcessor } from "./views/HealthDashboardProcessor";
import { FoodLoggerModal } from "./views/FoodLoggerModal";
import { HealthSettingsTab } from "./settings/HealthSettingsTab";

export default class HealthConnectPlugin extends Plugin {
    settings: HealthPluginSettings;
    authService: GoogleAuthService;
    healthApi: GoogleHealthApi;
    noteWriter: DailyNoteWriter;

    async onload() {
        await this.loadSettings();

        this.authService = new GoogleAuthService(this.app, this.settings, () => this.saveSettings());
        this.healthApi = new GoogleHealthApi(this.authService);
        this.noteWriter = new DailyNoteWriter(this.app, this.settings);

        // Ribbon Icon 1: Biometric Daily Sync
        this.addRibbonIcon("activity", "Sync Health & Biometrics", async () => {
            await this.syncTodayHealth();
        });

        // Ribbon Icon 2: Quick Log Food/Drink
        this.addRibbonIcon("apple", "Quick Log Food & Drink", () => {
            new FoodLoggerModal(this.app, this).open();
        });

        // Command Palette Actions
        this.addCommand({
            id: "sync-today-health-data",
            name: "Sync Today's Health Data to Daily Note",
            callback: async () => {
                await this.syncTodayHealth();
            }
        });

        this.addCommand({
            id: "quick-log-food-drink",
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

        // Auto Sync on Startup if enabled
        if (this.settings.autoSyncOnStartup && this.authService.isConnected()) {
            this.app.workspace.onLayoutReady(async () => {
                await this.syncTodayHealth();
            });
        }
    }

    async syncTodayHealth(): Promise<void> {
        if (!this.authService.isConnected()) {
            new Notice("Please configure Google Health credentials in Settings first!");
            return;
        }

        new Notice("Fetching Google Health biometrics... ⏳");
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        try {
            const data = await this.healthApi.fetchDailyHealth(today);
            await this.noteWriter.writeHealthSnapshot(dateStr, {
                date: dateStr,
                sleep: data.sleep,
                vitals: data.vitals,
                nutrition: data.nutrition
            });
        } catch (e) {
            console.error("Health sync error:", e);
            new Notice("Health sync encountered an error. Check console for details.");
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
