import { Plugin, Notice, TFile, ObsidianProtocolData, Platform } from "obsidian";
import { HealthPluginSettings, DEFAULT_SETTINGS, BIOMETRIC_CATALOG } from "./models/HealthSettings";
import { GoogleOAuthService, LEGACY_SECRET_KEYS, getVaultSecretKey } from "./services/GoogleOAuthService";
import { GoogleHealthService } from "./services/GoogleHealthService";
import { DailyNoteWriter } from "./services/DailyNoteWriter";
import { MetaBindService } from "./services/MetaBindService";
import { AppleHealthIngestService } from "./services/AppleHealthIngestService";
import { HealthDashboardProcessor } from "./views/HealthDashboardProcessor";
import { FoodLoggerModal } from "./views/FoodLoggerModal";
import { HealthHubModal, HealthHubTab, HealthHubCategory } from "./views/HealthHubModal";
import { HealthSettingsTab } from "./settings/HealthSettingsTab";
import { WorkoutSyncService } from "./services/WorkoutSyncService";
import { parseHealthProtocolUri } from "./services/HealthProtocolUri";
import {
    claimAutoSyncOwnership,
    getDevicePlatformLabel,
    getOrCreateDeviceId,
    isCurrentDeviceAutoSyncOwner,
    migrateAutoSyncOwnership
} from "./services/AutoSyncOwnership";

export default class HealthConnectPlugin extends Plugin {
    settings: HealthPluginSettings;
    oauthService: GoogleOAuthService;
    healthService: GoogleHealthService;
    noteWriter: DailyNoteWriter;
    metaBindService: MetaBindService;
    appleHealthService: AppleHealthIngestService;
    workoutSyncService: WorkoutSyncService;

    private syncIntervalTimer: number | null = null;
    private activeHubModal: HealthHubModal | null = null;

    async onload() {
        await this.loadSettings();

        this.oauthService = new GoogleOAuthService(this.app, this.settings, () => this.saveSettings());
        this.healthService = new GoogleHealthService(this.settings, this.oauthService);
        this.noteWriter = new DailyNoteWriter(this.app, this.settings);
        this.metaBindService = new MetaBindService(this.app);
        this.appleHealthService = new AppleHealthIngestService(this.app, this.settings, this.noteWriter);
        this.workoutSyncService = new WorkoutSyncService(this.app, this.settings, this.healthService);

        // Ribbon Icon: Daily Biometric Sync
        this.addRibbonIcon("activity", "Sync Health & Biometrics", async () => {
            await this.syncTodayHealth();
        });

        // Ribbon Icon: Health Activity Hub
        this.addRibbonIcon("heart-pulse", "Open Health Activity Hub", () => {
            this.openActivityHub();
        });

        // Command Palette Actions
        this.addCommand({
            id: "health-connect-open-hub",
            name: "Open Health Activity Hub (Nutrition, Workouts, Mindfulness, Sleep)",
            callback: () => {
                this.openActivityHub();
            }
        });

        this.addCommand({
            id: "health-connect-log-food",
            name: "Quick Log Food / Beverage (Nutrition & Caffeine)",
            callback: () => {
                this.openActivityHub('log', 'nutrition');
            }
        });

        this.addCommand({
            id: "health-connect-log-workout",
            name: "Quick Log Workout / Exercise (Google Health)",
            callback: () => {
                this.openActivityHub('log', 'workout');
            }
        });

        this.addCommand({
            id: "health-connect-log-mindfulness",
            name: "Quick Log Mindfulness / Meditation (Daily Note)",
            callback: () => {
                this.openActivityHub('log', 'mindfulness');
            }
        });

        this.addCommand({
            id: "health-connect-log-sleep",
            name: "Quick Log Sleep Stats (Daily Note Frontmatter)",
            callback: () => {
                this.openActivityHub('log', 'sleep');
            }
        });

        this.addCommand({
            id: "health-connect-sync-today",
            name: "Sync Active Note / Today's Google Health Biometrics",
            callback: async () => {
                await this.syncTodayHealth();
            }
        });

        this.addCommand({
            id: "health-connect-reconcile-workouts",
            name: "Reconcile Workouts with Google Health (Bidirectional)",
            callback: async () => {
                await this.reconcileWorkouts();
            }
        });

        this.addCommand({
            id: "health-connect-authorize",
            name: "Connect / Authorize Google Account (OAuth)",
            callback: () => {
                this.oauthService.startOAuthFlow(true);
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

        // Background Check on Startup (Apple Health)
        if (this.settings.enableAppleHealthIngest) {
            setTimeout(async () => {
                await this.appleHealthService.scanAndIngestDropFolder();
            }, 3000);
        }

        // Auto-Sync on Startup (Google Health)
        if (this.settings.autoSyncOnStartup && this.isCurrentDeviceAutoSyncOwner()) {
            setTimeout(async () => {
                if (!this.settings.autoSyncOnStartup || !this.isCurrentDeviceAutoSyncOwner()) {
                    return;
                }
                if (this.oauthService.isConnected()) {
                    console.log("[Health Connect] Executing startup Google Health sync...");
                    const today = new Date();
                    const year = today.getFullYear();
                    const month = String(today.getMonth() + 1).padStart(2, '0');
                    const day = String(today.getDate()).padStart(2, '0');
                    await this.syncDateHealth(`${year}-${month}-${day}`, true);
                }
            }, 4000);
        }

        // Initialize Background Interval Timer
        this.setupAutoSync();

        // Register ```health-dashboard``` Markdown Processor
        const dashboardProcessor = new HealthDashboardProcessor(this.app, this.settings, () => this.syncTodayHealth());
        this.registerMarkdownCodeBlockProcessor("health-dashboard", (source, el, ctx) => {
            dashboardProcessor.render(source, el, ctx);
        });

        // Register Obsidian URI / deep link handlers for external apps and shortcuts
        const handleProtocolUri = (params: ObsidianProtocolData) => {
            const parsed = parseHealthProtocolUri(params);
            if (!parsed.ok) {
                new Notice(`[Health Connect] ${parsed.error}`);
                return;
            }
            this.openActivityHub(parsed.tab, parsed.category);
        };
        this.registerObsidianProtocolHandler("health-connect", handleProtocolUri);
        this.registerObsidianProtocolHandler("health-connect-hub", handleProtocolUri);

        // Settings Tab
        this.addSettingTab(new HealthSettingsTab(this.app, this));
    }

    /**
     * Opens the unified Health Activity Hub modal, replacing any prior open instance.
     */
    public openActivityHub(
        tab: HealthHubTab = "log",
        category: HealthHubCategory = "nutrition"
    ): HealthHubModal {
        if (this.activeHubModal) {
            this.activeHubModal.close();
            this.activeHubModal = null;
        }
        const modal = new HealthHubModal(this.app, this, tab, category);
        const originalOnClose = typeof modal.onClose === "function" ? modal.onClose.bind(modal) : null;
        modal.onClose = () => {
            if (this.activeHubModal === modal) {
                this.activeHubModal = null;
            }
            if (originalOnClose) {
                originalOnClose();
            }
        };
        this.activeHubModal = modal;
        modal.open();
        return modal;
    }

    public getDeviceId(): string {
        return getOrCreateDeviceId(this.app);
    }

    public getDeviceLabel(): string {
        return getDevicePlatformLabel(Platform);
    }

    public isCurrentDeviceAutoSyncOwner(): boolean {
        return isCurrentDeviceAutoSyncOwner(this.settings, this.getDeviceId());
    }

    public claimAutoSyncOwnership(): boolean {
        return claimAutoSyncOwnership(this.settings, this.getDeviceId(), this.getDeviceLabel());
    }

    public setupAutoSync(): void {
        if (this.syncIntervalTimer !== null) {
            window.clearInterval(this.syncIntervalTimer);
            this.syncIntervalTimer = null;
        }

        if (
            this.settings.googleHealthSyncStyle === 'automatic' &&
            this.settings.googleHealthSyncInterval > 0 &&
            this.isCurrentDeviceAutoSyncOwner()
        ) {
            const intervalMs = Math.max(15, this.settings.googleHealthSyncInterval) * 60 * 1000;
            this.syncIntervalTimer = window.setInterval(async () => {
                if (
                    this.settings.googleHealthSyncStyle !== 'automatic' ||
                    !this.isCurrentDeviceAutoSyncOwner()
                ) {
                    return;
                }
                if (this.oauthService.isConnected()) {
                    console.log("[Health Connect] Executing periodic background Google Health sync...");
                    const today = new Date();
                    const year = today.getFullYear();
                    const month = String(today.getMonth() + 1).padStart(2, '0');
                    const day = String(today.getDate()).padStart(2, '0');
                    await this.syncDateHealth(`${year}-${month}-${day}`, true);
                }
            }, intervalMs);
            this.registerInterval(this.syncIntervalTimer);
        }
    }

    onunload() {
        if (this.syncIntervalTimer !== null) {
            window.clearInterval(this.syncIntervalTimer);
            this.syncIntervalTimer = null;
        }
        if (this.activeHubModal) {
            this.activeHubModal.close();
            this.activeHubModal = null;
        }
    }

    public async getRawScannedKeys(): Promise<string[]> {
        const keysSet = new Set<string>();
        const defaultPool = this.settings.customAvailableKeys || [
            "Sleep_hours", "Deep_sleep", "Sleep_score", "Readiness", "HRV", "caffeine", "alcohol", "hydration", "protein", "calories", "wake_up"
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

        // Include all configured healthSyncConfig biometric keys
        Object.values(this.settings.healthSyncConfig || {}).forEach((c: any) => {
            if (c?.key) keysSet.add(c.key);
        });

        // Include default keys from standard biometrics catalog
        BIOMETRIC_CATALOG.forEach(entry => keysSet.add(entry.defaultKey));

        // Include calculated metrics
        (this.settings.calculatedMetrics || []).forEach(m => keysSet.add(m.key));

        return Array.from(keysSet);
    }

    public async getAvailableKeys(): Promise<string[]> {
        const raw = await this.getRawScannedKeys();
        const blacklisted = this.settings.blacklistedKeys || [];
        return raw.filter(k => !blacklisted.includes(k));
    }

    async syncTodayHealth(silent: boolean = false, overrideDateStr?: string): Promise<void> {
        let dateStr = overrideDateStr;
        if (!dateStr) {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                const match = activeFile.basename.match(/\d{4}-\d{2}-\d{2}/);
                if (match) dateStr = match[0];
            }
        }
        if (!dateStr) {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            dateStr = `${year}-${month}-${day}`;
        }
        await this.syncDateHealth(dateStr, silent);
    }

    async syncDateHealth(dateStr: string, silent: boolean = false): Promise<void> {
        let data: Record<string, any> = {};

        if (this.oauthService.isConnected()) {
            const token = await this.oauthService.getAccessToken();
            if (token) {
                if (!silent) new Notice(`Fetching Google Health v4 biometrics for ${dateStr}... ⏳`);
                const [year, month, day] = dateStr.split('-').map(Number);
                const targetDateObj = new Date(year, month - 1, day, 12, 0, 0);

                try {
                    const fetched = await this.healthService.fetchDailyHealth(targetDateObj);
                    if (fetched && Object.keys(fetched).length > 0) {
                        data = fetched;
                    }
                } catch (e: any) {
                    console.error(`Health sync error for ${dateStr}:`, e);
                    if (!silent) new Notice("Health sync error: " + e.message);
                }
            } else if (!silent) {
                new Notice("Google Health session expired. Re-evaluating local and calculated metrics...");
            }
        }

        try {
            // The reconciliation pass owns the default workout field when enabled.
            const deferWorkouts = this.settings.enableBidirectionalWorkouts &&
                (this.settings.healthSyncConfig?.exercise?.key || "workout") === "workout";
            await this.noteWriter.writeData(dateStr, data, !silent, { deferWorkouts });

            // Reconcile workouts bidirectionally if enabled
            if (this.settings.enableBidirectionalWorkouts || this.settings.enableBidirectionalMindfulness) {
                const activeFile = this.app.workspace.getActiveFile();
                const noteFile = (activeFile && activeFile.basename.includes(dateStr))
                    ? activeFile
                    : await this.noteWriter.getOrCreateDailyNote(dateStr);
                if (noteFile) {
                    await this.workoutSyncService.reconcileWorkouts(noteFile, { pushToCloud: true, showNotice: false });
                }
            }
        } catch (e: any) {
            console.error(`Health sync error for ${dateStr}:`, e);
            if (!silent) new Notice("Health sync error: " + e.message);
        }
    }

    public async reconcileWorkouts(dateStr?: string): Promise<void> {
        if (!this.oauthService.isConnected()) {
            new Notice("Please connect Google Health in settings first!");
            return;
        }

        const token = await this.oauthService.getAccessToken();
        if (!token) {
            new Notice("Google Health session expired or disconnected. Please re-authorize in settings.");
            return;
        }

        const activeFile = this.app.workspace.getActiveFile();
        let inferredDate = dateStr;
        if (!inferredDate && activeFile) {
            const match = activeFile.basename.match(/\d{4}-\d{2}-\d{2}/);
            if (match) {
                inferredDate = match[0];
            }
        }

        const targetDate = inferredDate || (() => {
            const today = new Date();
            const y = today.getFullYear();
            const m = String(today.getMonth() + 1).padStart(2, '0');
            const d = String(today.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        })();

        const file = (activeFile && activeFile.basename.includes(targetDate))
            ? activeFile
            : await this.noteWriter.getOrCreateDailyNote(targetDate);
        if (!file) {
            new Notice(`Could not locate daily note for ${targetDate}`);
            return;
        }

        new Notice(`Reconciling workouts with Google Health for ${targetDate}... ⏳`);
        try {
            await this.workoutSyncService.reconcileWorkouts(file, { pushToCloud: true, showNotice: true });
        } catch (e: any) {
            console.error("[Health Connect] Error reconciling workouts:", e);
            new Notice(`Error reconciling workouts: ${e.message}`);
        }
    }

    async syncHealthHistory(days: number = 14): Promise<void> {
        if (!this.oauthService.isConnected()) {
            new Notice("Please connect Google Health in settings first!");
            return;
        }

        const token = await this.oauthService.getAccessToken();
        if (!token) {
            new Notice("Google Health session expired or disconnected. Please re-authorize in settings.");
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
        const loaded = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
        this.settings.tokens = Object.assign({}, DEFAULT_SETTINGS.tokens, loaded?.tokens);
        if (this.settings.googleHealthSyncInterval > 0 && this.settings.googleHealthSyncInterval < 15) {
            this.settings.googleHealthSyncInterval = 15;
        }

        // Hydrate credentials securely from vault-scoped SecretStorage (Keychain) if available
        const anyApp = this.app as any;
        if (anyApp.secretStorage && typeof anyApp.secretStorage.getSecret === 'function') {
            try {
                const canMigrateLegacy = typeof loaded?.clientId === "string" && loaded.clientId.trim().length > 0;
                const setScopedSecret = async (scopedKey: string, val: string): Promise<void> => {
                    if (typeof anyApp.secretStorage.setSecret === 'function') {
                        await anyApp.secretStorage.setSecret(scopedKey, val);
                    }
                };

                const scopedSecretKey = getVaultSecretKey(this.app, LEGACY_SECRET_KEYS.clientSecret);
                const scopedRefreshKey = getVaultSecretKey(this.app, LEGACY_SECRET_KEYS.refreshToken);
                const scopedCredsKey = getVaultSecretKey(this.app, LEGACY_SECRET_KEYS.googleCredentials);

                const storedScopedSecret = await anyApp.secretStorage.getSecret(scopedSecretKey);
                let legacySecretChecked = false;
                let legacySecretValue = "";
                const getLegacySecret = async (): Promise<string> => {
                    if (!legacySecretChecked) {
                        legacySecretChecked = true;
                        legacySecretValue = (await anyApp.secretStorage.getSecret(LEGACY_SECRET_KEYS.clientSecret)) || "";
                    }
                    return legacySecretValue;
                };

                if (loaded?.clientSecret) {
                    this.settings.clientSecret = loaded.clientSecret;
                    await setScopedSecret(scopedSecretKey, loaded.clientSecret);
                } else if (storedScopedSecret) {
                    this.settings.clientSecret = storedScopedSecret;
                } else if (canMigrateLegacy) {
                    const legacySecret = await getLegacySecret();
                    if (legacySecret) {
                        this.settings.clientSecret = legacySecret;
                        await setScopedSecret(scopedSecretKey, legacySecret);
                    }
                }

                const storedScopedRefresh = await anyApp.secretStorage.getSecret(scopedRefreshKey);
                if (loaded?.tokens?.refreshToken) {
                    this.settings.tokens.refreshToken = loaded.tokens.refreshToken;
                    await setScopedSecret(scopedRefreshKey, loaded.tokens.refreshToken);
                } else if (storedScopedRefresh) {
                    this.settings.tokens.refreshToken = storedScopedRefresh;
                } else if (canMigrateLegacy) {
                    // Guard against pulling a legacy refresh token when this vault already stores a different client secret
                    const legacySecret = await getLegacySecret();
                    const secretMismatch = Boolean(
                        storedScopedSecret && legacySecret && storedScopedSecret !== legacySecret
                    );
                    if (!secretMismatch) {
                        const legacyRefresh = await anyApp.secretStorage.getSecret(LEGACY_SECRET_KEYS.refreshToken);
                        if (legacyRefresh) {
                            this.settings.tokens.refreshToken = legacyRefresh;
                            await setScopedSecret(scopedRefreshKey, legacyRefresh);
                        }
                    }
                }

                const storedScopedJson = await anyApp.secretStorage.getSecret(scopedCredsKey);
                if (loaded?.rawCredentialsJson) {
                    this.settings.rawCredentialsJson = loaded.rawCredentialsJson;
                    await setScopedSecret(scopedCredsKey, loaded.rawCredentialsJson);
                } else if (storedScopedJson) {
                    this.settings.rawCredentialsJson = storedScopedJson;
                } else if (canMigrateLegacy) {
                    const legacyJson = await anyApp.secretStorage.getSecret(LEGACY_SECRET_KEYS.googleCredentials);
                    if (legacyJson) {
                        this.settings.rawCredentialsJson = legacyJson;
                        await setScopedSecret(scopedCredsKey, legacyJson);
                    }
                }
            } catch (e) {
                console.error("[Health Connect] Error loading from SecretStorage:", e);
            }
        }

        // Ensure all modern default OAuth scopes (including write scopes) are present in settings
        const currentScopes = new Set(this.settings.requestedScopes || []);
        currentScopes.delete("https://www.googleapis.com/auth/googlehealth.activity.readonly");
        currentScopes.delete("https://www.googleapis.com/auth/googlehealth.mindfulness.writeonly");
        for (const defaultScope of DEFAULT_SETTINGS.requestedScopes) {
            currentScopes.add(defaultScope);
        }
        this.settings.requestedScopes = Array.from(currentScopes);

        // Upgrade migration: bind pre-existing auto-sync configs to the current device once
        const migratedOwnership = migrateAutoSyncOwnership(
            this.settings,
            this.getDeviceId(),
            this.getDeviceLabel()
        );
        if (migratedOwnership) {
            await this.saveSettings();
        }
    }

    async saveSettings() {
        if (this.settings.requestedScopes) {
            this.settings.requestedScopes = this.settings.requestedScopes.filter(s =>
                s !== "https://www.googleapis.com/auth/googlehealth.activity.readonly" &&
                s !== "https://www.googleapis.com/auth/googlehealth.mindfulness.writeonly"
            );
        }

        const anyApp = this.app as any;
        let hasSecretStorage = false;

        // Ensure secrets are persisted into vault-scoped SecretStorage (Keychain) if supported
        if (anyApp.secretStorage && typeof anyApp.secretStorage.setSecret === 'function') {
            try {
                if (this.settings.clientSecret) {
                    await anyApp.secretStorage.setSecret(
                        getVaultSecretKey(this.app, LEGACY_SECRET_KEYS.clientSecret),
                        this.settings.clientSecret
                    );
                }
                if (this.settings.tokens?.refreshToken) {
                    await anyApp.secretStorage.setSecret(
                        getVaultSecretKey(this.app, LEGACY_SECRET_KEYS.refreshToken),
                        this.settings.tokens.refreshToken
                    );
                }
                if (this.settings.rawCredentialsJson) {
                    await anyApp.secretStorage.setSecret(
                        getVaultSecretKey(this.app, LEGACY_SECRET_KEYS.googleCredentials),
                        this.settings.rawCredentialsJson
                    );
                }
                hasSecretStorage = true;
            } catch (e) {
                console.error("[Health Connect] Error writing to SecretStorage:", e);
            }
        }

        // Only sanitize data.json IF SecretStorage actually succeeded and is available
        if (hasSecretStorage) {
            const sanitized: Record<string, any> = Object.assign({}, this.settings);
            sanitized.clientSecret = "";
            sanitized.rawCredentialsJson = "";
            sanitized.tokens = {
                expiresAt: this.settings.tokens?.expiresAt || 0
            };
            await this.saveData(sanitized);
        } else {
            // SecretStorage is not available on this platform (standard Obsidian desktop)
            // Persist full settings including credentials in the plugin's local data.json
            await this.saveData(this.settings);
        }
    }
}
