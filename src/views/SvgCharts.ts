export interface ChartSeries {
    key: string;
    label: string;
    color: string;
    unit?: string;
    data: { date: string; value: number; rawText?: string }[];
}

export class SvgCharts {
    public static renderSparklineOrArea(history: { date: string; value: number }[], color: string, width: number = 320, height: number = 140): string {
        if (!history || history.length < 2) {
            return `<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:30px 0;">Need at least 2 entries for chart</div>`;
        }

        const values = history.map(h => h.value);
        const min = Math.min(...values) * 0.9;
        const max = Math.max(...values) * 1.1;
        const range = max - min || 1;

        const paddingX = 25;
        const paddingY = 20;
        const chartW = width - (paddingX * 2);
        const chartH = height - (paddingY * 2);

        const points = history.map((item, index) => {
            const x = paddingX + (index / (history.length - 1)) * chartW;
            const y = height - paddingY - ((item.value - min) / range) * chartH;
            return { x, y, date: item.date, value: item.value };
        });

        const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height - paddingY} L ${points[0].x.toFixed(1)} ${height - paddingY} Z`;

        const dots = points.map(p => 
            `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${color}" stroke="var(--background-secondary)" stroke-width="1.5">
                <title>${p.date}: ${p.value}</title>
            </circle>`
        ).join('');

        const gridLines = `
            <line x1="${paddingX}" y1="${paddingY}" x2="${width - paddingX}" y2="${paddingY}" stroke="var(--background-modifier-border)" stroke-dasharray="3,3" stroke-width="0.75" />
            <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" stroke="var(--background-modifier-border)" stroke-width="1" />
        `;

        const labels = `
            <text x="${paddingX}" y="${height - 4}" fill="var(--text-muted)" font-size="9" text-anchor="start">${history[0].date.slice(5)}</text>
            <text x="${width - paddingX}" y="${height - 4}" fill="var(--text-muted)" font-size="9" text-anchor="end">${history[history.length - 1].date.slice(5)}</text>
            <text x="${paddingX - 4}" y="${paddingY + 3}" fill="var(--text-muted)" font-size="8" text-anchor="end">${Math.round(max)}</text>
            <text x="${paddingX - 4}" y="${height - paddingY}" fill="var(--text-muted)" font-size="8" text-anchor="end">${Math.round(min)}</text>
        `;

        const gradId = `grad-${color.replace(/[^a-zA-Z0-9]/g, '')}-${Math.floor(Math.random()*1000)}`;

        return `
            <svg viewBox="0 0 ${width} ${height}" class="health-chart-svg" style="width:100%; height:auto;">
                <defs>
                    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
                        <stop offset="100%" stop-color="${color}" stop-opacity="0.0"/>
                    </linearGradient>
                </defs>
                ${gridLines}
                <path d="${areaD}" fill="url(#${gradId})" />
                <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                ${dots}
                ${labels}
            </svg>
        `;
    }

    public static renderMultiLineChart(seriesList: ChartSeries[], width: number = 340, height: number = 150): string {
        const activeSeries = seriesList.filter(s => s.data && s.data.length > 0);
        if (activeSeries.length === 0) {
            return `<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:30px 0;">No chart data available</div>`;
        }

        // Get all unique dates in chronological order
        const allDatesSet = new Set<string>();
        for (const s of activeSeries) {
            s.data.forEach(d => allDatesSet.add(d.date));
        }
        const dates = Array.from(allDatesSet).sort();
        if (dates.length < 2) {
            return `<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:30px 0;">Need at least 2 date entries for chart</div>`;
        }

        const paddingX = 28;
        const paddingY = 22;
        const chartW = width - (paddingX * 2);
        const chartH = height - (paddingY * 2);

        let svgDefs = '';
        let svgPaths = '';
        let svgDots = '';

        for (const s of activeSeries) {
            const values = s.data.map(d => d.value);
            const min = Math.min(...values) * 0.9;
            const max = Math.max(...values) * 1.1;
            const range = max - min || 1;

            const dateMap = new Map<string, { value: number; rawText?: string }>();
            s.data.forEach(d => dateMap.set(d.date, d));

            const points: { x: number; y: number; date: string; value: number; rawText?: string }[] = [];
            dates.forEach((date, i) => {
                const item = dateMap.get(date);
                if (item !== undefined) {
                    const x = paddingX + (i / (dates.length - 1)) * chartW;
                    const y = height - paddingY - ((item.value - min) / range) * chartH;
                    points.push({ x, y, date, value: item.value, rawText: item.rawText });
                }
            });

            if (points.length >= 2) {
                const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
                const gradId = `multigrad-${s.color.replace(/[^a-zA-Z0-9]/g, '')}-${Math.floor(Math.random() * 1000)}`;
                svgDefs += `
                    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="${s.color}" stop-opacity="0.2"/>
                        <stop offset="100%" stop-color="${s.color}" stop-opacity="0.0"/>
                    </linearGradient>
                `;
                const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height - paddingY} L ${points[0].x.toFixed(1)} ${height - paddingY} Z`;
                svgPaths += `<path d="${areaD}" fill="url(#${gradId})" />`;
                svgPaths += `<path d="${pathD}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />`;

                for (const p of points) {
                    const displayVal = p.rawText || p.value;
                    svgDots += `
                        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${s.color}" stroke="var(--background-secondary)" stroke-width="1.2">
                            <title>${p.date} [${s.label}]: ${displayVal} ${s.unit || ''}</title>
                        </circle>
                    `;
                }
            }
        }

        const gridLines = `
            <line x1="${paddingX}" y1="${paddingY}" x2="${width - paddingX}" y2="${paddingY}" stroke="var(--background-modifier-border)" stroke-dasharray="3,3" stroke-width="0.75" />
            <line x1="${paddingX}" y1="${paddingY + chartH / 2}" x2="${width - paddingX}" y2="${paddingY + chartH / 2}" stroke="var(--background-modifier-border)" stroke-dasharray="2,2" stroke-width="0.5" />
            <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" stroke="var(--background-modifier-border)" stroke-width="1" />
        `;

        const labels = `
            <text x="${paddingX}" y="${height - 4}" fill="var(--text-muted)" font-size="9" text-anchor="start">${dates[0].slice(5)}</text>
            <text x="${width - paddingX}" y="${height - 4}" fill="var(--text-muted)" font-size="9" text-anchor="end">${dates[dates.length - 1].slice(5)}</text>
        `;

        return `
            <svg viewBox="0 0 ${width} ${height}" class="health-chart-svg" style="width:100%; height:auto;">
                <defs>${svgDefs}</defs>
                ${gridLines}
                ${svgPaths}
                ${svgDots}
                ${labels}
            </svg>
        `;
    }

    public static renderGroupedBarChart(seriesList: ChartSeries[], width: number = 340, height: number = 150): string {
        const activeSeries = seriesList.filter(s => s.data && s.data.length > 0);
        if (activeSeries.length === 0) {
            return `<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:30px 0;">No chart data available</div>`;
        }

        const allDatesSet = new Set<string>();
        for (const s of activeSeries) {
            s.data.forEach(d => allDatesSet.add(d.date));
        }
        const dates = Array.from(allDatesSet).sort();
        if (dates.length === 0) {
            return `<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:30px 0;">No date entries for chart</div>`;
        }

        const paddingX = 28;
        const paddingY = 22;
        const chartW = width - (paddingX * 2);
        const chartH = height - (paddingY * 2);

        // Normalize each series max to scale nicely in grouped columns
        const seriesMaxMap = new Map<string, number>();
        for (const s of activeSeries) {
            const vals = s.data.map(d => d.value);
            const m = Math.max(...vals, 1);
            seriesMaxMap.set(s.key, m * 1.15);
        }

        const groupWidth = chartW / dates.length;
        const barMargin = 1.5;
        const numSeries = activeSeries.length;
        const barWidth = Math.max(2, (groupWidth * 0.8) / numSeries - barMargin);

        let svgBars = '';
        dates.forEach((date, dateIdx) => {
            const groupX = paddingX + (dateIdx * groupWidth) + (groupWidth * 0.1);

            activeSeries.forEach((s, sIdx) => {
                const item = s.data.find(d => d.date === date);
                if (item && item.value > 0) {
                    const maxVal = seriesMaxMap.get(s.key) || 100;
                    const barH = Math.min(chartH, Math.max(3, (item.value / maxVal) * chartH));
                    const barX = groupX + (sIdx * (barWidth + barMargin));
                    const barY = height - paddingY - barH;
                    const displayVal = item.rawText || item.value;

                    svgBars += `
                        <rect x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barH.toFixed(1)}" 
                              rx="2" fill="${s.color}" opacity="0.85">
                            <title>${date} [${s.label}]: ${displayVal} ${s.unit || ''}</title>
                        </rect>
                    `;
                }
            });
        });

        const gridLines = `
            <line x1="${paddingX}" y1="${paddingY}" x2="${width - paddingX}" y2="${paddingY}" stroke="var(--background-modifier-border)" stroke-dasharray="3,3" stroke-width="0.75" />
            <line x1="${paddingX}" y1="${paddingY + chartH / 2}" x2="${width - paddingX}" y2="${paddingY + chartH / 2}" stroke="var(--background-modifier-border)" stroke-dasharray="2,2" stroke-width="0.5" />
            <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" stroke="var(--background-modifier-border)" stroke-width="1" />
        `;

        const labels = `
            <text x="${paddingX}" y="${height - 4}" fill="var(--text-muted)" font-size="9" text-anchor="start">${dates[0].slice(5)}</text>
            <text x="${width - paddingX}" y="${height - 4}" fill="var(--text-muted)" font-size="9" text-anchor="end">${dates[dates.length - 1].slice(5)}</text>
        `;

        return `
            <svg viewBox="0 0 ${width} ${height}" class="health-chart-svg" style="width:100%; height:auto;">
                ${gridLines}
                ${svgBars}
                ${labels}
            </svg>
        `;
    }
}
