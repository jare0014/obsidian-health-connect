import { App, Platform } from "obsidian";

export const DEVICE_ID_STORAGE_KEY = "health-connect-device-id";

export interface AutoSyncOwnershipSettings {
    autoSyncOnStartup?: boolean;
    googleHealthSyncStyle?: "manual" | "automatic" | string;
    autoSyncOwnerDeviceId?: string;
    autoSyncOwnerLabel?: string;
}

const fallbackDeviceIds = new WeakMap<object, string>();

function generateDeviceId(): string {
    const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
        return cryptoObj.randomUUID();
    }
    return `hc-dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Derive a human-friendly device label from Obsidian's Platform flags.
 * Mobile checks run before desktop checks because Platform.isMacOS can be true on iOS.
 */
export function getDevicePlatformLabel(platform: Partial<typeof Platform> = Platform): string {
    if (platform.isAndroidApp) return "Mobile (Android)";
    if (platform.isIosApp) return "Mobile (iOS)";
    if (platform.isMobileApp || platform.isMobile) return "Mobile";
    if (platform.isWin) return "Desktop (Windows)";
    if (platform.isMacOS) return "Desktop (macOS)";
    if (platform.isLinux) return "Desktop (Linux)";
    if (platform.isDesktopApp || platform.isDesktop) return "Desktop";
    return "This Device";
}

/**
 * Retrieve the persistent per-device ID stored in Obsidian's local storage
 * (or generate and persist a new one on first run).
 */
export function getOrCreateDeviceId(app?: Partial<App> | null): string {
    const anyApp = app as (Partial<App> & {
        loadLocalStorage?: (key: string) => unknown;
        saveLocalStorage?: (key: string, data: unknown | null) => void;
    }) | null | undefined;

    if (anyApp && typeof anyApp.loadLocalStorage === "function") {
        const existing = anyApp.loadLocalStorage(DEVICE_ID_STORAGE_KEY);
        if (typeof existing === "string" && existing.trim().length > 0) {
            return existing.trim();
        }
        const created = generateDeviceId();
        if (typeof anyApp.saveLocalStorage === "function") {
            anyApp.saveLocalStorage(DEVICE_ID_STORAGE_KEY, created);
        }
        return created;
    }

    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
        try {
            const existing = storage.getItem(DEVICE_ID_STORAGE_KEY);
            if (typeof existing === "string" && existing.trim().length > 0) {
                return existing.trim();
            }
            const created = generateDeviceId();
            storage.setItem(DEVICE_ID_STORAGE_KEY, created);
            return created;
        } catch {
            // Fall through to in-memory WeakMap fallback when web storage is restricted.
        }
    }

    if (app && typeof app === "object") {
        const existing = fallbackDeviceIds.get(app);
        if (existing) return existing;
        const created = generateDeviceId();
        fallbackDeviceIds.set(app, created);
        return created;
    }

    return generateDeviceId();
}

export function isAnyAutoSyncEnabled(settings: AutoSyncOwnershipSettings): boolean {
    return Boolean(settings.autoSyncOnStartup || settings.googleHealthSyncStyle === "automatic");
}

export function isCurrentDeviceAutoSyncOwner(
    settings: AutoSyncOwnershipSettings,
    deviceId: string
): boolean {
    const ownerId = settings.autoSyncOwnerDeviceId?.trim();
    return Boolean(deviceId && ownerId && ownerId === deviceId);
}

export function isOwnedByAnotherDevice(
    settings: AutoSyncOwnershipSettings,
    deviceId: string
): boolean {
    const ownerId = settings.autoSyncOwnerDeviceId?.trim();
    return Boolean(isAnyAutoSyncEnabled(settings) && ownerId && ownerId !== deviceId);
}

export function getAutoSyncOwnerDisplayLabel(settings: AutoSyncOwnershipSettings): string {
    return settings.autoSyncOwnerLabel?.trim() || "another device";
}

export function claimAutoSyncOwnership(
    settings: AutoSyncOwnershipSettings,
    deviceId: string,
    deviceLabel: string
): boolean {
    const changed = settings.autoSyncOwnerDeviceId !== deviceId || settings.autoSyncOwnerLabel !== deviceLabel;
    settings.autoSyncOwnerDeviceId = deviceId;
    settings.autoSyncOwnerLabel = deviceLabel;
    return changed;
}

/**
 * Upgrade migration: if auto-sync (startup or periodic) is already enabled
 * and no owner device ID is recorded yet, claim ownership for the current device.
 */
export function migrateAutoSyncOwnership(
    settings: AutoSyncOwnershipSettings,
    deviceId: string,
    deviceLabel: string
): boolean {
    if (isAnyAutoSyncEnabled(settings) && !settings.autoSyncOwnerDeviceId?.trim()) {
        settings.autoSyncOwnerDeviceId = deviceId;
        settings.autoSyncOwnerLabel = deviceLabel;
        return true;
    }
    return false;
}
