export interface ParsedWorkout {
    title: string;
    durationMins: number;
    startTime?: string;
    endTime?: string;
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
 * Parses a single workout entry string (e.g. "Walking (13m)") into a ParsedWorkout object.
 */
export function parseSingleWorkoutEntry(raw: string): ParsedWorkout {
    const trimmed = (raw || "").trim();
    if (!trimmed) return { title: "", durationMins: 0 };

    let match = trimmed.match(/^(.+?)\s*\(\s*(\d+)\s*(?:m|min|mins|minutes)?\s*\)$/i);
    if (match) {
        return {
            title: match[1].trim(),
            durationMins: parseInt(match[2], 10)
        };
    }

    match = trimmed.match(/^(.+?)\s+(\d+)\s*(?:m|min|mins|minutes)$/i);
    if (match) {
        return {
            title: match[1].trim(),
            durationMins: parseInt(match[2], 10)
        };
    }

    match = trimmed.match(/^(\d+)\s*(?:m|min|mins|minutes)\s+(.+)$/i);
    if (match) {
        return {
            title: match[2].trim(),
            durationMins: parseInt(match[1], 10)
        };
    }

    return {
        title: trimmed,
        durationMins: 0
    };
}

/**
 * Serializes an array of ParsedWorkout objects into a clean comma-separated frontmatter string.
 */
export function serializeWorkouts(workouts: ParsedWorkout[]): string {
    return workouts
        .filter(w => w.title)
        .map(w => w.durationMins > 0 ? `${w.title} (${w.durationMins}m)` : w.title)
        .join(", ");
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
