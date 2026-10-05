import { TFile } from "obsidian";

/**
 * Default metric extractor stub for public release.
 * Returns null so HealthDashboardProcessor falls back to standard
 * frontmatter, inline Dataview fields, and formula metrics.
 */
export function localExtractMetric(file: TFile, key: string, content: string, fm?: Record<string, any>): any | null {
    return null;
}

/**
 * Default workout reconciliation hook for public release.
 * Returns synced data unchanged without inspecting proprietary vault task logs.
 */
export async function localReconcileWorkouts(file: TFile, data: Record<string, any>, app?: any): Promise<Record<string, any>> {
    return data;
}
