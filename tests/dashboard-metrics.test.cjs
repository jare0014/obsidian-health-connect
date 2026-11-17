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
    const wrappedRequire = (id) => {
        if (id.startsWith('.')) {
            const resolvedPath = path.resolve(path.dirname(filePath), id.endsWith('.ts') ? id : id + '.ts');
            if (fs.existsSync(resolvedPath)) {
                return loadTsModule(resolvedPath, mockRequire);
            }
        }
        if (mockRequire) {
            const res = mockRequire(id);
            if (res && (Object.keys(res).length > 0 || typeof res === 'function')) return res;
        }
        return {};
    };
    fn(mod.exports, wrappedRequire, mod, filePath, path.dirname(filePath));
    return mod.exports;
}

test('nutrition timestamps preserve the selected local day and reject invalid dates', () => {
    const { parseNutritionLogTime, nutritionLogInterval } = loadTsModule(
        path.join(__dirname, '../src/services/NutritionLogTime.ts')
    );
    const dinner = parseNutritionLogTime('2026-11-15', '20:17');
    assert.equal(dinner.getDate(), 15);
    assert.equal(dinner.getHours(), 20);
    for (const [date, time] of [['2026-11-15', '00:00'], ['2026-11-15', '23:59'], ['2026-07-15', '20:17']]) {
        const selected = parseNutritionLogTime(date, time);
        const interval = nutritionLogInterval(selected);
        const start = new Date(interval.startTime);
        const end = new Date(interval.endTime);
        assert.equal(start.getDate(), selected.getDate());
        assert.equal(end.getDate(), selected.getDate());
        assert.ok(end > start);
        assert.equal(interval.endUtcOffset, `${-selected.getTimezoneOffset() * 60}s`);
    }
    assert.throws(() => parseNutritionLogTime('2026-02-30', '20:17'));
    assert.throws(() => parseNutritionLogTime('', '20:17'));
    assert.throws(() => parseNutritionLogTime('2026-11-15', '24:00'));
    assert.throws(() => nutritionLogInterval(new Date('invalid')));
});

test('nutrition sync reads every page and rejects incomplete history', async () => {
    const { GoogleHealthService } = loadTsModule(path.join(__dirname, '../src/services/GoogleHealthService.ts'));
    const service = new GoogleHealthService({}, {});
    const urls = [];
    service.fetchWithTimeout = async url => {
        urls.push(url);
        return { ok: true, json: async () => urls.length === 1
            ? { dataPoints: [{ name: 'first' }], nextPageToken: 'next/page' }
            : { dataPoint: [{ name: 'backdated' }] } };
    };
    assert.deepEqual((await service.fetchNutritionDataPoints({})).dataPoints.map(p => p.name), ['first', 'backdated']);
    assert.match(urls[1], /pageToken=next%2Fpage/);
    service.fetchWithTimeout = async () => ({ ok: false });
    await assert.rejects(service.fetchNutritionDataPoints({}), /complete nutrition history/);
    service.fetchWithTimeout = async () => ({ ok: true, json: async () => ({ nextPageToken: 'repeated' }) });
    await assert.rejects(service.fetchNutritionDataPoints({}), /Repeated/);
});

test('nutrition, hydration and alcohol posts use the supplied timestamp', async () => {
    const { GoogleHealthService } = loadTsModule(
        path.join(__dirname, '../src/services/GoogleHealthService.ts')
    );
    const service = new GoogleHealthService({}, { getAccessToken: async () => 'test-token' });
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, payload: JSON.parse(options.body) });
        return { ok: true, status: 201 };
    };
    try {
        const when = new Date(2026, 10, 15, 20, 17);
        for (const food of [
            { id: 'salad', name: 'Spinach salad', category: 'nutrition', calories: 170, proteinG: 3 },
            { id: 'water', name: 'Water', category: 'hydration', waterMl: 355 },
            { id: 'wine', name: 'Wine', category: 'alcohol', alcoholMg: 14000 }
        ]) assert.equal(await service.postFoodOrDrink(food, 1, when), true);
        for (const { payload } of calls) {
            const log = payload.nutritionLog || payload.hydrationLog || payload.alcoholConsumption;
            assert.equal(log.interval.endTime, when.toISOString());
        }
        assert.equal(calls[0].payload.nutritionLog.energy.kcal, 170);
        assert.equal(calls[0].payload.nutritionLog.nutrients[0].quantity.grams, 3);
        await service.postFoodOrDrink({ name: 'Snack', category: 'nutrition' });
        assert.ok(Math.abs(Date.now() - Date.parse(calls[3].payload.nutritionLog.interval.endTime)) < 5000);
    } finally {
        global.fetch = originalFetch;
    }
});

test('beer posts through nutrition with calories and declared alcohol preserved; failures expose API errors', async () => {
    const { GoogleHealthService } = loadTsModule(path.join(__dirname, '../src/services/GoogleHealthService.ts'));
    const service = new GoogleHealthService({}, { getAccessToken: async () => 'test-token' });
    const originalFetch = global.fetch;
    let posted;
    global.fetch = async (url, options) => {
        assert.match(url, /nutrition-log\/dataPoints$/);
        posted = JSON.parse(options.body);
        return { ok: true, status: 201 };
    };
    try {
        const when = new Date(2026, 10, 15, 19, 52);
        const beer = { name: 'Modelo Especial Beer', category: 'alcohol', calories: 144, alcoholMg: 20600 };
        assert.equal(await service.postFoodOrDrink(beer, 2.5, when), true);
        assert.equal(posted.nutritionLog.energy.kcal, 360);
        assert.equal(posted.nutritionLog.foodDisplayName, 'Modelo Especial Beer [51.5 g alcohol]');
        assert.equal(posted.nutritionLog.interval.endTime, when.toISOString());
        assert.deepEqual(posted.nutritionLog.nutrients, []);
        assert.equal(service.parseNutritionPayload({ dataPoints: [posted] }, '2026-11-15').alcohol, 52);
        assert.equal(service.parseNutritionPayload({ dataPoints: [posted] }, '2026-11-16').alcohol, undefined);
        global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid data type' } }) });
        assert.equal(await service.postFoodOrDrink(beer, 2.5, when), false);
        assert.equal(service.lastApiError, 'HTTP 400: Invalid data type');
    } finally { global.fetch = originalFetch; }
});

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

test('nutrition form posts the selected day and refreshes that note', async () => {
    const controls = [];
    const notices = [];
    const makeControl = () => {
        const control = { inputEl: {}, onChange(fn) { this.change = fn; return this; }, onClick(fn) { this.click = fn; return this; } };
        for (const method of ['setValue', 'addOptions', 'setLimits', 'setDynamicTooltip', 'setButtonText', 'setCta', 'setDisabled']) {
            control[method] = () => control;
        }
        controls.push(control);
        return control;
    };
    class Setting {
        setName() { return this; }
        setDesc() { return this; }
        addText(fn) { fn(makeControl()); return this; }
        addDropdown(fn) { fn(makeControl()); return this; }
        addSlider(fn) { fn(makeControl()); return this; }
        addButton(fn) { fn(makeControl()); return this; }
    }
    const { HealthHubModal } = loadTsModule(path.join(__dirname, '../src/views/HealthHubModal.ts'), id =>
        id === 'obsidian' ? { Setting, Modal: class { close() {} }, Notice: class { constructor(message) { notices.push(message); } } } : {}
    );
    const posts = [];
    const syncs = [];
    const modal = new HealthHubModal({}, {
        healthService: { postFoodOrDrink: async (...args) => { posts.push(args); return true; } },
        syncDateHealth: async date => syncs.push(date),
        syncTodayHealth: () => { throw new Error('Should sync selected day'); }
    });
    modal.loadFoodRegistry = async () => [{ id: 'salad', name: 'Spinach salad', unit: 'serving', calories: 170 }];
    await modal.renderLogNutrition(createMockElement());
    assert.equal(controls[0].inputEl.type, 'date');
    assert.equal(controls[1].inputEl.type, 'time');
    controls[0].change('2026-11-15');
    controls[1].change('20:17');
    const submit = controls.find(control => control.click);
    await submit.click();
    assert.equal(posts[0][2].getDate(), 15);
    assert.equal(posts[0][2].getHours(), 20);
    assert.deepEqual(syncs, ['2026-11-15']);
    controls[0].change('');
    await submit.click();
    assert.equal(posts.length, 1);
    assert.match(notices.at(-1), /valid date/);
});

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
    // 4. Biometric active_minutes is preserved and NOT incremented by focus timer workouts
    assert.equal(reconciled.active_minutes, 14);
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

test('localReconcileWorkouts consolidates multi-segment same-title focus sessions and deducts unresumed pauses', async () => {
    const extractorsPath = fs.existsSync(path.join(__dirname, '../src/extractors/localExtractors.ts'))
        ? path.join(__dirname, '../src/extractors/localExtractors.ts')
        : path.join(__dirname, '../src/extractors/defaultExtractors.ts');
    const { localReconcileWorkouts } = loadTsModule(extractorsPath, () => ({}));
    if (typeof localReconcileWorkouts !== 'function') return;

    // Segment 1: 10:37:15 to 10:52:43 (15m 28s), paused 10:44:33 to 10:50:00 (5m 27s) -> 10m net
    // Segment 2: 10:52:50 to 10:55:40 (2m 50s) -> 3m net
    // Total should be 13m
    const mockNoteContent = `---
date: 2026-10-12
workout: Walking (15m)
active_minutes: 28
---
### Focus Log
- [focus:: Exercises: Phase 1] [start-time:: 10:37:15] [pause-start:: 10:44:33] [pause-end:: 10:50:00] [completed-time:: 10:52:43]
- [focus:: Exercises: Phase 1] [start-time:: 10:52:50] [pause-start:: ] [pause-end:: ] [completed-time:: 10:55:40]
`;

    const mockApp = {
        vault: {
            read: async () => mockNoteContent
        },
        metadataCache: {
            getFileCache: () => ({
                frontmatter: {
                    workout: "Walking (15m)",
                    active_minutes: "28"
                }
            })
        }
    };

    const mockFile = { basename: '2026-10-12' };
    const incomingData = {
        workout: "Walking (15m)",
        active_minutes: 28
    };

    const reconciled = await localReconcileWorkouts(mockFile, incomingData, mockApp);

    // 1. Should contain Walking (15m) and consolidated Exercises: Phase 1 (13m)
    assert.ok(reconciled.workout.includes("Walking (15m)"));
    assert.ok(reconciled.workout.includes("Exercises: Phase 1 (13m)"));
    // 2. Active minutes remains 28 (biometric), NOT 28 + 13
    assert.equal(reconciled.active_minutes, 28);
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
        },
        fetchMindfulnessSessionsForDate: async () => [],
        postMindfulnessSession: async () => true
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

    // Test parser & serializer with standard format
    const parsed = service.parseWorkoutString('Exercises: Phase 1 (15m), Walking (26m)');
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].title, 'Exercises: Phase 1');
    assert.equal(parsed[0].durationMins, 15);
    assert.equal(service.serializeWorkouts(parsed), 'Exercises: Phase 1 (15m), Walking (26m)');

    // Test parser with flexible manual formats (unparenthesized, mins, arrays)
    const manualParsed = service.parseWorkoutString(['Walking 30m', 'Gym Session 45 mins', '20m Yoga', 'Running']);
    assert.equal(manualParsed.length, 4);
    assert.equal(manualParsed[0].title, 'Walking');
    assert.equal(manualParsed[0].durationMins, 30);
    assert.equal(manualParsed[1].title, 'Gym Session');
    assert.equal(manualParsed[1].durationMins, 45);
    assert.equal(manualParsed[2].title, 'Yoga');
    assert.equal(manualParsed[2].durationMins, 20);
    assert.equal(manualParsed[3].title, 'Running');
    assert.equal(manualParsed[3].durationMins, 0);

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

    // 4. Total duration minutes should be 15 + 30 + 26 = 71
    assert.equal(result.durationMinutes, 71);
    // Biometric active_minutes in frontmatter is preserved and NOT overwritten by workout sync
    assert.equal(writtenFm.active_minutes, '45');
});

test('WorkoutSyncService reconciles mindfulness frontmatter from note focus log without cloud upload', async () => {
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

    let writtenFm = {
        workout: '',
        mindfulness_minutes: '15'
    };

    const mockApp = {
        vault: {
            read: async () => `- [focus:: Meditation] [start-time:: 06:15:00] [completed-time:: 06:30:00]`
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

    const service = new WorkoutSyncService(mockApp, { enableBidirectionalMindfulness: false }, {});
    const result = await service.reconcileMindfulness({ basename: '2026-10-08' });

    assert.equal(result.pushed, false);
    assert.equal(result.minutes, 15);
});

test('WorkoutSyncService reconciles mindfulness frontmatter by uploading missing session to Google Health when enabled', async () => {
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

    const pushedMindfulness = [];
    const mockHealthService = {
        fetchMindfulnessSessionsForDate: async () => [],
        postMindfulnessSession: async (start, end, title) => {
            pushedMindfulness.push({ start, end, title });
            return true;
        }
    };

    let writtenFm = {
        workout: '',
        mindfulness_minutes: '15'
    };

    const mockApp = {
        vault: {
            read: async () => `- [focus:: Meditation] [start-time:: 06:15:00] [completed-time:: 06:30:00]`
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

    const service = new WorkoutSyncService(mockApp, { enableBidirectionalMindfulness: true }, mockHealthService);
    const result = await service.reconcileMindfulness({ basename: '2026-10-08' }, { pushToCloud: true });

    assert.equal(result.pushed, true);
    assert.equal(result.minutes, 15);
    assert.equal(pushedMindfulness.length, 1);
    assert.equal(pushedMindfulness[0].start, '2026-10-08T06:15:00');
    assert.equal(pushedMindfulness[0].end, '2026-10-08T06:30:00');
});

test('HealthSettings provides workoutRegistry and mindfulnessRegistry with default presets', () => {
    const { DEFAULT_SETTINGS, DEFAULT_WORKOUT_ITEMS, DEFAULT_MINDFULNESS_ITEMS } = loadTsModule(
        path.join(__dirname, '../src/models/HealthSettings.ts')
    );

    assert.ok(Array.isArray(DEFAULT_SETTINGS.workoutRegistry));
    assert.ok(DEFAULT_SETTINGS.workoutRegistry.length >= 7);
    assert.ok(DEFAULT_SETTINGS.workoutRegistry.some(w => w.id === 'walking' && w.googleHealthType === 'WALKING'));
    assert.ok(DEFAULT_SETTINGS.workoutRegistry.some(w => w.id === 'strength_training' && w.googleHealthType === 'STRENGTH_TRAINING'));

    assert.ok(Array.isArray(DEFAULT_SETTINGS.mindfulnessRegistry));
    assert.ok(DEFAULT_SETTINGS.mindfulnessRegistry.length >= 4);
    assert.ok(DEFAULT_SETTINGS.mindfulnessRegistry.some(m => m.id === 'meditation' && m.defaultDurationMins === 15));
    assert.ok(DEFAULT_SETTINGS.mindfulnessRegistry.some(m => m.id === 'breathwork' && m.defaultDurationMins === 10));
});

test('splitWorkoutEntries preserves commas inside parentheses and parses workout entries correctly', () => {
    const { splitWorkoutEntries, WorkoutSyncService } = loadTsModule(
        path.join(__dirname, '../src/services/WorkoutSyncService.ts'),
        (id) => {
            if (id === 'obsidian') return { App: class {}, TFile: class {}, Notice: class {} };
            if (id === './GoogleHealthService') return { GoogleHealthService: class {} };
            return {};
        }
    );

    const rawStr = "Exercises: Phase 1 (10m), Exercises: Phase 2 (Workout B — Glutes, Calves & Vertical Pull Anchor) (11m), Exercises: Phase 3 (9m), Walking (14m)";
    const parts = splitWorkoutEntries(rawStr);

    assert.equal(parts.length, 4);
    assert.equal(parts[0], "Exercises: Phase 1 (10m)");
    assert.equal(parts[1], "Exercises: Phase 2 (Workout B — Glutes, Calves & Vertical Pull Anchor) (11m)");
    assert.equal(parts[2], "Exercises: Phase 3 (9m)");
    assert.equal(parts[3], "Walking (14m)");

    const service = new WorkoutSyncService({}, {}, {});
    const parsed = service.parseWorkoutString(rawStr);
    assert.equal(parsed.length, 4);
    assert.equal(parsed[1].title, "Exercises: Phase 2 (Workout B — Glutes, Calves & Vertical Pull Anchor)");
    assert.equal(parsed[1].durationMins, 11);
});

test('FormulaEvaluator parses HH:MM time strings into decimal hours and evaluates last_sleep lookback', () => {
    const { FormulaEvaluator } = loadTsModule(
        path.join(__dirname, '../src/services/FormulaEvaluator.ts')
    );

    // Context with Sleep_hours as "7:30" (7.5h) and last_sleep as "6:15" (6.25h)
    const context = {
        Sleep_hours: "7:30",
        last_sleep: "6:15",
        caffeine: 100
    };

    // Test decimal conversion of time string
    const sleepVal = FormulaEvaluator.evaluate("Sleep_hours", context);
    assert.equal(sleepVal, 7.5);

    const lastSleepVal = FormulaEvaluator.evaluate("last_sleep", context);
    assert.equal(lastSleepVal, 6.25);

    // Test cross-day composite metric
    const rollingSleep = FormulaEvaluator.evaluate("(Sleep_hours + last_sleep) / 2", context);
    assert.equal(rollingSleep, 6.875);

    // Test missing last_ variable defaults to 0 without error
    const withMissing = FormulaEvaluator.evaluate("Sleep_hours - last_hrv", { Sleep_hours: "8:00" });
    assert.equal(withMissing, 8);
});

test('FormulaEvaluator supports rolling window lookbacks and nested math functions', () => {
    const { FormulaEvaluator } = loadTsModule(
        path.join(__dirname, '../src/services/FormulaEvaluator.ts')
    );

    // Mock lookback provider for jar and weight
    const mockLookback = (key, days) => {
        if (key.toLowerCase() === 'jar') {
            // 45-day history: peak was 77.4
            return [66.7, 72.1, 77.4, 75.0, 70.2];
        }
        if (key.toLowerCase() === 'weight') {
            return [175, 174.5, 173, 172.5];
        }
        return [];
    };

    const context = { jar: 66.7, weight: 172.5 };

    // 1. Variable extraction ignores function names
    const vars = FormulaEvaluator.extractVariables("max(0, round(28 - (rolling_max(jar, 45) - jar), 1))");
    assert.deepEqual(vars, ["jar"]);

    // 2. Rolling max calculation
    const maxJar = FormulaEvaluator.evaluate("rolling_max(jar, 45)", context, mockLookback);
    assert.equal(maxJar, 77.4);

    // 3. Stash remaining formula: 28 - (77.4 - 66.7) = 28 - 10.7 = 17.3
    const stashFormula = "round(28 - (rolling_max(jar, 45) - jar), 1)";
    const stashVal = FormulaEvaluator.evaluate(stashFormula, context, mockLookback);
    assert.equal(stashVal, 17.3);

    // 4. Nested math functions: max(0, ...), min, abs, sqrt
    const clamped = FormulaEvaluator.evaluate("max(0, round(28 - (rolling_max(jar, 45) - jar), 1))", context, mockLookback);
    assert.equal(clamped, 17.3);

    // Test rolling_min and rolling_avg
    const minWeight = FormulaEvaluator.evaluate("rolling_min(weight, 30)", context, mockLookback);
    assert.equal(minWeight, 172.5);

    const avgWeight = FormulaEvaluator.evaluate("round(rolling_avg(weight, 30), 2)", context, mockLookback);
    assert.equal(avgWeight, 173.75);

    // 5. Formula validation allows rolling window and math functions
    const valid = FormulaEvaluator.validateFormula("max(0, 28 - (rolling_max(jar, 45) - jar))");
    assert.equal(valid.valid, true);
});

test('WorkoutSyncService deduplicates generic Calisthenics and matches specific exercise sessions idempotently', async () => {
    const { deduplicateWorkouts, WorkoutSyncService } = loadTsModule(
        path.join(__dirname, '../src/services/WorkoutSyncService.ts'),
        (id) => {
            if (id === 'obsidian') return { App: class {}, TFile: class {}, Notice: class {} };
            if (id === './GoogleHealthService') return { GoogleHealthService: class {} };
            return {};
        }
    );

    // 1. Test standalone deduplicateWorkouts helper
    const rawSessions = [
        { title: "Exercises: Phase 1", durationMins: 11 },
        { title: "Exercises: Phase 2", durationMins: 6 },
        { title: "Calisthenics", durationMins: 11 }, // Redundant generic duplicate of Phase 1!
        { title: "Calisthenics", durationMins: 11 }, // Repeated generic duplicate!
        { title: "Exercises: Phase 3", durationMins: 11 },
        { title: "Calisthenics", durationMins: 11 }, // Repeated generic duplicate!
        { title: "Cardio Workout", durationMins: 20 },
        { title: "Walking", durationMins: 13 },
        { title: "Walking", durationMins: 12 } // Fuzzy duplicate from dual tracker (within 1 min)!
    ];

    const deduped = deduplicateWorkouts(rawSessions);
    assert.equal(deduped.length, 5);
    assert.deepEqual(deduped.map(d => `${d.title} (${d.durationMins}m)`), [
        "Exercises: Phase 1 (11m)",
        "Exercises: Phase 2 (6m)",
        "Exercises: Phase 3 (11m)",
        "Cardio Workout (20m)",
        "Walking (13m)"
    ]);

    // 1b. Test timestamp overlap deduplication between cloud sessions
    const overlappingCloud = [
        { title: "Walking", durationMins: 13, startTime: "2026-10-15T10:00:00.000Z", endTime: "2026-10-15T10:13:00.000Z" },
        { title: "Walking", durationMins: 12, startTime: "2026-10-15T10:01:00.000Z", endTime: "2026-10-15T10:13:00.000Z" }
    ];
    const dedupedCloud = deduplicateWorkouts(overlappingCloud);
    assert.equal(dedupedCloud.length, 1);
    assert.equal(dedupedCloud[0].durationMins, 13);

    // 1c. Test distant sessions remain separate
    const distantWalks = [
        { title: "Walking", durationMins: 30, startTime: "2026-10-15T08:00:00.000Z", endTime: "2026-10-15T08:30:00.000Z" },
        { title: "Walking", durationMins: 30, startTime: "2026-10-15T18:00:00.000Z", endTime: "2026-10-15T18:30:00.000Z" }
    ];
    const dedupedDistant = deduplicateWorkouts(distantWalks);
    assert.equal(dedupedDistant.length, 2);

    // 2. Test reconcileWorkouts matching generic cloud "Calisthenics" with specific local "Exercises: Phase 1"
    const pushed = [];
    const mockHealthService = {
        fetchExerciseSessionsForDate: async () => [
            // Cloud has 1 Calisthenics session recorded from Google Health / wearable
            { type: 'Calisthenics', start: new Date('2026-10-14T13:10:00').getTime(), end: new Date('2026-10-14T13:21:00').getTime(), durationMins: 11 }
        ],
        postExerciseSession: async (name, start, end) => {
            pushed.push({ name, start, end });
            return true;
        },
        fetchMindfulnessSessionsForDate: async () => [],
        postMindfulnessSession: async () => true
    };

    let writtenFm = {
        workout: "Exercises: Phase 1 (11m), Exercises: Phase 2 (6m), Calisthenics (11m), Calisthenics (11m), Exercises: Phase 3 (11m)"
    };

    const mockApp = {
        vault: {
            read: async () => `
- [focus:: Exercises: Phase 1] [start-time:: 13:10:15] [completed-time:: 13:21:16]
- [focus:: Exercises: Phase 2] [start-time:: 13:21:55] [completed-time:: 13:28:21]
- [focus:: Exercises: Phase 3] [start-time:: 13:28:24] [completed-time:: 13:38:55]
`
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
    const result = await service.reconcileWorkouts({ basename: '2026-10-14' }, { pushToCloud: true });

    // Exercises: Phase 1 matched cloud Calisthenics -> NOT pushed
    // Exercises: Phase 2 & Phase 3 are missing in cloud -> pushed
    // Calisthenics duplicates were PRUNED, not pushed!
    assert.equal(result.pushedCount, 2);
    assert.deepEqual(pushed.map(p => p.name), ["Exercises: Phase 2", "Exercises: Phase 3"]);

    // No extra "Calisthenics" pulled down from cloud
    assert.equal(result.pulledCount, 0);

    // Frontmatter contains clean deduped sessions
    assert.equal(writtenFm.workout, "Exercises: Phase 1 (11m), Exercises: Phase 2 (6m), Exercises: Phase 3 (11m)");
});

test('WorkoutSyncService deduplicates generic Strength Training sessions from Google Health into specific Phase exercises', async () => {
    const { deduplicateWorkouts, WorkoutSyncService } = loadTsModule(
        path.join(__dirname, '../src/services/WorkoutSyncService.ts'),
        (id) => {
            if (id === 'obsidian') return { App: class {}, TFile: class {}, Notice: class {} };
            if (id === './GoogleHealthService') return { GoogleHealthService: class {} };
            return {};
        }
    );

    // 1. Standalone deduplicateWorkouts with Strength Training duplicates
    const rawSessions = [
        { title: "Exercises: Phase 1", durationMins: 12 },
        { title: "Exercises: Phase 3", durationMins: 11 },
        { title: "Strength Training", durationMins: 12 }, // Cloud session matching Phase 2
        { title: "Strength Training", durationMins: 10 }  // Cloud session matching Phase 3
    ];

    // Exercises: Phase 3 (11m) collapses with Strength Training (10m) within 5m
    const deduped = deduplicateWorkouts(rawSessions);
    assert.ok(deduped.some(w => w.title === "Exercises: Phase 1" && w.durationMins === 12));
    assert.ok(deduped.some(w => w.title === "Exercises: Phase 3" && w.durationMins === 11));
    // Both generic Strength Training sessions were collapsed into Phase 1 and Phase 3!
    assert.equal(deduped.filter(w => w.title.toLowerCase().includes("strength training")).length, 0);

    // 2. Full bidirectional reconciliation with timestamps from Focus Log
    const cloudSessions = [
        { type: "Strength Training", start: new Date("2026-10-17T11:33:00").getTime(), end: new Date("2026-10-17T11:45:00").getTime(), durationMins: 12 },
        { type: "Strength Training", start: new Date("2026-10-17T11:45:00").getTime(), end: new Date("2026-10-17T11:56:00").getTime(), durationMins: 11 }
    ];

    const pushed = [];
    const mockHealthService = {
        fetchExerciseSessionsForDate: async () => cloudSessions,
        postExerciseSession: async (name, start, end) => {
            pushed.push({ name, start, end });
            return true;
        },
        fetchMindfulnessSessionsForDate: async () => [],
        postMindfulnessSession: async () => true
    };

    let writtenFm = {
        workout: "Exercises: Phase 1 (12m), Exercises: Phase 2 (12m), Exercises: Phase 3 (11m)"
    };

    const mockApp = {
        vault: {
            read: async () => `
- [focus:: Exercises: Phase 1] [start-time:: 11:22:19] [completed-time:: 11:32:22]
- [focus:: Exercises: Phase 2] [start-time:: 11:33:44] [completed-time:: 11:45:46]
- [focus:: Exercises: Phase 3] [start-time:: 11:45:53] [completed-time:: 11:56:54]
`
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
    const result = await service.reconcileWorkouts({ basename: '2026-10-17' }, { pushToCloud: true });

    // Phase 1 missing in cloud -> pushed
    assert.equal(result.pushedCount, 1);
    assert.equal(pushed[0].name, "Exercises: Phase 1");

    // Both Strength Training sessions matched Phase 2 and Phase 3 -> zero generic pulled!
    assert.equal(result.pulledCount, 0);

    // Frontmatter retains clean specific names without "Strength Training" duplicate spam!
    assert.equal(writtenFm.workout, "Exercises: Phase 1 (12m), Exercises: Phase 2 (12m), Exercises: Phase 3 (11m)");
});



test('DailyNoteWriter resolveTemplateContent uses Daily Note Template and interpolates Templater date tokens', async () => {
    let MockTFile;
    const mockMoment = (dateStr) => ({
        isValid: () => true,
        format: (fmt) => {
            if (fmt === 'dddd MMMM Do YYYY') return 'Sunday November 8th 2026';
            if (fmt === 'YYYY-[W]WW') return '2026-W45';
            return fmt;
        }
    });

    const { DailyNoteWriter } = loadTsModule(
        path.join(__dirname, '../src/services/DailyNoteWriter.ts'),
        (id) => {
            if (id === 'obsidian') {
                MockTFile = class TFile {};
                return {
                    TFile: MockTFile,
                    moment: mockMoment,
                    normalizePath: (p) => p.replace(/\\/g, '/').replace(/\/+/g, '/')
                };
            }
            return {};
        }
    );

    const templateRaw = `---
jar: ""
First_dab: ""
Puffco_odometer: ""
Sleep_hours: ""
---
## Day Planner
[[Portfolio Analysis and Market Report - <% tp.date.now("dddd MMMM Do YYYY", 0, tp.file.title, "YYYY-MM-DD") %>]]
![[<% tp.date.now("YYYY-[W]WW", 0, tp.file.title, "YYYY-MM-DD") %>#Budget Remaining|Weekly Budget Remaining]]
`;

    const mockApp = {
        vault: {
            getAbstractFileByPath: (p) => {
                if (p.includes('Daily Note Template.md')) {
                    return new MockTFile();
                }
                return null;
            },
            read: async () => templateRaw
        },
        plugins: {
            plugins: {
                'templater-obsidian': {
                    settings: {
                        folder_templates: [
                            { folder: '02_Journal/01_Daily', template: '99_System/Templates/Daily Note Template.md' }
                        ]
                    }
                }
            }
        }
    };

    globalThis.moment = mockMoment;

    const writer = new DailyNoteWriter(mockApp, { dailyNotesFolder: '02_Journal/01_Daily' });
    const content = await writer.resolveTemplateContent('2026-11-08');

    assert.ok(content.includes('jar: ""'));
    assert.ok(content.includes('[[Portfolio Analysis and Market Report - Sunday November 8th 2026]]'));
    assert.ok(content.includes('![[2026-W45#Budget Remaining|Weekly Budget Remaining]]'));
    assert.ok(!content.includes('<%'));
});

test('WorkoutDeduplicator only merges on exercise type when at least one entry is generic', () => {
    const { deduplicateWorkouts } = loadTsModule(
        path.join(__dirname, '../src/services/WorkoutDeduplicator.ts'),
        () => ({})
    );

    // 1. Two specific exercises sharing the same type (Strength Training) with overlapping intervals
    // should NOT merge into each other.
    const overlappingSpecific = [
        {
            title: "Exercises: Phase 2",
            durationMins: 11,
            startTime: "2026-11-14T11:54:00.000Z",
            endTime: "2026-11-14T12:25:00.000Z"
        },
        {
            title: "Exercises: Phase 3",
            durationMins: 10,
            startTime: "2026-11-14T12:05:00.000Z",
            endTime: "2026-11-14T12:15:00.000Z"
        }
    ];

    const dedupedSpecific = deduplicateWorkouts(overlappingSpecific);
    assert.equal(dedupedSpecific.length, 2);
    assert.ok(dedupedSpecific.some(w => w.title === "Exercises: Phase 2" && w.durationMins === 11));
    assert.ok(dedupedSpecific.some(w => w.title === "Exercises: Phase 3" && w.durationMins === 10));

    // 2. A generic entry (Strength Training) overlapping with a specific entry (Exercises: Phase 2)
    // SHOULD merge and upgrade the generic entry to the specific title.
    const genericAndSpecific = [
        {
            title: "Strength Training",
            durationMins: 12,
            startTime: "2026-11-14T11:54:00.000Z",
            endTime: "2026-11-14T12:06:00.000Z"
        },
        {
            title: "Exercises: Phase 2",
            durationMins: 11,
            startTime: "2026-11-14T11:54:00.000Z",
            endTime: "2026-11-14T12:05:00.000Z"
        }
    ];

    const dedupedGeneric = deduplicateWorkouts(genericAndSpecific);
    assert.equal(dedupedGeneric.length, 1);
    assert.equal(dedupedGeneric[0].title, "Exercises: Phase 2");
    assert.equal(dedupedGeneric[0].durationMins, 12);
});

test('localReconcileWorkouts preserves sequential back-to-back exercise sessions of same title for Track A and Track B', async () => {
    const { localReconcileWorkouts } = loadTsModule(
        path.join(__dirname, '../src/extractors/localExtractors.ts'),
        (id) => {
            if (id === 'obsidian') return { TFile: class {} };
            return {};
        }
    );

    const mockNoteContent = `
## Focus Log
- [focus:: Exercises: Phase 2] [start-time:: 11:54:00] [completed-time:: 12:05:00]
- [focus:: Exercises: Phase 3] [start-time:: 12:05:00] [completed-time:: 12:15:00]
- [focus:: Exercises: Phase 2] [start-time:: 12:15:00] [completed-time:: 12:25:00]
- [focus:: Exercises: Phase 3] [start-time:: 12:25:00] [completed-time:: 12:35:00]
`;

    const mockApp = {
        vault: {
            read: async () => mockNoteContent
        },
        metadataCache: {
            getFileCache: () => ({
                frontmatter: {}
            })
        }
    };

    const mockFile = { basename: '2026-11-14' };
    const incomingData = {};

    const reconciled = await localReconcileWorkouts(mockFile, incomingData, mockApp);

    // Frontmatter should preserve all 4 distinct sessions
    const parts = reconciled.workout.split(',').map(s => s.trim());
    assert.equal(parts.length, 4);
    assert.equal(parts.filter(p => p.includes("Exercises: Phase 2")).length, 2);
    assert.equal(parts.filter(p => p.includes("Exercises: Phase 3")).length, 2);
});

test('WorkoutSyncService extracts distinct sequential intervals and preserves back-to-back exercise sessions', async () => {
    const { WorkoutSyncService } = loadTsModule(
        path.join(__dirname, '../src/services/WorkoutSyncService.ts'),
        (id) => {
            if (id === 'obsidian') return { App: class {}, TFile: class {}, Notice: class {} };
            if (id === './GoogleHealthService') return { GoogleHealthService: class {} };
            return {};
        }
    );

    const mockNoteContent = `
## Focus Log
- [focus:: Exercises: Phase 2] [start-time:: 11:54:00] [completed-time:: 12:05:00]
- [focus:: Exercises: Phase 3] [start-time:: 12:05:00] [completed-time:: 12:15:00]
- [focus:: Exercises: Phase 2] [start-time:: 12:15:00] [completed-time:: 12:25:00]
- [focus:: Exercises: Phase 3] [start-time:: 12:25:00] [completed-time:: 12:35:00]
`;

    const pushed = [];
    const mockHealthService = {
        fetchExerciseSessionsForDate: async () => [],
        postExerciseSession: async (name, start, end) => {
            pushed.push({ name, start, end });
            return true;
        },
        fetchMindfulnessSessionsForDate: async () => [],
        postMindfulnessSession: async () => true
    };

    let writtenFm = {
        workout: "Exercises: Phase 2 (11m), Exercises: Phase 3 (10m), Exercises: Phase 2 (10m), Exercises: Phase 3 (10m)"
    };

    const mockApp = {
        vault: {
            read: async () => mockNoteContent
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

    // 1. Verify extractTimestampsFromNote extracts distinct intervals
    const tsMap = await service.extractTimestampsFromNote({ basename: '2026-11-14' });
    const p2List = tsMap.get("exercises: phase 2");
    assert.equal(p2List.length, 2);
    assert.deepEqual(p2List[0], { start: '11:54:00', end: '12:05:00' });
    assert.deepEqual(p2List[1], { start: '12:15:00', end: '12:25:00' });

    const p3List = tsMap.get("exercises: phase 3");
    assert.equal(p3List.length, 2);
    assert.deepEqual(p3List[0], { start: '12:05:00', end: '12:15:00' });
    assert.deepEqual(p3List[1], { start: '12:25:00', end: '12:35:00' });

    // 2. Reconcile workouts
    const result = await service.reconcileWorkouts({ basename: '2026-11-14' }, { pushToCloud: true });

    // All 4 distinct workouts should be pushed to cloud
    assert.equal(result.pushedCount, 4);
    assert.equal(pushed.length, 4);
    assert.equal(pushed[0].name, "Exercises: Phase 2");
    assert.equal(pushed[0].start, "2026-11-14T11:54:00");
    assert.equal(pushed[1].name, "Exercises: Phase 3");
    assert.equal(pushed[1].start, "2026-11-14T12:05:00");
    assert.equal(pushed[2].name, "Exercises: Phase 2");
    assert.equal(pushed[2].start, "2026-11-14T12:15:00");
    assert.equal(pushed[3].name, "Exercises: Phase 3");
    assert.equal(pushed[3].start, "2026-11-14T12:25:00");

    // Frontmatter retains all 4 distinct workouts
    const parts = writtenFm.workout.split(',').map(s => s.trim());
    assert.equal(parts.length, 4);
});

test('deduplicateWorkouts preserves multi-session workout sequences without timestamps', () => {
    const { deduplicateWorkouts, splitWorkoutEntries, parseSingleWorkoutEntry, serializeWorkouts } = loadTsModule(
        path.join(__dirname, '../src/services/WorkoutDeduplicator.ts'),
        () => ({})
    );

    // 1. Different durations without timestamps (Phase 2 (12m), Phase 3 (9m), Phase 2 (10m), Phase 3 (10m))
    const rawDifferent = [
        { title: "Exercises: Phase 1", durationMins: 10 },
        { title: "Exercises: Phase 2", durationMins: 12 },
        { title: "Exercises: Phase 3", durationMins: 9 },
        { title: "Exercises: Phase 2", durationMins: 10 },
        { title: "Exercises: Phase 3", durationMins: 10 }
    ];
    const dedupedDiff = deduplicateWorkouts(rawDifferent);
    assert.equal(dedupedDiff.length, 5);
    assert.equal(serializeWorkouts(dedupedDiff), "Exercises: Phase 1 (10m), Exercises: Phase 2 (12m), Exercises: Phase 3 (9m), Exercises: Phase 2 (10m), Exercises: Phase 3 (10m)");

    // 2. Identical durations interleaved without timestamps (e.g. all 10m)
    const rawIdentical = [
        { title: "Exercises: Phase 2", durationMins: 10 },
        { title: "Exercises: Phase 3", durationMins: 10 },
        { title: "Exercises: Phase 2", durationMins: 10 },
        { title: "Exercises: Phase 3", durationMins: 10 }
    ];
    const dedupedIdentical = deduplicateWorkouts(rawIdentical);
    assert.equal(dedupedIdentical.length, 4);
    assert.equal(serializeWorkouts(dedupedIdentical), "Exercises: Phase 2 (10m), Exercises: Phase 3 (10m), Exercises: Phase 2 (10m), Exercises: Phase 3 (10m)");

    // 3. Accidental directly adjacent duplicate of same title and duration collapses
    const rawAdjacent = [
        { title: "Exercises: Phase 2", durationMins: 10 },
        { title: "Exercises: Phase 2", durationMins: 10 },
        { title: "Exercises: Phase 3", durationMins: 10 }
    ];
    const dedupedAdjacent = deduplicateWorkouts(rawAdjacent);
    assert.equal(dedupedAdjacent.length, 2);
    assert.equal(serializeWorkouts(dedupedAdjacent), "Exercises: Phase 2 (10m), Exercises: Phase 3 (10m)");
});

test('mergeWorkoutLists and DailyNoteWriter preserve multi-session workouts during frontmatter sync', async () => {
    const { mergeWorkoutLists, splitWorkoutEntries, parseSingleWorkoutEntry, serializeWorkouts } = loadTsModule(
        path.join(__dirname, '../src/services/WorkoutDeduplicator.ts'),
        () => ({})
    );

    const { DailyNoteWriter } = loadTsModule(
        path.join(__dirname, '../src/services/DailyNoteWriter.ts'),
        (id) => {
            if (id === 'obsidian') return { App: class {}, TFile: class {}, Notice: class {}, normalizePath: s => s, moment: () => ({ format: () => '' }) };
            return {};
        }
    );

    // 1. mergeWorkoutLists when existing and incoming are identical preserves all 5 sessions
    const existingStr = "Exercises: Phase 1 (10m), Exercises: Phase 2 (12m), Exercises: Phase 3 (9m), Exercises: Phase 2 (10m), Exercises: Phase 3 (10m)";
    const localList = splitWorkoutEntries(existingStr).map(parseSingleWorkoutEntry);
    const incomingList = splitWorkoutEntries(existingStr).map(parseSingleWorkoutEntry);

    const merged = mergeWorkoutLists(localList, incomingList);
    assert.equal(merged.length, 5);
    assert.equal(serializeWorkouts(merged), existingStr);

    // 2. mergeWorkoutLists when incoming has an extra workout preserves existing multi-sessions and appends new
    const incomingWithExtra = splitWorkoutEntries("Walking (20m)").map(parseSingleWorkoutEntry);
    const mergedWithExtra = mergeWorkoutLists(localList, incomingWithExtra);
    assert.equal(mergedWithExtra.length, 6);
    assert.equal(serializeWorkouts(mergedWithExtra), `${existingStr}, Walking (20m)`);

    // 3. DailyNoteWriter writeData preserves frontmatter multi-sessions
    let mockFm = {
        workout: existingStr
    };
    const mockApp = {
        vault: {
            getMarkdownFiles: () => [],
            read: async () => ''
        },
        metadataCache: {
            getFileCache: () => ({ frontmatter: mockFm })
        },
        fileManager: {
            processFrontMatter: async (file, fn) => {
                fn(mockFm);
            }
        }
    };

    const writer = new DailyNoteWriter(mockApp, {
        healthSyncConfig: {
            exercise: { key: "workout" }
        }
    });

    // Mock getOrCreateDailyNote
    writer.getOrCreateDailyNote = async () => ({ basename: '2026-11-14', name: '2026-11-14.md' });

    // Sync incoming data containing identical or reconciled workout string
    const ok = await writer.writeData('2026-11-14', { workout: existingStr }, false);
    assert.equal(ok, true);
    assert.equal(mockFm.workout, existingStr);
});

test('WorkoutSyncService and DailyNoteWriter exclude non-exercise focus blocks (Wake-up, Freshen Up) from workouts', async () => {
    const { isExerciseOrWorkoutTitle, WorkoutSyncService } = loadTsModule(
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

    const { DailyNoteWriter } = loadTsModule(
        path.join(__dirname, '../src/services/DailyNoteWriter.ts'),
        (id) => {
            if (id === 'obsidian') {
                return {
                    App: class {},
                    TFile: class {},
                    Notice: class {},
                    normalizePath: (p) => p,
                    moment: () => ({ format: () => '2026-11-15' })
                };
            }
            return {};
        }
    );

    // 1. Check title filtering
    assert.equal(isExerciseOrWorkoutTitle('Exercises: Phase 1'), true);
    assert.equal(isExerciseOrWorkoutTitle('Walking'), true);
    assert.equal(isExerciseOrWorkoutTitle('Gym Session'), true);
    assert.equal(isExerciseOrWorkoutTitle('Wake-up'), false);
    assert.equal(isExerciseOrWorkoutTitle('Freshen Up'), false);
    assert.equal(isExerciseOrWorkoutTitle('House Chores: Yard & Leaf Cleanup'), false);
    assert.equal(isExerciseOrWorkoutTitle('Habits: Morning Routine'), false);

    // 2. Note containing Wake-up, Freshen Up, and Exercises: Phase 1
    const noteContent = `
### Focus Log
- [focus:: Wake-up] [start-time:: 07:39:54] [pause-start:: ] [pause-end:: ] [completed-time:: 08:04:55]
- [focus:: Freshen Up] [start-time:: 08:48:04] [pause-start:: ] [pause-end:: ] [completed-time:: 08:58:05]
- [focus:: Exercises: Phase 1] [start-time:: 11:07:07] [pause-start:: ] [pause-end:: ] [completed-time:: 11:17:07]
`;

    // Simulate frontmatter that previously had contaminated non-exercise workouts
    let mockFm = {
        workout: 'Exercises: Phase 1 (10m), Wake-up (25m), Freshen Up (10m)'
    };

    const mockApp = {
        vault: {
            read: async () => noteContent
        },
        metadataCache: {
            getFileCache: () => ({ frontmatter: mockFm })
        },
        fileManager: {
            processFrontMatter: async (file, fn) => {
                fn(mockFm);
            }
        }
    };

    const deletedFromCloud = [];
    const mockHealthService = {
        fetchExerciseSessionsForDate: async () => [
            { id: 'dp_wakeup', type: 'Workout', start: new Date('2026-11-15T07:39:54').getTime(), end: new Date('2026-11-15T08:04:55').getTime(), durationMins: 25 },
            { id: 'dp_freshenup', type: 'Workout', start: new Date('2026-11-15T08:48:04').getTime(), end: new Date('2026-11-15T08:58:05').getTime(), durationMins: 10 }
        ],
        postExerciseSession: async () => true,
        deleteHealthDataPoint: async (dataType, id) => {
            deletedFromCloud.push({ dataType, id });
            return true;
        },
        fetchMindfulnessSessionsForDate: async () => [],
        postMindfulnessSession: async () => true
    };

    const service = new WorkoutSyncService(mockApp, { enableBidirectionalWorkouts: false }, mockHealthService);
    const mockFile = { basename: '2026-11-15', name: '2026-11-15.md' };

    const result = await service.reconcileWorkouts(mockFile, { pushToCloud: false, showNotice: false });

    // Ensure only Exercises: Phase 1 is in merged workouts and frontmatter
    assert.equal(result.mergedWorkouts, 'Exercises: Phase 1 (10m)');
    assert.equal(mockFm.workout, 'Exercises: Phase 1 (10m)');

    // Ensure the spurious cloud workouts were deleted from Google Health
    assert.equal(deletedFromCloud.length, 2);
    assert.equal(deletedFromCloud[0].id, 'dp_wakeup');
    assert.equal(deletedFromCloud[1].id, 'dp_freshenup');

    // 3. DailyNoteWriter also purges non-exercise entries from existing frontmatter
    let writerFm = {
        workout: 'Wake-up (25m), Freshen Up (10m)'
    };
    const writerApp = {
        vault: {
            getMarkdownFiles: () => [],
            read: async () => ''
        },
        metadataCache: {
            getFileCache: () => ({ frontmatter: writerFm })
        },
        fileManager: {
            processFrontMatter: async (file, fn) => {
                fn(writerFm);
            }
        }
    };
    const writer = new DailyNoteWriter(writerApp, {
        healthSyncConfig: { exercise: { key: 'workout' } }
    });
    writer.getOrCreateDailyNote = async () => ({ basename: '2026-11-15', name: '2026-11-15.md' });

    await writer.writeData('2026-11-15', { workout: 'Exercises: Phase 1 (10m)' }, false);
    assert.equal(writerFm.workout, 'Exercises: Phase 1 (10m)');
});

test('WorkoutSyncService correctly maps parenthetical track qualifiers (Track A, Track B) to distinct focus intervals and avoids default 12:00:00 collisions', async () => {
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
        fetchExerciseSessionsForDate: async () => [],
        postExerciseSession: async (name, start, end) => {
            pushed.push({ name, start, end });
            return true;
        },
        fetchMindfulnessSessionsForDate: async () => [],
        postMindfulnessSession: async () => true
    };

    const noteContent = `
### Focus Log
- [focus:: Exercises: Phase 1] [start-time:: 11:07:16] [pause-start:: ] [pause-end:: ] [completed-time:: 11:17:15]
- [focus:: Exercises: Phase 2] [start-time:: 11:54:27] [pause-start:: ] [pause-end:: ] [completed-time:: 12:06:12]
- [focus:: Exercises: Phase 3] [start-time:: 12:06:47] [pause-start:: ] [pause-end:: ] [completed-time:: 12:15:28]
- [focus:: Exercises: Phase 2] [start-time:: 12:15:46] [pause-start:: ] [pause-end:: ] [completed-time:: 12:25:46]
- [focus:: Exercises: Phase 3] [start-time:: 12:28:00] [pause-start:: ] [pause-end:: ] [completed-time:: 12:37:57]
`;

    let mockFm = {
        workout: 'Exercises: Phase 1 (10m), Exercises: Phase 2 (Track A) (12m), Exercises: Phase 3 (Track A) (12m), Exercises: Phase 2 (Track B) (10m), Exercises: Phase 3 (Track B) (10m)'
    };

    const mockApp = {
        vault: {
            read: async () => noteContent
        },
        metadataCache: {
            getFileCache: () => ({ frontmatter: mockFm })
        },
        fileManager: {
            processFrontMatter: async (file, fn) => {
                fn(mockFm);
            }
        }
    };

    const service = new WorkoutSyncService(mockApp, { enableBidirectionalWorkouts: true }, mockHealthService);
    const mockFile = { basename: '2026-11-14', name: '2026-11-14.md' };

    const result = await service.reconcileWorkouts(mockFile, { pushToCloud: true, showNotice: false });

    // Verify all 5 sessions were pushed with their exact distinct start times
    assert.equal(pushed.length, 5);
    assert.equal(pushed[0].start, '2026-11-14T11:07:16');
    assert.equal(pushed[1].start, '2026-11-14T11:54:27'); // Phase 2 (Track A) mapped to 1st Phase 2
    assert.equal(pushed[2].start, '2026-11-14T12:06:47'); // Phase 3 (Track A) mapped to 1st Phase 3
    assert.equal(pushed[3].start, '2026-11-14T12:15:46'); // Phase 2 (Track B) mapped to 2nd Phase 2
    assert.equal(pushed[4].start, '2026-11-14T12:28:00'); // Phase 3 (Track B) mapped to 2nd Phase 3

    // Verify none fell back to the 12:00:00 default collision
    assert.ok(pushed.every(p => !p.start.endsWith('12:00:00')));

    // Verify frontmatter preserved the track names without phantom duplicate sessions
    assert.equal(
        mockFm.workout,
        'Exercises: Phase 1 (10m), Exercises: Phase 2 (Track A) (12m), Exercises: Phase 3 (Track A) (12m), Exercises: Phase 2 (Track B) (10m), Exercises: Phase 3 (Track B) (10m)'
    );
});

test('workout sync keeps a walking entry separate from strength training and preserves a second source walk', () => {
    const { mergeWorkoutLists, splitWorkoutEntries, parseSingleWorkoutEntry, serializeWorkouts } = loadTsModule(
        path.join(__dirname, '../src/services/WorkoutDeduplicator.ts'),
        () => ({})
    );
    const parse = value => splitWorkoutEntries(value).map(parseSingleWorkoutEntry);
    const stored = 'Walking (11m), Exercises: Phase 1 (11m), Exercises: Phase 2 (16m)';
    const cloud = 'Strength Training (16m), Walking (11m)';
    const once = mergeWorkoutLists(parse(stored), parse(cloud));
    assert.equal(serializeWorkouts(once), stored);
    assert.equal(serializeWorkouts(mergeWorkoutLists(once, parse(cloud))), stored);
    assert.equal(
        serializeWorkouts(mergeWorkoutLists(parse(stored), parse(cloud + ', Walking (11m)'))),
        stored + ', Walking (11m)'
    );
});
