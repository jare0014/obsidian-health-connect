export interface DashboardCard {
    key: string;
    label: string;
    unit: string;
    agg: 'average' | 'sum' | 'diff' | 'last';
    chartType: 'line' | 'bar' | 'none';
    color: string;
    chartGroup?: string;
    showTile?: boolean;
    excludeWeekends?: boolean;
}

export interface MetricSyncDef {
    enabled: boolean;
    destination: 'frontmatter' | 'inline' | 'append';
    key: string;
    syncStyle?: 'manual' | 'automatic';
    syncInterval?: number;
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
    googleHealthSyncStyle: 'manual' | 'automatic';
    googleHealthSyncInterval: number;
    requestedScopes: string[];
    healthSyncConfig: Record<string, MetricSyncDef>;
    foodRegistry: FoodItem[];
    dashboardDateRange: number;
    dashboardExcludeWeekends: boolean;
    dashboardCards: DashboardCard[];
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
    dailyNotesFolder: "",
    googleHealthSyncStyle: "manual",
    googleHealthSyncInterval: 60,
    requestedScopes: [
        "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
        "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
        "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
        "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly"
    ],
    healthSyncConfig: {
        sleep: { enabled: true, destination: "frontmatter", key: "Sleep_hours", syncStyle: "manual", syncInterval: 60 },
        hrv: { enabled: true, destination: "frontmatter", key: "HRV", syncStyle: "manual", syncInterval: 60 },
        steps: { enabled: true, destination: "frontmatter", key: "steps", syncStyle: "manual", syncInterval: 60 },
        active_minutes: { enabled: true, destination: "frontmatter", key: "active_minutes", syncStyle: "manual", syncInterval: 60 },
        exercise: { enabled: true, destination: "frontmatter", key: "workout", syncStyle: "manual", syncInterval: 60 },
        caffeine: { enabled: true, destination: "frontmatter", key: "caffeine", syncStyle: "manual", syncInterval: 60 },
        alcohol: { enabled: true, destination: "frontmatter", key: "alcohol", syncStyle: "manual", syncInterval: 60 },
        hydration: { enabled: true, destination: "frontmatter", key: "hydration", syncStyle: "manual", syncInterval: 60 },
        protein: { enabled: true, destination: "frontmatter", key: "protein", syncStyle: "manual", syncInterval: 60 },
        calories: { enabled: true, destination: "frontmatter", key: "calories", syncStyle: "manual", syncInterval: 60 },
        nutrition: { enabled: true, destination: "frontmatter", key: "Nutrition", syncStyle: "manual", syncInterval: 60 }
    },
    foodRegistry: DEFAULT_FOOD_ITEMS,
    dashboardDateRange: 14,
    dashboardExcludeWeekends: false,
    dashboardCards: [
        { key: "Sleep_score", label: "Sleep Score", unit: "", agg: "average", chartType: "line", color: "#6366f1", chartGroup: "Health", showTile: true, excludeWeekends: false },
        { key: "Sleep_hours", label: "Sleep Hours", unit: "hrs", agg: "average", chartType: "line", color: "#10b981", chartGroup: "Health", showTile: true, excludeWeekends: false },
        { key: "Readiness", label: "Readiness", unit: "", agg: "average", chartType: "line", color: "#ec4899", chartGroup: "Health", showTile: true, excludeWeekends: false },
        { key: "HRV", label: "HRV", unit: "ms", agg: "average", chartType: "line", color: "#f59e0b", chartGroup: "Health", showTile: true, excludeWeekends: false },
        { key: "steps", label: "Steps", unit: "steps", agg: "sum", chartType: "bar", color: "#3b82f6", chartGroup: "Activity", showTile: true, excludeWeekends: false }
    ]
};
