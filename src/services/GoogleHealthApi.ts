import { GoogleAuthService } from "./GoogleAuthService";
import { SleepData, VitalData, NutritionData } from "../models/HealthTypes";

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

        const startTimeNanos = (startOfDay.getTime() - 43200000) * 1000000; // Lookback 12h into previous evening for sleep
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

    private async fetchSleepSessions(token: string, start: Date, end: Date): Promise<SleepData | undefined> {
        const startTimeStr = new Date(start.getTime() - 43200000).toISOString();
        const endTimeStr = end.toISOString();

        const url = `https://www.googleapis.com/fitness/v1/users/me/sessions?startTime=${startTimeStr}&endTime=${endTimeStr}&activityType=72`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return undefined;

        const data = await res.json();
        const sessions = data.session || [];
        if (sessions.length === 0) return undefined;

        // Find longest sleep session
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
            sleepScore: Math.min(100, Math.max(50, Math.round(totalMinutes / 4.8))) // Heuristic if device doesn't supply raw score
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
                                    if (k === 'caffeine') caffeine += (v * 1000); // g to mg
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
