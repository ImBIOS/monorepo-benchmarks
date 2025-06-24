import * as fs from 'fs';
import * as path from 'path';
import type { BenchmarkResults, ComparisonOutputs, ToolName } from './types';

// Threshold for significant performance change (10%)
const PERFORMANCE_THRESHOLD = 0.1;
// Threshold for detecting tool performance changes worth documenting (5%)
const TOOL_SIGNIFICANCE_THRESHOLD = 0.05;

function parseResults(resultsJson: string): BenchmarkResults | null {
  try {
    return JSON.parse(resultsJson) as BenchmarkResults;
  } catch (e) {
    console.error('Failed to parse results JSON:', e);
    return null;
  }
}

function isSignificantChange(
  current: number,
  previous: number,
  threshold: number = PERFORMANCE_THRESHOLD
): boolean {
  if (!previous || previous === 0) return false;
  const change = Math.abs((current - previous) / previous);
  return change > threshold;
}

function formatResults(results: BenchmarkResults): string {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `## Benchmark & Results (${date})

Run \`pnpm run benchmark\`. The benchmark will warm the cache of all the tools. We benchmark how quickly
Turbo/Nx/Lage/Lerna can figure out what needs to be restored from the cache and restores it.

These are the numbers using GitHub Actions runner:

* average lage time is: ${results.tools.lage.average.toFixed(1)}
* average turbo time is: ${results.tools.turbo.average.toFixed(1)}
* average lerna (powered by nx) time is: ${results.tools.lerna.average.toFixed(
    1
  )}
* average nx time is: ${results.tools.nx.average.toFixed(1)}
* nx is ${results.comparisons.nxVsLage.toFixed(1)}x faster than lage
* nx is ${results.comparisons.nxVsTurbo.toFixed(1)}x faster than turbo
* nx is ${results.comparisons.nxVsLerna.toFixed(
    1
  )}x faster than lerna (powered by nx)`;
}

function updateReadme(newResults: BenchmarkResults): boolean {
  const readmePath = path.join(process.cwd(), 'README.md');
  let content = fs.readFileSync(readmePath, 'utf8');

  // Find the benchmark section and replace it
  const benchmarkRegex = /## Benchmark & Results \([^)]+\)[\s\S]*?(?=##|$)/;
  const newBenchmarkSection = formatResults(newResults);

  if (benchmarkRegex.test(content)) {
    content = content.replace(benchmarkRegex, newBenchmarkSection + '\n\n');
  } else {
    // If no benchmark section found, add it after the repo description
    const insertPoint = content.indexOf('## Benchmark & Results');
    if (insertPoint === -1) {
      // Add after the initial description
      const descEndRegex = /\n\n(?=##)/;
      const match = content.match(descEndRegex);
      if (match) {
        const insertPos = match.index! + match[0].length;
        content =
          content.slice(0, insertPos) +
          newBenchmarkSection +
          '\n\n' +
          content.slice(insertPos);
      } else {
        content += '\n\n' + newBenchmarkSection;
      }
    }
  }

  fs.writeFileSync(readmePath, content);
  return true;
}

function detectPerformanceRegression(
  current: BenchmarkResults,
  previous: BenchmarkResults | null
): boolean {
  if (!previous || !current || !previous.tools || !current.tools) return false;

  // Check if NX performance degraded significantly
  const previousNxAverage = previous.tools.nx?.average;
  const nxRegression =
    previousNxAverage !== undefined &&
    isSignificantChange(
      current.tools.nx.average,
      previousNxAverage,
      PERFORMANCE_THRESHOLD
    ) &&
    current.tools.nx.average > previousNxAverage;

  // Check if any comparison ratios decreased significantly (meaning NX became relatively slower)
  const ratioRegression = Object.keys(current.comparisons).some((key) => {
    const comparisonKey = key as keyof typeof current.comparisons;
    if (!previous.comparisons || !previous.comparisons[comparisonKey])
      return false;
    return (
      isSignificantChange(
        current.comparisons[comparisonKey],
        previous.comparisons[comparisonKey],
        PERFORMANCE_THRESHOLD
      ) &&
      current.comparisons[comparisonKey] < previous.comparisons[comparisonKey]
    );
  });

  return nxRegression || ratioRegression;
}

function shouldUpdateReadme(
  current: BenchmarkResults,
  previous: BenchmarkResults | null
): boolean {
  // Always update README with latest benchmark results
  return true;
}

function hasSignificantChanges(
  current: BenchmarkResults,
  previous: BenchmarkResults | null
): boolean {
  if (!previous || !previous.tools) return true; // First run, always significant

  // Check if there's any significant change in any tool
  const toolNames: ToolName[] = ['nx', 'turbo', 'lerna', 'lage'];
  return toolNames.some((tool) => {
    const previousValue = previous.tools[tool]?.average;
    if (previousValue === undefined) return true; // No previous data for this tool

    return isSignificantChange(
      current.tools[tool].average,
      previousValue,
      TOOL_SIGNIFICANCE_THRESHOLD
    );
  });
}

// Main execution
function main(): ComparisonOutputs {
  const currentResults = parseResults(process.env.CURRENT_RESULTS || '{}');
  const previousResults = parseResults(process.env.PREVIOUS_RESULTS || '{}');

  if (!currentResults) {
    console.error('No current results available');
    process.exit(1);
  }

  const shouldUpdate = shouldUpdateReadme(currentResults, previousResults);
  const significantChanges = hasSignificantChanges(
    currentResults,
    previousResults
  );
  const hasRegression = detectPerformanceRegression(
    currentResults,
    previousResults
  );

  if (shouldUpdate) {
    if (significantChanges) {
      console.log(
        'Significant performance changes detected, updating README...'
      );
    } else {
      console.log('Updating README with latest benchmark results...');
    }
    updateReadme(currentResults);
    console.log('README updated successfully');

    // Set output for GitHub Actions
    process.stdout.write('readme-updated=true\n');
  } else {
    console.log('README not updated');
    process.stdout.write('readme-updated=false\n');
  }

  if (hasRegression) {
    console.log('Performance regression detected!');
    process.stdout.write('performance-regression=true\n');
  } else {
    process.stdout.write('performance-regression=false\n');
  }

  // Log current results for debugging
  console.log('Current benchmark results:');
  console.log(`- NX: ${currentResults.tools.nx.average.toFixed(1)}ms`);
  console.log(`- Turbo: ${currentResults.tools.turbo.average.toFixed(1)}ms`);
  console.log(`- Lerna: ${currentResults.tools.lerna.average.toFixed(1)}ms`);
  console.log(`- Lage: ${currentResults.tools.lage.average.toFixed(1)}ms`);

  return {
    readmeUpdated: shouldUpdate,
    performanceRegression: hasRegression,
  };
}

if (require.main === module) {
  main();
}

export {
  detectPerformanceRegression,
  formatResults,
  hasSignificantChanges,
  isSignificantChange,
  main,
  parseResults,
  shouldUpdateReadme,
  updateReadme,
};
