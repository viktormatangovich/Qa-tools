import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../locales';
import type { QAIssue } from '../qa';
import { maskRequest, maskRequests } from '../qa/masking';
import { createSessionReport, createSessionReportHtml, createSessionReportJson } from '../qa/report';
import type { ApiRequest, ConsoleError, RequestMeta } from '../types';
import { downloadFile, today } from '../utils/download';
import { generateBulkCurl, generateCsv, generateJsonSchema, generateOpenApiSpec } from '../utils/exporters';
import { generateClaudePrompt, generateHar, generateMarkdownReport, generatePostmanCollection } from '../utils/generators';

/** Copies the user's notes into the requests, so exports and saved sessions carry them. */
export function withNotes(list: ApiRequest[], requestMeta: Record<string, RequestMeta>): ApiRequest[] {
  return list.map((request) => {
    const note = requestMeta[request.id]?.notes;
    return note && note !== request.note ? { ...request, note } : request;
  });
}

interface ExportSources {
  requests: ApiRequest[];
  consoleErrors: ConsoleError[];
  qaIssues: QAIssue[];
  requestMeta: Record<string, RequestMeta>;
  maskSecretsOnExport: boolean;
}

/**
 * Every file the panel produces. Everything that leaves the browser goes through `forExport`:
 * notes are added and credentials are masked unless masking is switched off in the settings.
 */
export function useExports({ requests, consoleErrors, qaIssues, requestMeta, maskSecretsOnExport }: ExportSources) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const forExport = useCallback(
    (list: ApiRequest[]) => maskRequests(withNotes(list, requestMeta), maskSecretsOnExport),
    [requestMeta, maskSecretsOnExport],
  );
  const requestForExport = useCallback(
    (request: ApiRequest | undefined) => (request ? forExport([request])[0] : undefined),
    [forExport],
  );

  const exportSessionReport = useCallback((format: 'md' | 'html' | 'json') => {
    const exported = forExport(requests);
    const report = format === 'md'
      ? createSessionReport(exported, consoleErrors, qaIssues)
      : format === 'html'
        ? createSessionReportHtml(exported, consoleErrors, qaIssues)
        : createSessionReportJson(exported, consoleErrors, qaIssues);
    const contentType = format === 'md' ? 'text/markdown' : format === 'html' ? 'text/html' : 'application/json';
    downloadFile(`qa-session-report-${today()}.${format}`, report, contentType);
  }, [forExport, requests, consoleErrors, qaIssues]);

  const exportToPostman = useCallback(() => {
    downloadFile(`reqpane-${today()}.postman_collection.json`, JSON.stringify(generatePostmanCollection(forExport(requests)), null, 2), 'application/json');
  }, [forExport, requests]);

  const exportToHar = useCallback(() => {
    downloadFile(`reqpane-${today()}.har`, JSON.stringify(generateHar(forExport(requests)), null, 2), 'application/json');
  }, [forExport, requests]);

  const exportToMarkdown = useCallback(() => {
    const exported = forExport(requests);
    const pageInfo = exported.length > 0
      ? { url: exported[0].pageUrl, title: exported[0].pageTitle }
      : { url: t().unknown, title: t().unknown };
    downloadFile(`api-report-${today()}.md`, generateMarkdownReport(exported, consoleErrors, pageInfo), 'text/markdown');
  }, [forExport, requests, consoleErrors]);

  const exportToOpenApi = useCallback(() => {
    downloadFile(`openapi-${today()}.json`, generateOpenApiSpec(forExport(requests)), 'application/json');
  }, [forExport, requests]);

  const exportToJsonSchema = useCallback((request: ApiRequest | null) => {
    if (!request?.responseBody) return;
    downloadFile(`json-schema-${today()}.json`, generateJsonSchema(request.responseBody), 'application/json');
  }, []);

  const exportToCsv = useCallback(() => {
    downloadFile(`api-export-${today()}.csv`, generateCsv(forExport(requests)), 'text/csv');
  }, [forExport, requests]);

  const exportToBulkCurl = useCallback(() => {
    downloadFile(`curl-collection-${today()}.sh`, generateBulkCurl(forExport(requests)), 'text/plain');
  }, [forExport, requests]);

  const exportSelected = useCallback((ids: Set<string>) => {
    const selected = requests.filter((request) => ids.has(request.id));
    if (selected.length === 0) return;
    downloadFile(`selected-curl-${today()}.sh`, generateBulkCurl(forExport(selected)), 'text/plain');
  }, [forExport, requests]);

  const copyPrompt = useCallback(async (request: ApiRequest) => {
    const [prepared] = withNotes([request], requestMeta);
    await navigator.clipboard.writeText(generateClaudePrompt(maskSecretsOnExport ? maskRequest(prepared) : prepared));
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [maskSecretsOnExport, requestMeta]);

  return {
    copied, forExport, requestForExport, copyPrompt,
    exportSessionReport, exportToPostman, exportToHar, exportToMarkdown, exportToOpenApi,
    exportToJsonSchema, exportToCsv, exportToBulkCurl, exportSelected,
  };
}
