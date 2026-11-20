import { Sparkles, X } from 'lucide-react';
import { t } from '../../locales';

interface WhatsNewDialogProps {
  version: string;
  onClose: () => void;
  /** Opens the command palette (the list mentions it). */
  onOpenPalette: () => void;
}

/** Highlights of the installed version, shown once after an update. */
export function WhatsNewDialog({ version, onClose, onOpenPalette }: WhatsNewDialogProps) {
  const items = t().whatsNewItems;
  return (
    <div className="flex max-h-[80vh] flex-col">
      <div className="flex justify-center pt-3 pb-2">
        <div className="h-1 w-10 rounded-full bg-border" />
      </div>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <h2 className="flex-1 text-sm font-semibold">{t().whatsNewTitle(version)}</h2>
        <button onClick={onClose} className="rounded p-1 text-text-muted hover:bg-hover hover:text-text" aria-label={t().close}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {items.map((item) => (
          <li key={item.title} className="text-xs">
            <p className="font-semibold">{item.title}</p>
            <p className="mt-0.5 text-text-muted">{item.text}</p>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button onClick={() => { onClose(); onOpenPalette(); }} className="flex-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-hover">
          {t().whatsNewTryPalette}
        </button>
        <button onClick={onClose} className="flex-1 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:opacity-90">
          {t().whatsNewOk}
        </button>
      </div>
    </div>
  );
}
