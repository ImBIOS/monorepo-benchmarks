import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';
import type {
  BenchmarkResults,
  ToolResults,
  SpawnResult,
} from './scripts/types';

const NUMBER_OF_RUNS = 10;

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
      env: { ...process.env, NX_TASKS_RUNNER_DYNAMIC_OUTPUT: 'false' },
      encoding: 'utf8',
    }
  );
}

function cleanFolders(): void {
  // Keep this disabled like in original to maintain cache comparison
}

function calculateStats(runs: number[]): Pick<ToolResults, 'min' | 'max'> {
  return {
    min: Math.min(...runs),
    max: Math.max(...runs),
  };
}

function runToolBenchmark(
  prepCommands: Array<{ cmd: string; args: string[] }>,
  runCommand: { cmd: string; args: string[] },
  toolName: string
): ToolResults {
  // Prep phase
  prepCommands.forEach(({ cmd, args }) => {
    spawnSync(cmd, args);
  });

  // Benchmark phase
  let totalTime = 0;
  const runs: number[] = [];

  for (let i = 0; i < NUMBER_OF_RUNS; ++i) {
    cleanFolders();
    const start = Date.now();
    spawnSync(runCommand.cmd, runCommand.args);
    const duration = Date.now() - start;
    totalTime += duration;
    runs.push(duration);
  }

  const average = totalTime / NUMBER_OF_RUNS;
  const { min, max } = calculateStats(runs);

  return {
    average,
    total: totalTime,
    runs,
    min,
    max,
  };
}

function runBenchmark(): BenchmarkResults {
  const results: BenchmarkResults = {
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString(),
    runs: NUMBER_OF_RUNS,
    tools: {
      nx: { average: 0, total: 0, runs: [], min: 0, max: 0 },
      turbo: { average: 0, total: 0, runs: [], min: 0, max: 0 },
      lerna: { average: 0, total: 0, runs: [], min: 0, max: 0 },
      lage: { average: 0, total: 0, runs: [], min: 0, max: 0 },
    },
    comparisons: {
      nxVsLage: 0,
      nxVsTurbo: 0,
      nxVsLerna: 0,
    },
  };

  // Run turbo benchmark
  results.tools.turbo = runToolBenchmark(
    [
      { cmd: 'turbo', args: ['run', 'build', '--concurrency=3'] },
      { cmd: 'turbo', args: ['run', 'build', '--concurrency=3'] },
    ],
    { cmd: 'turbo', args: ['run', 'build', '--concurrency=10'] },
    'turbo'
  );

  // Run nx benchmark
  results.tools.nx = runToolBenchmark(
    [{ cmd: 'nx', args: ['run-many', '--target=build', '--all'] }],
    {
      cmd: 'nx',
      args: ['run-many', '--target=build', '--all', '--parallel', '10'],
    },
    'nx'
  );

  // Run lerna benchmark
  results.tools.lerna = runToolBenchmark(
    [{ cmd: 'lerna', args: ['run', 'build', '--concurrency=3'] }],
    { cmd: 'lerna', args: ['run', 'build', '--concurrency=10'] },
    'lerna'
  );

  // Run lage benchmark
  results.tools.lage = runToolBenchmark(
    [{ cmd: 'lage', args: ['build', '--concurrency', '3'] }],
    { cmd: 'lage', args: ['build', '--concurrency', '10'] },
    'lage'
  );

  // Calculate comparisons
  const { nx, turbo, lerna, lage } = results.tools;
  results.comparisons = {
    nxVsLage: lage.average / nx.average,
    nxVsTurbo: turbo.average / nx.average,
    nxVsLerna: lerna.average / nx.average,
  };

  return results;
}

// Main execution
if (require.main === module) {
  try {
    const results = runBenchmark();
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

export { runBenchmark, runToolBenchmark, spawnSync };
