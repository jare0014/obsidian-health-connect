import { GoogleAuthService } from "./GoogleAuthService";
import { SleepData, VitalData, NutritionData, FoodItem } from "../models/HealthTypes";

export class GoogleHealthApi {
    private auth: GoogleAuthService;

    constructor(auth: GoogleAuthService) {
        this.auth = auth;
    }

    public async fetchDailyHealth(targetDate: Date): Promise<{ sleep?: SleepData; vitals?: VitalData; nutrition?: NutritionData }> {
        const token = await this.auth.getValidAccessToken();
        if (!token) throw new Error("Not authenticated with Google Health");

        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const startTimeNanos = (startOfDay.getTime() - 43200000) * 1000000; // 12h lookback for sleep
        const endTimeNanos = endOfDay.getTime() * 1000000;

        const [sleep, vitals, nutrition] = await Promise.allSettled([
            this.fetchSleepSessions(token, startOfDay, endOfDay),
            this.fetchHRVAndVitals(token, startTimeNanos, endTimeNanos),
            this.fetchNutritionAndHydration(token, startTimeNanos, endTimeNanos)
        ]);

        return {
            sleep: sleep.status === 'fulfilled' ? sleep.value : undefined,
            vitals: vitals.status === 'fulfilled' ? vitals.value : undefined,
            nutrition: nutrition.status === 'fulfilled' ? nutrition.value : undefined
        };
    }

    public async postFoodOrDrink(food: FoodItem, amount: number = 1.0): Promise<boolean> {
        const token = await this.auth.getValidAccessToken();
        if (!token) throw new Error("Not authenticated");

        const now = new Date();
        const startIso = new Date(now.getTime() - 60000).toISOString();
        const endIso = now.toISOString();

        const offsetMinutes = -now.getTimezoneOffset();
        const offsetSeconds = offsetMinutes * 60;
        const offsetStr = `${offsetSeconds}s`;

        const interval = {
            startTime: startIso,
            endTime: endIso,
            startUtcOffset: offsetStr,
            endUtcOffset: offsetStr
        };

        if (food.category === 'hydration' || food.waterMl) {
            const ml = (food.waterMl || 250) * amount;
            const payload = {
                hydrationLog: {
                    interval,
                    amountConsumed: {
                        milliliters: ml
                    }
                }
            };
            const url = "https://health.googleapis.com/v4/users/me/dataTypes/hydration-log/dataPoints";
            const res = await fetch(url, {
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
            const url = "https://health.googleapis.com/v4/users/me/dataTypes/alcohol-consumption/dataPoints";
            const res = await fetch(url, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            return res.ok || res.status === 201;
        } else {
            // General Nutrition / Caffeine / Protein / Calories
            const nutrientsList: any[] = [];
            if (food.caffeineMg) {
                nutrientsList.push({
                    nutrient: "CAFFEINE",
                    quantity: { grams: (food.caffeineMg / 1000) * amount }
                });
            }
            if (food.proteinG) {
                nutrientsList.push({
                    nutrient: "PROTEIN",
                    quantity: { grams: food.proteinG * amount }
                });
            }

            const nutritionLog: any = {
                interval,
                foodDisplayName: food.name,
                nutrients: nutrientsList,
                mealType: "SNACK"
            };

            if (food.calories) {
                nutritionLog.energy = {
                    kcal: food.calories * amount
                };
            }

            const payload = { nutritionLog };
            const url = "https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints";
            const res = await fetch(url, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            return res.ok || res.status === 201;
        }
    }

    private async fetchSleepSessions(token: string, start: Date, end: Date): Promise<SleepData | undefined> {
        const startTimeStr = new Date(start.getTime() - 43200000).toISOString();
        const endTimeStr = end.toISOString();

        const url = `https://www.googleapis.com/fitness/v1/users/me/sessions?startTime=${startTimeStr}&endTime=${endTimeStr}&activityType=72`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return undefined;

        const data = await res.json();
        const sessions = data.session || [];
        if (sessions.length === 0) return undefined;

        sessions.sort((a: any, b: any) => (parseInt(b.endTimeMillis) - parseInt(b.startTimeMillis)) - (parseInt(a.endTimeMillis) - parseInt(a.startTimeMillis)));
        const longest = sessions[0];

        const durationMs = parseInt(longest.endTimeMillis) - parseInt(longest.startTimeMillis);
        const totalMinutes = Math.round(durationMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const sleepHours = `${hours}:${String(mins).padStart(2, '0')}`;

        const wakeUpDate = new Date(parseInt(longest.endTimeMillis));
        const wakeUpTime = `${String(wakeUpDate.getHours()).padStart(2, '0')}:${String(wakeUpDate.getMinutes()).padStart(2, '0')}`;

        return {
            sleepHours,
            sleepMinutes: totalMinutes,
            wakeUpTime,
            sleepScore: Math.min(100, Math.max(50, Math.round(totalMinutes / 4.8)))
        };
    }

    private async fetchHRVAndVitals(token: string, startNanos: number, endNanos: number): Promise<VitalData | undefined> {
        const payload = {
            aggregateBy: [
                { dataTypeName: "com.google.heart_rate.variability.rmssd" },
                { dataTypeName: "com.google.heart_rate.bpm" }
            ],
            startTimeMillis: Math.floor(startNanos / 1000000),
            endTimeMillis: Math.floor(endNanos / 1000000)
        };

        const res = await fetch("https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) return undefined;
        const data = await res.json();
        
        let hrvValue = 0;
        let count = 0;

        for (const bucket of data.bucket || []) {
            for (const dataset of bucket.dataset || []) {
                for (const point of dataset.point || []) {
                    for (const val of point.value || []) {
                        if (typeof val.fpVal === 'number' && val.fpVal > 0) {
                            hrvValue += val.fpVal;
                            count++;
                        }
                    }
                }
            }
        }

        const avgHrv = count > 0 ? Math.round(hrvValue / count) : 0;
        const readiness = avgHrv > 0 ? Math.min(100, Math.max(40, Math.round((avgHrv / 65) * 85))) : undefined;

        return {
            hrv: avgHrv,
            readinessScore: readiness
        };
    }

    private async fetchNutritionAndHydration(token: string, startNanos: number, endNanos: number): Promise<NutritionData | undefined> {
        const payload = {
            aggregateBy: [
                { dataTypeName: "com.google.nutrition" },
                { dataTypeName: "com.google.hydration" }
            ],
            startTimeMillis: Math.floor(startNanos / 1000000),
            endTimeMillis: Math.floor(endNanos / 1000000)
        };

        const res = await fetch("https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!res.ok) return undefined;
        const data = await res.json();

        let caffeine = 0;
        let alcohol = 0;
        let calories = 0;
        let protein = 0;
        let hydrationLiters = 0;

        for (const bucket of data.bucket || []) {
            for (const dataset of bucket.dataset || []) {
                for (const point of dataset.point || []) {
                    if (point.dataTypeName === 'com.google.hydration') {
                        for (const val of point.value || []) {
                            if (val.fpVal) hydrationLiters += val.fpVal;
                        }
                    } else if (point.dataTypeName === 'com.google.nutrition') {
                        for (const val of point.value || []) {
                            if (val.mapVal) {
                                for (const item of val.mapVal) {
                                    const k = item.key;
                                    const v = item.value?.fpVal || 0;
                                    if (k === 'caffeine') caffeine += (v * 1000);
                                    if (k === 'alcohol') alcohol += (v * 1000);
                                    if (k === 'calories') calories += v;
                                    if (k === 'protein') protein += v;
                                }
                            }
                        }
                    }
                }
            }
        }

        const hydrationFlOz = Math.round(hydrationLiters * 33.814);

        return {
            caffeineMg: Math.round(caffeine),
            alcoholMg: Math.round(alcohol),
            hydrationFlOz,
            calories: Math.round(calories),
            proteinG: Math.round(protein)
        };
    }
}
