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

    public async fetchDailyHealth(targetDate: Date = new Date()): Promise<Record<string, any>> {
        const token = await this.oauth.getAccessToken();
        if (!token) {
            new Notice("Please connect Google Health in settings first.");
            return {};
        }

        const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
        const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);

        const startIso = new Date(startOfDay.getTime() - 43200000).toISOString(); // 12h lookback for sleep
        const endIso = endOfDay.toISOString();
        const startDayIso = startOfDay.toISOString();

        const results: Record<string, any> = {};

        try {
            // 1. Google Health v4 Sleep Sessions
            const sleepUrl = `https://health.googleapis.com/v4/users/me/dataTypes/sleep-session/dataPoints?startTime=${startIso}&endTime=${endIso}`;
            const sleepRes = await fetch(sleepUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (sleepRes.ok) {
                const data = await sleepRes.json();
                const sleepMetrics = this.parseSleepPayload(data);
                Object.assign(results, sleepMetrics);
            }
        } catch (e) {
            console.error("Sleep fetch error:", e);
        }

        try {
            // 2. Google Health v4 Vitals (HRV & RMSSD)
            const vitalsUrl = `https://health.googleapis.com/v4/users/me/dataTypes/health-metrics-and-measurements/dataPoints?startTime=${startIso}&endTime=${endIso}`;
            const vitalsRes = await fetch(vitalsUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (vitalsRes.ok) {
                const data = await vitalsRes.json();
                const vitalsMetrics = this.parseVitalsPayload(data);
                Object.assign(results, vitalsMetrics);
            }
        } catch (e) {
            console.error("Vitals fetch error:", e);
        }

        try {
            // 3. Google Health v4 Nutrition (Calories, Protein, Caffeine)
            const nutUrl = `https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints?startTime=${startDayIso}&endTime=${endIso}`;
            const nutRes = await fetch(nutUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (nutRes.ok) {
                const data = await nutRes.json();
                const nutMetrics = this.parseNutritionPayload(data);
                Object.assign(results, nutMetrics);
            }
        } catch (e) {
            console.error("Nutrition fetch error:", e);
        }

        try {
            // 4. Google Health v4 Hydration
            const hydUrl = `https://health.googleapis.com/v4/users/me/dataTypes/hydration-log/dataPoints?startTime=${startDayIso}&endTime=${endIso}`;
            const hydRes = await fetch(hydUrl, { headers: { Authorization: `Bearer ${token}` } });
            if (hydRes.ok) {
                const data = await hydRes.json();
                const hydMetrics = this.parseHydrationPayload(data);
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

    private parseSleepPayload(data: any): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let maxDurationMinutes = 0;
        let longestSession: any = null;

        for (const p of points) {
            const start = new Date(p.interval?.startTime || p.startTime).getTime();
            const end = new Date(p.interval?.endTime || p.endTime).getTime();
            const diffMins = (end - start) / 60000;
            if (diffMins > maxDurationMinutes) {
                maxDurationMinutes = diffMins;
                longestSession = p;
            }
        }

        if (longestSession) {
            const hours = Math.floor(maxDurationMinutes / 60);
            const mins = Math.round(maxDurationMinutes % 60);
            const sleepStr = `${hours}:${String(mins).padStart(2, '0')}`;
            const endDate = new Date(longestSession.interval?.endTime || longestSession.endTime);
            const wakeStr = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
            
            const results: Record<string, any> = {
                [this.settings.fieldMappings.sleepHoursKey]: sleepStr,
                [this.settings.fieldMappings.wakeUpKey]: wakeStr
            };
            
            if (longestSession.sleepScore || longestSession.score) {
                results[this.settings.fieldMappings.sleepScoreKey] = longestSession.sleepScore || longestSession.score;
            }
            
            return results;
        }
        return {};
    }

    private parseVitalsPayload(data: any): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let hrvSum = 0;
        let hrvCount = 0;

        for (const p of points) {
            const hrv = p.heartRateVariabilityRmssd || p.rmssd || p.heartRateVariability?.rmssd;
            if (typeof hrv === 'number' && hrv > 0) {
                hrvSum += hrv;
                hrvCount++;
            }
        }

        if (hrvCount > 0) {
            const avgHrv = Math.round(hrvSum / hrvCount);
            return {
                [this.settings.fieldMappings.hrvKey]: avgHrv
            };
        }
        return {};
    }

    private parseNutritionPayload(data: any): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let totalCalories = 0;
        let totalProtein = 0;
        let totalCaffeineMg = 0;

        for (const p of points) {
            const log = p.nutritionLog || p;
            if (log.energy?.kcal) totalCalories += log.energy.kcal;
            if (Array.isArray(log.nutrients)) {
                for (const n of log.nutrients) {
                    if (n.nutrient === 'PROTEIN' && n.quantity?.grams) {
                        totalProtein += n.quantity.grams;
                    }
                    if (n.nutrient === 'CAFFEINE' && n.quantity?.grams) {
                        totalCaffeineMg += (n.quantity.grams * 1000);
                    }
                }
            }
        }

        const out: Record<string, any> = {};
        if (totalCalories > 0) out[this.settings.fieldMappings.caloriesKey] = Math.round(totalCalories);
        if (totalProtein > 0) out[this.settings.fieldMappings.proteinKey] = Math.round(totalProtein);
        if (totalCaffeineMg > 0) out[this.settings.fieldMappings.caffeineKey] = Math.round(totalCaffeineMg);
        return out;
    }

    private parseHydrationPayload(data: any): Record<string, any> {
        const points = data.dataPoint || data.dataPoints || data.points || [];
        let totalMl = 0;

        for (const p of points) {
            const log = p.hydrationLog || p;
            const ml = log.amountConsumed?.milliliters || log.volume?.milliliters;
            if (typeof ml === 'number') totalMl += ml;
        }

        const out: Record<string, any> = {};
        if (totalMl > 0) {
            out[this.settings.fieldMappings.hydrationKey] = Math.round(totalMl);
        }
        return out;
    }
}
