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
    const calls = [];
    const { GoogleHealthService } = loadTsModule(
        path.join(__dirname, '../src/services/GoogleHealthService.ts'),
        id => id === 'obsidian' ? {
            Notice: class {},
            requestUrl: async (req) => {
                calls.push({ url: req.url, payload: JSON.parse(req.body) });
                return { status: 201, text: '{}', json: {} };
            }
        } : {}
    );
    const service = new GoogleHealthService({}, { getAccessToken: async () => 'test-token' });
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
});

test('beer posts through nutrition with calories and declared alcohol preserved; failures expose API errors', async () => {
    let posted;
    let nextResponse = null;
    const { GoogleHealthService } = loadTsModule(
        path.join(__dirname, '../src/services/GoogleHealthService.ts'),
        id => id === 'obsidian' ? {
            Notice: class {},
            requestUrl: async (req) => {
                if (nextResponse) return nextResponse;
                assert.match(req.url, /nutrition-log\/dataPoints$/);
                posted = JSON.parse(req.body);
                return { status: 201, text: '{}', json: {} };
            }
        } : {}
    );
    const service = new GoogleHealthService({}, { getAccessToken: async () => 'test-token' });
    const when = new Date(2026, 10, 15, 19, 52);
    const beer = { name: 'Modelo Especial Beer', category: 'alcohol', calories: 144, alcoholMg: 20600 };
    assert.equal(await service.postFoodOrDrink(beer, 2.5, when), true);
    assert.equal(posted.nutritionLog.energy.kcal, 360);
    assert.equal(posted.nutritionLog.foodDisplayName, 'Modelo Especial Beer [51.5 g alcohol]');
    assert.equal(posted.nutritionLog.interval.endTime, when.toISOString());
    assert.deepEqual(posted.nutritionLog.nutrients, []);
    assert.equal(service.parseNutritionPayload({ dataPoints: [posted] }, '2026-11-15').alcohol, 52);
    assert.equal(service.parseNutritionPayload({ dataPoints: [posted] }, '2026-11-16').alcohol, undefined);
    nextResponse = { status: 400, text: JSON.stringify({ error: { message: 'Invalid data type' } }), json: { error: { message: 'Invalid data type' } } };
    assert.equal(await service.postFoodOrDrink(beer, 2.5, when), false);
    assert.equal(service.lastApiError, 'HTTP 400: Invalid data type');
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
        const svgDiv = cb.children.find(c =>
            (c.innerHTML && c.innerHTML.includes('<svg')) ||
            (c.children && c.children.some(ch => ch.textContent && ch.textContent.includes('<svg')))
        );
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

test('bidirectional reconciliation matches one watch walk without consuming the calisthenics session', async () => {
    const { WorkoutSyncService } = loadTsModule(
        path.join(__dirname, '../src/services/WorkoutSyncService.ts'),
        id => id === 'obsidian' ? { Notice: class {} } : {}
    );
    const date = '2026-11-17';
    const session = (type, start, end, durationMins) => ({
        type, start: Date.parse(date + 'T' + start), end: Date.parse(date + 'T' + end), durationMins
    });
    const cloud = [
        session('Calisthenics', '13:18:17', '13:29:17', 11),
        session('Strength Training', '13:42:09', '14:01:08', 19),
        session('Walking', '08:28:00', '08:39:00', 11)
    ];
    const original = 'Walking (11m), Exercises: Phase 1 (Phase 1 Exercise Routine) (11m), Exercises: Phase 2 (19m)';
    const fm = { workout: original };
    const app = {
        metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
        vault: { read: async () => [
            '- [focus:: Exercises: Phase 1 (Phase 1 Exercise Routine)] [start-time:: 13:18:17] [completed-time:: 13:29:17]',
            '- [focus:: Exercises: Phase 2] [start-time:: 13:42:09] [completed-time:: 14:01:08]'
        ].join('\n') },
        fileManager: { processFrontMatter: async (_, update) => update(fm) }
    };
    const pushed = [];
    const service = new WorkoutSyncService(app, { enableBidirectionalWorkouts: true }, {
        fetchExerciseSessionsForDate: async () => cloud,
        postExerciseSession: async (title) => { pushed.push(title); return true; }
    });
    await service.reconcileWorkouts({ basename: date });
    assert.equal(fm.workout, original);
    assert.deepEqual(pushed, []);

    cloud.push(session('Walking', '17:00:00', '17:11:00', 11));
    await service.reconcileWorkouts({ basename: date });
    assert.equal(fm.workout, original + ', Walking (11m)');
    await service.reconcileWorkouts({ basename: date });
    assert.equal(fm.workout, original + ', Walking (11m)');
    assert.deepEqual(pushed, []);
});

test('parseHealthProtocolUri resolves defaults, tab/category aliases, and rejects invalid inputs', () => {
    const { parseHealthProtocolUri } = loadTsModule(
        path.join(__dirname, '../src/services/HealthProtocolUri.ts'),
        () => ({})
    );

    assert.deepEqual(parseHealthProtocolUri({ action: 'health-connect' }), {
        ok: true,
        action: 'hub',
        tab: 'log',
        category: 'nutrition'
    });
    assert.deepEqual(parseHealthProtocolUri({ action: 'health-connect-hub' }), {
        ok: true,
        action: 'hub',
        tab: 'log',
        category: 'nutrition'
    });
    assert.deepEqual(
        parseHealthProtocolUri({ action: 'health-connect', view: 'hub', tab: 'History', category: 'Food' }),
        { ok: true, action: 'hub', tab: 'history', category: 'nutrition' }
    );
    assert.deepEqual(
        parseHealthProtocolUri({ action: 'health-connect', tab: 'manage', category: 'exercise' }),
        { ok: true, action: 'hub', tab: 'registry', category: 'workout' }
    );
    assert.deepEqual(
        parseHealthProtocolUri({ action: 'health-connect-hub', tab: 'log', category: 'meditation' }),
        { ok: true, action: 'hub', tab: 'log', category: 'mindfulness' }
    );
    assert.deepEqual(
        parseHealthProtocolUri({ action: 'health-connect', category: 'readiness' }),
        { ok: true, action: 'hub', tab: 'log', category: 'sleep' }
    );

    const badAction = parseHealthProtocolUri({ action: 'health-connect', view: 'unknown' });
    assert.equal(badAction.ok, false);
    const badTab = parseHealthProtocolUri({ action: 'health-connect', tab: 'settings' });
    assert.equal(badTab.ok, false);
    const badCategory = parseHealthProtocolUri({ action: 'health-connect', category: 'hydration_invalid' });
    assert.equal(badCategory.ok, false);
});

test('HealthConnectPlugin registers Obsidian URI handlers and opens Activity Hub without stacking modals', async () => {
    const notices = [];
    const registeredHandlers = {};
    const openedModals = [];
    const closedModals = [];

    class MockPlugin {
        constructor(app, manifest) {
            this.app = app;
            this.manifest = manifest;
        }
        addRibbonIcon() {}
        addCommand() {}
        registerEvent() {}
        registerInterval() {}
        registerMarkdownCodeBlockProcessor() {}
        addSettingTab() {}
        registerObsidianProtocolHandler(action, handler) {
            registeredHandlers[action] = handler;
        }
        async loadData() { return {}; }
        async saveData() {}
    }

    class MockModal {
        constructor(app) {
            this.app = app;
            this.contentEl = { empty: () => {}, addClass: () => {}, createEl: () => ({}), createDiv: () => ({ style: {}, createSpan: () => ({ style: {} }) }) };
        }
        open() {
            openedModals.push(this);
        }
        close() {
            closedModals.push(this);
        }
    }

    class MockNotice {
        constructor(message) {
            notices.push(message);
        }
    }

    class MockPluginSettingTab {
        constructor(app, plugin) {
            this.app = app;
            this.plugin = plugin;
        }
    }

    const mockObsidian = {
        Plugin: MockPlugin,
        Modal: MockModal,
        Notice: MockNotice,
        TFile: class {},
        PluginSettingTab: MockPluginSettingTab,
        Setting: class {},
        Platform: { isDesktop: true },
        requestUrl: async () => ({ status: 200, json: {} })
    };

    const { default: HealthConnectPlugin } = loadTsModule(
        path.join(__dirname, '../src/main.ts'),
        id => {
            if (id === 'obsidian') return mockObsidian;
            if (id === 'fs' || id === 'path' || id === 'http' || id === 'url') return {};
            return {};
        }
    );

    const mockApp = {
        vault: {
            on: () => ({}),
            getMarkdownFiles: () => []
        }
    };
    const plugin = new HealthConnectPlugin(mockApp, { id: 'health-connect-readiness' });
    await plugin.onload();

    assert.equal(typeof registeredHandlers['health-connect'], 'function');
    assert.equal(typeof registeredHandlers['health-connect-hub'], 'function');

    registeredHandlers['health-connect']({ action: 'health-connect', tab: 'history', category: 'nutrition' });
    assert.equal(openedModals.length, 1);
    assert.equal(openedModals[0].activeTab, 'history');
    assert.equal(openedModals[0].activeCategory, 'nutrition');
    assert.equal(closedModals.length, 0);

    registeredHandlers['health-connect-hub']({ action: 'health-connect-hub', tab: 'registry', category: 'workout' });
    assert.equal(closedModals.length, 1);
    assert.equal(closedModals[0], openedModals[0]);
    assert.equal(openedModals.length, 2);
    assert.equal(openedModals[1].activeTab, 'registry');
    assert.equal(openedModals[1].activeCategory, 'workout');

    registeredHandlers['health-connect']({ action: 'health-connect', tab: 'bad_tab' });
    assert.equal(openedModals.length, 2);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /Unsupported Activity Hub tab/);

    plugin.onunload();
    assert.equal(closedModals.length, 2);
});

test('daily sync and food history avoid unsupported alcohol-consumption endpoint and read alcohol from nutrition-log', async () => {
    const requestedUrls = [];
    let apiPosted;
    const when = new Date(2026, 10, 15, 20, 0);
    const nutritionPoint = {
        name: 'users/me/dataTypes/nutrition-log/dataPoints/alc-1',
        nutritionLog: {
            interval: {
                startTime: when.toISOString(),
                endTime: when.toISOString()
            },
            foodDisplayName: 'Wine [14 g alcohol]',
            energy: { kcal: 98 },
            nutrients: []
        }
    };

    const mockRequestUrl = async (req) => {
        const urlStr = String(req.url);
        requestedUrls.push(urlStr);
        if (urlStr.includes('alcohol-consumption')) {
            return { status: 400, text: JSON.stringify({ error: { message: 'Invalid data type' } }), json: { error: { message: 'Invalid data type' } } };
        }
        if (req.method === 'POST' && urlStr.includes('nutrition-log/dataPoints')) {
            apiPosted = { url: urlStr, payload: JSON.parse(req.body) };
            return { status: 201, text: '{}', json: {} };
        }
        if (urlStr.includes('nutrition-log/dataPoints')) {
            return { status: 200, text: JSON.stringify({ dataPoints: [nutritionPoint] }), json: { dataPoints: [nutritionPoint] } };
        }
        return { status: 200, text: JSON.stringify({ dataPoints: [] }), json: { dataPoints: [] } };
    };

    const mockObsidian = { Notice: class {}, requestUrl: mockRequestUrl };
    const { GoogleHealthService } = loadTsModule(path.join(__dirname, '../src/services/GoogleHealthService.ts'), id => id === 'obsidian' ? mockObsidian : {});
    const { GoogleHealthApi } = loadTsModule(path.join(__dirname, '../src/services/GoogleHealthApi.ts'), id => id === 'obsidian' ? mockObsidian : {});
    const service = new GoogleHealthService({}, { getAccessToken: async () => 'test-token' });
    const api = new GoogleHealthApi({ getValidAccessToken: async () => 'test-token' });

    const daily = await service.fetchDailyHealth(when);
    assert.equal(daily.alcohol, 14);
    assert.equal(daily.calories, 98);

    const history = await service.fetchLoggedFoodHistory(when);
    assert.equal(history.length, 1);
    assert.equal(history[0].category, 'alcohol');
    assert.equal(history[0].alcoholMg, 14000);

    const postedOk = await api.postFoodOrDrink({ name: 'Wine', category: 'alcohol', alcoholMg: 14000 }, 1);
    assert.equal(postedOk, true);
    assert.match(apiPosted.url, /nutrition-log\/dataPoints$/);
    assert.equal(apiPosted.payload.nutritionLog.foodDisplayName, 'Wine [14 g alcohol]');
    assert.equal(apiPosted.payload.nutritionLog.energy.kcal, 98);

    assert.equal(requestedUrls.some(u => u.includes('alcohol-consumption')), false);
});

test('MetaBindService uses vault.adapter and configDir without Node fs/path', async () => {
    const files = {
        '.obsidian-mobile/plugins/obsidian-meta-bind-plugin/data.json': JSON.stringify({ buttonTemplates: [] })
    };
    const notices = [];
    const { MetaBindService } = loadTsModule(
        path.join(__dirname, '../src/services/MetaBindService.ts'),
        id => id === 'obsidian' ? {
            Notice: class { constructor(m) { notices.push(m); } },
            normalizePath: p => p.replace(/\\/g, '/').replace(/\/+/g, '/')
        } : {}
    );

    const mockApp = {
        vault: {
            configDir: '.obsidian-mobile',
            adapter: {
                exists: async p => Object.prototype.hasOwnProperty.call(files, p),
                read: async p => files[p],
                write: async (p, content) => { files[p] = content; }
            }
        }
    };

    const svc = new MetaBindService(mockApp);
    const ok = await svc.registerButton({
        id: 'health-sync-today-btn',
        label: 'Sync',
        icon: 'activity',
        tooltip: 'Sync today',
        commandId: 'health-connect-readiness:health-connect-sync-today'
    });

    assert.equal(ok, true);
    const saved = JSON.parse(files['.obsidian-mobile/plugins/obsidian-meta-bind-plugin/data.json']);
    assert.equal(saved.buttonTemplates.length, 1);
    assert.equal(saved.buttonTemplates[0].id, 'health-sync-today-btn');
    assert.match(notices[0], /registered/);
});

test('GoogleOAuthService mobile fallback parses redirect URLs/codes and opens mobile modal without http', async () => {
    const notices = [];
    const openedModals = [];
    const requests = [];
    let savedCount = 0;

    class MockModal {
        constructor(app) {
            this.app = app;
            this.contentEl = {
                empty() {},
                createEl() { return { createEl() {} }; }
            };
        }
        open() { openedModals.push(this); }
        close() {}
    }
    class MockSetting {
        setName() { return this; }
        setDesc() { return this; }
        addButton(fn) { fn({ setButtonText() { return this; }, setCta() { return this; }, setDisabled() { return this; }, onClick() { return this; } }); return this; }
        addText(fn) { fn({ setPlaceholder() { return this; }, onChange() { return this; } }); return this; }
    }

    const { GoogleOAuthService } = loadTsModule(
        path.join(__dirname, '../src/services/GoogleOAuthService.ts'),
        id => {
            if (id === 'http' || id === 'url') {
                throw new Error(`Unexpected Node module require: ${id}`);
            }
            if (id === 'obsidian') {
                return {
                    Modal: MockModal,
                    Notice: class { constructor(m) { notices.push(m); } },
                    Platform: { isDesktopApp: false, isMobileApp: true },
                    Setting: MockSetting,
                    requestUrl: async (req) => {
                        requests.push(req);
                        return {
                            status: 200,
                            text: JSON.stringify({ access_token: 'mob-access', refresh_token: 'mob-refresh', expires_in: 3600 }),
                            json: { access_token: 'mob-access', refresh_token: 'mob-refresh', expires_in: 3600 }
                        };
                    }
                };
            }
            return {};
        }
    );

    const settings = {
        clientId: 'client-123',
        clientSecret: 'secret-456',
        redirectUri: 'http://localhost:8092',
        requestedScopes: [],
        tokens: {}
    };

    const oauth = new GoogleOAuthService({}, settings, async () => { savedCount++; });

    assert.deepEqual(oauth.extractAuthCodeFromInput('http://localhost:8092/?code=4/0Axyz&scope=test'), { code: '4/0Axyz' });
    assert.deepEqual(oauth.extractAuthCodeFromInput('?code=abc123'), { code: 'abc123' });
    assert.deepEqual(oauth.extractAuthCodeFromInput('raw-code-789'), { code: 'raw-code-789' });
    assert.deepEqual(oauth.extractAuthCodeFromInput('http://localhost:8092/?error=access_denied'), { error: 'access_denied' });

    await oauth.startOAuthFlow(true);
    assert.equal(openedModals.length, 1);

    const ok = await oauth.completeMobileOAuth('http://localhost:8092/?code=4/0AmobileCode&scope=health');
    assert.equal(ok, true);
    assert.equal(requests.length, 1);
    assert.equal(settings.tokens.accessToken, 'mob-access');
    assert.equal(settings.tokens.refreshToken, 'mob-refresh');
    assert.equal(savedCount, 1);
    assert.match(notices.at(-1), /Connected Successfully/);
});

test('BIOMETRIC_CATALOG and getUnmappedBiometrics dynamically filter mapped keys and return deleted keys', () => {
    const { BIOMETRIC_CATALOG, DEFAULT_SETTINGS, getUnmappedBiometrics } = loadTsModule(
        path.join(__dirname, '../src/models/HealthSettings.ts'),
        () => ({})
    );

    const catalogKeys = BIOMETRIC_CATALOG.map(entry => entry.key);
    for (const required of [
        'sleep', 'deep_sleep', 'hrv', 'steps', 'active_minutes', 'exercise',
        'light_sleep', 'rem_sleep', 'awake_sleep', 'sleep_interruptions',
        'resting_heart_rate', 'blood_oxygen', 'respiratory_rate',
        'weight', 'body_fat', 'blood_pressure', 'blood_glucose',
        'body_temperature', 'basal_metabolic_rate'
    ]) {
        assert.ok(catalogKeys.includes(required), `Catalog missing ${required}`);
    }

    const defaultUnmapped = getUnmappedBiometrics(DEFAULT_SETTINGS.healthSyncConfig).map(e => e.key);
    assert.ok(defaultUnmapped.includes('light_sleep'));
    assert.ok(defaultUnmapped.includes('rem_sleep'));
    assert.ok(defaultUnmapped.includes('awake_sleep'));
    assert.ok(defaultUnmapped.includes('sleep_interruptions'));
    assert.ok(defaultUnmapped.includes('resting_heart_rate'));
    assert.ok(defaultUnmapped.includes('weight'));
    assert.ok(defaultUnmapped.includes('body_fat'));
    assert.equal(defaultUnmapped.includes('sleep'), false);
    assert.equal(defaultUnmapped.includes('blood_oxygen'), false);

    // Deleting a mapped metric returns it to the unmapped list
    const cloned = Object.assign({}, DEFAULT_SETTINGS.healthSyncConfig);
    delete cloned.blood_oxygen;
    const afterDelete = getUnmappedBiometrics(cloned).map(e => e.key);
    assert.ok(afterDelete.includes('blood_oxygen'));

    // Mapping every catalog item yields an empty unmapped list
    const allMapped = {};
    for (const entry of BIOMETRIC_CATALOG) {
        allMapped[entry.key] = { enabled: true, destination: 'frontmatter', key: entry.defaultKey };
    }
    assert.deepEqual(getUnmappedBiometrics(allMapped), []);
});

test('HealthSettingsTab renders dynamic unmapped dropdown and disabled empty state option', () => {
    const { BIOMETRIC_CATALOG } = loadTsModule(
        path.join(__dirname, '../src/models/HealthSettings.ts'),
        () => ({})
    );

    const makeNode = (tagName = 'div', opts = {}) => {
        const node = createMockElement(tagName, opts.cls || '');
        if (opts.text) node.textContent = opts.text;
        if (opts.value !== undefined) node.value = opts.value;
        node.disabled = false;
        node.selected = false;
        node.title = '';
        node.appendText = (t) => { node.textContent += t; };
        node.setText = (t) => { node.textContent = t; };
        node.setAttr = (k, v) => { node.attrs[k] = v; };
        node.addEventListener = () => {};
        node.removeEventListener = () => {};
        const origCreateEl = node.createEl;
        node.createEl = (t, o = {}) => {
            const child = makeNode(t, o);
            node.children.push(child);
            return child;
        };
        const origCreateDiv = node.createDiv;
        node.createDiv = (o = {}) => {
            const child = makeNode('div', o);
            node.children.push(child);
            return child;
        };
        const origCreateSpan = node.createSpan;
        node.createSpan = (o = {}) => {
            const child = makeNode('span', o);
            node.children.push(child);
            return child;
        };
        return node;
    };

    class MockSetting {
        constructor(el) { this.controlEl = makeNode('div'); }
        setName() { return this; }
        setDesc() { return this; }
        setClass() { return this; }
        addText(fn) { fn({ inputEl: makeNode('input'), setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
        addTextArea(fn) { fn({ inputEl: makeNode('textarea'), setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
        addDropdown(fn) { fn({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
        addSlider(fn) { fn({ setLimits() { return this; }, setValue() { return this; }, setDynamicTooltip() { return this; }, onChange() { return this; } }); return this; }
        addToggle(fn) { fn({ setValue() { return this; }, onChange() { return this; } }); return this; }
        addButton(fn) { fn({ setButtonText() { return this; }, setCta() { return this; }, onClick() { return this; } }); return this; }
        addExtraButton(fn) { fn({ setIcon() { return this; }, setTooltip() { return this; }, onClick() { return this; } }); return this; }
    }

    const { HealthSettingsTab } = loadTsModule(
        path.join(__dirname, '../src/settings/HealthSettingsTab.ts'),
        id => {
            if (id === 'obsidian') {
                return {
                    App: class {},
                    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
                    Setting: MockSetting,
                    Notice: class {},
                    Platform: { isMobileApp: false, isDesktopApp: true }
                };
            }
            return {};
        }
    );

    const allMapped = {};
    for (const entry of BIOMETRIC_CATALOG) {
        allMapped[entry.key] = { enabled: true, destination: 'frontmatter', key: entry.defaultKey };
    }

    const mockPlugin = {
        oauthService: { isConnected: () => false },
        settings: {
            healthSyncConfig: allMapped,
            dashboardCards: [],
            calculatedMetrics: [],
            requestedScopes: []
        },
        saveSettings: async () => {},
        setupAutoSync: () => {}
    };

    const tab = new HealthSettingsTab({ vault: { getMarkdownFiles: () => [] } }, mockPlugin);
    tab.containerEl = makeNode('div');
    globalThis.createFragment = (fn) => { const frag = makeNode('div'); fn(frag); return frag; };
    tab.display();

    const findSelectWithOption = (node, textMatch) => {
        if (node.tagName === 'select' && node.children.some(opt => opt.textContent.includes(textMatch))) {
            return node;
        }
        for (const c of node.children) {
            const found = findSelectWithOption(c, textMatch);
            if (found) return found;
        }
        return null;
    };

    const emptySelect = findSelectWithOption(tab.containerEl, 'All available metrics are mapped');
    assert.ok(emptySelect, 'Should render All available metrics are mapped option when catalog is exhausted');
    assert.equal(emptySelect.disabled, true);
    assert.equal(emptySelect.children[0].disabled, true);

    // Delete light_sleep and weight, re-render, and verify they return to dropdown
    delete mockPlugin.settings.healthSyncConfig.light_sleep;
    delete mockPlugin.settings.healthSyncConfig.weight;
    tab.display();

    const populatedSelect = findSelectWithOption(tab.containerEl, '-- Select Unmapped Metric to Configure --');
    assert.ok(populatedSelect);
    assert.equal(populatedSelect.disabled, false);
    const optValues = populatedSelect.children.map(o => o.value);
    assert.deepEqual(optValues, ['', 'light_sleep', 'weight']);
});

test('parseSleepPayload extracts LIGHT, REM, AWAKE durations and interruption count when mapped & enabled', () => {
    const { GoogleHealthService } = loadTsModule(
        path.join(__dirname, '../src/services/GoogleHealthService.ts'),
        id => id === 'obsidian' ? { Notice: class {}, requestUrl: async () => ({ status: 200, json: {} }) } : {}
    );

    const payload = {
        dataPoints: [{
            sleep: {
                interval: { startTime: '2026-11-23T23:00:00Z', endTime: '2026-11-24T07:00:00Z' },
                summary: {
                    minutesAsleep: '425',
                    minutesAwake: '23',
                    stagesSummary: [
                        { type: 'AWAKE', minutes: '23', count: '2' },
                        { type: 'LIGHT', minutes: '241', count: '19' },
                        { type: 'DEEP', minutes: '61', count: '8' },
                        { type: 'REM', minutes: '123', count: '11' }
                    ]
                }
            }
        }]
    };

    // Unmapped / disabled -> only Sleep_hours + Deep_sleep + wake_up
    const serviceUnmapped = new GoogleHealthService({ healthSyncConfig: {} }, {});
    const unmappedRes = serviceUnmapped.parseSleepPayload(payload);
    assert.equal(unmappedRes.Sleep_hours, '7:05');
    assert.equal(unmappedRes.Deep_sleep, '1:01');
    assert.equal(unmappedRes.Light_sleep, undefined);
    assert.equal(unmappedRes.REM_sleep, undefined);
    assert.equal(unmappedRes.Awake_sleep, undefined);
    assert.equal(unmappedRes.sleep_interruptions, undefined);

    // Mapped & enabled (with custom keys) -> extracts all sleep stages & interruption count
    const serviceMapped = new GoogleHealthService({
        healthSyncConfig: {
            sleep: { enabled: true, destination: 'frontmatter', key: 'Sleep_hours' },
            deep_sleep: { enabled: true, destination: 'frontmatter', key: 'Deep_sleep' },
            light_sleep: { enabled: true, destination: 'frontmatter', key: 'Light_sleep' },
            rem_sleep: { enabled: true, destination: 'frontmatter', key: 'rem_dur' },
            awake_sleep: { enabled: true, destination: 'frontmatter', key: 'Awake_sleep' },
            sleep_interruptions: { enabled: true, destination: 'frontmatter', key: 'interruptions' }
        }
    }, {});
    const mappedRes = serviceMapped.parseSleepPayload(payload);
    assert.equal(mappedRes.Deep_sleep, '1:01');
    assert.equal(mappedRes.Light_sleep, '4:01');
    assert.equal(mappedRes.rem_dur, '2:03');
    assert.equal(mappedRes.Awake_sleep, '0:23');
    assert.equal(mappedRes.interruptions, 2);

    // Fallback to stages array when stagesSummary is absent
    const stagesOnlyPayload = {
        dataPoints: [{
            sleep: {
                interval: { startTime: '2026-11-23T23:00:00Z', endTime: '2026-11-24T06:00:00Z' },
                summary: { minutesAsleep: 360 },
                stages: [
                    { type: 'LIGHT', startTime: '2026-11-23T23:00:00Z', endTime: '2026-11-24T01:00:00Z' },
                    { type: 'AWAKE', startTime: '2026-11-24T01:00:00Z', endTime: '2026-11-24T01:10:00Z' },
                    { type: 'REM', startTime: '2026-11-24T01:10:00Z', endTime: '2026-11-24T02:25:00Z' },
                    { type: 'AWAKE', startTime: '2026-11-24T02:25:00Z', endTime: '2026-11-24T02:30:00Z' },
                    { type: 'DEEP', startTime: '2026-11-24T02:30:00Z', endTime: '2026-11-24T03:30:00Z' }
                ]
            }
        }]
    };
    const fallbackRes = serviceMapped.parseSleepPayload(stagesOnlyPayload);
    assert.equal(fallbackRes.Deep_sleep, '1:00');
    assert.equal(fallbackRes.Light_sleep, '2:00');
    assert.equal(fallbackRes.rem_dur, '1:15');
    assert.equal(fallbackRes.Awake_sleep, '0:15');
    assert.equal(fallbackRes.interruptions, 2);
});

test('fetchDailyHealth skips disabled/unmapped vitals and fetches enabled Google Health v4 vitals gracefully', async () => {
    const requestedUrls = [];
    const targetDate = new Date(2026, 10, 24, 12, 0, 0); // 2026-11-24

    const makeMockObsidian = (handler) => ({
        Notice: class {},
        requestUrl: async (req) => {
            requestedUrls.push(String(req.url));
            return handler(String(req.url), req);
        }
    });

    // 1. Disabled/unmapped vitals -> ZERO calls to extra v4 vitals endpoints
    {
        requestedUrls.length = 0;
        const { GoogleHealthService } = loadTsModule(
            path.join(__dirname, '../src/services/GoogleHealthService.ts'),
            id => id === 'obsidian' ? makeMockObsidian(() => ({ status: 200, text: '{"dataPoints":[]}', json: { dataPoints: [] } })) : {}
        );
        const svc = new GoogleHealthService({
            healthSyncConfig: {
                resting_heart_rate: { enabled: false, destination: 'frontmatter', key: 'resting_heart_rate' },
                blood_oxygen: { enabled: false, destination: 'frontmatter', key: 'spo2' },
                blood_pressure: { enabled: true, destination: 'frontmatter', key: 'blood_pressure' }
            }
        }, { getAccessToken: async () => 'tok' });

        await svc.fetchDailyHealth(targetDate);
        for (const dt of ['daily-resting-heart-rate', 'daily-oxygen-saturation', 'daily-respiratory-rate', 'weight', 'body-fat', 'blood-glucose', 'core-body-temperature', 'basal-energy-burned', 'blood-pressure']) {
            assert.equal(requestedUrls.some(u => u.includes(dt)), false, `Should not request ${dt} when disabled or frontmatter-only`);
        }
    }

    // 2. Enabled vitals -> fetches exact v4 endpoints and parses payloads
    {
        requestedUrls.length = 0;
        const { GoogleHealthService } = loadTsModule(
            path.join(__dirname, '../src/services/GoogleHealthService.ts'),
            id => id === 'obsidian' ? makeMockObsidian((url) => {
                if (url.includes('daily-resting-heart-rate/dataPoints')) {
                    return { status: 200, json: { dataPoints: [{ dailyRestingHeartRate: { date: { year: 2026, month: 11, day: 24 }, beatsPerMinute: '54' } }] } };
                }
                if (url.includes('daily-oxygen-saturation/dataPoints')) {
                    return { status: 200, json: { dataPoints: [{ dailyOxygenSaturation: { date: { year: 2026, month: 11, day: 24 }, averagePercentage: 97.6 } }] } };
                }
                if (url.includes('daily-respiratory-rate/dataPoints')) {
                    return { status: 200, json: { dataPoints: [{ dailyRespiratoryRate: { date: { year: 2026, month: 11, day: 24 }, breathsPerMinute: 14.8 } }] } };
                }
                if (url.includes('dataTypes/weight/dataPoints')) {
                    return { status: 200, json: { dataPoints: [{ weight: { sampleTime: { civilTime: { date: { year: 2026, month: 11, day: 24 } }, physicalTime: '2026-11-24T13:00:00Z' }, weightGrams: 80000 } }] } };
                }
                if (url.includes('body-fat/dataPoints')) {
                    return { status: 200, json: { dataPoints: [{ bodyFat: { sampleTime: { civilTime: { date: { year: 2026, month: 11, day: 24 } } }, percentage: 16.44 } }] } };
                }
                if (url.includes('blood-glucose/dataPoints')) {
                    return { status: 200, json: { dataPoints: [
                        { bloodGlucose: { sampleTime: { civilTime: { date: { year: 2026, month: 11, day: 24 } } }, bloodGlucoseMilligramsPerDeciliter: 92 } },
                        { bloodGlucose: { sampleTime: { civilTime: { date: { year: 2026, month: 11, day: 24 } } }, bloodGlucoseMilligramsPerDeciliter: 98 } }
                    ] } };
                }
                if (url.includes('core-body-temperature/dataPoints')) {
                    return { status: 200, json: { dataPoints: [] } };
                }
                if (url.includes('daily-sleep-temperature-derivations/dataPoints')) {
                    return { status: 200, json: { dataPoints: [{ dailySleepTemperatureDerivations: { date: { year: 2026, month: 11, day: 24 }, nightlyTemperatureCelsius: 36.74 } }] } };
                }
                if (url.includes('basal-energy-burned/dataPoints')) {
                    return { status: 200, json: { dataPoints: [
                        { basalEnergyBurned: { interval: { civilStartTime: { date: { year: 2026, month: 11, day: 24 } } }, kcal: 820.4 } },
                        { basalEnergyBurned: { interval: { civilStartTime: { date: { year: 2026, month: 11, day: 24 } } }, kcal: 840.2 } }
                    ] } };
                }
                return { status: 200, json: { dataPoints: [] } };
            }) : {}
        );

        const svc = new GoogleHealthService({
            healthSyncConfig: {
                resting_heart_rate: { enabled: true, destination: 'frontmatter', key: 'rhr' },
                blood_oxygen: { enabled: true, destination: 'frontmatter', key: 'spo2' },
                respiratory_rate: { enabled: true, destination: 'frontmatter', key: 'respiratory_rate' },
                weight: { enabled: true, destination: 'frontmatter', key: 'weight' },
                body_fat: { enabled: true, destination: 'frontmatter', key: 'body_fat' },
                blood_glucose: { enabled: true, destination: 'frontmatter', key: 'blood_glucose' },
                body_temperature: { enabled: true, destination: 'frontmatter', key: 'body_temperature' },
                basal_metabolic_rate: { enabled: true, destination: 'frontmatter', key: 'bmr' },
                blood_pressure: { enabled: true, destination: 'frontmatter', key: 'blood_pressure' }
            }
        }, { getAccessToken: async () => 'tok' });

        const res = await svc.fetchDailyHealth(targetDate);
        assert.equal(res.rhr, 54);
        assert.equal(res.spo2, 97.6);
        assert.equal(res.respiratory_rate, 14.8);
        assert.equal(res.weight, 176.4); // 80000g -> 176.4 lbs
        assert.equal(res.body_fat, 16.4);
        assert.equal(res.blood_glucose, 95);
        assert.equal(res.body_temperature, 36.7);
        assert.equal(res.bmr, 1661);
        assert.equal(requestedUrls.some(u => u.includes('blood-pressure')), false);
    }

    // 3. 403 / 404 / empty handling does not throw or break core sync
    {
        requestedUrls.length = 0;
        const { GoogleHealthService } = loadTsModule(
            path.join(__dirname, '../src/services/GoogleHealthService.ts'),
            id => id === 'obsidian' ? makeMockObsidian((url) => {
                if (url.includes('dataTypes/sleep/dataPoints')) {
                    return { status: 200, json: { dataPoints: [{ sleep: { interval: { endTime: '2026-11-24T07:00:00Z' }, summary: { minutesAsleep: 420 } } }] } };
                }
                if (url.includes('daily-resting-heart-rate')) return { status: 403, text: 'Forbidden', json: {} };
                if (url.includes('weight')) return { status: 404, text: 'Not Found', json: {} };
                if (url.includes('daily-oxygen-saturation')) return { status: 403, text: 'Forbidden', json: {} };
                return { status: 200, json: { dataPoints: [] } };
            }) : {}
        );

        const svc = new GoogleHealthService({
            healthSyncConfig: {
                sleep: { enabled: true, destination: 'frontmatter', key: 'Sleep_hours' },
                resting_heart_rate: { enabled: true, destination: 'frontmatter', key: 'resting_heart_rate' },
                blood_oxygen: { enabled: true, destination: 'frontmatter', key: 'spo2' },
                weight: { enabled: true, destination: 'frontmatter', key: 'weight' },
                body_fat: { enabled: true, destination: 'frontmatter', key: 'body_fat' }
            }
        }, { getAccessToken: async () => 'tok' });

        const res = await svc.fetchDailyHealth(targetDate);
        assert.equal(res.Sleep_hours, '7:00');
        assert.equal(res.resting_heart_rate, undefined);
        assert.equal(res.spo2, undefined);
        assert.equal(res.weight, undefined);
        assert.equal(res.body_fat, undefined);
        // On 403 for daily-oxygen-saturation, should not hammer fallback oxygen-saturation
        assert.equal(requestedUrls.some(u => u.includes('/dataTypes/oxygen-saturation/')), false);
    }
});

test('DailyNoteWriter.writeData skips processFrontMatter and vault.modify when computed frontmatter values are unchanged', async () => {
    const { DailyNoteWriter } = loadTsModule(
        path.join(__dirname, '../src/services/DailyNoteWriter.ts'),
        id => id === 'obsidian' ? {
            App: class {},
            TFile: class {},
            Notice: class {},
            normalizePath: p => p,
            moment: () => ({ format: () => '2026-11-25' })
        } : {}
    );

    let processCalls = 0;
    let modifyCalls = 0;
    const fm = {
        Sleep_hours: '7:15',
        steps: 8432,
        HRV: '48',
        workout: 'Walking (20m)',
        mindfulness_minutes: '15',
        alcohol_prev_calc: '0'
    };

    const mockApp = {
        vault: {
            getMarkdownFiles: () => [],
            read: async () => '',
            modify: async () => { modifyCalls++; }
        },
        metadataCache: {
            getFileCache: () => ({ frontmatter: fm })
        },
        fileManager: {
            processFrontMatter: async (file, fn) => {
                processCalls++;
                fn(fm);
            }
        }
    };

    const writer = new DailyNoteWriter(mockApp, {
        healthSyncConfig: {
            exercise: { key: 'workout' },
            mindfulness: { key: 'mindfulness_minutes' }
        },
        calculatedMetrics: [
            {
                id: 'calc_1',
                key: 'alcohol_prev_calc',
                label: 'Alcohol',
                formula: '0',
                unit: 'g',
                agg: 'last',
                chartType: 'none',
                color: '#000',
                writeToNote: true
            }
        ]
    });
    writer.getOrCreateDailyNote = async () => ({ basename: '2026-11-25', name: '2026-11-25.md' });

    // 1. Identical values (including numeric/string equivalence + calculated metric + workout + mindfulness)
    const okUnchanged = await writer.writeData('2026-11-25', {
        Sleep_hours: '7:15',
        steps: 8432,
        HRV: 48,
        workout: 'Walking (20m)',
        mindfulness_minutes: 15
    }, false);
    assert.equal(okUnchanged, true);
    assert.equal(processCalls, 0);
    assert.equal(modifyCalls, 0);

    // 2. Empty payload with no changes also skips write
    const okEmpty = await writer.writeData('2026-11-25', {}, false);
    assert.equal(okEmpty, true);
    assert.equal(processCalls, 0);
    assert.equal(modifyCalls, 0);

    // 3. Changing one metric triggers processFrontMatter only once and updates only changed value
    const okChanged = await writer.writeData('2026-11-25', {
        Sleep_hours: '7:15',
        steps: 9001,
        HRV: 48
    }, false);
    assert.equal(okChanged, true);
    assert.equal(processCalls, 1);
    assert.equal(fm.steps, '9001');

    // 4. Re-syncing the updated value skips again
    const okAfterUpdate = await writer.writeData('2026-11-25', {
        Sleep_hours: '7:15',
        steps: 9001,
        HRV: 48
    }, false);
    assert.equal(okAfterUpdate, true);
    assert.equal(processCalls, 1);

    // 5. Legacy meditation key triggers cleanup once
    fm.meditation = 10;
    const okCleanup = await writer.writeData('2026-11-25', {}, false);
    assert.equal(okCleanup, true);
    assert.equal(processCalls, 2);
    assert.equal(fm.meditation, undefined);
});

test('WorkoutSyncService.reconcileWorkouts skips processFrontMatter when workout and mindfulness are unchanged', async () => {
    const { WorkoutSyncService } = loadTsModule(
        path.join(__dirname, '../src/services/WorkoutSyncService.ts'),
        id => id === 'obsidian' ? { App: class {}, TFile: class {}, Notice: class {} } : {}
    );

    let processCalls = 0;
    const fm = {
        workout: 'Walking (20m)',
        mindfulness_minutes: '15'
    };
    const mockApp = {
        vault: { read: async () => '' },
        metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
        fileManager: {
            processFrontMatter: async (_, fn) => {
                processCalls++;
                fn(fm);
            }
        }
    };
    const service = new WorkoutSyncService(mockApp, { enableBidirectionalWorkouts: true, enableBidirectionalMindfulness: false }, {
        fetchExerciseSessionsForDate: async () => [
            { type: 'Walking', start: Date.parse('2026-11-25T09:00:00'), end: Date.parse('2026-11-25T09:20:00'), durationMins: 20 }
        ],
        postExerciseSession: async () => true
    });

    await service.reconcileWorkouts({ basename: '2026-11-25' }, { pushToCloud: false });
    assert.equal(processCalls, 0);
});

test('HealthConnectPlugin clamps automatic sync interval to at least 15 minutes', async () => {
    const intervalCalls = [];
    const origSetInterval = globalThis.window?.setInterval;
    const origClearInterval = globalThis.window?.clearInterval;
    globalThis.window = globalThis.window || {};
    globalThis.window.setInterval = (_fn, ms) => {
        intervalCalls.push(ms);
        return intervalCalls.length;
    };
    globalThis.window.clearInterval = () => {};

    try {
        class MockPlugin {
            constructor(app, manifest) { this.app = app; this.manifest = manifest; }
            addRibbonIcon() {}
            addCommand() {}
            registerEvent() {}
            registerInterval() {}
            registerMarkdownCodeBlockProcessor() {}
            addSettingTab() {}
            registerObsidianProtocolHandler() {}
            async loadData() { return { googleHealthSyncStyle: 'automatic', googleHealthSyncInterval: 5 }; }
            async saveData() {}
        }
        const mockObsidian = {
            Plugin: MockPlugin,
            Modal: class {},
            Notice: class {},
            TFile: class {},
            PluginSettingTab: class {},
            Setting: class {},
            Platform: { isDesktop: true },
            requestUrl: async () => ({ status: 200, json: {} })
        };
        const { default: HealthConnectPlugin } = loadTsModule(
            path.join(__dirname, '../src/main.ts'),
            id => id === 'obsidian' ? mockObsidian : {}
        );
        const plugin = new HealthConnectPlugin({ vault: { on: () => ({}), getMarkdownFiles: () => [] } }, { id: 'health-connect-readiness' });
        await plugin.loadSettings();
        assert.equal(plugin.settings.googleHealthSyncInterval, 15);
        plugin.settings.googleHealthSyncInterval = 5;
        plugin.setupAutoSync();
        assert.deepEqual(intervalCalls, [15 * 60 * 1000]);
    } finally {
        if (origSetInterval) globalThis.window.setInterval = origSetInterval;
        else delete globalThis.window.setInterval;
        if (origClearInterval) globalThis.window.clearInterval = origClearInterval;
        else delete globalThis.window.clearInterval;
    }
});

test('AutoSyncOwnership handles device ID persistence, platform labels, migration, and takeover', () => {
    const localStore = {};
    const mockApp = {
        loadLocalStorage: (k) => (k in localStore ? localStore[k] : null),
        saveLocalStorage: (k, v) => { localStore[k] = v; }
    };

    const {
        DEVICE_ID_STORAGE_KEY,
        getOrCreateDeviceId,
        getDevicePlatformLabel,
        migrateAutoSyncOwnership,
        claimAutoSyncOwnership,
        isCurrentDeviceAutoSyncOwner,
        isOwnedByAnotherDevice
    } = loadTsModule(
        path.join(__dirname, '../src/services/AutoSyncOwnership.ts'),
        id => id === 'obsidian' ? { Platform: { isWin: true } } : {}
    );

    const id1 = getOrCreateDeviceId(mockApp);
    assert.ok(id1.length > 0);
    assert.equal(localStore[DEVICE_ID_STORAGE_KEY], id1);
    assert.equal(getOrCreateDeviceId(mockApp), id1);

    assert.equal(getDevicePlatformLabel({ isWin: true }), 'Desktop (Windows)');
    assert.equal(getDevicePlatformLabel({ isAndroidApp: true, isMobile: true }), 'Mobile (Android)');
    assert.equal(getDevicePlatformLabel({ isIosApp: true, isMacOS: true, isMobile: true }), 'Mobile (iOS)');
    assert.equal(getDevicePlatformLabel({ isMacOS: true }), 'Desktop (macOS)');

    // Upgrade migration claims ownership when auto-sync is enabled and owner is empty
    const legacySettings = { autoSyncOnStartup: true, googleHealthSyncStyle: 'manual', autoSyncOwnerDeviceId: '', autoSyncOwnerLabel: '' };
    assert.equal(migrateAutoSyncOwnership(legacySettings, id1, 'Desktop (Windows)'), true);
    assert.equal(legacySettings.autoSyncOwnerDeviceId, id1);
    assert.equal(legacySettings.autoSyncOwnerLabel, 'Desktop (Windows)');
    assert.equal(isCurrentDeviceAutoSyncOwner(legacySettings, id1), true);
    assert.equal(isOwnedByAnotherDevice(legacySettings, id1), false);

    // Secondary device must not overwrite existing owner during migration
    assert.equal(migrateAutoSyncOwnership(legacySettings, 'pixel-id', 'Mobile (Android)'), false);
    assert.equal(legacySettings.autoSyncOwnerDeviceId, id1);
    assert.equal(isCurrentDeviceAutoSyncOwner(legacySettings, 'pixel-id'), false);
    assert.equal(isOwnedByAnotherDevice(legacySettings, 'pixel-id'), true);

    // Explicit takeover transfers ownership
    assert.equal(claimAutoSyncOwnership(legacySettings, 'pixel-id', 'Mobile (Android)'), true);
    assert.equal(legacySettings.autoSyncOwnerDeviceId, 'pixel-id');
    assert.equal(legacySettings.autoSyncOwnerLabel, 'Mobile (Android)');
    assert.equal(isCurrentDeviceAutoSyncOwner(legacySettings, 'pixel-id'), true);
    assert.equal(isCurrentDeviceAutoSyncOwner(legacySettings, id1), false);
});

test('HealthConnectPlugin decouples startup sync from scheduled sync and enforces single-device ownership', async () => {
    const origSetTimeout = globalThis.setTimeout;
    const origSetInterval = globalThis.window?.setInterval;
    const origClearInterval = globalThis.window?.clearInterval;

    const scheduledTimeouts = [];
    const scheduledIntervals = [];
    globalThis.setTimeout = (fn, ms) => {
        scheduledTimeouts.push({ fn, ms });
        return scheduledTimeouts.length;
    };
    globalThis.window = globalThis.window || {};
    globalThis.window.setInterval = (fn, ms) => {
        scheduledIntervals.push({ fn, ms });
        return scheduledIntervals.length;
    };
    globalThis.window.clearInterval = () => {};

    try {
        class MockPlugin {
            constructor(app, manifest) { this.app = app; this.manifest = manifest; }
            addRibbonIcon() {}
            addCommand() {}
            registerEvent() {}
            registerInterval() {}
            registerMarkdownCodeBlockProcessor() {}
            addSettingTab() {}
            registerObsidianProtocolHandler() {}
            async loadData() { return this.app._data; }
            async saveData(d) { this.app._saved.push(JSON.parse(JSON.stringify(d))); }
        }
        const mockObsidian = {
            Plugin: MockPlugin,
            Modal: class {},
            Notice: class {},
            TFile: class {},
            PluginSettingTab: class {},
            Setting: class {},
            Platform: { isWin: true },
            requestUrl: async () => ({ status: 200, json: {} })
        };
        const { default: HealthConnectPlugin } = loadTsModule(
            path.join(__dirname, '../src/main.ts'),
            id => id === 'obsidian' ? mockObsidian : {}
        );

        const makePlugin = (data, localId = 'desktop-1') => {
            const store = { 'health-connect-device-id': localId };
            const app = {
                _data: data,
                _saved: [],
                loadLocalStorage: (k) => store[k] ?? null,
                saveLocalStorage: (k, v) => { store[k] = v; },
                vault: { on: () => ({}), getMarkdownFiles: () => [] }
            };
            const plugin = new HealthConnectPlugin(app, { id: 'health-connect-readiness' });
            return { plugin, app };
        };

        // 1. Decoupling: googleHealthSyncStyle === 'automatic' with autoSyncOnStartup === false
        // must NOT trigger 4s startup sync, and MUST schedule periodic interval when owned.
        {
            scheduledTimeouts.length = 0;
            scheduledIntervals.length = 0;
            const { plugin, app } = makePlugin({
                autoSyncOnStartup: false,
                googleHealthSyncStyle: 'automatic',
                googleHealthSyncInterval: 30
            }, 'desktop-1');
            await plugin.onload();
            assert.equal(app._saved.length, 1, 'Migration should persist claimed owner');
            assert.equal(plugin.settings.autoSyncOwnerDeviceId, 'desktop-1');
            assert.equal(plugin.settings.autoSyncOwnerLabel, 'Desktop (Windows)');
            assert.equal(scheduledTimeouts.filter(t => t.ms === 4000).length, 0, 'Startup sync must not fire when autoSyncOnStartup is false');
            assert.equal(scheduledIntervals.length, 1, 'Periodic interval should be scheduled');
        }

        // 2. Decoupling: autoSyncOnStartup === true with googleHealthSyncStyle === 'manual'
        // MUST trigger 4s startup sync, and MUST NOT schedule periodic interval.
        {
            scheduledTimeouts.length = 0;
            scheduledIntervals.length = 0;
            const { plugin } = makePlugin({
                autoSyncOnStartup: true,
                googleHealthSyncStyle: 'manual',
                autoSyncOwnerDeviceId: 'desktop-1',
                autoSyncOwnerLabel: 'Desktop (Windows)'
            }, 'desktop-1');
            await plugin.onload();
            assert.equal(scheduledTimeouts.filter(t => t.ms === 4000).length, 1, 'Startup sync should be scheduled');
            assert.equal(scheduledIntervals.length, 0, 'Manual schedule must not register interval');
        }

        // 3. Secondary-device suppression: another device owns auto-sync -> neither startup nor interval runs.
        {
            scheduledTimeouts.length = 0;
            scheduledIntervals.length = 0;
            const { plugin, app } = makePlugin({
                autoSyncOnStartup: true,
                googleHealthSyncStyle: 'automatic',
                googleHealthSyncInterval: 30,
                autoSyncOwnerDeviceId: 'other-device',
                autoSyncOwnerLabel: 'Desktop (Windows)'
            }, 'pixel-mobile');
            await plugin.onload();
            assert.equal(app._saved.length, 0, 'Secondary device must not overwrite owner on load');
            assert.equal(plugin.settings.autoSyncOwnerDeviceId, 'other-device');
            assert.equal(scheduledTimeouts.filter(t => t.ms === 4000).length, 0, 'Secondary device must suppress startup sync');
            assert.equal(scheduledIntervals.length, 0, 'Secondary device must suppress periodic interval');
        }

        // 4. Interval callback re-checks ownership and suppresses sync if ownership changed mid-session.
        {
            scheduledTimeouts.length = 0;
            scheduledIntervals.length = 0;
            const { plugin } = makePlugin({
                autoSyncOnStartup: false,
                googleHealthSyncStyle: 'automatic',
                googleHealthSyncInterval: 15,
                autoSyncOwnerDeviceId: 'desktop-1',
                autoSyncOwnerLabel: 'Desktop (Windows)'
            }, 'desktop-1');
            await plugin.onload();
            let syncCalls = 0;
            plugin.oauthService.isConnected = () => true;
            plugin.syncDateHealth = async () => { syncCalls++; };

            assert.equal(scheduledIntervals.length, 1);
            await scheduledIntervals[0].fn();
            assert.equal(syncCalls, 1);

            plugin.settings.autoSyncOwnerDeviceId = 'other-device';
            await scheduledIntervals[0].fn();
            assert.equal(syncCalls, 1, 'Interval callback must re-check ownership and suppress sync');
        }
    } finally {
        globalThis.setTimeout = origSetTimeout;
        if (origSetInterval) globalThis.window.setInterval = origSetInterval;
        else delete globalThis.window.setInterval;
        if (origClearInterval) globalThis.window.clearInterval = origClearInterval;
        else delete globalThis.window.clearInterval;
    }
});

test('HealthSettingsTab shows ownership warning banner, supports takeover, and warns on Background Sync Schedule', async () => {
    const makeNode = (tagName = 'div', opts = {}) => {
        const node = createMockElement(tagName, opts.cls || '');
        if (opts.text) node.textContent = opts.text;
        if (opts.value !== undefined) node.value = opts.value;
        node.disabled = false;
        node.selected = false;
        node.title = '';
        node.onclick = null;
        node.appendText = (t) => { node.textContent += t; };
        node.setText = (t) => { node.textContent = t; };
        node.setAttr = (k, v) => { node.attrs[k] = v; };
        node.addEventListener = () => {};
        node.removeEventListener = () => {};
        node.createEl = (t, o = {}) => {
            const child = makeNode(t, o);
            node.children.push(child);
            return child;
        };
        node.createDiv = (o = {}) => {
            const child = makeNode('div', o);
            node.children.push(child);
            return child;
        };
        node.createSpan = (o = {}) => {
            const child = makeNode('span', o);
            node.children.push(child);
            return child;
        };
        return node;
    };

    const settingsRecorded = [];
    class MockSetting {
        constructor() {
            this.name = '';
            this.desc = null;
            this.controlEl = makeNode('div');
            this.handlers = {};
            settingsRecorded.push(this);
        }
        setName(n) { this.name = n; return this; }
        setDesc(d) { this.desc = d; return this; }
        setClass() { return this; }
        addText(fn) { fn({ inputEl: makeNode('input'), setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
        addTextArea(fn) { fn({ inputEl: makeNode('textarea'), setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
        addDropdown(fn) {
            const dd = {
                addOption() { return this; },
                setValue() { return this; },
                onChange: (cb) => { this.handlers.dropdownOnChange = cb; return dd; }
            };
            fn(dd);
            return this;
        }
        addSlider(fn) { fn({ setLimits() { return this; }, setValue() { return this; }, setDynamicTooltip() { return this; }, onChange() { return this; } }); return this; }
        addToggle(fn) {
            const tg = {
                setValue() { return this; },
                onChange: (cb) => { this.handlers.toggleOnChange = cb; return tg; }
            };
            fn(tg);
            return this;
        }
        addButton(fn) { fn({ setButtonText() { return this; }, setCta() { return this; }, onClick() { return this; } }); return this; }
        addExtraButton(fn) { fn({ setIcon() { return this; }, setTooltip() { return this; }, onClick() { return this; } }); return this; }
    }

    const { HealthSettingsTab } = loadTsModule(
        path.join(__dirname, '../src/settings/HealthSettingsTab.ts'),
        id => id === 'obsidian' ? {
            App: class {},
            PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
            Setting: MockSetting,
            Notice: class {},
            Platform: { isAndroidApp: true, isMobile: true }
        } : {}
    );

    const store = { 'health-connect-device-id': 'pixel-mobile' };
    const mockApp = {
        loadLocalStorage: (k) => store[k] ?? null,
        saveLocalStorage: (k, v) => { store[k] = v; },
        vault: { getMarkdownFiles: () => [] }
    };
    let saveCalls = 0;
    let setupAutoSyncCalls = 0;
    const mockPlugin = {
        oauthService: { isConnected: () => false },
        settings: {
            autoSyncOnStartup: false,
            googleHealthSyncStyle: 'automatic',
            googleHealthSyncInterval: 60,
            autoSyncOwnerDeviceId: 'desktop-win',
            autoSyncOwnerLabel: 'Desktop (Windows)',
            healthSyncConfig: {},
            dashboardCards: [],
            calculatedMetrics: [],
            requestedScopes: []
        },
        saveSettings: async () => { saveCalls++; },
        setupAutoSync: () => { setupAutoSyncCalls++; }
    };

    const tab = new HealthSettingsTab(mockApp, mockPlugin);
    tab.containerEl = makeNode('div');
    globalThis.createFragment = (fn) => { const frag = makeNode('div'); fn(frag); return frag; };
    tab.display();

    const collectText = (node) => {
        if (!node) return '';
        if (typeof node === 'string') return node;
        return (node.textContent || '') + ' ' + (node.children || []).map(collectText).join(' ');
    };
    const findNode = (node, pred) => {
        if (pred(node)) return node;
        for (const c of (node.children || [])) {
            const found = findNode(c, pred);
            if (found) return found;
        }
        return null;
    };

    const banner = findNode(tab.containerEl, n => n.hasClass && n.hasClass('health-autosync-owner-warning'));
    assert.ok(banner, 'Warning banner should render when owned by a different device');
    const bannerText = collectText(banner);
    assert.match(bannerText, /Desktop \(Windows\)/);
    assert.match(bannerText, /paused on this device/i);

    const scheduleSetting = settingsRecorded.find(s => s.name === 'Background Sync Schedule');
    assert.ok(scheduleSetting, 'Background Sync Schedule setting should exist');
    assert.match(collectText(scheduleSetting.desc), /Multi-device warning:/);

    const takeoverBtn = findNode(banner, n => n.tagName === 'button' && n.textContent === 'Use This Device Instead');
    assert.ok(takeoverBtn, 'Takeover button should exist');
    await takeoverBtn.onclick();

    assert.equal(mockPlugin.settings.autoSyncOwnerDeviceId, 'pixel-mobile');
    assert.equal(mockPlugin.settings.autoSyncOwnerLabel, 'Mobile (Android)');
    assert.equal(saveCalls, 1);
    assert.equal(setupAutoSyncCalls, 1);

    const bannerAfter = findNode(tab.containerEl, n => n.hasClass && n.hasClass('health-autosync-owner-warning'));
    assert.equal(bannerAfter, null, 'Warning banner should disappear after claiming ownership');

    // Verify enabling startup sync or switching schedule to automatic claims ownership
    mockPlugin.settings.autoSyncOwnerDeviceId = 'other-device';
    mockPlugin.settings.autoSyncOwnerLabel = 'Desktop (Windows)';
    const startupSetting = settingsRecorded.find(s => s.name === 'Auto-Sync on Startup');
    await startupSetting.handlers.toggleOnChange(true);
    assert.equal(mockPlugin.settings.autoSyncOwnerDeviceId, 'pixel-mobile');
    assert.equal(mockPlugin.settings.autoSyncOwnerLabel, 'Mobile (Android)');

    mockPlugin.settings.autoSyncOwnerDeviceId = 'other-device';
    const latestSchedule = settingsRecorded.filter(s => s.name === 'Background Sync Schedule').pop();
    await latestSchedule.handlers.dropdownOnChange('automatic');
    assert.equal(mockPlugin.settings.autoSyncOwnerDeviceId, 'pixel-mobile');
});

test('GoogleOAuthService scopes SecretStorage keys per vault, tightens isConnected(), and surfaces refresh errors in testConnection()', async () => {
    let nextTokenResponses = [];
    const tokenRequests = [];
    const notices = [];
    const mockObsidian = {
        Modal: class {},
        Notice: class { constructor(m) { notices.push(m); } },
        Platform: { isDesktopApp: true, isMobileApp: false },
        Setting: class {},
        requestUrl: async (req) => {
            tokenRequests.push(req);
            if (nextTokenResponses.length > 0) {
                const next = nextTokenResponses.shift();
                if (next instanceof Error) throw next;
                return next;
            }
            return { status: 200, json: {} };
        }
    };

    const {
        GoogleOAuthService,
        LEGACY_SECRET_KEYS,
        getVaultSlug,
        getVaultSecretKey
    } = loadTsModule(
        path.join(__dirname, '../src/services/GoogleOAuthService.ts'),
        id => id === 'obsidian' ? mockObsidian : {}
    );

    // 1. Vault slug & key scoping helper
    assert.equal(getVaultSlug({ appId: 'MainVault_01', vault: { getName: () => 'Ignored' } }), 'mainvault_01');
    assert.equal(getVaultSlug({ vault: { getName: () => 'Health Connect (Test)!' } }), 'health-connect-test');
    assert.equal(getVaultSlug({}), 'default');

    const testApp = {
        appId: 'Vault-Test-2',
        secretStorage: {
            store: {},
            async getSecret(k) { return this.store[k] ?? null; },
            async setSecret(k, v) { this.store[k] = v; }
        }
    };
    const otherApp = {
        appId: 'Main-Vault-1',
        secretStorage: testApp.secretStorage
    };

    assert.equal(getVaultSecretKey(testApp, 'client-secret'), 'health-connect-vault-test-2-client-secret');
    assert.equal(getVaultSecretKey(testApp, LEGACY_SECRET_KEYS.refreshToken), 'health-connect-vault-test-2-refresh-token');
    assert.equal(getVaultSecretKey(testApp, LEGACY_SECRET_KEYS.googleCredentials), 'health-connect-vault-test-2-google-credentials');

    const mainSettings = { clientId: 'main-cid', clientSecret: '', redirectUri: 'http://localhost:8092', tokens: {} };
    const testSettings = { clientId: '', clientSecret: '', redirectUri: 'http://localhost:8092', tokens: {} };

    const mainOAuth = new GoogleOAuthService(otherApp, mainSettings, async () => {});
    const testOAuth = new GoogleOAuthService(testApp, testSettings, async () => {});

    await mainOAuth.setSecret(LEGACY_SECRET_KEYS.refreshToken, 'main-refresh-secret-value');
    await mainOAuth.setSecret(LEGACY_SECRET_KEYS.clientSecret, 'main-client-secret-value');

    // Pasting different client JSON in test vault must NOT overwrite main vault's secret
    const applied = await testOAuth.parseAndApplyCredentialsJson(JSON.stringify({
        installed: {
            client_id: 'test-cid',
            client_secret: 'test-client-secret-value',
            redirect_uris: ['http://localhost:8092']
        }
    }));
    assert.equal(applied, true);
    assert.equal(await mainOAuth.getSecret(LEGACY_SECRET_KEYS.clientSecret), 'main-client-secret-value');
    assert.equal(await testOAuth.getSecret(LEGACY_SECRET_KEYS.clientSecret), 'test-client-secret-value');
    assert.equal(await testOAuth.getSecret(LEGACY_SECRET_KEYS.refreshToken), '');
    assert.equal(testApp.secretStorage.store['health-connect-client-secret'], undefined);

    // 2. Stricter isConnected()
    const checkConn = (partial) => new GoogleOAuthService({}, { tokens: {}, ...partial }, async () => {}).isConnected();
    assert.equal(checkConn({ clientId: '', clientSecret: '', tokens: { refreshToken: 'stale-ref' } }), false);
    assert.equal(checkConn({ clientId: 'cid', clientSecret: '', tokens: { refreshToken: 'stale-ref' } }), false);
    assert.equal(checkConn({ clientId: 'cid', clientSecret: 'sec', tokens: {} }), false);
    assert.equal(checkConn({ clientId: 'cid', clientSecret: 'sec', tokens: { refreshToken: 'ref' } }), true);
    assert.equal(checkConn({ clientId: 'cid', clientSecret: '', tokens: { accessToken: 'acc' } }), true);

    // 3. Surface real OAuth refresh errors in testConnection() without leaking secrets
    let res = await testOAuth.testConnection();
    assert.equal(res.ok, false);
    assert.match(res.message, /Missing Refresh Token/);
    assert.equal(res.message.includes('test-client-secret-value'), false);

    testSettings.tokens = { refreshToken: 'super-secret-refresh-token-999' };
    nextTokenResponses.push({
        status: 400,
        text: JSON.stringify({ error: 'unauthorized_client', error_description: 'Unauthorized' }),
        json: { error: 'unauthorized_client', error_description: 'Unauthorized' }
    });
    res = await testOAuth.testConnection();
    assert.equal(res.ok, false);
    assert.equal(res.message, 'unauthorized_client: Unauthorized');
    assert.equal(testOAuth.lastAuthError, 'unauthorized_client: Unauthorized');

    nextTokenResponses.push({
        status: 400,
        text: JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
    });
    res = await testOAuth.testConnection();
    assert.equal(res.ok, false);
    assert.equal(res.message, 'invalid_grant: Token has been expired or revoked.');

    // Network exception must redact any secret values if present in error text
    nextTokenResponses.push(new Error('Failed with test-client-secret-value and super-secret-refresh-token-999'));
    res = await testOAuth.testConnection();
    assert.equal(res.ok, false);
    assert.equal(res.message.includes('test-client-secret-value'), false);
    assert.equal(res.message.includes('super-secret-refresh-token-999'), false);
    assert.match(res.message, /\[REDACTED\]/);

    // Successful refresh clears lastAuthError and validates tokeninfo
    nextTokenResponses.push(
        { status: 200, json: { access_token: 'fresh-access', expires_in: 3600 } },
        { status: 200, json: { azp: 'test-cid' } }
    );
    res = await testOAuth.testConnection();
    assert.equal(res.ok, true);
    assert.equal(testOAuth.lastAuthError, '');
});

test('HealthConnectPlugin loadSettings/saveSettings isolate fresh vaults and safely migrate legacy SecretStorage keys', async () => {
    const createPluginHarness = (vaultName, initialData, sharedStore) => {
        let savedData = null;
        class MockPlugin {
            constructor(app, manifest) { this.app = app; this.manifest = manifest; }
            addRibbonIcon() {}
            addCommand() {}
            registerEvent() {}
            registerInterval() {}
            registerMarkdownCodeBlockProcessor() {}
            addSettingTab() {}
            registerObsidianProtocolHandler() {}
            async loadData() { return initialData; }
            async saveData(d) { savedData = d; }
        }
        const mockObsidian = {
            Plugin: MockPlugin,
            Modal: class {},
            Notice: class {},
            TFile: class {},
            PluginSettingTab: class {},
            Setting: class {},
            Platform: { isDesktop: true, isDesktopApp: true },
            requestUrl: async () => ({ status: 200, json: {} })
        };
        const { default: HealthConnectPlugin } = loadTsModule(
            path.join(__dirname, '../src/main.ts'),
            id => id === 'obsidian' ? mockObsidian : {}
        );
        const app = {
            vault: { getName: () => vaultName, on: () => ({}), getMarkdownFiles: () => [] },
            secretStorage: {
                async getSecret(k) { return sharedStore[k] ?? null; },
                async setSecret(k, v) { sharedStore[k] = v; }
            }
        };
        const plugin = new HealthConnectPlugin(app, { id: 'health-connect-readiness' });
        return { plugin, getSavedData: () => savedData };
    };

    // Shared keychain holds legacy global secrets from an existing vault
    const sharedKeychain = {
        'health-connect-client-secret': 'legacy-global-secret',
        'health-connect-refresh-token': 'legacy-global-refresh',
        'health-connect-google-credentials': '{"installed":{"client_id":"main-cid"}}'
    };

    // Case 1: Brand-new empty test vault (no loaded.clientId) MUST NOT inherit legacy global tokens
    const freshHarness = createPluginHarness('HealthConnectTest', null, sharedKeychain);
    await freshHarness.plugin.loadSettings();
    assert.equal(freshHarness.plugin.settings.clientId, '');
    assert.equal(freshHarness.plugin.settings.clientSecret, '');
    assert.equal(freshHarness.plugin.settings.tokens.refreshToken || '', '');
    assert.equal(freshHarness.plugin.settings.rawCredentialsJson, '');
    assert.equal(sharedKeychain['health-connect-healthconnecttest-refresh-token'], undefined);

    // Saving new credentials in fresh vault stores under vault-scoped keys without overwriting legacy or main vault
    freshHarness.plugin.settings.clientId = 'test-cid';
    freshHarness.plugin.settings.clientSecret = 'test-secret';
    freshHarness.plugin.settings.rawCredentialsJson = '{"installed":{"client_id":"test-cid"}}';
    await freshHarness.plugin.saveSettings();
    assert.equal(sharedKeychain['health-connect-healthconnecttest-client-secret'], 'test-secret');
    assert.equal(sharedKeychain['health-connect-healthconnecttest-google-credentials'], '{"installed":{"client_id":"test-cid"}}');
    assert.equal(sharedKeychain['health-connect-client-secret'], 'legacy-global-secret');
    assert.equal(freshHarness.getSavedData().clientSecret, '');
    assert.equal(freshHarness.getSavedData().rawCredentialsJson, '');

    // Reloading fresh vault after pasting different client JSON MUST NOT pull legacy-global-refresh
    const freshReloadHarness = createPluginHarness('HealthConnectTest', { clientId: 'test-cid', tokens: {} }, sharedKeychain);
    await freshReloadHarness.plugin.loadSettings();
    assert.equal(freshReloadHarness.plugin.settings.clientSecret, 'test-secret');
    assert.equal(freshReloadHarness.plugin.settings.tokens.refreshToken || '', '');

    // Case 2: Existing upgraded vault (non-empty loaded.clientId, no scoped keys yet) migrates legacy keys into vault-scoped keys
    const upgradedHarness = createPluginHarness('MainVault', { clientId: 'main-cid', tokens: { expiresAt: 123 } }, sharedKeychain);
    await upgradedHarness.plugin.loadSettings();
    assert.equal(upgradedHarness.plugin.settings.clientSecret, 'legacy-global-secret');
    assert.equal(upgradedHarness.plugin.settings.tokens.refreshToken, 'legacy-global-refresh');
    assert.equal(upgradedHarness.plugin.settings.rawCredentialsJson, '{"installed":{"client_id":"main-cid"}}');
    assert.equal(sharedKeychain['health-connect-mainvault-client-secret'], 'legacy-global-secret');
    assert.equal(sharedKeychain['health-connect-mainvault-refresh-token'], 'legacy-global-refresh');
    assert.equal(sharedKeychain['health-connect-mainvault-google-credentials'], '{"installed":{"client_id":"main-cid"}}');

    // Case 3: Vault-scoped keys take precedence over legacy keys when both exist
    sharedKeychain['health-connect-mainvault-refresh-token'] = 'scoped-newer-refresh';
    const secondLoadHarness = createPluginHarness('MainVault', { clientId: 'main-cid', tokens: { expiresAt: 123 } }, sharedKeychain);
    await secondLoadHarness.plugin.loadSettings();
    assert.equal(secondLoadHarness.plugin.settings.tokens.refreshToken, 'scoped-newer-refresh');
});

test('escapeHtml escapes XSS payloads and localhost OAuth callback escapes HTML responses with UTF-8 Content-Type', async () => {
    let requestHandler = null;
    const prevWindow = global.window;
    const prevSetTimeout = global.setTimeout;

    const { escapeHtml, GoogleOAuthService } = loadTsModule(
        path.join(__dirname, '../src/services/GoogleOAuthService.ts'),
        id => {
            if (id === 'obsidian') {
                return {
                    Modal: class {},
                    Notice: class {},
                    Platform: { isDesktopApp: true, isMobileApp: false },
                    Setting: class {},
                    requestUrl: async () => ({
                        status: 400,
                        text: '<img src=x onerror="alert(1)">',
                        json: { error: 'invalid_grant' }
                    })
                };
            }
            if (id === 'http') {
                return {
                    createServer(handler) {
                        requestHandler = handler;
                        return {
                            on() {},
                            listen(_port, cb) { if (cb) cb(); },
                            close() {}
                        };
                    }
                };
            }
            return {};
        }
    );

    // Direct escapeHtml unit checks
    assert.equal(
        escapeHtml('<script>alert("xss")</script> & \'quote\''),
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;quote&#39;'
    );
    assert.equal(escapeHtml('plain-text_123'), 'plain-text_123');
    assert.equal(escapeHtml('&<>\"\''), '&amp;&lt;&gt;&quot;&#39;');

    try {
        global.window = {
            require: (id) => id === 'http' ? {
                createServer(handler) {
                    requestHandler = handler;
                    return {
                        on() {},
                        listen(_port, cb) { if (cb) cb(); },
                        close() {}
                    };
                }
            } : {},
            open() {}
        };
        global.setTimeout = () => 0;

        const settings = {
            clientId: '<svg onload=1>',
            clientSecret: 'secret-456',
            redirectUri: 'http://localhost:8092',
            requestedScopes: [],
            tokens: {}
        };
        const oauth = new GoogleOAuthService({}, settings, async () => {});

        // 1) Reflected error query parameter in callback response
        await oauth.startOAuthFlow(true);
        assert.equal(typeof requestHandler, 'function');
        const errorRes = {
            statusCode: null,
            headers: null,
            body: '',
            writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
            end(chunk) { this.body = chunk || ''; }
        };
        await requestHandler({ url: '/?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E' }, errorRes);
        assert.equal(errorRes.statusCode, 400);
        assert.equal(errorRes.headers['Content-Type'], 'text/html; charset=utf-8');
        assert.equal(errorRes.body.includes('<script>'), false);
        assert.ok(errorRes.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));

        // 2) Token exchange error & clientId escaping in callback response
        await oauth.startOAuthFlow(true);
        const exchangeErrorRes = {
            statusCode: null,
            headers: null,
            body: '',
            writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
            end(chunk) { this.body = chunk || ''; }
        };
        await requestHandler({ url: '/?code=test-code' }, exchangeErrorRes);
        assert.equal(exchangeErrorRes.statusCode, 400);
        assert.equal(exchangeErrorRes.headers['Content-Type'], 'text/html; charset=utf-8');
        assert.equal(exchangeErrorRes.body.includes('<img'), false);
        assert.equal(exchangeErrorRes.body.includes('<svg'), false);
        assert.ok(exchangeErrorRes.body.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
        assert.ok(exchangeErrorRes.body.includes('&lt;svg onload=1&gt;'));
    } finally {
        global.window = prevWindow;
        global.setTimeout = prevSetTimeout;
    }
});
