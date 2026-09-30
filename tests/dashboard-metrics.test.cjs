const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Helper to load and compile TS modules targeting ES2022 in the current execution context
function loadTsModule(filePath, mockRequire) {
    const src = fs.readFileSync(filePath, 'utf8');
    const compiled = ts.transpileModule(src, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const wrapper = `(function(exports, require, module, __filename, __dirname) {\n${compiled}\n})`;
    const fn = vm.runInThisContext(wrapper);
    const mod = { exports: {} };
    fn(mod.exports, mockRequire, mod, filePath, path.dirname(filePath));
    return mod.exports;
}

const { FormulaEvaluator } = loadTsModule(
    path.join(__dirname, '../src/services/FormulaEvaluator.ts'),
    () => ({})
);

const { SvgCharts } = loadTsModule(
    path.join(__dirname, '../src/views/SvgCharts.ts'),
    () => ({})
);

const { HealthDashboardProcessor } = loadTsModule(
    path.join(__dirname, '../src/views/HealthDashboardProcessor.ts'),
    (id) => {
        if (id === 'obsidian') {
            return {
                App: class {},
                TFile: class {},
                MarkdownPostProcessorContext: class {}
            };
        }
        if (id === '../services/FormulaEvaluator') {
            return { FormulaEvaluator };
        }
        if (id === './SvgCharts') {
            return { SvgCharts };
        }
        return {};
    }
);

function createMockElement(tagName = 'div', cls = '') {
    const classes = new Set(cls ? cls.split(/\s+/).filter(Boolean) : []);
    const children = [];
    const attrs = {};
    const style = {};
    const el = {
        tagName,
        classes,
        children,
        attrs,
        style,
        textContent: '',
        innerHTML: '',
        empty: () => { children.length = 0; el.innerHTML = ''; el.textContent = ''; },
        addClass: (c) => classes.add(c),
        removeClass: (c) => classes.delete(c),
        hasClass: (c) => classes.has(c),
        setAttribute: (k, v) => { attrs[k] = v; },
        createDiv: (opts = {}) => {
            const child = createMockElement('div', opts.cls || '');
            if (opts.text) child.textContent = opts.text;
            children.push(child);
            return child;
        },
        createEl: (tag, opts = {}) => {
            const child = createMockElement(tag, opts.cls || '');
            if (opts.text) child.textContent = opts.text;
            children.push(child);
            return child;
        },
        createSpan: (opts = {}) => {
            const child = createMockElement('span', opts.cls || '');
            if (opts.text) child.textContent = opts.text;
            children.push(child);
            return child;
        },
        querySelector: (selector) => {
            const find = (node) => {
                if (selector.startsWith('.') && node.classes.has(selector.slice(1))) return node;
                for (const c of node.children) {
                    const res = find(c);
                    if (res) return res;
                }
                return null;
            };
            return find(el);
        },
        querySelectorAll: (selector) => {
            const results = [];
            const collect = (node) => {
                if (selector.startsWith('.') && node.classes.has(selector.slice(1))) results.push(node);
                for (const c of node.children) collect(c);
            };
            for (const c of children) collect(c);
            return results;
        }
    };
    return el;
}

test('FormulaEvaluator calculates standard arithmetic and handles case-insensitivity', () => {
    const vars = FormulaEvaluator.extractVariables('(protein * 4) + (carbs * 4) + (fat * 9)');
    assert.deepEqual(vars.sort(), ['carbs', 'fat', 'protein']);

    const res = FormulaEvaluator.evaluate('(protein * 4) + (carbs * 4) + (fat * 9)', {
        Protein: 30,
        Carbs: 50,
        Fat: 10
    });
    // 30*4 + 50*4 + 10*9 = 120 + 200 + 90 = 410
    assert.equal(res, 410);

    const validation = FormulaEvaluator.validateFormula('(a + b) / 2');
    assert.equal(validation.valid, true);

    const divZero = FormulaEvaluator.evaluate('10 / 0', {});
    assert.equal(divZero, null);
});

test('HealthDashboardProcessor parseOptions extracts configuration cleanly', () => {
    const processor = new HealthDashboardProcessor({}, {}, () => {});

    const empty = processor.parseOptions('');
    assert.deepEqual({ ...empty }, {});

    const opts = processor.parseOptions(`
        # Comment line
        days: 21
        start_date: 2026-09-01
        end_date: 2026-09-21
        exclude_weekends: true
    `);
    assert.equal(opts.days, 21);
    assert.equal(opts.startDate, '2026-09-01');
    assert.equal(opts.endDate, '2026-09-21');
    assert.equal(opts.excludeWeekends, true);
});

test('HealthDashboardProcessor extractMetricValue parses frontmatter and expanded daily metrics', async () => {
    const processor = new HealthDashboardProcessor({}, {}, () => {});

    // Mock Obsidian App with metadataCache and vault
    const mockVaultContent = `
### 🐙 Git Activity (Antigravity & Automation)
- **1234567** Feat: implemented new dashboard
- **89abcdef** Fix: step count calculation
- **fedcba9** Docs: updated README

### 📞 Productivity
- calls-9am:: 3
- calls-2pm:: 4

### 📋 Clinic & Duties
| Duty | Status |
| REE Prep & Coverage | [x] |

| **Intake** | [x] |
| **Auths** | [x] |

### 🧘 Habits
- [x] Meditation (15m)
`;

    const mockFile = { basename: '2026-09-30', path: '02_Journal/01_Daily/2026-09-30.md' };
    const mockApp = {
        metadataCache: {
            getFileCache: (file) => ({
                frontmatter: {
                    steps: 8432,
                    Mindfulness_Minutes: '15',
                    scores: 950,
                    dabs: 2
                }
            })
        },
        vault: {
            read: async (file) => mockVaultContent
        }
    };
    processor.app = mockApp;

    // Test frontmatter extraction
    const steps = await processor.extractMetricValue(mockFile, 'steps');
    assert.equal(steps, 8432);

    // Test alias extraction (lumosity/scores, dabs)
    const cognitive = await processor.extractMetricValue(mockFile, 'lumosity');
    assert.equal(cognitive, 950);
    const dabs = await processor.extractMetricValue(mockFile, 'dabs');
    assert.equal(dabs, 2);

    // Test git commits extraction
    const commits = await processor.extractMetricValue(mockFile, 'git_commits');
    assert.equal(commits, 3);

    // Test calls extraction
    const calls = await processor.extractMetricValue(mockFile, 'calls');
    assert.equal(calls, 7);

    // Test intake & auth extraction
    const intakes = await processor.extractMetricValue(mockFile, 'intakes');
    assert.equal(intakes, 1);
    const auths = await processor.extractMetricValue(mockFile, 'auths');
    assert.equal(auths, 1);

    // Test clinic duties extraction
    const duties = await processor.extractMetricValue(mockFile, 'clinic_duties');
    assert.equal(duties, 1);

    // Test mindfulness minutes frontmatter priority
    const mindfulness = await processor.extractMetricValue(mockFile, 'mindfulness_minutes');
    assert.equal(mindfulness, '15');
});

test('HealthDashboardProcessor parses focus log elapsed meditation time', async () => {
    const processor = new HealthDashboardProcessor({}, {}, () => {});
    const content = `
### Daily Log
- [focus:: Meditation] [start-time:: 07:00] [completed-time:: 07:20]
- [focus:: Meditation] [start-time:: 12:00] [completed-time:: 12:10]
`;
    processor.app = {
        metadataCache: {
            getFileCache: () => null
        },
        vault: {
            read: async () => content
        }
    };
    const minutes = await processor.extractMetricValue({ basename: '2026-09-30' }, 'mindfulness_minutes');
    assert.equal(minutes, 30);
});

test('HealthDashboardProcessor render generates complete dashboard DOM with KPI cards and charts in codeblock', async () => {
    const el = createMockElement('div');
    const settings = {
        dashboardDateRange: 7,
        dashboardCards: [
            { key: 'steps', label: 'Steps', color: '#10b981', unit: 'steps', chartType: 'bar', showTile: true },
            { key: 'mindfulness_minutes', label: 'Mindfulness', color: '#6366f1', unit: 'min', chartType: 'line', showTile: true },
            { key: 'git_commits', label: 'Git Commits', color: '#f59e0b', chartType: 'line', showTile: true, agg: 'sum' }
        ]
    };

    let synced = false;
    const processor = new HealthDashboardProcessor({}, settings, () => { synced = true; });

    const files = [
        {
            basename: '2026-09-28',
            path: '02_Journal/01_Daily/2026-09-28.md',
            content: `### 🐙 Git Activity\n- **1111111** commit 1\n`
        },
        {
            basename: '2026-09-29',
            path: '02_Journal/01_Daily/2026-09-29.md',
            content: `### 🐙 Git Activity\n- **2222222** commit 2\n- **3333333** commit 3\n`
        },
        {
            basename: '2026-09-30',
            path: '02_Journal/01_Daily/2026-09-30.md',
            content: `### 🐙 Git Activity\n- **4444444** commit 4\n`
        }
    ];

    const fileCaches = {
        '2026-09-28': { steps: 6000, mindfulness_minutes: 10 },
        '2026-09-29': { steps: 8000, mindfulness_minutes: 15 },
        '2026-09-30': { steps: 10000, mindfulness_minutes: 20 }
    };

    processor.app = {
        vault: {
            getMarkdownFiles: () => files.map(f => ({ basename: f.basename, path: f.path })),
            read: async (file) => files.find(f => f.basename === file.basename)?.content || ''
        },
        metadataCache: {
            getFileCache: (file) => ({
                frontmatter: fileCaches[file.basename] || {}
            })
        }
    };

    // Render codeblock
    await processor.render('days: 7', el);

    // Verify title and header
    const title = el.querySelector('.health-db-title');
    assert.ok(title);
    assert.equal(title.textContent, '📊 Health & Biometrics Dashboard');

    // Verify Sync button works
    const syncBtn = el.querySelector('.health-db-sync-btn');
    assert.ok(syncBtn);
    syncBtn.onclick();
    assert.equal(synced, true);

    // Verify KPI Grid contains 3 cards
    const kpiCards = el.querySelectorAll('.health-kpi-card');
    assert.equal(kpiCards.length, 3);

    // Steps card: latest = 10000
    const stepsVal = kpiCards[0].querySelector('.health-kpi-value');
    assert.equal(stepsVal.textContent, '10000');

    // Mindfulness card: latest = 20
    const mindVal = kpiCards[1].querySelector('.health-kpi-value');
    assert.equal(mindVal.textContent, '20');

    // Git Commits card: sum = 4 (1 + 2 + 1)
    const commitsVal = kpiCards[2].querySelector('.health-kpi-value');
    assert.equal(commitsVal.textContent, '1'); // today's value
    const commitsTrend = kpiCards[2].querySelector('.health-kpi-trend');
    assert.equal(commitsTrend.textContent, 'Total: 4');

    // Verify charts grid rendered SVGs
    const chartBoxes = el.querySelectorAll('.health-chart-box');
    assert.ok(chartBoxes.length > 0);
    for (const cb of chartBoxes) {
        // Must contain SVG output from real SvgCharts
        const svgDiv = cb.children.find(c => c.innerHTML && c.innerHTML.includes('<svg'));
        assert.ok(svgDiv, 'Chart box must contain rendered SVG element');
    }
});

