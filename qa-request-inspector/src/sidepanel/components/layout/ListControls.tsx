import { BarChart3, FileSearch, FolderOpen, GitCompare, List, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../../locales';
import type { ResourceType, SortOption, SortPresetId } from '../../types';
import { SORT_PRESETS, type RequestFilter } from '../../utils/requestList';
import { FilterButton } from '../common/FilterButton';

/** Resource kinds offered as a filter when everything is captured, not only API calls. */
const TYPE_FILTERS: Array<'all' | 'api' | ResourceType> = ['all', 'api', 'document', 'script', 'stylesheet', 'image', 'font', 'media', 'other'];

export type ViewMode = 'list' | 'timeline' | 'grouped';

interface ListControlsProps {
  filter: RequestFilter;
  onFilterChange: (filter: RequestFilter) => void;
  counts: { errors: number; slow: number; console: number; qa: number };
  onOpenQa: () => void;
  showTypeFilter: boolean;
  typeFilter: 'all' | 'api' | ResourceType;
  onTypeFilterChange: (type: 'all' | 'api' | ResourceType) => void;
  urlFilter: string;
  onUrlFilterChange: (value: string) => void;
  bodySearch: string;
  onBodySearchChange: (value: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  sortBy: SortOption;
  onSortByChange: (sort: SortOption) => void;
  sortPreset: SortPresetId | '';
  onSortPresetChange: (preset: SortPresetId | '') => void;
  compareMode: boolean;
  onToggleCompare: () => void;
  compareSelected: number;
  onShowDiff: () => void;
}

const field = 'w-full pl-8 pr-8 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]';
const select = 'px-2 py-1 text-[10px] rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]';

function SearchField({ icon, value, onChange, placeholder, kind }: { icon: ReactNode; value: string; onChange: (value: string) => void; placeholder: string; kind: string }) {
  return (
    <div className="relative mt-2">
      {icon}
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} data-search={kind} className={field} />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={t().clear}>
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function ViewButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button onClick={onClick} title={title} className={`p-1.5 rounded transition-colors ${active ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
      {children}
    </button>
  );
}

/** Filter tabs, searches, view mode, sorting and the compare switch above the list. */
export function ListControls(props: ListControlsProps) {
  const { filter, onFilterChange, counts } = props;
  const icon = 'absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]';
  return (
    <>
      <div className="@container flex flex-wrap gap-1 p-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
        <FilterButton active={filter === 'all'} onClick={() => onFilterChange('all')}>{t().all}</FilterButton>
        <FilterButton active={filter === 'errors'} onClick={() => onFilterChange('errors')} count={counts.errors} isError>{t().errors}</FilterButton>
        <FilterButton active={filter === 'slow'} onClick={() => onFilterChange('slow')} count={counts.slow}>{t().slow}</FilterButton>
        <FilterButton active={filter === 'console'} onClick={() => onFilterChange('console')} count={counts.console} isError>{t().console}</FilterButton>
        <FilterButton active={filter === 'qa'} onClick={props.onOpenQa} count={counts.qa} isError>{t().qaCheck}</FilterButton>
      </div>

      {props.showTypeFilter && (
        <div className="mt-2 flex flex-wrap gap-1">
          {TYPE_FILTERS.map((type) => (
            <button
              key={type}
              onClick={() => props.onTypeFilterChange(type)}
              className={`px-2 py-0.5 rounded text-[10px] ${props.typeFilter === type
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
            >
              {type === 'all' ? t().all : type === 'api' ? 'XHR / Fetch' : t().resourceTypeLabels[type]}
            </button>
          ))}
        </div>
      )}

      <SearchField icon={<Search className={icon} />} value={props.urlFilter} onChange={props.onUrlFilterChange} placeholder={t().filterByUrl} kind="url" />
      <SearchField icon={<FileSearch className={icon} />} value={props.bodySearch} onChange={props.onBodySearchChange} placeholder={t().searchInBody} kind="body" />

      <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
        <div className="flex gap-1 p-0.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)]">
          <ViewButton active={props.viewMode === 'list'} onClick={() => props.onViewModeChange('list')} title={t().listView}><List className="w-3.5 h-3.5" /></ViewButton>
          <ViewButton active={props.viewMode === 'timeline'} onClick={() => props.onViewModeChange('timeline')} title={t().timelineView}><BarChart3 className="w-3.5 h-3.5" /></ViewButton>
          <ViewButton active={props.viewMode === 'grouped'} onClick={() => props.onViewModeChange('grouped')} title={t().groupByDomain}><FolderOpen className="w-3.5 h-3.5" /></ViewButton>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <select value={props.sortBy} onChange={(event) => props.onSortByChange(event.target.value as SortOption)} className={select} title={t().sortBy}>
            <option value="newest">{t().sortNewest}</option>
            <option value="oldest">{t().sortOldest}</option>
            <option value="method">{t().sortByMethod}</option>
            <option value="status">{t().sortByStatus}</option>
            <option value="duration">{t().sortByDuration}</option>
            <option value="type">{t().sortByType}</option>
            <option value="domain">{t().sortByDomain}</option>
          </select>
          <select value={props.sortPreset} onChange={(event) => props.onSortPresetChange(event.target.value as SortPresetId | '')} className={select} title={t().sortPresets}>
            <option value="">{t().sortPresets}</option>
            {SORT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{t()[preset.labelKey] as string}</option>)}
          </select>
          <button
            onClick={props.onToggleCompare}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${props.compareMode ? 'bg-blue-500 text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-hover)]'}`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            {props.compareMode ? t().exitCompare : t().compare}
          </button>
        </div>
      </div>

      {props.compareMode && (
        <div className="mt-2 p-2 rounded-lg bg-blue-50 border border-blue-200 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-blue-700">{t().selectToCompare(props.compareSelected)}</span>
            {props.compareSelected === 2 && (
              <button onClick={props.onShowDiff} className="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">{t().viewDiff}</button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
