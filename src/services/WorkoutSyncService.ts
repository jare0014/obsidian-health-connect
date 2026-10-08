import { App, TFile, Notice } from "obsidian";
import { HealthPluginSettings } from "../models/HealthSettings";
import { GoogleHealthService } from "./GoogleHealthService";

export interface ParsedWorkout {
    title: string;
    durationMins: number;
    startTime?: string;
    endTime?: string;
}

export interface WorkoutReconciliationResult {
    dateStr: string;
    mergedWorkouts: string;
    durationMinutes: number;
    activeMinutes?: number;
    pushedCount: number;
    pulledCount: number;
    mindfulnessMinutes?: number;
    pushedMindfulness?: boolean;
}

export class WorkoutSyncService {
    constructor(
        private app: App,
        private settings: HealthPluginSettings,
        private healthService: GoogleHealthService
    ) {}

    public parseWorkoutString(workoutStr: string): ParsedWorkout[] {
        if (!workoutStr || typeof workoutStr !== "string") return [];
        const parts = workoutStr.split(',').map(s => s.trim()).filter(Boolean);
        const results: ParsedWorkout[] = [];

        for (const p of parts) {
            const durMatch = p.match(/(.+?)\s*\((\d+)\s*m\)/i);
            if (durMatch) {
                results.push({
                    title: durMatch[1].trim(),
                    durationMins: parseInt(durMatch[2], 10)
                });
            } else {
                results.push({
                    title: p.trim(),
                    durationMins: 0
                });
            }
        }
        return results;
    }

    public serializeWorkouts(workouts: ParsedWorkout[]): string {
        return workouts
            .filter(w => w.title)
            .map(w => w.durationMins > 0 ? `${w.title} (${w.durationMins}m)` : w.title)
            .join(", ");
    }

    public async extractTimestampsFromNote(file: TFile): Promise<Map<string, { start: string; end: string }>> {
        const timeMap = new Map<string, { start: string; end: string }>();
        try {
            const content = await this.app.vault.read(file);
            const focusMatches = [...content.matchAll(/\[focus::\s*([^\]]+)\].*?\[start-time::\s*(\d{1,2}:\d{2}(?::\d{2})?)\].*?\[completed-time::\s*(\d{1,2}:\d{2}(?::\d{2})?)\]/gi)];
            for (const m of focusMatches) {
                const title = m[1].trim().toLowerCase();
                timeMap.set(title, { start: m[2], end: m[3] });
            }
        } catch (e) {
            console.warn("[WorkoutSyncService] Could not parse timestamps from note:", e);
        }
        return timeMap;
    }

    public async reconcileWorkouts(file: TFile, options?: { pushToCloud?: boolean; showNotice?: boolean }): Promise<WorkoutReconciliationResult> {
        const dateStr = file.basename;
        const pushToCloud = options?.pushToCloud ?? this.settings.enableBidirectionalWorkouts ?? true;
        const showNotice = options?.showNotice ?? false;

        const cache = this.app.metadataCache.getFileCache(file);
        const currentWorkoutStr = String(cache?.frontmatter?.workout || "").trim();
        const localWorkouts = this.parseWorkoutString(currentWorkoutStr);

        // Fetch cloud workouts from Google Health
        const cloudSessions = await this.healthService.fetchExerciseSessionsForDate(dateStr);
        const cloudWorkouts: ParsedWorkout[] = cloudSessions.map(cs => ({
            title: cs.type,
            durationMins: cs.durationMins,
            startTime: new Date(cs.start).toISOString(),
            endTime: new Date(cs.end).toISOString()
        }));

        const noteTimestamps = await this.extractTimestampsFromNote(file);

        let pushedCount = 0;
        let pulledCount = 0;
        const merged: ParsedWorkout[] = [];

        // 1. Process local workouts against cloud sessions
        for (const local of localWorkouts) {
            const matchIdx = cloudWorkouts.findIndex(cw => {
                const titleMatch = cw.title.toLowerCase().includes(local.title.toLowerCase()) || local.title.toLowerCase().includes(cw.title.toLowerCase());
                const durMatch = Math.abs(cw.durationMins - local.durationMins) <= 5;
                const genericMatch = (cw.title.toLowerCase() === "workout" || cw.title.toLowerCase() === "other workout") && durMatch;
                return (titleMatch && durMatch) || genericMatch;
            });

            if (matchIdx !== -1) {
                // Matched! Retain more specific title and maximum duration
                const matchedCloud = cloudWorkouts[matchIdx];
                const finalTitle = (matchedCloud.title.toLowerCase() === "workout" || matchedCloud.title.toLowerCase() === "other workout")
                    ? local.title
                    : local.title;
                merged.push({
                    title: finalTitle,
                    durationMins: Math.max(local.durationMins, matchedCloud.durationMins)
                });
                // Remove matched so it is not processed again
                cloudWorkouts.splice(matchIdx, 1);
            } else {
                // Local workout missing in Google Health!
                merged.push(local);
                if (pushToCloud && local.durationMins > 0) {
                    let startIso: string;
                    let endIso: string;

                    const ts = noteTimestamps.get(local.title.toLowerCase());
                    if (ts) {
                        startIso = `${dateStr}T${ts.start.length === 5 ? ts.start + ':00' : ts.start}`;
                        endIso = `${dateStr}T${ts.end.length === 5 ? ts.end + ':00' : ts.end}`;
                    } else {
                        // Default to 12:00 PM on dateStr
                        startIso = `${dateStr}T12:00:00`;
                        const endMs = new Date(startIso).getTime() + (local.durationMins * 60 * 1000);
                        endIso = new Date(endMs).toISOString();
                    }

                    const ok = await this.healthService.postExerciseSession(local.title, startIso, endIso);
                    if (ok) pushedCount++;
                }
            }
        }

        // 2. Any remaining cloud workouts were not in local frontmatter -> pull them in
        for (const remainingCloud of cloudWorkouts) {
            merged.push(remainingCloud);
            pulledCount++;
        }

        const serialized = this.serializeWorkouts(merged);
        const totalDurationMinutes = merged.reduce((sum, w) => sum + (w.durationMins || 0), 0);

        // Reconcile mindfulness minutes bidirectionally if enabled
        const mindResult = await this.reconcileMindfulness(file, options);

        // Update daily note frontmatter (workout session list and mindfulness minutes)
        // NOTE: active_minutes is NOT updated here because it represents biometric HR threshold activity synced from Google Health API.
        await this.app.fileManager.processFrontMatter(file, (fm) => {
            if (serialized) {
                fm.workout = serialized;
            }
            if (mindResult.minutes > 0) {
                fm.mindfulness_minutes = String(mindResult.minutes);
            }
        });

        if (showNotice) {
            const mindMsg = mindResult.pushed ? ", mindfulness session uploaded 🧘" : "";
            new Notice(`[Health Connect] Reconciled for ${dateStr}: ${pushedCount} workout(s) uploaded, ${pulledCount} pulled${mindMsg} 🏋️`);
        }

        return {
            dateStr,
            mergedWorkouts: serialized,
            durationMinutes: totalDurationMinutes,
            activeMinutes: totalDurationMinutes,
            pushedCount,
            pulledCount,
            mindfulnessMinutes: mindResult.minutes,
            pushedMindfulness: mindResult.pushed
        };
    }

    public async reconcileMindfulness(
        file: TFile,
        options?: { pushToCloud?: boolean }
    ): Promise<{ pushed: boolean; minutes: number }> {
        const dateStr = file.basename;
        const pushToCloud = options?.pushToCloud ?? this.settings.enableBidirectionalMindfulness ?? true;

        const cache = this.app.metadataCache.getFileCache(file);
        const fmVal = cache?.frontmatter?.mindfulness_minutes || cache?.frontmatter?.meditation || cache?.frontmatter?.mindfulness;
        let localMinutes = parseInt(String(fmVal || 0), 10);
        if (isNaN(localMinutes)) localMinutes = 0;

        const noteTimestamps = await this.extractTimestampsFromNote(file);
        const medTs = noteTimestamps.get("meditation") || noteTimestamps.get("mindfulness");

        // Fetch cloud mindfulness sessions
        const cloudSessions = await this.healthService.fetchMindfulnessSessionsForDate(dateStr);
        const cloudTotalMins = cloudSessions.reduce((sum, s) => sum + s.durationMins, 0);

        let pushed = false;
        if (localMinutes > 0 && cloudTotalMins === 0 && pushToCloud) {
            let startIso: string;
            let endIso: string;
            if (medTs) {
                startIso = `${dateStr}T${medTs.start.length === 5 ? medTs.start + ':00' : medTs.start}`;
                endIso = `${dateStr}T${medTs.end.length === 5 ? medTs.end + ':00' : medTs.end}`;
            } else {
                startIso = `${dateStr}T08:00:00`;
                const endMs = new Date(startIso).getTime() + (localMinutes * 60 * 1000);
                endIso = new Date(endMs).toISOString();
            }

            pushed = await this.healthService.postMindfulnessSession(startIso, endIso);
        } else if (cloudTotalMins > 0 && localMinutes === 0) {
            localMinutes = cloudTotalMins;
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                fm.mindfulness_minutes = String(cloudTotalMins);
            });
        }

        return { pushed, minutes: localMinutes };
    }
}
