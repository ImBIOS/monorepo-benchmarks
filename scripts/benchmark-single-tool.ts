import * as cp from 'node:child_process';
import * as os from 'node:os';
import type { SpawnResult, ToolName, ToolResults } from './types';

// Global flag for output mode
let isJsonOutput = false;

const NUMBER_OF_RUNS = 10;
const NUMBER_OF_PREP_RUNS = 2;

// Helper functions for conditional logging
function log(message: string) {
  if (!isJsonOutput) {
    console.log(message);
  }
}

function logError(message: string) {
  if (!isJsonOutput) {
    console.error(message);
  }
}

/**
 * Nx-specific environment variables for consistent benchmarking
 */
const NX_ENV_VARS = {
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT: 'false',
  NX_DAEMON: 'false',
  NX_DB_PATH: '/tmp/nx-cache',
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
    const prep = Math.max(1, Math.floor(cpuCount * 0.5) - 1);
    const benchmark = Math.max(1, cpuCount - 1);
    return { prep, benchmark };
  } else {
    const prep = Math.max(1, Math.floor(cpuCount * 0.5));
    const benchmark = Math.max(1, cpuCount - 1);
    return { prep, benchmark };
  }
}

function spawnSync(
  cmd: string,
  args: string[],
  options?: cp.SpawnSyncOptions
): SpawnResult {
  const result = cp.spawnSync(cmd, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    ...options,
  });

  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout?.toString() || '',
    stderr: result.stderr?.toString() || '',
  };
}

function cleanFolders(): void {
  // Keep disabled for cache comparison
}

function cleanNxCache(): void {
  try {
    const result = spawnSync('nx', ['reset']);
    if (result.status !== 0) {
      logError('Failed to reset Nx cache, continuing...');
    }
  } catch (error) {
    logError('Failed to reset Nx cache, continuing...');
  }
}

function calculateStats(runs: number[]): Pick<ToolResults, 'min' | 'max'> {
  return {
    min: Math.min(...runs),
    max: Math.max(...runs),
  };
}

function runCommandWithRetry(
  cmd: string,
  args: string[],
  fallbackArgs: string[] = [],
  maxTrials: number = 3
): SpawnResult {
  let result = spawnSync(cmd, args);

  for (let trial = 1; trial <= maxTrials; trial++) {
    if (result.status === 0) {
      return result;
    }

    if (trial < maxTrials) {
      continue;
    }

    if (trial === maxTrials) {
      logError('Retrying with fallback options...');
      result = spawnSync(cmd, [...args, ...fallbackArgs]);
    }
  }

  return result;
}

function runLernaBenchmark(
  prepCommand: { cmd: string; args: string[] },
  runCommand: { cmd: string; args: string[] }
): ToolResults {
  log('='.repeat(60));
  log('  BENCHMARKING LERNA');
  log('='.repeat(60));

  // Prep phase
  log('\n' + '-'.repeat(40));
  log('  Preparation Phase');
  log('-'.repeat(40));
  log(`Running ${NUMBER_OF_PREP_RUNS} prep run(s)...`);
  log(`Prep command: ${prepCommand.cmd} ${prepCommand.args.join(' ')}\n`);

  for (let i = 0; i < NUMBER_OF_PREP_RUNS; i++) {
    log(`  Prep ${i + 1}/${NUMBER_OF_PREP_RUNS}: `);
    const prepStart = Date.now();
    const result = runCommandWithRetry(prepCommand.cmd, prepCommand.args, [
      '--ignore-scripts',
      '--stream',
    ]);
    const prepDuration = Date.now() - prepStart;

    if (result.status === 0) {
      log(`✓ ${formatTime(prepDuration)}`);
    } else {
      logError(`✗ ${formatTime(prepDuration)} (exit code: ${result.status})`);
      if (result.stderr) {
        logError(`    Error: ${result.stderr.slice(0, 200)}...`);
      }
    }
  }

  // Benchmark phase
  log('\n' + '-'.repeat(40));
  log('  Benchmark Phase');
  log('-'.repeat(40));
  log(`Running ${NUMBER_OF_RUNS} benchmark runs...`);
  log(`Command: ${runCommand.cmd} ${runCommand.args.join(' ')}\n`);

  let totalTime = 0;
  const runs: number[] = [];

  for (let i = 0; i < NUMBER_OF_RUNS; ++i) {
    cleanFolders();
    log(`  Run ${i + 1}/${NUMBER_OF_RUNS}: `);

    const start = Date.now();
    const result = runCommandWithRetry(runCommand.cmd, runCommand.args, [
      '--ignore-scripts',
      '--stream',
    ]);
    const duration = Date.now() - start;

    totalTime += duration;
    runs.push(duration);

    if (result.status === 0) {
      log(`✓ ${formatTime(duration)}`);
    } else {
      logError(`✗ ${formatTime(duration)} (exit code: ${result.status})`);
      if (result.stderr) {
        logError(`    Error: ${result.stderr.slice(0, 100)}...`);
      }
    }
  }

  const average = totalTime / NUMBER_OF_RUNS;
  const { min, max } = calculateStats(runs);

  log(`\n📊 LERNA RESULTS:`);
  log(`  Average: ${formatTime(average)}`);
  log(`  Total: ${formatTime(totalTime)}`);
  log(`  Min: ${formatTime(min)}`);
  log(`  Max: ${formatTime(max)}`);
  log(`  Range: ${formatTime(max - min)}`);

  return { average, total: totalTime, runs, min, max };
}

function runToolBenchmark(
  prepCommand: { cmd: string; args: string[] },
  runCommand: { cmd: string; args: string[] },
  toolName: string
): ToolResults {
  log('='.repeat(60));
  log(`  BENCHMARKING ${toolName.toUpperCase()}`);
  log('='.repeat(60));

  // Prep phase
  log('\n' + '-'.repeat(40));
  log('  Preparation Phase');
  log('-'.repeat(40));
  log(`Running ${NUMBER_OF_PREP_RUNS} prep run(s)...`);
  log(`Prep command: ${prepCommand.cmd} ${prepCommand.args.join(' ')}\n`);

  for (let i = 0; i < NUMBER_OF_PREP_RUNS; i++) {
    log(`  Prep ${i + 1}/${NUMBER_OF_PREP_RUNS}: `);
    const prepStart = Date.now();
    const result = spawnSync(prepCommand.cmd, prepCommand.args);
    const prepDuration = Date.now() - prepStart;

    if (result.status === 0) {
      log(`✓ ${formatTime(prepDuration)}`);
    } else {
      logError(`✗ ${formatTime(prepDuration)} (exit code: ${result.status})`);
      if (result.stderr) {
        logError(`    Error: ${result.stderr.slice(0, 200)}...`);
      }
    }
  }

  // Benchmark phase
  log('\n' + '-'.repeat(40));
  log('  Benchmark Phase');
  log('-'.repeat(40));
  log(`Running ${NUMBER_OF_RUNS} benchmark runs...`);
  log(`Command: ${runCommand.cmd} ${runCommand.args.join(' ')}\n`);

  let totalTime = 0;
  const runs: number[] = [];

  for (let i = 0; i < NUMBER_OF_RUNS; ++i) {
    cleanFolders();
    log(`  Run ${i + 1}/${NUMBER_OF_RUNS}: `);

    const start = Date.now();
    const result = spawnSync(runCommand.cmd, runCommand.args);
    const duration = Date.now() - start;

    totalTime += duration;
    runs.push(duration);

    if (result.status === 0) {
      log(`✓ ${formatTime(duration)}`);
    } else {
      logError(`✗ ${formatTime(duration)} (exit code: ${result.status})`);
      if (result.stderr) {
        logError(`    Error: ${result.stderr.slice(0, 100)}...`);
      }
    }
  }

  const average = totalTime / NUMBER_OF_RUNS;
  const { min, max } = calculateStats(runs);

  log(`\n📊 ${toolName.toUpperCase()} RESULTS:`);
  log(`  Average: ${formatTime(average)}`);
  log(`  Total: ${formatTime(totalTime)}`);
  log(`  Min: ${formatTime(min)}`);
  log(`  Max: ${formatTime(max)}`);
  log(`  Range: ${formatTime(max - min)}`);

  return { average, total: totalTime, runs, min, max };
}

function getToolCommands(
  tool: ToolName,
  concurrency: { prep: number; benchmark: number }
) {
  const commands = {
    nx: {
      prep: {
        cmd: 'nx',
        args: [
          'run-many',
          '--target=build',
          '--all',
          '--parallel',
          `${concurrency.prep}`,
        ],
      },
      run: {
        cmd: 'nx',
        args: [
          'run-many',
          '--target=build',
          '--all',
          '--parallel',
          `${concurrency.benchmark}`,
        ],
      },
    },
    turbo: {
      prep: {
        cmd: 'turbo',
        args: ['run', 'build', `--concurrency=${concurrency.prep}`],
      },
      run: {
        cmd: 'turbo',
        args: ['run', 'build', `--concurrency=${concurrency.benchmark}`],
      },
    },
    lerna: {
      prep: {
        cmd: 'lerna',
        args: ['run', 'build', `--concurrency=${concurrency.prep}`],
      },
      run: {
        cmd: 'lerna',
        args: ['run', 'build', `--concurrency=${concurrency.benchmark}`],
      },
    },
    lage: {
      prep: {
        cmd: 'lage',
        args: ['build', '--concurrency', `${concurrency.prep}`],
      },
      run: {
        cmd: 'lage',
        args: ['build', '--concurrency', `${concurrency.benchmark}`],
      },
    },
    moon: {
      prep: {
        cmd: 'moon',
        args: ['run', ':build', `--concurrency=${concurrency.prep}`],
      },
      run: {
        cmd: 'moon',
        args: ['run', ':build', `--concurrency=${concurrency.benchmark}`],
      },
    },
  };

  return commands[tool];
}

function runSingleToolBenchmark(tool: ToolName): ToolResults {
  const benchmarkStart = Date.now();
  const concurrency = getOptimalConcurrency();

  log('='.repeat(60));
  log(`  BENCHMARKING ${tool.toUpperCase()}`);
  log('='.repeat(60));
  log(`Started at: ${new Date().toLocaleString()}`);
  log(`Number of runs: ${NUMBER_OF_RUNS}`);
  log(`CPU cores detected: ${os.cpus().length}`);
  log(`Environment: ${process.env.CI ? 'CI' : 'Local development'}`);
  log(
    `Concurrency - Prep: ${concurrency.prep}, Benchmark: ${concurrency.benchmark}`
  );

  const commands = getToolCommands(tool, concurrency);
  let results: ToolResults;

  if (tool === 'lerna') {
    log('Cleaning Nx cache to prevent SQLite issues...');
    cleanNxCache();
    results = runLernaBenchmark(commands.prep, commands.run);
  } else {
    results = runToolBenchmark(commands.prep, commands.run, tool);
  }

  const totalBenchmarkTime = Date.now() - benchmarkStart;
  log(`\nTotal benchmark time: ${formatTime(totalBenchmarkTime)}`);
  log(`Completed at: ${new Date().toLocaleString()}`);

  return results;
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const tool = args[0] as ToolName;

  // Check for --output json flag
  if (
    args.includes('--output') &&
    args[args.indexOf('--output') + 1] === 'json'
  ) {
    isJsonOutput = true;
  }

  if (!tool || !['nx', 'turbo', 'lerna', 'lage', 'moon'].includes(tool)) {
    logError('Usage: node benchmark-single-tool.js <tool> [--output json]');
    logError('Available tools: nx, turbo, lerna, lage, moon');
    process.exit(1);
  }

  try {
    const results = runSingleToolBenchmark(tool);

    // Output results as JSON
    const output = {
      tool,
      timestamp: new Date().toISOString(),
      date: new Date().toLocaleDateString(),
      runs: NUMBER_OF_RUNS,
      results,
    };

    if (isJsonOutput) {
      // Output only JSON to stdout for clean redirection
      console.log(JSON.stringify(output, null, 2));
    } else {
      // Output header and JSON for human-readable format
      log('\n' + '='.repeat(60));
      log('  JSON RESULTS');
      log('='.repeat(60));
      console.log(JSON.stringify(output, null, 2));
    }
  } catch (error) {
    logError(`\n❌ Benchmark failed for ${tool}:`);
    console.error(error);
    process.exit(1);
  }
}
