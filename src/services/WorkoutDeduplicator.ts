export interface ParsedWorkout {
    title: string;
    durationMins: number;
    startTime?: string;
    endTime?: string;
    id?: string;
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
    if (lower.includes("weight") || lower.includes("strength") || lower.includes("gym") || lower.includes("phase 2") || lower.includes("phase 3")) return "Strength Training";
    if (lower.includes("phase 1") || lower.includes("calisthenic") || lower.includes("exercise") || lower.includes("mobility") || lower.includes("postur")) return "Calisthenics";
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
    return [
        "workout",
        "other workout",
        "other",
        "calisthenics",
        "exercise",
        "exercises",
        "strength training",
        "strength",
        "weight training",
        "weights",
        "gym",
        "gym session",
        "aerobic workout",
        "aerobics",
        "stretching",
        "flexibility"
    ].includes(lower);
}

const EXERCISE_KEYWORD_REGEX = /(?:exercise|workout|gym|weights?|strength|calisthenic|walk(?:ing)?|run(?:ning)?|cardio|training|stretch(?:ing)?|yoga|fitness|mobility|postur|bik(?:e|ing)|cycl(?:e|ing)|swim(?:ming)?|pilates|aerobic|phase\s*[123])/i;

/**
 * Returns true if an activity title corresponds to a physical workout or exercise session
 * rather than general daily habits or tasks (e.g. "Wake-up", "Freshen Up", "House Chores").
 */
export function isExerciseOrWorkoutTitle(title: string): boolean {
    if (!title) return false;
    const clean = title.replace(/\[\[.*?\]\]/g, '').trim();
    if (!clean) return false;
    const lower = clean.toLowerCase();
    if ([
        "workout",
        "other workout",
        "calisthenics",
        "exercise",
        "exercises",
        "strength training",
        "strength",
        "weight training",
        "weights",
        "gym",
        "gym session",
        "aerobic workout",
        "aerobics",
        "stretching",
        "flexibility"
    ].includes(lower)) {
        return true;
    }
    return EXERCISE_KEYWORD_REGEX.test(clean);
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
                    let hasOverlap = false;
                    if (r.endTime && w.endTime) {
                        const rEnd = new Date(r.endTime).getTime();
                        const wEnd = new Date(w.endTime).getTime();
                        if (!isNaN(rEnd) && !isNaN(wEnd)) {
                            if (Math.max(rStart, wStart) < Math.min(rEnd, wEnd)) {
                                hasOverlap = true;
                            } else if (Math.min(rEnd, wEnd) <= Math.max(rStart, wStart)) {
                                distinctTimes = true;
                            }
                        }
                    } else if (startDiff <= 5 * 60 * 1000) {
                        hasOverlap = true;
                    }
                    timeOverlap = hasOverlap;
                    if (startDiff > 15 * 60 * 1000 || (!hasOverlap && startDiff >= 8 * 60 * 1000)) {
                        distinctTimes = true;
                    }
                }
            }

            // 1. Exact title & duration match (only merge if timestamps are absent or not distinct times of day)
            if (rTitleLower === wTitleLower && r.durationMins === w.durationMins && !distinctTimes) {
                const isSpecific = !rIsGeneric && !wIsGeneric;
                const isAdjacent = i === result.length - 1;
                if (!isSpecific || isAdjacent) {
                    if (!r.startTime && w.startTime) r.startTime = w.startTime;
                    if (!r.endTime && w.endTime) r.endTime = w.endTime;
                    if (!r.id && w.id) r.id = w.id;
                    merged = true;
                    break;
                }
            }

            if (timeOverlap) {
                const isFallback = (t: string) => ["workout", "other workout", "other"].includes(t);
                const matchesType = rType === wType || isFallback(rTitleLower) || isFallback(wTitleLower);
                if (rTitleLower === wTitleLower || (matchesType && (rIsGeneric || wIsGeneric))) {
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
                    if (!r.id && w.id) r.id = w.id;
                    merged = true;
                    break;
                }
            }

            // 3. Fuzzy duration match for identical titles (e.g. Walking (13m) and Walking (12m))
            // Only collapse if timestamps are absent or not confirmed distinct (>15m apart).
            // When timestamps are absent, only collapse generic/wearable activities (or when duration is 0).
            // Distinct specific exercise sessions with different durations (e.g. Phase 2 (12m) vs Phase 2 (10m))
            // represent distinct sessions and must NEVER be collapsed when timestamps are absent.
            if (rTitleLower === wTitleLower && !distinctTimes) {
                const durDiff = Math.abs(r.durationMins - w.durationMins);
                const isGenericOrZero = rIsGeneric || wIsGeneric || r.durationMins === 0 || w.durationMins === 0 || ["walking", "running", "biking", "cycling", "swimming"].includes(rTitleLower);
                if ((isGenericOrZero && durDiff <= 3) || r.durationMins === 0 || w.durationMins === 0) {
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
                const isGeneralFallback = ["workout", "other workout", "other", "calisthenics", "strength training"].includes(wTitleLower);
                if ((isGeneralFallback || rType === wType) && durClose) {
                    r.durationMins = Math.max(r.durationMins, w.durationMins);
                    merged = true;
                    break;
                }
            }

            // Case B: r is generic and w is specific with matching exercise type and close duration (±5m)
            if (rIsGeneric && !wIsGeneric && !distinctTimes) {
                const durClose = Math.abs(r.durationMins - w.durationMins) <= 5;
                const isGeneralFallback = ["workout", "other workout", "other", "calisthenics", "strength training"].includes(rTitleLower);
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

/**
 * Merges an incoming list of parsed workouts into an existing list of parsed workouts.
 * Unlike flat array concatenation followed by deduplication (which assumes duplicate entries across the whole list),
 * mergeWorkoutLists preserves the integrity of multi-session sequences already established in localList,
 * matching incoming entries against local entries and only upgrading generic entries or appending missing sessions.
 */
export function mergeWorkoutLists(localList: ParsedWorkout[], incomingList: ParsedWorkout[]): ParsedWorkout[] {
    if (!localList || localList.length === 0) return incomingList ? [...incomingList] : [];
    if (!incomingList || incomingList.length === 0) return localList ? [...localList] : [];

    const result = localList.map(w => ({ ...w }));
    const matchedIndices = new Set<number>();

    for (const inc of incomingList) {
        if (!inc.title || !inc.title.trim()) continue;
        const incLower = inc.title.toLowerCase().trim();
        const incIsGeneric = isGenericWorkoutTitle(inc.title);
        const incType = normalizeExerciseType(inc.title);

        let matchIdx = -1;
        for (let i = 0; i < result.length; i++) {
            if (matchedIndices.has(i)) continue;
            const r = result[i];
            const rLower = r.title.toLowerCase().trim();
            const rIsGeneric = isGenericWorkoutTitle(r.title);
            const rType = normalizeExerciseType(r.title);

            // Exact title & close duration (or zero duration)
            if (rLower === incLower) {
                if (Math.abs(r.durationMins - inc.durationMins) <= 3 || r.durationMins === 0 || inc.durationMins === 0) {
                    matchIdx = i;
                    break;
                }
            }

            // Generic incoming matching specific local
            if (incIsGeneric && !rIsGeneric && Math.abs(r.durationMins - inc.durationMins) <= 5) {
                if (rType === incType || ["workout", "other workout", "other", "calisthenics", "strength training"].includes(incLower)) {
                    matchIdx = i;
                    break;
                }
            }

            // Generic local matching specific incoming
            if (rIsGeneric && !incIsGeneric && Math.abs(r.durationMins - inc.durationMins) <= 5) {
                if (rType === incType || ["workout", "other workout", "other", "calisthenics", "strength training"].includes(rLower)) {
                    matchIdx = i;
                    break;
                }
            }
        }

        if (matchIdx !== -1) {
            matchedIndices.add(matchIdx);
            const matched = result[matchIdx];
            if (isGenericWorkoutTitle(matched.title) && !isGenericWorkoutTitle(inc.title)) {
                matched.title = inc.title;
            }
            matched.durationMins = Math.max(matched.durationMins, inc.durationMins);
            if (!matched.startTime && inc.startTime) matched.startTime = inc.startTime;
            if (!matched.endTime && inc.endTime) matched.endTime = inc.endTime;
        } else {
            result.push({ ...inc });
            matchedIndices.add(result.length - 1);
        }
    }

    return result;
}
