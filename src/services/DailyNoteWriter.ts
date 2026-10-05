import { App, TFile, Notice, normalizePath } from "obsidian";
import { HealthPluginSettings } from "../models/HealthSettings";
import { FormulaEvaluator } from "./FormulaEvaluator";

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

            // Evaluate custom calculated metrics configured with writeToNote
            const writebackCalcs = (this.settings.calculatedMetrics || []).filter(m => m.writeToNote && m.formula);
            if (writebackCalcs.length > 0) {
                const cache = this.app.metadataCache.getFileCache(file);
                const evalContext = Object.assign({}, cache?.frontmatter || {}, data);

                // Load previous day's daily note to populate _prev and _yesterday variables
                try {
                    const curDate = new Date(`${dateStr}T12:00:00`);
                    const prevDate = new Date(curDate.getTime() - 86400000);
                    const prevDateStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
                    const prevFile = this.findDailyNoteFile(prevDateStr);
                    if (prevFile) {
                        const prevCache = this.app.metadataCache.getFileCache(prevFile);
                        if (prevCache?.frontmatter) {
                            for (const [pk, pv] of Object.entries(prevCache.frontmatter)) {
                                evalContext[`${pk}_prev`] = pv;
                                evalContext[`${pk}_yesterday`] = pv;
                            }
                        }
                    }
                } catch (err) {
                    console.warn("[Health Connect] Could not load previous day note for formula writeback:", err);
                }

                for (const calc of writebackCalcs) {
                    const val = FormulaEvaluator.evaluate(calc.formula, evalContext);
                    if (val !== null) {
                        data[calc.key] = val;
                    }
                }
            }

            // Resolve mindfulness minutes from data, frontmatter, manual logs, or Focus Log
            const resolvedMindfulness = await this.resolveMindfulnessMinutes(file, data);
            if (resolvedMindfulness && resolvedMindfulness > 0) {
                const mindKey = this.settings.healthSyncConfig?.mindfulness?.key || "mindfulness_minutes";
                data[mindKey] = resolvedMindfulness;
                if (mindKey !== "meditation" && data.meditation !== undefined) {
                    delete data.meditation;
                }
            }

            console.log(`[Obsidian Health Connect] 📝 Updating Daily Note Frontmatter (${dateStr}):`, data);
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                for (const [k, v] of Object.entries(data)) {
                    if (v !== undefined && v !== null && v !== "") {
                        fm[k] = String(v);
                    }
                }
                const mindKey = this.settings.healthSyncConfig?.mindfulness?.key || "mindfulness_minutes";
                if (mindKey === "mindfulness_minutes" && fm.meditation !== undefined) {
                    delete fm.meditation;
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

        // If file already exists at targetPath, return it directly
        const existing = this.app.vault.getAbstractFileByPath(targetPath);
        if (existing instanceof TFile) return existing;

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
            const retry = this.app.vault.getAbstractFileByPath(targetPath);
            if (retry instanceof TFile) return retry;
            return null;
        }
    }

    public findDailyNoteFile(dateStr: string): TFile | null {
        // 1. Check standard configured path first
        const targetFolder = this.resolveDailyNotesFolder();
        if (targetFolder) {
            const standardPath = normalizePath(`${targetFolder}/${dateStr}.md`);
            const direct = this.app.vault.getAbstractFileByPath(standardPath);
            if (direct instanceof TFile) return direct;
        }

        const files = this.app.vault.getMarkdownFiles();
        // 2. Exact match on basename, preferring folder-nested notes over root
        const matching = files.filter(f => f.basename.trim() === dateStr || f.name.trim() === `${dateStr}.md`);
        if (matching.length > 0) {
            const preferred = matching.find(f => f.path.includes('01_Daily') || f.path.includes('Daily') || f.path.includes('Journal') || f.path.includes('/'));
            return preferred || matching[0];
        }

        // 3. Filename contains dateStr
        const byPath = files.filter(f => f.name.includes(dateStr) || f.path.includes(dateStr));
        if (byPath.length > 0) {
            const preferred = byPath.find(f => f.path.includes('01_Daily') || f.path.includes('Daily') || f.path.includes('Journal'));
            return preferred || byPath[0];
        }

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

    public async resolveMindfulnessMinutes(file: TFile, data: Record<string, any>): Promise<number | null> {
        // 1. Check data payload directly (e.g. from Google Health exercise MEDITATE or API)
        if (data.mindfulness_minutes && Number(data.mindfulness_minutes) > 0) {
            return Number(data.mindfulness_minutes);
        }
        if (data.meditation && Number(data.meditation) > 0) {
            return Number(data.meditation);
        }

        // 2. Check frontmatter of existing file (preserve previously synced or user-entered value)
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (fm) {
            const fmVal = fm.mindfulness_minutes || fm.mindfulness || fm.meditation || fm.meditation_minutes;
            if (fmVal !== undefined && fmVal !== null && !isNaN(Number(fmVal)) && Number(fmVal) > 0) {
                return Number(fmVal);
            }
        }

        // 3. Check note content for generic meditation duration pattern: e.g. "Meditation (20m)" or "Mindfulness (30m)"
        try {
            const content = await this.app.vault.read(file);
            const explicitMatch = content.match(/(?:Meditation|Mindfulness)\s*\(\s*(\d+)\s*m/i);
            if (explicitMatch && explicitMatch[1]) {
                return parseInt(explicitMatch[1], 10);
            }
        } catch (e) {
            console.warn("[Health Connect] Could not inspect file content for mindfulness fallback:", e);
        }

        return null;
    }
}
