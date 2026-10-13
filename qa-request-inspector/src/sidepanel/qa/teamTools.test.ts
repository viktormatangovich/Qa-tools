import assert from 'node:assert/strict';
import test from 'node:test';
import { compareEnvironments } from './environmentCompare.ts';
import { retainedSessions, evaluateBusinessRule, jiraReport, playwrightExport, mutatedRequest, runNegativeBatch } from './teamTools.ts';
import { parseOpenApiSpec, validateResponse, unsupportedContractFeatures, contractCoverage } from './contract/contractChecker.ts';
import { nextMockResponse } from '../../../public/mockSequence.js';
const req = { id: 'r', type: 'fetch' as const, method: 'POST', url: 'http://localhost/items/123', requestHeaders: { Authorization: 'secret' }, requestBody: '{"quantity":1}', responseHeaders: {}, responseBody: { total: 3, items: [{ price: 1 }, { price: 2 }], meta: { id: 'a' } }, status: 200, statusText: 'OK', duration: 100, timestamp: 1, error: null, pageUrl: 'http://localhost', pageTitle: 'Тест' };
test('сравнивает вложенные поля, числовые ID, добавления, удаления и повторные вызовы', () => {
  const second = { ...req, id: 'b', url: 'http://localhost/items/456', responseBody: { ...req.responseBody, meta: { id: 'b' } } };
  assert.match(compareEnvironments([req], [second])[0].changes.join(' '), /\$\.meta\.id/);
  assert.equal(compareEnvironments([req], [second], { ignoredPaths: ['$.meta.id'], timingMs: 100, timingPercent: 20 }).length, 0);
  assert.match(compareEnvironments([], [req])[0].changes[0], /появился/);
  assert.match(compareEnvironments([req], [])[0].changes[0], /отсутствует/);
  assert.equal(compareEnvironments([req], [req, { ...req, timestamp: 2 }]).length, 1);
});
test('сравнение игнорирует порядок ключей и учитывает оба порога замедления', () => {
  assert.equal(compareEnvironments([req], [{ ...req, duration: 201 }]).length, 1);
  assert.equal(compareEnvironments([req], [{ ...req, duration: 150 }]).length, 0);
  assert.equal(compareEnvironments([{ ...req, responseBody: { a: 1, b: 2 } }], [{ ...req, responseBody: { b: 2, a: 1 } }]).length, 0);
});
test('история содержит только три сессии младше 24 часов', () => {
  const now = 100000000;
  const sessions = [1,2,3,4].map(i => ({ id: String(i), name: 'Сессия', timestamp: now - i, count: 1 }));
  sessions.push({ id: 'old', name: 'Старая', timestamp: now - 86400000, count: 1 });
  assert.deepEqual(retainedSessions(sessions, now).map(s => s.id), ['1','2','3']);
});
test('бизнес-правила проверяют наличие, точное значение, границу и сумму', () => {
  const rule = { id: 'b', name: 'Итог', path: '$.total', operator: 'sum' as const, expected: '', sumPath: '$.items[*].price' };
  assert.equal(evaluateBusinessRule(req.responseBody, rule), true);
  assert.equal(evaluateBusinessRule({ ...req.responseBody, total: 4 }, rule), false);
  assert.equal(evaluateBusinessRule(req.responseBody, { ...rule, operator: 'gte', expected: '0' }), true);
  assert.equal(evaluateBusinessRule(req.responseBody, { ...rule, operator: 'equals', expected: '3' }), true);
  assert.equal(evaluateBusinessRule(req.responseBody, { ...rule, operator: 'exists', path: '$.missing' }), false);
});
test('Jira содержит ручные шаги, ожидаемое и фактическое поведение', () => {
  const report = jiraReport('Ошибка', [{ id: 's', text: 'Удалить товар', timestamp: 1, requestIds: ['r'] }], 'Товар удалён', 'Товар остался', 'test', req);
  assert.match(report, /1\. Удалить товар/); assert.match(report, /Ожидаемый результат\nТовар удалён/); assert.match(report, /Фактический результат\nТовар остался/);
});
test('Playwright экспорт сохраняет данные, метод и записанное ожидание', () => {
  assert.match(playwrightExport([req], 'api'), /secret/); assert.match(playwrightExport([req], 'api'), /toBe\(200\)/);
  assert.match(playwrightExport([req], 'mocks'), /route\.request\(\)\.method/); assert.match(playwrightExport([req], 'mocks'), /route\.fallback/);
});
test('мутации заголовков нечувствительны к регистру и сохраняют пустое тело', () => {
  const value = mutatedRequest(req, { id: 'v', title: 'Тест', description: '', target: '', kind: 'input', headerName: 'authorization', removeHeader: true, body: '' });
  assert.deepEqual(value.requestHeaders, {}); assert.equal(value.requestBody, '');
});
test('пакет проверяет ожидаемый статус и останавливается по отмене', async () => {
  const controller = new AbortController(); let calls = 0;
  const variants = [1,2].map(i => ({ id: String(i), title: 'Вариант', description: '', target: '', kind: 'input' as const, body: '{}' }));
  const results = await runNegativeBatch(req, variants, 400, controller.signal, async () => { calls++; controller.abort(); return new Response('{}', { status: 400 }); });
  assert.equal(calls, 1); assert.equal(results[0].passed, true);
});
test('последовательность моков поддерживает последний ответ, повтор и выход на сервер', () => {
  const rule = { sequence: [{ status: 500 }, { status: 200 }] };
  assert.equal(nextMockResponse(rule, 0).response.status, 500);
  assert.equal(nextMockResponse(rule, 1).response.status, 200);
  assert.equal(nextMockResponse(rule, 2).response.status, 200);
  assert.equal(nextMockResponse({ ...rule, sequenceEnd: 'repeat' }, 2).response.status, 500);
  assert.equal(nextMockResponse({ ...rule, sequenceEnd: 'passthrough' }, 2).response, null);
});
test('OpenAPI YAML принимает integer как number и исключает служебные ключи из покрытия', () => {
  const doc = parseOpenApiSpec('openapi: 3.0.3\npaths:\n  /items/123:\n    parameters: []\n    post:\n      responses:\n        "200":\n          content:\n            application/json:\n              schema:\n                type: number\n');
  assert.equal(validateResponse(doc, { ...req, responseBody: 3 }).length, 0);
  assert.equal(contractCoverage(doc, [req]).total, 1);
  const unsupported = parseOpenApiSpec('{"openapi":"3.1.0","paths":{},"components":{"schemas":{"A":{"oneOf":[],"$ref":"external.yaml"}}}}');
  assert.equal(unsupportedContractFeatures(unsupported).length, 2);
});
