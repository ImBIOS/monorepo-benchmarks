import * as fs from 'node:fs';
import type { BenchmarkResults, ToolName, ToolResults } from './types';

interface SingleToolResult {
  tool: ToolName;
  timestamp: string;
  date: string;
  runs: number;
  results: ToolResults;
}

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

function createEmptyResults(): ToolResults {
  return {
    average: 0,
    total: 0,
    runs: [],
    min: 0,
    max: 0,
  };
}

function combineResults(): BenchmarkResults {
  const tools: (keyof BenchmarkResults['tools'])[] = [
    'nx',
    'turbo',
    'lerna',
    'lage',
    'moon',
  ];
  const results: BenchmarkResults = {
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleDateString(),
    runs: 10, // Default, will be updated from first result
    tools: {
      nx: createEmptyResults(),
      turbo: createEmptyResults(),
      lerna: createEmptyResults(),
      lage: createEmptyResults(),
      moon: createEmptyResults(),
    },
    comparisons: {},
  };

  let foundResults = 0;
  let latestTimestamp = '';

  // Read individual tool results
  for (const tool of tools) {
    const filePath = `benchmark-results-${tool}.json`;

    try {
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const toolResult: SingleToolResult = JSON.parse(fileContent);

        results.tools[tool] = toolResult.results;
        results.runs = toolResult.runs;

        // Use the latest timestamp
        if (!latestTimestamp || toolResult.timestamp > latestTimestamp) {
          latestTimestamp = toolResult.timestamp;
          results.timestamp = toolResult.timestamp;
          results.date = toolResult.date;
        }

        foundResults++;
        console.log(
          `✓ Loaded results for ${tool}: avg=${formatTime(
            toolResult.results.average
          )}`
        );
      } else {
        console.log(`⚠ No results file found for ${tool}: ${filePath}`);
      }
    } catch (error) {
      console.error(`❌ Error reading results for ${tool}:`, error);
    }
  }

  if (foundResults === 0) {
    throw new Error('No benchmark results found to combine');
  }

  console.log(`\n📊 Combined ${foundResults}/${tools.length} tool results`);

  // Calculate comparisons against fastest tool
  const toolNames = Object.keys(results.tools) as ToolName[];
  const toolStats = toolNames
    .map((name) => ({
      name,
      stats: results.tools[name],
    }))
    .filter((tool) => tool.stats.average > 0); // Only include tools with results

  if (toolStats.length > 1) {
    const fastestToolStats = toolStats.reduce((fastest, current) =>
      current.stats.average < fastest.stats.average ? current : fastest
    );

    results.comparisons = {};
    toolNames.forEach((toolName) => {
      if (
        toolName !== fastestToolStats.name &&
        results.tools[toolName].average > 0
      ) {
        const key = `${fastestToolStats.name}Vs${
          toolName.charAt(0).toUpperCase() + toolName.slice(1)
        }`;
        results.comparisons[key] =
          results.tools[toolName].average / fastestToolStats.stats.average;
      }
    });

    console.log(`\n🏆 COMBINED RANKINGS (by average time):`);
    const sortedTools = toolStats.sort(
      (a, b) => a.stats.average - b.stats.average
    );

    sortedTools.forEach(({ name, stats }, index) => {
      const rank = index + 1;
      const medal =
        rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
      console.log(
        `  ${medal} ${rank}. ${name.toUpperCase()}: ${formatTime(
          stats.average
        )}`
      );
    });

    // Calculate relative performance
    const fastestTime = sortedTools[0].stats.average;
    console.log(
      `\n📈 RELATIVE PERFORMANCE (vs ${sortedTools[0].name.toUpperCase()}):`
    );

    sortedTools.forEach(({ name, stats }) => {
      const ratio = stats.average / fastestTime;
      const percentage = ((ratio - 1) * 100).toFixed(1);
      const indicator = ratio > 1 ? '🔴' : ratio === 1 ? '🥇' : '🟢';

      if (ratio === 1) {
        console.log(`  ${indicator} ${name}: fastest`);
      } else {
        const change = `${percentage}% slower`;
        console.log(`  ${indicator} ${name}: ${ratio.toFixed(2)}x (${change})`);
      }
    });
  }

  return results;
}

// Main execution
if (require.main === module) {
  try {
    console.log('🔄 Combining benchmark results...\n');

    const combinedResults = combineResults();

    console.log('\n' + '='.repeat(60));
    console.log('  COMBINED JSON RESULTS');
    console.log('='.repeat(60));
    console.log('Raw combined benchmark data:');
    console.log(JSON.stringify(combinedResults, null, 2));
  } catch (error) {
    console.error('\n❌ Failed to combine results:', error);
    process.exit(1);
  }
}
