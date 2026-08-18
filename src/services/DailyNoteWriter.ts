import { App, TFile, Notice } from "obsidian";
import { HealthPluginSettings, DailyHealthSnapshot } from "../models/HealthTypes";

export class DailyNoteWriter {
    private app: App;
    private settings: HealthPluginSettings;

    constructor(app: App, settings: HealthPluginSettings) {
        this.app = app;
        this.settings = settings;
    }

    public async writeHealthSnapshot(dateStr: string, snapshot: DailyHealthSnapshot): Promise<boolean> {
        const file = this.findDailyNoteFile(dateStr);
        if (!file) {
            new Notice(`Daily note for ${dateStr} not found in ${this.settings.dailyNotesFolder}`);
            return false;
        }

        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                const map = this.settings.fieldMappings;
                
                if (snapshot.sleep?.sleepHours) fm[map.sleepHoursKey] = snapshot.sleep.sleepHours;
                if (snapshot.sleep?.wakeUpTime) fm[map.wakeUpKey] = snapshot.sleep.wakeUpTime;
                if (snapshot.sleep?.sleepScore) fm[map.sleepScoreKey] = String(snapshot.sleep.sleepScore);
                
                if (snapshot.vitals?.hrv) fm[map.hrvKey] = String(snapshot.vitals.hrv);
                if (snapshot.vitals?.readinessScore) fm[map.readinessKey] = String(snapshot.vitals.readinessScore);
                
                if (snapshot.nutrition?.caffeineMg !== undefined) fm[map.caffeineKey] = String(snapshot.nutrition.caffeineMg);
                if (snapshot.nutrition?.alcoholMg !== undefined) fm[map.alcoholKey] = String(snapshot.nutrition.alcoholMg);
                if (snapshot.nutrition?.hydrationFlOz !== undefined) fm[map.hydrationKey] = String(snapshot.nutrition.hydrationFlOz);
            });

            new Notice(`Synced Health data into ${file.basename}! 🩺`);
            return true;
        } catch (e) {
            console.error("Failed to update daily note frontmatter:", e);
            new Notice("Error writing health metrics to daily note.");
            return false;
        }
    }

    private findDailyNoteFile(dateStr: string): TFile | null {
        const files = this.app.vault.getMarkdownFiles();
        return files.find(f => f.basename === dateStr || f.name === `${dateStr}.md` || f.path.includes(dateStr)) || null;
    }
}
