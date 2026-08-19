import { App, TFile, Notice } from "obsidian";
import { HealthPluginSettings } from "../models/HealthSettings";

export class DailyNoteWriter {
    private app: App;
    private settings: HealthPluginSettings;

    constructor(app: App, settings: HealthPluginSettings) {
        this.app = app;
        this.settings = settings;
    }

    public async writeData(dateStr: string, data: Record<string, any>): Promise<boolean> {
        const file = this.findDailyNoteFile(dateStr);
        if (!file) {
            new Notice(`Daily note for ${dateStr} not found.`);
            return false;
        }

        try {
            console.log(`[Obsidian Health Connect] 📝 Updating Daily Note Frontmatter (${dateStr}):`, data);
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                for (const [k, v] of Object.entries(data)) {
                    if (v !== undefined && v !== null && v !== "") {
                        fm[k] = String(v);
                    }
                }
            });
            new Notice(`[Health Connect] Successfully synced health data to ${dateStr}.md 🟢`);
            return true;
        } catch (e) {
            console.error("[Obsidian Health Connect] Failed to write to daily note frontmatter:", e);
            return false;
        }
    }

    private findDailyNoteFile(dateStr: string): TFile | null {
        const files = this.app.vault.getMarkdownFiles();
        return files.find(f => f.basename === dateStr || f.name === `${dateStr}.md` || f.path.includes(dateStr)) || null;
    }
}
