import { App, TFile } from "obsidian";
import { HealthPluginSettings } from "../models/HealthTypes";

export interface AggregatedMetric {
    key: string;
    label: string;
    unit: string;
    color: string;
    currentValue: number | string;
    averageValue: number;
    trendPercent: number;
    trendDirection: 'up' | 'down' | 'neutral';
    history: { date: string; value: number }[];
}

export class MetricsAggregator {
    private app: App;
    private settings: HealthPluginSettings;

    constructor(app: App, settings: HealthPluginSettings) {
        this.app = app;
        this.settings = settings;
    }

    public async aggregateMetrics(days: number = 14): Promise<AggregatedMetric[]> {
        const files = this.app.vault.getMarkdownFiles()
            .filter(f => /\d{4}-\d{2}-\d{2}/.test(f.basename))
            .sort((a, b) => b.basename.localeCompare(a.basename));

        const targetFiles = files.slice(0, days).reverse();
        const map = this.settings.fieldMappings;

        const metricsToTrack = [
            { key: map.readinessKey, label: "Readiness Score", unit: "", color: "#ec4899" },
            { key: map.hrvKey, label: "HRV (RMSSD)", unit: "ms", color: "#f59e0b" },
            { key: map.sleepScoreKey, label: "Sleep Score", unit: "", color: "#6366f1" },
            { key: map.sleepHoursKey, label: "Sleep Duration", unit: "hrs", color: "#10b981" },
            { key: map.hydrationKey, label: "Hydration", unit: "fl oz", color: "#06b6d4" },
            { key: map.caffeineKey, label: "Caffeine", unit: "mg", color: "#8b5cf6" }
        ];

        const results: AggregatedMetric[] = [];

        for (const meta of metricsToTrack) {
            const history: { date: string; value: number }[] = [];

            for (const file of targetFiles) {
                const cache = this.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter;
                if (!fm) continue;

                let raw = fm[meta.key];
                if (raw === undefined || raw === null || raw === "") continue;

                let numVal = 0;
                if (typeof raw === 'string' && raw.includes(":")) {
                    // Time format H:MM -> decimal hours
                    const parts = raw.split(":");
                    numVal = parseFloat(parts[0]) + (parseFloat(parts[1]) / 60);
                } else {
                    numVal = parseFloat(raw);
                }

                if (!isNaN(numVal) && numVal > 0) {
                    history.push({ date: file.basename, value: Math.round(numVal * 10) / 10 });
                }
            }

            if (history.length === 0) continue;

            const sum = history.reduce((acc, cur) => acc + cur.value, 0);
            const avg = Math.round((sum / history.length) * 10) / 10;
            const current = history[history.length - 1].value;

            // Trend calculation vs previous half
            let trendDirection: 'up' | 'down' | 'neutral' = 'neutral';
            let trendPercent = 0;

            if (history.length >= 4) {
                const mid = Math.floor(history.length / 2);
                const firstHalf = history.slice(0, mid);
                const secondHalf = history.slice(mid);
                const avg1 = firstHalf.reduce((a, b) => a + b.value, 0) / firstHalf.length;
                const avg2 = secondHalf.reduce((a, b) => a + b.value, 0) / secondHalf.length;
                if (avg1 > 0) {
                    trendPercent = Math.round(((avg2 - avg1) / avg1) * 100);
                    if (trendPercent > 3) trendDirection = 'up';
                    else if (trendPercent < -3) trendDirection = 'down';
                }
            }

            results.push({
                key: meta.key,
                label: meta.label,
                unit: meta.unit,
                color: meta.color,
                currentValue: current,
                averageValue: avg,
                trendPercent,
                trendDirection,
                history
            });
        }

        return results;
    }
}
