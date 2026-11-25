import { App, TFile, Notice } from "obsidian";
import { HealthPluginSettings } from "../models/HealthSettings";
import { GoogleHealthService } from "./GoogleHealthService";
import {
    ParsedWorkout,
    splitWorkoutEntries,
    normalizeExerciseType,
    isGenericWorkoutTitle,
    isExerciseOrWorkoutTitle,
    deduplicateWorkouts,
    parseSingleWorkoutEntry,
    serializeWorkouts,
    mergeWorkoutLists
} from "./WorkoutDeduplicator";

export type { ParsedWorkout };
export {
    splitWorkoutEntries,
    normalizeExerciseType,
    isGenericWorkoutTitle,
    isExerciseOrWorkoutTitle,
    deduplicateWorkouts,
    parseSingleWorkoutEntry,
    serializeWorkouts,
    mergeWorkoutLists
};

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

    public parseWorkoutString(workoutVal: any): ParsedWorkout[] {
        if (!workoutVal) return [];
        let parts: string[] = [];
        if (Array.isArray(workoutVal)) {
            parts = workoutVal.flatMap(v => splitWorkoutEntries(String(v)));
        } else if (typeof workoutVal === "string") {
            parts = splitWorkoutEntries(workoutVal);
        } else {
            parts = splitWorkoutEntries(String(workoutVal));
        }

        const results: ParsedWorkout[] = [];

        for (const p of parts) {
            const raw = p.trim();
            if (!raw) continue;

            // Pattern 1: Title (XXm / XX min / XX mins / XX minutes) -> e.g. "Walking (30m)", "Walking (30 mins)"
            let match = raw.match(/^(.+?)\s*\(\s*(\d+)\s*(?:m|min|mins|minutes)?\s*\)$/i);
            if (match) {
                results.push({
                    title: match[1].trim(),
                    durationMins: parseInt(match[2], 10)
                });
                continue;
            }

            // Pattern 2: Title XXm / XX min / XX mins -> e.g. "Walking 30m", "Gym 45 mins"
            match = raw.match(/^(.+?)\s+(\d+)\s*(?:m|min|mins|minutes)$/i);
            if (match) {
                results.push({
                    title: match[1].trim(),
                    durationMins: parseInt(match[2], 10)
                });
                continue;
            }

            // Pattern 3: XXm / XX min Title -> e.g. "30m Walking", "45 mins Gym"
            match = raw.match(/^(\d+)\s*(?:m|min|mins|minutes)\s+(.+)$/i);
            if (match) {
                results.push({
                    title: match[2].trim(),
                    durationMins: parseInt(match[1], 10)
                });
                continue;
            }

            // Fallback: title without duration
            results.push({
                title: raw,
                durationMins: 0
            });
        }
        return results;
    }

    public serializeWorkouts(workouts: ParsedWorkout[]): string {
        return workouts
            .filter(w => w.title)
            .map(w => w.durationMins > 0 ? `${w.title} (${w.durationMins}m)` : w.title)
            .join(", ");
    }

    public async extractTimestampsFromNote(file: TFile): Promise<Map<string, Array<{ start: string; end: string }>>> {
        const timeMap = new Map<string, Array<{ start: string; end: string }>>();
        try {
            const content = await this.app.vault.read(file);
            const focusMatches = [...content.matchAll(/\[focus::\s*([^\]]+)\].*?\[start-time::\s*(\d{1,2}:\d{2}(?::\d{2})?)\].*?\[completed-time::\s*(\d{1,2}:\d{2}(?::\d{2})?)\]/gi)];

            const parseSecs = (str: string): number => {
                const parts = str.split(':').map(Number);
                return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
            };

            for (const m of focusMatches) {
                if (/cancelled/i.test(m[0])) continue;
                const title = m[1].trim().toLowerCase();
                const startStr = m[2];
                const endStr = m[3];
                const startSecs = parseSecs(startStr);
                const endSecs = parseSecs(endStr);
                if (endSecs <= startSecs) continue;

                const existingList = timeMap.get(title) || [];
                const last = existingList.length > 0 ? existingList[existingList.length - 1] : null;

                // Consolidate immediately adjacent/overlapping segments of the same title (e.g. within 2 mins)
                if (last) {
                    const lastEndSecs = parseSecs(last.end);
                    if (startSecs <= lastEndSecs + 120) {
                        last.end = endStr;
                        continue;
                    }
                }

                existingList.push({ start: startStr, end: endStr });
                timeMap.set(title, existingList);
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
        const currentWorkoutVal = cache?.frontmatter?.workout;
        const rawLocalWorkouts = this.parseWorkoutString(currentWorkoutVal).filter(w => isExerciseOrWorkoutTitle(w.title));

        // Fetch cloud workouts from Google Health
        const cloudSessions = await this.healthService.fetchExerciseSessionsForDate(dateStr);
        let cloudWorkouts: ParsedWorkout[] = deduplicateWorkouts(cloudSessions.map(cs => ({
            id: cs.id,
            title: cs.type,
            durationMins: cs.durationMins,
            startTime: new Date(cs.start).toISOString(),
            endTime: new Date(cs.end).toISOString()
        }))).filter(cw => isExerciseOrWorkoutTitle(cw.title));

        const noteTimestamps = await this.extractTimestampsFromNote(file);

        // Pre-populate timestamps on local workouts from note focus logs before deduplication
        // Match sequential instances of same-titled exercises to distinct sequential focus intervals
        // Also supports parenthetical qualifiers like (Track A), (Track B) matching bare focus titles
        const titleUsage = new Map<string, number>();
        for (const local of rawLocalWorkouts) {
            const rawKey = local.title.toLowerCase();
            const cleanKey = rawKey.replace(/\s*\([^)]*\)\s*$/, '').trim();
            const lookupKey = noteTimestamps.has(rawKey) ? rawKey : cleanKey;
            const tsList = noteTimestamps.get(lookupKey);
            if (tsList && tsList.length > 0) {
                const idx = titleUsage.get(lookupKey) || 0;
                if (idx < tsList.length) {
                    const ts = tsList[idx];
                    titleUsage.set(lookupKey, idx + 1);

                    const startStr = ts.start.length === 5 ? ts.start + ':00' : ts.start;
                    local.startTime = `${dateStr}T${startStr}`;
                    const startMs = new Date(local.startTime).getTime();
                    if (ts.end) {
                        const endStr = ts.end.length === 5 ? ts.end + ':00' : ts.end;
                        local.endTime = `${dateStr}T${endStr}`;
                    } else {
                        const effectiveDur = local.durationMins > 0 ? local.durationMins : 30;
                        local.endTime = new Date(startMs + (effectiveDur * 60 * 1000)).toISOString();
                    }
                }
            }
        }

        // Also check if noteTimestamps has additional focus sessions not yet in rawLocalWorkouts
        for (const [key, tsList] of noteTimestamps.entries()) {
            if (!isExerciseOrWorkoutTitle(key)) {
                continue;
            }
            const used = titleUsage.get(key) || 0;
            for (let i = used; i < tsList.length; i++) {
                const ts = tsList[i];
                const sParts = ts.start.split(':').map(Number);
                const eParts = ts.end.split(':').map(Number);
                const dur = Math.max(1, Math.round(((eParts[0] * 3600 + eParts[1] * 60 + (eParts[2] || 0)) - (sParts[0] * 3600 + sParts[1] * 60 + (sParts[2] || 0))) / 60));

                const title = key.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                const startStr = ts.start.length === 5 ? ts.start + ':00' : ts.start;
                const endStr = ts.end.length === 5 ? ts.end + ':00' : ts.end;
                rawLocalWorkouts.push({
                    title,
                    durationMins: dur,
                    startTime: `${dateStr}T${startStr}`,
                    endTime: `${dateStr}T${endStr}`
                });
            }
        }

        let localWorkouts = deduplicateWorkouts(rawLocalWorkouts);

        let pushedCount = 0;
        let pulledCount = 0;
        const merged: ParsedWorkout[] = [];

        // 1. Process local workouts against cloud sessions
        for (const local of localWorkouts) {
            const localType = normalizeExerciseType(local.title);

            const matchIdx = cloudWorkouts.findIndex(cw => {
                // a. Title substring match
                const titleMatch = cw.title.toLowerCase().includes(local.title.toLowerCase()) || local.title.toLowerCase().includes(cw.title.toLowerCase());
                const durMatch = Math.abs(cw.durationMins - local.durationMins) <= 5;

                // b. Generic / category match (e.g. cw is "Calisthenics", "Workout", "Other", "Other Workout")
                const cwIsGeneric = isGenericWorkoutTitle(cw.title);
                const cwType = normalizeExerciseType(cw.title);
                const isGeneralFallback = ["workout", "other workout", "other"].includes(cw.title.toLowerCase());
                const typeMatch = (cwIsGeneric && (isGeneralFallback || cwType === localType)) && durMatch;

                // c. Real-world timestamp overlap match
                let timeOverlap = false;
                let hasTimestamps = false;
                if (local.startTime && cw.startTime && local.endTime && cw.endTime) {
                    const lStart = new Date(local.startTime).getTime();
                    const lEnd = new Date(local.endTime).getTime();
                    const cStart = new Date(cw.startTime).getTime();
                    const cEnd = new Date(cw.endTime).getTime();
                    if (!isNaN(lStart) && !isNaN(lEnd) && !isNaN(cStart) && !isNaN(cEnd)) {
                        hasTimestamps = true;
                        timeOverlap = Math.max(lStart, cStart) < Math.min(lEnd, cEnd) || Math.abs(lStart - cStart) <= 5 * 60 * 1000;
                    }
                }

                if (hasTimestamps) {
                    return timeOverlap && ((titleMatch && durMatch) || typeMatch);
                }

                return (titleMatch && durMatch) || typeMatch;
            });

            if (matchIdx !== -1) {
                // Matched! Retain more specific title and maximum duration
                const matchedCloud = cloudWorkouts[matchIdx];
                const finalTitle = isGenericWorkoutTitle(matchedCloud.title)
                    ? local.title
                    : local.title;
                merged.push({
                    title: finalTitle,
                    durationMins: Math.max(local.durationMins, matchedCloud.durationMins),
                    startTime: local.startTime || matchedCloud.startTime,
                    endTime: local.endTime || matchedCloud.endTime
                });
                // Remove matched cloud session so it is not processed or pulled again
                cloudWorkouts.splice(matchIdx, 1);
            } else {
                // Local workout missing in Google Health!
                const effectiveDuration = local.durationMins > 0 ? local.durationMins : 30;
                merged.push({
                    title: local.title,
                    durationMins: effectiveDuration,
                    startTime: local.startTime,
                    endTime: local.endTime
                });

                if (pushToCloud) {
                    let startIso = local.startTime;
                    let endIso = local.endTime;

                    if (!startIso || !endIso) {
                        // Default to 12:00 PM on dateStr
                        startIso = `${dateStr}T12:00:00`;
                        const endMs = new Date(startIso).getTime() + (effectiveDuration * 60 * 1000);
                        endIso = new Date(endMs).toISOString();
                    }

                    const ok = await this.healthService.postExerciseSession(local.title, startIso, endIso);
                    if (ok) {
                        pushedCount++;
                    } else if (this.healthService.lastApiError) {
                        console.warn(`[WorkoutSyncService] Failed to upload workout ${local.title}:`, this.healthService.lastApiError);
                    }
                }
            }
        }

        // 2. Any remaining cloud workouts were not in local frontmatter -> pull them in
        for (const remainingCloud of cloudWorkouts) {
            const rawCloudTitle = (remainingCloud.title || "").toLowerCase().trim();
            const isBareGeneric = ["workout", "other workout", "other"].includes(rawCloudTitle);

            // Check if this cloud workout coincides with a non-exercise focus block in the note (e.g. Wake-up or Freshen Up)
            let isSpuriousNonExercise = isBareGeneric;
            if (!isSpuriousNonExercise && remainingCloud.startTime) {
                const cStart = new Date(remainingCloud.startTime).getTime();
                for (const [key, tsList] of noteTimestamps.entries()) {
                    if (isExerciseOrWorkoutTitle(key)) continue;
                    for (const ts of tsList) {
                        const nStart = new Date(`${dateStr}T${ts.start.length === 5 ? ts.start + ':00' : ts.start}`).getTime();
                        if (Math.abs(cStart - nStart) <= 5 * 60 * 1000) {
                            isSpuriousNonExercise = true;
                            break;
                        }
                    }
                    if (isSpuriousNonExercise) break;
                }
            }

            if (isSpuriousNonExercise) {
                if (remainingCloud.id && typeof this.healthService?.deleteHealthDataPoint === "function") {
                    console.log(`[Health Connect] Deleting spurious cloud workout from Google Health: ${remainingCloud.title} (${remainingCloud.durationMins}m)`, remainingCloud.id);
                    await this.healthService.deleteHealthDataPoint("exercise", remainingCloud.id);
                }
                continue;
            }

            merged.push(remainingCloud);
            pulledCount++;
        }

        const finalMerged = deduplicateWorkouts(merged);
        const serialized = this.serializeWorkouts(finalMerged);
        const totalDurationMinutes = finalMerged.reduce((sum, w) => sum + (w.durationMins || 0), 0);

        // Reconcile mindfulness minutes locally (or bidirectionally only if explicitly enabled)
        const mindResult = await this.reconcileMindfulness(file, {
            pushToCloud: Boolean(this.settings.enableBidirectionalMindfulness) && (options?.pushToCloud ?? true)
        });

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
            if (pushedCount > 0 || pulledCount > 0 || mindResult.pushed) {
                new Notice(`[Health Connect] Reconciled for ${dateStr}: ${pushedCount} workout(s) uploaded, ${pulledCount} pulled${mindMsg} 🏋️`);
            } else if (this.healthService.lastApiError) {
                new Notice(`[Health Connect] Sync notice: ${this.healthService.lastApiError}`, 9000);
            } else {
                new Notice(`[Health Connect] Workouts & mindfulness in sync for ${dateStr} 🏋️`);
            }
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
        const medTsList = noteTimestamps.get("meditation") || noteTimestamps.get("mindfulness");
        const medTs = medTsList && medTsList.length > 0 ? medTsList[0] : undefined;

        if (localMinutes === 0 && medTs) {
            const s = new Date(`1970-01-01T${medTs.start.length === 5 ? medTs.start + ':00' : medTs.start}`).getTime();
            const e = new Date(`1970-01-01T${medTs.end.length === 5 ? medTs.end + ':00' : medTs.end}`).getTime();
            if (!isNaN(s) && !isNaN(e) && e > s) {
                localMinutes = Math.round((e - s) / 60000);
            }
        }

        let pushed = false;
        if (pushToCloud && typeof this.healthService?.fetchMindfulnessSessionsForDate === "function" && typeof this.healthService?.postMindfulnessSession === "function") {
            const cloudSessions = await this.healthService.fetchMindfulnessSessionsForDate(dateStr);
            const cloudTotalMins = cloudSessions.reduce((sum, s) => sum + s.durationMins, 0);

            if (localMinutes > 0 && cloudTotalMins === 0) {
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

                pushed = await this.healthService.postMindfulnessSession(startIso, endIso, "Meditation");
            } else if (cloudTotalMins > 0 && localMinutes === 0) {
                localMinutes = cloudTotalMins;
                await this.app.fileManager.processFrontMatter(file, (fm) => {
                    fm.mindfulness_minutes = String(cloudTotalMins);
                });
            }
        }

        return { pushed, minutes: localMinutes };
    }
}
