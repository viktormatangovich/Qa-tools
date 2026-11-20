import { Command, CornerDownLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../locales';
import type { ApiRequest } from '../../types';
import { rankByQuery } from '../../utils/fuzzy';

export interface PaletteCommand {
  id: string;
  label: string;
  section: string;
  /** Extra words the command is found by (English names, synonyms). */
  keywords?: string;
  /** Keyboard shortcut shown on the right. */
  shortcut?: string;
  run: () => void;
}

type Result = { kind: 'command'; command: PaletteCommand } | { kind: 'request'; request: ApiRequest };

const MAX_REQUESTS = 8;

function requestText(request: ApiRequest): string {
  return `${request.method} ${request.url} ${request.graphql?.operationName ?? ''} ${request.status}`;
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  requests: ApiRequest[];
  onOpenRequest: (request: ApiRequest) => void;
  onClose: () => void;
}

/** Ctrl+K: every action of the panel and the captured requests behind one search field. */
export function CommandPalette({ commands, requests, onOpenRequest, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo<Result[]>(() => {
    const matchedCommands = rankByQuery(query, commands, (command) => `${command.label} ${command.section} ${command.keywords ?? ''}`, 40)
      .map((command): Result => ({ kind: 'command', command }));
    if (!query.trim()) return matchedCommands;
    const matchedRequests = rankByQuery(query, requests, requestText, MAX_REQUESTS)
      .map((request): Result => ({ kind: 'request', request }));
    // A query that looks like a path or a method finds requests first.
    return /[/?=]|^(get|post|put|patch|delete)\b|^\d{3}$/i.test(query.trim())
      ? [...matchedRequests, ...matchedCommands]
      : [...matchedCommands, ...matchedRequests];
  }, [query, commands, requests]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (result: Result | undefined) => {
    if (!result) return;
    onClose();
    if (result.kind === 'command') result.command.run();
    else onOpenRequest(result.request);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  let lastSection = '';
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-2 pt-12" onMouseDown={onClose} role="presentation">
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={t().paletteTitle}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 text-text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t().palettePlaceholder}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="reqpane-palette-list"
            aria-activedescendant={results[active] ? `palette-${active}` : undefined}
          />
          <kbd className="rounded border border-border px-1 text-[10px] text-text-muted">Esc</kbd>
        </div>
        <ul ref={listRef} id="reqpane-palette-list" role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
          {results.length === 0 && <li className="px-3 py-4 text-center text-xs text-text-muted">{t().paletteNothing}</li>}
          {results.map((result, index) => {
            const section = result.kind === 'command' ? result.command.section : t().paletteRequests;
            const header = section !== lastSection ? section : null;
            lastSection = section;
            return (
              <li key={result.kind === 'command' ? result.command.id : `r:${result.request.id}`}>
                {header && <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{header}</div>}
                <button
                  id={`palette-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(result)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${index === active ? 'bg-accent-light' : ''}`}
                >
                  {result.kind === 'command' ? (
                    <>
                      <Command className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                      <span className="flex-1 truncate">{result.command.label}</span>
                      {result.command.shortcut && <kbd className="rounded border border-border px-1 text-[10px] text-text-muted">{result.command.shortcut}</kbd>}
                    </>
                  ) : (
                    <>
                      <span className="w-12 shrink-0 font-mono text-[10px] font-semibold text-accent">{result.request.method}</span>
                      <span className={`shrink-0 text-[10px] ${result.request.status >= 400 || result.request.status === 0 ? 'text-red-600' : 'text-emerald-600'}`}>{result.request.status || 'ERR'}</span>
                      <span className="flex-1 truncate font-mono">{result.request.graphql?.operationName ?? shortUrl(result.request.url)}</span>
                    </>
                  )}
                  {index === active && <CornerDownLeft className="h-3 w-3 shrink-0 text-text-muted" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
