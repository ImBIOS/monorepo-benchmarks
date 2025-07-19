import * as cp from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SpawnResult, ToolName, ToolResults } from './types';

const NUMBER_OF_RUNS = 10;
const NUMBER_OF_PREP_RUNS = 2;

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
    const prep = Math.max(1, Math.floor(cpuCount * 0.5) - 1);
    const benchmark = Math.max(1, Math.floor(cpuCount * 0.5) - 1);
    return { prep, benchmark };
  }
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
  // Keep disabled for cache comparison
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
  let result = spawnSync(cmd, args);

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
  console.log('='.repeat(60));
  console.log('  BENCHMARKING LERNA');
  console.log('='.repeat(60));

  // Prep phase
  console.log('\n' + '-'.repeat(40));
  console.log('  Preparation Phase');
  console.log('-'.repeat(40));
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
  console.log('\n' + '-'.repeat(40));
  console.log('  Benchmark Phase');
  console.log('-'.repeat(40));
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

  return { average, total: totalTime, runs, min, max };
}

function runToolBenchmark(
  prepCommand: { cmd: string; args: string[] },
  runCommand: { cmd: string; args: string[] },
  toolName: string
): ToolResults {
  console.log('='.repeat(60));
  console.log(`  BENCHMARKING ${toolName.toUpperCase()}`);
  console.log('='.repeat(60));

  // Prep phase
  console.log('\n' + '-'.repeat(40));
  console.log('  Preparation Phase');
  console.log('-'.repeat(40));
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
  console.log('\n' + '-'.repeat(40));
  console.log('  Benchmark Phase');
  console.log('-'.repeat(40));
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

  console.log('='.repeat(60));
  console.log(`  BENCHMARKING ${tool.toUpperCase()}`);
  console.log('='.repeat(60));
  console.log(`Started at: ${new Date().toLocaleString()}`);
  console.log(`Number of runs: ${NUMBER_OF_RUNS}`);
  console.log(`CPU cores detected: ${os.cpus().length}`);
  console.log(`Environment: ${process.env.CI ? 'CI' : 'Local development'}`);
  console.log(
    `Concurrency - Prep: ${concurrency.prep}, Benchmark: ${concurrency.benchmark}`
  );

  const commands = getToolCommands(tool, concurrency);
  let results: ToolResults;

  if (tool === 'lerna') {
    console.log('Cleaning Nx cache to prevent SQLite issues...');
    cleanNxCache();
    results = runLernaBenchmark(commands.prep, commands.run);
  } else {
    results = runToolBenchmark(commands.prep, commands.run, tool);
  }

  const totalBenchmarkTime = Date.now() - benchmarkStart;
  console.log(`\nTotal benchmark time: ${formatTime(totalBenchmarkTime)}`);
  console.log(`Completed at: ${new Date().toLocaleString()}`);

  return results;
}

// Main execution
if (require.main === module) {
  const tool = process.argv[2] as ToolName;

  if (!tool || !['nx', 'turbo', 'lerna', 'lage', 'moon'].includes(tool)) {
    console.error('Usage: node benchmark-single-tool.js <tool>');
    console.error('Available tools: nx, turbo, lerna, lage, moon');
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

    console.log('\n' + '='.repeat(60));
    console.log('  JSON RESULTS');
    console.log('='.repeat(60));
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(`\n❌ Benchmark failed for ${tool}:`, error);
    process.exit(1);
  }
}
