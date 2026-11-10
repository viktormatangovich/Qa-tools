import { AlertCircle, AlertTriangle, FileUp, Info, LocateFixed, ServerCrash } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { QAIssue, QAIssueCategory, QAIssueSeverity } from "../../qa";
import { EnvironmentComparePanel } from "./EnvironmentComparePanel";
import type { EnvironmentDifference } from "../../qa/environmentCompare";
import { bundleExternalRefs, hasExternalRefs, loadOpenApiSpecFromUrl, parseOpenApiSpec, unsupportedContractFeatures } from "../../qa/contract/contractChecker";
import { t } from "../../locales";
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
  const [refsLoading, setRefsLoading] = useState(false);
  const [refsNote, setRefsNote] = useState<string | null>(null);
  const [refWarnings, setRefWarnings] = useState<string[]>([]);
  const externalRefs = useMemo(() => { try { return hasExternalRefs(parseOpenApiSpec(contractSpecText)); } catch { return false; } }, [contractSpecText]);
  /** Downloads the documents behind external $refs and stores the specification with them inlined. */
  const loadExternalRefs = useCallback(async (text: string, baseUrl?: string) => {
    setRefsLoading(true);
    setRefsNote(null);
    try {
      const bundled = await bundleExternalRefs(text, baseUrl);
      setRefWarnings(bundled.warnings);
      if (bundled.loaded) setRefsNote(t().bundleRefsDone(bundled.loaded));
      return bundled.text;
    } catch (error) {
      setRefWarnings([(error as Error).message]);
      return text;
    } finally {
      setRefsLoading(false);
    }
  }, []);
  const unsupported = useMemo(() => { try { return unsupportedContractFeatures(parseOpenApiSpec(contractSpecText)); } catch { return []; } }, [contractSpecText]);
  const visibleIssues = issues.filter((issue) => matchesFilter(issue, filter));
  const count = (severity: QAIssueSeverity) => issues.filter((issue) => issue.severity === severity).length;
  const filters = Object.entries(t().qaFilterLabels) as Array<[QAFilter, string]>;
  const suggestions = useMemo(() => { try { const document = parseOpenApiSpec(contractSpecText); return Object.entries(document.components?.schemas || {}).flatMap(([name, schema]) => contractTestSuggestions(schema).slice(0, 8).map((value) => `${name}: ${JSON.stringify(value)}`)).slice(0, 24); } catch { return []; } }, [contractSpecText]);
  const diff = useMemo(() => { try { return comparisonSpec.trim() && contractSpecText.trim() ? diffOpenApi(parseOpenApiSpec(contractSpecText), parseOpenApiSpec(comparisonSpec)) : []; } catch { return []; } }, [contractSpecText, comparisonSpec]);
  const loadContractFromUrl = useCallback(async () => {
    setContractUrlError(null);
    setContractUrlLoading(true);
    try {
      // Relative references are resolved against the address the specification came from.
      onContractSpecChange(await loadExternalRefs(await loadOpenApiSpecFromUrl(contractUrl), contractUrl.trim()));
    } catch (error) {
      setContractUrlError((error as Error).message);
    } finally {
      setContractUrlLoading(false);
    }
  }, [contractUrl, onContractSpecChange, loadExternalRefs]);
  const loadContractFromFile = useCallback(async (file: File | undefined) => {
    setContractFileError(null);
    if (!file) return;
    if (! /\.(json|ya?ml)$/i.test(file.name) && file.type !== "application/json") {
      setContractFileName(null);
      setContractFileError(t().contractFileRequired);
      return;
    }
    try {
      const text = await file.text();
      parseOpenApiSpec(text);
      onContractSpecChange(text);
      setContractFileName(file.name);
    } catch (error) {
      setContractFileName(null);
      setContractFileError(t().contractFileFailed((error as Error).message));
    } finally {
      if (contractFileInputRef.current) contractFileInputRef.current.value = "";
    }
  }, [onContractSpecChange]);

  return <section className="flex-1 overflow-auto p-3 space-y-3 bg-[var(--color-bg)]">
    <div className="rounded-xl p-3 border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-2"><div className="text-xs font-semibold tracking-wide">{t().qaCheckHeading}</div><div className="flex items-center gap-1">{excludedRuleCount > 0 && <button type="button" onClick={onRestoreExcludedRules} className="px-2 py-1 rounded border border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">{t().restoreExcluded(excludedRuleCount)}</button>}<button onClick={onRefreshDomChecks} disabled={domChecksLoading} className="px-2 py-1 rounded border border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)] disabled:opacity-50">{domChecksLoading ? t().checkingPage : t().checkPage}</button></div></div>
      <div className="mt-2 flex gap-3 text-xs">
        <span className="text-red-600 flex items-center gap-1"><ServerCrash className="w-3.5 h-3.5" />{count("critical") + count("error")} {t().errors}</span>
        <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{count("warning")} {t().qaFilterLabels.warning}</span>
        <span className="text-blue-600 flex items-center gap-1"><Info className="w-3.5 h-3.5" />{count("info")} {t().qaSeverityLabels.info}</span>
      </div>
    </div>
    <div className="flex flex-wrap gap-1">
      {filters.map(([value, label]) => <button key={value} onClick={() => onFilterChange(value)} className={`px-2 py-1 rounded text-[11px] ${filter === value ? "bg-accent text-white" : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]"}`}>{label}</button>)}
    </div>
    <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <summary className="cursor-pointer text-xs font-medium">{t().contractCheckTitle}</summary>
      <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">{t().contractCheckHint}</p>
      <div className="mt-2 flex gap-1">
        <input type="url" value={contractUrl} onChange={(event) => setContractUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadContractFromUrl(); }} placeholder="https://api.example.com/openapi.json" className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-[10px]" />
        <button type="button" onClick={() => void loadContractFromUrl()} disabled={contractUrlLoading || !contractUrl.trim()} className="rounded border border-[var(--color-border)] px-2 text-[10px] text-[var(--color-text-muted)] disabled:opacity-50">{contractUrlLoading ? t().loadingEllipsis : t().loadUrl}</button>
      </div>
      {contractUrlError && <p className="mt-1 text-[10px] text-red-600">{contractUrlError}</p>}
      <div className="mt-2 flex items-center gap-2">
        <input ref={contractFileInputRef} type="file" accept=".json,.yaml,.yml,application/json" className="hidden" onChange={(event) => void loadContractFromFile(event.target.files?.[0])} />
        <button type="button" onClick={() => contractFileInputRef.current?.click()} className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1.5 text-[10px] text-[var(--color-text-muted)]"><FileUp className="h-3.5 w-3.5" />{t().loadSpecFile}</button>
        {contractFileName && <span className="truncate text-[10px] text-[var(--color-text-muted)]" title={contractFileName}>{contractFileName}</span>}
      </div>
      {contractFileError && <p className="mt-1 text-[10px] text-red-600">{contractFileError}</p>}
      <textarea value={contractSpecText} onChange={(event) => onContractSpecChange(event.target.value)} placeholder='{"openapi":"3.0.0","paths":{}}' className="mt-2 h-20 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-[10px]" />
      {contractError && <p className="mt-1 text-[10px] text-red-600">{contractError}</p>}
      {externalRefs && <button type="button" disabled={refsLoading} onClick={() => void loadExternalRefs(contractSpecText, contractUrl.trim() || undefined).then(onContractSpecChange)} className="mt-1 rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] disabled:opacity-50">{refsLoading ? t().bundleRefsLoading : t().bundleRefs}</button>}
      {refsNote && <p role="status" className="mt-1 text-[10px] text-[var(--color-text-muted)]">{refsNote}</p>}
      {refWarnings.length > 0 && <ul className="mt-1 list-disc pl-4 text-[10px] text-amber-700">{refWarnings.map((warning) => <li className="break-all" key={warning}>{warning}</li>)}</ul>}
      {contractCoverage && <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{t().contractCoverageLine(contractCoverage)}</p>}
      {suggestions.length > 0 && <details className="mt-2 text-[10px]"><summary>{t().deterministicValues}</summary><pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap">{suggestions.join("\n")}</pre></details>}
      <details className="mt-2 text-[10px]"><summary>{t().contractDiffTitle}</summary><textarea value={comparisonSpec} onChange={(event) => setComparisonSpec(event.target.value)} placeholder={t().contractDiffPlaceholder} className="mt-1 h-16 w-full rounded border border-border bg-bg p-1 font-mono" />{diff.length > 0 && <ul className="mt-1 list-disc pl-4">{diff.map((entry, index) => <li key={`${entry.message}:${index}`}>[{entry.severity === "breaking" ? t().breakingChange : t().compatibleChange}] {entry.message}</li>)}</ul>}</details>
    </details>
    <p className="text-xs">{t().contractSupportNote}</p>
    {unsupported.length > 0 && <details className="text-xs text-amber-700"><summary>{t().unsupportedChecks(unsupported.length)}</summary>{unsupported.map(text => <p className="break-all" key={text}>{text}</p>)}</details>}
    <EnvironmentComparePanel sessions={sessions} onCompare={onCompareSessions} />
    <div className="grid grid-cols-3 gap-1"><button onClick={() => onExportSessionReport('md')} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 text-[10px] font-medium">{t().reportMarkdown}</button><button onClick={() => onExportSessionReport('html')} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 text-[10px] font-medium">{t().reportHtml}</button><button onClick={() => onExportSessionReport('json')} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 text-[10px] font-medium">{t().reportJson}</button></div>
    {visibleIssues.length === 0 ? <div className="py-12 text-center text-xs text-[var(--color-text-muted)]">{t().noIssuesForFilter}</div> : <div className="space-y-2">
      {visibleIssues.map((issue) => <article key={issue.id} className="w-full text-left p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex justify-between gap-2"><span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold ${severityStyle[issue.severity]}`}>{t().qaSeverityLabels[issue.severity]}</span><span className="text-[10px] text-[var(--color-text-muted)]">{t().qaCategoryLabels[issue.category]}</span></div>
        <div className="mt-2 text-xs font-semibold flex gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{issue.title}</div>
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{issue.description}</p>
        {typeof issue.evidence?.selector === "string" && <button type="button" onClick={() => onHighlightIssue(issue)} className="mt-2 inline-flex items-center gap-1 text-[10px] text-accent"><LocateFixed className="h-3 w-3" />{t().findOnPage}</button>}
        <div className="mt-2 flex gap-2 text-[10px] text-[var(--color-text-muted)]">
          <span>{new Date(issue.timestamp).toLocaleTimeString()}</span>
          {issue.url && <span className="truncate">{issue.url}</span>}
          {typeof issue.evidence?.helpUrl === "string" && <a href={issue.evidence.helpUrl} target="_blank" rel="noreferrer" className="shrink-0 text-accent underline">{t().axeRuleHelp}</a>}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1"><button onClick={() => issue.requestId && onOpenRequest(issue)} disabled={!issue.requestId} className="text-[10px] text-accent disabled:opacity-40">{t().openEvidence}</button><button onClick={() => onCreateBugReport(issue)} className="text-[10px] text-accent">{t().createBugReport}</button><button type="button" onClick={() => onDismissIssue(issue)} className="text-[10px] text-[var(--color-text-muted)]">{t().delete}</button><button type="button" onClick={() => onExcludeRule(issue)} title={t().excludeRuleHint} className="text-[10px] text-amber-700 dark:text-amber-300">{t().excludeRule}</button></div>
      </article>)}
    </div>}
  </section>;
}
