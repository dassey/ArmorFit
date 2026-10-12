import { PIECE_TYPES, type PieceTypeId, type Side } from './types';

export interface NameGuess {
  type: PieceTypeId | null;
  side: Side | null;
  confidence: number;
  matchedWord?: string;
}

export function tokenize(fileName: string): string[] {
  const base = fileName.replace(/\.[^.]+$/, '');
  return base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const LEFT = new Set(['l', 'left', 'lft', 'lh', 'lhs', 'izq', 'izquierda', 'gauche', 'links']);
const BACK_FIRST = new Set<PieceTypeId>(['chest', 'pauldron', 'abdomen', 'gorget']);

const DETAIL_WORDS = new Set([
  'detail',
  'details',
  'vent',
  'vents',
  'buckle',
  'trim',
  'insert',
  'inserts',
  'lens',
  'tacpad',
  'strap',
  'straps',
  'clip',
  'clips',
  'pin',
  'pins',
  'emblem',
  'logo',
  'badge',
  'decal',
  'greeble',
  'greebles',
  'light',
  'lights',
  'bolt',
  'bolts',
  'rivet',
  'rivets',
  'button',
  'buttons',
  'antenna',
  'accent',
  'ornament',
  'stand',
  'hinge',
  'latch',
  'magnet',
  'connector',
  'key',
  'peg',
  'pegs',
]);

export function isDetailPart(fileName: string): boolean {
  return tokenize(fileName).some((t) => DETAIL_WORDS.has(t));
}

const RIGHT = new Set(['r', 'right', 'rgt', 'rt', 'rh', 'rhs', 'der', 'derecha', 'droite', 'rechts']);

export function guessFromFileName(fileName: string): NameGuess {
  const tokens = tokenize(fileName);
  let side: Side | null = null;
  for (const t of tokens) {
    if (LEFT.has(t)) side = 'L';
    else if (RIGHT.has(t)) side = 'R';
  }

  let best: { id: PieceTypeId; score: number; word: string } | null = null;
  const joined = tokens.join(' ');
  for (const type of PIECE_TYPES) {
    for (const kw of type.keywords) {
      let score = 0;
      if (tokens.includes(kw)) score = 1;
      else if (kw.length >= 4 && joined.includes(kw)) score = 0.7;
      else if (kw.length >= 6 && joined.replace(/ /g, '').includes(kw)) score = 0.6;
      if (score > 0 && ['ab', 'leg', 'front', 'head', 'back', 'core', 'hip', 'cuff'].includes(kw))
        score *= 0.75;
      if (
        score > 0 &&
        (!best || score > best.score || (score === best.score && kw.length > best.word.length))
      ) {
        best = { id: type.id, score, word: kw };
      }
    }
  }
  if (best && (tokens[0] === 'back' || tokens[0] === 'rear') && BACK_FIRST.has(best.id)) {
    best = { id: 'back', score: 0.9, word: tokens[0] };
  }
  if (!best) return { type: null, side, confidence: 0 };
  return { type: best.id, side, confidence: best.score, matchedWord: best.word };
}
