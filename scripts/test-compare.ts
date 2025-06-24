import {
  parseResults,
  isSignificantChange,
  formatResults,
  detectPerformanceRegression,
  shouldUpdateReadme,
} from './compare-and-update-readme';
import type { BenchmarkResults } from './types';

// Test data
const currentResults: BenchmarkResults = {
  timestamp: '2024-01-01T00:00:00.000Z',
  date: '1/1/2024',
  runs: 10,
  tools: {
    nx: {
      average: 357.9,
      total: 3579,
      runs: [350, 360, 355, 365, 350, 360, 355, 365, 350, 360],
      min: 350,
      max: 365,
    },
    turbo: {
      average: 4577.7,
      total: 45777,
      runs: [4500, 4600, 4550, 4650, 4500, 4600, 4550, 4650, 4500, 4600],
      min: 4500,
      max: 4650,
    },
    lerna: {
      average: 1766.9,
      total: 17669,
      runs: [1700, 1800, 1750, 1850, 1700, 1800, 1750, 1850, 1700, 1800],
      min: 1700,
      max: 1850,
    },
    lage: {
      average: 9717.8,
      total: 97178,
      runs: [9500, 9800, 9700, 9900, 9500, 9800, 9700, 9900, 9500, 9800],
      min: 9500,
      max: 9900,
    },
  },
  comparisons: {
    nxVsLage: 27.15,
    nxVsTurbo: 12.79,
    nxVsLerna: 4.94,
  },
};

const previousResults: BenchmarkResults = {
  timestamp: '2023-12-31T00:00:00.000Z',
  date: '12/31/2023',
  runs: 10,
  tools: {
    nx: { average: 350.0, total: 3500, runs: [], min: 340, max: 360 },
    turbo: { average: 4500.0, total: 45000, runs: [], min: 4400, max: 4600 },
    lerna: { average: 1750.0, total: 17500, runs: [], min: 1700, max: 1800 },
    lage: { average: 9500.0, total: 95000, runs: [], min: 9400, max: 9600 },
  },
  comparisons: {
    nxVsLage: 27.14,
    nxVsTurbo: 12.86,
    nxVsLerna: 5.0,
  },
};

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

function runTest(
  name: string,
  testFn: () => boolean,
  expectedMessage?: string
): TestResult {
  try {
    const result = testFn();
    return {
      name,
      passed: result,
      message: expectedMessage || (result ? 'PASS' : 'FAIL'),
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: `ERROR: ${error}`,
    };
  }
}

function runAllTests(): void {
  console.log('🧪 Testing benchmark comparison functions...\n');

  const tests: TestResult[] = [];

  // Test 1: Parse results
  tests.push(
    runTest(
      '1️⃣ Testing parseResults',
      () => {
        const parsed = parseResults(JSON.stringify(currentResults));
        return parsed !== null && parsed.tools.nx.average === 357.9;
      },
      '✅ Parsed results successfully: PASS'
    )
  );

  // Test 2: Significant change detection
  tests.push(
    runTest(
      '2️⃣ Testing isSignificantChange (small)',
      () => !isSignificantChange(100, 105, 0.1), // 5% change, 10% threshold
      'Small change (5%): PASS'
    )
  );

  tests.push(
    runTest(
      '2️⃣ Testing isSignificantChange (large)',
      () => isSignificantChange(100, 120, 0.1), // 20% change, 10% threshold
      'Large change (20%): PASS'
    )
  );

  // Test 3: Format results
  tests.push(
    runTest(
      '3️⃣ Testing formatResults',
      () => {
        const formatted = formatResults(currentResults);
        return formatted.includes('357.9');
      },
      'Formatted output contains benchmark data: PASS'
    )
  );

  // Test 4: Performance regression detection
  tests.push(
    runTest(
      '4️⃣ Testing detectPerformanceRegression',
      () => {
        const hasRegression = detectPerformanceRegression(
          currentResults,
          previousResults
        );
        return !hasRegression; // Should be false for this test data
      },
      'Performance regression detected: NO'
    )
  );

  // Test 5: Should update README (always true now)
  tests.push(
    runTest(
      '5️⃣ Testing shouldUpdateReadme',
      () => {
        const shouldUpdate = shouldUpdateReadme(
          currentResults,
          previousResults
        );
        return shouldUpdate; // Should always be true now
      },
      'Should update README: YES (always updates)'
    )
  );

  // Test 6: Large performance change
  tests.push(
    runTest(
      '6️⃣ Testing with large performance degradation',
      () => {
        const degradedResults: BenchmarkResults = {
          ...currentResults,
          tools: {
            ...currentResults.tools,
            nx: { ...currentResults.tools.nx, average: 500.0 }, // 40% slower
          },
        };
        const hasLargeRegression = detectPerformanceRegression(
          degradedResults,
          previousResults
        );
        return hasLargeRegression;
      },
      'Large performance regression detected: YES (PASS)'
    )
  );

  // Print results
  tests.forEach((test) => {
    console.log(`${test.name}...`);
    console.log(`${test.message}\n`);
  });

  const passedTests = tests.filter((test) => test.passed).length;
  const totalTests = tests.length;

  console.log(`🎉 Tests completed: ${passedTests}/${totalTests} passed`);

  if (passedTests < totalTests) {
    console.log('❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
  }
}

if (require.main === module) {
  runAllTests();
}

export { runAllTests, runTest };
