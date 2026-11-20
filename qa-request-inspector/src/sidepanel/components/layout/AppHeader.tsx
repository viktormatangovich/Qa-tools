import {
  Bookmark, CheckSquare, Command, Crosshair, Download, FileJson, FileSpreadsheet, FileText, History, Pause, Radio,
  ScrollText, Settings, Shield, Tag, Terminal, Upload,
} from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../../locales';
import type { CaptureSettings } from '../../types';

export type HeaderDialog = 'breakpoints' | 'mocks' | 'collections' | 'tags' | 'sessions' | 'settings';

export interface ExportMenuActions {
  har: () => void;
  postman: () => void;
  markdown: () => void;
  openApi: () => void;
  csv: () => void;
  bulkCurl: () => void;
  /** Present only when the selected request has a response body. */
  jsonSchema?: () => void;
  saveSession: () => void;
  importHar: (file: File | undefined) => void;
}

interface AppHeaderProps {
  debuggerStatus: string;
  debuggerError: string | null;
  requestCount: number;
  throttle: CaptureSettings['throttle'];
  recording: boolean;
  recordedSteps: number;
  onStopRecording: () => void;
  picking: boolean;
  onPickElement: () => void;
  activeBreakpoints: number;
  activeMocks: number;
  preserveLog: boolean;
  onTogglePreserveLog: () => void;
  autoSelect: boolean;
  onToggleAutoSelect: () => void;
  groupSelectionMode: boolean;
  onToggleGroupSelection: () => void;
  onOpen: (dialog: HeaderDialog) => void;
  onOpenPalette: () => void;
  onClear: () => void;
  exports: ExportMenuActions;
  exportMenuOpen: boolean;
  onExportMenuOpenChange: (open: boolean) => void;
}

const idle = 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]';

function ToolButton({ active, activeClass = 'bg-[var(--color-accent)] text-white', title, onClick, children, pressed }: {
  active?: boolean; activeClass?: string; title: string; onClick: () => void; children: ReactNode; pressed?: boolean;
}) {
  return (
    <button onClick={onClick} className={`p-1.5 rounded transition-colors ${active ? activeClass : idle}`} title={title} aria-pressed={pressed}>
      {children}
    </button>
  );
}

function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full px-3 py-2 text-xs text-left hover:bg-[var(--color-hover)] flex items-center gap-2">
      {icon} {label}
    </button>
  );
}

/** Title, capture status and the toolbar of the panel. */
export function AppHeader(props: AppHeaderProps) {
  const { exports, exportMenuOpen, onExportMenuOpenChange } = props;
  const harInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // A click outside closes the export menu.
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onExportMenuOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportMenuOpen, onExportMenuOpenChange]);

  const run = (action: () => void) => () => {
    action();
    onExportMenuOpenChange(false);
  };

  const icon = 'w-3.5 h-3.5';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-[var(--color-accent)] rounded-lg flex items-center justify-center">
          <Terminal className="w-4 h-4 text-white" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-base font-semibold">{t().appTitle}</h1>
          <p className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${props.debuggerStatus === 'attached' ? 'bg-green-500' : props.debuggerStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
            {props.debuggerStatus === 'attached'
              ? t().requestsCount(props.requestCount)
              : props.debuggerStatus === 'error'
                ? (props.debuggerError || t().cannotCapture)
                : t().notCapturing}
            {props.throttle !== 'none' && (
              <span className="ml-1 rounded bg-amber-100 px-1 text-amber-700" title={t().throttling}>{t().throttleLabels[props.throttle]}</span>
            )}
            {props.recording && (
              <button onClick={props.onStopRecording} className="ml-1 rounded bg-red-500 px-1 text-white" title={t().stopRecording(props.recordedSteps)}>● REC {props.recordedSteps}</button>
            )}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <ToolButton onClick={props.onOpenPalette} title={t().paletteButton}>
          <Command className={icon} />
        </ToolButton>
        <ToolButton active={props.picking} activeClass="bg-[var(--color-accent)] text-white animate-pulse" onClick={props.onPickElement} title={props.picking ? t().pickElementActive : t().pickElement} pressed={props.picking}>
          <Crosshair className={icon} />
        </ToolButton>
        <ToolButton active={props.activeBreakpoints > 0} activeClass="bg-red-500 text-white" onClick={() => props.onOpen('breakpoints')} title={t().breakpointsActive(props.activeBreakpoints)}>
          <Pause className={icon} />
        </ToolButton>
        <ToolButton active={props.activeMocks > 0} activeClass="bg-purple-500 text-white" onClick={() => props.onOpen('mocks')} title={t().mockRulesActive(props.activeMocks)}>
          <Shield className={icon} />
        </ToolButton>
        <ToolButton active={props.preserveLog} onClick={props.onTogglePreserveLog} title={props.preserveLog ? t().preserveLogOn : t().preserveLogOff} pressed={props.preserveLog}>
          <ScrollText className={icon} />
        </ToolButton>
        <ToolButton active={props.autoSelect} onClick={props.onToggleAutoSelect} title={props.autoSelect ? t().autoSelectOn : t().autoSelectOff}>
          <Radio className={icon} />
        </ToolButton>
        <ToolButton onClick={() => props.onOpen('collections')} title={t().collections}><Bookmark className={icon} /></ToolButton>
        <ToolButton onClick={() => props.onOpen('tags')} title={t().tags}><Tag className={icon} /></ToolButton>
        <ToolButton onClick={() => props.onOpen('sessions')} title={t().sessionHistory}><History className={icon} /></ToolButton>
        <ToolButton onClick={() => props.onOpen('settings')} title={t().settings}><Settings className={icon} /></ToolButton>
        <div className="relative" ref={menuRef}>
          <ToolButton onClick={() => onExportMenuOpenChange(!exportMenuOpen)} title={t().exportOptions}>
            <Download className={icon} />
          </ToolButton>
          {exportMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-50 py-1 min-w-[200px] max-h-[70vh] overflow-y-auto">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t().exportOptions}</div>
              <MenuItem icon={<Download className={icon} />} label={t().exportAsHar} onClick={run(exports.har)} />
              <MenuItem icon={<FileJson className={icon} />} label={t().exportToPostman} onClick={run(exports.postman)} />
              <MenuItem icon={<FileText className={icon} />} label={t().markdownReport} onClick={run(exports.markdown)} />
              <MenuItem icon={<FileJson className={icon} />} label={t().exportOpenApi} onClick={run(exports.openApi)} />
              <MenuItem icon={<FileSpreadsheet className={icon} />} label={t().exportCsv} onClick={run(exports.csv)} />
              <MenuItem icon={<Terminal className={icon} />} label={t().exportBulkCurl} onClick={run(exports.bulkCurl)} />
              {exports.jsonSchema && <MenuItem icon={<FileJson className={icon} />} label={t().exportJsonSchema} onClick={run(exports.jsonSchema)} />}
              <hr className="my-1 border-[var(--color-border)]" />
              <MenuItem icon={<History className={icon} />} label={t().saveSession} onClick={exports.saveSession} />
              <hr className="my-1 border-[var(--color-border)]" />
              <MenuItem icon={<Upload className={icon} />} label={t().importHar} onClick={() => harInput.current?.click()} />
            </div>
          )}
        </div>
        <input
          ref={harInput}
          type="file"
          accept=".har,.json,application/json"
          className="hidden"
          onChange={(event) => {
            exports.importHar(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <ToolButton active={props.groupSelectionMode} onClick={props.onToggleGroupSelection} title={t().groupOperations}>
          <CheckSquare className={icon} />
        </ToolButton>
        <button onClick={props.onClear} className="px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)] rounded transition-colors">
          {t().clear}
        </button>
      </div>
    </div>
  );
}
