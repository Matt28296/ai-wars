// Ascendant Wars UI kit — TSX ports of the design-system components (design-system/project/components).
// Import './kit.css' once (index does it) after src/styles/tokens.css.
import './kit.css';

export { cx, fillOf, onOf, inkOf, markOf, factionName, factionShort, credits, pad2, chamfer } from './util';
export type { FactionOrEcho } from './util';
export { Frame, Sigil, Icon, ICONS, Kicker, Diamonds, Meter, Paths, KitArtContext, useKitArt } from './primitives';
export type { FrameProps, IconName, KitArt, SigilTone } from './primitives';
export { UnitToken, MapTile, Cursor, TerrainArt, terrainRole } from './UnitToken';
export type { UnitTokenProps, MapTileProps, UnitStatus } from './UnitToken';
export { Button, StatusChip, CommandMenu, BuildMenu, menuKeyDown } from './controls';
export type { ButtonProps, StatusChipProps, CommandItem, CommandMenuProps, BuildItem, BuildMenuProps, MenuNav } from './controls';
export { TerrainCard, UnitCard, BattleForecast } from './cards';
export type { TerrainCardProps, UnitCardProps, BattleForecastProps, ForecastSide } from './cards';
export { CommanderPortrait, CommanderFace, PowerMeter, PlayerHud, DialogueBox, TurnBanner } from './commander';
export type { CommanderInfo, PowerMeterProps, PlayerHudProps, DialogueBoxProps, TurnBannerProps } from './commander';
