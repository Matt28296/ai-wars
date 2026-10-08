// Placeholder mount until the platform fork (M2) brings the TanStack Start shell.
import './styles/tokens.css';

export const BUILD_SHA: string = __BUILD_SHA__;

const root = document.getElementById('root');
if (root) {
  root.textContent = 'Ascendant Wars';
  root.setAttribute('data-build', BUILD_SHA);
}
