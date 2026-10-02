'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const stack: HTMLElement[] = [];
function updateStack() {
  stack.forEach((modal, index) => {
    modal.inert = index !== stack.length - 1;
    // Newly opened dialogs can occur earlier in the React tree than their parent.
    if (modal.parentElement) modal.parentElement.style.zIndex = String(50 + index);
  });
}

export function Modal({ title, children, close }: {
  title: string; children: React.ReactNode; close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);
  useEffect(() => {
    const modal = ref.current!;
    const old = document.activeElement as HTMLElement | null;
    stack.push(modal);
    updateStack();
    // Only set focus on mount; typing must not restart the focus lifecycle.
    (modal.querySelector<HTMLElement>('[data-autofocus]') || modal).focus();
    const onKey = (e: KeyboardEvent) => {
      // Only the top dialog handles keys. IME cancellation belongs to the input method.
      if (stack.at(-1) !== modal || e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const items = [...modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"]',
        )].filter(el => el.getClientRects().length > 0 && !el.closest('[inert]'));
        const first = items[0], last = items.at(-1);
        if (!first || !last) { e.preventDefault(); modal.focus(); return; }
        if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const wasTop = stack.at(-1) === modal;
      stack.splice(stack.indexOf(modal), 1);
      updateStack();
      const top = stack.at(-1);
      if (wasTop) {
        if (old?.isConnected && (!top || top.contains(old))) old.focus();
        else top?.focus();
      }
    };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="modal">
      <header><h2>{title}</h2><button type="button" className="icon" onClick={close} aria-label="关闭"><X size={20} /></button></header>
      {children}
    </div>
  </div>;
}
