import { useEffect, useRef, useState } from 'react';

export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', onCancel, onConfirm }: { open: boolean; title: string; children: React.ReactNode; confirmLabel?: string; onCancel: () => void; onConfirm: () => void }): JSX.Element | null {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) cancelRef.current?.focus(); }, [open]);
  if (!open) return null;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <h2 id="dialog-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions"><button ref={cancelRef} className="button button-secondary" type="button" onClick={onCancel}>Cancel</button><button className="button button-danger" type="button" onClick={onConfirm}>{confirmLabel}</button></div>
    </section>
  </div>;
}

export function useDisclosure(): { open: boolean; openDialog: () => void; closeDialog: () => void } {
  const [open, setOpen] = useState(false);
  return { open, openDialog: () => setOpen(true), closeDialog: () => setOpen(false) };
}
