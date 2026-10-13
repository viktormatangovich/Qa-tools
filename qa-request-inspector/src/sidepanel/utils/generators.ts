import type { ApiRequest, ConsoleError } from '../types'
import { formatBytes, getPayloadSize } from './helpers'

export function formatJsonForExport(data: unknown): string {
  try {
    if (data === null || data === undefined) return '(пусто)'
    if (typeof data === 'string') {
      try {
        return JSON.stringify(JSON.parse(data), null, 2)
      } catch {
        return data
      }
    }
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

export function generateClaudePrompt(req: ApiRequest): string {
  const isError = req.status >= 400 || req.error

  let prompt = `## ${isError ? 'Отчёт об ошибке API' : 'Отчёт о запросе API'}

**Маршрут:** \`${req.method} ${req.url}\`
**Статус:** ${req.status} ${req.statusText}
**Длительность:** ${(req.duration / 1000).toFixed(2)}s
**Тип:** ${req.type.toUpperCase()}
${req.error ? `**Ошибка:** ${req.error}` : ''}

### Контекст страницы
- **URL:** ${req.pageUrl}
- **Заголовок:** ${req.pageTitle}

`

  if (req.requestBody) {
    prompt += `### Тело запроса
\`\`\`json
${formatJsonForExport(req.requestBody)}
\`\`\`

`
  }

  if (req.requestHeaders && Object.keys(req.requestHeaders).length > 0) {
    prompt += `### Заголовки запроса
\`\`\`
${Object.entries(req.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}
\`\`\`

`
  }

  prompt += `### Тело ответа
\`\`\`json
${formatJsonForExport(req.responseBody)}
\`\`\`

`

  if (req.responseHeaders && Object.keys(req.responseHeaders).length > 0) {
    prompt += `### Заголовки ответа
\`\`\`
${Object.entries(req.responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}
\`\`\`

`
  }

  prompt += `---
Помоги ${isError ? 'разобраться с ошибкой API' : 'проанализировать ответ API'}. ${
  isError
    ? 'Что могло вызвать проблему и как её исправить?'
    : 'Есть ли проблемы в этом запросе или ответе?'
}
`

  return prompt
}

export function generateCurl(req: ApiRequest): string {
  const parts = ['curl']

  if (req.method !== 'GET') {
    parts.push(`-X ${req.method}`)
  }

  parts.push(`'${req.url}'`)

  Object.entries(req.requestHeaders || {}).forEach(([key, value]) => {
    parts.push(`-H '${key}: ${value}'`)
  })

  if (req.requestBody) {
    const body = typeof req.requestBody === 'string'
      ? req.requestBody
      : JSON.stringify(req.requestBody)
    parts.push(`-d '${body.replace(/'/g, "\\'")}'`)
  }

  return parts.join(' \\\n  ')
}

export function generateFetchCode(req: ApiRequest): string {
  const options: Record<string, unknown> = {
    method: req.method,
  }

  if (Object.keys(req.requestHeaders || {}).length > 0) {
    options.headers = req.requestHeaders
  }

  if (req.requestBody) {
    options.body = typeof req.requestBody === 'string'
      ? req.requestBody
      : JSON.stringify(req.requestBody)
  }

  const optionsStr = JSON.stringify(options, null, 2)
    .replace(/"([^"]+)":/g, '$1:')

  return `fetch('${req.url}', ${optionsStr})
  .then(res => res.json())
  .then(data => console.log(data))
  .catch(err => console.error(err))`
}

export function generateHar(requests: ApiRequest[]) {
  return {
    log: {
      version: '1.2',
      creator: {
        name: 'Reqpane',
        version: '1.0.0',
      },
      entries: requests.map(req => ({
        startedDateTime: new Date(req.timestamp).toISOString(),
        time: req.duration,
        request: {
          method: req.method,
          url: req.url,
          httpVersion: 'HTTP/1.1',
          headers: Object.entries(req.requestHeaders || {}).map(([name, value]) => ({ name, value })),
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: req.requestBody ? new Blob([typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody)]).size : 0,
          postData: req.requestBody ? {
            mimeType: 'application/json',
            text: typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody),
          } : undefined,
        },
        response: {
          status: req.status,
          statusText: req.statusText,
          httpVersion: 'HTTP/1.1',
          headers: Object.entries(req.responseHeaders || {}).map(([name, value]) => ({ name, value })),
          cookies: [],
          content: {
            size: req.responseBody ? new Blob([typeof req.responseBody === 'string' ? req.responseBody : JSON.stringify(req.responseBody)]).size : 0,
            mimeType: 'application/json',
            text: req.responseBody ? (typeof req.responseBody === 'string' ? req.responseBody : JSON.stringify(req.responseBody)) : '',
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        timings: {
          send: 0,
          wait: req.duration,
          receive: 0,
        },
      })),
    },
  }
}

export function generatePostmanCollection(requests: ApiRequest[]) {
  return {
    info: {
      name: `Экспорт QA Tools - ${new Date().toISOString().slice(0, 10)}`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description: 'Экспорт из расширения QA Tools',
    },
    item: requests.map(req => {
      const urlParts = (() => {
        try {
          const url = new URL(req.url)
          return {
            raw: req.url,
            protocol: url.protocol.replace(':', ''),
            host: url.hostname.split('.'),
            path: url.pathname.split('/').filter(Boolean),
            query: Array.from(url.searchParams.entries()).map(([key, value]) => ({ key, value })),
          }
        } catch {
          return { raw: req.url }
        }
      })()

      const item: Record<string, unknown> = {
        name: (() => {
          try {
            return new URL(req.url).pathname || req.url
          } catch {
            return req.url
          }
        })(),
        request: {
          method: req.method,
          header: Object.entries(req.requestHeaders || {}).map(([key, value]) => ({
            key,
            value,
            type: 'text',
          })),
          url: urlParts,
        },
        response: [{
          name: `${req.status} ${req.statusText}`,
          status: req.statusText,
          code: req.status,
          header: Object.entries(req.responseHeaders || {}).map(([key, value]) => ({
            key,
            value,
          })),
          body: req.responseBody ? (typeof req.responseBody === 'string' ? req.responseBody : JSON.stringify(req.responseBody, null, 2)) : '',
        }],
      }

      if (req.requestBody && req.method !== 'GET') {
        (item.request as Record<string, unknown>).body = {
          mode: 'raw',
          raw: typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody, null, 2),
          options: {
            raw: {
              language: 'json',
            },
          },
        }
      }

      return item
    }),
  }
}

export function generateTypeScript(req: ApiRequest): string {
  const data = req.responseBody
  if (!data) return '// Нет тела ответа для генерации типов'

  let parsed: unknown
  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : data
  } catch {
    return '// Нельзя создать типы: ответ содержит некорректный JSON'
  }

  function inferType(value: unknown, name: string, indent = ''): string {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'

    const type = typeof value
    if (type === 'string') return 'string'
    if (type === 'number') return 'number'
    if (type === 'boolean') return 'boolean'

    if (Array.isArray(value)) {
      if (value.length === 0) return 'unknown[]'
      const itemType = inferType(value[0], name + 'Item', indent)
      return `${itemType}[]`
    }

    if (type === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
      if (entries.length === 0) return 'Record<string, unknown>'

      const props = entries.map(([key, val]) => {
        const propType = inferType(val, capitalize(key), indent + '  ')
        const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`
        return `${indent}  ${safeKey}: ${propType}`
      }).join('\n')

      return `{\n${props}\n${indent}}`
    }

    return 'unknown'
  }

  function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  try {
    const typeBody = inferType(parsed, 'Response', '')
    return `interface ApiResponse ${typeBody}`
  } catch {
    return '// Не удалось создать типы из ответа'
  }
}

interface ReportStats {
  total: number
  successful: number
  clientErrors: number
  serverErrors: number
  networkErrors: number
  successRate: number
  avgTime: number
  minTime: number
  maxTime: number
  totalSize: number
  statusDistribution: Record<number, number>
  slowRequests: ApiRequest[]
}

function calculateReportStats(requests: ApiRequest[]): ReportStats {
  const total = requests.length
  const successful = requests.filter(r => r.status >= 200 && r.status < 300).length
  const clientErrors = requests.filter(r => r.status >= 400 && r.status < 500).length
  const serverErrors = requests.filter(r => r.status >= 500).length
  const networkErrors = requests.filter(r => r.status === 0 || r.error).length
  const successRate = total > 0 ? (successful / total) * 100 : 0

  const durations = requests.map(r => r.duration)
  const avgTime = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
  const minTime = durations.length > 0 ? Math.min(...durations) : 0
  const maxTime = durations.length > 0 ? Math.max(...durations) : 0

  const totalSize = requests.reduce((acc, r) => {
    return acc + getPayloadSize(r.requestBody) + getPayloadSize(r.responseBody)
  }, 0)

  const statusDistribution: Record<number, number> = {}
  requests.forEach(r => {
    const status = r.status || 0
    statusDistribution[status] = (statusDistribution[status] || 0) + 1
  })

  const slowRequests = requests.filter(r => r.duration > 500).sort((a, b) => b.duration - a.duration)

  return {
    total,
    successful,
    clientErrors,
    serverErrors,
    networkErrors,
    successRate,
    avgTime,
    minTime,
    maxTime,
    totalSize,
    statusDistribution,
    slowRequests,
  }
}

export function generateMarkdownReport(
  requests: ApiRequest[],
  consoleErrors: ConsoleError[],
  pageInfo: { url: string; title: string }
): string {
  const stats = calculateReportStats(requests)
  const now = new Date()
  const timestamp = now.toLocaleString()

  let report = `# Отчёт по API

**Сформирован:** ${timestamp}
**Страница:** ${pageInfo.title || 'Недоступно'}
**URL:** ${pageInfo.url || 'Недоступно'}

---

## Сводка

| Показатель | Значение |
|--------|-------|
| Всего запросов | ${stats.total} |
| Успешные (2xx) | ${stats.successful} |
| Ошибки клиента (4xx) | ${stats.clientErrors} |
| Ошибки сервера (5xx) | ${stats.serverErrors} |
| Сетевые ошибки | ${stats.networkErrors} |
| Доля успешных | ${stats.successRate.toFixed(1)}% |
| Среднее время ответа | ${Math.round(stats.avgTime)}ms |
| Минимальное время ответа | ${Math.round(stats.minTime)}ms |
| Максимальное время ответа | ${Math.round(stats.maxTime)}ms |
| Объём данных | ${formatBytes(stats.totalSize)} |

`

  // Status code distribution
  const statusCodes = Object.keys(stats.statusDistribution).map(Number).sort((a, b) => a - b)
  if (statusCodes.length > 0) {
    report += `### Распределение статусов

| Статус | Количество |
|--------|-------|
`
    statusCodes.forEach(status => {
      report += `| ${status || 'ERR'} | ${stats.statusDistribution[status]} |\n`
    })
    report += '\n'
  }

  // Slowest requests
  if (stats.slowRequests.length > 0) {
    report += `### Медленные запросы (>500 мс)

| URL | Метод | Время | Статус |
|-----|--------|----------|--------|
`
    stats.slowRequests.slice(0, 10).forEach(req => {
      let pathname = req.url
      try {
        pathname = new URL(req.url).pathname
        if (pathname.length > 50) pathname = '...' + pathname.slice(-47)
      } catch { /* keep original */ }
      report += `| ${pathname} | ${req.method} | ${req.duration}ms | ${req.status || 'ERR'} |\n`
    })
    report += '\n'
  }

  // Failed requests
  const failedRequests = requests.filter(r => r.status >= 400 || r.error)
  if (failedRequests.length > 0) {
    report += `---

## Неуспешные запросы (${failedRequests.length})

`
    failedRequests.forEach((req, i) => {
      let pathname = req.url
      try {
        pathname = new URL(req.url).pathname
      } catch { /* keep original */ }

      report += `### ${i + 1}. ${req.method} ${pathname}

- **Статус:** ${req.status} ${req.statusText || ''}
- **Длительность:** ${req.duration}ms
- **Время:** ${new Date(req.timestamp).toLocaleTimeString()}
${req.error ? `- **Ошибка:** ${req.error}` : ''}

`
      if (req.responseBody) {
        report += `**Ответ:**
\`\`\`json
${formatJsonForExport(req.responseBody)}
\`\`\`

`
      }
    })
  }

  // All requests
  report += `---

## Все запросы (${requests.length})

`
  requests.forEach(req => {
    let pathname = req.url
    try {
      pathname = new URL(req.url).pathname
    } catch { /* keep original */ }

    report += `### ${req.method} ${pathname}

- **Статус:** ${req.status} ${req.statusText || ''}
- **Длительность:** ${req.duration}ms
- **Время:** ${new Date(req.timestamp).toLocaleTimeString()}

`

    if (req.requestHeaders && Object.keys(req.requestHeaders).length > 0) {
      report += `**Заголовки запроса:**
\`\`\`
${Object.entries(req.requestHeaders).map(([k, v]) => {
  // Mask sensitive headers
  const masked = ['authorization', 'cookie', 'x-api-key'].includes(k.toLowerCase())
    ? v.slice(0, 10) + '...'
    : v
  return `${k}: ${masked}`
}).join('\n')}
\`\`\`

`
    }

    if (req.requestBody) {
      report += `**Тело запроса:**
\`\`\`json
${formatJsonForExport(req.requestBody)}
\`\`\`

`
    }

    if (req.responseHeaders && Object.keys(req.responseHeaders).length > 0) {
      report += `**Заголовки ответа:**
\`\`\`
${Object.entries(req.responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}
\`\`\`

`
    }

    if (req.responseBody) {
      const bodyStr = formatJsonForExport(req.responseBody)
      const truncated = bodyStr.length > 2000 ? bodyStr.slice(0, 2000) + '\n... (сокращено)' : bodyStr
      report += `**Тело ответа:**
\`\`\`json
${truncated}
\`\`\`

`
    }
  })

  // Ошибки консоли
  if (consoleErrors.length > 0) {
    report += `---

## Ошибки консоли (${consoleErrors.length})

`
    consoleErrors.forEach((err, i) => {
      report += `### ${i + 1}. ${err.message.slice(0, 100)}${err.message.length > 100 ? '...' : ''}

- **Тип:** ${err.type}
${err.filename ? `- **Файл:** ${err.filename}${err.lineno ? `:${err.lineno}` : ''}${err.colno ? `:${err.colno}` : ''}` : ''}
- **Время:** ${new Date(err.timestamp).toLocaleTimeString()}

`
      if (err.stack) {
        report += `**Стек вызовов:**
\`\`\`
${err.stack}
\`\`\`

`
      }
    })
  }

  report += `---

*Отчёт сформирован расширением QA Tools*
`

  return report
}
