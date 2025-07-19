import * as cp from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BenchmarkResults, SpawnResult, ToolResults } from './types';

const NUMBER_OF_RUNS = 10;
const NUMBER_OF_PREP_RUNS = 2;

/**
 * Nx-specific environment variables for consistent benchmarking
 * These variables ensure Nx runs in a predictable state across all benchmark runs
 */
const NX_ENV_VARS = {
  // Disable dynamic output to prevent output interference during benchmarking
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT: 'false',
  // Disable Nx daemon to ensure consistent cold-start performance measurement
  NX_DAEMON: 'false',
  // Use temporary cache path to avoid interference with local development cache
  NX_DB_PATH: '/tmp/nx-cache',
  // Skip database operations for faster benchmarking
  NX_SKIP_DB: 'true',
} as const;

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const remainingMs = ms % 1000;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}.${remainingMs
      .toString()
      .padStart(3, '0')}s`;
  } else {
    return `${remainingSeconds}.${remainingMs.toString().padStart(3, '0')}s`;
  }
}

function getOptimalConcurrency(): { prep: number; benchmark: number } {
  const cpuCount = os.cpus().length;
  const isCI = process.env.CI === 'true';
  const override = process.env.BENCHMARK_CONCURRENCY;

  if (override) {
    const overrideValue = parseInt(override, 10);
    if (!isNaN(overrideValue) && overrideValue > 0) {
      return { prep: overrideValue, benchmark: overrideValue };
    }
  }

  if (isCI) {
    // CI: Conservative prep, max performance for benchmark
    const prep = Math.max(1, Math.floor(cpuCount * 0.5) - 1);
    const benchmark = Math.max(1, cpuCount - 1);
    return { prep, benchmark };
  } else {
    // Local dev: Leave resources for other tasks
    const prep = Math.max(1, Math.floor(cpuCount * 0.5) - 1);
    const benchmark = Math.max(1, Math.floor(cpuCount * 0.5) - 1);
    return { prep, benchmark };
  }
}

function logSection(title: string): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}`);
}

function logSubsection(title: string): void {
  console.log(`\n${'-'.repeat(40)}`);
  console.log(`  ${title}`);
  console.log(`${'-'.repeat(40)}`);
}

function spawnSync(cmd: string, args: string[]): SpawnResult {
  return cp.spawnSync(
    path.join(
      '.',
      'node_modules',
      '.bin',
      os.platform() === 'win32' ? cmd + '.cmd' : cmd
    ),
    args,
    {
      stdio: 'pipe',
      env: {
        ...process.env,
        ...NX_ENV_VARS,
      },
      encoding: 'utf8',
    }
  );
}

function cleanFolders(): void {
  // Keep this disabled like in original to maintain cache comparison
}

function cleanNxCache(): void {
  try {
    const result = spawnSync('nx', ['reset']);
    if (result.status !== 0) {
      console.warn('Failed to reset Nx cache, continuing...');
    }
  } catch (error) {
    console.warn('Failed to reset Nx cache, continuing...');
  }
}

function calculateStats(runs: number[]): Pick<ToolResults, 'min' | 'max'> {
  return {
    min: Math.min(...runs),
    max: Math.max(...runs),
  };
}

function runCommandWithFallback(
  cmd: string,
  args: string[],
  fallbackArgs: string[] = []
): SpawnResult {
  // First attempt: try with original command
  let result = spawnSync(cmd, args);

  // If SQLite failure detected, retry with fallback args
  if (
    result.status !== 0 &&
    result.stderr?.includes('SqliteFailure') &&
    fallbackArgs.length > 0
  ) {
    console.log('Retrying with fallback options...');
    result = spawnSync(cmd, [...args, ...fallbackArgs]);
  }

  return result;
}

function runLernaBenchmark(
  prepCommand: { cmd: string; args: string[] },
  runCommand: { cmd: string; args: string[] }
): ToolResults {
  logSection('BENCHMARKING LERNA');

  // Prep phase
  logSubsection('Preparation Phase');
  console.log(`Running ${NUMBER_OF_PREP_RUNS} prep run(s)...`);
  console.log(
    `Prep command: ${prepCommand.cmd} ${prepCommand.args.join(' ')}\n`
  );

  for (let i = 0; i < NUMBER_OF_PREP_RUNS; i++) {
    process.stdout.write(`  Prep ${i + 1}/${NUMBER_OF_PREP_RUNS}: `);
    const prepStart = Date.now();

    const result = runCommandWithFallback(prepCommand.cmd, prepCommand.args, [
      '--ignore-scripts',
      '--stream',
    ]);

    const prepDuration = Date.now() - prepStart;

    if (result.status === 0) {
      console.log(`✓ ${formatTime(prepDuration)}`);
    } else {
      console.log(
        `✗ ${formatTime(prepDuration)} (exit code: ${result.status})`
      );
      if (result.stderr) {
        console.log(`    Error: ${result.stderr.slice(0, 200)}...`);
      }
    }
  }

  // Benchmark phase
  logSubsection('Benchmark Phase');
  console.log(`Running ${NUMBER_OF_RUNS} benchmark runs...`);
  console.log(`Command: ${runCommand.cmd} ${runCommand.args.join(' ')}\n`);

  let totalTime = 0;
  const runs: number[] = [];

  for (let i = 0; i < NUMBER_OF_RUNS; ++i) {
    cleanFolders();
    process.stdout.write(`  Run ${i + 1}/${NUMBER_OF_RUNS}: `);

    const start = Date.now();
    const result = runCommandWithFallback(runCommand.cmd, runCommand.args, [
      '--ignore-scripts',
      '--stream',
    ]);
    const duration = Date.now() - start;

    totalTime += duration;
    runs.push(duration);

    if (result.status === 0) {
      console.log(`✓ ${formatTime(duration)}`);
    } else {
      console.log(`✗ ${formatTime(duration)} (exit code: ${result.status})`);
      if (result.stderr) {
        console.log(`    Error: ${result.stderr.slice(0, 100)}...`);
      }
    }
  }

  const average = totalTime / NUMBER_OF_RUNS;
  const { min, max } = calculateStats(runs);

  console.log(`\n📊 LERNA RESULTS:`);
  console.log(`  Average: ${formatTime(average)}`);
  console.log(`  Total: ${formatTime(totalTime)}`);
  console.log(`  Min: ${formatTime(min)}`);
  console.log(`  Max: ${formatTime(max)}`);
  console.log(`  Range: ${formatTime(max - min)}`);

  return {
    average,
    total: totalTime,
    runs,
    min,
    max,
  };
}

function runToolBenchmark(
  prepCommand: { cmd: string; args: string[] },
  runCommand: { cmd: string; args: string[] },
  toolName: string
): ToolResults {
  logSection(`BENCHMARKING ${toolName.toUpperCase()}`);

  // Prep phase
  logSubsection('Preparation Phase');
  console.log(`Running ${NUMBER_OF_PREP_RUNS} prep run(s)...`);
  console.log(
    `Prep command: ${prepCommand.cmd} ${prepCommand.args.join(' ')}\n`
  );

  for (let i = 0; i < NUMBER_OF_PREP_RUNS; i++) {
    process.stdout.write(`  Prep ${i + 1}/${NUMBER_OF_PREP_RUNS}: `);
    const prepStart = Date.now();
    const result = spawnSync(prepCommand.cmd, prepCommand.args);
    const prepDuration = Date.now() - prepStart;

    if (result.status === 0) {
      console.log(`✓ ${formatTime(prepDuration)}`);
    } else {
      console.log(
        `✗ ${formatTime(prepDuration)} (exit code: ${result.status})`
      );
      if (result.stderr) {
        console.log(`    Error: ${result.stderr.slice(0, 200)}...`);
      }
    }
  }

  // Benchmark phase
  logSubsection('Benchmark Phase');
  console.log(`Running ${NUMBER_OF_RUNS} benchmark runs...`);
  console.log(`Command: ${runCommand.cmd} ${runCommand.args.join(' ')}\n`);

  let totalTime = 0;
  const runs: number[] = [];

  for (let i = 0; i < NUMBER_OF_RUNS; ++i) {
    cleanFolders();
    process.stdout.write(`  Run ${i + 1}/${NUMBER_OF_RUNS}: `);

    const start = Date.now();
    const result = spawnSync(runCommand.cmd, runCommand.args);
    const duration = Date.now() - start;

    totalTime += duration;
    runs.push(duration);

    if (result.status === 0) {
      console.log(`✓ ${formatTime(duration)}`);
    } else {
      console.log(`✗ ${formatTime(duration)} (exit code: ${result.status})`);
      if (result.stderr) {
        console.log(`    Error: ${result.stderr.slice(0, 100)}...`);
      }
    }
  }

  const average = totalTime / NUMBER_OF_RUNS;
  const { min, max } = calculateStats(runs);

  console.log(`\n📊 ${toolName.toUpperCase()} RESULTS:`);
  console.log(`  Average: ${formatTime(average)}`);
  console.log(`  Total: ${formatTime(totalTime)}`);
  console.log(`  Min: ${formatTime(min)}`);
  console.log(`  Max: ${formatTime(max)}`);
  console.log(`  Range: ${formatTime(max - min)}`);

  return {
    average,
    total: totalTime,
    runs,
    min,
    max,
  };
}

function runBenchmark(): BenchmarkResults {
  const benchmarkStart = Date.now();
  const concurrency = getOptimalConcurrency();

  logSection('MONOREPO BENCHMARKS');
  console.log(`Starting comprehensive benchmark suite...`);
  console.log(`Number of runs per tool: ${NUMBER_OF_RUNS}`);
  console.log(`Total expected runs: ${NUMBER_OF_RUNS * 5} (across 5 tools)`);
  console.log(`CPU cores detected: ${os.cpus().length}`);
  console.log(`Environment: ${process.env.CI ? 'CI' : 'Local development'}`);
  console.log(
    `Concurrency - Prep: ${concurrency.prep}, Benchmark: ${concurrency.benchmark}`
  );
  console.log(`Started at: ${new Date().toLocaleString()}`);

  const results: BenchmarkResults = {
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString(),
    runs: NUMBER_OF_RUNS,
    tools: {
      nx: { average: 0, total: 0, runs: [], min: 0, max: 0 },
      turbo: { average: 0, total: 0, runs: [], min: 0, max: 0 },
      lerna: { average: 0, total: 0, runs: [], min: 0, max: 0 },
      lage: { average: 0, total: 0, runs: [], min: 0, max: 0 },
      moon: { average: 0, total: 0, runs: [], min: 0, max: 0 },
    },
    comparisons: {},
  };

  // Run turbo benchmark
  console.log(`\n[1/5] Starting Turbo benchmark...`);
  results.tools.turbo = runToolBenchmark(
    {
      cmd: 'turbo',
      args: ['run', 'build', `--concurrency=${concurrency.prep}`],
    },
    {
      cmd: 'turbo',
      args: ['run', 'build', `--concurrency=${concurrency.benchmark}`],
    },
    'turbo'
  );

  // Run nx benchmark
  console.log(`\n[2/5] Starting Nx benchmark...`);
  results.tools.nx = runToolBenchmark(
    {
      cmd: 'nx',
      args: [
        'run-many',
        '--target=build',
        '--all',
        '--parallel',
        `${concurrency.prep}`,
      ],
    },
    {
      cmd: 'nx',
      args: [
        'run-many',
        '--target=build',
        '--all',
        '--parallel',
        `${concurrency.benchmark}`,
      ],
    },
    'nx'
  );

  // Run lerna benchmark
  console.log(`\n[3/5] Starting Lerna benchmark...`);
  console.log('Cleaning Nx cache to prevent SQLite issues...');
  cleanNxCache();
  results.tools.lerna = runLernaBenchmark(
    {
      cmd: 'lerna',
      args: ['run', 'build', `--concurrency=${concurrency.prep}`],
    },
    {
      cmd: 'lerna',
      args: ['run', 'build', `--concurrency=${concurrency.benchmark}`],
    }
  );

  // Run lage benchmark
  console.log(`\n[4/5] Starting Lage benchmark...`);
  results.tools.lage = runToolBenchmark(
    { cmd: 'lage', args: ['build', '--concurrency', `${concurrency.prep}`] },
    {
      cmd: 'lage',
      args: ['build', '--concurrency', `${concurrency.benchmark}`],
    },
    'lage'
  );

  // Run moon benchmark
  console.log(`\n[5/5] Starting Moon benchmark...`);
  results.tools.moon = runToolBenchmark(
    {
      cmd: 'moon',
      args: ['run', ':build', `--concurrency=${concurrency.prep}`],
    },
    {
      cmd: 'moon',
      args: ['run', ':build', `--concurrency=${concurrency.benchmark}`],
    },
    'moon'
  );

  // Calculate comparisons against fastest tool
  const toolNames = Object.keys(
    results.tools
  ) as (keyof typeof results.tools)[];
  const toolStats = toolNames.map((name) => ({
    name,
    stats: results.tools[name],
  }));
  const fastestToolStats = toolStats.reduce((fastest, current) =>
    current.stats.average < fastest.stats.average ? current : fastest
  );

  results.comparisons = {};
  toolNames.forEach((toolName) => {
    if (toolName !== fastestToolStats.name) {
      const key = `${fastestToolStats.name}Vs${
        toolName.charAt(0).toUpperCase() + toolName.slice(1)
      }`;
      results.comparisons[key] =
        results.tools[toolName].average / fastestToolStats.stats.average;
    }
  });

  // Final summary
  const totalBenchmarkTime = Date.now() - benchmarkStart;
  logSection('BENCHMARK COMPLETE');
  console.log(`Total benchmark time: ${formatTime(totalBenchmarkTime)}`);
  console.log(`Completed at: ${new Date().toLocaleString()}`);

  console.log(`\n🏆 FINAL RANKINGS (by average time):`);
  const toolEntries = Object.entries(results.tools).sort(
    ([, a], [, b]) => a.average - b.average
  );

  toolEntries.forEach(([tool, stats], index) => {
    const rank = index + 1;
    const medal =
      rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
    console.log(
      `  ${medal} ${rank}. ${tool.toUpperCase()}: ${formatTime(stats.average)}`
    );
  });

  // Calculate relative performance against fastest tool
  const fastestTool = toolEntries[0][0];
  const fastestTime = toolEntries[0][1].average;

  console.log(`\n📈 RELATIVE PERFORMANCE (vs ${fastestTool.toUpperCase()}):`);
  toolEntries.forEach(([tool, stats]) => {
    const ratio = stats.average / fastestTime;
    const percentage = ((ratio - 1) * 100).toFixed(1);
    const indicator = ratio > 1 ? '🔴' : ratio === 1 ? '🥇' : '🟢';

    if (ratio === 1) {
      console.log(`  ${indicator} ${tool}: fastest`);
    } else {
      const change = `${percentage}% slower`;
      console.log(`  ${indicator} ${tool}: ${ratio.toFixed(2)}x (${change})`);
    }
  });

  return results;
}

// Main execution
if (require.main === module) {
  try {
    const results = runBenchmark();

    logSection('JSON RESULTS');
    console.log('Raw benchmark data:');
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error('\n❌ Benchmark failed:', error);
    process.exit(1);
  }
}
