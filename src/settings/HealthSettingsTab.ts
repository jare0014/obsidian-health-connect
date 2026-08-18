import { App, PluginSettingTab, Setting, Notice, Modal } from "obsidian";
import HealthConnectPlugin from "../main";

export class GcpInstructionsModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "☁️ Google Cloud Console Setup Guide" });

        const body = contentEl.createDiv();
        body.innerHTML = `
            <ol style="line-height: 1.6; padding-left: 20px;">
                <li>Open the <a href="https://console.cloud.google.com/" target="_blank" style="color: var(--text-accent); font-weight: bold;">Google Cloud Console</a>.</li>
                <li>Create a new project (e.g. <b>Obsidian Health Connect</b>).</li>
                <li>Navigate to <b>APIs & Services > Library</b>, search for <b>Fitness API</b>, and click <b>Enable</b>.</li>
                <li>Go to <b>OAuth consent screen</b>:
                    <ul>
                        <li>Select <b>External</b>, enter App name and your email.</li>
                        <li>Add required scopes: <code>fitness.sleep.read</code>, <code>fitness.heart_rate.read</code>, <code>fitness.nutrition.read</code>, <code>fitness.nutrition.write</code>, <code>fitness.hydration.read</code>, <code>fitness.hydration.write</code>.</li>
                        <li>Add your own Gmail address as a <b>Test User</b>.</li>
                    </ul>
                </li>
                <li>Go to <b>Credentials > Create Credentials > OAuth client ID</b>:
                    <ul>
                        <li>Application type: <b>Web application</b>.</li>
                        <li>Name: <code>Obsidian Health Client</code>.</li>
                        <li>Authorized redirect URIs: <code>http://localhost:8092</code>.</li>
                    </ul>
                </li>
                <li>Click <b>Create</b>, then click <b>Download JSON</b>.</li>
                <li>Open the JSON file in Notepad, copy everything, and paste it into the <b>Paste Credentials JSON</b> box in settings!</li>
            </ol>
        `;
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class HealthSettingsTab extends PluginSettingTab {
    plugin: HealthConnectPlugin;

    constructor(app: App, plugin: HealthConnectPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Health Connect & Readiness Settings" });

        // Sponsor Banner
        const sponsorCard = containerEl.createDiv({ cls: "health-sponsor-card" });
        const sponsorText = sponsorCard.createDiv({ cls: "health-sponsor-text" });
        sponsorText.createEl("h4", { text: "❤️ Support the Developer" });
        sponsorText.createEl("p", { text: "If this plugin saves you time and keeps your health on track, consider buying a coffee to support active updates!" });
        
        const sponsorBtn = sponsorCard.createEl("a", { 
            cls: "health-sponsor-btn", 
            text: "☕ Buy Me a Coffee", 
            href: "https://buymeacoffee.com/alexjarecki" 
        });
        sponsorBtn.setAttribute("target", "_blank");

        // Section 1: Google Cloud Connection & Keychain
        containerEl.createEl("h3", { text: "1. Google Cloud OAuth & Keychain Configuration" });
        
        const isConnected = this.plugin.authService.isConnected();

        const statusSetting = new Setting(containerEl)
            .setName("Live Connection Status")
            .setDesc(isConnected ? "Authorized and ready to sync with Google Health / Fitbit" : "Disconnected. Configure credentials below.");

        // Pulsing status badge
        const badge = statusSetting.controlEl.createDiv({ 
            cls: `health-status-badge ${isConnected ? 'status-connected' : 'status-disconnected'}`,
            text: isConnected ? "🟢 Connected" : "🔴 Disconnected"
        });

        // Instructions Modal Button
        new Setting(containerEl)
            .setName("Setup Helper Guide")
            .setDesc("Open the step-by-step Google Cloud Console wizard with direct link")
            .addButton(btn => btn
                .setButtonText("📖 Open GCP Setup Guide")
                .onClick(() => {
                    new GcpInstructionsModal(this.app).open();
                })
            );

        // Paste JSON Textarea
        new Setting(containerEl)
            .setName("Paste Credentials JSON")
            .setDesc("Paste the downloaded credentials.json file from Google Cloud. Client ID & Secret will be extracted and saved to your Keychain.")
            .addTextArea(text => {
                text.setPlaceholder('{"web":{"client_id":"...","client_secret":"..."}}')
                    .setValue(this.plugin.settings.rawCredentialsJson || "")
                    .onChange(async (val) => {
                        if (val.trim().startsWith("{")) {
                            const ok = await this.plugin.authService.parseAndApplyCredentialsJson(val.trim());
                            if (ok) this.display();
                        }
                    });
                text.inputEl.rows = 4;
                text.inputEl.style.width = "100%";
            });

        // Individual Client ID / Secret overrides
        new Setting(containerEl)
            .setName("Client ID")
            .setDesc("Extracted from JSON or entered manually")
            .addText(text => text
                .setValue(this.plugin.settings.clientId)
                .onChange(async val => {
                    this.plugin.settings.clientId = val.trim();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Client Secret")
            .setDesc("Stored securely in system Keychain / Secret Storage")
            .addText(text => {
                text.inputEl.type = "password";
                text.setValue(this.plugin.settings.clientSecret)
                    .onChange(async val => {
                        this.plugin.settings.clientSecret = val.trim();
                        await this.plugin.saveSettings();
                    });
            });

        // Connection Action Tools
        const authTools = new Setting(containerEl)
            .setName("Authorization Tools")
            .setDesc("Authorize account or test active API connection");

        authTools.addButton(btn => btn
            .setButtonText(isConnected ? "Re-authorize Google" : "Connect Google Account")
            .setCta()
            .onClick(() => {
                if (!this.plugin.settings.clientId) {
                    new Notice("Please paste your credentials JSON first!");
                    return;
                }
                window.open(this.plugin.authService.getAuthUrl(), "_blank");
            })
        );

        authTools.addButton(btn => btn
            .setButtonText("Test Connection")
            .onClick(async () => {
                btn.setButtonText("Testing... ⏳");
                const res = await this.plugin.authService.testConnection();
                if (res.ok) {
                    new Notice(res.message);
                    btn.setButtonText("Success! 🟢");
                } else {
                    new Notice(`Connection failed: ${res.message}`);
                    btn.setButtonText("Failed 🔴");
                }
                setTimeout(() => { btn.setButtonText("Test Connection"); }, 3000);
            })
        );

        new Setting(containerEl)
            .setName("Paste Authorization Code")
            .setDesc("Paste the code from Google's consent screen to complete login")
            .addText(text => text
                .setPlaceholder("4/0A...")
                .onChange(async (code) => {
                    if (code.trim().length > 10) {
                        const ok = await this.plugin.authService.exchangeAuthCode(code);
                        if (ok) this.display();
                    }
                })
            );

        // Section 2: Daily Note Frontmatter Mappings
        containerEl.createEl("h3", { text: "2. Daily Note Frontmatter Key Mappings" });

        const mappings = this.plugin.settings.fieldMappings;

        new Setting(containerEl)
            .setName("Sleep Hours Key")
            .setDesc("Frontmatter property for sleep duration (H:MM)")
            .addText(text => text
                .setValue(mappings.sleepHoursKey)
                .onChange(async v => { mappings.sleepHoursKey = v.trim(); await this.plugin.saveSettings(); })
            );

        new Setting(containerEl)
            .setName("HRV Key")
            .setDesc("Frontmatter property for RMSSD Heart Rate Variability (ms)")
            .addText(text => text
                .setValue(mappings.hrvKey)
                .onChange(async v => { mappings.hrvKey = v.trim(); await this.plugin.saveSettings(); })
            );

        new Setting(containerEl)
            .setName("Readiness Key")
            .setDesc("Frontmatter property for calculated Readiness Index")
            .addText(text => text
                .setValue(mappings.readinessKey)
                .onChange(async v => { mappings.readinessKey = v.trim(); await this.plugin.saveSettings(); })
            );

        new Setting(containerEl)
            .setName("Hydration Key")
            .setDesc("Frontmatter property for water intake (fl oz)")
            .addText(text => text
                .setValue(mappings.hydrationKey)
                .onChange(async v => { mappings.hydrationKey = v.trim(); await this.plugin.saveSettings(); })
            );

        new Setting(containerEl)
            .setName("Caffeine Key")
            .setDesc("Frontmatter property for caffeine intake (mg)")
            .addText(text => text
                .setValue(mappings.caffeineKey)
                .onChange(async v => { mappings.caffeineKey = v.trim(); await this.plugin.saveSettings(); })
            );

        // Section 3: Food & Nutrition Go-To Registry
        containerEl.createEl("h3", { text: "3. Go-To Food & Beverage Registry" });
        containerEl.createEl("p", { text: "Pre-configured items for the 1-click Food Logger Modal.", cls: "setting-item-description" });

        this.plugin.settings.foodRegistry.forEach((item, index) => {
            new Setting(containerEl)
                .setName(`${item.name} (${item.unit})`)
                .setDesc(`Category: ${item.category} | ${item.caffeineMg ? item.caffeineMg + 'mg caffeine ' : ''}${item.proteinG ? item.proteinG + 'g protein ' : ''}${item.calories ? item.calories + 'kcal ' : ''}${item.waterMl ? item.waterMl + 'ml water' : ''}`)
                .addButton(btn => btn
                    .setButtonText("Delete")
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.foodRegistry.splice(index, 1);
                        await this.plugin.saveSettings();
                        this.display();
                    })
                );
        });

        // Section 4: Dashboard Options
        containerEl.createEl("h3", { text: "4. Dashboard Options" });

        new Setting(containerEl)
            .setName("Rolling History Window (Days)")
            .setDesc("Number of past daily notes to analyze in the dashboard")
            .addSlider(slider => slider
                .setLimits(7, 30, 1)
                .setValue(this.plugin.settings.dashboardDays)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.dashboardDays = v;
                    await this.plugin.saveSettings();
                })
            );
    }
}
