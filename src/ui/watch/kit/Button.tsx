import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { cx } from './roles';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one action that advances; secondary is the default. */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  /** Keyboard hint drawn as a key cap, e.g. "Space". */
  hotkey?: string;
}

export function Button({ variant = 'secondary', size = 'md', hotkey, className, children, type = 'button', ...rest }: ButtonProps): ReactElement {
  return (
    <button type={type} className={cx('aw-btn', 'label', `aw-btn--${variant}`, size === 'sm' && 'aw-btn--sm', className)} {...rest}>
      <span className="aw-btn-label">{children}</span>
      {hotkey && <kbd className="aw-key">{hotkey}</kbd>}
    </button>
  );
}
