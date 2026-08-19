import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import HealthConnectPlugin from "../main";
import { FoodLoggerModal } from "../views/FoodLoggerModal";
import { ManageKeysModal } from "../views/modals/ManageKeysModal";
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
        instructionsDetails.style.margin = '10px 0 15px 0';
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

            const bottomRow = cardsContainer.createDiv({ style: 'margin-top:14px; display:flex; justify-content:space-between; align-items:center;' });
            
            const addBtn = bottomRow.createEl('button', { text: '+ Add Metric', cls: 'mod-cta' });
            addBtn.onclick = async () => {
                const available = await this.plugin.getAvailableKeys();
                const key = available.find(k => !cards.some(c => c.key === k)) || "new_metric";
                const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                cards.push({
                    key,
                    label,
                    unit: "",
                    agg: "average",
                    chartType: "line",
                    color: "#3b82f6",
                    chartGroup: "Health",
                    showTile: true,
                    excludeWeekends: false
                });
                await this.plugin.saveSettings();
                renderCardsTable();
            };

            const manageKeysBtn = bottomRow.createEl('button', { text: '⚙️ Manage Available Keys Pool' });
            manageKeysBtn.onclick = () => {
                new ManageKeysModal(this.app, this.plugin, () => {
                    renderCardsTable();
                }).open();
            };
        };

        renderCardsTable();

        // Section 5: 🛡️ AI Custom Calculated Metric Builder
        containerEl.createEl("h3", { text: "5. 🛡️ AI Custom Calculated Metric Builder" });
        containerEl.createEl("p", { 
            text: "Select one or more input metric keys, describe a calculation in plain English, and append the custom computed card directly to your dashboard.",
            cls: "setting-item-description"
        });

        const builderCard = containerEl.createDiv();
        builderCard.style.border = "1px solid var(--background-modifier-border)";
        builderCard.style.borderRadius = "8px";
        builderCard.style.padding = "16px";
        builderCard.style.backgroundColor = "var(--background-secondary)";

        // 1. Select Input Keys
        builderCard.createEl("h4", { text: "1. Select Input Keys:" });
        const keysCheckGrid = builderCard.createDiv();
        keysCheckGrid.style.display = "grid";
        keysCheckGrid.style.gridTemplateColumns = "repeat(auto-fill, minmax(180px, 1fr))";
        keysCheckGrid.style.gap = "8px";
        keysCheckGrid.style.marginBottom = "15px";

        const selectedInputKeys: Set<string> = new Set();
        const availablePool = this.plugin.settings.customAvailableKeys || ["Sleep_hours", "Sleep_score", "Readiness", "HRV", "caffeine", "alcohol", "hydration", "protein", "calories"];
        
        availablePool.forEach(k => {
            const lbl = keysCheckGrid.createEl("label", { style: "display:flex; align-items:center; gap:6px; font-size:0.9em; cursor:pointer;" });
            const chk = lbl.createEl("input", { type: "checkbox" });
            chk.onchange = () => {
                if (chk.checked) selectedInputKeys.add(k);
                else selectedInputKeys.delete(k);
            };
            lbl.appendText(k);
        });

        // 2. Describe Calculation Logic
        builderCard.createEl("h4", { text: "2. Describe Calculation Logic:" });
        const logicTextarea = builderCard.createEl("textarea", { cls: "health-builder-textarea" });
        logicTextarea.style.width = "100%";
        logicTextarea.style.height = "70px";
        logicTextarea.style.marginBottom = "15px";
        logicTextarea.setAttribute("placeholder", "e.g. calculate the ratio of HRV to Sleep_hours, or calculate recovery balance");

        // 3. New Metric Details
        builderCard.createEl("h4", { text: "3. New Metric Details:" });
        const detailsGrid = builderCard.createDiv();
        detailsGrid.style.display = "grid";
        detailsGrid.style.gridTemplateColumns = "1fr 1fr";
        detailsGrid.style.gap = "10px";
        detailsGrid.style.marginBottom = "15px";

        const keyDiv = detailsGrid.createDiv();
        keyDiv.createEl("label", { text: "Key (no spaces, e.g. hrv_sleep_ratio):", style: "font-size:0.85em; font-weight:bold;" });
        const newKeyInput = keyDiv.createEl("input", { type: "text", placeholder: "hrv_sleep_ratio", style: "width:100%;" });

        const labelDiv = detailsGrid.createDiv();
        labelDiv.createEl("label", { text: "Label (Display Title):", style: "font-size:0.85em; font-weight:bold;" });
        const newLabelInput = labelDiv.createEl("input", { type: "text", placeholder: "HRV / Sleep Ratio", style: "width:100%;" });

        const unitDiv = detailsGrid.createDiv();
        unitDiv.createEl("label", { text: "Unit (e.g. ratio, score):", style: "font-size:0.85em; font-weight:bold;" });
        const newUnitInput = unitDiv.createEl("input", { type: "text", placeholder: "ratio", style: "width:100%;" });

        const aggDiv = detailsGrid.createDiv();
        aggDiv.createEl("label", { text: "Aggregation:", style: "font-size:0.85em; font-weight:bold;" });
        const newAggSelect = aggDiv.createEl("select", { style: "width:100%;" });
        newAggSelect.createEl("option", { value: "average", text: "Average" });
        newAggSelect.createEl("option", { value: "sum", text: "Sum" });

        const chartTypeDiv = detailsGrid.createDiv();
        chartTypeDiv.createEl("label", { text: "Chart Type:", style: "font-size:0.85em; font-weight:bold;" });
        const newChartSelect = chartTypeDiv.createEl("select", { style: "width:100%;" });
        newChartSelect.createEl("option", { value: "line", text: "Line Chart" });
        newChartSelect.createEl("option", { value: "bar", text: "Bar Chart" });

        const groupDiv = detailsGrid.createDiv();
        groupDiv.createEl("label", { text: "Chart Group (e.g. Health, Recovery):", style: "font-size:0.85em; font-weight:bold;" });
        const newGroupInput = groupDiv.createEl("input", { type: "text", placeholder: "Health", style: "width:100%;" });

        const colorDiv = builderCard.createDiv({ style: "margin-bottom:15px;" });
        colorDiv.createEl("label", { text: "Line / Bar Color:", style: "font-size:0.85em; font-weight:bold; display:block; margin-bottom:4px;" });
        const newColorInput = colorDiv.createEl("input", { type: "color", value: "#8b5cf6", style: "width:100%; height:36px; cursor:pointer;" });

        const compileBtnRow = builderCard.createDiv({ style: "display:flex; justify-content:flex-end;" });
        const compileBtn = compileBtnRow.createEl("button", { text: "🔮 Compile & Add Calculated Metric", cls: "mod-cta" });
        compileBtn.onclick = async () => {
            const key = newKeyInput.value.trim() || "calc_metric";
            const label = newLabelInput.value.trim() || "Calculated Metric";
            const unit = newUnitInput.value.trim();
            const color = newColorInput.value;
            const group = newGroupInput.value.trim() || "Health";

            this.plugin.settings.dashboardCards.push({
                key,
                label,
                unit,
                agg: newAggSelect.value as any,
                chartType: newChartSelect.value as any,
                color,
                chartGroup: group,
                showTile: true,
                excludeWeekends: false
            });

            if (!this.plugin.settings.customAvailableKeys.includes(key)) {
                this.plugin.settings.customAvailableKeys.push(key);
            }

            await this.plugin.saveSettings();
            new Notice(`Added calculated metric "${label}" to dashboard! 🔮`);
            renderCardsTable();
        };
    }
}
