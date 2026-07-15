import { useCallback, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import type { MockRule } from '../../types'
import { t } from '../../locales'

interface MockRuleEditorProps {
  rule: MockRule
  onSave: (rule: MockRule) => void
  onCancel: () => void
}

const STATUS_PRESETS = [
  { code: 200, text: 'OK', label: 'ok200' },
  { code: 201, text: 'Created', label: 'created201' },
  { code: 204, text: 'No Content', label: 'noContent204' },
  { code: 301, text: 'Moved Permanently', label: null },
  { code: 302, text: 'Found', label: null },
  { code: 400, text: 'Bad Request', label: 'badRequest400' },
  { code: 401, text: 'Unauthorized', label: 'unauthorized401' },
  { code: 403, text: 'Forbidden', label: 'forbidden403' },
  { code: 404, text: 'Not Found', label: 'notFound404' },
  { code: 422, text: 'Unprocessable Entity', label: null },
  { code: 429, text: 'Too Many Requests', label: null },
  { code: 500, text: 'Server Error', label: 'serverError500' },
  { code: 502, text: 'Bad Gateway', label: null },
  { code: 503, text: 'Service Unavailable', label: null },
]

export function MockRuleEditor({
  rule,
  onSave,
  onCancel,
}: MockRuleEditorProps) {
  const [urlPattern, setUrlPattern] = useState(rule.urlPattern)
  const [method, setMethod] = useState(rule.method)
  const [status, setStatus] = useState(rule.status)
  const [statusText, setStatusText] = useState(rule.statusText)
  const [responseBody, setResponseBody] = useState(rule.responseBody)
  const [delay, setDelay] = useState(rule.delay ?? 0)
  const [description, setDescription] = useState(rule.description ?? '')
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>(
    Object.entries(rule.responseHeaders || {}).map(([key, value]) => ({ key, value }))
  )
  const [jsonError, setJsonError] = useState<string | null>(null)

  const validateJson = useCallback((value: string) => {
    if (!value.trim()) {
      setJsonError(null)
      return true
    }
    try {
      JSON.parse(value)
      setJsonError(null)
      return true
    } catch {
      setJsonError('Invalid JSON')
      return false
    }
  }, [])

  const handleBodyChange = useCallback((value: string) => {
    setResponseBody(value)
    validateJson(value)
  }, [validateJson])

  const applyPreset = useCallback((code: number, text: string) => {
    setStatus(code)
    setStatusText(text)
  }, [])

  const addHeader = useCallback(() => {
    setHeaders(prev => [...prev, { key: '', value: '' }])
  }, [])

  const updateHeader = useCallback((index: number, field: 'key' | 'value', value: string) => {
    setHeaders(prev => prev.map((h, i) => i === index ? { ...h, [field]: value } : h))
  }, [])

  const removeHeader = useCallback((index: number) => {
    setHeaders(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleSave = useCallback(() => {
    if (!urlPattern.trim()) return
    const responseHeaders: Record<string, string> = {}
    headers.forEach(h => {
      if (h.key.trim()) responseHeaders[h.key.trim()] = h.value
    })
    onSave({
      ...rule,
      urlPattern: urlPattern.trim(),
      method,
      status,
      statusText,
      responseBody,
      responseHeaders,
      delay,
      description: description.trim() || undefined,
      enabled: rule.enabled,
    })
  }, [rule, urlPattern, method, status, statusText, responseBody, headers, delay, description, onSave])

  const formatJson = useCallback(() => {
    try {
      const parsed = JSON.parse(responseBody)
      setResponseBody(JSON.stringify(parsed, null, 2))
      setJsonError(null)
    } catch {
      // ignore
    }
  }, [responseBody])

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] shrink-0">
        <span className="text-sm font-medium">
          {rule.urlPattern ? t().editRule : t().newRule}
        </span>
        <button
          onClick={onCancel}
          className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded hover:bg-[var(--color-hover)]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Description */}
        <div>
          <label className="text-xs font-medium mb-1 block text-[var(--color-text)]">{t().mockDescription}</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t().mockDescription}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* URL Pattern */}
        <div>
          <label className="text-xs font-medium mb-1 block text-[var(--color-text)]">{t().mockUrlPattern}</label>
          <input
            type="text"
            value={urlPattern}
            onChange={(e) => setUrlPattern(e.target.value)}
            placeholder={t().mockUrlPatternPlaceholder}
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-purple-500"
          />
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
            {t().mockUrlPatternHint}
          </p>
        </div>

        {/* Method + Status + Delay */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium mb-1 block text-[var(--color-text)]">{t().mockMethod}</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as MockRule['method'])}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-purple-500"
            >
              <option value="ALL">ALL</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div className="w-24">
            <label className="text-xs font-medium mb-1 block text-[var(--color-text)]">{t().mockStatusCode}</label>
            <input
              type="number"
              value={status}
              onChange={(e) => setStatus(parseInt(e.target.value) || 200)}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-purple-500"
            />
          </div>
          <div className="w-28">
            <label className="text-xs font-medium mb-1 block text-[var(--color-text)]">{t().mockStatusText}</label>
            <input
              type="text"
              value={statusText}
              onChange={(e) => setStatusText(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-purple-500"
            />
          </div>
          <div className="w-24">
            <label className="text-xs font-medium mb-1 block text-[var(--color-text)]">{t().mockDelay}</label>
            <input
              type="number"
              value={delay}
              onChange={(e) => setDelay(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-purple-500"
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{t().mockDelayHint}</p>
          </div>
        </div>

        {/* Status Presets */}
        <div>
          <label className="text-xs font-medium mb-1.5 block text-[var(--color-text)]">{t().statusPresets}</label>
          <div className="flex flex-wrap gap-1">
            {STATUS_PRESETS.map(preset => (
              <button
                key={preset.code}
                onClick={() => applyPreset(preset.code, preset.text)}
                className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                  status === preset.code
                    ? 'bg-purple-100 border-purple-300 text-purple-700'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]'
                }`}
              >
                {preset.code} {preset.text}
              </button>
            ))}
          </div>
        </div>

        {/* Response Headers */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-[var(--color-text)]">{t().mockResponseHeaders}</label>
            <button
              onClick={addHeader}
              className="flex items-center gap-0.5 text-[10px] text-purple-500 hover:text-purple-600"
            >
              <Plus className="w-3 h-3" /> {t().addRule}
            </button>
          </div>
          <div className="space-y-1">
            {headers.map((header, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="text"
                  value={header.key}
                  onChange={(e) => updateHeader(i, 'key', e.target.value)}
                  placeholder={t().mockResponseHeaderKey}
                  className="flex-1 px-2 py-1.5 text-xs font-mono rounded border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-purple-500"
                />
                <input
                  type="text"
                  value={header.value}
                  onChange={(e) => updateHeader(i, 'value', e.target.value)}
                  placeholder={t().mockResponseHeaderValue}
                  className="flex-1 px-2 py-1.5 text-xs font-mono rounded border border-[var(--color-border)] bg-[var(--color-surface)] focus:outline-none focus:border-purple-500"
                />
                <button
                  onClick={() => removeHeader(i)}
                  className="p-1 text-red-500 hover:bg-red-50 rounded"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Response Body */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-[var(--color-text)]">{t().mockResponseBody}</label>
            <button
              onClick={formatJson}
              className="text-[10px] text-purple-500 hover:text-purple-600"
            >
              Format JSON
            </button>
          </div>
          <textarea
            value={responseBody}
            onChange={(e) => handleBodyChange(e.target.value)}
            placeholder={t().mockResponseBodyPlaceholder}
            className={`w-full h-40 px-3 py-2 text-sm font-mono rounded-lg border bg-[var(--color-surface)] focus:outline-none focus:border-purple-500 resize-none ${
              jsonError ? 'border-red-500' : 'border-[var(--color-border)]'
            }`}
            spellCheck={false}
          />
          {jsonError && (
            <p className="text-[10px] text-red-500 mt-1">{jsonError}</p>
          )}
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={!urlPattern.trim()}
          className="w-full py-2.5 rounded-lg bg-purple-500 text-white font-medium text-sm hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t().save}
        </button>
      </div>
    </div>
  )
}
