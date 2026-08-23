import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import HealthConnectPlugin from "../main";
import { FoodLoggerModal } from "../views/FoodLoggerModal";
import { HealthDashboardProcessor } from "../views/HealthDashboardProcessor";
import { FormulaEvaluator } from "../services/FormulaEvaluator";
import { CalculatedMetric } from "../models/HealthSettings";

export class HealthSettingsTab extends PluginSettingTab {
    plugin: HealthConnectPlugin;
    private isAddingMetric: boolean = false;
    private isCreatingFormula: boolean = false;

    constructor(app: App, plugin: HealthConnectPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Health Connect & Dashboard Settings" });

        // Sponsor Banner
        const sponsorCard = containerEl.createDiv({ cls: "health-sponsor-card" });
        const sponsorText = sponsorCard.createDiv({ cls: "health-sponsor-text" });
        sponsorText.createEl("h4", { text: "❤️ Support the Developer" });
        sponsorText.createEl("p", { text: "If this plugin saves you time and keeps your health habits on track, consider buying a coffee to support active updates!" });
        
        const sponsorBtn = sponsorCard.createEl("a", { 
            cls: "health-sponsor-btn", 
            text: "☕ Buy Me a Coffee", 
            href: "https://buymeacoffee.com/jare0014" 
        });
        sponsorBtn.setAttribute("target", "_blank");

        // ==========================================
        // SECTION: 📊 Dashboard Settings & Display Config
        // ==========================================
        containerEl.createEl("h3", { text: "📊 Dashboard Settings & Display Config" });

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
        codePreview.createEl("code", { text: "```health-dashboard\nfrom: 2026-08-01\nto: 2026-08-23\n# Or specify: days: 30, excludeWeekends: true\n```" });

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

        // Dashboard Metrics & Cards Display Config Table
        containerEl.createEl("h4", { text: "Metrics & Cards Display Config" });
        const cardsContainer = containerEl.createDiv();
        cardsContainer.style.border = "1px solid var(--background-modifier-border)";
        cardsContainer.style.borderRadius = "8px";
        cardsContainer.style.padding = "15px";
        cardsContainer.style.marginBottom = "25px";
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
                    keyInput.setAttribute('placeholder', 'Key / Property');
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
                    groupInput.setAttribute('placeholder', 'Group');
                    groupInput.onchange = async () => { card.chartGroup = groupInput.value.trim(); await this.plugin.saveSettings(); };

                    const tileLabel = row.createEl('label', { style: 'display:flex; align-items:center; gap:3px; font-size:0.85em; white-space:nowrap;' });
                    const tileCheck = tileLabel.createEl('input', { type: 'checkbox' });
                    tileCheck.checked = card.showTile !== false;
                    tileLabel.appendText('Tile');
                    tileCheck.onchange = async () => { card.showTile = tileCheck.checked; await this.plugin.saveSettings(); };

                    const colorInput = row.createEl('input', { type: 'color', value: card.color || '#6366f1' });
                    colorInput.style.width = '32px';
                    colorInput.style.height = '28px';
                    colorInput.style.padding = '0';
                    colorInput.style.cursor = 'pointer';
                    colorInput.onchange = async () => { card.color = colorInput.value; await this.plugin.saveSettings(); };

                    const btnContainer = row.createDiv({ style: 'display:flex; gap:3px;' });
                    const upBtn = btnContainer.createEl('button', { text: '↑' });
                    upBtn.disabled = index === 0;
                    upBtn.onclick = async () => {
                        const temp = cards[index - 1];
                        cards[index - 1] = card;
                        cards[index] = temp;
                        await this.plugin.saveSettings();
                        renderCardsTable();
                    };

                    const downBtn = btnContainer.createEl('button', { text: '↓' });
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
                const addBtn = addMetricContainer.createEl('button', { text: '+ Add Metric Card', cls: 'mod-cta' });
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

                const files = this.app.vault.getMarkdownFiles().filter(f => /\d{4}-\d{2}-\d{2}/.test(f.basename)).slice(0, 20);
                const detectedKeys = new Set<string>(standardKeys);
                for (const f of files) {
                    const cache = this.app.metadataCache.getFileCache(f);
                    if (cache?.frontmatter) {
                        Object.keys(cache.frontmatter).forEach(k => {
                            if (!['position', 'tags', 'aliases'].includes(k)) detectedKeys.add(k);
                        });
                    }
                }
                // Include any calculated metric keys
                (this.plugin.settings.calculatedMetrics || []).forEach(m => detectedKeys.add(m.key));

                Array.from(detectedKeys).sort().forEach(k => {
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
                    else if (selectedKey === 'caffeine') { defaultUnit = 'mg'; defaultAgg = 'average'; defaultChart = 'bar'; defaultColor = '#eab308'; }
                    else if (selectedKey === 'active_minutes') { defaultUnit = 'm'; defaultAgg = 'average'; defaultChart = 'bar'; defaultColor = '#10b981'; }
                    else if (selectedKey === 'workout') { defaultUnit = 'm'; defaultAgg = 'sum'; defaultChart = 'bar'; defaultColor = '#f97316'; }
                    else if (selectedKey === 'calories' || selectedKey === 'calories_burned') { defaultUnit = 'kcal'; defaultAgg = 'average'; defaultChart = 'bar'; defaultColor = '#ef4444'; }
                    else if (selectedKey === 'hydration') { defaultUnit = 'oz'; defaultAgg = 'sum'; defaultChart = 'bar'; defaultColor = '#06b6d4'; }
                    else if (selectedKey === 'protein') { defaultUnit = 'g'; defaultAgg = 'average'; defaultChart = 'bar'; defaultColor = '#8b5cf6'; }
                    else if (selectedKey === 'steps') { defaultUnit = 'steps'; defaultAgg = 'sum'; defaultChart = 'bar'; defaultColor = '#3b82f6'; }

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

        // ==========================================
        // SECTION: 🧮 Custom Calculated Metrics (Formula Builder)
        // ==========================================
        containerEl.createEl("h3", { text: "🧮 Custom Calculated Metrics (Formula Builder)" });
        containerEl.createEl("p", {
            text: "Create new metrics using spreadsheet-style mathematical formulas combining existing variables (e.g. (protein * 4) + (carbs * 4) + (fat * 9) or (HRV / 60) * (Sleep_hours / 8) * 100).",
            cls: "setting-item-description"
        });

        const formulasContainer = containerEl.createDiv();
        formulasContainer.style.border = "1px solid var(--background-modifier-border)";
        formulasContainer.style.borderRadius = "8px";
        formulasContainer.style.padding = "15px";
        formulasContainer.style.marginBottom = "25px";
        formulasContainer.style.backgroundColor = "var(--background-secondary)";

        const renderFormulasTable = () => {
            formulasContainer.empty();
            const calcs = this.plugin.settings.calculatedMetrics || [];

            if (calcs.length === 0) {
                formulasContainer.createDiv({ 
                    text: "No custom calculated metrics configured yet. Click '+ Create Calculated Metric' below to define one.", 
                    style: "color:var(--text-muted); margin-bottom:12px;" 
                });
            } else {
                calcs.forEach((calc, idx) => {
                    const row = formulasContainer.createDiv();
                    row.style.display = 'flex';
                    row.style.gap = '8px';
                    row.style.alignItems = 'center';
                    row.style.marginBottom = '10px';
                    row.style.paddingBottom = '10px';
                    row.style.borderBottom = '1px solid var(--background-modifier-border)';

                    const infoDiv = row.createDiv({ style: 'flex:2;' });
                    infoDiv.createEl('div', { text: `${calc.label} (${calc.key})`, style: 'font-weight:bold; font-size:0.95em;' });
                    infoDiv.createEl('div', { text: `Formula: ${calc.formula}`, style: 'font-family:var(--font-monospace); font-size:0.85em; color:var(--text-accent);' });

                    const unitDiv = row.createDiv({ style: 'flex:0.8; font-size:0.9em; color:var(--text-muted);' });
                    unitDiv.setText(`Unit: ${calc.unit || 'None'} | ${calc.agg}`);

                    const writeLabel = row.createEl('label', { style: 'display:flex; align-items:center; gap:4px; font-size:0.85em;' });
                    const writeCheck = writeLabel.createEl('input', { type: 'checkbox' });
                    writeCheck.checked = calc.writeToNote === true;
                    writeLabel.appendText('Write to Note');
                    writeCheck.onchange = async () => {
                        calc.writeToNote = writeCheck.checked;
                        await this.plugin.saveSettings();
                    };

                    const delBtn = row.createEl('button', { text: '🗑' });
                    delBtn.style.color = 'var(--text-error)';
                    delBtn.onclick = async () => {
                        calcs.splice(idx, 1);
                        await this.plugin.saveSettings();
                        renderFormulasTable();
                        renderCardsTable();
                    };
                });
            }

            // Create Formula Metric Form
            const addFormulaSection = formulasContainer.createDiv({ style: 'margin-top:14px; padding-top:12px; border-top:1px dashed var(--background-modifier-border);' });

            if (!this.isCreatingFormula) {
                const createBtn = addFormulaSection.createEl('button', { text: '+ Create Calculated Metric', cls: 'mod-cta' });
                createBtn.onclick = () => {
                    this.isCreatingFormula = true;
                    renderFormulasTable();
                };
            } else {
                const formBox = addFormulaSection.createDiv({ style: 'display:flex; flex-direction:column; gap:10px;' });

                const topRow = formBox.createDiv({ style: 'display:flex; gap:8px;' });
                const labelIn = topRow.createEl('input', { type: 'text', placeholder: 'Metric Label (e.g. Macro Calories)' });
                labelIn.style.flex = '1';

                const keyIn = topRow.createEl('input', { type: 'text', placeholder: 'Key Name (e.g. macro_calories)' });
                keyIn.style.flex = '1';

                labelIn.oninput = () => {
                    if (!keyIn.value || keyIn.value === labelIn.value.slice(0, -1).toLowerCase().replace(/[^a-z0-9_]/g, '_')) {
                        keyIn.value = labelIn.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                    }
                };

                const formulaRow = formBox.createDiv();
                const formulaIn = formulaRow.createEl('input', { 
                    type: 'text', 
                    placeholder: 'Formula (e.g. (protein * 4) + (carbs * 4) + (fat * 9))',
                    style: 'width:100%; font-family:var(--font-monospace); padding:8px;' 
                });

                // Quick Variable Chips
                const chipsContainer = formBox.createDiv({ style: 'display:flex; flex-wrap:wrap; gap:6px; align-items:center;' });
                chipsContainer.createSpan({ text: 'Insert Variable:', style: 'font-size:0.8em; color:var(--text-muted);' });
                
                const commonVars = ["protein", "carbs", "fat", "calories", "Sleep_hours", "HRV", "steps", "active_minutes", "hydration", "caffeine"];
                commonVars.forEach(v => {
                    const chip = chipsContainer.createEl('button', { text: v, style: 'font-size:0.8em; padding:2px 6px;' });
                    chip.onclick = (e) => {
                        e.preventDefault();
                        formulaIn.value += (formulaIn.value.length > 0 && !formulaIn.value.endsWith(' ') ? ' ' : '') + v;
                    };
                });

                const optRow = formBox.createDiv({ style: 'display:flex; gap:10px; align-items:center;' });
                const unitIn = optRow.createEl('input', { type: 'text', placeholder: 'Unit (e.g. kcal, %, pts)', style: 'width:120px;' });
                
                const aggIn = optRow.createEl('select', { style: 'width:120px;' });
                [['average', 'Average'], ['sum', 'Sum'], ['diff', 'Diff'], ['last', 'Last']].forEach(([v, l]) => {
                    aggIn.createEl('option', { value: v, text: l });
                });

                const writeBackToggle = optRow.createEl('label', { style: 'display:flex; align-items:center; gap:4px; font-size:0.9em;' });
                const writeBackCheck = writeBackToggle.createEl('input', { type: 'checkbox' });
                writeBackToggle.appendText('Write result to Daily Note frontmatter');

                const actionRow = formBox.createDiv({ style: 'display:flex; gap:8px; margin-top:5px;' });
                const saveBtn = actionRow.createEl('button', { text: 'Save Calculated Metric', cls: 'mod-cta' });
                saveBtn.onclick = async () => {
                    const label = labelIn.value.trim();
                    const key = keyIn.value.trim();
                    const formula = formulaIn.value.trim();
                    const unit = unitIn.value.trim();
                    const agg = aggIn.value as any;
                    const writeToNote = writeBackCheck.checked;

                    if (!label || !key || !formula) {
                        new Notice("Please provide a Label, Key, and Formula!");
                        return;
                    }

                    const valRes = FormulaEvaluator.validateFormula(formula);
                    if (!valRes.valid) {
                        new Notice(`Formula Error: ${valRes.error}`);
                        return;
                    }

                    const newCalc: CalculatedMetric = {
                        id: `calc_${Date.now()}`,
                        key,
                        label,
                        formula,
                        unit,
                        agg,
                        chartType: 'line',
                        color: '#6366f1',
                        chartGroup: 'Health',
                        showTile: true,
                        writeToNote
                    };

                    if (!this.plugin.settings.calculatedMetrics) this.plugin.settings.calculatedMetrics = [];
                    this.plugin.settings.calculatedMetrics.push(newCalc);

                    // Also automatically add a dashboard card for this calculated metric
                    if (!this.plugin.settings.dashboardCards.some(c => c.key === key)) {
                        this.plugin.settings.dashboardCards.push({
                            key,
                            label,
                            unit,
                            agg,
                            chartType: 'line',
                            color: '#6366f1',
                            chartGroup: 'Health',
                            showTile: true,
                            excludeWeekends: false
                        });
                    }

                    await this.plugin.saveSettings();
                    this.isCreatingFormula = false;
                    new Notice(`Created calculated metric '${label}' 🧮`);
                    renderFormulasTable();
                    renderCardsTable();
                };

                const cancelBtn = actionRow.createEl('button', { text: 'Cancel' });
                cancelBtn.onclick = () => {
                    this.isCreatingFormula = false;
                    renderFormulasTable();
                };
            }
        };

        renderFormulasTable();

        // ==========================================
        // SECTION: 🍏 Apple Health & iOS Shortcuts Ingestion
        // ==========================================
        containerEl.createEl("h3", { text: "🍏 Apple Health & iOS Shortcuts Ingestion" });
        containerEl.createEl("p", {
            text: "Automatically ingest health and nutrition data exported from your iPhone via Apple Shortcuts into your Daily Notes.",
            cls: "setting-item-description"
        });

        new Setting(containerEl)
            .setName("Enable Apple Health Ingestion")
            .setDesc("Monitor a vault folder for incoming JSON files exported by Apple Shortcuts or cloud sync (iCloud, Google Drive, OneDrive, Obsidian Sync).")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableAppleHealthIngest)
                .onChange(async val => {
                    this.plugin.settings.enableAppleHealthIngest = val;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        if (this.plugin.settings.enableAppleHealthIngest) {
            new Setting(containerEl)
                .setName("Apple Health Drop Folder")
                .setDesc("The vault folder where Apple Shortcuts saves health JSON files.")
                .addText(text => text
                    .setPlaceholder("00_Imports/Health")
                    .setValue(this.plugin.settings.appleHealthDropFolder || "00_Imports/Health")
                    .onChange(async val => {
                        this.plugin.settings.appleHealthDropFolder = val.trim();
                        await this.plugin.saveSettings();
                    })
                );

            new Setting(containerEl)
                .setName("Auto-Archive Processed Files")
                .setDesc("Automatically move processed JSON files into an archive subfolder to prevent re-importing duplicate entries.")
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.appleHealthAutoArchive)
                    .onChange(async val => {
                        this.plugin.settings.appleHealthAutoArchive = val;
                        await this.plugin.saveSettings();
                    })
                );

            new Setting(containerEl)
                .setName("Archive Folder")
                .setDesc("Subfolder where processed files are moved.")
                .addText(text => text
                    .setPlaceholder("00_Imports/Health/Archive")
                    .setValue(this.plugin.settings.appleHealthArchiveFolder || "00_Imports/Health/Archive")
                    .onChange(async val => {
                        this.plugin.settings.appleHealthArchiveFolder = val.trim();
                        await this.plugin.saveSettings();
                    })
                );

            new Setting(containerEl)
                .setName("Scan Ingest Folder Now")
                .setDesc("Manually trigger a scan of the drop folder to parse and apply any pending JSON files.")
                .addButton(btn => btn
                    .setButtonText("Scan & Ingest Now 🍏")
                    .setCta()
                    .onClick(async () => {
                        btn.setButtonText("Scanning... ⏳");
                        const count = await this.plugin.appleHealthService.scanAndIngestDropFolder();
                        btn.setButtonText(count > 0 ? `Ingested ${count} File(s) 🟢` : "No New Files Found");
                        setTimeout(() => { btn.setButtonText("Scan & Ingest Now 🍏"); }, 3000);
                    })
                );

            // Collapsible Apple Shortcuts Setup Guide
            const shortcutDetails = containerEl.createEl('details');
            shortcutDetails.style.margin = '15px 0';
            shortcutDetails.style.padding = '12px 16px';
            shortcutDetails.style.backgroundColor = 'var(--background-secondary)';
            shortcutDetails.style.borderRadius = '8px';
            shortcutDetails.style.border = '1px solid var(--background-modifier-border)';

            const scSummary = shortcutDetails.createEl('summary', { text: '▶ 📲 Step-by-Step iOS Shortcuts Setup Guide' });
            scSummary.style.cursor = 'pointer';
            scSummary.style.fontWeight = 'bold';
            scSummary.style.color = 'var(--text-accent)';

            const scContent = shortcutDetails.createDiv();
            scContent.style.paddingTop = '10px';
            scContent.style.lineHeight = '1.6';
            scContent.innerHTML = `
                <p>Create an automated iOS Shortcut on your iPhone to run daily at midnight or after logging meals:</p>
                <ol style="margin-left: 20px; padding-left: 0;">
                    <li>Open the <b>Shortcuts app</b> on your iPhone.</li>
                    <li>Add actions:
                        <ul style="margin: 4px 0 6px 15px;">
                            <li><b>Find Health Samples:</b> Select <i>Dietary Protein, Dietary Energy, Steps, Sleep Analysis</i> (Start Date is Today).</li>
                            <li><b>Dictionary:</b> Construct a JSON dictionary with keys like <code>protein</code>, <code>calories</code>, <code>steps</code>, <code>Sleep_hours</code>.</li>
                            <li><b>Save File:</b> Save the dictionary as <code>Health_&lt;CurrentDate&gt;.json</code> into your synced Obsidian folder (e.g. <code>iCloud Drive/Obsidian/VaultName/00_Imports/Health/</code>).</li>
                        </ul>
                    </li>
                    <li>Set up an <b>Automation</b> in the Shortcuts app to run automatically every night at 11:59 PM.</li>
                </ol>
                <p style="margin-top: 10px; font-size: 0.9em; color: var(--text-muted);">
                    <b>Supported JSON Keys:</b> <code>protein</code>, <code>calories</code>, <code>carbs</code>, <code>fat</code>, <code>hydration</code>, <code>caffeine</code>, <code>alcohol</code>, <code>steps</code>, <code>active_minutes</code>, <code>Sleep_hours</code>, <code>Sleep_score</code>, <code>HRV</code>, <code>resting_heart_rate</code>, <code>weight</code>.
                </p>
            `;
        }

        // ==========================================
        // SECTION: 🌐 Google Health API & OAuth 2.0
        // ==========================================
        containerEl.createEl("h3", { text: "🌐 Google Health API & OAuth 2.0" });
        
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
                let scopes = this.plugin.settings.requestedScopes || [];
                if (chk.checked) {
                    if (!scopes.includes(item.scope)) scopes.push(item.scope);
                } else {
                    scopes = scopes.filter(s => s !== item.scope);
                }
                this.plugin.settings.requestedScopes = scopes;
                await this.plugin.saveSettings();
            };
            lbl.appendText(item.label);
        });

        // 1-Click Paste Full OAuth JSON Config
        const credsContainer = containerEl.createDiv();
        new Setting(credsContainer)
            .setName("Paste OAuth Client JSON Configuration")
            .setDesc("Paste the full client_secret_*.json downloaded from GCP to auto-fill Client ID and Client Secret.")
            .addTextArea(area => {
                area.setPlaceholder('{\n  "installed": {\n    "client_id": "...",\n    "client_secret": "..."\n  }\n}')
                    .setValue(this.plugin.settings.rawCredentialsJson || "")
                    .onChange(async val => {
                        this.plugin.settings.rawCredentialsJson = val;
                        try {
                            const parsed = JSON.parse(val);
                            const info = parsed.installed || parsed.web || parsed;
                            if (info.client_id) this.plugin.settings.clientId = info.client_id.trim();
                            if (info.client_secret) this.plugin.settings.clientSecret = info.client_secret.trim();
                            if (info.redirect_uris && info.redirect_uris.length > 0) {
                                this.plugin.settings.redirectUri = info.redirect_uris[0].trim();
                            }
                            await this.plugin.saveSettings();
                            new Notice("Parsed Google OAuth credentials successfully!");
                            this.display();
                        } catch(e) {
                            await this.plugin.saveSettings();
                        }
                    });
                area.inputEl.rows = 4;
                area.inputEl.style.width = "100%";
                area.inputEl.style.fontFamily = "var(--font-monospace)";
            });

        // Inline Collapsible GCP Instructions Guide
        const instructionsDetails = containerEl.createEl('details');
        instructionsDetails.style.margin = '10px 0 15px 0';
        instructionsDetails.style.padding = '12px 16px';
        instructionsDetails.style.backgroundColor = 'var(--background-secondary)';
        instructionsDetails.style.borderRadius = '8px';
        instructionsDetails.style.border = '1px solid var(--background-modifier-border)';

        const summary = instructionsDetails.createEl('summary', { text: '▶ Step-by-Step Google Cloud Setup Guide' });
        summary.style.cursor = 'pointer';
        summary.style.fontWeight = 'bold';
        summary.style.color = 'var(--text-accent)';
        
        const instructionText = instructionsDetails.createDiv();
        instructionText.style.paddingTop = '10px';
        instructionText.style.lineHeight = '1.6';
        instructionText.innerHTML = `
            <div style="margin-bottom: 14px;">
                <h4 style="margin: 0 0 6px 0; color: var(--interactive-accent);">📁 Part 1: Create GCP Project & App Details</h4>
                <ol style="margin-left: 20px; padding-left: 0;">
                    <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" style="color: var(--interactive-accent); font-weight: 600;">Google Cloud Console</a>.</li>
                    <li>Click the project dropdown at top-left -> <b>New Project</b> -> Name it <code>Obsidian-Health</code> -> Click <b>Create</b>.</li>
                </ol>
            </div>

            <div style="margin-bottom: 14px;">
                <h4 style="margin: 0 0 6px 0; color: var(--interactive-accent);">🛡️ Part 2: Enable Health API & Add Scopes</h4>
                <ol style="margin-left: 20px; padding-left: 0;">
                    <li>Go to <b>APIs & Services > Library</b>, search for <b>Google Health API</b>, and click <b>Enable</b>.</li>
                    <li>In <b>APIs & Services > OAuth consent screen</b>, set User Type: <b>External</b>, and add scopes for Sleep, HRV, Activity, and Nutrition.</li>
                    <li>Under <b>Test users</b>, add your personal Gmail address.</li>
                </ol>
            </div>

            <div style="margin-bottom: 14px;">
                <h4 style="margin: 0 0 6px 0; color: var(--interactive-accent);">🔑 Part 3: Create OAuth Client ID & Connect</h4>
                <ol style="margin-left: 20px; padding-left: 0;">
                    <li>Go to <b>APIs & Services > Credentials</b> -> <b>+ Create Credentials > OAuth client ID</b> (Web application).</li>
                    <li>Authorized redirect URIs: <code>http://localhost:8092</code>.</li>
                    <li>Click <b>Create</b> -> Download JSON -> Paste into box above and click <b>Connect Google Account</b>.</li>
                </ol>
            </div>
        `;

        // ==========================================
        // SECTION: 🥗 Food & Beverage Registry
        // ==========================================
        containerEl.createEl("h3", { text: "🥗 Food & Beverage Registry" });

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
    }
}
