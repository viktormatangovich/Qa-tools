import type { ApiRequest, MockRule } from "../types";

export type NegativeScenario = "401" | "403" | "404" | "409" | "429" | "500" | "502" | "503" | "empty" | "malformed-json" | "missing-field" | "null-field" | "delay-1s" | "delay-3s" | "delay-5s" | "timeout";

export function createNegativeMock(request: ApiRequest, scenario: NegativeScenario): MockRule {
  const status = Number(scenario);
  const delay = scenario.startsWith("delay-") ? Number(scenario.match(/\d+/)?.[0]) * 1000 : 0;
  const responseBody = scenario === "empty" ? "" : scenario === "malformed-json" ? "{invalid" : scenario === "missing-field" ? "{}" : scenario === "null-field" ? '{"value":null}' : JSON.stringify({ error: scenario === "500" ? "Simulated server error" : `Simulated ${scenario}` });
  return { id: crypto.randomUUID(), urlPattern: request.url, method: request.method as MockRule["method"], status: Number.isFinite(status) ? status : 200, statusText: `QA-симуляция: ${scenario}`, responseBody, responseHeaders: { "content-type": "application/json" }, enabled: true, delay, abort: scenario === "timeout", description: `Временный негативный тест: ${scenario}`, createdAt: Date.now(), updatedAt: Date.now() };
}
