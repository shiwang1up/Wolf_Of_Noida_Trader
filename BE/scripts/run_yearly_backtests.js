const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const symbol = 'BTCUSDT';
const timeframe = '1d';
const table = 'binanceCandle';
const testingDir = path.join(__dirname, '..', 'testing');
const generatedReportsDir = path.join(testingDir, 'generated_report');

// ── Engine selection ─────────────────────────────────────────────────────
// Pass --aggressive, --passive, or --balanced (default) to select the signal engine.
const useAggressive = process.argv.includes('--aggressive');
const usePassive    = process.argv.includes('--passive');
const engineFlag    = useAggressive ? '--aggressive' : usePassive ? '--passive' : '--balanced';
const engineLabel   = useAggressive ? '🔥 AGGRESSIVE' : usePassive ? '🛡️  PASSIVE' : '⚖️  BALANCED';

// Ensure directories exist
if (!fs.existsSync(testingDir)) fs.mkdirSync(testingDir);
if (!fs.existsSync(generatedReportsDir)) fs.mkdirSync(generatedReportsDir);

const years = [
    { start: '2019', end: '2020' },
    { start: '2020', end: '2021' },
    { start: '2021', end: '2022' },
    { start: '2022', end: '2023' },
    { start: '2023', end: '2024' },
    { start: '2024', end: '2025' },
    { start: '2025', end: '2026' }
];

const allYearsSummary = {};

console.log(`🐺 Starting Yearly Backtests (2019-2026) — Engine: ${engineLabel}\n`);

for (const { start, end } of years) {
    const startTime = `${start}-01-01`;
    const endTime = `${end}-01-01`;
    const yearLabel = `${start}_${end}`;
    
    console.log(`⏳ Running Backtest for ${yearLabel}...`);
    
    const runScriptResult = spawnSync(
        'node', 
        ['scripts/backtest.js', symbol, timeframe, startTime, endTime, '--fees', `--table=${table}`, '--no-ui', engineFlag],
        {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf-8'
        }
    );

    if (runScriptResult.error) {
        console.error(`❌ Error running backtest for ${yearLabel}: ${runScriptResult.error.message}`);
        continue;
    }

    // After backtest.js completes, it drops a 'backtest_results_BTCUSDT_<timestamp>.json' file in the BE root.
    // We need to find the newest one.
    const files = fs.readdirSync(path.join(__dirname, '..'));
    const resultFiles = files.filter(f => f.startsWith('backtest_results_BTCUSDT_') && f.endsWith('.json'));
    
    if (resultFiles.length === 0) {
         console.error(`⚠️ Could not find backtest generated JSON file for ${yearLabel}.`);
         console.log('--- STDOUT ---');
         console.log(runScriptResult.stdout);
         console.log('--- STDERR ---');
         console.log(runScriptResult.stderr);
         continue;
    }

    // Sort by timestamp to find the latest
    resultFiles.sort((a, b) => {
        const tA = parseInt(a.split('_').pop().replace('.json', ''));
        const tB = parseInt(b.split('_').pop().replace('.json', ''));
        return tB - tA; // descending
    });

    const latestResultFile = resultFiles[0];
    const latestResultPath = path.join(__dirname, '..', latestResultFile);
    
    try {
        const rawData = fs.readFileSync(latestResultPath, 'utf-8');
        const jsonData = JSON.parse(rawData);
        
        // 1. Save ONLY the exact stats requested for the YEAR report
        const winRateStr = jsonData.stats.TOTAL_TRADES > 0 
            ? ((jsonData.stats.WIN / (jsonData.stats.WIN + jsonData.stats.LOSS)) * 100).toFixed(2) + '%'
            : '0%';

        const yearSummaryData = {
            stats: {
                WIN: jsonData.stats.WIN,
                LOSS: jsonData.stats.LOSS,
                NEUTRAL: jsonData.stats.NEUTRAL,
                TOTAL_TRADES: jsonData.stats.TOTAL_TRADES,
                WIN_RATE: winRateStr
            },
            summary: jsonData.summary
        };

        const yearReportFilename = `backtest_report_${yearLabel}.json`;
        fs.writeFileSync(
            path.join(testingDir, yearReportFilename), 
            JSON.stringify(yearSummaryData, null, 2)
        );

        // 2. Move the full JSON detailing the trades to the deep analysis folder
        const fullReportFilename = `backtest_full_depth_${yearLabel}.json`;
        fs.renameSync(
            latestResultPath,
            path.join(generatedReportsDir, fullReportFilename)
        );

        // Track in master summary
        allYearsSummary[yearLabel] = yearSummaryData;

        console.log(`✅ ${yearLabel} Complete! => PnL: $${jsonData.summary.pnl.toFixed(2)} | Win Rate: ${winRateStr}`);
        
    } catch (err) {
         console.error(`❌ Error parsing result file ${latestResultFile} for ${yearLabel}: ${err.message}`);
    }
}

console.log('\n======================================================');
console.log('✅ ALL YEARLY RUNS COMPLETE');
console.log(`Yearly summaries written to:    /testing/backtest_report_*.json`);
console.log(`Full depth analysis written to: /testing/generated_report/backtest_full_depth_*.json`);
console.log('======================================================\n');
// Also save a master summary
fs.writeFileSync(
    path.join(testingDir, 'master_summary_all_years.json'), 
    JSON.stringify(allYearsSummary, null, 2)
);
console.log('Master summary saved to: /testing/master_summary_all_years.json');
