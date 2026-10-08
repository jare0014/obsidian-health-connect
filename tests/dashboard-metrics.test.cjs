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
        if (id === '../extractors/activeExtractors') {
            const extractorsPath = fs.existsSync(path.join(__dirname, '../src/extractors/localExtractors.ts'))
                ? path.join(__dirname, '../src/extractors/localExtractors.ts')
                : path.join(__dirname, '../src/extractors/defaultExtractors.ts');
            return loadTsModule(extractorsPath, () => ({}));
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

test('HealthDashboardProcessor extractMetricValue parses frontmatter, inline Dataview fields, and bullet properties', async () => {
    const processor = new HealthDashboardProcessor({}, {}, () => {});

    const mockVaultContent = `
### Daily Log
- water:: 750
- [ ] protein:: 120
- mood: 8

### Habits
- [x] Meditation (25m)
`;

    const mockFile = { basename: '2026-09-30', path: '01_Daily/2026-09-30.md' };
    const mockApp = {
        metadataCache: {
            getFileCache: (file) => ({
                frontmatter: {
                    steps: 8432,
                    Mindfulness_Minutes: '15'
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

    // Test mindfulness minutes frontmatter priority
    const mindfulness = await processor.extractMetricValue(mockFile, 'mindfulness_minutes');
    assert.equal(mindfulness, '15');

    // Test Dataview inline field extraction
    const water = await processor.extractMetricValue(mockFile, 'water');
    assert.equal(water, '750');

    // Test checkbox Dataview inline field extraction
    const protein = await processor.extractMetricValue(mockFile, 'protein');
    assert.equal(protein, '120');

    // Test bullet property extraction
    const mood = await processor.extractMetricValue(mockFile, 'mood');
    assert.equal(mood, '8');
});

test('HealthDashboardProcessor parses generic meditation duration from note content', async () => {
    const processor = new HealthDashboardProcessor({}, {}, () => {});
    const content = `
### Notes
- Completed morning session: Meditation (25m)
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
    assert.equal(minutes, 25);
});

test('HealthDashboardProcessor render generates complete dashboard DOM with KPI cards and charts in codeblock', async () => {
    const el = createMockElement('div');
    const settings = {
        dashboardDateRange: 7,
        dashboardCards: [
            { key: 'steps', label: 'Steps', color: '#10b981', unit: 'steps', chartType: 'bar', showTile: true },
            { key: 'mindfulness_minutes', label: 'Mindfulness', color: '#6366f1', unit: 'min', chartType: 'line', showTile: true },
            { key: 'water', label: 'Water', color: '#06b6d4', unit: 'ml', chartType: 'bar', showTile: true, agg: 'sum' }
        ]
    };

    let synced = false;
    const processor = new HealthDashboardProcessor({}, settings, () => { synced = true; });

    const files = [
        {
            basename: '2026-09-28',
            path: '01_Daily/2026-09-28.md',
            content: `- water:: 1500\n`
        },
        {
            basename: '2026-09-29',
            path: '01_Daily/2026-09-29.md',
            content: `- water:: 2000\n`
        },
        {
            basename: '2026-09-30',
            path: '01_Daily/2026-09-30.md',
            content: `- water:: 2500\n`
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

    // Water card: sum = 6000 (1500 + 2000 + 2500), latest = 2500
    const waterVal = kpiCards[2].querySelector('.health-kpi-value');
    assert.equal(waterVal.textContent, '2500'); // today's value
    const waterTrend = kpiCards[2].querySelector('.health-kpi-trend');
    assert.equal(waterTrend.textContent, 'Total: 6000 ml');

    // Verify charts grid rendered SVGs
    const chartBoxes = el.querySelectorAll('.health-chart-box');
    assert.ok(chartBoxes.length > 0);
    for (const cb of chartBoxes) {
        // Must contain SVG output from real SvgCharts
        const svgDiv = cb.children.find(c => c.innerHTML && c.innerHTML.includes('<svg'));
        assert.ok(svgDiv, 'Chart box must contain rendered SVG element');
    }
});

test('HealthSettings provides unmapped biometrics in healthSyncConfig and supports frontmatter mapping', () => {
    const { DEFAULT_SETTINGS } = loadTsModule(
        path.join(__dirname, '../src/models/HealthSettings.ts'),
        () => ({})
    );
    assert.ok(DEFAULT_SETTINGS.healthSyncConfig.respiratory_rate);
    assert.equal(DEFAULT_SETTINGS.healthSyncConfig.respiratory_rate.key, 'respiratory_rate');
    assert.ok(DEFAULT_SETTINGS.healthSyncConfig.body_temperature);
    assert.equal(DEFAULT_SETTINGS.healthSyncConfig.body_temperature.key, 'body_temperature');
    assert.ok(DEFAULT_SETTINGS.healthSyncConfig.basal_metabolic_rate);
    assert.equal(DEFAULT_SETTINGS.healthSyncConfig.basal_metabolic_rate.key, 'bmr');
    assert.ok(DEFAULT_SETTINGS.healthSyncConfig.blood_oxygen);
    assert.equal(DEFAULT_SETTINGS.healthSyncConfig.blood_oxygen.key, 'spo2');
    assert.ok(DEFAULT_SETTINGS.healthSyncConfig.blood_glucose);
    assert.equal(DEFAULT_SETTINGS.healthSyncConfig.blood_glucose.key, 'blood_glucose');
    assert.ok(DEFAULT_SETTINGS.healthSyncConfig.blood_pressure);
    assert.equal(DEFAULT_SETTINGS.healthSyncConfig.blood_pressure.key, 'blood_pressure');
});

test('localReconcileWorkouts reconciles focus timers and watch sessions without double counting', async () => {
    const extractorsPath = fs.existsSync(path.join(__dirname, '../src/extractors/localExtractors.ts'))
        ? path.join(__dirname, '../src/extractors/localExtractors.ts')
        : path.join(__dirname, '../src/extractors/defaultExtractors.ts');
    const { localReconcileWorkouts } = loadTsModule(extractorsPath, () => ({}));

    if (typeof localReconcileWorkouts !== 'function') return;

    const mockNoteContent = `---
date: 2026-10-05
workout: Workout (14m)
active_minutes: 14
---
### Focus Log
- [focus:: Exercises: Phase 1] [start-time:: 12:59:36] [pause-start:: 13:00:51] [pause-end:: 13:00:53] [completed-time:: 13:13:36]
- [focus:: Exercises: Phase 2] [start-time:: 15:00:00] [completed-time:: 15:20:00]
- [focus:: Exercises: Phase 3] [start-time:: 16:00:00] [completed-time:: cancelled]
`;

    const mockApp = {
        vault: {
            read: async () => mockNoteContent
        },
        metadataCache: {
            getFileCache: () => ({
                frontmatter: {
                    workout: "Workout (14m)",
                    active_minutes: "14"
                }
            })
        }
    };

    const mockFile = { basename: '2026-10-05' };
    const incomingData = {
        workout: "Workout (14m)",
        active_minutes: 14
    };

    const reconciled = await localReconcileWorkouts(mockFile, incomingData, mockApp);

    // 1. Overlapping session: "Workout (14m)" matched with "Exercises: Phase 1" (~14m) -> upgraded title, no duplicate
    assert.ok(reconciled.workout.includes("Exercises: Phase 1 (14m)"));
    // 2. Unrecorded session: "Exercises: Phase 2" (20m) was not on the watch -> added
    assert.ok(reconciled.workout.includes("Exercises: Phase 2 (20m)"));
    // 3. Cancelled session: "Exercises: Phase 3" was cancelled -> MUST NOT be added
    assert.ok(!reconciled.workout.includes("Phase 3"));
    // 4. Active minutes should increase by the unrecorded session (14 + 20 = 34), not double-counting Phase 1 or adding cancelled Phase 3
    assert.equal(reconciled.active_minutes, 34);
});

test('localExtractMetric extracts meditation focus log duration accounting for pauses and rejecting cancelled', async () => {
    const extractorsPath = fs.existsSync(path.join(__dirname, '../src/extractors/localExtractors.ts'))
        ? path.join(__dirname, '../src/extractors/localExtractors.ts')
        : path.join(__dirname, '../src/extractors/defaultExtractors.ts');
    const { localExtractMetric } = loadTsModule(extractorsPath, () => ({}));
    if (typeof localExtractMetric !== 'function') return;

    const mockContent = `
### Focus Log
- [focus:: Meditation] [start-time:: 11:19:12] [pause-start:: 11:32:35] [pause-end:: 11:32:36] [completed-time:: 11:32:39]
- [focus:: Meditation] [start-time:: 12:00:00] [completed-time:: cancelled]
`;
    const val = localExtractMetric({ basename: '2026-10-08' }, 'mindfulness_minutes', mockContent);
    // 11:19:12 to 11:32:39 is ~13m 27s minus 1s pause = ~13m
    assert.equal(val, 13);
});

test('WorkoutSyncService parses, serializes, and reconciles frontmatter with cloud workouts', async () => {
    const { WorkoutSyncService } = loadTsModule(
        path.join(__dirname, '../src/services/WorkoutSyncService.ts'),
        (id) => {
            if (id === 'obsidian') {
                return { App: class {}, TFile: class {}, Notice: class {} };
            }
            if (id === './GoogleHealthService') {
                return { GoogleHealthService: class {} };
            }
            return {};
        }
    );

    const pushed = [];
    const mockHealthService = {
        fetchExerciseSessionsForDate: async (dateStr) => [
            { type: 'Walking', start: new Date('2026-10-08T08:00:00').getTime(), end: new Date('2026-10-08T08:26:00').getTime(), durationMins: 26 },
            { type: 'Other Workout', start: new Date('2026-10-08T11:30:00').getTime(), end: new Date('2026-10-08T11:45:00').getTime(), durationMins: 15 }
        ],
        postExerciseSession: async (name, start, end) => {
            pushed.push({ name, start, end });
            return true;
        }
    };

    let writtenFm = {
        workout: 'Exercises: Phase 1 (15m), Gym Session (30m)',
        active_minutes: '45'
    };

    const mockApp = {
        vault: {
            read: async () => `- [focus:: Gym Session] [start-time:: 14:00:00] [completed-time:: 14:30:00]`
        },
        metadataCache: {
            getFileCache: () => ({ frontmatter: writtenFm })
        },
        fileManager: {
            processFrontMatter: async (file, fn) => {
                fn(writtenFm);
            }
        }
    };

    const service = new WorkoutSyncService(mockApp, { enableBidirectionalWorkouts: true }, mockHealthService);

    // Test parser & serializer
    const parsed = service.parseWorkoutString('Exercises: Phase 1 (15m), Walking (26m)');
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].title, 'Exercises: Phase 1');
    assert.equal(parsed[0].durationMins, 15);
    assert.equal(service.serializeWorkouts(parsed), 'Exercises: Phase 1 (15m), Walking (26m)');

    // Test reconciliation
    const result = await service.reconcileWorkouts({ basename: '2026-10-08' }, { pushToCloud: true });

    // 1. "Exercises: Phase 1 (15m)" matches cloud "Other Workout (15m)" -> upgraded title, not pushed
    // 2. "Gym Session (30m)" is missing from cloud -> pushed to Google Health API!
    assert.equal(result.pushedCount, 1);
    assert.equal(pushed[0].name, 'Gym Session');
    assert.equal(pushed[0].start, '2026-10-08T14:00:00');

    // 3. Cloud "Walking (26m)" was pulled into frontmatter
    assert.equal(result.pulledCount, 1);
    assert.ok(writtenFm.workout.includes('Walking (26m)'));
    assert.ok(writtenFm.workout.includes('Exercises: Phase 1 (15m)'));
    assert.ok(writtenFm.workout.includes('Gym Session (30m)'));

    // 4. Total active minutes should be 15 + 30 + 26 = 71
    assert.equal(result.activeMinutes, 71);
    assert.equal(writtenFm.active_minutes, '71');
});



