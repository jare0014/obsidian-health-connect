import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import HealthConnectPlugin from "../main";
import { FoodLoggerModal } from "../views/FoodLoggerModal";
import { DashboardCard } from "../models/HealthSettings";

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
                <li><b>Important (Test Users & Token Expiry):</b> Add your Gmail address under <b>Test users</b>. (Tip: Click <b>Publish App</b> so refresh tokens do not expire after 7 days).</li>
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
        containerEl.createEl("h3", { text: "2. 🥗 Food & Beverage Registry" });

        new Setting(containerEl)
            .setName("Food Registry & Logger GUI")
            .setDesc("Open the full GUI modal to quickly log nutrition, add custom foods, or manage your stored items.")
            .addButton(btn => btn
                .setButtonText("Open Food Registry & Logger")
                .setCta()
                .onClick(() => {
                    new FoodLoggerModal(this.app, this.plugin, 'manage').open();
                })
            );

        // Section 3: 🎛️ Meta Bind Buttons & Shortcuts Wizard
        containerEl.createEl("h3", { text: "3. 🎛️ Meta Bind Buttons & Shortcuts Wizard" });
        containerEl.createEl("p", { 
            text: "Easily embed 1-click interactive buttons into your Daily Notes or Dashboards using Meta Bind.",
            cls: "setting-item-description" 
        });

        const metaBindButtons = this.plugin.metaBindService.getDefaultButtons();
        for (const btnDef of metaBindButtons) {
            const btnSetting = new Setting(containerEl)
                .setName(btnDef.label)
                .setDesc(`Snippet: \`BUTTON[${btnDef.id}]\``);

            btnSetting.addButton(btn => btn
                .setButtonText("Copy Snippet")
                .onClick(() => {
                    navigator.clipboard.writeText(`\`BUTTON[${btnDef.id}]\``);
                    new Notice(`Copied \`BUTTON[${btnDef.id}]\` to clipboard!`);
                })
            );

            btnSetting.addButton(btn => btn
                .setButtonText("Register in Meta Bind")
                .setCta()
                .onClick(async () => {
                    await this.plugin.metaBindService.registerButton(btnDef);
                })
            );
        }

        // Section 4: 📊 Dashboard Settings & Metrics Display Config
        containerEl.createEl("h3", { text: "4. 📊 Dashboard Settings & Display Config" });

        // Codeblock instructions callout
        const codeblockCard = containerEl.createDiv({ cls: "health-codeblock-card" });
        codeblockCard.style.padding = "12px 16px";
        codeblockCard.style.marginBottom = "15px";
        codeblockCard.style.backgroundColor = "var(--background-secondary)";
        codeblockCard.style.borderRadius = "8px";
        codeblockCard.style.border = "1px solid var(--interactive-accent)";

        const cbHeader = codeblockCard.createDiv({ style: "display:flex; justify-content:space-between; align-items:center;" });
        cbHeader.createSpan({ text: "📋 Embed Dashboard Codeblock:", style: "font-weight:bold; color:var(--text-accent);" });
        
        const copyCbBtn = cbHeader.createEl("button", { text: "Copy Codeblock", cls: "mod-cta" });
        copyCbBtn.onclick = () => {
            navigator.clipboard.writeText("```health-dashboard\n```");
            new Notice("Copied ```health-dashboard``` codeblock to clipboard!");
        };

        codeblockCard.createEl("p", { 
            text: "Add this codeblock anywhere in your Daily Notes, Weekly Reviews, or Dashboard notes to display the visual health dashboard:",
            style: "margin: 8px 0 4px; font-size: 0.9em; color: var(--text-muted);"
        });
        const codePreview = codeblockCard.createEl("pre", { style: "margin:0; padding:8px; background:var(--background-primary); border-radius:4px;" });
        codePreview.createEl("code", { text: "```health-dashboard\n```" });

        new Setting(containerEl)
            .setName("Date Range (Days)")
            .setDesc("Number of past days to query and display on the dashboard.")
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
            .setDesc("Toggle whether Saturday and Sunday are excluded from calculated baseline averages.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.dashboardExcludeWeekends)
                .onChange(async v => {
                    this.plugin.settings.dashboardExcludeWeekends = v;
                    await this.plugin.saveSettings();
                })
            );

        // Metrics Table
        containerEl.createEl("h4", { text: "Metrics & Cards Display Config" });
        const cardsContainer = containerEl.createDiv();
        cardsContainer.style.border = "1px solid var(--background-modifier-border)";
        cardsContainer.style.borderRadius = "8px";
        cardsContainer.style.padding = "15px";
        cardsContainer.style.marginBottom = "20px";
        cardsContainer.style.backgroundColor = "var(--background-secondary)";

        const renderCardsTable = () => {
            cardsContainer.empty();
            const cards = this.plugin.settings.dashboardCards || [];

            // Table Header
            const headerRow = cardsContainer.createDiv({ style: "display:flex; gap:8px; font-weight:bold; margin-bottom:8px; color:var(--text-muted); font-size:0.85em;" });
            headerRow.createDiv({ text: "Frontmatter Key", style: "flex:2;" });
            headerRow.createDiv({ text: "Display Label", style: "flex:2;" });
            headerRow.createDiv({ text: "Unit", style: "flex:1;" });
            headerRow.createDiv({ text: "Aggregation", style: "flex:1.5;" });
            headerRow.createDiv({ text: "Color", style: "flex:1;" });
            headerRow.createDiv({ text: "Actions", style: "width:60px; text-align:right;" });

            cards.forEach((card, index) => {
                const row = cardsContainer.createDiv({ style: "display:flex; gap:8px; align-items:center; margin-bottom:8px;" });

                const keyInput = row.createEl("input", { type: "text", value: card.key, style: "flex:2;" });
                keyInput.onchange = async () => { card.key = keyInput.value.trim(); await this.plugin.saveSettings(); };

                const labelInput = row.createEl("input", { type: "text", value: card.label, style: "flex:2;" });
                labelInput.onchange = async () => { card.label = labelInput.value.trim(); await this.plugin.saveSettings(); };

                const unitInput = row.createEl("input", { type: "text", value: card.unit || "", style: "flex:1;" });
                unitInput.onchange = async () => { card.unit = unitInput.value.trim(); await this.plugin.saveSettings(); };

                const aggSelect = row.createEl("select", { style: "flex:1.5;" });
                aggSelect.createEl("option", { value: "average", text: "Average" });
                aggSelect.createEl("option", { value: "sum", text: "Sum" });
                aggSelect.createEl("option", { value: "last", text: "Last Value" });
                aggSelect.value = card.agg;
                aggSelect.onchange = async () => { card.agg = aggSelect.value as any; await this.plugin.saveSettings(); };

                const colorInput = row.createEl("input", { type: "color", value: card.color || "#6366f1", style: "flex:1; height:32px; cursor:pointer;" });
                colorInput.onchange = async () => { card.color = colorInput.value; await this.plugin.saveSettings(); };

                const delBtn = row.createEl("button", { text: "✕", style: "width:40px; color:var(--text-error);" });
                delBtn.onclick = async () => {
                    this.plugin.settings.dashboardCards.splice(index, 1);
                    await this.plugin.saveSettings();
                    renderCardsTable();
                };
            });

            const addRow = cardsContainer.createDiv({ style: "margin-top:12px; display:flex; justify-content:flex-start;" });
            const addBtn = addRow.createEl("button", { text: "+ Add Metric Card", cls: "mod-cta" });
            addBtn.onclick = async () => {
                this.plugin.settings.dashboardCards.push({
                    key: "new_metric",
                    label: "New Metric",
                    unit: "",
                    agg: "average",
                    chartType: "line",
                    color: "#3b82f6"
                });
                await this.plugin.saveSettings();
                renderCardsTable();
            };
        };

        renderCardsTable();
    }
}
