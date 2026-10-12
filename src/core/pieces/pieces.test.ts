import { describe, expect, it } from 'vitest';
import { guessFromFileName, isDetailPart, tokenize } from './classify';
import { PIECE_TYPES } from './types';
import { guessSetUnits, guessUnits } from './units';

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

describe('classifier extras', () => {
  it('reads "Back X" names as back plates', () => {
    expect(guessFromFileName('Back Shoulder Left.stl')).toMatchObject({ type: 'back', side: 'L' });
    expect(guessFromFileName('Kidney Plate.stl').type).toBe('back');
    expect(guessFromFileName('Shoulder Left.stl').type).toBe('pauldron');
  });

  it('spots detail parts', () => {
    expect(isDetailPart('Vent Detail Left.stl')).toBe(true);
    expect(isDetailPart('Belt Buckle.stl')).toBe(true);
    expect(isDetailPart('Chest Center.stl')).toBe(false);
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
    expect(guessUnits(29, { expectedSizeMm: 290 }).best.unit).toBe('cm');
  });

  it('keeps small parts in millimetres but asks', () => {
    const g = guessUnits(28);
    expect(g.best.unit).toBe('mm');
    expect(g.needsConfirmation).toBe(true);
  });

  it('keeps detail parts in millimetres even when the type is large', () => {
    const g = guessUnits(28, { expectedSizeMm: 290, detail: true });
    expect(g.best.unit).toBe('mm');
  });

  it('honours a declared unit', () => {
    const g = guessUnits(0.5, { declared: 'cm' });
    expect(g.best.scale).toBe(10);
    expect(g.needsConfirmation).toBe(true);
  });

  it('offers a reduced-scale preview when a known piece is far too small', () => {
    const g = guessUnits(58, { expectedSizeMm: 290 });
    expect(g.needsConfirmation).toBe(true);
    expect(g.candidates.some((c) => c.unit === 'scaled' && c.scale === 5)).toBe(true);
  });
});

describe('guessSetUnits', () => {
  it('decides millimetres for a set with large and tiny parts', () => {
    const g = guessSetUnits([
      { maxDimension: 28, typicalMm: 290 },
      { maxDimension: 10, typicalMm: 290 },
      { maxDimension: 340, typicalMm: 420 },
      { maxDimension: 320, typicalMm: 330 },
      { maxDimension: 260, typicalMm: 260 },
    ]);
    expect(g.best.unit).toBe('mm');
    expect(g.needsConfirmation).toBe(false);
  });

  it('decides centimetres for a set drawn in centimetres', () => {
    const g = guessSetUnits([
      { maxDimension: 34, typicalMm: 420 },
      { maxDimension: 29, typicalMm: 290 },
      { maxDimension: 26, typicalMm: 260 },
      { maxDimension: 33, typicalMm: 330 },
    ]);
    expect(g.best.unit).toBe('cm');
  });
});
