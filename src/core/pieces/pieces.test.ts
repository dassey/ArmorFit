import { describe, expect, it } from 'vitest';
import { guessFromFileName, tokenize } from './classify';
import { PIECE_TYPES } from './types';
import { guessUnits } from './units';

describe('tokenize', () => {
  it('splits camelCase, digits and separators', () => {
    expect(tokenize('PauldronLeft_v2.stl')).toEqual(['pauldron', 'left', 'v', '2']);
    expect(tokenize('Mk7 Helmet-FINAL (1).3mf')).toEqual(['mk', '7', 'helmet', 'final', '1']);
  });
});

describe('guessFromFileName', () => {
  const cases: [string, string | null, string | null][] = [
    ['Pauldron_L.stl', 'pauldron', 'L'],
    ['right_forearm.obj', 'forearm', 'R'],
    ['Helmet_v3_final.stl', 'helmet', null],
    ['ChestPlate.3mf', 'chest', null],
    ['breastplate2.stl', 'chest', null],
    ['Gauntlet R.stl', 'forearm', 'R'],
    ['shin_guard_left.stl', 'shin', 'L'],
    ['Greaves - Right.stl', 'shin', 'R'],
    ['Thigh L.stl', 'thigh', 'L'],
    ['boot_toe_cap_R.stl', 'boot', 'R'],
    ['random_part_07.stl', null, null],
    ['XL_support.stl', null, null],
  ];
  for (const [name, type, side] of cases) {
    it(`${name} -> ${type ?? 'unknown'} ${side ?? ''}`, () => {
      const g = guessFromFileName(name);
      expect(g.type).toBe(type);
      expect(g.side).toBe(side);
    });
  }

  it('every piece type keyword maps back to its type', () => {
    for (const t of PIECE_TYPES) {
      for (const kw of t.keywords) {
        const g = guessFromFileName(`${kw}.stl`);
        if (g.type !== t.id) {
          expect(['front', 'head', 'back', 'leg', 'hip', 'wrist', 'cuff']).toContain(kw);
        }
      }
    }
  });
});

describe('guessUnits', () => {
  it('accepts millimetres for normal-sized parts', () => {
    const g = guessUnits(260);
    expect(g.best.unit).toBe('mm');
    expect(g.needsConfirmation).toBe(false);
  });

  it('recognises metres and centimetres', () => {
    expect(guessUnits(0.28).best.unit).toBe('m');
    expect(guessUnits(28).best.unit).toBe('cm');
  });

  it('honours a declared unit', () => {
    const g = guessUnits(2.8, { declared: 'cm' });
    expect(g.best.scale).toBe(10);
    expect(g.needsConfirmation).toBe(true);
  });

  it('suggests a reduced-scale preview when the type is known', () => {
    const g = guessUnits(58, { expectedSizeMm: 290 });
    expect(g.best.unit).toBe('scaled');
    expect(g.best.scale).toBe(5);
    expect(g.needsConfirmation).toBe(true);
  });
});
