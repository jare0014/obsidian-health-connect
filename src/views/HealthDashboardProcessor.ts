import { App, MarkdownPostProcessorContext, TFile } from "obsidian";
import { HealthPluginSettings, DashboardCard } from "../models/HealthSettings";
import { SvgCharts, ChartSeries } from "./SvgCharts";

export interface ParsedDashboardOptions {
    days?: number;
    startDate?: string;
    endDate?: string;
    excludeWeekends?: boolean;
}

interface ProcessedCardMetric {
    card: DashboardCard;
    history: { date: string; value: number; rawText?: string }[];
    current: string | number;
    sum: number;
    avg: number;
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

    public parseOptions(source: string): ParsedDashboardOptions {
        const opts: ParsedDashboardOptions = {};
        if (!source || !source.trim()) return opts;

        const lines = source.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const colonIdx = trimmed.indexOf(':');
            if (colonIdx === -1) continue;

            const key = trimmed.substring(0, colonIdx).trim().toLowerCase();
            const val = trimmed.substring(colonIdx + 1).trim();

            if (["from", "startdate", "start_date", "start"].includes(key)) {
                opts.startDate = val;
            } else if (["to", "enddate", "end_date", "end"].includes(key)) {
                opts.endDate = val;
            } else if (["days", "range", "window"].includes(key)) {
                const parsedDays = parseInt(val, 10);
                if (!isNaN(parsedDays) && parsedDays > 0) opts.days = parsedDays;
            } else if (["excludeweekends", "exclude_weekends"].includes(key)) {
                opts.excludeWeekends = val.toLowerCase() === "true";
            }
        }
        return opts;
    }

    private async extractMetricValue(file: TFile, key: string): Promise<any> {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (fm) {
            if (fm[key] !== undefined && fm[key] !== null && fm[key] !== "") return fm[key];
            for (const k in fm) {
                if (k.toLowerCase() === key.toLowerCase() && fm[k] !== undefined && fm[k] !== null && fm[k] !== "") {
                    return fm[k];
                }
            }
        }

        try {
            const content = await this.app.vault.read(file);
            const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const dvRegex = new RegExp(`(?:^|\\n)\\s*(?:[-*+]\\s+(?:\\[[ xX]\\]\\s+)?)?${escapedKey}::\\s*([^\\n]+)`, 'i');
            const dvMatch = content.match(dvRegex);
            if (dvMatch) return dvMatch[1].trim();

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

        const dailyFolder = this.settings.dailyNotesFolder || "02_Journal/01_Daily";
        let allFiles = this.app.vault.getMarkdownFiles()
            .filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f.basename.trim()))
            .filter(f => !dailyFolder || f.path.includes(dailyFolder) || f.path.includes("01_Daily"))
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

        const processedMetrics: ProcessedCardMetric[] = [];

        // 1. Process each card's metric data
        for (const c of cards) {
            const history: { date: string; value: number; rawText?: string }[] = [];
            const isWeekendExcluded = c.excludeWeekends || globalExcludeWeekends;

            for (const file of files) {
                if (isWeekendExcluded) {
                    const dayOfWeek = new Date(file.basename + 'T00:00:00').getDay();
                    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
                }

                const raw = await this.extractMetricValue(file, c.key);
                if (raw === undefined || raw === null || raw === "" || raw === "0:00" || raw === "0") continue;

                let num = 0;
                let rawText: string | undefined = undefined;

                if (typeof raw === 'number') {
                    num = raw;
                } else if (typeof raw === 'string') {
                    const trimmed = raw.trim();
                    if (trimmed.includes(':') && /^\d{1,2}:\d{2}/.test(trimmed)) {
                        // Time formatted string like "6:13"
                        const parts = trimmed.split(':');
                        num = parseFloat(parts[0]) + (parseFloat(parts[1]) / 60);
                        rawText = trimmed;
                    } else {
                        const directNum = parseFloat(trimmed);
                        if (!isNaN(directNum) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
                            num = directNum;
                        } else {
                            // Check for duration matches e.g. "Strength Training (8m), Strength Training (14m)" or "(30 min)"
                            const durationMatches = [...trimmed.matchAll(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/gi)];
                            if (durationMatches.length > 0) {
                                const totalMinutes = durationMatches.reduce((acc, m) => acc + parseFloat(m[1]), 0);
                                num = totalMinutes;
                                rawText = trimmed;
                            } else {
                                const items = trimmed.split(',').map(s => s.trim()).filter(Boolean);
                                if (items.length > 0) {
                                    num = items.length;
                                    rawText = trimmed;
                                } else if (!isNaN(directNum)) {
                                    num = directNum;
                                }
                            }
                        }
                    }
                }

                if (!isNaN(num) && num > 0) {
                    history.push({ date: file.basename, value: Math.round(num * 10) / 10, rawText });
                }
            }

            const latestFile = files[files.length - 1];
            const latestDate = latestFile ? latestFile.basename : "";
            const todayEntry = history.find(h => h.date === latestDate);

            let displayVal: string | number = "--";
            if (todayEntry) {
                if (todayEntry.rawText) {
                    if (todayEntry.rawText.includes(':') && /^\d{1,2}:\d{2}/.test(todayEntry.rawText)) {
                        displayVal = todayEntry.rawText;
                    } else if (todayEntry.rawText.length > 10) {
                        displayVal = todayEntry.value;
                    } else {
                        displayVal = todayEntry.rawText;
                    }
                } else {
                    displayVal = todayEntry.value;
                }
            }
            const current = displayVal;
            
            const sum = history.reduce((a, b) => a + b.value, 0);
            const avg = history.length > 0 ? Math.round((sum / history.length) * 10) / 10 : 0;

            processedMetrics.push({ card: c, history, current, sum, avg });

            // KPI Card Tile (if showTile is enabled)
            if (c.showTile !== false) {
                const cardEl = kpiGrid.createDiv({ cls: 'health-kpi-card' });
                if (todayEntry?.rawText && todayEntry.rawText !== String(current)) {
                    cardEl.setAttribute('title', todayEntry.rawText);
                }

                const bar = cardEl.createDiv({ cls: 'health-kpi-accent-bar' });
                bar.style.backgroundColor = c.color;

                cardEl.createDiv({ cls: 'health-kpi-label', text: c.label });
                const valRow = cardEl.createDiv({ cls: 'health-kpi-value-row' });
                valRow.createSpan({ cls: 'health-kpi-value', text: String(current) });
                if (c.unit && current !== "--" && !String(current).includes(':')) {
                    valRow.createSpan({ cls: 'health-kpi-unit', text: c.unit });
                }

                const trendLabel = c.agg === 'sum' 
                    ? `Total: ${Math.round(sum)}${c.unit ? ' ' + c.unit : ''}` 
                    : `Avg: ${avg}${c.unit ? ' ' + c.unit : ''}`;
                cardEl.createDiv({ cls: 'health-kpi-trend trend-neutral', text: trendLabel });
            }
        }

        // 2. Group cards by chartGroup for combined/multi-series charts
        const groupMap = new Map<string, ProcessedCardMetric[]>();
        let ungroupedCounter = 0;

        for (const item of processedMetrics) {
            if (item.card.chartType === 'none') continue;
            const groupName = item.card.chartGroup && item.card.chartGroup.trim() !== "" 
                ? item.card.chartGroup.trim() 
                : `__ungrouped_${++ungroupedCounter}__`;

            if (!groupMap.has(groupName)) {
                groupMap.set(groupName, []);
            }
            groupMap.get(groupName)!.push(item);
        }

        // 3. Render each chart group
        for (const [groupName, groupItems] of groupMap.entries()) {
            const hasData = groupItems.some(i => i.history.length >= 2);
            if (!hasData) continue;

            const chartBox = chartsGrid.createDiv({ cls: 'health-chart-box' });
            const chartHeader = chartBox.createDiv({ cls: 'health-chart-header' });

            const isGroup = !groupName.startsWith('__ungrouped_') && groupItems.length > 1;
            const titleText = isGroup ? groupName : groupItems[0].card.label;
            const primaryColor = groupItems[0].card.color || "#6366f1";

            const title = chartHeader.createEl('h4', { cls: 'health-chart-title', text: titleText });
            title.style.borderLeftColor = primaryColor;

            if (isGroup) {
                // Multi-series Legend in Header
                const legend = chartHeader.createDiv({ cls: 'health-chart-legend' });
                for (const item of groupItems) {
                    const legItem = legend.createSpan({ cls: 'health-legend-item' });
                    const dot = legItem.createSpan({ cls: 'health-legend-dot' });
                    dot.style.backgroundColor = item.card.color;
                    const stat = item.card.agg === 'sum' ? `Tot: ${Math.round(item.sum)}` : `Avg: ${item.avg}`;
                    legItem.createSpan({ text: `${item.card.label} (${stat}${item.card.unit ? ' ' + item.card.unit : ''})` });
                }
            } else {
                const single = groupItems[0];
                const headerStat = single.card.agg === 'sum' ? `Total: ${Math.round(single.sum)} ${single.card.unit}` : `Avg: ${single.avg} ${single.card.unit}`;
                chartHeader.createSpan({ cls: 'health-chart-avg', text: headerStat });
            }

            const seriesList: ChartSeries[] = groupItems.map(item => ({
                key: item.card.key,
                label: item.card.label,
                color: item.card.color,
                unit: item.card.unit,
                data: item.history
            }));

            const hasBar = groupItems.some(item => item.card.chartType === 'bar');
            const svgContainer = chartBox.createDiv();

            if (isGroup) {
                if (hasBar) {
                    svgContainer.innerHTML = SvgCharts.renderGroupedBarChart(seriesList, 340, 150);
                } else {
                    svgContainer.innerHTML = SvgCharts.renderMultiLineChart(seriesList, 340, 150);
                }
            } else {
                if (groupItems[0].card.chartType === 'bar') {
                    svgContainer.innerHTML = SvgCharts.renderGroupedBarChart(seriesList, 320, 150);
                } else {
                    svgContainer.innerHTML = SvgCharts.renderSparklineOrArea(groupItems[0].history, primaryColor, 320, 150);
                }
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
