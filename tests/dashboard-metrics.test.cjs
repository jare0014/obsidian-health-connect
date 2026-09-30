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
            return { SvgCharts: class {} };
        }
        return {};
    }
);

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
