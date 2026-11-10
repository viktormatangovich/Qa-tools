import { t } from '../../locales'
import type { ApiRequest, RequestTimings } from '../../types'
import { formatBytes } from '../../utils/helpers'

const PHASES: Array<{ key: keyof RequestTimings; color: string }> = [
  { key: 'blocked', color: 'bg-gray-400' },
  { key: 'dns', color: 'bg-teal-500' },
  { key: 'connect', color: 'bg-orange-500' },
  { key: 'ssl', color: 'bg-purple-500' },
  { key: 'send', color: 'bg-sky-500' },
  { key: 'wait', color: 'bg-emerald-500' },
  { key: 'receive', color: 'bg-blue-600' },
]

const formatMs = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value * 10) / 10} ms`)

/**
 * Where the time of a request went: queueing, DNS, connection, TLS, sending, waiting for the server
 * and downloading. Answers "is it the backend or the network?".
 */
export function TimingBreakdown({ request }: { request: ApiRequest }) {
  const timings = request.timings
  const total = timings ? PHASES.reduce((sum, { key }) => sum + timings[key], 0) : 0
  const facts: Array<[string, string]> = []
  if (request.protocol) facts.push([t().metaProtocol, request.protocol])
  if (request.remoteAddress) facts.push([t().metaRemote, request.remoteAddress])
  if (request.transferSize) facts.push([t().metaTransfer, formatBytes(request.transferSize)])
  if (request.fromCache) facts.push([t().metaCache, t().metaFromCache])

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-baseline justify-between text-xs font-medium">
          <span>{t().timingTitle}</span>
          <span className="font-mono text-text-muted">{formatMs(request.duration)}</span>
        </div>
        {!timings || total <= 0 ? (
          <p className="text-xs text-text-muted">{t().timingUnavailable}</p>
        ) : (
          <>
            <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-hover" role="img" aria-label={t().timingTitle}>
              {PHASES.map(({ key, color }) => timings[key] > 0 && (
                <div key={key} className={color} style={{ width: `${(timings[key] / total) * 100}%` }} title={`${t().timingLabels[key]}: ${formatMs(timings[key])}`} />
              ))}
            </div>
            <table className="w-full text-xs">
              <tbody>
                {PHASES.map(({ key, color }) => (
                  <tr key={key} className={timings[key] > 0 ? '' : 'text-text-muted'}>
                    <td className="py-0.5 pr-2"><span className={`mr-2 inline-block h-2 w-2 rounded-sm ${color}`} />{t().timingLabels[key]}</td>
                    <td className="py-0.5 text-right font-mono">{formatMs(timings[key])}</td>
                    <td className="w-12 py-0.5 text-right font-mono text-text-muted">{Math.round((timings[key] / total) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {facts.length > 0 && (
        <table className="w-full text-xs">
          <tbody>
            {facts.map(([label, value]) => (
              <tr key={label}>
                <td className="py-0.5 pr-2 text-text-muted">{label}</td>
                <td className="break-all py-0.5 text-right font-mono">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
