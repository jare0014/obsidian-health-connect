import { App, Modal, Setting, Notice, TFile } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import HealthConnectPlugin from "../main";
import { 
    FoodItem, 
    WorkoutItem, 
    MindfulnessItem, 
    DEFAULT_FOOD_ITEMS, 
    DEFAULT_WORKOUT_ITEMS, 
    DEFAULT_MINDFULNESS_ITEMS 
} from "../models/HealthSettings";

export type HealthHubTab = 'log' | 'history' | 'registry';
export type HealthHubCategory = 'nutrition' | 'workout' | 'mindfulness' | 'sleep';

export class HealthHubModal extends Modal {
    private plugin: HealthConnectPlugin;
    private activeTab: HealthHubTab;
    private activeCategory: HealthHubCategory;
    private historyDays: number = 7;

    // Form states - Nutrition
    private selectedFoodId: string = "";
    private logAmount: number = 1.0;

    // Form states - Workout
    private targetDate: string = "";
    private selectedWorkoutId: string = "";
    private workoutDurationMins: number = 30;
    private workoutStartTimePreset: 'now' | 'noon' | 'morning' | 'evening' | 'custom' = 'now';
    private workoutCustomTime: string = "12:00";

    // Form states - Mindfulness
    private selectedMindfulnessId: string = "";
    private mindfulnessDurationMins: number = 15;
    private mindfulnessStartTimePreset: 'now' | 'noon' | 'morning' | 'evening' | 'custom' = 'now';
    private mindfulnessCustomTime: string = "12:00";

    // Form states - Sleep
    private sleepTargetDate: string = "";
    private sleepHoursStr: string = "7.5";
    private deepSleepStr: string = "1.5";
    private sleepScoreStr: string = "";
    private readinessScoreStr: string = "";

    // Registry forms - New Food
    private newFoodId: string = "";
    private newFoodName: string = "";
    private newFoodCategory: 'nutrition' | 'caffeine' | 'hydration' | 'alcohol' = "nutrition";
    private newFoodUnit: string = "serving";
    private newFoodProtein: number = 0;
    private newFoodCalories: number = 0;
    private newFoodCaffeine: number = 0;
    private newFoodWater: number = 0;
    private newFoodAlcohol: number = 0;

    // Registry forms - New Workout
    private newWorkoutId: string = "";
    private newWorkoutName: string = "";
    private newWorkoutCategory: 'walking' | 'running' | 'strength' | 'cardio' | 'flexibility' | 'other' = "strength";
    private newWorkoutGhType: string = "OTHER_WORKOUT";
    private newWorkoutDuration: number = 30;

    // Registry forms - New Mindfulness
    private newMindId: string = "";
    private newMindName: string = "";
    private newMindCategory: 'meditation' | 'breathwork' | 'bodyscan' | 'other' = "meditation";
    private newMindDuration: number = 15;

    constructor(
        app: App, 
        plugin: HealthConnectPlugin, 
        activeTab: HealthHubTab = 'log',
        activeCategory: HealthHubCategory = 'nutrition'
    ) {
        super(app);
        this.plugin = plugin;
        this.activeTab = activeTab;
        this.activeCategory = activeCategory;

        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        this.targetDate = `${y}-${m}-${d}`;
        this.sleepTargetDate = `${y}-${m}-${d}`;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("health-hub-modal");

        contentEl.createEl("h2", { text: "🏥 Health Connect Activity & Registry Hub" });

        // 1. Primary Tabs Navigation
        const primaryTabHeader = contentEl.createDiv({ cls: "health-primary-tab-header" });
        primaryTabHeader.style.display = "flex";
        primaryTabHeader.style.gap = "15px";
        primaryTabHeader.style.marginBottom = "10px";
        primaryTabHeader.style.borderBottom = "1px solid var(--background-modifier-border)";
        primaryTabHeader.style.paddingBottom = "8px";

        const tabLog = primaryTabHeader.createSpan({ text: "Add to Log 📝" });
        const tabHistory = primaryTabHeader.createSpan({ text: "View History 🕒" });
        const tabRegistry = primaryTabHeader.createSpan({ text: "Manage Registry ⚙️" });

        [tabLog, tabHistory, tabRegistry].forEach(t => {
            t.style.cursor = "pointer";
            t.style.fontSize = "1.05em";
        });

        // 2. Category Switcher (Pill Selector)
        const categoryBar = contentEl.createDiv({ cls: "health-category-bar" });
        categoryBar.style.display = "flex";
        categoryBar.style.gap = "8px";
        categoryBar.style.marginBottom = "15px";
        categoryBar.style.padding = "4px";
        categoryBar.style.background = "var(--background-secondary)";
        categoryBar.style.borderRadius = "8px";

        const catNutrition = categoryBar.createDiv({ text: "🥗 Nutrition & Drinks", cls: "health-cat-pill" });
        const catWorkout = categoryBar.createDiv({ text: "🏋️ Workout / Exercise", cls: "health-cat-pill" });
        const catMindfulness = categoryBar.createDiv({ text: "🧘 Mindfulness", cls: "health-cat-pill" });
        const catSleep = categoryBar.createDiv({ text: "😴 Sleep", cls: "health-cat-pill" });

        const catMap = {
            nutrition: catNutrition,
            workout: catWorkout,
            mindfulness: catMindfulness,
            sleep: catSleep
        };

        const updateCategoryStyles = () => {
            Object.entries(catMap).forEach(([k, el]) => {
                el.style.cursor = "pointer";
                el.style.padding = "6px 12px";
                el.style.borderRadius = "6px";
                el.style.fontSize = "0.9em";
                if (k === this.activeCategory) {
                    el.style.background = "var(--interactive-accent)";
                    el.style.color = "var(--text-on-accent)";
                    el.style.fontWeight = "bold";
                } else {
                    el.style.background = "transparent";
                    el.style.color = "var(--text-muted)";
                    el.style.fontWeight = "normal";
                }
            });
        };

        catNutrition.onclick = () => { this.activeCategory = 'nutrition'; renderContent(); };
        catWorkout.onclick = () => { this.activeCategory = 'workout'; renderContent(); };
        catMindfulness.onclick = () => { this.activeCategory = 'mindfulness'; renderContent(); };
        catSleep.onclick = () => { this.activeCategory = 'sleep'; renderContent(); };

        const mainContainer = contentEl.createDiv({ cls: "health-main-content" });

        const updatePrimaryTabStyles = () => {
            const tabs = [
                { id: 'log', el: tabLog },
                { id: 'history', el: tabHistory },
                { id: 'registry', el: tabRegistry }
            ];
            tabs.forEach(t => {
                if (t.id === this.activeTab) {
                    t.el.style.color = "var(--text-accent)";
                    t.el.style.fontWeight = "bold";
                    t.el.style.borderBottom = "2px solid var(--text-accent)";
                } else {
                    t.el.style.color = "var(--text-muted)";
                    t.el.style.fontWeight = "normal";
                    t.el.style.borderBottom = "none";
                }
            });
        };

        tabLog.onclick = () => { this.activeTab = 'log'; renderContent(); };
        tabHistory.onclick = () => { this.activeTab = 'history'; renderContent(); };
        tabRegistry.onclick = () => { this.activeTab = 'registry'; renderContent(); };

        const renderContent = async () => {
            mainContainer.empty();
            updatePrimaryTabStyles();
            updateCategoryStyles();

            if (this.activeTab === 'log') {
                await this.renderLogTab(mainContainer);
            } else if (this.activeTab === 'history') {
                await this.renderHistoryTab(mainContainer);
            } else if (this.activeTab === 'registry') {
                await this.renderRegistryTab(mainContainer);
            }
        };

        await renderContent();
    }

    // ==========================================
    // 1. ADD TO LOG TAB
    // ==========================================
    private async renderLogTab(container: HTMLElement) {
        if (this.activeCategory === 'nutrition') {
            await this.renderLogNutrition(container);
        } else if (this.activeCategory === 'workout') {
            await this.renderLogWorkout(container);
        } else if (this.activeCategory === 'mindfulness') {
            await this.renderLogMindfulness(container);
        } else if (this.activeCategory === 'sleep') {
            await this.renderLogSleep(container);
        }
    }

    private async renderLogNutrition(container: HTMLElement) {
        const items = await this.loadFoodRegistry();
        if (items.length === 0) {
            container.createEl("p", { text: "No items in Food Registry. Switch to 'Manage Registry' tab to add items." });
            return;
        }

        if (!this.selectedFoodId || !items.find(i => i.id === this.selectedFoodId)) {
            this.selectedFoodId = items[0].id;
        }

        const options: Record<string, string> = {};
        items.forEach(i => { options[i.id] = `${i.name} (${i.unit})`; });

        new Setting(container)
            .setName("Food / Beverage")
            .setDesc("Choose an item from your custom food registry")
            .addDropdown(drop => drop
                .addOptions(options)
                .setValue(this.selectedFoodId)
                .onChange(val => {
                    this.selectedFoodId = val;
                    updateSummary();
                })
            );

        new Setting(container)
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

        const summaryEl = container.createDiv({ cls: "health-food-summary-box" });
        summaryEl.style.display = "flex";
        summaryEl.style.flexWrap = "wrap";
        summaryEl.style.gap = "8px";
        summaryEl.style.margin = "12px 0";

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
            pills.forEach(p => {
                const pill = summaryEl.createDiv({ text: p });
                pill.style.background = "var(--background-secondary)";
                pill.style.padding = "4px 8px";
                pill.style.borderRadius = "4px";
                pill.style.fontSize = "0.85em";
            });
        };
        updateSummary();

        new Setting(container)
            .addButton(btn => btn
                .setButtonText("Log Food to Google Health & Note 🍎")
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
                        btn.setButtonText("Log Food to Google Health & Note 🍎");
                        btn.setDisabled(false);
                    }
                })
            );
    }

    private async renderLogWorkout(container: HTMLElement) {
        const workouts = await this.loadWorkoutRegistry();
        if (workouts.length === 0) {
            container.createEl("p", { text: "No items in Workout Registry. Switch to 'Manage Registry' tab to add workouts." });
            return;
        }

        if (!this.selectedWorkoutId || !workouts.find(w => w.id === this.selectedWorkoutId)) {
            this.selectedWorkoutId = workouts[0].id;
            this.workoutDurationMins = workouts[0].defaultDurationMins;
        }

        new Setting(container)
            .setName("Target Date")
            .setDesc("Date of workout session (YYYY-MM-DD)")
            .addText(text => text
                .setValue(this.targetDate)
                .onChange(val => this.targetDate = val.trim())
            );

        const options: Record<string, string> = {};
        workouts.forEach(w => { options[w.id] = `${w.name} (${w.defaultDurationMins}m default)`; });

        new Setting(container)
            .setName("Exercise / Workout")
            .setDesc("Choose an exercise from your custom registry")
            .addDropdown(drop => drop
                .addOptions(options)
                .setValue(this.selectedWorkoutId)
                .onChange(val => {
                    this.selectedWorkoutId = val;
                    const item = workouts.find(w => w.id === val);
                    if (item) this.workoutDurationMins = item.defaultDurationMins;
                    durationSetting.setValue(String(this.workoutDurationMins));
                })
            );

        let durationSetting: any;
        new Setting(container)
            .setName("Duration (Minutes)")
            .setDesc("Elapsed active time in minutes")
            .addText(text => {
                durationSetting = text;
                text.setValue(String(this.workoutDurationMins))
                    .onChange(val => {
                        const parsed = parseInt(val, 10);
                        if (!isNaN(parsed) && parsed > 0) this.workoutDurationMins = parsed;
                    });
            });

        new Setting(container)
            .setName("Start Time Window")
            .setDesc("When did this workout begin?")
            .addDropdown(drop => drop
                .addOption("now", "Right Now (Current Time)")
                .addOption("noon", "Noon (12:00 PM)")
                .addOption("morning", "Morning (08:00 AM)")
                .addOption("evening", "Evening (06:00 PM)")
                .addOption("custom", "Custom Time")
                .setValue(this.workoutStartTimePreset)
                .onChange((val: any) => {
                    this.workoutStartTimePreset = val;
                    customTimeRow.style.display = val === 'custom' ? 'block' : 'none';
                })
            );

        const customTimeRow = container.createDiv();
        customTimeRow.style.display = this.workoutStartTimePreset === 'custom' ? 'block' : 'none';
        new Setting(customTimeRow)
            .setName("Custom Start Time (HH:MM)")
            .addText(t => t.setValue(this.workoutCustomTime).onChange(v => this.workoutCustomTime = v.trim()));

        new Setting(container)
            .addButton(btn => btn
                .setButtonText("Log Workout to Cloud & Note 🏋️")
                .setCta()
                .onClick(async () => {
                    const item = workouts.find(w => w.id === this.selectedWorkoutId);
                    if (!item) return;

                    btn.setButtonText("Uploading... ⏳");
                    btn.setDisabled(true);

                    const { startIso, endIso } = this.calculateStartAndEndIso(
                        this.targetDate, 
                        this.workoutStartTimePreset, 
                        this.workoutCustomTime, 
                        this.workoutDurationMins
                    );

                    const ok = await this.plugin.healthService.postExerciseSession(item.name, startIso, endIso);
                    await this.writeWorkoutToFrontmatter(this.targetDate, item.name, this.workoutDurationMins);

                    if (ok) {
                        new Notice(`Logged ${item.name} (${this.workoutDurationMins}m) to Google Health & daily note! 🏋️`);
                        this.close();
                    } else {
                        const err = this.plugin.healthService.lastApiError || "Check OAuth permissions in Settings.";
                        new Notice(`Saved ${item.name} to daily note, but Google Health upload failed: ${err}`, 9000);
                        this.close();
                    }
                })
            );
    }

    private async renderLogMindfulness(container: HTMLElement) {
        const minds = await this.loadMindfulnessRegistry();
        if (minds.length === 0) {
            container.createEl("p", { text: "No items in Mindfulness Registry. Switch to 'Manage Registry' tab to add items." });
            return;
        }

        if (!this.selectedMindfulnessId || !minds.find(m => m.id === this.selectedMindfulnessId)) {
            this.selectedMindfulnessId = minds[0].id;
            this.mindfulnessDurationMins = minds[0].defaultDurationMins;
        }

        new Setting(container)
            .setName("Target Date")
            .setDesc("Date of mindfulness session (YYYY-MM-DD)")
            .addText(text => text
                .setValue(this.targetDate)
                .onChange(val => this.targetDate = val.trim())
            );

        const options: Record<string, string> = {};
        minds.forEach(m => { options[m.id] = `${m.name} (${m.defaultDurationMins}m default)`; });

        new Setting(container)
            .setName("Mindfulness Session Style")
            .setDesc("Choose meditation or breathwork preset")
            .addDropdown(drop => drop
                .addOptions(options)
                .setValue(this.selectedMindfulnessId)
                .onChange(val => {
                    this.selectedMindfulnessId = val;
                    const item = minds.find(m => m.id === val);
                    if (item) this.mindfulnessDurationMins = item.defaultDurationMins;
                    durationSetting.setValue(String(this.mindfulnessDurationMins));
                })
            );

        let durationSetting: any;
        new Setting(container)
            .setName("Duration (Minutes)")
            .setDesc("Elapsed mindfulness duration in minutes")
            .addText(text => {
                durationSetting = text;
                text.setValue(String(this.mindfulnessDurationMins))
                    .onChange(val => {
                        const parsed = parseInt(val, 10);
                        if (!isNaN(parsed) && parsed > 0) this.mindfulnessDurationMins = parsed;
                    });
            });

        new Setting(container)
            .setName("Start Time Window")
            .setDesc("When did this session begin?")
            .addDropdown(drop => drop
                .addOption("now", "Right Now (Current Time)")
                .addOption("noon", "Noon (12:00 PM)")
                .addOption("morning", "Morning (08:00 AM)")
                .addOption("evening", "Evening (06:00 PM)")
                .addOption("custom", "Custom Time")
                .setValue(this.mindfulnessStartTimePreset)
                .onChange((val: any) => {
                    this.mindfulnessStartTimePreset = val;
                    customTimeRow.style.display = val === 'custom' ? 'block' : 'none';
                })
            );

        const customTimeRow = container.createDiv();
        customTimeRow.style.display = this.mindfulnessStartTimePreset === 'custom' ? 'block' : 'none';
        new Setting(customTimeRow)
            .setName("Custom Start Time (HH:MM)")
            .addText(t => t.setValue(this.mindfulnessCustomTime).onChange(v => this.mindfulnessCustomTime = v.trim()));

        new Setting(container)
            .addButton(btn => btn
                .setButtonText("Log Mindfulness to Cloud & Note 🧘")
                .setCta()
                .onClick(async () => {
                    btn.setButtonText("Uploading... ⏳");
                    btn.setDisabled(true);

                    const { startIso, endIso } = this.calculateStartAndEndIso(
                        this.targetDate, 
                        this.mindfulnessStartTimePreset, 
                        this.mindfulnessCustomTime, 
                        this.mindfulnessDurationMins
                    );

                    const ok = await this.plugin.healthService.postMindfulnessSession(startIso, endIso);
                    await this.writeMindfulnessToFrontmatter(this.targetDate, this.mindfulnessDurationMins);

                    if (ok) {
                        new Notice(`Logged ${this.mindfulnessDurationMins}m mindfulness to Google Health & daily note! 🧘`);
                        this.close();
                    } else {
                        const err = this.plugin.healthService.lastApiError || "Check OAuth permissions in Settings.";
                        new Notice(`Saved ${this.mindfulnessDurationMins}m to daily note, but Google Health upload failed: ${err}`, 9000);
                        this.close();
                    }
                })
            );
    }

    private async renderLogSleep(container: HTMLElement) {
        new Setting(container)
            .setName("Target Date")
            .setDesc("Date of sleep awakening (YYYY-MM-DD)")
            .addText(t => t.setValue(this.sleepTargetDate).onChange(v => this.sleepTargetDate = v.trim()));

        new Setting(container)
            .setName("Total Sleep Duration (Hours)")
            .setDesc("e.g. 7.5 or 07:30")
            .addText(t => t.setValue(this.sleepHoursStr).onChange(v => this.sleepHoursStr = v.trim()));

        new Setting(container)
            .setName("Deep Sleep (Hours)")
            .setDesc("e.g. 1.5 or 01:30")
            .addText(t => t.setValue(this.deepSleepStr).onChange(v => this.deepSleepStr = v.trim()));

        new Setting(container)
            .setName("Sleep Score (Optional)")
            .setDesc("e.g. 85")
            .addText(t => t.setValue(this.sleepScoreStr).onChange(v => this.sleepScoreStr = v.trim()));

        new Setting(container)
            .setName("Readiness Score (Optional)")
            .setDesc("e.g. 82")
            .addText(t => t.setValue(this.readinessScoreStr).onChange(v => this.readinessScoreStr = v.trim()));

        const noticeBox = container.createDiv();
        noticeBox.style.margin = "10px 0";
        noticeBox.style.padding = "8px 12px";
        noticeBox.style.background = "var(--background-secondary)";
        noticeBox.style.borderRadius = "6px";
        noticeBox.style.fontSize = "0.85em";
        noticeBox.style.color = "var(--text-muted)";
        noticeBox.innerHTML = `ℹ️ <b>Cloud Note:</b> Google Health v4 REST API restricts cloud sleep writes to device sensors. Sleep and readiness stats will be saved directly into your Obsidian daily note frontmatter.`;

        new Setting(container)
            .addButton(btn => btn
                .setButtonText("Save Sleep & Readiness to Daily Note 😴")
                .setCta()
                .onClick(async () => {
                    const file = await this.plugin.noteWriter.getOrCreateDailyNote(this.sleepTargetDate);
                    if (!file) {
                        new Notice(`Could not locate or create daily note for ${this.sleepTargetDate}`);
                        return;
                    }

                    await this.app.fileManager.processFrontMatter(file, (fm) => {
                        if (this.sleepHoursStr) fm.Sleep_hours = this.sleepHoursStr;
                        if (this.deepSleepStr) fm.Deep_sleep = this.deepSleepStr;
                        if (this.sleepScoreStr) fm.Sleep_score = this.sleepScoreStr;
                        if (this.readinessScoreStr) {
                            const readinessKey = this.plugin.settings.healthSyncConfig?.readiness?.key || "Readiness";
                            fm[readinessKey] = this.readinessScoreStr;
                        }
                    });

                    new Notice(`Saved sleep & readiness stats to ${file.basename}! 😴`);
                    this.close();
                })
            );
    }

    // ==========================================
    // 2. VIEW HISTORY TAB
    // ==========================================
    private async renderHistoryTab(container: HTMLElement) {
        new Setting(container)
            .setName("Time Window")
            .setDesc("Select history inspection window")
            .addDropdown(drop => drop
                .addOption("1", "Today Only")
                .addOption("3", "Last 3 Days")
                .addOption("7", "Last 7 Days (Default)")
                .addOption("14", "Last 14 Days")
                .addOption("30", "Last 30 Days")
                .setValue(String(this.historyDays))
                .onChange(async (val) => {
                    this.historyDays = parseInt(val, 10) || 7;
                    await this.renderHistoryTab(container);
                })
            );

        const listContainer = container.createDiv({ cls: "health-history-list-container" });
        listContainer.style.maxHeight = "400px";
        listContainer.style.overflowY = "auto";
        listContainer.style.marginTop = "10px";

        const loading = listContainer.createEl("p", { text: `Fetching ${this.activeCategory} history from Google Health... ⏳` });

        if (this.activeCategory === 'nutrition') {
            const logs = await this.plugin.healthService.fetchLoggedFoodHistory(this.historyDays);
            loading.remove();
            if (logs.length === 0) {
                listContainer.createEl("p", { text: `No food or drinks logged in the last ${this.historyDays} days.` });
                return;
            }

            const registryItems = await this.loadFoodRegistry();
            logs.forEach(log => {
                const setting = new Setting(listContainer)
                    .setName(`${log.dateStr} ${log.displayTime || log.time} — ${log.name}`)
                    .setDesc(log.details);

                const isAlreadyInRegistry = registryItems.some(i => i.name.toLowerCase() === log.name.toLowerCase());
                if (!isAlreadyInRegistry) {
                    setting.addButton(btn => btn
                        .setButtonText("⭐ Save Preset")
                        .onClick(async () => {
                            const newFood: FoodItem = {
                                id: log.name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
                                name: log.name,
                                category: log.category,
                                unit: log.unit || "serving",
                                defaultAmount: 1,
                                calories: log.calories,
                                proteinG: log.proteinG,
                                caffeineMg: log.caffeineMg,
                                waterMl: log.waterMl,
                                alcoholMg: log.alcoholMg
                            };
                            registryItems.push(newFood);
                            await this.saveFoodRegistry(registryItems);
                            new Notice(`Saved "${log.name}" to Food Registry! ⭐`);
                            await this.renderHistoryTab(container);
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
                            await this.plugin.syncTodayHealth(false);
                            await this.renderHistoryTab(container);
                        } else {
                            new Notice("Failed to delete from Google Health.");
                            btn.setButtonText("🗑️ Delete");
                        }
                    })
                );
            });
        } else if (this.activeCategory === 'workout') {
            const workouts = await this.plugin.healthService.fetchExerciseHistory(this.historyDays);
            loading.remove();
            if (workouts.length === 0) {
                listContainer.createEl("p", { text: `No workouts found in Google Health for the last ${this.historyDays} days.` });
                return;
            }

            workouts.forEach(w => {
                const setting = new Setting(listContainer)
                    .setName(`${w.dateStr} ${w.displayTime} — ${w.type}`)
                    .setDesc(`Duration: ${w.durationMins} minutes`);

                // Check if this workout is already recorded in target daily note frontmatter
                const noteFile = this.plugin.noteWriter.findDailyNoteFile(w.dateStr);
                let alreadyInNote = false;
                if (noteFile) {
                    const cache = this.app.metadataCache.getFileCache(noteFile);
                    const currentWorkouts = this.plugin.workoutSyncService.parseWorkoutString(cache?.frontmatter?.workout);
                    alreadyInNote = currentWorkouts.some(lw => {
                        const titleMatch = lw.title.toLowerCase().includes(w.type.toLowerCase()) || 
                                           w.type.toLowerCase().includes(lw.title.toLowerCase()) ||
                                           ((w.type.toLowerCase() === "workout" || w.type.toLowerCase() === "other workout") && Math.abs(lw.durationMins - w.durationMins) <= 5);
                        const durMatch = Math.abs(lw.durationMins - w.durationMins) <= 5;
                        return titleMatch && durMatch;
                    });
                }

                if (alreadyInNote) {
                    setting.addButton(btn => btn
                        .setButtonText("✓ In Note")
                        .setDisabled(true)
                    );
                } else {
                    setting.addButton(btn => btn
                        .setButtonText("Pull to Note 📥")
                        .setCta()
                        .onClick(async () => {
                            await this.writeWorkoutToFrontmatter(w.dateStr, w.type, w.durationMins);
                            new Notice(`Pulled ${w.type} (${w.durationMins}m) into ${w.dateStr}! 📥`);
                            await this.renderHistoryTab(container);
                        })
                    );
                }

                if (w.id) {
                    setting.addButton(btn => btn
                        .setButtonText("🗑️")
                        .setWarning()
                        .onClick(async () => {
                            btn.setButtonText("...");
                            const ok = await this.plugin.healthService.deleteHealthDataPoint("exercise", w.id!);
                            if (ok) {
                                new Notice(`Deleted workout from Google Health 🗑️`);
                                await this.renderHistoryTab(container);
                            }
                        })
                    );
                }
            });
        } else if (this.activeCategory === 'mindfulness') {
            const minds = await this.plugin.healthService.fetchMindfulnessHistory(this.historyDays);
            loading.remove();
            if (minds.length === 0) {
                listContainer.createEl("p", { text: `No mindfulness sessions found in Google Health for the last ${this.historyDays} days.` });
                return;
            }

            minds.forEach(m => {
                const setting = new Setting(listContainer)
                    .setName(`${m.dateStr} ${m.displayTime} — Mindfulness`)
                    .setDesc(`Duration: ${m.durationMins} minutes`);

                const noteFile = this.plugin.noteWriter.findDailyNoteFile(m.dateStr);
                let alreadyInNote = false;
                if (noteFile) {
                    const cache = this.app.metadataCache.getFileCache(noteFile);
                    const curMins = parseInt(String(cache?.frontmatter?.mindfulness_minutes || cache?.frontmatter?.meditation || 0), 10);
                    alreadyInNote = !isNaN(curMins) && curMins >= m.durationMins;
                }

                if (alreadyInNote) {
                    setting.addButton(btn => btn
                        .setButtonText("✓ In Note")
                        .setDisabled(true)
                    );
                } else {
                    setting.addButton(btn => btn
                        .setButtonText("Pull to Note 📥")
                        .setCta()
                        .onClick(async () => {
                            await this.writeMindfulnessToFrontmatter(m.dateStr, m.durationMins);
                            new Notice(`Pulled ${m.durationMins}m mindfulness into ${m.dateStr}! 📥`);
                            await this.renderHistoryTab(container);
                        })
                    );
                }

                if (m.id) {
                    setting.addButton(btn => btn
                        .setButtonText("🗑️")
                        .setWarning()
                        .onClick(async () => {
                            btn.setButtonText("...");
                            const ok = await this.plugin.healthService.deleteHealthDataPoint("mindfulness-session", m.id!);
                            if (ok) {
                                new Notice(`Deleted mindfulness session from Google Health 🗑️`);
                                await this.renderHistoryTab(container);
                            }
                        })
                    );
                }
            });
        } else if (this.activeCategory === 'sleep') {
            loading.setText("Fetching sleep history... ⏳");
            const now = new Date();
            const sleepRecords: Array<{ dateStr: string; sleepHours?: string; deepSleep?: string; score?: any }> = [];

            for (let i = 0; i < Math.min(this.historyDays, 7); i++) {
                const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                try {
                    const data = await this.plugin.healthService.fetchDailyHealth(d);
                    if (data && (data.Sleep_hours || data.sleep || data.Deep_sleep)) {
                        sleepRecords.push({
                            dateStr,
                            sleepHours: data.Sleep_hours || data.sleep,
                            deepSleep: data.Deep_sleep,
                            score: data.Sleep_score || data.readiness
                        });
                    }
                } catch (e) {}
            }

            loading.remove();
            if (sleepRecords.length === 0) {
                listContainer.createEl("p", { text: `No sleep records found in Google Health for the inspected dates.` });
                return;
            }

            sleepRecords.forEach(s => {
                const desc = `Sleep: ${s.sleepHours || '--'} | Deep: ${s.deepSleep || '--'}${s.score ? ` | Score: ${s.score}` : ''}`;
                const setting = new Setting(listContainer)
                    .setName(`${s.dateStr} — Sleep Record`)
                    .setDesc(desc);

                const noteFile = this.plugin.noteWriter.findDailyNoteFile(s.dateStr);
                let alreadyInNote = false;
                if (noteFile) {
                    const cache = this.app.metadataCache.getFileCache(noteFile);
                    alreadyInNote = !!(cache?.frontmatter?.Sleep_hours || cache?.frontmatter?.sleep);
                }

                if (alreadyInNote) {
                    setting.addButton(btn => btn
                        .setButtonText("✓ In Note")
                        .setDisabled(true)
                    );
                } else {
                    setting.addButton(btn => btn
                        .setButtonText("Pull to Note 📥")
                        .setCta()
                        .onClick(async () => {
                            const file = await this.plugin.noteWriter.getOrCreateDailyNote(s.dateStr);
                            if (file) {
                                await this.app.fileManager.processFrontMatter(file, (fm) => {
                                    if (s.sleepHours) fm.Sleep_hours = String(s.sleepHours);
                                    if (s.deepSleep) fm.Deep_sleep = String(s.deepSleep);
                                    if (s.score) fm.Sleep_score = String(s.score);
                                });
                                new Notice(`Pulled sleep stats into ${s.dateStr}! 📥`);
                                await this.renderHistoryTab(container);
                            }
                        })
                    );
                }
            });
        }
    }

    // ==========================================
    // 3. MANAGE REGISTRY TAB
    // ==========================================
    private async renderRegistryTab(container: HTMLElement) {
        if (this.activeCategory === 'nutrition') {
            await this.renderManageFoodRegistry(container);
        } else if (this.activeCategory === 'workout') {
            await this.renderManageWorkoutRegistry(container);
        } else if (this.activeCategory === 'mindfulness') {
            await this.renderManageMindfulnessRegistry(container);
        } else if (this.activeCategory === 'sleep') {
            container.createEl("p", { 
                text: "Sleep does not use a preset item registry because duration and sleep quality vary each night. Use 'Add to Log' to record sleep stats.",
                style: "color: var(--text-muted);" 
            });
        }
    }

    private async renderManageFoodRegistry(container: HTMLElement) {
        const items = await this.loadFoodRegistry();

        container.createEl("h3", { text: "Add New Food Preset" });
        new Setting(container)
            .setName("ID (unique slug)")
            .addText(t => t.setPlaceholder("e.g. cold_brew").onChange(v => this.newFoodId = v.trim()));

        new Setting(container)
            .setName("Display Name")
            .addText(t => t.setPlaceholder("e.g. Cold Brew Coffee").onChange(v => this.newFoodName = v.trim()));

        new Setting(container)
            .setName("Category")
            .addDropdown(drop => drop
                .addOption("nutrition", "Nutrition / Food")
                .addOption("caffeine", "Caffeine / Coffee")
                .addOption("hydration", "Hydration / Water")
                .addOption("alcohol", "Alcohol")
                .setValue(this.newFoodCategory)
                .onChange((v: any) => this.newFoodCategory = v)
            );

        new Setting(container)
            .setName("Serving Unit")
            .addText(t => t.setValue("serving").onChange(v => this.newFoodUnit = v.trim()));

        new Setting(container)
            .setName("Calories (kcal)")
            .addText(t => t.setPlaceholder("0").onChange(v => this.newFoodCalories = parseFloat(v) || 0));

        new Setting(container)
            .setName("Protein (g)")
            .addText(t => t.setPlaceholder("0").onChange(v => this.newFoodProtein = parseFloat(v) || 0));

        new Setting(container)
            .setName("Caffeine (mg)")
            .addText(t => t.setPlaceholder("0").onChange(v => this.newFoodCaffeine = parseFloat(v) || 0));

        new Setting(container)
            .addButton(btn => btn
                .setButtonText("Save to Food Registry ⭐")
                .setCta()
                .onClick(async () => {
                    if (!this.newFoodId || !this.newFoodName) {
                        new Notice("Please enter ID and Name.");
                        return;
                    }
                    const newItem: FoodItem = {
                        id: this.newFoodId,
                        name: this.newFoodName,
                        category: this.newFoodCategory,
                        unit: this.newFoodUnit,
                        defaultAmount: 1,
                        calories: this.newFoodCalories,
                        proteinG: this.newFoodProtein,
                        caffeineMg: this.newFoodCaffeine,
                        waterMl: this.newFoodWater,
                        alcoholMg: this.newFoodAlcohol > 0 ? Math.round(this.newFoodAlcohol * 1000) : undefined
                    };
                    items.push(newItem);
                    await this.saveFoodRegistry(items);
                    new Notice(`Added "${this.newFoodName}" to Food Registry!`);
                    await this.renderRegistryTab(container);
                })
            );

        container.createEl("h3", { text: `Existing Food Items (${items.length})` });
        items.forEach((item, idx) => {
            new Setting(container)
                .setName(`${item.name} (${item.unit})`)
                .setDesc(`Category: ${item.category} | ${item.calories ? item.calories + ' kcal ' : ''}${item.proteinG ? item.proteinG + 'g protein ' : ''}${item.caffeineMg ? item.caffeineMg + 'mg caff' : ''}`)
                .addButton(btn => btn
                    .setButtonText("Delete")
                    .setWarning()
                    .onClick(async () => {
                        items.splice(idx, 1);
                        await this.saveFoodRegistry(items);
                        await this.renderRegistryTab(container);
                    })
                );
        });
    }

    private async renderManageWorkoutRegistry(container: HTMLElement) {
        const workouts = await this.loadWorkoutRegistry();

        container.createEl("h3", { text: "Add New Workout Preset" });
        new Setting(container)
            .setName("ID (unique slug)")
            .addText(t => t.setPlaceholder("e.g. trail_run").onChange(v => this.newWorkoutId = v.trim()));

        new Setting(container)
            .setName("Display Name")
            .addText(t => t.setPlaceholder("e.g. Trail Run").onChange(v => this.newWorkoutName = v.trim()));

        new Setting(container)
            .setName("Category")
            .addDropdown(drop => drop
                .addOption("walking", "Walking")
                .addOption("running", "Running")
                .addOption("strength", "Strength Training")
                .addOption("cardio", "Cardio / Cycling")
                .addOption("flexibility", "Flexibility / Yoga")
                .addOption("other", "Other")
                .setValue(this.newWorkoutCategory)
                .onChange((v: any) => this.newWorkoutCategory = v)
            );

        new Setting(container)
            .setName("Google Health Activity Type")
            .setDesc("Google Health v4 activity constant")
            .addDropdown(drop => drop
                .addOption("WALKING", "WALKING")
                .addOption("RUNNING", "RUNNING")
                .addOption("STRENGTH_TRAINING", "STRENGTH_TRAINING")
                .addOption("BIKING", "BIKING")
                .addOption("YOGA", "YOGA")
                .addOption("STRETCHING", "STRETCHING")
                .addOption("CALISTHENICS", "CALISTHENICS")
                .addOption("SWIMMING", "SWIMMING")
                .addOption("PILATES", "PILATES")
                .addOption("AEROBICS", "AEROBICS")
                .addOption("OTHER_WORKOUT", "OTHER_WORKOUT")
                .setValue(this.newWorkoutGhType)
                .onChange(v => this.newWorkoutGhType = v)
            );

        new Setting(container)
            .setName("Default Duration (Minutes)")
            .addText(t => t.setValue(String(this.newWorkoutDuration)).onChange(v => this.newWorkoutDuration = parseInt(v, 10) || 30));

        new Setting(container)
            .addButton(btn => btn
                .setButtonText("Save to Workout Registry ⭐")
                .setCta()
                .onClick(async () => {
                    if (!this.newWorkoutId || !this.newWorkoutName) {
                        new Notice("Please enter ID and Name.");
                        return;
                    }
                    const newItem: WorkoutItem = {
                        id: this.newWorkoutId,
                        name: this.newWorkoutName,
                        category: this.newWorkoutCategory,
                        googleHealthType: this.newWorkoutGhType,
                        defaultDurationMins: this.newWorkoutDuration
                    };
                    workouts.push(newItem);
                    await this.saveWorkoutRegistry(workouts);
                    new Notice(`Added "${this.newWorkoutName}" to Workout Registry!`);
                    await this.renderRegistryTab(container);
                })
            );

        container.createEl("h3", { text: `Existing Workout Items (${workouts.length})` });
        workouts.forEach((item, idx) => {
            new Setting(container)
                .setName(`${item.name} (${item.defaultDurationMins}m default)`)
                .setDesc(`Category: ${item.category} | Google Health Type: ${item.googleHealthType}`)
                .addButton(btn => btn
                    .setButtonText("Delete")
                    .setWarning()
                    .onClick(async () => {
                        workouts.splice(idx, 1);
                        await this.saveWorkoutRegistry(workouts);
                        await this.renderRegistryTab(container);
                    })
                );
        });
    }

    private async renderManageMindfulnessRegistry(container: HTMLElement) {
        const minds = await this.loadMindfulnessRegistry();

        container.createEl("h3", { text: "Add New Mindfulness Preset" });
        new Setting(container)
            .setName("ID (unique slug)")
            .addText(t => t.setPlaceholder("e.g. sound_bath").onChange(v => this.newMindId = v.trim()));

        new Setting(container)
            .setName("Display Name")
            .addText(t => t.setPlaceholder("e.g. Sound Bath").onChange(v => this.newMindName = v.trim()));

        new Setting(container)
            .setName("Category")
            .addDropdown(drop => drop
                .addOption("meditation", "Meditation")
                .addOption("breathwork", "Breathwork")
                .addOption("bodyscan", "Body Scan")
                .addOption("other", "Other")
                .setValue(this.newMindCategory)
                .onChange((v: any) => this.newMindCategory = v)
            );

        new Setting(container)
            .setName("Default Duration (Minutes)")
            .addText(t => t.setValue(String(this.newMindDuration)).onChange(v => this.newMindDuration = parseInt(v, 10) || 15));

        new Setting(container)
            .addButton(btn => btn
                .setButtonText("Save to Mindfulness Registry ⭐")
                .setCta()
                .onClick(async () => {
                    if (!this.newMindId || !this.newMindName) {
                        new Notice("Please enter ID and Name.");
                        return;
                    }
                    const newItem: MindfulnessItem = {
                        id: this.newMindId,
                        name: this.newMindName,
                        category: this.newMindCategory,
                        defaultDurationMins: this.newMindDuration
                    };
                    minds.push(newItem);
                    await this.saveMindfulnessRegistry(minds);
                    new Notice(`Added "${this.newMindName}" to Mindfulness Registry!`);
                    await this.renderRegistryTab(container);
                })
            );

        container.createEl("h3", { text: `Existing Mindfulness Presets (${minds.length})` });
        minds.forEach((item, idx) => {
            new Setting(container)
                .setName(`${item.name} (${item.defaultDurationMins}m default)`)
                .setDesc(`Category: ${item.category}`)
                .addButton(btn => btn
                    .setButtonText("Delete")
                    .setWarning()
                    .onClick(async () => {
                        minds.splice(idx, 1);
                        await this.saveMindfulnessRegistry(minds);
                        await this.renderRegistryTab(container);
                    })
                );
        });
    }

    // ==========================================
    // HELPER METHODS
    // ==========================================
    private calculateStartAndEndIso(
        dateStr: string, 
        preset: 'now' | 'noon' | 'morning' | 'evening' | 'custom', 
        customTime: string, 
        durationMins: number
    ): { startIso: string; endIso: string } {
        let startMs: number;
        if (preset === 'now') {
            startMs = Date.now() - (durationMins * 60 * 1000);
        } else if (preset === 'noon') {
            startMs = new Date(`${dateStr}T12:00:00`).getTime();
        } else if (preset === 'morning') {
            startMs = new Date(`${dateStr}T08:00:00`).getTime();
        } else if (preset === 'evening') {
            startMs = new Date(`${dateStr}T18:00:00`).getTime();
        } else {
            const timePart = customTime.length === 5 ? `${customTime}:00` : customTime;
            startMs = new Date(`${dateStr}T${timePart}`).getTime();
        }

        if (isNaN(startMs)) {
            startMs = new Date(`${dateStr}T12:00:00`).getTime();
        }

        const endMs = startMs + (durationMins * 60 * 1000);
        return {
            startIso: new Date(startMs).toISOString(),
            endIso: new Date(endMs).toISOString()
        };
    }

    private async writeWorkoutToFrontmatter(dateStr: string, workoutName: string, durationMins: number): Promise<void> {
        const file = await this.plugin.noteWriter.getOrCreateDailyNote(dateStr);
        if (!file) return;

        const sessionEntry = `${workoutName} (${durationMins}m)`;
        await this.app.fileManager.processFrontMatter(file, (fm) => {
            const existing = String(fm.workout || "").trim();
            if (!existing) {
                fm.workout = sessionEntry;
            } else {
                const parts = existing.split(',').map(s => s.trim()).filter(Boolean);
                const matchIdx = parts.findIndex(p => p.toLowerCase().startsWith(workoutName.toLowerCase()));
                if (matchIdx !== -1) {
                    parts[matchIdx] = sessionEntry;
                    fm.workout = parts.join(', ');
                } else {
                    parts.push(sessionEntry);
                    fm.workout = parts.join(', ');
                }
            }
        });
    }

    private async writeMindfulnessToFrontmatter(dateStr: string, durationMins: number): Promise<void> {
        const file = await this.plugin.noteWriter.getOrCreateDailyNote(dateStr);
        if (!file) return;

        await this.app.fileManager.processFrontMatter(file, (fm) => {
            const current = parseInt(String(fm.mindfulness_minutes || fm.meditation || 0), 10);
            fm.mindfulness_minutes = String((isNaN(current) ? 0 : current) + durationMins);
        });
    }

    private getPluginRegistryPath(): string {
        const anyAdapter = this.app.vault.adapter as any;
        const vaultPath = anyAdapter.getBasePath ? anyAdapter.getBasePath() : "";
        return path.join(vaultPath, ".obsidian", "plugins", "health-connect-readiness", "health_go_to_items.json");
    }

    public async loadFoodRegistry(): Promise<FoodItem[]> {
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

    public async saveFoodRegistry(items: FoodItem[]): Promise<void> {
        this.plugin.settings.foodRegistry = items;
        await this.plugin.saveSettings();

        const filePath = this.getPluginRegistryPath();
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        try {
            fs.writeFileSync(filePath, JSON.stringify(items, null, 2), "utf8");
        } catch(e) {}
    }

    public async loadWorkoutRegistry(): Promise<WorkoutItem[]> {
        if (this.plugin.settings.workoutRegistry && this.plugin.settings.workoutRegistry.length > 0) {
            return this.plugin.settings.workoutRegistry;
        }
        return DEFAULT_WORKOUT_ITEMS;
    }

    public async saveWorkoutRegistry(items: WorkoutItem[]): Promise<void> {
        this.plugin.settings.workoutRegistry = items;
        await this.plugin.saveSettings();
    }

    public async loadMindfulnessRegistry(): Promise<MindfulnessItem[]> {
        if (this.plugin.settings.mindfulnessRegistry && this.plugin.settings.mindfulnessRegistry.length > 0) {
            return this.plugin.settings.mindfulnessRegistry;
        }
        return DEFAULT_MINDFULNESS_ITEMS;
    }

    public async saveMindfulnessRegistry(items: MindfulnessItem[]): Promise<void> {
        this.plugin.settings.mindfulnessRegistry = items;
        await this.plugin.saveSettings();
    }
}
