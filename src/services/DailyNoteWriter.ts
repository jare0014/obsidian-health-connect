import { App, TFile, Notice, normalizePath } from "obsidian";
import { HealthPluginSettings } from "../models/HealthSettings";

export class DailyNoteWriter {
    private app: App;
    private settings: HealthPluginSettings;

    constructor(app: App, settings: HealthPluginSettings) {
        this.app = app;
        this.settings = settings;
    }

    public async writeData(dateStr: string, data: Record<string, any>, showNotice: boolean = true): Promise<boolean> {
        try {
            const file = await this.getOrCreateDailyNote(dateStr);
            if (!file) {
                if (showNotice) new Notice(`Failed to locate or create daily note for ${dateStr}.`);
                return false;
            }

            console.log(`[Obsidian Health Connect] 📝 Updating Daily Note Frontmatter (${dateStr}):`, data);
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                for (const [k, v] of Object.entries(data)) {
                    if (v !== undefined && v !== null && v !== "") {
                        fm[k] = String(v);
                    }
                }
            });
            if (showNotice) new Notice(`[Health Connect] Successfully synced health data to ${file.name} 🟢`);
            return true;
        } catch (e) {
            console.error("[Obsidian Health Connect] Failed to write to daily note frontmatter:", e);
            if (showNotice) new Notice(`[Health Connect] Error writing to daily note: ${e}`);
            return false;
        }
    }

    public async getOrCreateDailyNote(dateStr: string): Promise<TFile | null> {
        let file = this.findDailyNoteFile(dateStr);
        if (file) return file;

        // Auto-create missing daily note in the resolved daily notes folder
        const targetFolder = this.resolveDailyNotesFolder();
        const targetPath = normalizePath(targetFolder ? `${targetFolder}/${dateStr}.md` : `${dateStr}.md`);

        // Ensure parent folder exists
        if (targetFolder) {
            const folderExists = this.app.vault.getAbstractFileByPath(normalizePath(targetFolder));
            if (!folderExists) {
                try {
                    await this.app.vault.createFolder(normalizePath(targetFolder));
                } catch (e) {
                    console.warn(`[Health Connect] Could not create folder ${targetFolder}:`, e);
                }
            }
        }

        const initialContent = `---\ndate: ${dateStr}\n---\n\n`;
        try {
            file = await this.app.vault.create(targetPath, initialContent);
            console.log(`[Health Connect] ✨ Created new daily note at ${targetPath}`);
            return file;
        } catch (e) {
            console.error(`[Health Connect] Failed to create daily note at ${targetPath}:`, e);
            // Fallback: try creating in root
            try {
                file = await this.app.vault.create(`${dateStr}.md`, initialContent);
                return file;
            } catch (err) {
                return null;
            }
        }
    }

    public findDailyNoteFile(dateStr: string): TFile | null {
        const files = this.app.vault.getMarkdownFiles();
        // 1. Exact match on basename (e.g. 2026-08-20.md)
        const exact = files.find(f => f.basename.trim() === dateStr);
        if (exact) return exact;

        // 2. Filename contains dateStr
        const byPath = files.find(f => f.name.includes(dateStr) || f.path.includes(dateStr));
        if (byPath) return byPath;

        return null;
    }

    public resolveDailyNotesFolder(): string {
        // 1. User explicit setting in plugin
        if (this.settings.dailyNotesFolder && this.settings.dailyNotesFolder.trim()) {
            return this.settings.dailyNotesFolder.trim();
        }

        // 2. Obsidian built-in Daily Notes core plugin setting
        try {
            const dailyPlugin = (this.app as any).internalPlugins?.plugins?.['daily-notes'];
            if (dailyPlugin?.enabled && dailyPlugin.instance?.options?.folder) {
                return dailyPlugin.instance.options.folder;
            }
        } catch (e) {}

        // 3. Periodic Notes community plugin setting
        try {
            const periodicPlugin = (this.app as any).plugins?.plugins?.['periodic-notes'];
            if (periodicPlugin?.settings?.daily?.folder) {
                return periodicPlugin.settings.daily.folder;
            }
        } catch (e) {}

        // 4. Scan vault for existing YYYY-MM-DD notes and adopt their folder
        const dateFiles = this.app.vault.getMarkdownFiles().filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f.basename.trim()));
        if (dateFiles.length > 0) {
            const parent = dateFiles[0].parent?.path;
            if (parent && parent !== "/") return parent;
        }

        return "";
    }
}
