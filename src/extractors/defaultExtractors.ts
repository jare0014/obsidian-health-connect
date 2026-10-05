import { TFile } from "obsidian";

/**
 * Default metric extractor stub for public release.
 * Returns null so HealthDashboardProcessor falls back to standard
 * frontmatter, inline Dataview fields, and formula metrics.
 */
export function localExtractMetric(file: TFile, key: string, content: string, fm?: Record<string, any>): any | null {
    return null;
}
