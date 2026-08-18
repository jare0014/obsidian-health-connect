import { App, MarkdownPostProcessorContext } from "obsidian";
import { HealthPluginSettings } from "../models/HealthTypes";
import { MetricsAggregator } from "../services/MetricsAggregator";
import { SvgCharts } from "./SvgCharts";

export class HealthDashboardProcessor {
    private app: App;
    private settings: HealthPluginSettings;
    private aggregator: MetricsAggregator;
    private onSyncClick: () => void;

    constructor(app: App, settings: HealthPluginSettings, onSyncClick: () => void) {
        this.app = app;
        this.settings = settings;
        this.aggregator = new MetricsAggregator(app, settings);
        this.onSyncClick = onSyncClick;
    }

    public async render(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
        el.empty();
        const wrapper = el.createDiv({ cls: 'health-db-wrapper' });

        // Header
        const header = wrapper.createDiv({ cls: 'health-db-header' });
        const titleGroup = header.createDiv({ cls: 'health-db-title-group' });
        titleGroup.createEl('h2', { cls: 'health-db-title', text: '📊 Readiness & Health Intelligence' });
        titleGroup.createEl('div', { cls: 'health-db-subtitle', text: `Rolling ${this.settings.dashboardDays}-day biometric analysis from Daily Notes` });

        const syncBtn = header.createEl('button', { cls: 'health-db-sync-btn', text: '⚡ Sync Today' });
        syncBtn.onclick = () => this.onSyncClick();

        const metrics = await this.aggregator.aggregateMetrics(this.settings.dashboardDays);

        if (metrics.length === 0) {
            const emptyState = wrapper.createDiv({ cls: 'health-kpi-card' });
            emptyState.createDiv({ text: "No health metrics detected in daily notes frontmatter. Click 'Sync Today' or configure field keys in settings." });
            return;
        }

        // 1. KPI Cards Grid
        const kpiGrid = wrapper.createDiv({ cls: 'health-kpi-grid' });

        for (const m of metrics) {
            const card = kpiGrid.createDiv({ cls: 'health-kpi-card' });
            
            const bar = card.createDiv({ cls: 'health-kpi-accent-bar' });
            bar.style.backgroundColor = m.color;

            card.createDiv({ cls: 'health-kpi-label', text: m.label });

            const valRow = card.createDiv({ cls: 'health-kpi-value-row' });
            valRow.createSpan({ cls: 'health-kpi-value', text: String(m.currentValue) });
            if (m.unit) valRow.createSpan({ cls: 'health-kpi-unit', text: m.unit });

            const trendEl = card.createDiv({ cls: `health-kpi-trend trend-${m.trendDirection}` });
            const arrow = m.trendDirection === 'up' ? '▲' : (m.trendDirection === 'down' ? '▼' : '●');
            trendEl.textContent = `${arrow} ${Math.abs(m.trendPercent)}% vs avg (${m.averageValue}${m.unit ? ' ' + m.unit : ''})`;
        }

        // 2. Trend Charts Grid
        const chartsGrid = wrapper.createDiv({ cls: 'health-charts-grid' });

        for (const m of metrics) {
            const box = chartsGrid.createDiv({ cls: 'health-chart-box' });
            
            const chartHeader = box.createDiv({ cls: 'health-chart-header' });
            const title = chartHeader.createEl('h4', { cls: 'health-chart-title', text: m.label });
            title.style.borderLeftColor = m.color;

            chartHeader.createSpan({ cls: 'health-chart-avg', text: `14d Avg: ${m.averageValue} ${m.unit}` });

            const svgContainer = box.createDiv();
            svgContainer.innerHTML = SvgCharts.renderSparklineOrArea(m.history, m.color, 320, 160);
        }
    }
}
