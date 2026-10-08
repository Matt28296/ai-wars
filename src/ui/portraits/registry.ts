// Every portrait's art, by commander id.
import { cantor } from './art/cantor';
import { corvin } from './art/corvin';
import { dax } from './art/dax';
import { ilse } from './art/ilse';
import { echo } from './art/echo';
import { juno } from './art/juno';
import { maru } from './art/maru';
import { rook } from './art/rook';
import { sable } from './art/sable';
import { sefa } from './art/sefa';
import { vesper } from './art/vesper';
import type { PortraitArt } from './types';

const LIST: readonly PortraitArt[] = [rook, ilse, sefa, dax, maru, juno, corvin, sable, cantor, vesper, echo];

export const ARTS: Readonly<Record<string, PortraitArt>> = Object.fromEntries(LIST.map((a) => [a.id, a]));
