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
    moon: ToolResults;
  };
  comparisons: Record<string, number>;
}

export interface ComparisonOutputs {
  readmeUpdated: boolean;
  performanceRegression: boolean;
}

export type ToolName = 'nx' | 'turbo' | 'lerna' | 'lage' | 'moon';

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
  moon: string;
  node: string;
  pnpm: string;
}

export interface ReleaseInfo {
  tagName: string;
  releaseName: string;
  description: string;
}
