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

        // Section 1: Google Cloud OAuth Connection
        containerEl.createEl("h3", { text: "1. Google Health API & OAuth 2.0" });
        
        const isConnected = this.plugin.oauthService.isConnected();
        const statusSetting = new Setting(containerEl)
            .setName("Connection Status")
            .setDesc(isConnected ? "Authorized and ready to sync with Google Health v4 REST API" : "Disconnected. Configure credentials below.");

        statusSetting.controlEl.createDiv({
            cls: `health-status-badge ${isConnected ? 'status-connected' : 'status-disconnected'}`,
            text: isConnected ? "🟢 Connected" : "🔴 Disconnected"
        });

        // JSON Paste Spot
        new Setting(containerEl)
            .setName("OAuth Client JSON config")
            .setDesc("Paste the content of your downloaded Google OAuth Client Secrets JSON.")
            .addTextArea(text => {
                text.setPlaceholder('{"web":{"client_id":"...","client_secret":"..."}}')
                    .setValue(this.plugin.settings.rawCredentialsJson || "")
                    .onChange(async val => {
                        if (val.trim().startsWith("{")) {
                            const ok = await this.plugin.oauthService.parseAndApplyCredentialsJson(val.trim());
                            if (ok) this.display();
                        }
                    });
                text.inputEl.rows = 4;
                text.inputEl.style.width = "100%";
            });

        // Inline Collapsible GCP Instructions Guide
        const instructionsDetails = containerEl.createEl('details');
        instructionsDetails.style.margin = '10px 0 20px 0';
        instructionsDetails.style.padding = '12px 16px';
        instructionsDetails.style.backgroundColor = 'var(--background-secondary)';
        instructionsDetails.style.borderRadius = '8px';
        instructionsDetails.style.border = '1px solid var(--background-modifier-border)';

        const summary = instructionsDetails.createEl('summary', { text: '▶ How to get Google Cloud Credentials' });
        summary.style.cursor = 'pointer';
        summary.style.fontWeight = 'bold';
        summary.style.color = 'var(--text-accent)';
        
        const instructionText = instructionsDetails.createDiv();
        instructionText.style.paddingTop = '10px';
        instructionText.style.lineHeight = '1.6';
        instructionText.innerHTML = `
            <ol style="margin-left: 20px; padding-left: 0;">
                <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" style="color: var(--interactive-accent); font-weight: 600;">Google Cloud Console</a>.</li>
                <li>Create a project and enable the <b>Google Health API</b> (NOT Fitness API).</li>
                <li>Configure the OAuth consent screen with the following scopes:
                    <ul style="margin: 6px 0;">
                        <li><code>https://www.googleapis.com/auth/googlehealth.sleep.readonly</code></li>
                        <li><code>https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly</code></li>
                        <li><code>https://www.googleapis.com/auth/googlehealth.nutrition.readonly</code></li>
                        <li><code>https://www.googleapis.com/auth/googlehealth.nutrition.writeonly</code></li>
                    </ul>
                </li>
                <li>Go to <b>Credentials</b> -> Create Credentials -> <b>OAuth client ID</b>.</li>
                <li>Select Application type: <b>Web application</b>.</li>
                <li>Add <code>http://localhost:8092</code> to Authorized redirect URIs.</li>
                <li>Click Create, then click <b>Download JSON</b>.</li>
                <li>Open the JSON file in Notepad, copy everything, and paste it into the field above.</li>
            </ol>
        `;

        // Authorization Tools
        const authTools = new Setting(containerEl)
            .setName("Authorization Tools")
            .setDesc("Connect Google Account or test existing connection");

        authTools.addButton(btn => btn
            .setButtonText(isConnected ? "Re-authorize Google" : "Connect Google Account")
            .setCta()
            .onClick(() => {
                this.plugin.oauthService.startOAuthFlow();
            })
        );

        authTools.addButton(btn => btn
            .setButtonText("Test Connection")
            .onClick(async () => {
                btn.setButtonText("Testing... ⏳");
                const res = await this.plugin.oauthService.testConnection();
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

        // Section 2: Local Food & Drink Registry
        containerEl.createEl("h3", { text: "2. Local Go-To Food & Beverage Registry" });
        containerEl.createEl("p", { text: "Pre-configured items for the 1-click Quick Log modal.", cls: "setting-item-description" });

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

        // Section 3: Dashboard Display & Metric Cards Config
        containerEl.createEl("h3", { text: "3. Dashboard Display & Metrics Configuration" });

        new Setting(containerEl)
            .setName("Rolling History Window (Days)")
            .setDesc("Number of past daily notes to analyze in the dashboard")
            .addSlider(slider => slider
                .setLimits(7, 30, 1)
                .setValue(this.plugin.settings.dashboardDateRange)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.dashboardDateRange = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Exclude Weekends")
            .setDesc("Toggle whether Saturday and Sunday are excluded from baseline averages")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.dashboardExcludeWeekends)
                .onChange(async v => {
                    this.plugin.settings.dashboardExcludeWeekends = v;
                    await this.plugin.saveSettings();
                })
            );
    }
}
