// Replay and state hashing. A game replays exactly from its setup (map, players, seed in state.rng) and its action list,
// so replay(setup, actions) is the receipt for any recorded game, and stateHash() is how two runs are compared cheaply.
//
// stateHash = FNV-1a (64 bit) over canonical JSON: keys sorted at every depth, no whitespace. Pure JS, no node:crypto,
// because the engine must stay browser-safe. It is a fingerprint for tests, replays and desync checks, not a security hash.
import { IllegalActionError, applyAction, createGame } from './index';
import type { CreateGameOptions } from './index';
import type { Action, ApplyResult, GameEvent, GameState } from './types';

// JSON.stringify of a key, remembered: the same few dozen field names recur thousands of times in a state.
const keyText = new Map<string, string>();
function quotedKey(k: string): string {
  let q = keyText.get(k);
  if (q === undefined) {
    q = `${JSON.stringify(k)}:`;
    if (keyText.size < 4096) keyText.set(k, q);
  }
  return q;
}

function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'number':
      return String(v); // NaN and Infinity stay distinguishable from null: a state holding one should hash differently
    case 'boolean':
      return v ? 'true' : 'false';
    case 'object': {
      if (Array.isArray(v)) {
        let out = '[';
        for (let i = 0; i < v.length; i++) out += (i ? ',' : '') + canonical(v[i]);
        return out + ']';
      }
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`canonicalJson: cannot hash a ${(v as object).constructor?.name ?? 'non-plain'} object`);
      }
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length > 1) keys.sort();
      let out = '{';
      let first = true;
      for (const k of keys) {
        if (obj[k] === undefined) continue; // an absent field and an undefined one are the same state, as in JSON
        out += (first ? '' : ',') + quotedKey(k) + canonical(obj[k]);
        first = false;
      }
      return out + '}';
    }
    default:
      throw new TypeError(`canonicalJson: cannot hash a ${typeof v}`);
  }
}

/** JSON with object keys sorted at every depth. Plain data only: a function, Map, Set or class instance throws. */
export function canonicalJson(value: unknown): string {
  return canonical(value);
}

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

/** 64-bit FNV-1a over the UTF-8 bytes of `text`, as 16 lowercase hex digits. */
export function fnv1a64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  // 64-bit state as two uint32 halves. The FNV prime is 2^40 + 0x1b3, so the multiply is lo * 0x1b3 (split in 16-bit
  // limbs so it stays exact), hi * 0x1b3, and lo shifted up 40 bits (which lands in hi as lo << 8).
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ bytes[i]) >>> 0;
    const prod = (lo & 0xffff) * 0x1b3 + (lo >>> 16) * 0x1b3 * 65536;
    const carry = Math.floor(prod / 4294967296);
    hi = (Math.imul(hi, 0x1b3) + carry + (lo << 8)) >>> 0;
    lo = prod >>> 0;
  }
  return hex8(hi) + hex8(lo);
}

/** A stable fingerprint of a whole game state: equal states hash equal whatever their key order. */
export function stateHash(state: GameState): string {
  return fnv1a64(canonicalJson(state));
}

export interface ReplayOptions {
  /** Hash every state along the way (default true). Switch off for a cheap replay when only the final state matters. */
  hashes?: boolean;
}

/**
 * Replays a game from createGame(setup) through `actions`. Returns the final state, every event of every action in
 * order (what the live applyAction calls returned), and `hashes`: hashes[0] is the state createGame returned and
 * hashes[i + 1] the state after action i, so hashes has actions.length + 1 entries (empty when hashes is off).
 * An action the engine refuses throws IllegalActionError naming its position.
 */
export function replay(
  setup: CreateGameOptions, actions: Action[], opts: ReplayOptions = {},
): ApplyResult & { hashes: string[] } {
  const withHashes = opts.hashes !== false;
  let state = createGame(setup);
  const events: GameEvent[] = [];
  const hashes: string[] = withHashes ? [stateHash(state)] : [];
  for (let i = 0; i < actions.length; i++) {
    let result: ApplyResult;
    try {
      result = applyAction(state, actions[i]);
    } catch (err) {
      if (err instanceof IllegalActionError) {
        throw new IllegalActionError(`replay: action #${i} (${actions[i]?.kind}) is illegal: ${err.message}`);
      }
      throw err;
    }
    state = result.state;
    for (const e of result.events) events.push(e);
    if (withHashes) hashes.push(stateHash(state));
  }
  return { state, events, hashes };
}
