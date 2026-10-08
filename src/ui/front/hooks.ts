// Small React hooks the front door shares.
import { useEffect, useState } from 'react';

/** Whether the viewer asked for less motion. Live: it follows the system setting while the page is open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = (): void => setReduced(q.matches);
    on();
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Sets the page's title while a screen is up. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
