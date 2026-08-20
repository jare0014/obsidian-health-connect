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

export interface FoodItem {
    id: string;
    name: string;
    category: 'caffeine' | 'hydration' | 'nutrition' | 'alcohol';
    unit: string;
    defaultAmount: number;
    caffeineMg?: number;
    alcoholMg?: number;
    waterMl?: number;
    calories?: number;
    proteinG?: number;
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
    rawCredentialsJson: string;
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
        caloriesKey: string;
        proteinKey: string;
    };
    foodRegistry: FoodItem[];
    dashboardDays: number;
    excludeWeekends: boolean;
    autoSyncOnStartup: boolean;
}

export const DEFAULT_FOOD_ITEMS: FoodItem[] = [
    {
        id: "americano",
        name: "Americano",
        category: "caffeine",
        unit: "cup (12 oz)",
        defaultAmount: 1,
        caffeineMg: 150,
        calories: 5
    },
    {
        id: "espresso",
        name: "Espresso",
        category: "caffeine",
        unit: "shot",
        defaultAmount: 1,
        caffeineMg: 75,
        calories: 3
    },
    {
        id: "protein_shake",
        name: "Protein Shake",
        category: "nutrition",
        unit: "serving",
        defaultAmount: 1,
        proteinG: 30,
        calories: 160
    },
    {
        id: "protein_waffles",
        name: "Protein Waffles",
        category: "nutrition",
        unit: "serving",
        defaultAmount: 1,
        proteinG: 12,
        calories: 322
    },
    {
        id: "water_cup",
        name: "Water (Cup)",
        category: "hydration",
        unit: "cup (12 oz)",
        defaultAmount: 1,
        waterMl: 355
    },
    {
        id: "water_bottle",
        name: "Water (Bottle)",
        category: "hydration",
        unit: "bottle (16.9 oz)",
        defaultAmount: 1,
        waterMl: 500
    },
    {
        id: "mixed_nuts",
        name: "Mixed Nuts",
        category: "nutrition",
        unit: "handful",
        defaultAmount: 1,
        proteinG: 6,
        calories: 198
    }
];

export const DEFAULT_SETTINGS: HealthPluginSettings = {
    clientId: "",
    clientSecret: "",
    rawCredentialsJson: "",
    redirectUri: "http://localhost:8092",
    tokens: {},
    dailyNotesFolder: "",
    fieldMappings: {
        sleepHoursKey: "Sleep_hours",
        wakeUpKey: "wake_up",
        hrvKey: "HRV",
        sleepScoreKey: "Sleep_score",
        readinessKey: "Readiness",
        caffeineKey: "caffeine",
        alcoholKey: "alcohol",
        hydrationKey: "hydration",
        caloriesKey: "calories",
        proteinKey: "protein"
    },
    foodRegistry: DEFAULT_FOOD_ITEMS,
    dashboardDays: 14,
    excludeWeekends: false,
    autoSyncOnStartup: false
};
