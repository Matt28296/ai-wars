// Mounts the front door (G9): a small hash router over the title screen, the campaign map, the mission briefing and Deploy.
// The demo watch view (calder-fields, Rook Okafor against Sefa Tamura, a seeded match watched under fog) is still here, at the hash
// links it always had (#step=40&viewer=all, #play=1, ...); the title's "Watch a battle" opens it. The platform shell (M2) replaces this
// mount; the viewer itself is src/ui/watch and the front door is src/ui/front.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import { FrontApp } from './ui/front';

export const BUILD_SHA: string = __BUILD_SHA__;

const root = document.getElementById('root');
if (root) {
  root.setAttribute('data-build', BUILD_SHA);
  createRoot(root).render(
    <StrictMode>
      <FrontApp />
    </StrictMode>,
  );
}
