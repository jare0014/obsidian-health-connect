export interface DashboardCard {
    key: string;
    label: string;
    unit: string;
    agg: 'average' | 'sum' | 'last';
    chartType: 'line' | 'bar';
    color: string;
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
    nutritionFolder: string;
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
    requestedScopes: string[];
    dashboardDateRange: number;
    dashboardExcludeWeekends: boolean;
    dashboardCards: DashboardCard[];
    autoSyncOnStartup: boolean;
    syncFrequency: number;
}

export const DEFAULT_FOOD_ITEMS: FoodItem[] = [
    { id: "americano", name: "Americano", category: "caffeine", unit: "cup (12 oz)", defaultAmount: 1, caffeineMg: 150, calories: 5 },
    { id: "espresso", name: "Espresso", category: "caffeine", unit: "shot", defaultAmount: 1, caffeineMg: 75, calories: 3 },
    { id: "protein_shake", name: "Protein Shake", category: "nutrition", unit: "serving", defaultAmount: 1, proteinG: 30, calories: 160 },
    { id: "protein_waffles", name: "Protein Waffles", category: "nutrition", unit: "serving", defaultAmount: 1, proteinG: 12, calories: 322 },
    { id: "water_cup", name: "Water (Cup)", category: "hydration", unit: "cup (12 oz)", defaultAmount: 1, waterMl: 355 },
    { id: "water_bottle", name: "Water (Bottle)", category: "hydration", unit: "bottle (16.9 oz)", defaultAmount: 1, waterMl: 500 },
    { id: "mixed_nuts", name: "Mixed Nuts", category: "nutrition", unit: "handful", defaultAmount: 1, proteinG: 6, calories: 198 }
];

export const DEFAULT_SETTINGS: HealthPluginSettings = {
    clientId: "",
    clientSecret: "",
    rawCredentialsJson: "",
    redirectUri: "http://localhost:8092",
    tokens: {},
    dailyNotesFolder: "02_Journal/01_Daily",
    nutritionFolder: "99_System/Omni_Templates",
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
    requestedScopes: [
        "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
        "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
        "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly"
    ],
    dashboardDateRange: 14,
    dashboardExcludeWeekends: true,
    dashboardCards: [
        { key: "Sleep_score", label: "Sleep Score", unit: "", agg: "average", chartType: "line", color: "#6366f1" },
        { key: "Sleep_hours", label: "Sleep Hours", unit: "hrs", agg: "average", chartType: "line", color: "#10b981" },
        { key: "Readiness", label: "Readiness", unit: "", agg: "average", chartType: "line", color: "#ec4899" },
        { key: "HRV", label: "HRV", unit: "ms", agg: "average", chartType: "line", color: "#f59e0b" }
    ],
    autoSyncOnStartup: false,
    syncFrequency: 60
};
