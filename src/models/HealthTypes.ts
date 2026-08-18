/**
 * HealthTypes.ts - Data structures and interfaces for Health Connect & Readiness
 */

export interface SleepData {
    sleepHours: string;     // e.g. "7:24"
    sleepMinutes: number;   // e.g. 444
    wakeUpTime: string;     // e.g. "05:45"
    sleepScore?: number;    // e.g. 82
}

export interface VitalData {
    hrv: number;            // e.g. 42 (RMSSD ms)
    restingHeartRate?: number;
    readinessScore?: number; // e.g. 78
}

export interface NutritionData {
    caffeineMg: number;     // e.g. 200
    alcoholMg: number;      // e.g. 0
    hydrationFlOz: number;  // e.g. 64
    calories: number;       // e.g. 2100
    proteinG: number;       // e.g. 120
}

export interface DailyHealthSnapshot {
    date: string;           // "YYYY-MM-DD"
    sleep?: SleepData;
    vitals?: VitalData;
    nutrition?: NutritionData;
    customFields?: Record<string, any>;
}

export interface DashboardCardConfig {
    key: string;
    label: string;
    unit: string;
    color: string;
    chartType: 'line' | 'bar';
}

export interface HealthPluginSettings {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    tokens: {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
    };
    dailyNotesFolder: string;
    fieldMappings: {
        sleepHoursKey: string;
        wakeUpKey: string;
        hrvKey: string;
        sleepScoreKey: string;
        readinessKey: string;
        caffeineKey: string;
        alcoholKey: string;
        hydrationKey: string;
    };
    dashboardDays: number;
    excludeWeekends: boolean;
    autoSyncOnStartup: boolean;
}

export const DEFAULT_SETTINGS: HealthPluginSettings = {
    clientId: "",
    clientSecret: "",
    redirectUri: "http://localhost:8092",
    tokens: {},
    dailyNotesFolder: "02_Journal/01_Daily",
    fieldMappings: {
        sleepHoursKey: "Sleep_hours",
        wakeUpKey: "wake_up",
        hrvKey: "HRV",
        sleepScoreKey: "Sleep_score",
        readinessKey: "Readiness",
        caffeineKey: "caffeine",
        alcoholKey: "alcohol",
        hydrationKey: "hydration"
    },
    dashboardDays: 14,
    excludeWeekends: false,
    autoSyncOnStartup: false
};
