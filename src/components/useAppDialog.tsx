'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

type DialogOptions = {
  title: string;
  description?: string;
  label?: string;
  defaultValue?: string;
  confirmLabel?: string;
  required?: boolean;
  maxLength?: number;
  expectedValue?: string;
  multiline?: boolean;
};
type DialogRequest = DialogOptions & { id: number };

function RequestDialog({ request, finish }: { request: DialogRequest; finish: (value: string | null) => void }) {
  const [value, setValue] = useState(request.defaultValue ?? '');
  const composing = useRef(false);
  const valid = (!request.required || !!value.trim()) &&
    (request.expectedValue === undefined || value === request.expectedValue);
  const field = {
    value, maxLength: request.maxLength, 'data-autofocus': true,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.target.value),
  };
  return <Modal title={request.title} close={() => finish(null)}>
    <form className="modal-form" onSubmit={e => {
      e.preventDefault();
      if (valid && !composing.current) finish(value);
    }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={e => {
        if (e.key === 'Enter' && (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) e.preventDefault();
      }}>
      {request.description && <p>{request.description}</p>}
      {request.label && <label>{request.label}{request.multiline ? <textarea {...field} rows={4} /> : <input {...field} autoComplete="off" />}</label>}
      <div className="dialog-actions">
        <button type="button" className="outline" onClick={() => finish(null)}>取消</button>
        <button type="submit" className="primary" disabled={!valid}>{request.confirmLabel || '确认'}</button>
      </div>
    </form>
  </Modal>;
}

/** Null means cancelled; confirming a dialog without a text field returns an empty string. */
export function useAppDialog() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const sequence = useRef(0);
  const pending = useRef<((value: string | null) => void) | null>(null);
  const ask = useCallback((options: DialogOptions) => new Promise<string | null>(resolve => {
    pending.current?.(null);
    pending.current = resolve;
    setRequest({ ...options, id: ++sequence.current });
  }), []);
  const finish = useCallback((value: string | null) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(value);
  }, []);
  useEffect(() => () => { pending.current?.(null); pending.current = null; }, []);
  return { ask, dialog: request ? <RequestDialog key={request.id} request={request} finish={finish} /> : null };
}
