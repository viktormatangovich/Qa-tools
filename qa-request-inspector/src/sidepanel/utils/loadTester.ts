import type {
  ApiRequest,
  LoadTestConfig,
  LoadTestResult,
  LoadTestRun,
  LoadTestStats,
  LoadTestScenario,
  ScenarioStep,
  LoadTestComparison,
  TimeSeriesPoint,
} from "../types";

function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, index)];
}

function calculateStats(
  runs: LoadTestRun[],
  startTime: number,
  endTime: number,
): LoadTestStats {
  const successful = runs.filter(
    (r) => r.status >= 200 && r.status < 400 && !r.error,
  );
  const failed = runs.filter((r) => r.status >= 400 || r.error);
  const durations = runs.map((r) => r.duration).sort((a, b) => a - b);

  const total = runs.length;
  const avgTime =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
  const minTime = durations.length > 0 ? durations[0] : 0;
  const maxTime = durations.length > 0 ? durations[durations.length - 1] : 0;
  const medianTime = percentile(durations, 50);
  const p95Time = percentile(durations, 95);
  const p99Time = percentile(durations, 99);

  const totalTimeSeconds = (endTime - startTime) / 1000;
  const requestsPerSecond = totalTimeSeconds > 0 ? total / totalTimeSeconds : 0;

  return {
    total,
    successful: successful.length,
    failed: failed.length,
    minTime,
    maxTime,
    avgTime,
    medianTime,
    p95Time,
    p99Time,
    requestsPerSecond,
  };
}

async function executeRequest(
  request: ApiRequest,
  timeout: number,
  signal?: AbortSignal,
): Promise<LoadTestRun> {
  const startTime = performance.now();
  const timestamp = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Combine abort signals
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    const options: RequestInit = {
      method: request.method,
      headers: request.requestHeaders,
      signal: combinedSignal,
    };

    if (request.requestBody && request.method !== "GET") {
      options.body =
        typeof request.requestBody === "string"
          ? request.requestBody
          : JSON.stringify(request.requestBody);
    }

    const response = await fetch(request.url, options);
    clearTimeout(timeoutId);

    // Consume response body but don't store it
    await response.text();

    const duration = Math.round(performance.now() - startTime);

    return {
      status: response.status,
      duration,
      timestamp,
      url: request.url,
      method: request.method,
    };
  } catch (err) {
    const duration = Math.round(performance.now() - startTime);
    const error = err instanceof Error ? err.message : "Unknown error";

    return {
      status: 0,
      duration,
      error,
      timestamp,
      url: request.url,
      method: request.method,
    };
  }
}

export async function runLoadTest(
  request: ApiRequest,
  config: LoadTestConfig,
  onProgress: (completed: number, total: number, runs: LoadTestRun[]) => void,
  abortSignal?: AbortSignal,
): Promise<LoadTestResult> {
  const startTime = Date.now();
  const runs: LoadTestRun[] = [];
  let completed = 0;

  // Create batches based on concurrency
  const batches: number[][] = [];
  for (let i = 0; i < config.iterations; i += config.concurrency) {
    const batchSize = Math.min(config.concurrency, config.iterations - i);
    batches.push(Array.from({ length: batchSize }, (_, j) => i + j));
  }

  for (const batch of batches) {
    // Check if aborted
    if (abortSignal?.aborted) {
      break;
    }

    // Execute batch concurrently
    const batchPromises = batch.map(() =>
      executeRequest(request, config.timeout, abortSignal),
    );

    const batchResults = await Promise.all(batchPromises);
    runs.push(...batchResults);
    completed += batchResults.length;

    // Report progress
    onProgress(completed, config.iterations, [...runs]);

    // Apply delay between batches (if not last batch)
    if (
      config.delayMs > 0 &&
      completed < config.iterations &&
      !abortSignal?.aborted
    ) {
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    }
  }

  const endTime = Date.now();
  const stats = calculateStats(runs, startTime, endTime);

  return {
    config,
    runs,
    stats,
    startTime,
    endTime,
  };
}

/**
 * Run a load test scenario — a sequence of requests executed in order.
 * Each step can have its own delay.
 */
export async function runScenarioTest(
  scenario: LoadTestScenario,
  onProgress: (
    stepIndex: number,
    totalSteps: number,
    stepRuns: LoadTestRun[],
    allRuns: LoadTestRun[],
  ) => void,
  abortSignal?: AbortSignal,
): Promise<LoadTestResult> {
  const startTime = Date.now();
  const allRuns: LoadTestRun[] = [];

  for (let stepIdx = 0; stepIdx < scenario.steps.length; stepIdx++) {
    if (abortSignal?.aborted) break;

    const step = scenario.steps[stepIdx];
    const stepRuns: LoadTestRun[] = [];

    // Apply step delay
    if (step.delayMs > 0 && stepIdx > 0) {
      await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    }

    // Create batches for this step
    const batches: number[][] = [];
    for (
      let i = 0;
      i < scenario.config.iterations;
      i += scenario.config.concurrency
    ) {
      const batchSize = Math.min(
        scenario.config.concurrency,
        scenario.config.iterations - i,
      );
      batches.push(Array.from({ length: batchSize }, (_, j) => i + j));
    }

    for (const batch of batches) {
      if (abortSignal?.aborted) break;

      const batchPromises = batch.map(() =>
        executeRequest(step.request, scenario.config.timeout, abortSignal),
      );

      const batchResults = await Promise.all(batchPromises);
      stepRuns.push(...batchResults);
      allRuns.push(...batchResults);

      onProgress(stepIdx, scenario.steps.length, [...stepRuns], [...allRuns]);

      if (
        scenario.config.delayMs > 0 &&
        allRuns.length < scenario.config.iterations * scenario.steps.length &&
        !abortSignal?.aborted
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, scenario.config.delayMs),
        );
      }
    }
  }

  const endTime = Date.now();
  const stats = calculateStats(allRuns, startTime, endTime);

  return {
    config: scenario.config,
    runs: allRuns,
    stats,
    startTime,
    endTime,
  };
}

/**
 * Generate time-series data from runs for charting.
 * Groups runs into time buckets (every `bucketSizeMs` ms).
 */
export function generateTimeSeries(
  runs: LoadTestRun[],
  startTime: number,
  endTime: number,
  bucketSizeMs = 1000,
): TimeSeriesPoint[] {
  if (runs.length === 0) return [];

  const points: TimeSeriesPoint[] = [];
  const totalDuration = endTime - startTime;
  const bucketCount = Math.max(1, Math.ceil(totalDuration / bucketSizeMs));

  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = startTime + i * bucketSizeMs;
    const bucketEnd = bucketStart + bucketSizeMs;

    const bucketRuns = runs.filter(
      (r) => r.timestamp >= bucketStart && r.timestamp < bucketEnd,
    );

    if (bucketRuns.length === 0) {
      points.push({
        time: (i * bucketSizeMs) / 1000,
        avgDuration: 0,
        successRate: 1,
        rps: 0,
      });
      continue;
    }

    const successful = bucketRuns.filter(
      (r) => r.status >= 200 && r.status < 400 && !r.error,
    ).length;
    const avgDuration =
      bucketRuns.reduce((sum, r) => sum + r.duration, 0) / bucketRuns.length;
    const elapsedSeconds = bucketSizeMs / 1000;

    points.push({
      time: (i * bucketSizeMs) / 1000,
      avgDuration: Math.round(avgDuration),
      successRate: successful / bucketRuns.length,
      rps: bucketRuns.length / elapsedSeconds,
    });
  }

  return points;
}

/**
 * Compare two load test results and produce a comparison object.
 */
export function compareResults(
  labelA: string,
  resultA: LoadTestResult,
  labelB: string,
  resultB: LoadTestResult,
): LoadTestComparison {
  return {
    id: crypto.randomUUID(),
    label: `${labelA} vs ${labelB}`,
    resultA,
    resultB,
    createdAt: Date.now(),
  };
}

/**
 * Generate a comparison summary string.
 */
export function formatComparisonSummary(
  comparison: LoadTestComparison,
): string {
  const a = comparison.resultA.stats;
  const b = comparison.resultB.stats;

  const lines = [
    `=== Сравнение: ${comparison.label} ===`,
    "",
    `Параметр          | Тест A         | Тест B         | Изменение`,
    `------------------|----------------|----------------|------------------`,
    `Всего запросов    | ${String(a.total).padEnd(14)}| ${String(
      b.total,
    ).padEnd(14)}| ${(((b.total - a.total) / a.total) * 100).toFixed(1)}%`,
    `Успешных          | ${String(a.successful).padEnd(14)}| ${String(
      b.successful,
    ).padEnd(14)}| ${(
      ((b.successful - a.successful) / a.successful) *
      100
    ).toFixed(1)}%`,
    `Ошибок            | ${String(a.failed).padEnd(14)}| ${String(
      b.failed,
    ).padEnd(14)}| ${(((b.failed - a.failed) / a.failed) * 100).toFixed(1)}%`,
    `Ср. время (ms)    | ${String(Math.round(a.avgTime)).padEnd(14)}| ${String(
      Math.round(b.avgTime),
    ).padEnd(14)}| ${(((b.avgTime - a.avgTime) / a.avgTime) * 100).toFixed(
      1,
    )}%`,
    `Медиана (ms)      | ${String(Math.round(a.medianTime)).padEnd(
      14,
    )}| ${String(Math.round(b.medianTime)).padEnd(14)}| ${(
      ((b.medianTime - a.medianTime) / a.medianTime) *
      100
    ).toFixed(1)}%`,
    `P95 (ms)          | ${String(Math.round(a.p95Time)).padEnd(14)}| ${String(
      Math.round(b.p95Time),
    ).padEnd(14)}| ${(((b.p95Time - a.p95Time) / a.p95Time) * 100).toFixed(
      1,
    )}%`,
    `Запросов/с        | ${String(a.requestsPerSecond.toFixed(1)).padEnd(
      14,
    )}| ${String(b.requestsPerSecond.toFixed(1)).padEnd(14)}| ${(
      ((b.requestsPerSecond - a.requestsPerSecond) / a.requestsPerSecond) *
      100
    ).toFixed(1)}%`,
  ];

  return lines.join("\n");
}

// Storage helpers for load test history
const STORAGE_KEY = "loadtest_history";
const MAX_HISTORY = 50;

export async function saveLoadTestResult(
  url: string,
  method: string,
  result: LoadTestResult,
  scenarioName?: string,
): Promise<void> {
  const saved = {
    id: crypto.randomUUID(),
    url,
    method,
    result,
    savedAt: Date.now(),
    scenarioName,
  };

  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const history = (data[STORAGE_KEY] || []) as Array<{
        id: string;
        url: string;
        method: string;
        result: LoadTestResult;
        savedAt: number;
        scenarioName?: string;
      }>;
      const newHistory = [saved, ...history].slice(0, MAX_HISTORY);
      chrome.storage.local.set({ [STORAGE_KEY]: newHistory }, resolve);
    });
  });
}

export async function getLoadTestHistory(): Promise<
  Array<{
    id: string;
    url: string;
    method: string;
    result: LoadTestResult;
    savedAt: number;
    scenarioName?: string;
  }>
> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      resolve(
        (data[STORAGE_KEY] || []) as Array<{
          id: string;
          url: string;
          method: string;
          result: LoadTestResult;
          savedAt: number;
          scenarioName?: string;
        }>,
      );
    });
  });
}

export async function deleteLoadTestResult(id: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const history = (data[STORAGE_KEY] || []) as Array<{ id: string }>;
      const newHistory = history.filter((h) => h.id !== id);
      chrome.storage.local.set({ [STORAGE_KEY]: newHistory }, resolve);
    });
  });
}

export async function clearLoadTestHistory(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEY], resolve);
  });
}

// Scenario storage
const SCENARIO_KEY = "loadtest_scenarios";

export async function saveScenario(scenario: LoadTestScenario): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SCENARIO_KEY], (data) => {
      const scenarios = (data[SCENARIO_KEY] || []) as LoadTestScenario[];
      const existing = scenarios.findIndex((s) => s.id === scenario.id);
      if (existing >= 0) {
        scenarios[existing] = scenario;
      } else {
        scenarios.push(scenario);
      }
      chrome.storage.local.set({ [SCENARIO_KEY]: scenarios }, resolve);
    });
  });
}

export async function getScenarios(): Promise<LoadTestScenario[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SCENARIO_KEY], (data) => {
      resolve((data[SCENARIO_KEY] || []) as LoadTestScenario[]);
    });
  });
}

export async function deleteScenario(id: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SCENARIO_KEY], (data) => {
      const scenarios = (data[SCENARIO_KEY] || []) as LoadTestScenario[];
      const filtered = scenarios.filter((s) => s.id !== id);
      chrome.storage.local.set({ [SCENARIO_KEY]: filtered }, resolve);
    });
  });
}

// Comparison storage
const COMPARISON_KEY = "loadtest_comparisons";

export async function saveComparison(
  comparison: LoadTestComparison,
): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([COMPARISON_KEY], (data) => {
      const comparisons = (data[COMPARISON_KEY] || []) as LoadTestComparison[];
      comparisons.push(comparison);
      chrome.storage.local.set(
        { [COMPARISON_KEY]: comparisons.slice(-20) },
        resolve,
      );
    });
  });
}

export async function getComparisons(): Promise<LoadTestComparison[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([COMPARISON_KEY], (data) => {
      resolve((data[COMPARISON_KEY] || []) as LoadTestComparison[]);
    });
  });
}

export async function deleteComparison(id: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([COMPARISON_KEY], (data) => {
      const comparisons = (data[COMPARISON_KEY] || []) as LoadTestComparison[];
      const filtered = comparisons.filter((c) => c.id !== id);
      chrome.storage.local.set({ [COMPARISON_KEY]: filtered }, resolve);
    });
  });
}
