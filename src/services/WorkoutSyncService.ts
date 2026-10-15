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

/**
 * Splits a comma-separated workout string into individual entries,
 * while safely respecting nested parentheses so titles containing commas
 * (e.g. "Exercises: Phase 2 (Workout B — Glutes, Calves & Vertical Pull Anchor) (11m)")
 * are not incorrectly fragmented.
 */
export function splitWorkoutEntries(str: string): string[] {
    if (!str) return [];
    const entries: string[] = [];
    let current = "";
    let parenDepth = 0;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '(') {
            parenDepth++;
            current += char;
        } else if (char === ')') {
            if (parenDepth > 0) parenDepth--;
            current += char;
        } else if (char === ',' && parenDepth === 0) {
            if (current.trim()) {
                entries.push(current.trim());
            }
            current = "";
        } else {
            current += char;
        }
    }

    if (current.trim()) {
        entries.push(current.trim());
    }

    return entries;
}

/**
 * Normalizes an exercise title into its canonical activity type (e.g. "Calisthenics", "Walking").
 */
export function normalizeExerciseType(title: string): string {
    const lower = (title || "").toLowerCase();
    if (lower.includes("walk")) return "Walking";
    if (lower.includes("run")) return "Running";
    if (lower.includes("bik") || lower.includes("cycl")) return "Biking";
    if (lower.includes("yoga")) return "Yoga";
    if (lower.includes("stretch")) return "Stretching";
    if (lower.includes("weight") || lower.includes("strength") || lower.includes("gym")) return "Strength Training";
    if (lower.includes("calisthenic") || lower.includes("exercise") || lower.includes("mobility") || lower.includes("postur")) return "Calisthenics";
    if (lower.includes("swim")) return "Swimming";
    if (lower.includes("pilates")) return "Pilates";
    if (lower.includes("aerobic") || lower.includes("cardio")) return "Aerobic Workout";
    return "Other";
}

/**
 * Returns true if an activity title represents a generic or fallback category.
 */
export function isGenericWorkoutTitle(title: string): boolean {
    const lower = (title || "").toLowerCase().trim();
    return ["workout", "other workout", "other", "calisthenics", "exercise", "aerobic workout"].includes(lower);
}

/**
 * Deduplicates workout sessions:
 * 1. Merges exact duplicate entries (same title and duration).
 * 2. Merges sessions that have overlapping real-world timestamps or start within 5 minutes of each other,
 *    retaining the more specific title, maximum duration, and combined interval.
 * 3. Collapses same-title sessions with fuzzy duration differences (<= 3 mins, e.g. "Walking (13m)"
 *    vs "Walking (12m)" from dual trackers), provided they do not have distinct distant timestamps (>15m apart).
 * 4. Prunes redundant generic entries (e.g. "Calisthenics (11m)") when a more specific
 *    named exercise session (e.g. "Exercises: Phase 1 (11m)") of matching duration or overlapping time is present.
 */
export function deduplicateWorkouts(workouts: ParsedWorkout[]): ParsedWorkout[] {
    if (!workouts || workouts.length <= 1) return workouts || [];

    const result: ParsedWorkout[] = [];

    for (const w of workouts) {
        if (!w.title || !w.title.trim()) continue;
        const wTitleLower = w.title.toLowerCase().trim();
        const wType = normalizeExerciseType(w.title);
        const wIsGeneric = isGenericWorkoutTitle(w.title);

        let merged = false;

        for (let i = 0; i < result.length; i++) {
            const r = result[i];
            const rTitleLower = r.title.toLowerCase().trim();
            const rType = normalizeExerciseType(r.title);
            const rIsGeneric = isGenericWorkoutTitle(r.title);

            // Determine timestamp relationship if timestamps are present on both
            let timeOverlap = false;
            let distinctTimes = false;
            if (r.startTime && w.startTime) {
                const rStart = new Date(r.startTime).getTime();
                const wStart = new Date(w.startTime).getTime();
                if (!isNaN(rStart) && !isNaN(wStart)) {
                    const startDiff = Math.abs(rStart - wStart);
                    if (startDiff <= 5 * 60 * 1000) {
                        timeOverlap = true;
                    } else if (r.endTime && w.endTime) {
                        const rEnd = new Date(r.endTime).getTime();
                        const wEnd = new Date(w.endTime).getTime();
                        if (!isNaN(rEnd) && !isNaN(wEnd)) {
                            if (Math.max(rStart, wStart) < Math.min(rEnd, wEnd)) {
                                timeOverlap = true;
                            }
                        }
                    }
                    if (startDiff > 15 * 60 * 1000) {
                        distinctTimes = true;
                    }
                }
            }

            // 1. Exact title & duration match (only merge if timestamps are absent or not distinct times of day)
            if (rTitleLower === wTitleLower && r.durationMins === w.durationMins && !distinctTimes) {
                if (!r.startTime && w.startTime) r.startTime = w.startTime;
                if (!r.endTime && w.endTime) r.endTime = w.endTime;
                merged = true;
                break;
            }

            if (timeOverlap) {
                if (rTitleLower === wTitleLower || rType === wType || rIsGeneric || wIsGeneric) {
                    if (rIsGeneric && !wIsGeneric) {
                        r.title = w.title;
                    }
                    r.durationMins = Math.max(r.durationMins, w.durationMins);
                    if (r.startTime && w.startTime) {
                        r.startTime = new Date(Math.min(new Date(r.startTime).getTime(), new Date(w.startTime).getTime())).toISOString();
                    }
                    if (r.endTime && w.endTime) {
                        r.endTime = new Date(Math.max(new Date(r.endTime).getTime(), new Date(w.endTime).getTime())).toISOString();
                    }
                    merged = true;
                    break;
                }
            }

            // 3. Fuzzy duration match for identical titles (e.g. Walking (13m) and Walking (12m))
            // Only collapse if timestamps are absent or not confirmed distinct (>15m apart)
            if (rTitleLower === wTitleLower && !distinctTimes) {
                const durDiff = Math.abs(r.durationMins - w.durationMins);
                if (durDiff <= 3 || r.durationMins === 0 || w.durationMins === 0) {
                    r.durationMins = Math.max(r.durationMins, w.durationMins);
                    if (!r.startTime && w.startTime) r.startTime = w.startTime;
                    if (!r.endTime && w.endTime) r.endTime = w.endTime;
                    merged = true;
                    break;
                }
            }

            // 4. Generic vs Specific replacement or suppression
            // Case A: w is generic and r is specific with matching exercise type and close duration (±5m)
            if (wIsGeneric && !rIsGeneric && !distinctTimes) {
                const durClose = Math.abs(r.durationMins - w.durationMins) <= 5;
                const isGeneralFallback = ["workout", "other workout", "other"].includes(wTitleLower);
                if ((isGeneralFallback || rType === wType) && durClose) {
                    r.durationMins = Math.max(r.durationMins, w.durationMins);
                    merged = true;
                    break;
                }
            }

            // Case B: r is generic and w is specific with matching exercise type and close duration (±5m)
            if (rIsGeneric && !wIsGeneric && !distinctTimes) {
                const durClose = Math.abs(r.durationMins - w.durationMins) <= 5;
                const isGeneralFallback = ["workout", "other workout", "other"].includes(rTitleLower);
                if ((isGeneralFallback || rType === wType) && durClose) {
                    r.title = w.title;
                    r.durationMins = Math.max(r.durationMins, w.durationMins);
                    if (w.startTime) r.startTime = w.startTime;
                    if (w.endTime) r.endTime = w.endTime;
                    merged = true;
                    break;
                }
            }
        }

        if (!merged) {
            result.push({ ...w });
        }
    }

    return result;
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

    public async extractTimestampsFromNote(file: TFile): Promise<Map<string, { start: string; end: string }>> {
        const timeMap = new Map<string, { start: string; end: string }>();
        try {
            const content = await this.app.vault.read(file);
            const focusMatches = [...content.matchAll(/\[focus::\s*([^\]]+)\].*?\[start-time::\s*(\d{1,2}:\d{2}(?::\d{2})?)\].*?\[completed-time::\s*(\d{1,2}:\d{2}(?::\d{2})?)\]/gi)];
            for (const m of focusMatches) {
                if (/cancelled/i.test(m[0])) continue;
                const title = m[1].trim().toLowerCase();
                if (!timeMap.has(title)) {
                    timeMap.set(title, { start: m[2], end: m[3] });
                } else {
                    const prev = timeMap.get(title)!;
                    timeMap.set(title, { start: prev.start, end: m[3] });
                }
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
        let localWorkouts = deduplicateWorkouts(this.parseWorkoutString(currentWorkoutVal));

        // Fetch cloud workouts from Google Health
        const cloudSessions = await this.healthService.fetchExerciseSessionsForDate(dateStr);
        let cloudWorkouts: ParsedWorkout[] = deduplicateWorkouts(cloudSessions.map(cs => ({
            title: cs.type,
            durationMins: cs.durationMins,
            startTime: new Date(cs.start).toISOString(),
            endTime: new Date(cs.end).toISOString()
        })));

        const noteTimestamps = await this.extractTimestampsFromNote(file);

        // Pre-populate timestamps on local workouts if found in note focus logs
        for (const local of localWorkouts) {
            const ts = noteTimestamps.get(local.title.toLowerCase());
            if (ts) {
                const startStr = ts.start.length === 5 ? ts.start + ':00' : ts.start;
                local.startTime = `${dateStr}T${startStr}`;
                const startMs = new Date(local.startTime).getTime();
                const effectiveDur = local.durationMins > 0 ? local.durationMins : 30;
                local.endTime = new Date(startMs + (effectiveDur * 60 * 1000)).toISOString();
            }
        }

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
                if (local.startTime && cw.startTime && local.endTime && cw.endTime) {
                    const lStart = new Date(local.startTime).getTime();
                    const lEnd = new Date(local.endTime).getTime();
                    const cStart = new Date(cw.startTime).getTime();
                    const cEnd = new Date(cw.endTime).getTime();
                    if (!isNaN(lStart) && !isNaN(lEnd) && !isNaN(cStart) && !isNaN(cEnd)) {
                        timeOverlap = Math.max(lStart, cStart) < Math.min(lEnd, cEnd);
                    }
                }

                return (titleMatch && durMatch) || typeMatch || (timeOverlap && (titleMatch || typeMatch || cwIsGeneric));
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
            merged.push(remainingCloud);
            pulledCount++;
        }

        const finalMerged = deduplicateWorkouts(merged);
        const serialized = this.serializeWorkouts(finalMerged);
        const totalDurationMinutes = finalMerged.reduce((sum, w) => sum + (w.durationMins || 0), 0);

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
            if (pushedCount > 0 || pulledCount > 0) {
                new Notice(`[Health Connect] Reconciled for ${dateStr}: ${pushedCount} workout(s) uploaded, ${pulledCount} pulled 🏋️`);
            } else if (this.healthService.lastApiError) {
                new Notice(`[Health Connect] Workout sync notice: ${this.healthService.lastApiError}`, 9000);
            } else {
                new Notice(`[Health Connect] Workouts already in sync with Google Health for ${dateStr} 🏋️`);
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
            pushedMindfulness: false
        };
    }

    public async reconcileMindfulness(
        file: TFile,
        options?: { pushToCloud?: boolean }
    ): Promise<{ pushed: boolean; minutes: number }> {
        const cache = this.app.metadataCache.getFileCache(file);
        const fmVal = cache?.frontmatter?.mindfulness_minutes || cache?.frontmatter?.meditation || cache?.frontmatter?.mindfulness;
        let localMinutes = parseInt(String(fmVal || 0), 10);
        if (isNaN(localMinutes)) localMinutes = 0;

        if (localMinutes === 0) {
            const noteTimestamps = await this.extractTimestampsFromNote(file);
            const medTs = noteTimestamps.get("meditation") || noteTimestamps.get("mindfulness");
            if (medTs) {
                const s = new Date(`1970-01-01T${medTs.start.length === 5 ? medTs.start + ':00' : medTs.start}`).getTime();
                const e = new Date(`1970-01-01T${medTs.end.length === 5 ? medTs.end + ':00' : medTs.end}`).getTime();
                if (!isNaN(s) && !isNaN(e) && e > s) {
                    localMinutes = Math.round((e - s) / 60000);
                }
            }
        }

        return { pushed: false, minutes: localMinutes };
    }
}
