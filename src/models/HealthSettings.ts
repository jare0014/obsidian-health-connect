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

export interface CalculatedMetric {
    id: string;
    key: string;
    label: string;
    formula: string; // e.g. "(protein * 4) + (carbs * 4) + (fat * 9)"
    unit: string;
    agg: 'average' | 'sum' | 'diff' | 'last';
    chartType: 'line' | 'bar' | 'none';
    color: string;
    chartGroup?: string;
    showTile?: boolean;
    writeToNote: boolean; // if true, writes computed value to daily note frontmatter
}

export interface MetricSyncDef {
    enabled: boolean;
    destination: 'frontmatter' | 'inline' | 'append';
    key: string;
    syncStyle?: 'manual' | 'automatic';
    syncInterval?: number;
}

export interface BiometricCatalogEntry {
    key: string;
    label: string;
    defaultKey: string;
    category: 'core' | 'sleep_stage' | 'vitals_body';
    source: 'google_health' | 'frontmatter_only';
    cloudDataType?: string;
    requiredScope?: string;
    scopeHint: string;
}

export const BIOMETRIC_CATALOG: BiometricCatalogEntry[] = [
    // Core metrics
    {
        key: "sleep",
        label: "Sleep Hours (Duration)",
        defaultKey: "Sleep_hours",
        category: "core",
        source: "google_health",
        cloudDataType: "sleep",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
        scopeHint: "googlehealth.sleep.readonly"
    },
    {
        key: "deep_sleep",
        label: "Deep Sleep (Duration)",
        defaultKey: "Deep_sleep",
        category: "core",
        source: "google_health",
        cloudDataType: "sleep",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
        scopeHint: "googlehealth.sleep.readonly"
    },
    {
        key: "hrv",
        label: "Heart Rate Variability (HRV ms)",
        defaultKey: "HRV",
        category: "core",
        source: "google_health",
        cloudDataType: "daily-heart-rate-variability",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        scopeHint: "googlehealth.health_metrics_and_measurements.readonly"
    },
    {
        key: "steps",
        label: "Steps (Daily Total)",
        defaultKey: "steps",
        category: "core",
        source: "google_health",
        cloudDataType: "steps",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
        scopeHint: "googlehealth.activity_and_fitness.readonly"
    },
    {
        key: "active_minutes",
        label: "Active Zone Minutes",
        defaultKey: "active_minutes",
        category: "core",
        source: "google_health",
        cloudDataType: "active-zone-minutes",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
        scopeHint: "googlehealth.activity_and_fitness.readonly"
    },
    {
        key: "exercise",
        label: "Workouts / Exercise Sessions",
        defaultKey: "workout",
        category: "core",
        source: "google_health",
        cloudDataType: "exercise",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
        scopeHint: "googlehealth.activity_and_fitness.readonly"
    },
    {
        key: "caffeine",
        label: "Caffeine (mg)",
        defaultKey: "caffeine",
        category: "core",
        source: "google_health",
        cloudDataType: "nutrition-log",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
        scopeHint: "googlehealth.nutrition.readonly"
    },
    {
        key: "alcohol",
        label: "Alcohol (g)",
        defaultKey: "alcohol",
        category: "core",
        source: "google_health",
        cloudDataType: "nutrition-log",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
        scopeHint: "googlehealth.nutrition.readonly (via nutrition-log)"
    },
    {
        key: "hydration",
        label: "Hydration / Water (fl oz)",
        defaultKey: "hydration",
        category: "core",
        source: "google_health",
        cloudDataType: "hydration-log",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
        scopeHint: "googlehealth.nutrition.readonly"
    },
    {
        key: "protein",
        label: "Protein (g)",
        defaultKey: "protein",
        category: "core",
        source: "google_health",
        cloudDataType: "nutrition-log",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
        scopeHint: "googlehealth.nutrition.readonly"
    },
    {
        key: "calories",
        label: "Calories (kcal)",
        defaultKey: "calories",
        category: "core",
        source: "google_health",
        cloudDataType: "nutrition-log",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
        scopeHint: "googlehealth.nutrition.readonly"
    },
    {
        key: "nutrition",
        label: "Nutrition Log Summary",
        defaultKey: "Nutrition",
        category: "core",
        source: "google_health",
        cloudDataType: "nutrition-log",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
        scopeHint: "googlehealth.nutrition.readonly"
    },
    {
        key: "mindfulness",
        label: "Mindfulness / Meditation (min)",
        defaultKey: "mindfulness_minutes",
        category: "core",
        source: "google_health",
        cloudDataType: "exercise",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.mindfulness.readonly",
        scopeHint: "googlehealth.mindfulness.readonly / Focus Log"
    },

    // Sleep stage extras (parsed from existing sleep stagesSummary / stages)
    {
        key: "light_sleep",
        label: "Light Sleep (Duration)",
        defaultKey: "Light_sleep",
        category: "sleep_stage",
        source: "google_health",
        cloudDataType: "sleep",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
        scopeHint: "googlehealth.sleep.readonly (parsed from sleep stages)"
    },
    {
        key: "rem_sleep",
        label: "REM Sleep (Duration)",
        defaultKey: "REM_sleep",
        category: "sleep_stage",
        source: "google_health",
        cloudDataType: "sleep",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
        scopeHint: "googlehealth.sleep.readonly (parsed from sleep stages)"
    },
    {
        key: "awake_sleep",
        label: "Awake During Sleep (Duration)",
        defaultKey: "Awake_sleep",
        category: "sleep_stage",
        source: "google_health",
        cloudDataType: "sleep",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
        scopeHint: "googlehealth.sleep.readonly (parsed from sleep stages)"
    },
    {
        key: "sleep_interruptions",
        label: "Sleep Interruptions (Awake Segments)",
        defaultKey: "sleep_interruptions",
        category: "sleep_stage",
        source: "google_health",
        cloudDataType: "sleep",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
        scopeHint: "googlehealth.sleep.readonly (parsed from sleep stages)"
    },

    // Opt-in vitals & body metrics
    {
        key: "resting_heart_rate",
        label: "Resting Heart Rate (bpm)",
        defaultKey: "resting_heart_rate",
        category: "vitals_body",
        source: "google_health",
        cloudDataType: "daily-resting-heart-rate",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        scopeHint: "googlehealth.health_metrics_and_measurements.readonly"
    },
    {
        key: "blood_oxygen",
        label: "Blood Oxygen / SpO2 (%)",
        defaultKey: "spo2",
        category: "vitals_body",
        source: "google_health",
        cloudDataType: "daily-oxygen-saturation",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        scopeHint: "googlehealth.health_metrics_and_measurements.readonly"
    },
    {
        key: "respiratory_rate",
        label: "Respiratory Rate (breaths/min)",
        defaultKey: "respiratory_rate",
        category: "vitals_body",
        source: "google_health",
        cloudDataType: "daily-respiratory-rate",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        scopeHint: "googlehealth.health_metrics_and_measurements.readonly"
    },
    {
        key: "weight",
        label: "Weight (lbs)",
        defaultKey: "weight",
        category: "vitals_body",
        source: "google_health",
        cloudDataType: "weight",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        scopeHint: "googlehealth.health_metrics_and_measurements.readonly"
    },
    {
        key: "body_fat",
        label: "Body Fat (%)",
        defaultKey: "body_fat",
        category: "vitals_body",
        source: "google_health",
        cloudDataType: "body-fat",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        scopeHint: "googlehealth.health_metrics_and_measurements.readonly"
    },
    {
        key: "blood_pressure",
        label: "Blood Pressure (mmHg)",
        defaultKey: "blood_pressure",
        category: "vitals_body",
        source: "frontmatter_only",
        scopeHint: "Frontmatter / Apple Health only (not in Google Health v4 API)"
    },
    {
        key: "blood_glucose",
        label: "Blood Glucose (mg/dL)",
        defaultKey: "blood_glucose",
        category: "vitals_body",
        source: "google_health",
        cloudDataType: "blood-glucose",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        scopeHint: "googlehealth.health_metrics_and_measurements.readonly"
    },
    {
        key: "body_temperature",
        label: "Body Temperature (°C)",
        defaultKey: "body_temperature",
        category: "vitals_body",
        source: "google_health",
        cloudDataType: "core-body-temperature",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        scopeHint: "googlehealth.health_metrics_and_measurements.readonly"
    },
    {
        key: "basal_metabolic_rate",
        label: "Basal Metabolic Rate (BMR kcal)",
        defaultKey: "bmr",
        category: "vitals_body",
        source: "google_health",
        cloudDataType: "basal-energy-burned",
        requiredScope: "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
        scopeHint: "googlehealth.activity_and_fitness.readonly"
    }
];

/** Return catalog entries not yet present in healthSyncConfig. */
export function getUnmappedBiometrics(
    healthSyncConfig?: Record<string, MetricSyncDef>
): BiometricCatalogEntry[] {
    const mapped = healthSyncConfig || {};
    return BIOMETRIC_CATALOG.filter(entry => !Object.prototype.hasOwnProperty.call(mapped, entry.key));
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

export interface WorkoutItem {
    id: string;
    name: string;
    category: 'walking' | 'running' | 'strength' | 'cardio' | 'flexibility' | 'other';
    googleHealthType: string;
    defaultDurationMins: number;
}

export interface MindfulnessItem {
    id: string;
    name: string;
    category: 'meditation' | 'breathwork' | 'bodyscan' | 'other';
    defaultDurationMins: number;
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
    dailyNoteTemplate?: string;
    googleHealthSyncStyle: 'manual' | 'automatic';
    googleHealthSyncInterval: number;
    autoSyncOnStartup: boolean;
    enableBidirectionalWorkouts: boolean;
    enableBidirectionalMindfulness: boolean;
    requestedScopes: string[];
    healthSyncConfig: Record<string, MetricSyncDef>;
    foodRegistry: FoodItem[];
    workoutRegistry: WorkoutItem[];
    mindfulnessRegistry: MindfulnessItem[];
    dashboardDateRange: number;
    dashboardExcludeWeekends: boolean;
    dashboardCards: DashboardCard[];
    calculatedMetrics: CalculatedMetric[];
    // Apple Health / iOS Shortcuts Ingestion
    enableAppleHealthIngest: boolean;
    appleHealthDropFolder: string;
    appleHealthAutoArchive: boolean;
    appleHealthArchiveFolder: string;
    customAvailableKeys?: string[];
    blacklistedKeys?: string[];
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

export const DEFAULT_WORKOUT_ITEMS: WorkoutItem[] = [
    { id: "workout", name: "Workout", category: "other", googleHealthType: "OTHER", defaultDurationMins: 30 },
    { id: "walking", name: "Walking", category: "walking", googleHealthType: "WALKING", defaultDurationMins: 30 },
    { id: "strength_training", name: "Strength Training", category: "strength", googleHealthType: "STRENGTH_TRAINING", defaultDurationMins: 45 },
    { id: "running", name: "Running", category: "running", googleHealthType: "RUNNING", defaultDurationMins: 30 },
    { id: "cycling", name: "Cycling", category: "cardio", googleHealthType: "BIKING", defaultDurationMins: 30 },
    { id: "yoga", name: "Yoga", category: "flexibility", googleHealthType: "YOGA", defaultDurationMins: 30 },
    { id: "stretching", name: "Stretching", category: "flexibility", googleHealthType: "STRETCHING", defaultDurationMins: 15 },
    { id: "calisthenics", name: "Calisthenics", category: "strength", googleHealthType: "CALISTHENICS", defaultDurationMins: 30 },
    { id: "swimming", name: "Swimming", category: "cardio", googleHealthType: "SWIMMING", defaultDurationMins: 30 },
    { id: "pilates", name: "Pilates", category: "flexibility", googleHealthType: "PILATES", defaultDurationMins: 30 }
];

export const DEFAULT_MINDFULNESS_ITEMS: MindfulnessItem[] = [
    { id: "meditation", name: "Meditation", category: "meditation", defaultDurationMins: 15 },
    { id: "breathwork", name: "Breathwork", category: "breathwork", defaultDurationMins: 10 },
    { id: "body_scan", name: "Body Scan", category: "bodyscan", defaultDurationMins: 20 },
    { id: "mindful_walking", name: "Mindful Walking", category: "meditation", defaultDurationMins: 15 }
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
    autoSyncOnStartup: false,
    enableBidirectionalWorkouts: true,
    enableBidirectionalMindfulness: false,
    requestedScopes: [
        "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
        "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
        "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly",
        "https://www.googleapis.com/auth/googlehealth.nutrition.readonly",
        "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
        "https://www.googleapis.com/auth/googlehealth.mindfulness.readonly"
    ],
    healthSyncConfig: {
        sleep: { enabled: true, destination: "frontmatter", key: "Sleep_hours", syncStyle: "manual", syncInterval: 60 },
        deep_sleep: { enabled: true, destination: "frontmatter", key: "Deep_sleep", syncStyle: "manual", syncInterval: 60 },
        hrv: { enabled: true, destination: "frontmatter", key: "HRV", syncStyle: "manual", syncInterval: 60 },
        steps: { enabled: true, destination: "frontmatter", key: "steps", syncStyle: "manual", syncInterval: 60 },
        active_minutes: { enabled: true, destination: "frontmatter", key: "active_minutes", syncStyle: "manual", syncInterval: 60 },
        exercise: { enabled: true, destination: "frontmatter", key: "workout", syncStyle: "manual", syncInterval: 60 },
        caffeine: { enabled: true, destination: "frontmatter", key: "caffeine", syncStyle: "manual", syncInterval: 60 },
        alcohol: { enabled: true, destination: "frontmatter", key: "alcohol", syncStyle: "manual", syncInterval: 60 },
        hydration: { enabled: true, destination: "frontmatter", key: "hydration", syncStyle: "manual", syncInterval: 60 },
        protein: { enabled: true, destination: "frontmatter", key: "protein", syncStyle: "manual", syncInterval: 60 },
        calories: { enabled: true, destination: "frontmatter", key: "calories", syncStyle: "manual", syncInterval: 60 },
        nutrition: { enabled: true, destination: "frontmatter", key: "Nutrition", syncStyle: "manual", syncInterval: 60 },
        mindfulness: { enabled: true, destination: "frontmatter", key: "mindfulness_minutes", syncStyle: "manual", syncInterval: 60 },
        respiratory_rate: { enabled: false, destination: "frontmatter", key: "respiratory_rate", syncStyle: "manual", syncInterval: 60 },
        body_temperature: { enabled: false, destination: "frontmatter", key: "body_temperature", syncStyle: "manual", syncInterval: 60 },
        basal_metabolic_rate: { enabled: false, destination: "frontmatter", key: "bmr", syncStyle: "manual", syncInterval: 60 },
        blood_oxygen: { enabled: false, destination: "frontmatter", key: "spo2", syncStyle: "manual", syncInterval: 60 },
        blood_glucose: { enabled: false, destination: "frontmatter", key: "blood_glucose", syncStyle: "manual", syncInterval: 60 },
        blood_pressure: { enabled: false, destination: "frontmatter", key: "blood_pressure", syncStyle: "manual", syncInterval: 60 }
    },
    foodRegistry: DEFAULT_FOOD_ITEMS,
    workoutRegistry: DEFAULT_WORKOUT_ITEMS,
    mindfulnessRegistry: DEFAULT_MINDFULNESS_ITEMS,
    dashboardDateRange: 14,
    dashboardExcludeWeekends: false,
    dashboardCards: [
        { key: "Sleep_score", label: "Sleep Score", unit: "", agg: "average", chartType: "line", color: "#6366f1", chartGroup: "Health", showTile: true, excludeWeekends: false },
        { key: "Sleep_hours", label: "Sleep Hours", unit: "hrs", agg: "average", chartType: "line", color: "#10b981", chartGroup: "Health", showTile: true, excludeWeekends: false },
        { key: "Deep_sleep", label: "Deep Sleep", unit: "hrs", agg: "average", chartType: "line", color: "#38bdf8", chartGroup: "Health", showTile: true, excludeWeekends: false },
        { key: "Readiness", label: "Readiness", unit: "", agg: "average", chartType: "line", color: "#ec4899", chartGroup: "Health", showTile: true, excludeWeekends: false },
        { key: "HRV", label: "HRV", unit: "ms", agg: "average", chartType: "line", color: "#f59e0b", chartGroup: "Health", showTile: true, excludeWeekends: false },
        { key: "steps", label: "Steps", unit: "steps", agg: "sum", chartType: "bar", color: "#3b82f6", chartGroup: "Activity", showTile: true, excludeWeekends: false }
    ],
    calculatedMetrics: [],
    enableAppleHealthIngest: false,
    appleHealthDropFolder: "00_Imports/Health",
    appleHealthAutoArchive: true,
    appleHealthArchiveFolder: "00_Imports/Health/Archive"
};
