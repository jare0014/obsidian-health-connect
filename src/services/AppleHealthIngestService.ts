import { App, TFile, TFolder, normalizePath, Notice } from "obsidian";
import { HealthPluginSettings } from "../models/HealthSettings";
import { DailyNoteWriter } from "./DailyNoteWriter";

export interface ParsedHealthSample {
    date: string; // YYYY-MM-DD
    metrics: Record<string, number | string>;
}

export class AppleHealthIngestService {
    private app: App;
    private settings: HealthPluginSettings;
    private noteWriter: DailyNoteWriter;
    private isScanning: boolean = false;

    constructor(app: App, settings: HealthPluginSettings, noteWriter: DailyNoteWriter) {
        this.app = app;
        this.settings = settings;
        this.noteWriter = noteWriter;
    }

    /**
     * Checks if a file is inside the configured Apple Health drop folder
     */
    public isTargetDropFile(file: TFile): boolean {
        if (!this.settings.enableAppleHealthIngest) return false;
        if (!file || file.extension !== "json") return false;

        const dropFolder = normalizePath(this.settings.appleHealthDropFolder || "00_Imports/Health");
        const archiveFolder = normalizePath(this.settings.appleHealthArchiveFolder || `${dropFolder}/Archive`);

        // Skip files already inside the archive folder
        if (file.path.startsWith(archiveFolder)) return false;

        // Check if file is in the drop folder
        return file.path.startsWith(dropFolder);
    }

    /**
     * Scans and processes all pending JSON files in the drop folder
     */
    public async scanAndIngestDropFolder(): Promise<number> {
        if (!this.settings.enableAppleHealthIngest) {
            console.log("[AppleHealthIngest] Ingestion is disabled in settings.");
            return 0;
        }

        if (this.isScanning) {
            console.log("[AppleHealthIngest] Scan already in progress.");
            return 0;
        }

        this.isScanning = true;
        let processedCount = 0;

        try {
            const dropFolderPath = normalizePath(this.settings.appleHealthDropFolder || "00_Imports/Health");
            const dropFolder = this.app.vault.getAbstractFileByPath(dropFolderPath);

            if (!dropFolder || !(dropFolder instanceof TFolder)) {
                console.log(`[AppleHealthIngest] Drop folder '${dropFolderPath}' does not exist yet.`);
                return 0;
            }

            const jsonFiles: TFile[] = [];
            this.collectJsonFiles(dropFolder, jsonFiles);

            console.log(`[AppleHealthIngest] Found ${jsonFiles.length} pending JSON file(s) in '${dropFolderPath}'.`);

            for (const file of jsonFiles) {
                const success = await this.processFile(file);
                if (success) {
                    processedCount++;
                }
            }

            if (processedCount > 0) {
                new Notice(`[Health Connect] Ingested ${processedCount} Apple Health file(s) into Daily Notes! 🍎`);
            }
        } catch (error) {
            console.error("[AppleHealthIngest] Error during drop folder scan:", error);
            new Notice(`[Health Connect] Error processing Apple Health drop folder: ${error}`);
        } finally {
            this.isScanning = false;
        }

        return processedCount;
    }

    /**
     * Recursively collect JSON files excluding archive directories
     */
    private collectJsonFiles(folder: TFolder, list: TFile[]): void {
        const archiveFolder = normalizePath(this.settings.appleHealthArchiveFolder || `${this.settings.appleHealthDropFolder}/Archive`);
        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === "json") {
                if (!child.path.startsWith(archiveFolder)) {
                    list.push(child);
                }
            } else if (child instanceof TFolder && !child.path.startsWith(archiveFolder)) {
                this.collectJsonFiles(child, list);
            }
        }
    }

    /**
     * Parses and applies a single JSON drop file
     */
    public async processFile(file: TFile): Promise<boolean> {
        try {
            const rawContent = await this.app.vault.read(file);
            if (!rawContent || !rawContent.trim()) {
                console.warn(`[AppleHealthIngest] File ${file.path} is empty. Skipping.`);
                return false;
            }

            const json = JSON.parse(rawContent);
            const dailyDataMap = this.parseHealthJson(json, file.basename);

            if (Object.keys(dailyDataMap).length === 0) {
                console.warn(`[AppleHealthIngest] Could not extract structured health metrics from ${file.path}.`);
                return false;
            }

            // Write each day's metrics into the corresponding daily note
            for (const [dateStr, metrics] of Object.entries(dailyDataMap)) {
                await this.noteWriter.writeData(dateStr, metrics, false);
                console.log(`[AppleHealthIngest] Ingested ${Object.keys(metrics).length} metric(s) for ${dateStr} from ${file.name}`);
            }

            // Auto-archive or rename file if enabled
            if (this.settings.appleHealthAutoArchive) {
                await this.archiveFile(file);
            }

            return true;
        } catch (error) {
            console.error(`[AppleHealthIngest] Failed to parse and ingest file ${file.path}:`, error);
            return false;
        }
    }

    /**
     * Flexible schema parser that handles Apple Shortcuts health dictionaries, arrays, and nested metrics
     */
    public parseHealthJson(json: any, fallbackDateHint: string = ""): Record<string, Record<string, any>> {
        const result: Record<string, Record<string, any>> = {};

        const todayStr = this.getTodayDateString();
        const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/;
        const hintMatch = fallbackDateHint.match(dateRegex);
        const defaultDate = hintMatch ? hintMatch[1] : todayStr;

        // Case A: Array of sample records
        if (Array.isArray(json)) {
            for (const item of json) {
                const date = this.extractDate(item) || defaultDate;
                if (!result[date]) result[date] = {};
                this.extractMetricsFromObject(item, result[date]);
            }
            return result;
        }

        // Case B: Object with date keys e.g. { "2026-08-23": { "protein": 30, "calories": 500 } }
        if (typeof json === "object" && json !== null) {
            let hasDateKeys = false;
            for (const [key, val] of Object.entries(json)) {
                if (dateRegex.test(key) && typeof val === "object" && val !== null) {
                    hasDateKeys = true;
                    const dateMatch = key.match(dateRegex);
                    const date = dateMatch ? dateMatch[1] : defaultDate;
                    if (!result[date]) result[date] = {};
                    this.extractMetricsFromObject(val, result[date]);
                }
            }
            if (hasDateKeys) {
                return result;
            }

            // Case C: Single-day flat or nested object
            const date = this.extractDate(json) || defaultDate;
            result[date] = {};
            this.extractMetricsFromObject(json, result[date]);
            return result;
        }

        return result;
    }

    /**
     * Extracts date string (YYYY-MM-DD) from item fields
     */
    private extractDate(item: any): string | null {
        if (!item || typeof item !== "object") return null;

        const candidateFields = ["date", "date_str", "timestamp", "startDate", "endDate", "created_at", "time"];
        for (const field of candidateFields) {
            const val = item[field];
            if (typeof val === "string") {
                const match = val.match(/\b(\d{4}-\d{2}-\d{2})\b/);
                if (match) return match[1];
            } else if (typeof val === "number") {
                // Unix timestamp (ms or s)
                const ms = val > 1e11 ? val : val * 1000;
                const d = new Date(ms);
                if (!isNaN(d.getTime())) {
                    return d.toISOString().split("T")[0];
                }
            }
        }
        return null;
    }

    /**
     * Matches known Apple Health metric identifiers into standardized frontmatter properties
     */
    private extractMetricsFromObject(obj: any, target: Record<string, any>): void {
        if (!obj || typeof obj !== "object") return;

        // Metric mapping rules (Aliases -> Canonical Property Key)
        const mappingRules: Array<{ aliases: string[]; canonicalKey: string; round?: boolean }> = [
            // Nutrition & Macros
            { aliases: ["dietary_protein", "protein_g", "protein", "dietaryprotein"], canonicalKey: "protein", round: true },
            { aliases: ["dietary_energy", "active_energy", "calories", "calories_kcal", "energy", "dietaryenergy", "activeenergyburned"], canonicalKey: "calories", round: true },
            { aliases: ["dietary_carbohydrates", "carbohydrates", "carbs", "carbs_g", "dietarycarbohydrates"], canonicalKey: "carbs", round: true },
            { aliases: ["dietary_fat", "total_fat", "fat", "fat_g", "dietaryfat"], canonicalKey: "fat", round: true },
            { aliases: ["dietary_water", "water", "water_ml", "hydration", "dietarywater"], canonicalKey: "hydration", round: true },
            { aliases: ["dietary_caffeine", "caffeine", "caffeine_mg", "dietarycaffeine"], canonicalKey: "caffeine", round: true },
            { aliases: ["alcohol", "alcohol_drinks", "alcohol_g", "drinks"], canonicalKey: "alcohol", round: true },
            
            // Activity & Vitals
            { aliases: ["step_count", "steps", "stepcount"], canonicalKey: "steps", round: true },
            { aliases: ["apple_exercise_time", "active_minutes", "exercise_time", "workout_minutes"], canonicalKey: "active_minutes", round: true },
            { aliases: ["workout", "exercise", "workout_name"], canonicalKey: "workout" },
            { aliases: ["resting_heart_rate", "restingheartrate", "rhr"], canonicalKey: "resting_heart_rate", round: true },
            { aliases: ["heart_rate_variability_sdnn", "hrv", "heartratevariabilitysdnn"], canonicalKey: "HRV", round: true },
            { aliases: ["body_mass", "weight", "weight_lbs", "weight_kg", "bodymass"], canonicalKey: "weight" },

            // Sleep & Recovery
            { aliases: ["sleep_analysis", "sleep_hours", "sleephours", "asleep_time", "total_sleep"], canonicalKey: "Sleep_hours" },
            { aliases: ["sleep_score", "sleepscore"], canonicalKey: "Sleep_score", round: true },
            { aliases: ["readiness", "readiness_score", "recovery"], canonicalKey: "Readiness", round: true }
        ];

        // 1. Check if the object is an Apple sample format: { type/name: "...", value/qty/qty_val: ... }
        const typeKey = obj.type || obj.name || obj.sampleType || obj.identifier;
        const valKey = obj.value !== undefined ? obj.value : (obj.qty !== undefined ? obj.qty : obj.quantity);
        if (typeKey && typeof typeKey === "string" && valKey !== undefined) {
            const cleanType = typeKey.toLowerCase().replace(/[^a-z0-9_]/g, "");
            for (const rule of mappingRules) {
                if (rule.aliases.some(a => cleanType.includes(a.toLowerCase().replace(/[^a-z0-9_]/g, "")))) {
                    this.applyMetricValue(target, rule.canonicalKey, valKey, rule.round);
                    return;
                }
            }
        }

        // 2. Iterate through keys
        for (const [k, v] of Object.entries(obj)) {
            if (v === null || v === undefined) continue;

            const cleanKey = k.toLowerCase().replace(/[^a-z0-9_]/g, "");

            // Recurse into nested dictionaries if needed
            if (typeof v === "object" && !Array.isArray(v)) {
                this.extractMetricsFromObject(v, target);
                continue;
            }

            let matched = false;
            for (const rule of mappingRules) {
                if (rule.aliases.some(a => a.toLowerCase().replace(/[^a-z0-9_]/g, "") === cleanKey)) {
                    this.applyMetricValue(target, rule.canonicalKey, v, rule.round);
                    matched = true;
                    break;
                }
            }

            // If not matched to a canonical rule, keep the raw key if it looks like a clean identifier
            if (!matched && !["date", "timestamp", "type", "unit", "id", "created_at"].includes(cleanKey)) {
                if (typeof v === "number" || typeof v === "string") {
                    target[k] = v;
                }
            }
        }
    }

    /**
     * Applies value with type casting and numeric summation for intra-day repeated entries
     */
    private applyMetricValue(target: Record<string, any>, key: string, val: any, round: boolean = false): void {
        let num = typeof val === "number" ? val : parseFloat(String(val));

        if (!isNaN(num)) {
            if (round) {
                num = Math.round(num * 10) / 10;
            }

            // If key already exists as a number, accumulate values (e.g. multiple food meals or step batches)
            if (typeof target[key] === "number") {
                const combined = (target[key] as number) + num;
                target[key] = round ? Math.round(combined * 10) / 10 : combined;
            } else {
                target[key] = num;
            }
        } else if (typeof val === "string" && val.trim()) {
            target[key] = val.trim();
        }
    }

    /**
     * Safely moves processed drop file to the archive folder
     */
    private async archiveFile(file: TFile): Promise<void> {
        try {
            const archiveFolderPath = normalizePath(this.settings.appleHealthArchiveFolder || "00_Imports/Health/Archive");
            
            // Ensure archive folder exists
            let archiveFolder = this.app.vault.getAbstractFileByPath(archiveFolderPath);
            if (!archiveFolder) {
                try {
                    await this.app.vault.createFolder(archiveFolderPath);
                } catch (e) {
                    console.warn(`[AppleHealthIngest] Could not create archive folder ${archiveFolderPath}:`, e);
                }
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const targetPath = normalizePath(`${archiveFolderPath}/${file.basename}_${timestamp}.json`);

            await this.app.fileManager.renameFile(file, targetPath);
            console.log(`[AppleHealthIngest] 📦 Archived processed file to: ${targetPath}`);
        } catch (error) {
            console.error(`[AppleHealthIngest] Failed to archive file ${file.path}:`, error);
        }
    }

    private getTodayDateString(): string {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, "0");
        const day = String(today.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
}
