// The front door: title screen, campaign map, mission briefing and Deploy, behind a small hash router (G9).
export { FrontApp } from './FrontApp';
export type { FrontAppProps } from './FrontApp';
export { DEMO_HASH, formatRoute, isLegacyDemoHash, parseRoute } from './router';
export type { Route } from './router';
