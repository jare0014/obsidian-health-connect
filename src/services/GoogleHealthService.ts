import { Notice } from "obsidian";
import { HealthPluginSettings, FoodItem } from "../models/HealthSettings";
import { GoogleOAuthService } from "./GoogleOAuthService";

export class GoogleHealthService {
    private settings: HealthPluginSettings;
    private oauth: GoogleOAuthService;

    constructor(settings: HealthPluginSettings, oauth: GoogleOAuthService) {
        this.settings = settings;
        this.oauth = oauth;
    }

    private async fetchWithTimeout(url: string, options: any = {}, timeoutMs: number = 4000): Promise<Response | null> {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            return res;
        } catch (e) {
            clearTimeout(id);
            console.warn(`[HealthService] Request to ${url} timed out or failed:`, e);
            return null;
        }
    }

    public async fetchDailyHealth(targetDate: Date = new Date()): Promise<Record<string, any>> {
        const token = await this.oauth.getAccessToken();
        if (!token) {
            new Notice("Please connect Google Health in settings first.");
            return {};
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
            const stepsUrl = `https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints`;
            const stepsRes = await this.fetchWithTimeout(stepsUrl, { headers });
            if (stepsRes && stepsRes.ok) {
                const data = await stepsRes.json();
                const actMetrics = this.parseActivityPayload(data, dateStr);
                Object.assign(results, actMetrics);
            }
        } catch (e) {
            console.error("Activity/Steps fetch error:", e);
        }

        try {
            // 3b. Google Health v4 Active Zone Minutes
            const azmUrl = `https://health.googleapis.com/v4/users/me/dataTypes/active-zone-minutes/dataPoints`;
            const azmRes = await this.fetchWithTimeout(azmUrl, { headers });
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
            const exerciseUrl = `https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints`;
            const exerciseRes = await this.fetchWithTimeout(exerciseUrl, { headers });
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
            const nutUrl = `https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints`;
            const nutRes = await this.fetchWithTimeout(nutUrl, { headers });
            if (nutRes && nutRes.ok) {
                const data = await nutRes.json();
                const nutMetrics = this.parseNutritionPayload(data, dateStr);
                Object.assign(results, nutMetrics);
            }
        } catch (e) {
            console.error("Nutrition fetch error:", e);
        }

        try {
            // 6. Google Health v4 Alcohol
            const alcUrl = `https://health.googleapis.com/v4/users/me/dataTypes/alcohol-consumption/dataPoints`;
            const alcRes = await this.fetchWithTimeout(alcUrl, { headers });
            if (alcRes && alcRes.ok) {
                const data = await alcRes.json();
                const alcMetrics = this.parseAlcoholPayload(data, dateStr);
                Object.assign(results, alcMetrics);
            }
        } catch (e) {
            console.error("Alcohol fetch error:", e);
        }

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

        return results;
    }

    public async postFoodOrDrink(food: FoodItem, amount: number = 1.0): Promise<boolean> {
        const token = await this.oauth.getAccessToken();
        if (!token) return false;

        const now = new Date();
        const startIso = new Date(now.getTime() - 60000).toISOString();
        const endIso = now.toISOString();

        const offsetSeconds = -now.getTimezoneOffset() * 60;
        const interval = {
            startTime: startIso,
            endTime: endIso,
            startUtcOffset: `${offsetSeconds}s`,
            endUtcOffset: `${offsetSeconds}s`
        };

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
                const res = await fetch("https://health.googleapis.com/v4/users/me/dataTypes/hydration-log/dataPoints", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                return res.ok || res.status === 201;
            } else if (food.category === 'alcohol' || food.alcoholMg) {
                const alcoholGrams = ((food.alcoholMg || 14000) / 1000) * amount;
                const payload = {
                    alcoholConsumption: {
                        interval,
                        amount: alcoholGrams
                    }
                };
                const res = await fetch("https://health.googleapis.com/v4/users/me/dataTypes/alcohol-consumption/dataPoints", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                return res.ok || res.status === 201;
            } else {
                const nutrientsList: any[] = [];
                if (food.caffeineMg) {
                    nutrientsList.push({ nutrient: "CAFFEINE", quantity: { grams: (food.caffeineMg / 1000) * amount } });
                }
                if (food.proteinG) {
                    nutrientsList.push({ nutrient: "PROTEIN", quantity: { grams: food.proteinG * amount } });
                }

                const nutritionLog: any = {
                    interval,
                    foodDisplayName: food.name,
                    nutrients: nutrientsList,
                    mealType: "SNACK"
                };

                if (food.calories) {
                    nutritionLog.energy = { kcal: food.calories * amount };
                }

                const res = await fetch("https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ nutritionLog })
                });
                return res.ok || res.status === 201;
            }
        } catch (e) {
            console.error("Food post error:", e);
            return false;
        }
    }

    public async deleteHealthDataPoint(dataType: string, dataPointId: string): Promise<boolean> {
        const token = await this.oauth.getAccessToken();
        if (!token) return false;

        try {
            const url = `https://health.googleapis.com/v4/users/me/dataTypes/${encodeURIComponent(dataType)}/dataPoints/${encodeURIComponent(dataPointId)}`;
            const res = await fetch(url, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.ok || res.status === 204;
        } catch (e) {
            console.error(`Failed to delete data point ${dataPointId} from ${dataType}:`, e);
            return false;
        }
    }

    public async fetchLoggedFoodHistory(targetDate: Date = new Date()): Promise<Array<{
        id: string;
        dataType: string;
        name: string;
        category: string;
        time: string;
        details: string;
    }>> {
        const token = await this.oauth.getAccessToken();
        if (!token) return [];

        const year = targetDate.getFullYear();
        const month = String(targetDate.getMonth() + 1).padStart(2, '0');
        const day = String(targetDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        const headers = { Authorization: `Bearer ${token}` };
        const history: Array<{
            id: string;
            dataType: string;
            name: string;
            category: string;
            time: string;
            details: string;
        }> = [];

        // 1. Nutrition logs
        try {
            const res = await fetch("https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints", { headers });
            if (res.ok) {
                const data = await res.json();
                const points = data.dataPoint || data.dataPoints || data.points || [];
                for (const p of points) {
                    const log = p.nutritionLog || p;
                    const interval = log.interval || p.interval;
                    const startTime = interval?.startTime || p.startTime || "";
                    if (this.isCivilDateMatch(interval, dateStr) || (startTime && this.isSameLocalDate(startTime, dateStr))) {
                        const d = new Date(startTime);
                        const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
                        const name = log.foodDisplayName || log.foodName || log.name || "Food Item";
                        
                        const detailParts: string[] = [];
                        if (log.energy?.kcal) detailParts.push(`${Math.round(log.energy.kcal)} kcal`);
                        let isAlc = false;
                        if (Array.isArray(log.nutrients)) {
                            for (const n of log.nutrients) {
                                if (n.nutrient === 'PROTEIN' && n.quantity?.grams) detailParts.push(`${Math.round(n.quantity.grams)}g protein`);
                                if (n.nutrient === 'CAFFEINE' && n.quantity?.grams) detailParts.push(`${Math.round(n.quantity.grams * 1000)}mg caff`);
                                if ((n.nutrient === 'ALCOHOL' || n.nutrient === 'ALCOHOL_GRAMS' || n.nutrient === 'ETHANOL') && n.quantity?.grams) {
                                    detailParts.push(`${Math.round(n.quantity.grams)}g alcohol`);
                                    isAlc = true;
                                }
                            }
                        }
                        if (!isAlc && /(?:bourbon|whiskey|whisky|beer|wine|vodka|rum|tequila|gin|cocktail|ipa|lager|ale|stout|cider|scotch|brandy|sake|mezcal)/i.test(name)) {
                            isAlc = true;
                            if (log.energy?.kcal) detailParts.push(`~${Math.round(log.energy.kcal / 7)}g alcohol`);
                        }

                        history.push({
                            id: p.name || p.id || p.dataPointId || startTime,
                            dataType: "nutrition-log",
                            name,
                            category: isAlc ? "alcohol" : "nutrition",
                            time: timeStr,
                            details: detailParts.join(", ") || "Logged"
                        });
                    }
                }
            }
        } catch (e) {}

        // 2. Hydration logs
        try {
            const res = await fetch("https://health.googleapis.com/v4/users/me/dataTypes/hydration-log/dataPoints", { headers });
            if (res.ok) {
                const data = await res.json();
                const points = data.dataPoint || data.dataPoints || data.points || [];
                for (const p of points) {
                    const log = p.hydrationLog || p;
                    const interval = log.interval || p.interval;
                    const startTime = interval?.startTime || p.startTime || "";
                    if (this.isCivilDateMatch(interval, dateStr) || (startTime && this.isSameLocalDate(startTime, dateStr))) {
                        const d = new Date(startTime);
                        const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
                        const ml = log.amountConsumed?.milliliters || log.volume?.milliliters || 0;
                        const flOz = Math.round(ml / 29.5735);

                        history.push({
                            id: p.name || p.id || p.dataPointId || startTime,
                            dataType: "hydration-log",
                            name: "Water / Hydration",
                            category: "hydration",
                            time: timeStr,
                            details: `${flOz} fl oz (${Math.round(ml)} mL)`
                        });
                    }
                }
            }
        } catch (e) {}

        // 3. Alcohol logs
        try {
            const res = await fetch("https://health.googleapis.com/v4/users/me/dataTypes/alcohol-consumption/dataPoints", { headers });
            if (res.ok) {
                const data = await res.json();
                const points = data.dataPoint || data.dataPoints || data.points || [];
                for (const p of points) {
                    const log = p.alcoholConsumption || p;
                    const interval = log.interval || p.interval;
                    const startTime = interval?.startTime || p.startTime || "";
                    if (this.isCivilDateMatch(interval, dateStr) || (startTime && this.isSameLocalDate(startTime, dateStr))) {
                        const d = new Date(startTime);
                        const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
                        const amount = log.amount ?? log.alcoholConsumed?.grams ?? 0;

                        history.push({
                            id: p.name || p.id || p.dataPointId || startTime,
                            dataType: "alcohol-consumption",
                            name: "Alcohol Consumption",
                            category: "alcohol",
                            time: timeStr,
                            details: `${Math.round(amount)}g alcohol`
                        });
                    }
                }
            }
        } catch (e) {}

        // Sort descending by time
        history.sort((a, b) => b.time.localeCompare(a.time));
        return history;
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
            const hrs = Math.floor(mins / 60);
            const remMins = mins % 60;
            const sleepStr = `${hrs}:${String(remMins).padStart(2, '0')}`;

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
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let totalSteps = 0;
        let totalActiveMinutes = 0;

        for (const p of points) {
            if (p.steps && (this.isCivilDateMatch(p.steps.interval, dateStr) || this.isSameLocalDate(p.steps.interval?.startTime || "", dateStr))) {
                const steps = parseInt(String(p.steps.count || p.steps.stepCount || 0), 10);
                if (!isNaN(steps)) totalSteps += steps;
            }
            if (p.activeZoneMinutes) {
                const azm = p.activeZoneMinutes;
                if (this.isCivilDateMatch(azm.interval, dateStr) || this.isSameLocalDate(azm.interval?.startTime || "", dateStr)) {
                    const mins = parseInt(String(azm.activeZoneMinutes || azm.totalMinutes || 0), 10);
                    if (!isNaN(mins)) totalActiveMinutes += mins;
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
            if (interval && (this.isCivilDateMatch(interval, dateStr) || this.isSameLocalDate(interval.startTime || "", dateStr))) {
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
        const summaries: string[] = [];

        for (const p of points) {
            const ex = p.exercise || p;
            const interval = ex.interval || p.interval;
            if (interval && (this.isCivilDateMatch(interval, dateStr) || this.isSameLocalDate(interval.startTime || "", dateStr))) {
                const type = ex.exerciseType || ex.type || "Workout";
                const start = new Date(interval.startTime).getTime();
                const end = new Date(interval.endTime).getTime();
                const durationMins = Math.round((end - start) / (1000 * 60));
                
                // Format type name nicely (e.g. "STRENGTH_TRAINING" -> "Strength Training")
                const formattedType = String(type)
                    .replace(/_/g, ' ')
                    .toLowerCase()
                    .replace(/\b\w/g, l => l.toUpperCase());

                if (durationMins > 0) {
                    summaries.push(`${formattedType} (${durationMins}m)`);
                }
            }
        }

        if (summaries.length > 0) {
            const key = this.settings.healthSyncConfig?.exercise?.key || "workout";
            return { [key]: summaries.join(", ") };
        }
        return {};
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
            
            let itemHasAlcohol = false;
            if (Array.isArray(log.nutrients)) {
                for (const n of log.nutrients) {
                    if (n.nutrient === 'PROTEIN' && n.quantity?.grams) {
                        totalProtein += n.quantity.grams;
                    }
                    if (n.nutrient === 'CAFFEINE' && n.quantity?.grams) {
                        totalCaffeineMg += (n.quantity.grams * 1000);
                    }
                    if ((n.nutrient === 'ALCOHOL' || n.nutrient === 'ALCOHOL_GRAMS' || n.nutrient === 'ETHANOL') && n.quantity?.grams) {
                        totalAlcoholGrams += n.quantity.grams;
                        itemHasAlcohol = true;
                    }
                }
            }

            const foodName = (log.foodDisplayName || log.foodName || log.name || "").toLowerCase();
            if (!itemHasAlcohol && /(?:bourbon|whiskey|whisky|beer|wine|vodka|rum|tequila|gin|cocktail|ipa|lager|ale|stout|cider|scotch|brandy|sake|mezcal)/i.test(foodName)) {
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

    private parseAlcoholPayload(data: any, dateStr: string): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let totalGrams = 0;

        for (const p of points) {
            const log = p.alcoholConsumption || p;
            const interval = log.interval || p.interval;
            const timeStr = interval?.startTime || p.startTime || "";
            if (!this.isCivilDateMatch(interval, dateStr) && (timeStr && !this.isSameLocalDate(timeStr, dateStr))) {
                continue;
            }

            const amount = log.amount ?? log.alcoholConsumed?.grams ?? log.grams ?? 0;
            if (typeof amount === 'number') totalGrams += amount;
        }

        if (totalGrams > 0) {
            const key = this.settings.healthSyncConfig?.alcohol?.key || "alcohol";
            return { [key]: Math.round(totalGrams) };
        }
        return {};
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
}
