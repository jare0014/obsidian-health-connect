import { App, MarkdownPostProcessorContext } from "obsidian";
import { HealthPluginSettings } from "../models/HealthSettings";
import { SvgCharts } from "./SvgCharts";

export class HealthDashboardProcessor {
    private app: App;
    private settings: HealthPluginSettings;
    private onSyncClick: () => void;

    constructor(app: App, settings: HealthPluginSettings, onSyncClick: () => void) {
        this.app = app;
        this.settings = settings;
        this.onSyncClick = onSyncClick;
    }

    public async render(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
        el.empty();
        const wrapper = el.createDiv({ cls: 'health-db-wrapper' });

        const header = wrapper.createDiv({ cls: 'health-db-header' });
        const titleGroup = header.createDiv({ cls: 'health-db-title-group' });
        titleGroup.createEl('h2', { cls: 'health-db-title', text: '📊 Readiness & Health Dashboard' });
        titleGroup.createEl('div', { cls: 'health-db-subtitle', text: `Rolling ${this.settings.dashboardDateRange}-day biometric analysis from Daily Notes` });

        const syncBtn = header.createEl('button', { cls: 'health-db-sync-btn', text: '⚡ Sync Today' });
        syncBtn.onclick = () => this.onSyncClick();

        const files = this.app.vault.getMarkdownFiles()
            .filter(f => /\d{4}-\d{2}-\d{2}/.test(f.basename))
            .sort((a, b) => b.basename.localeCompare(a.basename))
            .slice(0, this.settings.dashboardDateRange)
            .reverse();

        const cards = this.settings.dashboardCards || [];
        const kpiGrid = wrapper.createDiv({ cls: 'health-kpi-grid' });
        const chartsGrid = wrapper.createDiv({ cls: 'health-charts-grid' });

        for (const c of cards) {
            const history: { date: string; value: number }[] = [];

            for (const file of files) {
                const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
                if (!fm) continue;
                const raw = fm[c.key];
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

            // KPI Card
            const cardEl = kpiGrid.createDiv({ cls: 'health-kpi-card' });
            const bar = cardEl.createDiv({ cls: 'health-kpi-accent-bar' });
            bar.style.backgroundColor = c.color;

            cardEl.createDiv({ cls: 'health-kpi-label', text: c.label });
            const valRow = cardEl.createDiv({ cls: 'health-kpi-value-row' });
            valRow.createSpan({ cls: 'health-kpi-value', text: String(current) });
            if (c.unit) valRow.createSpan({ cls: 'health-kpi-unit', text: c.unit });

            cardEl.createDiv({ cls: 'health-kpi-trend trend-neutral', text: `14d Avg: ${avg} ${c.unit}` });

            // Chart Box
            if (history.length >= 2) {
                const chartBox = chartsGrid.createDiv({ cls: 'health-chart-box' });
                const chartHeader = chartBox.createDiv({ cls: 'health-chart-header' });
                const title = chartHeader.createEl('h4', { cls: 'health-chart-title', text: c.label });
                title.style.borderLeftColor = c.color;
                chartHeader.createSpan({ cls: 'health-chart-avg', text: `Avg: ${avg} ${c.unit}` });

                const svgContainer = chartBox.createDiv();
                svgContainer.innerHTML = SvgCharts.renderSparklineOrArea(history, c.color, 320, 150);
            }
        }
    }
}
