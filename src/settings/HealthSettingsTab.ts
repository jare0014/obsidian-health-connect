import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import HealthConnectPlugin from "../main";
import { FoodLoggerModal } from "../views/FoodLoggerModal";
import { HealthDashboardProcessor } from "../views/HealthDashboardProcessor";

export class HealthSettingsTab extends PluginSettingTab {
    plugin: HealthConnectPlugin;
    private isAddingMetric: boolean = false;

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

        // Connection Action Buttons (Connect/Re-authorize & Test)
        statusSetting.addButton(btn => btn
            .setButtonText(isConnected ? "Re-authorize Google" : "Connect Google Account")
            .setCta()
            .onClick(() => {
                this.plugin.oauthService.startOAuthFlow();
            })
        );

        statusSetting.addButton(btn => btn
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

        // Collapsible OAuth Scopes configuration
        const scopesDetails = containerEl.createEl('details');
        scopesDetails.style.margin = '10px 0 15px 0';
        scopesDetails.style.padding = '10px 14px';
        scopesDetails.style.border = '1px solid var(--background-modifier-border)';
        scopesDetails.style.borderRadius = '6px';
        
        const scopesSummary = scopesDetails.createEl('summary', { text: '▶ 🔐 Google Health OAuth Scopes Settings' });
        scopesSummary.style.cursor = 'pointer';
        scopesSummary.style.fontWeight = 'bold';
        scopesSummary.style.color = 'var(--text-accent)';

        const scopesContainer = scopesDetails.createDiv();
        scopesContainer.style.display = 'grid';
        scopesContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
        scopesContainer.style.gap = '8px';
        scopesContainer.style.marginTop = '10px';

        const availableScopes = [
            { label: "Sleep (Read)", scope: "https://www.googleapis.com/auth/googlehealth.sleep.readonly" },
            { label: "HRV & Vitals (Read)", scope: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly" },
            { label: "Activity & Fitness (Read)", scope: "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly" },
            { label: "Nutrition (Read)", scope: "https://www.googleapis.com/auth/googlehealth.nutrition.readonly" },
            { label: "Nutrition (Write)", scope: "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly" }
        ];

        availableScopes.forEach(item => {
            const lbl = scopesContainer.createEl('label', { 
                style: 'display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.9em;' 
            });
            const chk = lbl.createEl('input', { type: 'checkbox' });
            chk.checked = (this.plugin.settings.requestedScopes || []).includes(item.scope);
            chk.onchange = async () => {
                const cur = this.plugin.settings.requestedScopes || [];
                if (chk.checked) {
                    if (!cur.includes(item.scope)) cur.push(item.scope);
                } else {
                    this.plugin.settings.requestedScopes = cur.filter(s => s !== item.scope);
                }
                await this.plugin.saveSettings();
            };
            lbl.appendText(item.label);
        });

        // Sync Style
        new Setting(containerEl)
            .setName("Sync Style")
            .setDesc("Choose whether to sync Google Health data manually or automatically in the background.")
            .addDropdown(dropdown => dropdown
                .addOption("manual", "Manual (Button/Palette)")
                .addOption("automatic", "Automatic (Background Polling)")
                .setValue(this.plugin.settings.googleHealthSyncStyle || "manual")
                .onChange(async val => {
                    this.plugin.settings.googleHealthSyncStyle = val as any;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        // Sync Frequency (if automatic)
        if (this.plugin.settings.googleHealthSyncStyle === "automatic") {
            new Setting(containerEl)
                .setName("Sync Frequency (minutes)")
                .setDesc("Time interval between background Google Health checks.")
                .addText(text => text
                    .setPlaceholder("60")
                    .setValue(String(this.plugin.settings.googleHealthSyncInterval || 60))
                    .onChange(async val => {
                        this.plugin.settings.googleHealthSyncInterval = parseInt(val) || 60;
                        await this.plugin.saveSettings();
                    })
                );
        }

        // Collapsible Credentials Block (Client ID, Secret, JSON)
        const credsDetails = containerEl.createEl('details');
        credsDetails.style.margin = '10px 0 15px 0';
        credsDetails.style.padding = '10px 14px';
        credsDetails.style.border = '1px solid var(--background-modifier-border)';
        credsDetails.style.borderRadius = '6px';
        
        const credsSummary = credsDetails.createEl('summary', { text: '▶ 🔑 Google OAuth Client Credentials (ID, Secret, JSON)' });
        credsSummary.style.cursor = 'pointer';
        credsSummary.style.fontWeight = 'bold';
        credsSummary.style.color = 'var(--text-accent)';

        const credsContainer = credsDetails.createDiv({ cls: 'health-creds-container' });
        credsContainer.style.marginTop = '12px';

        // Client ID Input (Masked by default with eye toggle)
        const clientIdSetting = new Setting(credsContainer)
            .setName("Client ID")
            .setDesc("Your Google OAuth Client ID (masked for privacy)")
            .addText(text => {
                text.setPlaceholder("874915084786-xxxx.apps.googleusercontent.com")
                    .setValue(this.plugin.settings.clientId || "")
                    .onChange(async val => {
                        this.plugin.settings.clientId = val.trim();
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = "password";
                text.inputEl.style.marginRight = "6px";

                clientIdSetting.addExtraButton(btn => {
                    btn.setIcon("eye-off")
                        .setTooltip("Show/Hide Client ID")
                        .onClick(() => {
                            const isPassword = text.inputEl.type === "password";
                            text.inputEl.type = isPassword ? "text" : "password";
                            btn.setIcon(isPassword ? "eye" : "eye-off");
                        });
                });
            });

        // Client Secret Input (Masked by default with eye toggle)
        const secretSetting = new Setting(credsContainer)
            .setName("Client Secret")
            .setDesc("Your Google OAuth Client Secret (copied from Google Cloud Console)")
            .addText(text => {
                text.setPlaceholder("GOCSPX-xxxxxx")
                    .setValue(this.plugin.settings.clientSecret || "")
                    .onChange(async val => {
                        this.plugin.settings.clientSecret = val.trim();
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = "password";
                text.inputEl.style.marginRight = "6px";
                
                secretSetting.addExtraButton(btn => {
                    btn.setIcon("eye-off")
                        .setTooltip("Show/Hide Secret")
                        .onClick(() => {
                            const isPassword = text.inputEl.type === "password";
                            text.inputEl.type = isPassword ? "text" : "password";
                            btn.setIcon(isPassword ? "eye" : "eye-off");
                        });
                });
            });

        // Or Paste JSON (Masked & Protected)
        const hasSavedJson = Boolean(this.plugin.settings.rawCredentialsJson || (this.plugin.settings.clientId && this.plugin.settings.clientSecret));
        const jsonSetting = new Setting(credsContainer)
            .setName("Or Paste Full Client JSON")
            .setDesc(hasSavedJson 
                ? "Credentials JSON loaded & saved securely. Paste new JSON below only to replace." 
                : "Alternatively, paste the full downloaded credentials JSON here.");

        jsonSetting.addTextArea(text => {
            text.setPlaceholder(hasSavedJson ? "🔒 Credentials saved securely. Paste new JSON here to replace..." : '{"web":{"client_id":"...","client_secret":"..."}}')
                .setValue("")
                .onChange(async val => {
                    if (val.trim().startsWith("{")) {
                        const ok = await this.plugin.oauthService.parseAndApplyCredentialsJson(val.trim());
                        if (ok) {
                            text.setValue("");
                            this.display();
                        }
                    }
                });
            text.inputEl.rows = 2;
            text.inputEl.style.width = "100%";
        });

        if (hasSavedJson) {
            jsonSetting.addButton(btn => {
                btn.setButtonText("Clear Credentials")
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.clientId = "";
                        this.plugin.settings.clientSecret = "";
                        this.plugin.settings.rawCredentialsJson = "";
                        this.plugin.settings.tokens = {};
                        await this.plugin.saveSettings();
                        new Notice("Google credentials cleared.");
                        this.display();
                    });
            });
        }

        // Inline Collapsible GCP Instructions Guide
        const instructionsDetails = containerEl.createEl('details');
        instructionsDetails.style.margin = '10px 0 15px 0';
        instructionsDetails.style.padding = '12px 16px';
        instructionsDetails.style.backgroundColor = 'var(--background-secondary)';
        instructionsDetails.style.borderRadius = '8px';
        instructionsDetails.style.border = '1px solid var(--background-modifier-border)';

        const summary = instructionsDetails.createEl('summary', { text: '▶ Step-by-Step Google Cloud Setup Guide (Part 1: Project & Part 2: OAuth)' });
        summary.style.cursor = 'pointer';
        summary.style.fontWeight = 'bold';
        summary.style.color = 'var(--text-accent)';
        
        const instructionText = instructionsDetails.createDiv();
        instructionText.style.paddingTop = '10px';
        instructionText.style.lineHeight = '1.6';
        instructionText.innerHTML = `
            <div style="margin-bottom: 14px;">
                <h4 style="margin: 0 0 6px 0; color: var(--interactive-accent);">📁 Part 1: Create GCP Project & App Details Wizard</h4>
                <ol style="margin-left: 20px; padding-left: 0;">
                    <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" style="color: var(--interactive-accent); font-weight: 600;">Google Cloud Console</a>.</li>
                    <li>Click the project dropdown at the top-left -> Click <b>New Project</b> -> Name it <code>Obsidian-Health</code> -> Click <b>Create</b>.</li>
                    <li>In the initial setup wizard:
                        <ul style="margin: 4px 0 6px 15px;">
                            <li><b>App Information:</b> App Name = <code>Obsidian Health Connect</code></li>
                            <li><b>Audience:</b> Select <b>🔘 External</b> (required for personal Google accounts) -> Click <b>Next</b></li>
                            <li><b>Contact Information:</b> Enter your email for support and developer contacts -> Click <b>Finish</b></li>
                        </ul>
                    </li>
                </ol>
            </div>

            <div style="margin-bottom: 14px;">
                <h4 style="margin: 0 0 6px 0; color: var(--interactive-accent);">🛡️ Part 2: Enable Health API & Add Scopes</h4>
                <ol style="margin-left: 20px; padding-left: 0;">
                    <li>Click the <b>☰ Navigation Menu (hamburger icon)</b> at the top-left to expand the sidebar, then go to <b>APIs & Services > Library</b>.</li>
                    <li>Search for <b>Google Health API</b> (NOT Fitness API), and click <b>Enable</b>.</li>
                    <li>In the left sidebar, go to <b>APIs & Services > OAuth consent screen</b> (or <i>Data Access</i>), click <b>Add or Remove Scopes</b> and add:
                        <ul style="margin: 4px 0 6px 15px;">
                            <li><code>https://www.googleapis.com/auth/googlehealth.sleep.readonly</code> (Sleep duration & wake up)</li>
                            <li><code>https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly</code> (HRV & vitals)</li>
                            <li><code>https://www.googleapis.com/auth/googlehealth.activity.readonly</code> (Steps & active minutes)</li>
                            <li><code>https://www.googleapis.com/auth/googlehealth.nutrition.readonly</code> & <code>...writeonly</code> (Food logging & macros)</li>
                        </ul>
                    </li>
                    <li>Under <b>Test users</b> (Crucial), click <b>+ Add Users</b> and add your personal Gmail address. <i>(Tip: Click <b>Publish App</b> so your refresh token never expires after 7 days)</i>.</li>
                </ol>
            </div>

            <div style="margin-bottom: 14px;">
                <h4 style="margin: 0 0 6px 0; color: var(--interactive-accent);">🔑 Part 3: Create OAuth Client ID & Connect</h4>
                <ol style="margin-left: 20px; padding-left: 0;">
                    <li>In the ☰ sidebar, go to <b>APIs & Services > Credentials</b> (or <i>Clients</i>) -> <b>+ Create Credentials > OAuth client ID</b>.</li>
                    <li>Application type: <b>Web application</b>.</li>
                    <li>Name: <code>Obsidian Client</code>.</li>
                    <li>Authorized redirect URIs: <code>http://localhost:8092</code>.</li>
                    <li>Click <b>Create</b> -> Click <b>Download JSON</b>.</li>
                    <li>Open the downloaded JSON in Notepad, copy everything, paste it into the <b>OAuth Client JSON config</b> box above, and click <b>Connect Google Account</b>.</li>
                </ol>
            </div>
        `;

        // Collapsible Metric Mapping Sync Definitions
        const mappingsDetails = containerEl.createEl('details');
        mappingsDetails.style.margin = '15px 0';
        mappingsDetails.style.padding = '10px 14px';
        mappingsDetails.style.border = '1px solid var(--background-modifier-border)';
        mappingsDetails.style.borderRadius = '6px';
        mappingsDetails.createEl('summary', { text: '▶ 📊 Metric Mapping Sync Definitions', style: 'cursor:pointer; font-weight:bold; color:var(--text-accent);' });

        const metricsGrid = mappingsDetails.createDiv();
        metricsGrid.style.marginTop = '12px';

        const syncConfig = this.plugin.settings.healthSyncConfig || {};
        Object.keys(syncConfig).forEach(k => {
            const row = metricsGrid.createDiv();
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '10px';
            row.style.marginBottom = '8px';
            row.style.paddingBottom = '6px';
            row.style.borderBottom = '1px solid var(--background-modifier-border)';

            row.createSpan({ text: k.toUpperCase(), style: 'font-weight:bold; width:90px;' });

            const enableLabel = row.createEl('label', { style: 'display:flex; align-items:center; gap:4px; font-size:0.9em; min-width:65px;' });
            const enableCheck = enableLabel.createEl('input', { type: 'checkbox' });
            enableCheck.checked = syncConfig[k].enabled;
            enableCheck.onchange = async () => {
                syncConfig[k].enabled = enableCheck.checked;
                await this.plugin.saveSettings();
            };
            enableLabel.appendText('Sync');

            const destSelect = row.createEl('select', { style: 'flex:1.2; min-width:110px;' });
            destSelect.createEl('option', { value: 'frontmatter', text: 'Frontmatter' });
            destSelect.createEl('option', { value: 'inline', text: 'Inline Field' });
            destSelect.createEl('option', { value: 'append', text: 'Append Section' });
            destSelect.value = syncConfig[k].destination;
            destSelect.onchange = async () => {
                syncConfig[k].destination = destSelect.value as any;
                await this.plugin.saveSettings();
            };

            const keyInput = row.createEl('input', { type: 'text', placeholder: 'Target Key (e.g. HRV)', style: 'flex:1.5; min-width:110px;' });
            keyInput.value = syncConfig[k].key || '';
            keyInput.onchange = async () => {
                syncConfig[k].key = keyInput.value.trim();
                await this.plugin.saveSettings();
            };

            const styleSelect = row.createEl('select', { style: 'flex:1; min-width:90px;' });
            styleSelect.createEl('option', { value: 'manual', text: 'Manual' });
            styleSelect.createEl('option', { value: 'automatic', text: 'Auto Sync' });
            styleSelect.value = syncConfig[k].syncStyle || 'manual';
            styleSelect.onchange = async () => {
                syncConfig[k].syncStyle = styleSelect.value as any;
                await this.plugin.saveSettings();
            };
        });

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

        // Codeblock instructions & Live Preview Box
        const codeblockCard = containerEl.createDiv({ cls: "health-codeblock-card" });
        codeblockCard.style.padding = "14px 18px";
        codeblockCard.style.marginBottom = "20px";
        codeblockCard.style.backgroundColor = "var(--background-secondary)";
        codeblockCard.style.borderRadius = "8px";
        codeblockCard.style.border = "1px solid var(--interactive-accent)";

        const cbHeader = codeblockCard.createDiv({ style: "display:flex; justify-content:space-between; align-items:center;" });
        cbHeader.createSpan({ text: "📋 Embed Dashboard Codeblock:", style: "font-weight:bold; color:var(--text-accent);" });
        
        const cbActions = cbHeader.createDiv({ style: "display:flex; gap:8px;" });

        const copyCbBtn = cbActions.createEl("button", { text: "Copy Codeblock", cls: "mod-cta" });
        copyCbBtn.onclick = () => {
            navigator.clipboard.writeText("```health-dashboard\n```");
            new Notice("Copied ```health-dashboard``` codeblock to clipboard!");
        };

        const previewBtn = cbActions.createEl("button", { text: "👁️ Generate Live Preview" });
        let isPreviewOpen = false;
        const previewContainer = codeblockCard.createDiv({ style: "display:none; margin-top:15px; padding-top:15px; border-top:1px dashed var(--background-modifier-border);" });

        previewBtn.onclick = async () => {
            isPreviewOpen = !isPreviewOpen;
            if (isPreviewOpen) {
                previewContainer.style.display = "block";
                previewBtn.setText("Hide Preview");
                const processor = new HealthDashboardProcessor(this.app, this.plugin.settings, () => this.plugin.syncTodayHealth());
                await processor.render("", previewContainer);
            } else {
                previewContainer.style.display = "none";
                previewBtn.setText("👁️ Generate Live Preview");
            }
        };

        codeblockCard.createEl("p", { 
            text: "Add this codeblock anywhere in your Daily Notes, Weekly Reviews, or Dashboard notes. You can also override the rolling window with static dates or custom day ranges:",
            style: "margin: 8px 0 6px; font-size: 0.9em; color: var(--text-muted);"
        });

        const codePreview = codeblockCard.createEl("pre", { style: "margin:0; padding:10px; background:var(--background-primary); border-radius:4px; font-size:0.9em; line-height:1.4;" });
        codePreview.createEl("code", { text: "```health-dashboard\nfrom: 2026-08-01\nto: 2026-08-18\n# Or specify: days: 30, excludeWeekends: true\n```" });

        new Setting(containerEl)
            .setName("Date Range (Days)")
            .setDesc("Number of past days to query and display on the dashboard (default rolling window).")
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

        // Rich Metrics & Cards Display Config Table
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

            if (cards.length === 0) {
                cardsContainer.createDiv({ text: "No dashboard cards configured. Click '+ Add Metric' below to create one.", style: "color:var(--text-muted); margin-bottom:12px;" });
            } else {
                cards.forEach((card, index) => {
                    const row = cardsContainer.createDiv();
                    row.style.display = 'flex';
                    row.style.gap = '6px';
                    row.style.alignItems = 'center';
                    row.style.marginBottom = '8px';
                    row.style.paddingBottom = '8px';
                    row.style.borderBottom = '1px solid var(--background-modifier-border)';

                    const labelInput = row.createEl('input', { type: 'text', value: card.label });
                    labelInput.style.flex = '1.8';
                    labelInput.style.minWidth = '90px';
                    labelInput.setAttribute('placeholder', 'Label');
                    labelInput.onchange = async () => { card.label = labelInput.value.trim(); await this.plugin.saveSettings(); };

                    const keyInput = row.createEl('input', { type: 'text', value: card.key });
                    keyInput.style.flex = '1.8';
                    keyInput.style.minWidth = '90px';
                    keyInput.setAttribute('placeholder', 'Frontmatter Key');
                    keyInput.onchange = async () => { card.key = keyInput.value.trim(); await this.plugin.saveSettings(); };

                    const unitInput = row.createEl('input', { type: 'text', value: card.unit || '' });
                    unitInput.style.flex = '0.9';
                    unitInput.style.width = '50px';
                    unitInput.setAttribute('placeholder', 'Unit');
                    unitInput.onchange = async () => { card.unit = unitInput.value.trim(); await this.plugin.saveSettings(); };

                    const aggSelect = row.createEl('select', { style: 'flex:1.2; min-width:80px;' });
                    [['average', 'Average'], ['sum', 'Sum'], ['diff', 'Diff'], ['last', 'Last']].forEach(([v, l]) => {
                        const opt = aggSelect.createEl('option', { value: v, text: l });
                        if (card.agg === v) opt.selected = true;
                    });
                    aggSelect.onchange = async () => { card.agg = aggSelect.value as any; await this.plugin.saveSettings(); };

                    const chartSelect = row.createEl('select', { style: 'flex:1.2; min-width:85px;' });
                    [['line', 'Line Chart'], ['bar', 'Bar Chart'], ['none', 'No Chart']].forEach(([v, l]) => {
                        const opt = chartSelect.createEl('option', { value: v, text: l });
                        if (card.chartType === v) opt.selected = true;
                    });
                    chartSelect.onchange = async () => { card.chartType = chartSelect.value as any; await this.plugin.saveSettings(); };

                    const groupInput = row.createEl('input', { type: 'text', value: card.chartGroup || 'Health' });
                    groupInput.style.flex = '1.2';
                    groupInput.style.minWidth = '75px';
                    groupInput.setAttribute('placeholder', 'Chart Group');
                    groupInput.onchange = async () => { card.chartGroup = groupInput.value.trim(); await this.plugin.saveSettings(); };

                    const tileLabel = row.createEl('label', { style: 'display:flex; align-items:center; gap:3px; font-size:0.85em; white-space:nowrap;' });
                    const tileCheck = tileLabel.createEl('input', { type: 'checkbox' });
                    tileCheck.checked = card.showTile !== false;
                    tileLabel.appendText('Tile');
                    tileCheck.onchange = async () => { card.showTile = tileCheck.checked; await this.plugin.saveSettings(); };

                    const wkndLabel = row.createEl('label', { style: 'display:flex; align-items:center; gap:3px; font-size:0.85em; white-space:nowrap;' });
                    const wkndCheck = wkndLabel.createEl('input', { type: 'checkbox' });
                    wkndCheck.checked = card.excludeWeekends === true;
                    wkndLabel.appendText('Excl Wknd');
                    wkndCheck.onchange = async () => { card.excludeWeekends = wkndCheck.checked; await this.plugin.saveSettings(); };

                    const colorInput = row.createEl('input', { type: 'color', value: card.color || '#6366f1' });
                    colorInput.style.width = '35px';
                    colorInput.style.height = '30px';
                    colorInput.style.cursor = 'pointer';
                    colorInput.onchange = async () => { card.color = colorInput.value; await this.plugin.saveSettings(); };

                    const btnContainer = row.createDiv({ style: 'display:flex; gap:3px;' });

                    const upBtn = btnContainer.createEl('button', { text: '▲' });
                    upBtn.disabled = index === 0;
                    upBtn.onclick = async () => {
                        const temp = cards[index - 1];
                        cards[index - 1] = card;
                        cards[index] = temp;
                        await this.plugin.saveSettings();
                        renderCardsTable();
                    };

                    const downBtn = btnContainer.createEl('button', { text: '▼' });
                    downBtn.disabled = index === cards.length - 1;
                    downBtn.onclick = async () => {
                        const temp = cards[index + 1];
                        cards[index + 1] = card;
                        cards[index] = temp;
                        await this.plugin.saveSettings();
                        renderCardsTable();
                    };

                    const delBtn = btnContainer.createEl('button', { text: '🗑' });
                    delBtn.style.color = 'var(--text-error)';
                    delBtn.onclick = async () => {
                        cards.splice(index, 1);
                        await this.plugin.saveSettings();
                        renderCardsTable();
                    };
                });
            }

            // Inline Add Metric Controls
            const addMetricContainer = cardsContainer.createDiv({ style: 'margin-top:14px; padding-top:12px; border-top:1px dashed var(--background-modifier-border);' });

            if (!this.isAddingMetric) {
                const addBtn = addMetricContainer.createEl('button', { text: '+ Add Metric', cls: 'mod-cta' });
                addBtn.onclick = () => {
                    this.isAddingMetric = true;
                    renderCardsTable();
                };
            } else {
                const addRow = addMetricContainer.createDiv({ style: 'display:flex; gap:8px; align-items:center;' });
                addRow.createSpan({ text: 'Select Key:', style: 'font-weight:600; font-size:0.9em;' });

                const keySelect = addRow.createEl('select', { style: 'flex:1; max-width:250px;' });
                const standardKeys = [
                    "Sleep_hours", "Sleep_score", "Readiness", "HRV", "wake_up",
                    "caffeine", "alcohol", "hydration", "protein", "calories",
                    "steps", "active_minutes", "calories_burned", "workout"
                ];

                // Also merge any scanned keys from vault daily notes
                const files = this.app.vault.getMarkdownFiles().filter(f => /\d{4}-\d{2}-\d{2}/.test(f.basename)).slice(0, 15);
                const detectedKeys = new Set<string>(standardKeys);
                for (const f of files) {
                    const cache = this.app.metadataCache.getFileCache(f);
                    if (cache?.frontmatter) {
                        Object.keys(cache.frontmatter).forEach(k => {
                            if (!['position', 'tags', 'aliases'].includes(k)) detectedKeys.add(k);
                        });
                    }
                }

                Array.from(detectedKeys).forEach(k => {
                    keySelect.createEl('option', { value: k, text: k });
                });

                const confirmBtn = addRow.createEl('button', { text: 'Add', cls: 'mod-cta' });
                confirmBtn.onclick = async () => {
                    const selectedKey = keySelect.value;
                    const defaultLabel = selectedKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    
                    let defaultUnit = '';
                    let defaultAgg: any = 'average';
                    let defaultChart: any = 'line';
                    let defaultColor = '#6366f1';

                    if (selectedKey === 'Sleep_hours') { defaultUnit = 'hrs'; defaultColor = '#10b981'; }
                    else if (selectedKey === 'HRV') { defaultUnit = 'ms'; defaultColor = '#f59e0b'; }
                    else if (selectedKey === 'caffeine') { defaultUnit = 'mg'; defaultAgg = 'sum'; defaultChart = 'bar'; defaultColor = '#eab308'; }
                    else if (selectedKey === 'calories' || selectedKey === 'calories_burned') { defaultUnit = 'kcal'; defaultAgg = 'sum'; defaultChart = 'bar'; defaultColor = '#ef4444'; }
                    else if (selectedKey === 'hydration') { defaultUnit = 'ml'; defaultAgg = 'sum'; defaultChart = 'bar'; defaultColor = '#06b6d4'; }
                    else if (selectedKey === 'protein') { defaultUnit = 'g'; defaultAgg = 'sum'; defaultChart = 'bar'; defaultColor = '#8b5cf6'; }
                    else if (selectedKey === 'steps') { defaultUnit = 'steps'; defaultAgg = 'sum'; defaultChart = 'bar'; defaultColor = '#10b981'; }

                    cards.push({
                        key: selectedKey,
                        label: defaultLabel,
                        unit: defaultUnit,
                        agg: defaultAgg,
                        chartType: defaultChart,
                        color: defaultColor,
                        chartGroup: "Health",
                        showTile: true,
                        excludeWeekends: false
                    });

                    await this.plugin.saveSettings();
                    this.isAddingMetric = false;
                    renderCardsTable();
                };

                const cancelBtn = addRow.createEl('button', { text: 'Cancel' });
                cancelBtn.onclick = () => {
                    this.isAddingMetric = false;
                    renderCardsTable();
                };
            }
        };

        renderCardsTable();
    }
}
