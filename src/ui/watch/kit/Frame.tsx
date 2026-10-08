import type { CSSProperties, HTMLAttributes, ReactElement, ReactNode } from 'react';
import { cx } from './roles';

export interface FrameProps extends HTMLAttributes<HTMLDivElement> {
  /** Smaller corner cut (menus, cards, plates). */
  size?: 'sm';
  /** Raised ground for panels stacked on top of panels. */
  raised?: boolean;
  /** Lifts a panel that floats over the battlefield with the panel shadow. */
  floating?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** The chamfered panel: top-left and bottom-right corners cut, a 1 px line-strong edge. */
export function Frame({ size, raised, floating, className, style, children, ...rest }: FrameProps): ReactElement {
  return (
    <div className={cx('aw-frame', size === 'sm' && 'aw-frame--sm', raised && 'aw-frame--raised', floating && 'aw-float', className)} style={style} {...rest}>
      <div className="aw-frame-in">{children}</div>
    </div>
  );
}
