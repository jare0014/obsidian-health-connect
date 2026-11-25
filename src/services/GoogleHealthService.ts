import { Notice, requestUrl, RequestUrlResponse } from "obsidian";
import { HealthPluginSettings, FoodItem } from "../models/HealthSettings";
import { GoogleOAuthService } from "./GoogleOAuthService";
import { deduplicateWorkouts, ParsedWorkout } from "./WorkoutDeduplicator";
import { nutritionLogInterval } from "./NutritionLogTime";

export interface HttpResponseLike {
    ok: boolean;
    status: number;
    statusText?: string;
    json: () => Promise<any>;
    text: () => Promise<string>;
}

export const ALCOHOL_BEVERAGE_REGEX = /(?:bourbon|whiskey|whisky|beer|wine|vodka|rum|tequila|gin|cocktail|ipa|dipa|neipa|tipa|lager|ale|stout|porter|pilsner|pilsener|pilsnar|pils|bock|sour|hefeweizen|witbier|weissbier|kolsch|kölsch|tripel|dubbel|quadrupel|radler|shandy|cider|scotch|brandy|cognac|armagnac|sake|soju|mezcal|hard seltzer|seltzer|hard tea|hard lemonade|hard kombucha|malt liquor|malt beverage|prosecco|champagne|cava|sangria|cabernet|merlot|pinot|chardonnay|sauvignon|riesling|zinfandel|syrah|shiraz|mead|highball|margarita|martini|old fashioned|manhattan|paloma|mojito|daiquiri|negroni|cosmopolitan|moscow mule|liquor|spirits|booze|liqueur)/i;

export class GoogleHealthService {
    private settings: HealthPluginSettings;
    private oauth: GoogleOAuthService;
    public lastApiError: string | null = null;

    constructor(settings: HealthPluginSettings, oauth: GoogleOAuthService) {
        this.settings = settings;
        this.oauth = oauth;
    }

    private safeParseJson(res: RequestUrlResponse): any {
        try {
            if (res.json !== undefined) return res.json;
        } catch {
            // fall through to text parse
        }
        try {
            return res.text ? JSON.parse(res.text) : null;
        } catch {
            return null;
        }
    }

    private toHttpResponse(res: RequestUrlResponse): HttpResponseLike {
        return {
            ok: res.status >= 200 && res.status < 300,
            status: res.status,
            statusText: "",
            json: async () => this.safeParseJson(res),
            text: async () => typeof res.text === "string" ? res.text : ""
        };
    }

    private async sendRequest(
        url: string,
        options: { method?: string; headers?: Record<string, string>; body?: string } = {}
    ): Promise<HttpResponseLike> {
        const res = await requestUrl({
            url,
            method: options.method || "GET",
            headers: options.headers,
            body: options.body,
            throw: false
        });
        return this.toHttpResponse(res);
    }

    private async fetchWithTimeout(
        url: string,
        options: { method?: string; headers?: Record<string, string>; body?: string } = {},
        timeoutMs: number = 4000
    ): Promise<HttpResponseLike | null> {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
            });
            return await Promise.race([this.sendRequest(url, options), timeoutPromise]);
        } catch (e) {
            console.warn(`[HealthService] Request to ${url} timed out or failed:`, e);
            return null;
        } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
    }

    public async fetchDailyHealth(targetDate: Date = new Date()): Promise<Record<string, any>> {
        const token = await this.oauth.getAccessToken();
        if (!token) {
            throw new Error("No active Google Health access token. Please connect or re-authorize in settings.");
        }

        const year = targetDate.getFullYear();
        const month = String(targetDate.getMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        // Next day for date-based filters
        const nextDt = new Date(targetDate.getTime() + 86400000);
        const nextDateStr = `${nextDt.getFullYear()}-${String(nextDt.getMonth() + 1).padStart(2, '0')}-${String(nextDt.getDate()).padStart(2, '0')}`;

        // Local sleep window: Yesterday noon to Today noon local time -> UTC ISO
        const startLocalSleep = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - 1, 12, 0, 0);
        const endLocalSleep = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 12, 0, 0);
        const startIso = startLocalSleep.toISOString();
        const endIso = endLocalSleep.toISOString();

        const headers = { Authorization: `Bearer ${token}` };
        const results: Record<string, any> = {};

        try {
            // 1. Google Health v4 Sleep Sessions
            const sleepFilter = `sleep.interval.end_time >= "${startIso}" AND sleep.interval.end_time < "${endIso}"`;
            const sleepUrl = `https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints?filter=${encodeURIComponent(sleepFilter)}`;
            const sleepRes = await this.fetchWithTimeout(sleepUrl, { headers });
            if (sleepRes && sleepRes.ok) {
                const data = await sleepRes.json();
                const sleepMetrics = this.parseSleepPayload(data);
                Object.assign(results, sleepMetrics);
            }
        } catch (e) {
            console.error("Sleep fetch error:", e);
        }

        try {
            // 2. Google Health v4 Daily HRV
            const hrvUrl = `https://health.googleapis.com/v4/users/me/dataTypes/daily-heart-rate-variability/dataPoints`;
            const hrvRes = await this.fetchWithTimeout(hrvUrl, { headers });
            if (hrvRes && hrvRes.ok) {
                const data = await hrvRes.json();
                const vitalsMetrics = this.parseVitalsPayload(data, dateStr);
                Object.assign(results, vitalsMetrics);
            }
        } catch (e) {
            console.error("Vitals fetch error:", e);
        }

        try {
            // 3. Google Health v4 Activity & Steps
            // Priority 1: dailyRollUp endpoint provides authoritative reconciled daily total steps
            let stepsFound = false;
            try {
                const rollupUrl = `https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp`;
                const rollupBody = {
                    range: {
                        start: {
                            date: {
                                year: targetDate.getFullYear(),
                                month: targetDate.getMonth() + 1,
                                day: targetDate.getDate()
                            }
                        },
                        end: {
                            date: {
                                year: nextDt.getFullYear(),
                                month: nextDt.getMonth() + 1,
                                day: nextDt.getDate()
                            }
                        }
                    }
                };
                const rollupRes = await this.fetchWithTimeout(rollupUrl, {
                    method: "POST",
                    headers: { ...headers, "Content-Type": "application/json" },
                    body: JSON.stringify(rollupBody)
                });
                if (rollupRes && rollupRes.ok) {
                    const rollupData = await rollupRes.json();
                    const rollupPoints = rollupData.rollupDataPoints || rollupData.dataPoints || [];
                    for (const rp of rollupPoints) {
                        const rawCount = rp.steps?.countSum ?? rp.steps?.count ?? rp.countSum;
                        if (rawCount !== undefined && rawCount !== null) {
                            const count = parseInt(String(rawCount), 10);
                            if (!isNaN(count) && count > 0) {
                                const key = this.settings.healthSyncConfig?.steps?.key || "steps";
                                results[key] = count;
                                stepsFound = true;
                                break;
                            }
                        }
                    }
                }
            } catch (rollupErr) {
                console.warn("[HealthService] dailyRollUp steps failed, trying list endpoint:", rollupErr);
            }

            // Priority 2: Fallback to list endpoint with civil time filter & max page size to accumulate intraday epochs
            if (!stepsFound) {
                const stepsFilter = `steps.interval.civil_start_time >= "${dateStr}" AND steps.interval.civil_start_time < "${nextDateStr}"`;
                const stepsUrl = `https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints?filter=${encodeURIComponent(stepsFilter)}&pageSize=10000`;
                let stepsRes = await this.fetchWithTimeout(stepsUrl, { headers });
                if (!stepsRes || !stepsRes.ok) {
                    const fallbackUrl = `https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints?pageSize=10000`;
                    stepsRes = await this.fetchWithTimeout(fallbackUrl, { headers });
                }
                if (stepsRes && stepsRes.ok) {
                    const data = await stepsRes.json();
                    const actMetrics = this.parseActivityPayload(data, dateStr);
                    Object.assign(results, actMetrics);
                }
            }
        } catch (e) {
            console.error("Activity/Steps fetch error:", e);
        }

        try {
            // 3b. Google Health v4 Active Zone Minutes
            const azmFilter = `active_zone_minutes.interval.civil_start_time >= "${dateStr}" AND active_zone_minutes.interval.civil_start_time < "${nextDateStr}"`;
            const azmUrl = `https://health.googleapis.com/v4/users/me/dataTypes/active-zone-minutes/dataPoints?filter=${encodeURIComponent(azmFilter)}&pageSize=10000`;
            let azmRes = await this.fetchWithTimeout(azmUrl, { headers });
            if (!azmRes || !azmRes.ok) {
                azmRes = await this.fetchWithTimeout(`https://health.googleapis.com/v4/users/me/dataTypes/active-zone-minutes/dataPoints?pageSize=10000`, { headers });
            }
            if (azmRes && azmRes.ok) {
                const data = await azmRes.json();
                const azmMetrics = this.parseActiveZoneMinutesPayload(data, dateStr);
                Object.assign(results, azmMetrics);
            }
        } catch (e) {
            console.error("Active Zone Minutes fetch error:", e);
        }

        try {
            // 4. Google Health v4 Exercise
            const exerciseFilter = `exercise.interval.civil_start_time >= "${dateStr}" AND exercise.interval.civil_start_time < "${nextDateStr}"`;
            const exerciseUrl = `https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints?filter=${encodeURIComponent(exerciseFilter)}&pageSize=25`;
            let exerciseRes = await this.fetchWithTimeout(exerciseUrl, { headers });
            if (!exerciseRes || !exerciseRes.ok) {
                exerciseRes = await this.fetchWithTimeout(`https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints?pageSize=25`, { headers });
            }
            if (exerciseRes && exerciseRes.ok) {
                const data = await exerciseRes.json();
                const exMetrics = this.parseExercisePayload(data, dateStr);
                Object.assign(results, exMetrics);
            }
        } catch (e) {
            console.error("Exercise session fetch error:", e);
        }

        try {
            // 5. Google Health v4 Nutrition (Calories, Protein, Caffeine)
            const data = await this.fetchNutritionDataPoints(headers);
            const nutMetrics = this.parseNutritionPayload(data, dateStr);
            Object.assign(results, nutMetrics);
        } catch (e) {
            console.error("Nutrition fetch error:", e);
        }

        // 6. Alcohol: Google Health v4 exposes no `alcohol-consumption` data type;
        // alcohol intake is logged via `nutrition-log` and parsed in step 5 above.

        try {
            // 7. Google Health v4 Hydration
            const hydUrl = `https://health.googleapis.com/v4/users/me/dataTypes/hydration-log/dataPoints`;
            const hydRes = await this.fetchWithTimeout(hydUrl, { headers });
            if (hydRes && hydRes.ok) {
                const data = await hydRes.json();
                const hydMetrics = this.parseHydrationPayload(data, dateStr);
                Object.assign(results, hydMetrics);
            }
        } catch (e) {
            console.error("Hydration fetch error:", e);
        }

        try {
            // 8. Google Health v4 Mindfulness Sessions
            const mindSessions = await this.fetchMindfulnessSessionsForDate(dateStr);
            const totalMindMins = mindSessions.reduce((sum, s) => sum + s.durationMins, 0);
            if (totalMindMins > 0) {
                const key = this.settings.healthSyncConfig?.mindfulness?.key || "mindfulness_minutes";
                results[key] = totalMindMins;
            }
        } catch (e) {
            console.error("Mindfulness session fetch error:", e);
        }

        try {
            // 9. Opt-in Vitals & Body Measurements (fetched ONLY when mapped & enabled)
            const extraVitals = await this.fetchOptInVitalsAndBody(dateStr, nextDateStr, headers);
            Object.assign(results, extraVitals);
        } catch (e) {
            console.error("Opt-in vitals fetch error:", e);
        }

        return results;
    }

    private async fetchNutritionDataPoints(headers: Record<string, string>): Promise<{ dataPoints: any[] }> {
        const dataPoints: any[] = [];
        const seenTokens = new Set<string>();
        let pageToken = '';
        do {
            const url = 'https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints?pageSize=1000' +
                (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
            const response = await this.fetchWithTimeout(url, { headers });
            if (!response?.ok) throw new Error('Could not fetch complete nutrition history.');
            const page = await response.json();
            dataPoints.push(...(page.dataPoints || page.dataPoint || page.points || []));
            pageToken = page.nextPageToken || '';
            if (pageToken && seenTokens.has(pageToken)) throw new Error('Repeated nutrition history page token.');
            if (pageToken) seenTokens.add(pageToken);
        } while (pageToken);
        return { dataPoints };
    }

    public async postFoodOrDrink(food: FoodItem, amount: number = 1.0, loggedAt: Date = new Date()): Promise<boolean> {
        this.lastApiError = null;
        const interval = nutritionLogInterval(loggedAt);
        const token = await this.oauth.getAccessToken();
        if (!token) {
            this.lastApiError = 'Not authenticated with Google Health.';
            return false;
        }

        try {
            if (food.category === 'hydration' || food.waterMl) {
                // If waterMl provided in fl oz or ml: standard registry uses ml
                const ml = (food.waterMl || 250) * amount;
                const payload = {
                    hydrationLog: {
                        interval,
                        amountConsumed: { milliliters: ml }
                    }
                };
                const res = await this.sendRequest("https://health.googleapis.com/v4/users/me/dataTypes/hydration-log/dataPoints", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                return await this.foodPostSucceeded(res);
            } else {
                const nutrientsList: any[] = [];
                if (food.caffeineMg) {
                    nutrientsList.push({ nutrient: "CAFFEINE", quantity: { grams: (food.caffeineMg / 1000) * amount } });
                }
                if (food.proteinG) {
                    nutrientsList.push({ nutrient: "PROTEIN", quantity: { grams: food.proteinG * amount } });
                }

                const alcoholGrams = food.category === 'alcohol' || food.alcoholMg
                    ? ((food.alcoholMg || 14000) / 1000) * amount : undefined;
                const nutritionLog: any = {
                    interval,
                    // Google Health exposes no alcohol data type or nutrient enum.
                    // Preserve declared grams in the supported display-name field for round-trip sync.
                    foodDisplayName: alcoholGrams !== undefined
                        ? `${food.name} [${Number(alcoholGrams.toFixed(6))} g alcohol]` : food.name,
                    nutrients: nutrientsList,
                    mealType: "SNACK"
                };

                if (food.calories) {
                    nutritionLog.energy = { kcal: food.calories * amount };
                } else if (alcoholGrams !== undefined) {
                    nutritionLog.energy = { kcal: alcoholGrams * 7 };
                }

                const res = await this.sendRequest("https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ nutritionLog })
                });
                return await this.foodPostSucceeded(res);
            }
        } catch (e) {
            this.lastApiError = e instanceof Error ? e.message : 'Food upload failed.';
            console.error("Food post error:", e);
            return false;
        }
    }

    private async foodPostSucceeded(response: HttpResponseLike): Promise<boolean> {
        if (response.ok) return true;
        const error = await response.json().catch(() => null);
        this.lastApiError = `HTTP ${response.status}: ${error?.error?.message || response.statusText || 'Upload failed'}`;
        return false;
    }

    private declaredAlcoholGrams(name: string): number | undefined {
        const match = name.match(/\[(\d+(?:\.\d+)?) g alcohol\]$/);
        return match ? Number(match[1]) : undefined;
    }

    public mapExerciseType(exerciseName: string, targetExerciseType?: string): string {
        const lower = (exerciseName || "").toLowerCase();
        let exerciseType = "OTHER";

        if (targetExerciseType && targetExerciseType.trim() !== "") {
            exerciseType = targetExerciseType.trim().toUpperCase();
        } else {
            const registry = this.settings.workoutRegistry || [];
            const matched = registry.find(w => w.name.toLowerCase() === lower || w.id.toLowerCase() === lower);
            if (matched && matched.googleHealthType) {
                exerciseType = matched.googleHealthType.trim().toUpperCase();
            } else if (lower.includes("walk")) exerciseType = "WALKING";
            else if (lower.includes("run")) exerciseType = "RUNNING";
            else if (lower.includes("bik") || lower.includes("cycl")) exerciseType = "BIKING";
            else if (lower.includes("yoga")) exerciseType = "YOGA";
            else if (lower.includes("stretch")) exerciseType = "STRETCHING";
            else if (lower.includes("meditat") || lower.includes("mindful")) exerciseType = "MEDITATE";
            else if (lower.includes("weight") || lower.includes("strength") || lower.includes("gym") || lower.includes("phase 2") || lower.includes("phase 3")) exerciseType = "STRENGTH_TRAINING";
            else if (lower.includes("phase 1") || lower.includes("calisthenic") || lower.includes("exercise") || lower.includes("mobility") || lower.includes("postur")) exerciseType = "CALISTHENICS";
            else if (lower.includes("swim")) exerciseType = "SWIMMING";
            else if (lower.includes("pilates")) exerciseType = "PILATES";
            else if (lower.includes("aerobic") || lower.includes("cardio")) exerciseType = "AEROBIC_WORKOUT";
        }

        // Clean up legacy or invalid enum mappings to valid Google Health v4 ExerciseType
        if (exerciseType === "OTHER_WORKOUT" || exerciseType === "WORKOUT") {
            exerciseType = "OTHER";
        } else if (exerciseType === "AEROBICS") {
            exerciseType = "AEROBIC_WORKOUT";
        }

        return exerciseType;
    }

    public async postExerciseSession(
        exerciseName: string,
        startTime: string | Date,
        endTime: string | Date,
        targetExerciseType?: string
    ): Promise<boolean> {
        const token = await this.oauth.getAccessToken();
        if (!token) return false;

        const startDate = typeof startTime === "string" ? new Date(startTime) : startTime;
        const endDate = typeof endTime === "string" ? new Date(endTime) : endTime;
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            console.error("[HealthService] Invalid timestamps for exercise:", { startTime, endTime });
            return false;
        }

        const offsetSeconds = -startDate.getTimezoneOffset() * 60;
        const interval = {
            startTime: startDate.toISOString(),
            endTime: endDate.toISOString(),
            startUtcOffset: `${offsetSeconds}s`,
            endUtcOffset: `${offsetSeconds}s`
        };

        const exerciseType = this.mapExerciseType(exerciseName, targetExerciseType);

        const payload = {
            exercise: {
                exerciseType,
                interval
            }
        };

        try {
            const res = await this.sendRequest("https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });
            if (res.ok || res.status === 201) {
                this.lastApiError = null;
                return true;
            }

            const errText = await res.text().catch(() => "");
            console.error(`[HealthService] Exercise post error (${res.status}):`, errText);
            if (res.status === 403 || errText.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || errText.includes("insufficient")) {
                this.lastApiError = "Missing Google Health write permission. Re-authorize Google Health in Settings.";
            } else {
                this.lastApiError = `Google Health API error (${res.status}): ${errText.slice(0, 100)}`;
            }
            return false;
        } catch (e: any) {
            console.error("[HealthService] Exercise post error:", e);
            this.lastApiError = e?.message || "Network request failed";
            return false;
        }
    }

    public async fetchExerciseSessionsForDate(dateStr: string): Promise<Array<{ id?: string; type: string; start: number; end: number; durationMins: number }>> {
        const token = await this.oauth.getAccessToken();
        if (!token) return [];

        const headers = { Authorization: `Bearer ${token}` };
        const nextDate = new Date(`${dateStr}T00:00:00`);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split("T")[0];

        try {
            const exerciseFilter = `exercise.interval.civil_start_time >= "${dateStr}" AND exercise.interval.civil_start_time < "${nextDateStr}"`;
            const exerciseUrl = `https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints?filter=${encodeURIComponent(exerciseFilter)}&pageSize=100`;
            let exerciseRes = await this.fetchWithTimeout(exerciseUrl, { headers });
            if (!exerciseRes || !exerciseRes.ok) {
                exerciseRes = await this.fetchWithTimeout(`https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints?pageSize=100`, { headers });
            }
            if (!exerciseRes || !exerciseRes.ok) return [];

            const data = await exerciseRes.json();
            const points = data.dataPoint || data.dataPoints || data.points || [];
            const sessions: Array<{ id?: string; type: string; start: number; end: number; durationMins: number }> = [];

            for (const p of points) {
                const ex = p.exercise || p;
                const interval = ex.interval || p.interval;
                if (interval && (this.isCivilDateMatch(interval, dateStr) || this.isSameLocalDate(interval.startTime || "", dateStr))) {
                    const rawType = String(ex.exerciseType || ex.type || "").toUpperCase();
                    if (rawType === "MEDITATE" || rawType === "MINDFULNESS") continue;

                    const type = ex.exerciseType || ex.type || "Workout";
                    const start = new Date(interval.startTime).getTime();
                    const end = new Date(interval.endTime).getTime();
                    const durationMins = Math.round((end - start) / (1000 * 60));
                    const formattedType = String(type)
                        .replace(/_/g, ' ')
                        .toLowerCase()
                        .replace(/\b\w/g, l => l.toUpperCase());
                    const dpId = p.name || p.dataPointId || p.id || undefined;

                    if (durationMins > 0 && !isNaN(start) && !isNaN(end)) {
                        sessions.push({ id: dpId, type: formattedType, start, end, durationMins });
                    }
                }
            }
            return sessions;
        } catch (e) {
            console.error("[HealthService] Error fetching exercise sessions for date:", e);
            return [];
        }
    }

    public async postMindfulnessSession(
        startTime: string | Date,
        endTime: string | Date,
        title: string = "Meditation"
    ): Promise<boolean> {
        this.lastApiError = null;
        const token = await this.oauth.getAccessToken();
        if (!token) {
            this.lastApiError = "No Google Health access token. Please connect in settings.";
            return false;
        }

        const startDate = typeof startTime === "string" ? new Date(startTime) : startTime;
        const endDate = typeof endTime === "string" ? new Date(endTime) : endTime;
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            this.lastApiError = "Invalid timestamps for mindfulness session.";
            console.error("[HealthService] Invalid timestamps for mindfulness session:", { startTime, endTime });
            return false;
        }

        const offsetSeconds = -startDate.getTimezoneOffset() * 60;
        const interval = {
            startTime: startDate.toISOString(),
            endTime: endDate.toISOString(),
            startUtcOffset: `${offsetSeconds}s`,
            endUtcOffset: `${offsetSeconds}s`
        };

        // Google Health REST API v4 accepts meditation sessions as exercise with exerciseType: "MEDITATE"
        const payload = {
            exercise: {
                displayName: title || "Meditation",
                exerciseType: "MEDITATE",
                interval
            }
        };

        try {
            const res = await this.sendRequest("https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (res.ok || res.status === 201) {
                this.lastApiError = null;
                return true;
            }

            const errText = await res.text().catch(() => "");
            console.error(`[HealthService] Mindfulness session post error (${res.status}):`, errText);
            if (res.status === 403 || errText.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || errText.includes("insufficient")) {
                this.lastApiError = "Missing Google Health write permission. Re-authorize Google Health in Settings.";
            } else {
                this.lastApiError = `Google Health API error (${res.status}): ${errText.slice(0, 140)}`;
            }
            return false;
        } catch (e: any) {
            console.error("[HealthService] Mindfulness post error:", e);
            this.lastApiError = e?.message || "Network request failed";
            return false;
        }
    }

    public async fetchMindfulnessSessionsForDate(dateStr: string): Promise<Array<{ id?: string; start: number; end: number; durationMins: number }>> {
        const token = await this.oauth.getAccessToken();
        if (!token) return [];

        const headers = { Authorization: `Bearer ${token}` };
        const sessions: Array<{ id?: string; start: number; end: number; durationMins: number }> = [];

        try {
            const nextDate = new Date(`${dateStr}T00:00:00`);
            nextDate.setDate(nextDate.getDate() + 1);
            const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;

            // In Google Health v4 REST API, meditation is tracked under exercise dataPoints with exerciseType: "MEDITATE"
            const exerciseFilter = `exercise.interval.civil_start_time >= "${dateStr}" AND exercise.interval.civil_start_time < "${nextDateStr}"`;
            let exerciseRes = await this.fetchWithTimeout(`https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints?filter=${encodeURIComponent(exerciseFilter)}&pageSize=100`, { headers });
            
            if (!exerciseRes || !exerciseRes.ok) {
                // Fallback query without civil_start_time filter
                exerciseRes = await this.fetchWithTimeout(`https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints?pageSize=100`, { headers });
            }

            if (exerciseRes && exerciseRes.ok) {
                const data = await exerciseRes.json();
                const points = data.dataPoint || data.dataPoints || data.points || [];
                for (const p of points) {
                    const ex = p.exercise || p;
                    const interval = ex.interval || p.interval;
                    if (interval && (this.isCivilDateMatch(interval, dateStr) || this.isSameLocalDate(interval.startTime || "", dateStr))) {
                        const rawType = String(ex.exerciseType || ex.type || "").toUpperCase();
                        if (rawType === "MEDITATE" || rawType === "MINDFULNESS" || rawType.includes("MEDITAT")) {
                            const start = new Date(interval.startTime).getTime();
                            const end = new Date(interval.endTime).getTime();
                            const durationMins = Math.round((end - start) / 60000);
                            const dpId = p.name || p.dataPointId || p.id || undefined;
                            if (durationMins > 0 && !isNaN(start) && !isNaN(end)) {
                                sessions.push({ id: dpId, start, end, durationMins });
                            }
                        }
                    }
                }
            }

            return sessions;
        } catch (e) {
            console.error("[HealthService] Error fetching mindfulness sessions for date:", e);
            return [];
        }
    }

    public async deleteHealthDataPoint(dataType: string, dataPointIdOrName: string): Promise<boolean> {
        const token = await this.oauth.getAccessToken();
        if (!token) return false;

        const fullName = dataPointIdOrName.startsWith("users/")
            ? dataPointIdOrName
            : `users/me/dataTypes/${dataType}/dataPoints/${dataPointIdOrName}`;

        const url = `https://health.googleapis.com/v4/users/me/dataTypes/${encodeURIComponent(dataType)}/dataPoints:batchDelete`;

        try {
            const res = await this.sendRequest(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ names: [fullName] })
            });

            if (res.ok || res.status === 200 || res.status === 204) {
                return true;
            }

            const errJson = await res.json().catch(() => null);
            console.warn(`[HealthService] Primary batchDelete failed (${res.status}):`, errJson);

            // Cross-client provenance check: If entry was logged by a different OAuth client,
            // Google Health returns 403 PERMISSION_DENIED / DATA_POINT_NOT_OWNED_BY_CLIENT.
            if (res.status === 403 && (
                errJson?.error?.status === "PERMISSION_DENIED" ||
                JSON.stringify(errJson || "").includes("DATA_POINT_NOT_OWNED_BY_CLIENT") ||
                JSON.stringify(errJson || "").includes("unowned")
            )) {
                console.warn(`[HealthService] Data point ${dataPointIdOrName} was logged by a different OAuth client and cannot be deleted by this client.`);
                return false;
            }

            return false;
        } catch (e) {
            console.error(`Failed to delete data point ${dataPointIdOrName} from ${dataType}:`, e);
            return false;
        }
    }

    public async fetchLoggedFoodHistory(daysLookbackOrDate: number | Date = 7): Promise<Array<{
        id: string;
        dataType: string;
        name: string;
        category: 'nutrition' | 'caffeine' | 'hydration' | 'alcohol';
        time: string;
        displayTime: string;
        dateStr: string;
        timestamp: number;
        details: string;
        calories?: number;
        proteinG?: number;
        caffeineMg?: number;
        alcoholMg?: number;
        waterMl?: number;
        unit?: string;
    }>> {
        const token = await this.oauth.getAccessToken();
        if (!token) return [];

        let singleDateStr: string | null = null;
        let cutoffTimestamp = 0;

        if (daysLookbackOrDate instanceof Date) {
            const y = daysLookbackOrDate.getFullYear();
            const m = String(daysLookbackOrDate.getMonth() + 1).padStart(2, '0');
            const d = String(daysLookbackOrDate.getDate()).padStart(2, '0');
            singleDateStr = `${y}-${m}-${d}`;
        } else {
            const days = typeof daysLookbackOrDate === 'number' && daysLookbackOrDate > 0 ? daysLookbackOrDate : 7;
            const now = new Date();
            const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
            cutoffTimestamp = cutoffDate.getTime();
        }

        const headers = { Authorization: `Bearer ${token}` };
        const history: Array<{
            id: string;
            dataType: string;
            name: string;
            category: 'nutrition' | 'caffeine' | 'hydration' | 'alcohol';
            time: string;
            displayTime: string;
            dateStr: string;
            timestamp: number;
            details: string;
            calories?: number;
            proteinG?: number;
            caffeineMg?: number;
            alcoholMg?: number;
            waterMl?: number;
            unit?: string;
        }> = [];

        const isPointInRange = (info: { dateStr: string; timestamp: number } | null): boolean => {
            if (!info) return false;
            if (singleDateStr) {
                return info.dateStr === singleDateStr;
            }
            return info.timestamp >= cutoffTimestamp;
        };

        // 1. Nutrition logs
        try {
            const res = await this.sendRequest("https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints?pageSize=1000", { headers });
            if (res.ok) {
                const data = await res.json();
                const points = data.dataPoint || data.dataPoints || data.points || [];
                for (const p of points) {
                    const log = p.nutritionLog || p;
                    const interval = log.interval || p.interval;
                    const startTime = interval?.startTime || p.startTime || "";
                    const dateInfo = this.extractPointDateInfo(interval, startTime);

                    if (isPointInRange(dateInfo) && dateInfo) {
                        const name = log.foodDisplayName || log.foodName || log.name || "Food Item";
                        
                        const detailParts: string[] = [];
                        let calories: number | undefined = undefined;
                        if (log.energy?.kcal) {
                            calories = Math.round(log.energy.kcal);
                            detailParts.push(`${calories} kcal`);
                        }
                        
                        let prot = 0;
                        let caff = 0;
                        const declaredAlcohol = this.declaredAlcoholGrams(name);
                        let alc = declaredAlcohol ?? 0;
                        let isAlc = declaredAlcohol !== undefined;
                        if (Array.isArray(log.nutrients)) {
                            for (const n of log.nutrients) {
                                if (n.nutrient === 'PROTEIN' && n.quantity?.grams) {
                                    prot = Math.round(n.quantity.grams * 10) / 10;
                                    detailParts.push(`${prot}g protein`);
                                }
                                if (n.nutrient === 'CAFFEINE' && n.quantity?.grams) {
                                    caff = Math.round(n.quantity.grams * 1000);
                                    detailParts.push(`${caff}mg caff`);
                                }
                                if (declaredAlcohol === undefined && (n.nutrient === 'ALCOHOL' || n.nutrient === 'ALCOHOL_GRAMS' || n.nutrient === 'ETHANOL') && n.quantity?.grams) {
                                    alc = Math.round(n.quantity.grams * 10) / 10;
                                    detailParts.push(`${alc}g alcohol`);
                                    isAlc = true;
                                }
                            }
                        }
                        if (!isAlc && ALCOHOL_BEVERAGE_REGEX.test(name)) {
                            isAlc = true;
                            if (calories) {
                                alc = Math.round((calories / 7.0) * 10) / 10;
                                detailParts.push(`~${alc}g alcohol`);
                            }
                        }

                        let finalCat: 'nutrition' | 'caffeine' | 'hydration' | 'alcohol' = "nutrition";
                        if (isAlc) finalCat = "alcohol";
                        else if (caff > 0 && (!calories || calories < 30)) finalCat = "caffeine";

                        const unit = log.serving?.foodMeasurementUnitDisplayName || "serving";
                        const dataPointId = p.name || p.dataPointId || p.id || startTime;

                        history.push({
                            id: dataPointId,
                            dataType: "nutrition-log",
                            name,
                            category: finalCat,
                            time: dateInfo.timeStr,
                            displayTime: dateInfo.displayTime,
                            dateStr: dateInfo.dateStr,
                            timestamp: dateInfo.timestamp,
                            details: detailParts.join(", ") || "Logged",
                            calories: calories,
                            proteinG: prot > 0 ? prot : undefined,
                            caffeineMg: caff > 0 ? caff : undefined,
                            alcoholMg: alc > 0 ? Math.round(alc * 1000) : undefined,
                            unit
                        });
                    }
                }
            }
        } catch (e) {}

        // 2. Hydration logs
        try {
            const res = await this.sendRequest("https://health.googleapis.com/v4/users/me/dataTypes/hydration-log/dataPoints?pageSize=1000", { headers });
            if (res.ok) {
                const data = await res.json();
                const points = data.dataPoint || data.dataPoints || data.points || [];
                for (const p of points) {
                    const log = p.hydrationLog || p;
                    const interval = log.interval || p.interval;
                    const startTime = interval?.startTime || p.startTime || "";
                    const dateInfo = this.extractPointDateInfo(interval, startTime);

                    if (isPointInRange(dateInfo) && dateInfo) {
                        const ml = log.amountConsumed?.milliliters || log.volume?.milliliters || 0;
                        const flOz = Math.round(ml / 29.5735);
                        const dataPointId = p.name || p.dataPointId || p.id || startTime;

                        history.push({
                            id: dataPointId,
                            dataType: "hydration-log",
                            name: "Water / Hydration",
                            category: "hydration",
                            time: dateInfo.timeStr,
                            displayTime: dateInfo.displayTime,
                            dateStr: dateInfo.dateStr,
                            timestamp: dateInfo.timestamp,
                            details: `${flOz} fl oz (${Math.round(ml)} mL)`,
                            waterMl: Math.round(ml),
                            unit: "cup (8 oz)"
                        });
                    }
                }
            }
        } catch (e) {}

        // 3. Alcohol logs are stored in `nutrition-log` (Google Health v4 has no `alcohol-consumption` data type)
        // and are already extracted in step 1 above.

        // Sort descending by timestamp (newest first)
        history.sort((a, b) => b.timestamp - a.timestamp);
        return history;
    }

    public async fetchExerciseHistory(days: number = 7): Promise<Array<{
        id?: string;
        dateStr: string;
        type: string;
        start: number;
        end: number;
        durationMins: number;
        displayTime: string;
    }>> {
        const results: Array<{
            id?: string;
            dateStr: string;
            type: string;
            start: number;
            end: number;
            durationMins: number;
            displayTime: string;
        }> = [];

        const now = new Date();
        for (let i = 0; i < days; i++) {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const sessions = await this.fetchExerciseSessionsForDate(dateStr);
            for (const s of sessions) {
                const sDate = new Date(s.start);
                const displayTime = sDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                results.push({
                    id: s.id,
                    dateStr,
                    type: s.type,
                    start: s.start,
                    end: s.end,
                    durationMins: s.durationMins,
                    displayTime
                });
            }
        }
        results.sort((a, b) => b.start - a.start);
        return results;
    }

    public async fetchMindfulnessHistory(days: number = 7): Promise<Array<{
        id?: string;
        dateStr: string;
        start: number;
        end: number;
        durationMins: number;
        displayTime: string;
    }>> {
        const results: Array<{
            id?: string;
            dateStr: string;
            start: number;
            end: number;
            durationMins: number;
            displayTime: string;
        }> = [];

        const now = new Date();
        for (let i = 0; i < days; i++) {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const sessions = await this.fetchMindfulnessSessionsForDate(dateStr);
            for (const s of sessions) {
                const sDate = new Date(s.start);
                const displayTime = sDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                results.push({
                    id: s.id,
                    dateStr,
                    start: s.start,
                    end: s.end,
                    durationMins: s.durationMins,
                    displayTime
                });
            }
        }
        results.sort((a, b) => b.start - a.start);
        return results;
    }

    private extractPointDateInfo(interval: any, startTimeFallback: string): { dateStr: string; timestamp: number; displayTime: string; timeStr: string } | null {
        let timestamp = 0;
        let dateStr = "";
        let timeStr = "";
        let hasExplicitTime = false;

        // 1. Try ISO timestamp fallback first (which often contains full UTC time)
        const isoCandidate = interval?.startTime || startTimeFallback || "";
        if (isoCandidate) {
            try {
                const d = new Date(isoCandidate);
                if (!isNaN(d.getTime())) {
                    timestamp = d.getTime();
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    dateStr = `${y}-${m}-${day}`;
                    
                    // Check if ISO string actually contains non-midnight time
                    const hasNonZeroTime = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
                    if (hasNonZeroTime || (isoCandidate.includes("T") && !isoCandidate.endsWith("T00:00:00Z") && !isoCandidate.endsWith("T00:00:00.000Z"))) {
                        hasExplicitTime = true;
                        const hours = d.getHours();
                        const minutes = String(d.getMinutes()).padStart(2, '0');
                        timeStr = `${hours}:${minutes}`;
                    }
                }
            } catch (e) {}
        }

        // 2. Try civilStartTime if timestamp wasn't set or civilStartTime has explicit time
        if (interval?.civilStartTime?.date) {
            const cDate = interval.civilStartTime.date;
            if (cDate.year && cDate.month && cDate.day) {
                const civilDateStr = `${cDate.year}-${String(cDate.month).padStart(2, '0')}-${String(cDate.day).padStart(2, '0')}`;
                if (!dateStr) dateStr = civilDateStr;
                
                const cTime = interval.civilStartTime.time;
                if (cTime && typeof cTime.hour === 'number') {
                    const hours = cTime.hour;
                    const minutes = typeof cTime.minute === 'number' ? cTime.minute : 0;
                    timeStr = `${hours}:${String(minutes).padStart(2, '0')}`;
                    hasExplicitTime = true;
                    const d = new Date(cDate.year, cDate.month - 1, cDate.day, hours, minutes);
                    timestamp = d.getTime();
                } else if (!timestamp) {
                    const d = new Date(cDate.year, cDate.month - 1, cDate.day);
                    timestamp = d.getTime();
                }
            }
        }

        if (!timestamp || !dateStr) return null;

        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const d = new Date(timestamp);
        const dateLabel = dateStr === todayStr ? "Today" : dateStr === yesterdayStr ? "Yesterday" : `${monthNames[d.getMonth()]} ${d.getDate()}`;

        // Exclude time if not available or defaulted to 0:00
        let displayTime = dateLabel;
        if (hasExplicitTime && timeStr && timeStr !== "0:00") {
            displayTime = `${dateLabel} at ${timeStr}`;
        }

        return { dateStr, timestamp, displayTime, timeStr: hasExplicitTime ? timeStr : "" };
    }

    private isSameLocalDate(isoStr: string, targetDateStr: string): boolean {
        if (!isoStr) return false;
        try {
            const d = new Date(isoStr);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}` === targetDateStr;
        } catch (e) {
            return false;
        }
    }

    /**
     * Match date using civilStartTime from Google Health v4 API.
     * civilStartTime contains the local date/time already offset-adjusted,
     * which is more reliable than converting UTC startTime.
     */
    private isCivilDateMatch(interval: any, targetDateStr: string): boolean {
        if (!interval?.civilStartTime?.date) return false;
        const cDate = interval.civilStartTime.date;
        if (!cDate.year || !cDate.month || !cDate.day) return false;
        const civilStr = `${cDate.year}-${String(cDate.month).padStart(2, '0')}-${String(cDate.day).padStart(2, '0')}`;
        return civilStr === targetDateStr;
    }

    private isOptInMetricEnabled(metricId: string): boolean {
        return Boolean(this.settings.healthSyncConfig?.[metricId]?.enabled);
    }

    private formatMinutesAsHm(totalMins: number): string {
        const hrs = Math.floor(totalMins / 60);
        const remMins = totalMins % 60;
        return `${hrs}:${String(remMins).padStart(2, '0')}`;
    }

    private isDateObjMatch(dateObj: any, targetDateStr: string): boolean {
        if (!dateObj?.year || !dateObj?.month || !dateObj?.day) return false;
        const str = `${dateObj.year}-${String(dateObj.month).padStart(2, '0')}-${String(dateObj.day).padStart(2, '0')}`;
        return str === targetDateStr;
    }

    private isSampleDateMatch(sampleTime: any, targetDateStr: string): boolean {
        if (!sampleTime) return false;
        if (sampleTime.civilTime?.date) {
            const cDate = sampleTime.civilTime.date;
            if (cDate.year && cDate.month && cDate.day) {
                return this.isDateObjMatch(cDate, targetDateStr);
            }
        }
        if (sampleTime.physicalTime) {
            return this.isSameLocalDate(sampleTime.physicalTime, targetDateStr);
        }
        return false;
    }

    private getSampleTimestamp(sampleTime: any): number {
        if (sampleTime?.physicalTime) {
            const ts = Date.parse(sampleTime.physicalTime);
            if (!isNaN(ts)) return ts;
        }
        if (sampleTime?.civilTime?.date) {
            const d = sampleTime.civilTime.date;
            const t = sampleTime.civilTime.time;
            if (d.year && d.month && d.day) {
                return new Date(d.year, d.month - 1, d.day, t?.hour || 0, t?.minute || 0, t?.second || 0).getTime();
            }
        }
        return 0;
    }

    private async fetchDataPointsSafe(
        dataType: string,
        headers: Record<string, string>,
        query?: string
    ): Promise<{ status: number; dataPoints: any[] }> {
        const url = `https://health.googleapis.com/v4/users/me/dataTypes/${dataType}/dataPoints${query ? `?${query}` : ''}`;
        const res = await this.fetchWithTimeout(url, { headers });
        if (!res) {
            return { status: 0, dataPoints: [] };
        }
        if (res.status === 403 || res.status === 404 || !res.ok) {
            console.warn(`[HealthService] Skipping ${dataType} (HTTP ${res.status})`);
            return { status: res.status, dataPoints: [] };
        }
        const data = await res.json().catch(() => null);
        const points = data?.dataPoint || data?.dataPoints || data?.points || [];
        return { status: res.status, dataPoints: Array.isArray(points) ? points : [] };
    }

    private pickLatestSampleValue(
        points: any[],
        targetDateStr: string,
        extract: (p: any) => { sampleTime: any; value: any } | null
    ): number | null {
        let bestTs = -1;
        let bestVal: number | null = null;
        for (const p of points) {
            const item = extract(p);
            if (!item || !this.isSampleDateMatch(item.sampleTime, targetDateStr)) continue;
            const num = typeof item.value === "number" ? item.value : parseFloat(String(item.value ?? ""));
            if (isNaN(num)) continue;
            const ts = this.getSampleTimestamp(item.sampleTime);
            if (bestVal === null || ts >= bestTs) {
                bestTs = ts;
                bestVal = num;
            }
        }
        return bestVal;
    }

    private averageSampleValues(
        points: any[],
        targetDateStr: string,
        extract: (p: any) => { sampleTime: any; value: any } | null
    ): number | null {
        let sum = 0;
        let count = 0;
        for (const p of points) {
            const item = extract(p);
            if (!item || !this.isSampleDateMatch(item.sampleTime, targetDateStr)) continue;
            const num = typeof item.value === "number" ? item.value : parseFloat(String(item.value ?? ""));
            if (!isNaN(num) && num > 0) {
                sum += num;
                count++;
            }
        }
        return count > 0 ? sum / count : null;
    }

    private async fetchOptInVitalsAndBody(
        dateStr: string,
        nextDateStr: string,
        headers: Record<string, string>
    ): Promise<Record<string, any>> {
        const out: Record<string, any> = {};

        // 1. Resting Heart Rate -> daily-resting-heart-rate
        if (this.isOptInMetricEnabled("resting_heart_rate")) {
            const res = await this.fetchDataPointsSafe("daily-resting-heart-rate", headers);
            for (const p of res.dataPoints) {
                const obj = p.dailyRestingHeartRate || p;
                if (this.isDateObjMatch(obj.date, dateStr)) {
                    const bpm = parseFloat(String(obj.beatsPerMinute ?? ""));
                    if (!isNaN(bpm) && bpm > 0) {
                        const key = this.settings.healthSyncConfig?.resting_heart_rate?.key || "resting_heart_rate";
                        out[key] = Math.round(bpm);
                        break;
                    }
                }
            }
        }

        // 2. Blood Oxygen / SpO2 -> daily-oxygen-saturation (fallback: oxygen-saturation)
        if (this.isOptInMetricEnabled("blood_oxygen")) {
            const key = this.settings.healthSyncConfig?.blood_oxygen?.key || "spo2";
            let spo2Val: number | null = null;
            const dailyRes = await this.fetchDataPointsSafe("daily-oxygen-saturation", headers);
            for (const p of dailyRes.dataPoints) {
                const obj = p.dailyOxygenSaturation || p;
                if (this.isDateObjMatch(obj.date, dateStr)) {
                    const pct = parseFloat(String(obj.averagePercentage ?? ""));
                    if (!isNaN(pct) && pct > 0) {
                        spo2Val = pct;
                        break;
                    }
                }
            }
            if (spo2Val === null && dailyRes.status !== 403) {
                const sampleRes = await this.fetchDataPointsSafe("oxygen-saturation", headers, "pageSize=1000");
                spo2Val = this.averageSampleValues(sampleRes.dataPoints, dateStr, p => {
                    const obj = p.oxygenSaturation || p;
                    return obj ? { sampleTime: obj.sampleTime || p.sampleTime, value: obj.percentage } : null;
                });
            }
            if (spo2Val !== null && spo2Val > 0) {
                out[key] = Math.round(spo2Val * 10) / 10;
            }
        }

        // 3. Respiratory Rate -> daily-respiratory-rate (fallback: respiratory-rate-sleep-summary)
        if (this.isOptInMetricEnabled("respiratory_rate")) {
            const key = this.settings.healthSyncConfig?.respiratory_rate?.key || "respiratory_rate";
            let rrVal: number | null = null;
            const dailyRes = await this.fetchDataPointsSafe("daily-respiratory-rate", headers);
            for (const p of dailyRes.dataPoints) {
                const obj = p.dailyRespiratoryRate || p;
                if (this.isDateObjMatch(obj.date, dateStr)) {
                    const br = parseFloat(String(obj.breathsPerMinute ?? ""));
                    if (!isNaN(br) && br > 0) {
                        rrVal = br;
                        break;
                    }
                }
            }
            if (rrVal === null && dailyRes.status !== 403) {
                const summaryRes = await this.fetchDataPointsSafe("respiratory-rate-sleep-summary", headers);
                rrVal = this.pickLatestSampleValue(summaryRes.dataPoints, dateStr, p => {
                    const obj = p.respiratoryRateSleepSummary || p;
                    const br = obj?.fullSleepStats?.breathsPerMinute
                        ?? obj?.deepSleepStats?.breathsPerMinute
                        ?? obj?.remSleepStats?.breathsPerMinute
                        ?? obj?.lightSleepStats?.breathsPerMinute;
                    return obj ? { sampleTime: obj.sampleTime || p.sampleTime, value: br } : null;
                });
            }
            if (rrVal !== null && rrVal > 0) {
                out[key] = Math.round(rrVal * 10) / 10;
            }
        }

        // 4. Weight -> weight (weightGrams -> lbs)
        if (this.isOptInMetricEnabled("weight")) {
            const res = await this.fetchDataPointsSafe("weight", headers, "pageSize=100");
            const grams = this.pickLatestSampleValue(res.dataPoints, dateStr, p => {
                const obj = p.weight || p;
                return obj ? { sampleTime: obj.sampleTime || p.sampleTime, value: obj.weightGrams } : null;
            });
            if (grams !== null && grams > 0) {
                const key = this.settings.healthSyncConfig?.weight?.key || "weight";
                out[key] = Math.round((grams / 453.59237) * 10) / 10;
            }
        }

        // 5. Body Fat -> body-fat (percentage)
        if (this.isOptInMetricEnabled("body_fat")) {
            const res = await this.fetchDataPointsSafe("body-fat", headers, "pageSize=100");
            const pct = this.pickLatestSampleValue(res.dataPoints, dateStr, p => {
                const obj = p.bodyFat || p;
                return obj ? { sampleTime: obj.sampleTime || p.sampleTime, value: obj.percentage } : null;
            });
            if (pct !== null && pct > 0) {
                const key = this.settings.healthSyncConfig?.body_fat?.key || "body_fat";
                out[key] = Math.round(pct * 10) / 10;
            }
        }

        // 6. Blood Glucose -> blood-glucose (mg/dL)
        if (this.isOptInMetricEnabled("blood_glucose")) {
            const res = await this.fetchDataPointsSafe("blood-glucose", headers, "pageSize=500");
            const avgMgDl = this.averageSampleValues(res.dataPoints, dateStr, p => {
                const obj = p.bloodGlucose || p;
                return obj ? { sampleTime: obj.sampleTime || p.sampleTime, value: obj.bloodGlucoseMilligramsPerDeciliter } : null;
            });
            if (avgMgDl !== null && avgMgDl > 0) {
                const key = this.settings.healthSyncConfig?.blood_glucose?.key || "blood_glucose";
                out[key] = Math.round(avgMgDl * 10) / 10;
            }
        }

        // 7. Body Temperature -> core-body-temperature (fallback: daily-sleep-temperature-derivations)
        if (this.isOptInMetricEnabled("body_temperature")) {
            const key = this.settings.healthSyncConfig?.body_temperature?.key || "body_temperature";
            const coreRes = await this.fetchDataPointsSafe("core-body-temperature", headers, "pageSize=100");
            let tempC = this.pickLatestSampleValue(coreRes.dataPoints, dateStr, p => {
                const obj = p.coreBodyTemperature || p;
                return obj ? { sampleTime: obj.sampleTime || p.sampleTime, value: obj.temperatureCelsius } : null;
            });
            if (tempC === null && coreRes.status !== 403) {
                const sleepTempRes = await this.fetchDataPointsSafe("daily-sleep-temperature-derivations", headers);
                for (const p of sleepTempRes.dataPoints) {
                    const obj = p.dailySleepTemperatureDerivations || p;
                    if (this.isDateObjMatch(obj.date, dateStr)) {
                        const c = parseFloat(String(obj.nightlyTemperatureCelsius ?? ""));
                        if (!isNaN(c) && c > 0) {
                            tempC = c;
                            break;
                        }
                    }
                }
            }
            if (tempC !== null && tempC > 0) {
                out[key] = Math.round(tempC * 10) / 10;
            }
        }

        // 8. Basal Metabolic Rate -> basal-energy-burned (sum kcal)
        if (this.isOptInMetricEnabled("basal_metabolic_rate")) {
            const bmrFilter = `basal_energy_burned.interval.civil_start_time >= "${dateStr}" AND basal_energy_burned.interval.civil_start_time < "${nextDateStr}"`;
            let res = await this.fetchDataPointsSafe(
                "basal-energy-burned",
                headers,
                `filter=${encodeURIComponent(bmrFilter)}&pageSize=1000`
            );
            if (res.status !== 200 && res.status !== 403 && res.status !== 404) {
                res = await this.fetchDataPointsSafe("basal-energy-burned", headers, "pageSize=1000");
            }
            let totalKcal = 0;
            for (const p of res.dataPoints) {
                const obj = p.basalEnergyBurned || p;
                const interval = obj.interval || p.interval;
                if (!interval || this.isCivilDateMatch(interval, dateStr) || this.isSameLocalDate(interval.startTime || "", dateStr)) {
                    const kcal = parseFloat(String(obj.kcal ?? ""));
                    if (!isNaN(kcal) && kcal > 0) totalKcal += kcal;
                }
            }
            if (totalKcal > 0) {
                const key = this.settings.healthSyncConfig?.basal_metabolic_rate?.key || "bmr";
                out[key] = Math.round(totalKcal);
            }
        }

        return out;
    }

    private parseStageDurationValue(val: any): number {
        if (val === null || val === undefined) return 0;
        if (typeof val === "string" && val.includes(":")) {
            const parts = val.split(":");
            const h = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            return (!isNaN(h) && !isNaN(m)) ? (h * 60 + m) : 0;
        }
        const parsed = parseInt(String(val), 10);
        return (!isNaN(parsed) && parsed > 0) ? parsed : 0;
    }

    private extractSleepStageMetrics(sleepObj: any): {
        deepMins: number;
        lightMins: number;
        remMins: number;
        awakeMins: number;
        awakeCount: number;
        hasStageData: boolean;
    } {
        let deepMins = 0;
        let lightMins = 0;
        let remMins = 0;
        let awakeMins = 0;
        let awakeCount = 0;
        let hasStageData = false;

        // 1. Check Google Health v4 stagesSummary (e.g. Pixel Watch / Fitbit on Google Health v4)
        if (Array.isArray(sleepObj.summary?.stagesSummary) && sleepObj.summary.stagesSummary.length > 0) {
            hasStageData = true;
            for (const st of sleepObj.summary.stagesSummary) {
                const typeStr = String(st.type || st.stage || "").toUpperCase();
                const m = parseInt(String(st.minutes ?? st.durationMinutes ?? 0), 10);
                const validM = (!isNaN(m) && m > 0) ? m : 0;
                if (typeStr === "DEEP") deepMins += validM;
                else if (typeStr === "LIGHT") lightMins += validM;
                else if (typeStr === "REM") remMins += validM;
                else if (typeStr === "AWAKE") {
                    awakeMins += validM;
                    const cnt = parseInt(String(st.count ?? st.segmentCount ?? 0), 10);
                    if (!isNaN(cnt) && cnt > 0) awakeCount += cnt;
                }
            }
        }

        // 2. Check direct summary properties for any missing stages
        if (!deepMins) {
            deepMins = this.parseStageDurationValue(
                sleepObj.summary?.deepSleepMinutes ??
                sleepObj.summary?.minutesInDeepSleep ??
                sleepObj.summary?.stages?.deep?.minutes ??
                sleepObj.summary?.stages?.deep ??
                sleepObj.levels?.summary?.deep?.minutes ??
                sleepObj.stages?.deep?.minutes ??
                sleepObj.stages?.deep ??
                sleepObj.deepSleepMinutes ??
                null
            );
        }
        if (!lightMins) {
            lightMins = this.parseStageDurationValue(
                sleepObj.summary?.lightSleepMinutes ??
                sleepObj.summary?.minutesInLightSleep ??
                sleepObj.summary?.stages?.light?.minutes ??
                sleepObj.summary?.stages?.light ??
                sleepObj.levels?.summary?.light?.minutes ??
                sleepObj.stages?.light?.minutes ??
                sleepObj.stages?.light ??
                sleepObj.lightSleepMinutes ??
                null
            );
        }
        if (!remMins) {
            remMins = this.parseStageDurationValue(
                sleepObj.summary?.remSleepMinutes ??
                sleepObj.summary?.minutesInRemSleep ??
                sleepObj.summary?.stages?.rem?.minutes ??
                sleepObj.summary?.stages?.rem ??
                sleepObj.levels?.summary?.rem?.minutes ??
                sleepObj.stages?.rem?.minutes ??
                sleepObj.stages?.rem ??
                sleepObj.remSleepMinutes ??
                null
            );
        }
        if (!awakeMins) {
            awakeMins = this.parseStageDurationValue(
                sleepObj.summary?.minutesAwake ??
                sleepObj.summary?.awakeMinutes ??
                sleepObj.summary?.stages?.awake?.minutes ??
                sleepObj.summary?.stages?.awake ??
                sleepObj.levels?.summary?.awake?.minutes ??
                sleepObj.stages?.awake?.minutes ??
                sleepObj.stages?.awake ??
                sleepObj.awakeMinutes ??
                null
            );
        }
        if (!awakeCount) {
            const directCount = parseInt(String(
                sleepObj.summary?.awakeCount ??
                sleepObj.summary?.interruptions ??
                sleepObj.levels?.summary?.awake?.count ??
                ""
            ), 10);
            if (!isNaN(directCount) && directCount > 0) {
                awakeCount = directCount;
                hasStageData = true;
            }
        }

        // 3. Fallback: Aggregate from stages / segments array for any unpopulated stage metrics
        const stages = sleepObj.stages || sleepObj.segments || sleepObj.levels?.data || sleepObj.stagesList || [];
        if (Array.isArray(stages) && stages.length > 0) {
            hasStageData = true;
            let segDeep = 0;
            let segLight = 0;
            let segRem = 0;
            let segAwake = 0;
            let segAwakeCount = 0;

            for (const s of stages) {
                const st = String(s.type || s.stage || s.level || s.sleepStage || "").toUpperCase();
                let dur = 0;
                if (s.durationMinutes) {
                    dur = s.durationMinutes;
                } else if (s.minutes) {
                    dur = parseInt(s.minutes, 10) || 0;
                } else if (s.durationSeconds) {
                    dur = s.durationSeconds / 60;
                } else if (s.startTime && s.endTime) {
                    const diffMs = new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
                    if (!isNaN(diffMs) && diffMs > 0) dur = diffMs / 60000;
                }
                const roundedDur = Math.round(dur);
                if (st === "DEEP" || st === "STAGE_DEEP") segDeep += roundedDur;
                else if (st === "LIGHT" || st === "STAGE_LIGHT") segLight += roundedDur;
                else if (st === "REM" || st === "STAGE_REM") segRem += roundedDur;
                else if (st === "AWAKE" || st === "STAGE_AWAKE" || st === "WAKE") {
                    segAwake += roundedDur;
                    segAwakeCount++;
                }
            }

            if (!deepMins) deepMins = segDeep;
            if (!lightMins) lightMins = segLight;
            if (!remMins) remMins = segRem;
            if (!awakeMins) awakeMins = segAwake;
            if (!awakeCount) awakeCount = segAwakeCount;
        }

        if (!awakeCount && Array.isArray(sleepObj.shortAwakenings) && sleepObj.shortAwakenings.length > 0) {
            hasStageData = true;
            awakeCount = sleepObj.shortAwakenings.length;
        }

        return { deepMins, lightMins, remMins, awakeMins, awakeCount, hasStageData };
    }

    private parseSleepPayload(data: any): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        if (!points || points.length === 0) return {};

        // Sort descending by end time
        points.sort((a: any, b: any) => {
            const timeA = a.sleep?.interval?.endTime || a.interval?.endTime || a.endTime || "";
            const timeB = b.sleep?.interval?.endTime || b.interval?.endTime || b.endTime || "";
            return timeB.localeCompare(timeA);
        });

        const main = points[0];
        const sleepObj = main.sleep || main;
        const mins = parseInt(sleepObj.summary?.minutesAsleep || sleepObj.minutesAsleep || 0);

        if (mins > 0) {
            const sleepStr = this.formatMinutesAsHm(mins);

            const wakeTimeIso = sleepObj.interval?.endTime || main.interval?.endTime || "";
            let wakeStr = "";
            if (wakeTimeIso) {
                const wakeDate = new Date(wakeTimeIso);
                wakeStr = `${wakeDate.getHours()}:${String(wakeDate.getMinutes()).padStart(2, '0')}`;
            }

            const targetKey = this.settings.healthSyncConfig?.sleep?.key || "Sleep_hours";
            const results: Record<string, any> = {
                [targetKey]: sleepStr
            };
            if (wakeStr) results["wake_up"] = wakeStr;
            if (sleepObj.sleepScore || main.sleepScore) {
                results["Sleep_score"] = sleepObj.sleepScore || main.sleepScore;
            }

            const stages = this.extractSleepStageMetrics(sleepObj);

            if (stages.deepMins > 0 && this.settings.healthSyncConfig?.deep_sleep?.enabled !== false) {
                const deepKey = this.settings.healthSyncConfig?.deep_sleep?.key || "Deep_sleep";
                results[deepKey] = this.formatMinutesAsHm(stages.deepMins);
            }

            if (this.isOptInMetricEnabled("light_sleep") && stages.lightMins > 0) {
                const lightKey = this.settings.healthSyncConfig?.light_sleep?.key || "Light_sleep";
                results[lightKey] = this.formatMinutesAsHm(stages.lightMins);
            }

            if (this.isOptInMetricEnabled("rem_sleep") && stages.remMins > 0) {
                const remKey = this.settings.healthSyncConfig?.rem_sleep?.key || "REM_sleep";
                results[remKey] = this.formatMinutesAsHm(stages.remMins);
            }

            if (this.isOptInMetricEnabled("awake_sleep") && stages.awakeMins > 0) {
                const awakeKey = this.settings.healthSyncConfig?.awake_sleep?.key || "Awake_sleep";
                results[awakeKey] = this.formatMinutesAsHm(stages.awakeMins);
            }

            if (this.isOptInMetricEnabled("sleep_interruptions") && (stages.awakeCount > 0 || stages.hasStageData)) {
                const intKey = this.settings.healthSyncConfig?.sleep_interruptions?.key || "sleep_interruptions";
                results[intKey] = stages.awakeCount;
            }

            return results;
        }

        return {};
    }

    private parseVitalsPayload(data: any, targetDateStr: string): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        if (!points || points.length === 0) return {};

        for (const p of points) {
            const hrvObj = p.dailyHeartRateVariability || p;
            let pDateStr = "";
            if (hrvObj.date?.year && hrvObj.date?.month && hrvObj.date?.day) {
                pDateStr = `${hrvObj.date.year}-${String(hrvObj.date.month).padStart(2, '0')}-${String(hrvObj.date.day).padStart(2, '0')}`;
            }

            if (pDateStr === targetDateStr) {
                const rawVal = hrvObj.averageHeartRateVariabilityMilliseconds ?? 
                               hrvObj.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds ?? 
                               hrvObj.dailyRmssd ?? 
                               hrvObj.rmssd;
                const hrvNum = parseFloat(String(rawVal || 0));
                if (!isNaN(hrvNum) && hrvNum > 0) {
                    const targetKey = this.settings.healthSyncConfig?.hrv?.key || "HRV";
                    return { [targetKey]: Math.round(hrvNum) };
                }
            }
        }
        return {};
    }

    private parseActivityPayload(data: any, dateStr: string): Record<string, any> {
        let totalSteps = 0;
        let totalActiveMinutes = 0;

        // 1. Process dailyRollUp data points if present
        const rollupPoints = data.rollupDataPoints || [];
        for (const rp of rollupPoints) {
            const rawCount = rp.steps?.countSum ?? rp.steps?.count ?? rp.countSum;
            if (rawCount !== undefined && rawCount !== null) {
                const count = parseInt(String(rawCount), 10);
                if (!isNaN(count) && count > 0) {
                    totalSteps = Math.max(totalSteps, count);
                }
            }
        }

        // 2. Process granular intraday data points
        const points = data.dataPoint || data.dataPoints || data.points || [];
        for (const p of points) {
            const stepObj = p.steps || p;
            const interval = stepObj.interval || p.interval;
            const matchesDate = !interval || this.isCivilDateMatch(interval, dateStr) || this.isSameLocalDate(interval?.startTime || "", dateStr);
            if (matchesDate) {
                const rawSteps = stepObj.count ?? stepObj.stepCount ?? stepObj.countSum ?? p.count ?? p.stepCount;
                if (rawSteps !== undefined && rawSteps !== null) {
                    const steps = parseInt(String(rawSteps), 10);
                    if (!isNaN(steps) && steps > 0) totalSteps += steps;
                }
            }
            if (p.activeZoneMinutes) {
                const azm = p.activeZoneMinutes;
                const azmInterval = azm.interval || p.interval;
                if (!azmInterval || this.isCivilDateMatch(azmInterval, dateStr) || this.isSameLocalDate(azmInterval?.startTime || "", dateStr)) {
                    const mins = parseInt(String(azm.activeZoneMinutes || azm.totalMinutes || azm.minutes || azm.count || 0), 10);
                    if (!isNaN(mins) && mins > 0) totalActiveMinutes += mins;
                }
            }
        }

        const out: Record<string, any> = {};
        if (totalSteps > 0) {
            const key = this.settings.healthSyncConfig?.steps?.key || "steps";
            out[key] = totalSteps;
        }
        if (totalActiveMinutes > 0) {
            const key = this.settings.healthSyncConfig?.active_minutes?.key || "active_minutes";
            out[key] = totalActiveMinutes;
        }
        return out;
    }

    private parseActiveZoneMinutesPayload(data: any, dateStr: string): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let totalActiveMinutes = 0;

        for (const p of points) {
            const azm = p.activeZoneMinutes || p.activeMinutes || p;
            const interval = azm.interval || p.interval;
            if (!interval || this.isCivilDateMatch(interval, dateStr) || this.isSameLocalDate(interval.startTime || "", dateStr)) {
                const rawVal = azm.activeZoneMinutes ?? azm.totalMinutes ?? azm.minutes ?? azm.count ?? p.value;
                const mins = parseInt(String(rawVal || 0), 10);
                if (!isNaN(mins) && mins > 0) {
                    totalActiveMinutes += mins;
                }
            }
        }

        if (totalActiveMinutes > 0) {
            const key = this.settings.healthSyncConfig?.active_minutes?.key || "active_minutes";
            return { [key]: totalActiveMinutes };
        }
        return {};
    }

    private parseExercisePayload(data: any, dateStr: string): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        
        interface RawExercise {
            type: string;
            start: number;
            end: number;
        }

        const validSessions: RawExercise[] = [];
        for (const p of points) {
            const ex = p.exercise || p;
            const interval = ex.interval || p.interval;
            if (interval && (this.isCivilDateMatch(interval, dateStr) || this.isSameLocalDate(interval.startTime || "", dateStr))) {
                const rawType = String(ex.exerciseType || ex.type || "").toUpperCase();
                if (rawType === "MEDITATE" || rawType === "MINDFULNESS") continue;

                const type = ex.exerciseType || ex.type || "Workout";
                const start = new Date(interval.startTime).getTime();
                const end = new Date(interval.endTime).getTime();
                const durationMins = Math.round((end - start) / (1000 * 60));
                
                const formattedType = String(type)
                    .replace(/_/g, ' ')
                    .toLowerCase()
                    .replace(/\b\w/g, l => l.toUpperCase());

                if (durationMins > 0 && !isNaN(start) && !isNaN(end)) {
                    validSessions.push({ type: formattedType, start, end });
                }
            }
        }

        if (validSessions.length === 0) return {};

        // Convert to ParsedWorkout list and deduplicate using robust timestamp and fuzzy rules
        const parsedList: ParsedWorkout[] = validSessions.map(s => {
            const dur = Math.round((s.end - s.start) / (1000 * 60));
            return {
                title: s.type,
                durationMins: dur,
                startTime: new Date(s.start).toISOString(),
                endTime: new Date(s.end).toISOString()
            };
        });

        const dedupedWorkoutsList = deduplicateWorkouts(parsedList);

        const out: Record<string, any> = {};
        let meditationMinutes = 0;
        for (const s of dedupedWorkoutsList) {
            const lower = s.title.toLowerCase();
            if (lower === "meditate" || lower.includes("meditat") || lower.includes("mindful")) {
                meditationMinutes += s.durationMins;
            }
        }

        const summaries = dedupedWorkoutsList
            .filter(w => w.title && !/^(?:meditate|mindful)/i.test(w.title))
            .map(w => w.durationMins > 0 ? `${w.title} (${w.durationMins}m)` : w.title);

        if (summaries.length > 0) {
            const key = this.settings.healthSyncConfig?.exercise?.key || "workout";
            out[key] = summaries.join(", ");
        }

        if (meditationMinutes > 0) {
            const mindKey = this.settings.healthSyncConfig?.mindfulness?.key || "mindfulness_minutes";
            out[mindKey] = meditationMinutes;
        }

        return out;
    }

    private parseNutritionPayload(data: any, dateStr: string): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let totalCalories = 0;
        let totalProtein = 0;
        let totalCaffeineMg = 0;
        let totalAlcoholGrams = 0;

        for (const p of points) {
            const log = p.nutritionLog || p;
            const interval = log.interval || p.interval;
            const timeStr = interval?.startTime || p.startTime || "";
            if (!this.isCivilDateMatch(interval, dateStr) && (timeStr && !this.isSameLocalDate(timeStr, dateStr))) {
                continue;
            }

            if (log.energy?.kcal) totalCalories += log.energy.kcal;
            
            const declaredAlcohol = this.declaredAlcoholGrams(log.foodDisplayName || log.foodName || log.name || '');
            let itemHasAlcohol = declaredAlcohol !== undefined;
            if (declaredAlcohol !== undefined) totalAlcoholGrams += declaredAlcohol;
            if (Array.isArray(log.nutrients)) {
                for (const n of log.nutrients) {
                    if (n.nutrient === 'PROTEIN' && n.quantity?.grams) {
                        totalProtein += n.quantity.grams;
                    }
                    if (n.nutrient === 'CAFFEINE' && n.quantity?.grams) {
                        totalCaffeineMg += (n.quantity.grams * 1000);
                    }
                    if (declaredAlcohol === undefined && (n.nutrient === 'ALCOHOL' || n.nutrient === 'ALCOHOL_GRAMS' || n.nutrient === 'ETHANOL') && n.quantity?.grams) {
                        totalAlcoholGrams += n.quantity.grams;
                        itemHasAlcohol = true;
                    }
                }
            }

            const foodName = (log.foodDisplayName || log.foodName || log.name || "").toLowerCase();
            if (!itemHasAlcohol && ALCOHOL_BEVERAGE_REGEX.test(foodName)) {
                if (log.energy?.kcal && log.energy.kcal > 0) {
                    // ~7 kcal per gram of pure alcohol (1 standard drink = ~14g alcohol = ~98 kcal)
                    totalAlcoholGrams += (log.energy.kcal / 7.0);
                } else {
                    totalAlcoholGrams += 14;
                }
            }
        }

        const out: Record<string, any> = {};
        if (totalCalories > 0) {
            const key = this.settings.healthSyncConfig?.calories?.key || "calories";
            out[key] = Math.round(totalCalories);
        }
        if (totalProtein > 0) {
            const key = this.settings.healthSyncConfig?.protein?.key || "protein";
            out[key] = Math.round(totalProtein);
        }
        if (totalCaffeineMg > 0) {
            const key = this.settings.healthSyncConfig?.caffeine?.key || "caffeine";
            out[key] = Math.round(totalCaffeineMg);
        }
        if (totalAlcoholGrams > 0) {
            const key = this.settings.healthSyncConfig?.alcohol?.key || "alcohol";
            out[key] = Math.round(totalAlcoholGrams);
        }
        return out;
    }

    private parseHydrationPayload(data: any, dateStr: string): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let totalMl = 0;

        for (const p of points) {
            const log = p.hydrationLog || p;
            const interval = log.interval || p.interval;
            // Use civilStartTime for reliable date matching
            if (this.isCivilDateMatch(interval, dateStr) || this.isSameLocalDate(interval?.startTime || "", dateStr)) {
                const ml = log.amountConsumed?.milliliters || log.volume?.milliliters;
                if (typeof ml === 'number') totalMl += ml;
            }
        }

        const out: Record<string, any> = {};
        if (totalMl > 0) {
            // Convert mL to Fluid Ounces (fl oz): 1 fl oz = 29.5735 mL
            const totalFlOz = Math.round(totalMl / 29.5735);
            const key = this.settings.healthSyncConfig?.hydration?.key || "hydration";
            out[key] = totalFlOz;
        }
        return out;
    }

    private parseMindfulnessPayload(data: any, dateStr: string): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let totalMinutes = 0;

        for (const p of points) {
            const session = p.mindfulness || p.mindfulnessSession || p;
            const interval = session.interval || p.interval;
            if (interval && (this.isCivilDateMatch(interval, dateStr) || this.isSameLocalDate(interval.startTime || "", dateStr))) {
                let durationMins = 0;
                if (session.durationMinutes) {
                    durationMins = session.durationMinutes;
                } else if (session.durationSeconds) {
                    durationMins = session.durationSeconds / 60;
                } else if (interval.startTime && interval.endTime) {
                    const startMs = new Date(interval.startTime).getTime();
                    const endMs = new Date(interval.endTime).getTime();
                    if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
                        durationMins = (endMs - startMs) / 60000;
                    }
                }
                if (durationMins > 0) {
                    totalMinutes += durationMins;
                }
            }
        }

        if (totalMinutes > 0) {
            const rounded = Math.round(totalMinutes);
            const key = this.settings.healthSyncConfig?.mindfulness?.key || "mindfulness_minutes";
            return { [key]: rounded };
        }
        return {};
    }
}
