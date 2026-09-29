import { AlertCircle, AlertTriangle, FileUp, Info, LocateFixed, ServerCrash } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { QAIssue, QAIssueCategory, QAIssueSeverity } from "../../qa";
import { EnvironmentComparePanel } from "./EnvironmentComparePanel";
import type { EnvironmentDifference } from "../../qa/environmentCompare";
import { loadOpenApiSpecFromUrl, parseOpenApiSpec } from "../../qa/contract/contractChecker";
import { contractTestSuggestions } from "../../qa/contract/suggestions";
import { diffOpenApi } from "../../qa/contract/contractDiff";

type QAFilter = "all" | QAIssueSeverity | QAIssueCategory;

interface QACheckViewProps {
  issues: QAIssue[];
  filter: QAFilter;
  onFilterChange: (filter: QAFilter) => void;
  onOpenRequest: (issue: QAIssue) => void;
  onHighlightIssue: (issue: QAIssue) => void;
  onRefreshDomChecks: () => void;
  domChecksLoading: boolean;
  contractSpecText: string;
  contractError: string | null;
  contractCoverage: { total: number; exercised: number; validated: number; passed: number; failed: number } | null;
  onContractSpecChange: (text: string) => void;
  onCreateBugReport: (issue: QAIssue) => void;
  onDismissIssue: (issue: QAIssue) => void;
  onExcludeRule: (issue: QAIssue) => void;
  excludedRuleCount: number;
  onRestoreExcludedRules: () => void;
  onExportSessionReport: (format: 'md' | 'html' | 'json') => void;
  sessions: Array<{ id: string; name: string }>;
  onCompareSessions: (left: string, right: string) => Promise<EnvironmentDifference[]>;
}

const severityStyle: Record<QAIssueSeverity, string> = {
  info: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  error: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  critical: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
};

function matchesFilter(issue: QAIssue, filter: QAFilter): boolean {
  return filter === "all" || issue.severity === filter || issue.category === filter;
}

export function QACheckView({ issues, filter, onFilterChange, onOpenRequest, onHighlightIssue, onRefreshDomChecks, domChecksLoading, contractSpecText, contractError, contractCoverage, onContractSpecChange, onCreateBugReport, onDismissIssue, onExcludeRule, excludedRuleCount, onRestoreExcludedRules, onExportSessionReport, sessions, onCompareSessions }: QACheckViewProps) {
  const [comparisonSpec, setComparisonSpec] = useState("");
  const [contractUrl, setContractUrl] = useState("");
  const [contractUrlError, setContractUrlError] = useState<string | null>(null);
  const [contractUrlLoading, setContractUrlLoading] = useState(false);
  const [contractFileError, setContractFileError] = useState<string | null>(null);
  const [contractFileName, setContractFileName] = useState<string | null>(null);
  const contractFileInputRef = useRef<HTMLInputElement>(null);
  const visibleIssues = issues.filter((issue) => matchesFilter(issue, filter));
  const count = (severity: QAIssueSeverity) => issues.filter((issue) => issue.severity === severity).length;
  const filters: Array<[QAFilter, string]> = [
    ["all", "Все"], ["error", "Ошибки"], ["warning", "Предупреждения"], ["network", "Сеть"],
    ["console", "Консоль"], ["performance", "Производительность"], ["dom", "DOM"],
    ["accessibility", "Доступность"], ["security", "Безопасность"], ["contract", "Контракт"],
  ];
  const suggestions = useMemo(() => { try { const document = parseOpenApiSpec(contractSpecText); return Object.entries(document.components?.schemas || {}).flatMap(([name, schema]) => contractTestSuggestions(schema).slice(0, 8).map((value) => `${name}: ${JSON.stringify(value)}`)).slice(0, 24); } catch { return []; } }, [contractSpecText]);
  const diff = useMemo(() => { try { return comparisonSpec.trim() && contractSpecText.trim() ? diffOpenApi(parseOpenApiSpec(contractSpecText), parseOpenApiSpec(comparisonSpec)) : []; } catch { return []; } }, [contractSpecText, comparisonSpec]);
  const loadContractFromUrl = useCallback(async () => {
    setContractUrlError(null);
    setContractUrlLoading(true);
    try {
      onContractSpecChange(await loadOpenApiSpecFromUrl(contractUrl));
    } catch (error) {
      setContractUrlError((error as Error).message);
    } finally {
      setContractUrlLoading(false);
    }
  }, [contractUrl, onContractSpecChange]);
  const loadContractFromFile = useCallback(async (file: File | undefined) => {
    setContractFileError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      setContractFileName(null);
      setContractFileError("Выберите JSON-файл со спецификацией OpenAPI 3.x.");
      return;
    }
    try {
      const text = await file.text();
      parseOpenApiSpec(text);
      onContractSpecChange(text);
      setContractFileName(file.name);
    } catch (error) {
      setContractFileName(null);
      setContractFileError(`Не удалось загрузить файл: ${(error as Error).message}`);
    } finally {
      if (contractFileInputRef.current) contractFileInputRef.current.value = "";
    }
  }, [onContractSpecChange]);

  return <section className="flex-1 overflow-auto p-3 space-y-3 bg-[var(--color-bg)]">
    <div className="rounded-xl p-3 border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-2"><div className="text-xs font-semibold tracking-wide">QA-ПРОВЕРКА</div><div className="flex items-center gap-1">{excludedRuleCount > 0 && <button type="button" onClick={onRestoreExcludedRules} className="px-2 py-1 rounded border border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">Вернуть исключённые ({excludedRuleCount})</button>}<button onClick={onRefreshDomChecks} disabled={domChecksLoading} className="px-2 py-1 rounded border border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)] disabled:opacity-50">{domChecksLoading ? "Проверяем страницу…" : "Проверить страницу"}</button></div></div>
      <div className="mt-2 flex gap-3 text-xs">
        <span className="text-red-600 flex items-center gap-1"><ServerCrash className="w-3.5 h-3.5" />{count("critical") + count("error")} Ошибки</span>
        <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{count("warning")} Предупреждения</span>
        <span className="text-blue-600 flex items-center gap-1"><Info className="w-3.5 h-3.5" />{count("info")} Информация</span>
      </div>
    </div>
    <div className="flex flex-wrap gap-1">
      {filters.map(([value, label]) => <button key={value} onClick={() => onFilterChange(value)} className={`px-2 py-1 rounded text-[11px] ${filter === value ? "bg-accent text-white" : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]"}`}>{label}</button>)}
    </div>
    <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <summary className="cursor-pointer text-xs font-medium">Проверка API-контракта</summary>
      <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">Загрузите OpenAPI 3.x JSON по URL, из файла или вставьте его вручную. Спецификация хранится только в локальном хранилище расширения.</p>
      <div className="mt-2 flex gap-1">
        <input type="url" value={contractUrl} onChange={(event) => setContractUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadContractFromUrl(); }} placeholder="https://api.example.com/openapi.json" className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-[10px]" />
        <button type="button" onClick={() => void loadContractFromUrl()} disabled={contractUrlLoading || !contractUrl.trim()} className="rounded border border-[var(--color-border)] px-2 text-[10px] text-[var(--color-text-muted)] disabled:opacity-50">{contractUrlLoading ? "Загрузка…" : "Загрузить URL"}</button>
      </div>
      {contractUrlError && <p className="mt-1 text-[10px] text-red-600">{contractUrlError}</p>}
      <div className="mt-2 flex items-center gap-2">
        <input ref={contractFileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => void loadContractFromFile(event.target.files?.[0])} />
        <button type="button" onClick={() => contractFileInputRef.current?.click()} className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1.5 text-[10px] text-[var(--color-text-muted)]"><FileUp className="h-3.5 w-3.5" />Загрузить JSON-файл</button>
        {contractFileName && <span className="truncate text-[10px] text-[var(--color-text-muted)]" title={contractFileName}>{contractFileName}</span>}
      </div>
      {contractFileError && <p className="mt-1 text-[10px] text-red-600">{contractFileError}</p>}
      <textarea value={contractSpecText} onChange={(event) => onContractSpecChange(event.target.value)} placeholder='{"openapi":"3.0.0","paths":{}}' className="mt-2 h-20 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-[10px]" />
      {contractError && <p className="mt-1 text-[10px] text-red-600">{contractError}</p>}
      {contractCoverage && <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">Покрытие API-контракта: {contractCoverage.exercised}/{contractCoverage.total} endpoints · проверено {contractCoverage.validated} · успешно {contractCoverage.passed} · ошибок {contractCoverage.failed}</p>}
      {suggestions.length > 0 && <details className="mt-2 text-[10px]"><summary>Детерминированные тестовые значения</summary><pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap">{suggestions.join("\n")}</pre></details>}
      <details className="mt-2 text-[10px]"><summary>Сравнение контрактов (текущий → сравниваемый)</summary><textarea value={comparisonSpec} onChange={(event) => setComparisonSpec(event.target.value)} placeholder="Вставьте сравниваемый OpenAPI 3.x JSON" className="mt-1 h-16 w-full rounded border border-border bg-bg p-1 font-mono" />{diff.length > 0 && <ul className="mt-1 list-disc pl-4">{diff.map((entry, index) => <li key={`${entry.message}:${index}`}>[{entry.severity}] {entry.message}</li>)}</ul>}</details>
    </details>
    <EnvironmentComparePanel sessions={sessions} onCompare={onCompareSessions} />
    <div className="grid grid-cols-3 gap-1"><button onClick={() => onExportSessionReport('md')} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 text-[10px] font-medium">Отчёт Markdown</button><button onClick={() => onExportSessionReport('html')} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 text-[10px] font-medium">Отчёт HTML</button><button onClick={() => onExportSessionReport('json')} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 text-[10px] font-medium">Отчёт JSON</button></div>
    {visibleIssues.length === 0 ? <div className="py-12 text-center text-xs text-[var(--color-text-muted)]">Для этого фильтра проблем не найдено.</div> : <div className="space-y-2">
      {visibleIssues.map((issue) => <article key={issue.id} className="w-full text-left p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex justify-between gap-2"><span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold ${severityStyle[issue.severity]}`}>{issue.severity}</span><span className="text-[10px] text-[var(--color-text-muted)]">{issue.category}</span></div>
        <div className="mt-2 text-xs font-semibold flex gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{issue.title}</div>
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{issue.description}</p>
        {typeof issue.evidence?.selector === "string" && <button type="button" onClick={() => onHighlightIssue(issue)} className="mt-2 inline-flex items-center gap-1 text-[10px] text-accent"><LocateFixed className="h-3 w-3" />{"\u041d\u0430\u0439\u0442\u0438 \u043d\u0430 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0435"}</button>}
        <div className="mt-2 flex gap-2 text-[10px] text-[var(--color-text-muted)]">
          <span>{new Date(issue.timestamp).toLocaleTimeString()}</span>
          {issue.url && <span className="truncate">{issue.url}</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1"><button onClick={() => issue.requestId && onOpenRequest(issue)} disabled={!issue.requestId} className="text-[10px] text-accent disabled:opacity-40">Открыть доказательство</button><button onClick={() => onCreateBugReport(issue)} className="text-[10px] text-accent">Создать баг-репорт</button><button type="button" onClick={() => onDismissIssue(issue)} className="text-[10px] text-[var(--color-text-muted)]">Удалить</button><button type="button" onClick={() => onExcludeRule(issue)} title="Не показывать больше предупреждения этого типа" className="text-[10px] text-amber-700 dark:text-amber-300">Исключить правило</button></div>
      </article>)}
    </div>}
  </section>;
}
