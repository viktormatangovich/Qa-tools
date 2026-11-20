import { Dialog } from '@base-ui-components/react/dialog';
import type { ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** Extra classes of the popup (most sheets are flex columns; the bug report is not). */
  flex?: boolean;
}

/** Bottom sheet used by every dialog of the side panel. */
export function Sheet({ open, onOpenChange, children, flex = true }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Popup className={`panel-dialog fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] rounded-t-2xl shadow-xl ${flex ? 'flex flex-col' : ''}`}>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
