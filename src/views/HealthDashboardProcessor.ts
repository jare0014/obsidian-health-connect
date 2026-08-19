import { App, MarkdownPostProcessorContext } from "obsidian";
import { HealthPluginSettings, DashboardCard } from "../models/HealthSettings";
import { SvgCharts } from "./SvgCharts";

export interface DashboardCodeblockOptions {
    startDate?: string;
    endDate?: string;
    days?: number;
    excludeWeekends?: boolean;
}

export class HealthDashboardProcessor {
    private app: App;
    private settings: HealthPluginSettings;
    private onSyncClick: () => void;

    constructor(app: App, settings: HealthPluginSettings, onSyncClick: () => void) {
        this.app = app;
        this.settings = settings;
        this.onSyncClick = onSyncClick;
    }

    public parseOptions(source: string): DashboardCodeblockOptions {
        const opts: DashboardCodeblockOptions = {};
        if (!source || !source.trim()) return opts;

        const lines = source.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const colonIdx = trimmed.indexOf(':');
            if (colonIdx === -1) continue;

            const k = trimmed.substring(0, colonIdx).trim().toLowerCase();
            const val = trimmed.substring(colonIdx + 1).trim();

            if (['from', 'startdate', 'start_date', 'start'].includes(k)) {
                opts.startDate = val;
            } else if (['to', 'enddate', 'end_date', 'end'].includes(k)) {
                opts.endDate = val;
            } else if (['days', 'range', 'window'].includes(k)) {
                const parsed = parseInt(val, 10);
                if (!isNaN(parsed) && parsed > 0) opts.days = parsed;
            } else if (['excludeweekends', 'exclude_weekends'].includes(k)) {
                opts.excludeWeekends = val.toLowerCase() === 'true';
            }
        }
        return opts;
    }

    
    private async extractMetricValue(file: any, key: string): Promise<any> {
        // 1. Check frontmatter (case-insensitive)
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (fm) {
            if (fm[key] !== undefined && fm[key] !== null && fm[key] !== "") return fm[key];
            for (const k in fm) {
                if (k.toLowerCase() === key.toLowerCase() && fm[k] !== undefined && fm[k] !== null && fm[k] !== "") {
                    return fm[k];
                }
            }
        }

        // 2. Fallback: Parse note body for Dataview inline fields ('key:: val') or bullet items ('- key: val')
        try {
            const content = await this.app.vault.read(file);
            
            // Dataview syntax: key:: value or - [ ] key:: value or - key:: value
            const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const dvRegex = new RegExp(`(?:^|\\n)\\s*(?:[-*+]\\s+(?:\\[[ xX]\\]\\s+)?)?${escapedKey}::\\s*([^\\n]+)`, 'i');
            const dvMatch = content.match(dvRegex);
            if (dvMatch) return dvMatch[1].trim();

            // Bullet list single colon syntax: - key: value
            const bulletRegex = new RegExp(`(?:^|\\n)\\s*[-*+]\\s+${escapedKey}:\\s+([^\\n]+)`, 'i');
            const bulletMatch = content.match(bulletRegex);
            if (bulletMatch) return bulletMatch[1].trim();
        } catch (e) {}

        return undefined;
    }

    public async render(source: string, el: HTMLElement, ctx?: MarkdownPostProcessorContext): Promise<void> {
        el.empty();
        const opts = this.parseOptions(source);
        const daysRange = opts.days || this.settings.dashboardDateRange || 14;
        const globalExcludeWeekends = opts.excludeWeekends !== undefined ? opts.excludeWeekends : (this.settings.dashboardExcludeWeekends || false);

        const wrapper = el.createDiv({ cls: 'health-db-wrapper' });

        const header = wrapper.createDiv({ cls: 'health-db-header' });
        const titleGroup = header.createDiv({ cls: 'health-db-title-group' });
        titleGroup.createEl('h2', { cls: 'health-db-title', text: '📊 Readiness & Health Dashboard' });
        
        let subtitleText = `Rolling ${daysRange}-day biometric analysis from Daily Notes`;
        if (opts.startDate || opts.endDate) {
            subtitleText = `Custom range: ${opts.startDate || 'Earliest'} → ${opts.endDate || 'Latest'}`;
        }
        titleGroup.createEl('div', { cls: 'health-db-subtitle', text: subtitleText });

        const syncBtn = header.createEl('button', { cls: 'health-db-sync-btn', text: '⚡ Sync Today' });
        syncBtn.onclick = () => this.onSyncClick();

        let allFiles = this.app.vault.getMarkdownFiles()
            .filter(f => /\d{4}-\d{2}-\d{2}/.test(f.basename))
            .sort((a, b) => b.basename.localeCompare(a.basename));

        if (opts.startDate) {
            allFiles = allFiles.filter(f => f.basename >= opts.startDate!);
        }
        if (opts.endDate) {
            allFiles = allFiles.filter(f => f.basename <= opts.endDate!);
        }

        if (!opts.startDate && !opts.endDate) {
            allFiles = allFiles.slice(0, daysRange);
        }

        const files = allFiles.reverse(); // Chronological order

        const cards = this.settings.dashboardCards || [];
        const kpiGrid = wrapper.createDiv({ cls: 'health-kpi-grid' });
        const chartsGrid = wrapper.createDiv({ cls: 'health-charts-grid' });

        for (const c of cards) {
            const history: { date: string; value: number }[] = [];
            const isWeekendExcluded = c.excludeWeekends || globalExcludeWeekends;

            for (const file of files) {
                if (isWeekendExcluded) {
                    const dayOfWeek = new Date(file.basename + 'T00:00:00').getDay();
                    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip Sun (0) & Sat (6)
                }

                const raw = await this.extractMetricValue(file, c.key);
                if (raw === undefined || raw === null || raw === "") continue;

                let num = 0;
                if (typeof raw === 'string' && raw.includes(':')) {
                    const parts = raw.split(':');
                    num = parseFloat(parts[0]) + (parseFloat(parts[1]) / 60);
                } else {
                    num = parseFloat(raw);
                }
                if (!isNaN(num)) history.push({ date: file.basename, value: Math.round(num * 10) / 10 });
            }

            const current = history.length > 0 ? history[history.length - 1].value : "--";
            const sum = history.reduce((a, b) => a + b.value, 0);
            const avg = history.length > 0 ? Math.round((sum / history.length) * 10) / 10 : 0;

            // KPI Card (if showTile is enabled)
            if (c.showTile !== false) {
                const cardEl = kpiGrid.createDiv({ cls: 'health-kpi-card' });
                const bar = cardEl.createDiv({ cls: 'health-kpi-accent-bar' });
                bar.style.backgroundColor = c.color;

                cardEl.createDiv({ cls: 'health-kpi-label', text: c.label });
                const valRow = cardEl.createDiv({ cls: 'health-kpi-value-row' });
                valRow.createSpan({ cls: 'health-kpi-value', text: String(current) });
                if (c.unit) valRow.createSpan({ cls: 'health-kpi-unit', text: c.unit });

                const trendLabel = c.agg === 'sum' ? `Total: ${Math.round(sum)} ${c.unit}` : `Avg: ${avg} ${c.unit}`;
                cardEl.createDiv({ cls: 'health-kpi-trend trend-neutral', text: trendLabel });
            }

            // Chart Box (if chartType is not none)
            if (c.chartType !== 'none' && history.length >= 2) {
                const chartBox = chartsGrid.createDiv({ cls: 'health-chart-box' });
                const chartHeader = chartBox.createDiv({ cls: 'health-chart-header' });
                const title = chartHeader.createEl('h4', { cls: 'health-chart-title', text: c.label });
                title.style.borderLeftColor = c.color;
                
                const headerStat = c.agg === 'sum' ? `Total: ${Math.round(sum)} ${c.unit}` : `Avg: ${avg} ${c.unit}`;
                chartHeader.createSpan({ cls: 'health-chart-avg', text: headerStat });

                const svgContainer = chartBox.createDiv();
                svgContainer.innerHTML = SvgCharts.renderSparklineOrArea(history, c.color, 320, 150);
            }
        }

        if (files.length === 0) {
            wrapper.createDiv({ 
                text: "No daily note data found for the specified date range.", 
                style: "color:var(--text-muted); text-align:center; padding:20px;" 
            });
        }
    }
}
