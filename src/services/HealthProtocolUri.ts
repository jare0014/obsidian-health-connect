import type { HealthHubCategory, HealthHubTab } from "../views/HealthHubModal";

export type HealthProtocolParseResult =
    | {
        ok: true;
        action: "hub";
        tab: HealthHubTab;
        category: HealthHubCategory;
    }
    | {
        ok: false;
        error: string;
    };

const VALID_HUB_ACTIONS = new Set([
    "",
    "health-connect",
    "health-connect-hub",
    "hub",
    "open-hub",
    "activity-hub",
]);

const TAB_ALIASES: Record<string, HealthHubTab> = {
    "": "log",
    "log": "log",
    "add": "log",
    "add-to-log": "log",
    "history": "history",
    "view-history": "history",
    "registry": "registry",
    "manage": "registry",
    "manage-registry": "registry",
};

const CATEGORY_ALIASES: Record<string, HealthHubCategory> = {
    "": "nutrition",
    "nutrition": "nutrition",
    "food": "nutrition",
    "drink": "nutrition",
    "beverage": "nutrition",
    "hydration": "nutrition",
    "caffeine": "nutrition",
    "alcohol": "nutrition",
    "workout": "workout",
    "workouts": "workout",
    "exercise": "workout",
    "fitness": "workout",
    "mindfulness": "mindfulness",
    "meditation": "mindfulness",
    "mindful": "mindfulness",
    "sleep": "sleep",
    "readiness": "sleep",
};

/**
 * Parses `obsidian://health-connect` and `obsidian://health-connect-hub` protocol parameters
 * into validated Activity Hub navigation targets.
 */
export function parseHealthProtocolUri(
    params: Record<string, string | undefined>
): HealthProtocolParseResult {
    const rawAction = (params.view || params.subaction || params.action || "").trim().toLowerCase();
    if (!VALID_HUB_ACTIONS.has(rawAction)) {
        return {
            ok: false,
            error: `Unsupported Health Connect URI action: "${rawAction}"`,
        };
    }

    const rawTab = (params.tab || "").trim().toLowerCase();
    const tab = TAB_ALIASES[rawTab];
    if (!tab) {
        return {
            ok: false,
            error: `Unsupported Activity Hub tab: "${params.tab}"`,
        };
    }

    const rawCategory = (params.category || "").trim().toLowerCase();
    const category = CATEGORY_ALIASES[rawCategory];
    if (!category) {
        return {
            ok: false,
            error: `Unsupported Activity Hub category: "${params.category}"`,
        };
    }

    return {
        ok: true,
        action: "hub",
        tab,
        category,
    };
}
