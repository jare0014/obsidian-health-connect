import { App, Modal, Setting, Notice } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import HealthConnectPlugin from "../main";
import { FoodItem, DEFAULT_FOOD_ITEMS } from "../models/HealthSettings";

export class FoodLoggerModal extends Modal {
    private plugin: HealthConnectPlugin;
    private activeTab: 'log' | 'add' | 'manage' | 'history';
    private selectedFoodId: string = "";
    private logAmount: number = 1.0;

    // Form fields for new item
    private newId: string = "";
    private newName: string = "";
    private newCategory: 'nutrition' | 'caffeine' | 'hydration' | 'alcohol' = "nutrition";
    private newUnit: string = "serving";
    private newProtein: number = 0;
    private newCalories: number = 0;
    private newCaffeine: number = 0;
    private newWater: number = 0;
    private newAlcohol: number = 0;

    constructor(app: App, plugin: HealthConnectPlugin, activeTab: 'log' | 'add' | 'manage' | 'history' = 'log') {
        super(app);
        this.plugin = plugin;
        this.activeTab = activeTab;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("health-food-modal");

        contentEl.createEl("h2", { text: "🥗 Google Health Food & Beverage Registry" });

        const tabHeader = contentEl.createDiv({ cls: "health-tab-header" });
        tabHeader.style.display = "flex";
        tabHeader.style.gap = "15px";
        tabHeader.style.marginBottom = "15px";
        tabHeader.style.borderBottom = "1px solid var(--background-modifier-border)";
        tabHeader.style.paddingBottom = "8px";

        const tabLog = tabHeader.createSpan({ text: "Log Food" });
        const tabHistory = tabHeader.createSpan({ text: "Today's History 🕒" });
        const tabAdd = tabHeader.createSpan({ text: "Add to Registry" });
        const tabManage = tabHeader.createSpan({ text: "Manage Registry" });

        tabLog.style.cursor = "pointer";
        tabHistory.style.cursor = "pointer";
        tabAdd.style.cursor = "pointer";
        tabManage.style.cursor = "pointer";

        const mainContainer = contentEl.createDiv();

        const setActiveTabStyle = (active: HTMLElement) => {
            [tabLog, tabHistory, tabAdd, tabManage].forEach(t => {
                t.style.color = "var(--text-muted)";
                t.style.fontWeight = "normal";
            });
            active.style.color = "var(--text-accent)";
            active.style.fontWeight = "bold";
        };

        const renderLogTab = async () => {
            mainContainer.empty();
            setActiveTabStyle(tabLog);
            const items = await this.loadRegistryItems();

            if (items.length === 0) {
                mainContainer.createEl("p", { text: "No items in registry. Switch to 'Add to Registry' tab to create one." });
                return;
            }

            if (!this.selectedFoodId || !items.find(i => i.id === this.selectedFoodId)) {
                this.selectedFoodId = items[0].id;
            }

            const options: Record<string, string> = {};
            items.forEach(i => { options[i.id] = `${i.name} (${i.unit})`; });

            new Setting(mainContainer)
                .setName("Food / Beverage")
                .setDesc("Choose an item from your custom registry")
                .addDropdown(drop => drop
                    .addOptions(options)
                    .setValue(this.selectedFoodId)
                    .onChange(val => {
                        this.selectedFoodId = val;
                        updateSummary();
                    })
                );

            new Setting(mainContainer)
                .setName("Quantity / Servings")
                .setDesc("Number of servings to consume")
                .addSlider(slider => slider
                    .setLimits(0.25, 5.0, 0.25)
                    .setValue(this.logAmount)
                    .setDynamicTooltip()
                    .onChange(val => {
                        this.logAmount = val;
                        updateSummary();
                    })
                );

            const summaryEl = mainContainer.createDiv({ cls: "health-food-summary-box" });
            const updateSummary = () => {
                summaryEl.empty();
                const cur = items.find(i => i.id === this.selectedFoodId);
                if (!cur) return;
                const pills: string[] = [];
                if (cur.caffeineMg) pills.push(`⚡ Caffeine: ${Math.round(cur.caffeineMg * this.logAmount)} mg`);
                if (cur.proteinG) pills.push(`💪 Protein: ${Math.round(cur.proteinG * this.logAmount)} g`);
                if (cur.calories) pills.push(`🔥 Energy: ${Math.round(cur.calories * this.logAmount)} kcal`);
                if (cur.waterMl) pills.push(`💧 Hydration: ${Math.round((cur.waterMl * this.logAmount) / 29.57)} oz (${Math.round(cur.waterMl * this.logAmount)} ml)`);
                if (cur.alcoholMg) pills.push(`🍸 Alcohol: ${Math.round((cur.alcoholMg * this.logAmount) / 1000)} g`);
                pills.forEach(p => summaryEl.createDiv({ text: p, cls: "health-summary-pill" }));
            };
            updateSummary();

            new Setting(mainContainer)
                .addButton(btn => btn
                    .setButtonText("Log to Google Health")
                    .setCta()
                    .onClick(async () => {
                        const cur = items.find(i => i.id === this.selectedFoodId);
                        if (!cur) return;
                        btn.setButtonText("Logging... ⏳");
                        btn.setDisabled(true);
                        const ok = await this.plugin.healthService.postFoodOrDrink(cur, this.logAmount);
                        if (ok) {
                            new Notice(`Logged ${this.logAmount}x ${cur.name}! 🍎`);
                            await this.plugin.syncTodayHealth();
                            this.close();
                        } else {
                            new Notice("Failed to log to Google Health.");
                            btn.setButtonText("Log to Google Health");
                            btn.setDisabled(false);
                        }
                    })
                );
        };

        const renderAddTab = () => {
            mainContainer.empty();
            setActiveTabStyle(tabAdd);

            new Setting(mainContainer)
                .setName("Item ID (unique slug)")
                .addText(text => text.setPlaceholder("e.g. cold_brew").onChange(v => this.newId = v.trim()));

            new Setting(mainContainer)
                .setName("Display Name")
                .addText(text => text.setPlaceholder("e.g. Cold Brew Coffee").onChange(v => this.newName = v.trim()));

            new Setting(mainContainer)
                .setName("Category")
                .addDropdown(drop => drop
                    .addOption("nutrition", "Nutrition / Food")
                    .addOption("caffeine", "Caffeine / Coffee")
                    .addOption("hydration", "Hydration / Water")
                    .addOption("alcohol", "Alcohol")
                    .setValue(this.newCategory)
                    .onChange((v: any) => this.newCategory = v)
                );

            new Setting(mainContainer)
                .setName("Serving Unit")
                .addText(text => text.setValue("serving").onChange(v => this.newUnit = v.trim()));

            new Setting(mainContainer)
                .setName("Calories (kcal)")
                .addText(text => text.setPlaceholder("0").onChange(v => this.newCalories = parseFloat(v) || 0));

            new Setting(mainContainer)
                .setName("Protein (g)")
                .addText(text => text.setPlaceholder("0").onChange(v => this.newProtein = parseFloat(v) || 0));

            new Setting(mainContainer)
                .setName("Caffeine (mg)")
                .addText(text => text.setPlaceholder("0").onChange(v => this.newCaffeine = parseFloat(v) || 0));

            new Setting(mainContainer)
                .setName("Alcohol (g)")
                .addText(text => text.setPlaceholder("0").onChange(v => this.newAlcohol = parseFloat(v) || 0));

            new Setting(mainContainer)
                .setName("Water / Volume (ml)")
                .addText(text => text.setPlaceholder("0").onChange(v => this.newWater = parseFloat(v) || 0));

            new Setting(mainContainer)
                .addButton(btn => btn
                    .setButtonText("Save Item to Registry")
                    .setCta()
                    .onClick(async () => {
                        if (!this.newId || !this.newName) {
                            new Notice("Please enter both ID and Name.");
                            return;
                        }
                        const items = await this.loadRegistryItems();
                        const newItem: FoodItem = {
                            id: this.newId,
                            name: this.newName,
                            category: this.newCategory,
                            unit: this.newUnit,
                            defaultAmount: 1,
                            calories: this.newCalories,
                            proteinG: this.newProtein,
                            caffeineMg: this.newCaffeine,
                            waterMl: this.newWater,
                            alcoholMg: this.newAlcohol > 0 ? Math.round(this.newAlcohol * 1000) : undefined
                        };
                        items.push(newItem);
                        await this.saveRegistryItems(items);
                        new Notice(`Added "${this.newName}" to registry!`);
                        renderManageTab();
                    })
                );
        };

        const renderManageTab = async () => {
            mainContainer.empty();
            setActiveTabStyle(tabManage);
            const items = await this.loadRegistryItems();

            if (items.length === 0) {
                mainContainer.createEl("p", { text: "No items found in registry." });
                return;
            }

            items.forEach((item, idx) => {
                new Setting(mainContainer)
                    .setName(`${item.name} (${item.unit})`)
                    .setDesc(`Category: ${item.category} | ${item.calories ? item.calories + ' kcal ' : ''}${item.proteinG ? item.proteinG + 'g protein ' : ''}${item.caffeineMg ? item.caffeineMg + 'mg caffeine ' : ''}${item.waterMl ? item.waterMl + 'ml water' : ''}`)
                    .addButton(btn => btn
                        .setButtonText("Delete")
                        .setWarning()
                        .onClick(async () => {
                            items.splice(idx, 1);
                            await this.saveRegistryItems(items);
                            renderManageTab();
                        })
                    );
            });
        };

        const renderHistoryTab = async () => {
            mainContainer.empty();
            setActiveTabStyle(tabHistory);

            const loading = mainContainer.createEl("p", { text: "Fetching today's logged items from Google Health... ⏳" });
            const logs = await this.plugin.healthService.fetchLoggedFoodHistory(new Date());
            loading.remove();

            if (logs.length === 0) {
                mainContainer.createEl("p", { text: "No food, drinks, or hydration logged for today yet." });
                return;
            }

            mainContainer.createEl("p", { text: `Found ${logs.length} logged entry(ies) for today:`, style: "color: var(--text-muted); font-size: 0.9em;" });

            const registryItems = await this.loadRegistryItems();

            logs.forEach(log => {
                const setting = new Setting(mainContainer)
                    .setName(`${log.time} — ${log.name}`)
                    .setDesc(log.details);

                const isAlreadyInRegistry = registryItems.some(i => i.name.toLowerCase() === log.name.toLowerCase());

                if (isAlreadyInRegistry) {
                    setting.addButton(btn => btn
                        .setButtonText("⭐ In Presets")
                        .setDisabled(true)
                        .setTooltip("This item is already saved in your Quick-Log registry presets")
                    );
                } else {
                    setting.addButton(btn => btn
                        .setButtonText("💾 Save to Registry")
                        .setCta()
                        .setTooltip("Save this Google Health entry to your local food registry presets for 1-click logging")
                        .onClick(async () => {
                            btn.setButtonText("Saving...");
                            btn.setDisabled(true);

                            const slug = log.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                            const newItem: FoodItem = {
                                id: slug || `item_${Date.now()}`,
                                name: log.name,
                                category: log.category as any,
                                unit: (log as any).unit || "serving",
                                defaultAmount: 1,
                                calories: (log as any).calories,
                                proteinG: (log as any).proteinG,
                                caffeineMg: (log as any).caffeineMg,
                                alcoholMg: (log as any).alcoholMg,
                                waterMl: (log as any).waterMl
                            };

                            const items = await this.loadRegistryItems();
                            items.push(newItem);
                            await this.saveRegistryItems(items);

                            new Notice(`Saved "${log.name}" to your Food Registry presets! ⭐`);
                            renderHistoryTab();
                        })
                    );
                }

                setting.addButton(btn => btn
                    .setButtonText("🗑️ Delete")
                    .setWarning()
                    .onClick(async () => {
                        btn.setButtonText("Deleting...");
                        const ok = await this.plugin.healthService.deleteHealthDataPoint(log.dataType, log.id);
                        if (ok) {
                            new Notice(`Deleted "${log.name}" from Google Health 🗑️`);
                            // Refresh biometrics to update daily note frontmatter
                            await this.plugin.syncHealthData(false);
                            renderHistoryTab();
                        } else {
                            new Notice(`Failed to delete from Google Health.`);
                            btn.setButtonText("🗑️ Delete");
                        }
                    })
                );
            });
        };

        tabLog.onclick = () => renderLogTab();
        tabHistory.onclick = () => renderHistoryTab();
        tabAdd.onclick = () => renderAddTab();
        tabManage.onclick = () => renderManageTab();

        if (this.activeTab === 'history') {
            renderHistoryTab();
        } else if (this.activeTab === 'manage') {
            renderManageTab();
        } else if (this.activeTab === 'add') {
            renderAddTab();
        } else {
            renderLogTab();
        }
    }

    private getPluginRegistryPath(): string {
        const anyAdapter = this.app.vault.adapter as any;
        const vaultPath = anyAdapter.getBasePath ? anyAdapter.getBasePath() : "";
        return path.join(vaultPath, ".obsidian", "plugins", "health-connect-readiness", "health_go_to_items.json");
    }

    public async loadRegistryItems(): Promise<FoodItem[]> {
        const filePath = this.getPluginRegistryPath();
        if (fs.existsSync(filePath)) {
            try {
                return JSON.parse(fs.readFileSync(filePath, "utf8"));
            } catch (e) {}
        }
        if (this.plugin.settings.foodRegistry && this.plugin.settings.foodRegistry.length > 0) {
            return this.plugin.settings.foodRegistry;
        }
        return DEFAULT_FOOD_ITEMS;
    }

    public async saveRegistryItems(items: FoodItem[]): Promise<void> {
        this.plugin.settings.foodRegistry = items;
        await this.plugin.saveSettings();

        const filePath = this.getPluginRegistryPath();
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        try {
            fs.writeFileSync(filePath, JSON.stringify(items, null, 2), "utf8");
        } catch(e) {}
    }
}
