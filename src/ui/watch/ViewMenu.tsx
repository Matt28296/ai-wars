// The one quiet "View" menu on the bar (G18, D-023): the switches that used to sit in a row above the board. It holds the very same viewer
// switch (when the screen offers one) and 3D / 2D switch (when this browser can draw 3D) as before, and the fog chip. The panel is always in
// the page and is only hidden while the menu is shut, so a page that offers the viewer switch says so in its markup whether or not the menu is
// open (the live view's rule: no switch before the record, none in a fogged battle that is still live).
import { useEffect, useRef } from 'react';
import type { ReactElement, Ref } from 'react';
import { RendererToggle } from '../board3d/stage/RendererToggle';
import type { RendererChoice } from '../board3d/stage/support';
import { ViewerToggle } from './Controls';
import { fogLabel } from './bar';
import type { Seats } from './seats';
import type { Timeline, ViewFrame, Viewer } from './timeline';

export interface ViewPanelProps {
  /** The viewer's own timeline: the switch names the seats from its first frame, the chip reads the frame on screen. */
  timeline: Timeline;
  frame: ViewFrame;
  viewer: Viewer;
  /** Given: the viewer switch is offered, and this is what it calls. Absent: it is not. */
  onViewerChange?: (v: Viewer) => void;
  seats?: Seats;
  /** Can this browser draw the 3D board? Without it the 3D / 2D switch is not offered. */
  webgl2: boolean;
  renderer: RendererChoice;
  onRendererChange: (mode: RendererChoice) => void;
}

/**
 * What the menu holds: the old viewer switch and 3D / 2D switch, the very same components with the very same callbacks, and the fog chip. It has
 * no state of its own (and no hooks), so a test can read the switches' wiring straight off it.
 */
export function ViewPanel({ timeline, frame, viewer, onViewerChange, seats, webgl2, renderer, onRendererChange }: ViewPanelProps): ReactElement {
  return (
    <>
      {onViewerChange && <ViewerToggle frame={timeline.steps[0].frame} viewer={viewer} onChange={onViewerChange} seats={seats} />}
      {webgl2 && <RendererToggle mode={renderer} onChange={onRendererChange} />}
      <span className="aww-chip caption" data-fog={frame.viewer === 'all' ? 'all' : frame.fogActive ? 'on' : 'off'}>{fogLabel(frame)}</span>
    </>
  );
}

export interface ViewMenuProps extends ViewPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id: string;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function ViewMenu({ open, onOpenChange, id, buttonRef, ...panel }: ViewMenuProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  // A press anywhere outside the menu shuts it. (Escape is the watch view's own: it shuts the menu before the drawer.)
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: PointerEvent): void => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, onOpenChange]);
  return (
    <div className="aww-viewmenu" ref={root} data-open={open ? 'yes' : 'no'}>
      <button
        ref={buttonRef}
        type="button"
        className="aw-btn aw-btn--ghost aw-btn--sm label aww-viewbtn"
        aria-expanded={open}
        aria-controls={id}
        data-action="view"
        title="Who you watch as, the board and the fog"
        onClick={() => onOpenChange(!open)}
      >
        <span className="aw-btn-label">View</span>
        <svg className="aww-chevron" width={10} height={10} viewBox="0 0 12 12" aria-hidden><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={1.8} /></svg>
      </button>
      <div className="aww-viewpop" id={id} role="group" aria-label="View" hidden={!open}>
        <ViewPanel {...panel} />
      </div>
    </div>
  );
}
