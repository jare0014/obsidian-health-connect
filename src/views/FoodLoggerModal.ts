import { App, Modal, Setting, Notice } from "obsidian";
import { FoodItem } from "../models/HealthSettings";
import HealthConnectPlugin from "../main";

export class FoodLoggerModal extends Modal {
    private plugin: HealthConnectPlugin;
    private selectedItem: FoodItem;
    private amount: number = 1.0;

    constructor(app: App, plugin: HealthConnectPlugin) {
        super(app);
        this.plugin = plugin;
        this.selectedItem = plugin.settings.foodRegistry[0] || {
            id: "water",
            name: "Water",
            category: "hydration",
            unit: "cup",
            defaultAmount: 1,
            waterMl: 355
        };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("food-logger-modal");

        contentEl.createEl("h2", { text: "🍎 Log Food & Nutrition" });
        contentEl.createEl("p", { 
            text: "Select a go-to item to write directly to Google Health API and update today's Daily Note.",
            cls: "health-modal-desc"
        });

        const registry = this.plugin.settings.foodRegistry;
        const options: Record<string, string> = {};
        registry.forEach(item => {
            options[item.id] = `${item.name} (${item.unit})`;
        });

        new Setting(contentEl)
            .setName("Food / Beverage")
            .setDesc("Choose an item from your go-to registry")
            .addDropdown(drop => drop
                .addOptions(options)
                .setValue(this.selectedItem.id)
                .onChange(val => {
                    const match = registry.find(i => i.id === val);
                    if (match) {
                        this.selectedItem = match;
                        this.amount = match.defaultAmount || 1;
                        this.updateSummary(summaryEl);
                    }
                })
            );

        new Setting(contentEl)
            .setName("Servings / Quantity")
            .setDesc("Number of servings consumed")
            .addSlider(slider => slider
                .setLimits(0.25, 5.0, 0.25)
                .setValue(this.amount)
                .setDynamicTooltip()
                .onChange(val => {
                    this.amount = val;
                    this.updateSummary(summaryEl);
                })
            );

        const summaryEl = contentEl.createDiv({ cls: "health-food-summary-box" });
        this.updateSummary(summaryEl);

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText("Log to Google Health & Note")
                .setCta()
                .onClick(async () => {
                    btn.setButtonText("Logging... ⏳");
                    btn.setDisabled(true);
                    try {
                        const ok = await this.plugin.healthService.postFoodOrDrink(this.selectedItem, this.amount);
                        if (ok) {
                            new Notice(`Logged ${this.amount}x ${this.selectedItem.name}! 🍎`);
                            await this.plugin.syncTodayHealth();
                            this.close();
                        } else {
                            new Notice("Failed to log food to Google Health API.");
                            btn.setButtonText("Log to Google Health & Note");
                            btn.setDisabled(false);
                        }
                    } catch (e) {
                        new Notice(`Error: ${e.message}`);
                        btn.setButtonText("Log to Google Health & Note");
                        btn.setDisabled(false);
                    }
                })
            );
    }

    private updateSummary(el: HTMLElement) {
        el.empty();
        const pills: string[] = [];

        if (this.selectedItem.caffeineMg) {
            pills.push(`⚡ Caffeine: ${Math.round(this.selectedItem.caffeineMg * this.amount)} mg`);
        }
        if (this.selectedItem.proteinG) {
            pills.push(`💪 Protein: ${Math.round(this.selectedItem.proteinG * this.amount)} g`);
        }
        if (this.selectedItem.calories) {
            pills.push(`🔥 Energy: ${Math.round(this.selectedItem.calories * this.amount)} kcal`);
        }
        if (this.selectedItem.waterMl) {
            const oz = Math.round((this.selectedItem.waterMl * this.amount) / 29.5735);
            pills.push(`💧 Hydration: ${oz} fl oz (${Math.round(this.selectedItem.waterMl * this.amount)} ml)`);
        }

        if (pills.length === 0) {
            el.createDiv({ text: "Standard serving", cls: "health-summary-pill" });
        } else {
            pills.forEach(p => el.createDiv({ text: p, cls: "health-summary-pill" }));
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
