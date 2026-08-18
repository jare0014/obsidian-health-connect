import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import HealthConnectPlugin from "../main";

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

        // Google OAuth Connection
        containerEl.createEl("h3", { text: "1. Google Cloud OAuth Configuration" });
        
        const isConnected = this.plugin.authService.isConnected();
        const statusText = isConnected ? "🟢 Connected & Authorized" : "🔴 Disconnected";

        new Setting(containerEl)
            .setName("Connection Status")
            .setDesc(statusText)
            .addButton(btn => btn
                .setButtonText(isConnected ? "Reconnect" : "Login with Google")
                .setCta()
                .onClick(() => {
                    if (!this.plugin.settings.clientId) {
                        new Notice("Please enter Client ID first!");
                        return;
                    }
                    window.open(this.plugin.authService.getAuthUrl(), "_blank");
                })
            );

        new Setting(containerEl)
            .setName("Google Client ID")
            .setDesc("OAuth 2.0 Client ID created in Google Cloud Console")
            .addText(text => text
                .setPlaceholder("e.g. 123456789-abc.apps.googleusercontent.com")
                .setValue(this.plugin.settings.clientId)
                .onChange(async (val) => {
                    this.plugin.settings.clientId = val.trim();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Google Client Secret")
            .setDesc("OAuth 2.0 Client Secret")
            .addText(text => text
                .setPlaceholder("Client secret key")
                .setValue(this.plugin.settings.clientSecret)
                .onChange(async (val) => {
                    this.plugin.settings.clientSecret = val.trim();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Paste Authorization Code")
            .setDesc("Paste the code returned by Google to complete authentication")
            .addText(text => text
                .setPlaceholder("4/0A...")
                .onChange(async (code) => {
                    if (code.trim().length > 10) {
                        const ok = await this.plugin.authService.exchangeAuthCode(code);
                        if (ok) this.display();
                    }
                })
            );

        // Daily Note Frontmatter Mappings
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

        // Dashboard Options
        containerEl.createEl("h3", { text: "3. Dashboard Options" });

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
