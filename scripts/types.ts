export interface ToolResults {
  average: number;
  total: number;
  runs: number[];
  min: number;
  max: number;
}

export interface BenchmarkResults {
  timestamp: string;
  date: string;
  runs: number;
  tools: {
    nx: ToolResults;
    turbo: ToolResults;
    lerna: ToolResults;
    lage: ToolResults;
  };
  comparisons: {
    nxVsLage: number;
    nxVsTurbo: number;
    nxVsLerna: number;
  };
}

export interface ComparisonOutputs {
  readmeUpdated: boolean;
  performanceRegression: boolean;
}

export type ToolName = 'nx' | 'turbo' | 'lerna' | 'lage';

export interface SpawnResult {
  status: number | null;
  signal: string | null;
  error?: Error;
  stdout: string | Buffer;
  stderr: string | Buffer;
}

export interface PackageVersions {
  nx: string;
  turbo: string;
  lerna: string;
  lage: string;
  node: string;
  pnpm: string;
}

export interface ReleaseInfo {
  tagName: string;
  releaseName: string;
  description: string;
}
