export class SvgCharts {
    public static renderSparklineOrArea(history: { date: string; value: number }[], color: string, width: number = 300, height: number = 140): string {
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

        return `
            <svg viewBox="0 0 ${width} ${height}" class="health-chart-svg">
                <defs>
                    <linearGradient id="grad-${color.replace('#', '')}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
                        <stop offset="100%" stop-color="${color}" stop-opacity="0.0"/>
                    </linearGradient>
                </defs>
                ${gridLines}
                <path d="${areaD}" fill="url(#grad-${color.replace('#', '')})" />
                <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                ${dots}
                ${labels}
            </svg>
        `;
    }
}
