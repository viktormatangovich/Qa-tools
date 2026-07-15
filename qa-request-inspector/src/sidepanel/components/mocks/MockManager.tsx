import { useCallback, useMemo, useState } from 'react'
import {
  Download,
  Import,
  Plus,
  Search,
  Shield,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X
} from 'lucide-react'
import type { MockRule } from '../../types'
import { MockRuleEditor } from './MockRuleEditor'
import { t } from '../../locales'

interface MockManagerProps {
  rules: MockRule[]
  onSave: (rules: MockRule[]) => void
  onClose: () => void
}

export function MockManager({
  rules,
  onSave,
  onClose,
}: MockManagerProps) {
  const [localRules, setLocalRules] = useState<MockRule[]>(rules)
  const [editingRule, setEditingRule] = useState<MockRule | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredRules = useMemo(() => {
    if (!searchQuery.trim()) return localRules
    const q = searchQuery.toLowerCase()
    return localRules.filter(r =>
      r.urlPattern.toLowerCase().includes(q) ||
      r.method.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q)
    )
  }, [localRules, searchQuery])

  const addRule = useCallback(() => {
    const newRule: MockRule = {
      id: crypto.randomUUID(),
      urlPattern: '',
      method: 'ALL',
      status: 200,
      statusText: 'OK',
      responseBody: '{}',
      responseHeaders: {},
      enabled: true,
      delay: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setEditingRule(newRule)
  }, [])

  const saveRule = useCallback((rule: MockRule) => {
    const exists = localRules.find(r => r.id === rule.id)
    const newRules = exists
      ? localRules.map(r => r.id === rule.id ? { ...rule, updatedAt: Date.now() } : r)
      : [...localRules, { ...rule, createdAt: Date.now(), updatedAt: Date.now() }]
    setLocalRules(newRules)
    onSave(newRules)
    setEditingRule(null)
  }, [localRules, onSave])

  const deleteRule = useCallback((id: string) => {
    const newRules = localRules.filter(r => r.id !== id)
    setLocalRules(newRules)
    onSave(newRules)
  }, [localRules, onSave])

  const toggleRule = useCallback((id: string) => {
    const newRules = localRules.map(r =>
      r.id === id ? { ...r, enabled: !r.enabled, updatedAt: Date.now() } : r
    )
    setLocalRules(newRules)
    onSave(newRules)
  }, [localRules, onSave])

  const enableAll = useCallback(() => {
    const newRules = localRules.map(r => ({ ...r, enabled: true, updatedAt: Date.now() }))
    setLocalRules(newRules)
    onSave(newRules)
  }, [localRules, onSave])

  const disableAll = useCallback(() => {
    const newRules = localRules.map(r => ({ ...r, enabled: false, updatedAt: Date.now() }))
    setLocalRules(newRules)
    onSave(newRules)
  }, [localRules, onSave])

  const deleteAll = useCallback(() => {
    if (window.confirm(t().confirmDeleteAll)) {
      setLocalRules([])
      onSave([])
    }
  }, [onSave])

  const exportRules = useCallback(() => {
    const blob = new Blob([JSON.stringify(localRules, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mock-rules-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [localRules])

  const importRules = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const imported = JSON.parse(text) as MockRule[]
        if (!Array.isArray(imported)) throw new Error('Invalid format')
        // Assign new IDs to avoid conflicts
        const withNewIds = imported.map(r => ({
          ...r,
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }))
        const newRules = [...localRules, ...withNewIds]
        setLocalRules(newRules)
        onSave(newRules)
        alert(t().importSuccess)
      } catch {
        alert(t().importError)
      }
    }
    input.click()
  }, [localRules, onSave])

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'text-emerald-600'
      case 'POST': return 'text-blue-600'
      case 'PUT': return 'text-amber-600'
      case 'PATCH': return 'text-orange-600'
      case 'DELETE': return 'text-red-600'
      default: return 'text-purple-600'
    }
  }

  if (editingRule) {
    return (
      <MockRuleEditor
        rule={editingRule}
        onSave={saveRule}
        onCancel={() => setEditingRule(null)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-5 text-purple-500" />
          <span className="text-sm font-medium">{t().mockManagerTitle}</span>
          <span className="text-[10px] text-[var(--color-text-muted)]">
            ({localRules.filter(r => r.enabled).length}/{localRules.length} {t().active})
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={addRule}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors"
          >
            <Plus className="w-3 h-3" /> {t().addRule}
          </button>
          <button
            onClick={onClose}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded hover:bg-[var(--color-hover)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search & Bulk Actions */}
      <div className="px-4 py-2 border-b border-[var(--color-border)] space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t().searchRules}
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:border-purple-500"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={enableAll}
            className="px-2 py-1 text-[10px] rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
          >
            {t().enableAll}
          </button>
          <button
            onClick={disableAll}
            className="px-2 py-1 text-[10px] rounded bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            {t().disableAll}
          </button>
          <button
            onClick={deleteAll}
            className="px-2 py-1 text-[10px] rounded bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
          >
            {t().deleteAll}
          </button>
          <div className="flex-1" />
          <button
            onClick={importRules}
            className="px-2 py-1 text-[10px] rounded border border-[var(--color-border)] hover:bg-[var(--color-hover)] transition-colors flex items-center gap-1"
          >
            <Import className="w-3 h-3" /> {t().importRules}
          </button>
          <button
            onClick={exportRules}
            disabled={localRules.length === 0}
            className="px-2 py-1 text-[10px] rounded border border-[var(--color-border)] hover:bg-[var(--color-hover)] transition-colors disabled:opacity-30 flex items-center gap-1"
          >
            <Download className="w-3 h-3" /> {t().exportRules}
          </button>
        </div>
      </div>

      {/* Rules List */}
      <div className="flex-1 overflow-auto">
        {filteredRules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)]">
            <Shield className="w-12 h-12 mb-3 opacity-30" strokeWidth={1} />
            <p className="text-sm">{t().noMockRules}</p>
            <p className="text-xs mt-1">{t().noMockRulesDesc}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {filteredRules.map(rule => (
              <div key={rule.id} className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--color-hover)] transition-colors">
                <button
                  onClick={() => toggleRule(rule.id)}
                  className={`shrink-0 transition-colors ${rule.enabled ? 'text-purple-500' : 'text-[var(--color-text-muted)]'}`}
                  title={rule.enabled ? t().enabled : t().disabled}
                >
                  {rule.enabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono font-semibold ${getMethodColor(rule.method)}`}>
                      {rule.method}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      rule.status < 300 ? 'bg-emerald-50 text-emerald-600' :
                      rule.status < 400 ? 'bg-amber-50 text-amber-600' :
                      'bg-red-50 text-red-600'
                    }`}>
                      {rule.status}
                    </span>
                    {rule.delay ? (
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        ⏱ {rule.delay}ms
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs font-mono text-[var(--color-text)] truncate mt-0.5">
                    {rule.urlPattern || <span className="text-[var(--color-text-muted)] italic">{t().noPattern}</span>}
                  </p>
                  {rule.description && (
                    <p className="text-[10px] text-[var(--color-text-muted)] truncate mt-0.5">
                      {rule.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditingRule(rule)}
                    className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] rounded transition-colors"
                    title={t().editRule}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                    title={t().delete}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
