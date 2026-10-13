import type { ApiRequest, MockRule, Session } from '../types';
import type { QASettings } from './core/types';
import type { CompareOptions } from './environmentCompare';
import type { NegativeTestCase } from './negativeTesting';

export type Environment = 'local' | 'test' | 'production';
export interface BusinessRule { id: string; name: string; path: string; operator: 'exists' | 'equals' | 'gte' | 'sum'; expected: string; sumPath?: string; }
export interface ManualStep { id: string; text: string; timestamp: number; requestIds: string[]; }
export interface ProjectProfile {
  id: string; name: string; domains: string[]; environment: Environment;
  qaSettings: QASettings; contractSpecText: string; excludedRuleIds: string[];
  compareOptions: CompareOptions; mockRules: MockRule[]; businessRules: BusinessRule[];
  filters?: { method: string; status: string; header: string; jsonSearch: string };
}
export function retainedSessions(sessions: Session[], now = Date.now()): Session[] {
  return sessions.filter(s => s.timestamp > now - 86400000).sort((a, b) => b.timestamp - a.timestamp).slice(0, 3);
}
export function readPath(value: unknown, path: string): unknown {
  const tokens = path.replace(/^\$\.?/, '').replace(/\[(\d+|\*)\]/g, '.$1').split('.').filter(Boolean);
  const visit = (current: unknown, index: number): unknown => {
    if (index === tokens.length) return current;
    if (tokens[index] === '*' && Array.isArray(current)) return current.map(item => visit(item, index + 1));
    if (!current || typeof current !== 'object') return undefined;
    return visit((current as Record<string, unknown>)[tokens[index]], index + 1);
  };
  return visit(value, 0);
}
export function evaluateBusinessRule(body: unknown, rule: BusinessRule): boolean {
  const value = readPath(body, rule.path);
  let expected: unknown; try { expected = JSON.parse(rule.expected); } catch { expected = rule.expected; }
  if (rule.operator === 'exists') return value !== undefined && value !== null;
  if (rule.operator === 'equals') return JSON.stringify(value) === JSON.stringify(expected);
  if (rule.operator === 'gte') return typeof value === 'number' && typeof expected === 'number' && value >= expected;
  const entries = readPath(body, rule.sumPath || '');
  return typeof value === 'number' && Array.isArray(entries) && entries.every(item => typeof item === 'number') && Math.abs(entries.reduce((sum: number, item) => sum + (item as number), 0) - value) < 0.000001;
}
export function jiraReport(title: string, steps: ManualStep[], expected: string, actual: string, environment: Environment, request?: ApiRequest): string {
  const env = { local: 'Локальное', test: 'Тестовое', production: 'Продакшен' }[environment];
  return `h2. ${title}\n\nh3. Окружение\n${env}\n${typeof navigator === 'undefined' ? '' : navigator.userAgent}\n\nh3. Предусловия\nУкажите учётную запись и необходимые данные.\n\nh3. Шаги воспроизведения\n${steps.map((step, index) => `${index + 1}. ${step.text}`).join('\n') || '1. Укажите действие.'}\n\nh3. Ожидаемый результат\n${expected}\n\nh3. Фактический результат\n${actual}\n\nh3. Серьёзность\nУкажите серьёзность дефекта.\n${request ? `\nh3. Запрос\n${request.method} ${request.url}\nHTTP ${request.status} · ${request.duration} мс\n` : ''}`;
}
export function playwrightExport(requests: ApiRequest[], mode: 'api' | 'mocks'): string {
  if (mode === 'mocks') return `// Моки для существующего теста Playwright\n${requests.map(r => `await page.route(${JSON.stringify(r.url)}, async route => {\n  if (route.request().method() !== ${JSON.stringify(r.method)}) return route.fallback();\n  await route.fulfill({ status: ${r.status || 200}, headers: ${JSON.stringify(r.responseHeaders)}, body: ${JSON.stringify(typeof r.responseBody === 'string' ? r.responseBody : JSON.stringify(r.responseBody))} });\n});`).join('\n\n')}\n`;
  return `import { test, expect } from '@playwright/test';\n\n${requests.map((r, i) => `test(${JSON.stringify(`API ${i + 1}: ${r.method} ${new URL(r.url).pathname}`)}, async ({ request }) => {\n  const response = await request.fetch(${JSON.stringify(r.url)}, { method: ${JSON.stringify(r.method)}, headers: ${JSON.stringify(r.requestHeaders)}, ${r.requestBody ? `data: ${JSON.stringify(r.requestBody)},` : ''} });\n  // Ожидание взято из записи. Проверьте его перед запуском.\n  expect(response.status()).toBe(${r.status});\n});`).join('\n\n')}\n`;
}
export function mutatedRequest(request: ApiRequest, variant: NegativeTestCase): ApiRequest {
  const headers = { ...request.requestHeaders };
  if (variant.headerName) {
    for (const key of Object.keys(headers)) if (key.toLowerCase() === variant.headerName.toLowerCase()) delete headers[key];
    if (!variant.removeHeader) headers[variant.headerName] = variant.headerValue || '';
  }
  return { ...request, url: variant.url || request.url, requestBody: variant.body ?? request.requestBody, requestHeaders: headers };
}
export async function runNegativeBatch(request: ApiRequest, variants: NegativeTestCase[], expectedStatus: number, signal: AbortSignal, send: typeof fetch = fetch): Promise<Array<{ title: string; status: number; passed: boolean; error?: string }>> {
  const results = [];
  for (const variant of variants.slice(0, 30)) {
    if (signal.aborted) break;
    const req = mutatedRequest(request, variant);
    const controller = new AbortController();
    const cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 10000);
    try {
      const response = await send(req.url, { method: req.method, headers: req.requestHeaders, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.requestBody, signal: controller.signal, credentials: 'include', redirect: 'error' });
      results.push({ title: variant.title, status: response.status, passed: response.status === expectedStatus });
      await response.body?.cancel();
    } catch (error) { results.push({ title: variant.title, status: 0, passed: false, error: (error as Error).message }); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }
  return results;
}
