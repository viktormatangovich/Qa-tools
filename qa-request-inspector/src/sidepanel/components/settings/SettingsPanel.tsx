import { useRef, useState } from 'react'
import type { WatchedEndpoint } from '../../utils/watchdog'
import { Languages, Settings, X, Moon, Sun, Type } from 'lucide-react'
import { MAX_REQUESTS, MIN_REQUESTS } from '../../hooks/useCaptureSettings'
import { t } from '../../locales'
import type { QASettings } from '../../qa'
import type { CaptureSettings, JiraSettings, Language } from '../../types'
import { downloadFile, today } from '../../utils/download'
import { buildSettingsFile, readSettingsFile, SETTINGS_KEYS } from '../../utils/settingsTransfer'

export type FontSize = 'small' | 'medium' | 'large'

interface SettingsPanelProps {
  darkMode: boolean
  fontSize: FontSize
  onDarkModeChange: (enabled: boolean) => void
  onFontSizeChange: (size: FontSize) => void
  maskSecretsOnExport: boolean
  onMaskSecretsChange: (enabled: boolean) => void
  onClose: () => void
  qaSettings: QASettings
  onQASettingsChange: (settings: QASettings) => void
  captureSettings: CaptureSettings
  onCaptureSettingsChange: (patch: Partial<CaptureSettings>) => void
  language: Language
  onLanguageChange: (language: Language) => void
  jiraSettings: JiraSettings
  onJiraSettingsChange: (settings: JiraSettings) => void
  checkUpdates?: boolean
  onCheckUpdatesChange?: (enabled: boolean) => void
  watchedEndpoints?: WatchedEndpoint[]
  onWatchedEndpointsChange?: (endpoints: WatchedEndpoint[]) => void
  onShowWhatsNew?: () => void
}

export function SettingsPanel({
  darkMode,
  fontSize,
  onDarkModeChange,
  onFontSizeChange,
  maskSecretsOnExport,
  onMaskSecretsChange,
  onClose,
  qaSettings,
  onQASettingsChange,
  captureSettings,
  onCaptureSettingsChange,
  language,
  onLanguageChange,
  jiraSettings,
  onJiraSettingsChange,
  checkUpdates = true,
  onCheckUpdatesChange,
  watchedEndpoints = [],
  onWatchedEndpointsChange,
  onShowWhatsNew,
}: SettingsPanelProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [transferError, setTransferError] = useState<string | null>(null)

  const exportSettings = async () => {
    const stored = await chrome.storage.local.get([...SETTINGS_KEYS])
    downloadFile(`reqpane-settings-${today()}.json`, JSON.stringify(buildSettingsFile(stored), null, 2), 'application/json')
  }

  const importSettings = async (file: File | undefined) => {
    if (!file) return
    setTransferError(null)
    try {
      const current = await chrome.storage.local.get([...SETTINGS_KEYS])
      const { items, skipped } = readSettingsFile(await file.text(), current)
      if (!window.confirm(t().settingsImportConfirm(Object.keys(items).length))) return
      await chrome.storage.local.set(items)
      if (skipped.length) window.alert(t().settingsImportSkipped(skipped.join(', ')))
      // Every hook reads its settings on start: reloading the panel applies all of them at once.
      window.location.reload()
    } catch {
      setTransferError(t().settingsImportError)
    }
  }

  return (
    <div className="panel-page flex flex-col h-full">
      {/* Drag Handle */}
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-10 h-1 rounded-full bg-border" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium">{t().settingsTitle}</span>
        </div>

        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text rounded hover:bg-hover"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        <div className="space-y-2">
          <div className="text-sm font-medium">{t().qaChecksTitle}</div>
          {(Object.entries(t().qaSettingLabels) as Array<[keyof QASettings, string]>).map(([key, label]) => <label key={key} className="flex items-center justify-between text-xs"><span>{label}</span><input type="checkbox" checked={Boolean(qaSettings[key])} onChange={(event) => onQASettingsChange({ ...qaSettings, [key]: event.target.checked })} /></label>)}
          <label className="block text-xs text-text-muted">{t().slowThreshold}<input type="number" min="1" value={qaSettings.slowRequestThresholdMs} onChange={(event) => onQASettingsChange({ ...qaSettings, slowRequestThresholdMs: Math.max(1, Number(event.target.value) || 2000) })} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text" /></label>
          <label className="block text-xs text-text-muted">{t().largeThreshold}<input type="number" min="1" value={qaSettings.largeResponseThresholdBytes} onChange={(event) => onQASettingsChange({ ...qaSettings, largeResponseThresholdBytes: Math.max(1, Number(event.target.value) || 1048576) })} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text" /></label>
          <label className="block text-xs text-text-muted">{t().duplicateWindow}<input type="number" min="1" value={qaSettings.duplicateWindowMs} onChange={(event) => onQASettingsChange({ ...qaSettings, duplicateWindowMs: Math.max(1, Number(event.target.value) || 1000) })} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text" /></label>
          <label className="block text-xs text-text-muted">{t().duplicateMinimum}<input type="number" min="2" value={qaSettings.duplicateMinimumCount} onChange={(event) => onQASettingsChange({ ...qaSettings, duplicateMinimumCount: Math.max(2, Number(event.target.value) || 3) })} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text" /></label>
        </div>

        {/* Capture */}
        <div className="space-y-2">
          <div className="text-sm font-medium">{t().settingsCapture}</div>
          <label className="flex items-center justify-between gap-3 text-xs">
            <span>{t().preserveLog}</span>
            <input type="checkbox" checked={captureSettings.preserveLog} onChange={(event) => onCaptureSettingsChange({ preserveLog: event.target.checked })} />
          </label>
          <p className="text-[10px] text-text-muted">{t().preserveLogHint}</p>
          <label className="flex items-center justify-between gap-3 text-xs">
            <span>{t().captureAllResources}</span>
            <input type="checkbox" checked={captureSettings.captureAllResources} onChange={(event) => onCaptureSettingsChange({ captureAllResources: event.target.checked })} />
          </label>
          <p className="text-[10px] text-text-muted">{t().captureAllResourcesHint}</p>
          <label className="block text-xs text-text-muted">{t().maxRequests}
            <input
              type="number" min={MIN_REQUESTS} max={MAX_REQUESTS} step="50"
              key={captureSettings.maxRequests}
              defaultValue={captureSettings.maxRequests}
              onBlur={(event) => onCaptureSettingsChange({ maxRequests: Number(event.target.value) || 100 })}
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text"
            />
          </label>
          <p className="text-[10px] text-text-muted">{t().maxRequestsHint}</p>
          <label className="block text-xs text-text-muted">{t().throttling}
            <select
              value={captureSettings.throttle}
              onChange={(event) => onCaptureSettingsChange({ throttle: event.target.value as CaptureSettings['throttle'] })}
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text"
            >
              <option value="none">{t().throttleLabels.none}</option>
              <option value="fast3g">{t().throttleLabels.fast3g}</option>
              <option value="slow3g">{t().throttleLabels.slow3g}</option>
              <option value="offline">{t().throttleLabels.offline}</option>
              <option value="custom">{t().throttleLabels.custom}</option>
            </select>
          </label>
          {captureSettings.throttle === 'custom' && (
            <div className="grid grid-cols-3 gap-2">
              {([
                ['customLatencyMs', t().throttleLatency],
                ['customDownloadKbps', t().throttleDownload],
                ['customUploadKbps', t().throttleUpload],
              ] as Array<['customLatencyMs' | 'customDownloadKbps' | 'customUploadKbps', string]>).map(([key, label]) => (
                <label key={key} className="block text-[10px] text-text-muted">{label}
                  <input
                    type="number" min="0"
                    value={captureSettings[key]}
                    onChange={(event) => onCaptureSettingsChange({ [key]: Math.max(0, Number(event.target.value) || 0) })}
                    className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text"
                  />
                </label>
              ))}
            </div>
          )}
          <p className="text-[10px] text-text-muted">{t().throttleHint}</p>
        </div>

        {/* Jira */}
        <div className="space-y-2">
          <div className="text-sm font-medium">Jira</div>
          <label className="block text-xs text-text-muted">{t().jiraBaseUrl}
            <input type="url" value={jiraSettings.baseUrl} placeholder="https://company.atlassian.net" onChange={(event) => onJiraSettingsChange({ ...jiraSettings, baseUrl: event.target.value })} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text" />
          </label>
          <label className="block text-xs text-text-muted">{t().jiraAuthType}
            <select value={jiraSettings.authType} onChange={(event) => onJiraSettingsChange({ ...jiraSettings, authType: event.target.value as JiraSettings['authType'] })} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text">
              <option value="basic">{t().jiraAuthBasic}</option>
              <option value="bearer">{t().jiraAuthBearer}</option>
            </select>
          </label>
          {jiraSettings.authType === 'basic' && (
            <label className="block text-xs text-text-muted">{t().jiraEmail}
              <input type="email" value={jiraSettings.email} autoComplete="off" onChange={(event) => onJiraSettingsChange({ ...jiraSettings, email: event.target.value })} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text" />
            </label>
          )}
          <label className="block text-xs text-text-muted">{t().jiraToken}
            <input type="password" value={jiraSettings.token} autoComplete="off" onChange={(event) => onJiraSettingsChange({ ...jiraSettings, token: event.target.value })} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-text-muted">{t().jiraProjectKey}
              <input type="text" value={jiraSettings.projectKey} placeholder="QA" onChange={(event) => onJiraSettingsChange({ ...jiraSettings, projectKey: event.target.value.toUpperCase() })} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text" />
            </label>
            <label className="block text-xs text-text-muted">{t().jiraIssueType}
              <input type="text" value={jiraSettings.issueType} placeholder="Bug" onChange={(event) => onJiraSettingsChange({ ...jiraSettings, issueType: event.target.value })} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text" />
            </label>
          </div>
          <p className="text-[10px] text-text-muted">{t().jiraHint}</p>
        </div>

        {/* Language */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Languages className="w-4 h-4" />
            {t().language}
          </div>
          <div className="flex gap-2">
            {(['ru', 'en'] as Language[]).map((code) => (
              <button
                key={code}
                onClick={() => onLanguageChange(code)}
                className={`flex-1 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                  language === code ? 'border-accent bg-accent-light text-accent' : 'border-border hover:bg-hover'
                }`}
              >
                {code === 'ru' ? 'Русский' : 'English'}
              </button>
            ))}
          </div>
        </div>

        {/* Settings transfer */}
        <div className="space-y-2">
          <div className="text-sm font-medium">{t().settingsTransfer}</div>
          <div className="flex gap-2">
            <button onClick={() => void exportSettings()} className="flex-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-hover">{t().exportSettings}</button>
            <button onClick={() => importInputRef.current?.click()} className="flex-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-hover">{t().importSettings}</button>
            <input ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => { void importSettings(event.target.files?.[0]); event.target.value = ''; }} />
          </div>
          {transferError && <p role="alert" className="text-[10px] text-red-600">{transferError}</p>}
          <p className="text-[10px] text-text-muted">{t().settingsTransferHint}</p>
        </div>

        {/* Watchdog: endpoints whose errors and slow answers raise an alert */}
        {onWatchedEndpointsChange && (
          <div className="space-y-2">
            <div className="text-sm font-medium">{t().watchdogTitle}</div>
            {watchedEndpoints.length === 0 && <p className="text-[10px] text-text-muted">{t().watchdogEmpty}</p>}
            {watchedEndpoints.map((endpoint) => (
              <div key={endpoint.key} className="flex items-center gap-2 text-xs">
                <span className="flex-1 min-w-0 truncate font-mono" title={endpoint.key}>{endpoint.key}</span>
                <label className="flex items-center gap-1 text-[10px] text-text-muted" title={t().watchdogSlowHint}>
                  &gt;
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={endpoint.slowMs}
                    onChange={(event) => onWatchedEndpointsChange(watchedEndpoints.map((item) => item.key === endpoint.key ? { ...item, slowMs: Math.max(100, Number(event.target.value) || 100) } : item))}
                    className="w-16 rounded border border-border bg-surface px-1 py-0.5 text-xs"
                  />
                  {t().watchdogMs}
                </label>
                <button onClick={() => onWatchedEndpointsChange(watchedEndpoints.filter((item) => item.key !== endpoint.key))} className="text-red-500 hover:underline text-[10px]">{t().remove}</button>
              </div>
            ))}
            <p className="text-[10px] text-text-muted">{t().watchdogHint}</p>
          </div>
        )}

        {/* Updates */}
        {onCheckUpdatesChange && (
          <div className="space-y-2">
            <div className="text-sm font-medium">{t().updatesTitle}</div>
            <label className="flex items-center justify-between gap-3 text-xs">
              <span>{t().checkUpdates}</span>
              <input type="checkbox" checked={checkUpdates} onChange={(event) => onCheckUpdatesChange(event.target.checked)} />
            </label>
            <p className="text-[10px] text-text-muted">{t().checkUpdatesHint}</p>
            {onShowWhatsNew && <button onClick={onShowWhatsNew} className="text-xs text-accent hover:underline">{t().whatsNewMenu}</button>}
          </div>
        )}

        {/* Export */}
        <div className="space-y-2">
          <div className="text-sm font-medium">{t().exportOptions}</div>
          <label className="flex items-center justify-between gap-3 text-xs">
            <span>{t().maskSecrets}</span>
            <input type="checkbox" checked={maskSecretsOnExport} onChange={(event) => onMaskSecretsChange(event.target.checked)} />
          </label>
          <p className="text-[10px] text-text-muted">
            {t().maskSecretsHint}
          </p>
        </div>

        {/* Dark Mode */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            {darkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            {t().darkMode}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onDarkModeChange(false)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-colors ${
                !darkMode
                  ? 'border-accent bg-accent-light text-accent'
                  : 'border-border hover:bg-hover'
              }`}
            >
              <Sun className="w-4 h-4" />
              <span className="text-sm">{t().lightMode}</span>
            </button>
            <button
              onClick={() => onDarkModeChange(true)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-colors ${
                darkMode
                  ? 'border-accent bg-accent-light text-accent'
                  : 'border-border hover:bg-hover'
              }`}
            >
              <Moon className="w-4 h-4" />
              <span className="text-sm">{t().darkMode}</span>
            </button>
          </div>
        </div>

        {/* Font Size */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Type className="w-4 h-4" />
            {t().fontSize}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onFontSizeChange('small')}
              className={`flex-1 px-3 py-2.5 rounded-lg border transition-colors ${
                fontSize === 'small'
                  ? 'border-accent bg-accent-light text-accent'
                  : 'border-border hover:bg-hover'
              }`}
            >
              <span className="text-xs">{t().small}</span>
            </button>
            <button
              onClick={() => onFontSizeChange('medium')}
              className={`flex-1 px-3 py-2.5 rounded-lg border transition-colors ${
                fontSize === 'medium'
                  ? 'border-accent bg-accent-light text-accent'
                  : 'border-border hover:bg-hover'
              }`}
            >
              <span className="text-sm">{t().medium}</span>
            </button>
            <button
              onClick={() => onFontSizeChange('large')}
              className={`flex-1 px-3 py-2.5 rounded-lg border transition-colors ${
                fontSize === 'large'
                  ? 'border-accent bg-accent-light text-accent'
                  : 'border-border hover:bg-hover'
              }`}
            >
              <span className="text-base">{t().large}</span>
            </button>
          </div>
          <p className="text-[10px] text-text-muted">
            {t().fontSizeHint}
          </p>
        </div>

        {/* Preview */}
        <div className="space-y-2">
          <div className="text-sm font-medium">{t().all}</div>
          <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
            <p className="text-xs text-text-muted">{t().sampleText('xs')}</p>
            <p className="text-sm">{t().sampleText('sm')}</p>
            <p className="text-base font-medium">{t().sampleText('base')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
