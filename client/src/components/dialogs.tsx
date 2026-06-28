import { useState } from 'react';

// Shared in-system dialogs that replace the browser's native (ugly "localhost says")
// window.confirm / window.alert / window.prompt. They reuse the classic .rmodal styling.

// Yes/no confirmation.
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel, pending }: {
  title: string; message: string; confirmLabel: string; cancelLabel?: string;
  onConfirm: () => void; onCancel: () => void; pending?: boolean;
}) {
  return (
    <div className="rmodal-backdrop" onClick={onCancel}>
      <div className="rmodal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="rmodal-head">
          <h3>{title}</h3>
          <button className="rmodal-x" type="button" onClick={onCancel}>×</button>
        </div>
        <div className="rmodal-body">
          <p style={{ margin: '0 0 4px', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{message}</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-cancel btn-sm" onClick={onCancel}>{cancelLabel}</button>
            <button type="button" className="btn btn-save btn-sm" disabled={pending} onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Reason / text input (replaces window.prompt). onSubmit receives the typed text.
export function PromptDialog({ title, message, placeholder, confirmLabel, pending, onSubmit, onCancel }: {
  title: string; message?: string; placeholder?: string; confirmLabel: string; pending?: boolean;
  onSubmit: (value: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="rmodal-backdrop" onClick={onCancel}>
      <div className="rmodal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="rmodal-head">
          <h3>{title}</h3>
          <button className="rmodal-x" type="button" onClick={onCancel}>×</button>
        </div>
        <div className="rmodal-body">
          <form onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
            {message && <p style={{ margin: '0 0 10px', lineHeight: 1.5 }}>{message}</p>}
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              autoFocus
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem' }}
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel btn-sm" onClick={onCancel}>Cancel</button>
              <button type="submit" className="btn btn-save btn-sm" disabled={pending}>{confirmLabel}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// Success / error feedback (replaces window.alert).
export function NoticeDialog({ tone, message, onClose }: { tone: 'ok' | 'err'; message: string; onClose: () => void }) {
  return (
    <div className="rmodal-backdrop" onClick={onClose}>
      <div className="rmodal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="rmodal-head">
          <h3>{tone === 'ok' ? 'Tagumpay' : 'May Problema'}</h3>
          <button className="rmodal-x" type="button" onClick={onClose}>×</button>
        </div>
        <div className="rmodal-body">
          <p style={{ margin: '0 0 4px', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{message}</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-save btn-sm" onClick={onClose}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}
