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
            const hrvFilter = `daily_heart_rate_variability.date >= "${dateStr}" AND daily_heart_rate_variability.date < "${nextDateStr}"`;
            const hrvUrl = `https://health.googleapis.com/v4/users/me/dataTypes/daily-heart-rate-variability/dataPoints?filter=${encodeURIComponent(hrvFilter)}`;
            const hrvRes = await this.fetchWithTimeout(hrvUrl, { headers });
            if (hrvRes && hrvRes.ok) {
                const data = await hrvRes.json();
                const vitalsMetrics = this.parseVitalsPayload(data);
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
            // 4. Google Health v4 Exercise Sessions
            const exerciseUrl = `https://health.googleapis.com/v4/users/me/dataTypes/exercise-session/dataPoints`;
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
                    const startTime = log.interval?.startTime || p.interval?.startTime || p.startTime || "";
                    if (startTime && this.isSameLocalDate(startTime, dateStr)) {
                        const d = new Date(startTime);
                        const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
                        const name = log.foodDisplayName || log.foodName || log.name || "Food Item";
                        
                        const detailParts: string[] = [];
                        if (log.energy?.kcal) detailParts.push(`${Math.round(log.energy.kcal)} kcal`);
                        if (Array.isArray(log.nutrients)) {
                            for (const n of log.nutrients) {
                                if (n.nutrient === 'PROTEIN' && n.quantity?.grams) detailParts.push(`${Math.round(n.quantity.grams)}g protein`);
                                if (n.nutrient === 'CAFFEINE' && n.quantity?.grams) detailParts.push(`${Math.round(n.quantity.grams * 1000)}mg caff`);
                            }
                        }

                        history.push({
                            id: p.name || p.id || p.dataPointId || startTime,
                            dataType: "nutrition-log",
                            name,
                            category: "nutrition",
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
                    const startTime = log.interval?.startTime || p.interval?.startTime || p.startTime || "";
                    if (startTime && this.isSameLocalDate(startTime, dateStr)) {
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
                    const startTime = log.interval?.startTime || p.interval?.startTime || p.startTime || "";
                    if (startTime && this.isSameLocalDate(startTime, dateStr)) {
                        const d = new Date(startTime);
                        const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
                        const amount = log.amount || 0;

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

    private parseSleepPayload(data: any): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        if (!points || points.length === 0) return {};

        // Sort descending by end time
        points.sort((a: any, b: any) => {
            const endA = (a.sleep?.interval?.endTime || a.interval?.endTime || a.endTime || "");
            const endB = (b.sleep?.interval?.endTime || b.interval?.endTime || b.endTime || "");
            return endB.localeCompare(endA);
        });

        const main = points[0];
        const sleepObj = main.sleep || main;
        const totalMins = parseInt(sleepObj.summary?.minutesAsleep || sleepObj.minutesAsleep || 0);

        if (totalMins > 0) {
            const hours = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            const sleepStr = `${hours}:${String(mins).padStart(2, '0')}`;

            const endIso = sleepObj.interval?.endTime || main.interval?.endTime || "";
            let wakeStr = "";
            if (endIso) {
                const d = new Date(endIso);
                wakeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
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

    private parseVitalsPayload(data: any): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        if (!points || points.length === 0) return {};

        for (const p of points) {
            const hrvObj = p.dailyHeartRateVariability || p;
            const hrvVal = hrvObj.dailyRmssd || hrvObj.averageRmssd || hrvObj.rmssd || p.rmssd;
            if (typeof hrvVal === 'number' && hrvVal > 0) {
                const targetKey = this.settings.healthSyncConfig?.hrv?.key || "HRV";
                return { [targetKey]: Math.round(hrvVal) };
            }
        }
        return {};
    }

    private parseActivityPayload(data: any, dateStr: string): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let totalSteps = 0;
        let totalActiveMins = 0;

        for (const p of points) {
            const timeStr = p.interval?.startTime || p.startTime || p.interval?.endTime || p.endTime || "";
            if (timeStr && !this.isSameLocalDate(timeStr, dateStr)) {
                continue;
            }

            const steps = p.steps?.stepCount || p.stepCount || p.count;
            if (typeof steps === 'number') totalSteps += steps;

            const mins = p.activeMinutes || p.activeZoneMinutes;
            if (typeof mins === 'number') totalActiveMins += mins;
        }

        const out: Record<string, any> = {};
        if (totalSteps > 0) {
            const key = this.settings.healthSyncConfig?.steps?.key || "steps";
            out[key] = totalSteps;
        }
        if (totalActiveMins > 0) {
            const key = this.settings.healthSyncConfig?.active_minutes?.key || "active_minutes";
            out[key] = totalActiveMins;
        }
        return out;
    }

    private parseExercisePayload(data: any, dateStr: string): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        const summaries: string[] = [];

        for (const p of points) {
            const timeStr = p.exerciseSession?.interval?.startTime || p.interval?.startTime || p.startTime || "";
            if (timeStr && !this.isSameLocalDate(timeStr, dateStr)) {
                continue;
            }

            const exType = p.exerciseSession?.exerciseType || p.exerciseType || p.type || "Workout";
            const start = new Date(p.exerciseSession?.interval?.startTime || p.interval?.startTime || p.startTime).getTime();
            const end = new Date(p.exerciseSession?.interval?.endTime || p.interval?.endTime || p.endTime).getTime();
            const durationMins = Math.round((end - start) / 60000);
            
            const name = String(exType).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
            if (durationMins > 0) {
                summaries.push(`${name} (${durationMins}m)`);
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

        for (const p of points) {
            const log = p.nutritionLog || p;
            const timeStr = log.interval?.startTime || p.interval?.startTime || p.startTime || "";
            if (timeStr && !this.isSameLocalDate(timeStr, dateStr)) {
                continue;
            }

            if (log.energy?.kcal) totalCalories += log.energy.kcal;
            if (Array.isArray(log.nutrients)) {
                for (const n of log.nutrients) {
                    if (n.nutrient === 'PROTEIN' && n.quantity?.grams) {
                        totalProtein += n.quantity.grams;
                    }
                    if (n.nutrient === 'CAFFEINE' && n.quantity?.grams) {
                        // Caffeine in Google Health is stored in grams, convert to mg
                        totalCaffeineMg += (n.quantity.grams * 1000);
                    }
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
        return out;
    }

    private parseAlcoholPayload(data: any, dateStr: string): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let totalGrams = 0;

        for (const p of points) {
            const log = p.alcoholConsumption || p;
            const timeStr = log.interval?.startTime || p.interval?.startTime || p.startTime || "";
            if (timeStr && !this.isSameLocalDate(timeStr, dateStr)) {
                continue;
            }

            const amount = log.amount;
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
            const timeStr = log.interval?.startTime || p.interval?.startTime || p.startTime || "";
            if (timeStr && !this.isSameLocalDate(timeStr, dateStr)) {
                continue;
            }

            const ml = log.amountConsumed?.milliliters || log.volume?.milliliters;
            if (typeof ml === 'number') totalMl += ml;
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
