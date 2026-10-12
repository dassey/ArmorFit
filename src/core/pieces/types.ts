import type { RegionId } from '../body/regions';
import type { MeasurementKey } from '../measurements/schema';

export type Side = 'L' | 'R';

export type PieceCategory = 'shell' | 'tube' | 'cap';

export type PieceTypeId =
  | 'helmet'
  | 'gorget'
  | 'chest'
  | 'back'
  | 'abdomen'
  | 'belt'
  | 'tasset'
  | 'pauldron'
  | 'bicep'
  | 'elbow'
  | 'forearm'
  | 'hand'
  | 'thigh'
  | 'knee'
  | 'shin'
  | 'calf'
  | 'boot';

export interface PieceTypeInfo {
  id: PieceTypeId;
  label: string;
  sided: boolean;
  category: PieceCategory;
  regions: RegionId[];
  measurements: MeasurementKey[];
  typicalSize: number;
  keywords: string[];
}

export const PIECE_TYPES: PieceTypeInfo[] = [
  {
    id: 'helmet',
    label: 'Helmet',
    sided: false,
    category: 'cap',
    regions: ['head'],
    measurements: ['headCirc', 'headLength', 'headWidth'],
    typicalSize: 290,
    keywords: ['helmet', 'helm', 'head', 'dome', 'casque', 'casco', 'visor', 'faceplate', 'mask', 'cowl'],
  },
  {
    id: 'gorget',
    label: 'Gorget / collar',
    sided: false,
    category: 'tube',
    regions: ['neck', 'upperChest', 'upperBack'],
    measurements: ['neckCirc', 'shoulderWidth'],
    typicalSize: 300,
    keywords: ['gorget', 'collar', 'neck', 'neckguard'],
  },
  {
    id: 'chest',
    label: 'Chest plate',
    sided: false,
    category: 'shell',
    regions: ['chest', 'upperChest', 'abdomen'],
    measurements: ['chest', 'shoulderWidth', 'torsoLength'],
    typicalSize: 420,
    keywords: ['chest', 'breastplate', 'breast', 'cuirass', 'plastron', 'pec', 'pecs', 'torso', 'front'],
  },
  {
    id: 'back',
    label: 'Back plate',
    sided: false,
    category: 'shell',
    regions: ['upperBack', 'lowerBack'],
    measurements: ['chest', 'shoulderWidth', 'torsoLength'],
    typicalSize: 420,
    keywords: ['back', 'backplate', 'backpiece', 'spine', 'kidney', 'rear'],
  },
  {
    id: 'abdomen',
    label: 'Ab plate',
    sided: false,
    category: 'shell',
    regions: ['abdomen', 'waist'],
    measurements: ['waist', 'torsoLength'],
    typicalSize: 300,
    keywords: ['ab', 'abs', 'abdomen', 'abdominal', 'stomach', 'belly', 'core'],
  },
  {
    id: 'belt',
    label: 'Belt / fauld',
    sided: false,
    category: 'tube',
    regions: ['waist', 'hip'],
    measurements: ['waist', 'hips'],
    typicalSize: 380,
    keywords: ['belt', 'waist', 'fauld', 'girdle', 'buckle'],
  },
  {
    id: 'tasset',
    label: 'Tasset (hip guard)',
    sided: true,
    category: 'shell',
    regions: ['hip', 'thigh'],
    measurements: ['hips', 'thighCirc'],
    typicalSize: 300,
    keywords: ['tasset', 'tassets', 'hip', 'hipplate', 'skirt', 'tace'],
  },
  {
    id: 'pauldron',
    label: 'Pauldron (shoulder)',
    sided: true,
    category: 'shell',
    regions: ['upperShoulder', 'deltoid'],
    measurements: ['shoulderWidth', 'bicepCirc'],
    typicalSize: 260,
    keywords: ['pauldron', 'pauldrons', 'shoulder', 'shoulders', 'spaulder', 'epaulet', 'epaulette'],
  },
  {
    id: 'bicep',
    label: 'Bicep / upper arm',
    sided: true,
    category: 'tube',
    regions: ['upperArm', 'deltoid'],
    measurements: ['bicepCirc', 'upperArmLength'],
    typicalSize: 220,
    keywords: ['bicep', 'biceps', 'upperarm', 'rerebrace', 'brassard', 'tricep', 'triceps'],
  },
  {
    id: 'elbow',
    label: 'Elbow (couter)',
    sided: true,
    category: 'shell',
    regions: ['elbow'],
    measurements: ['bicepCirc', 'forearmCirc'],
    typicalSize: 140,
    keywords: ['elbow', 'couter', 'cowter'],
  },
  {
    id: 'forearm',
    label: 'Forearm / bracer',
    sided: true,
    category: 'tube',
    regions: ['forearm', 'wrist'],
    measurements: ['forearmCirc', 'wristCirc', 'forearmLength'],
    typicalSize: 260,
    keywords: [
      'forearm',
      'bracer',
      'bracers',
      'vambrace',
      'vambraces',
      'gauntlet',
      'gauntlets',
      'wrist',
      'lowerarm',
      'cuff',
    ],
  },
  {
    id: 'hand',
    label: 'Hand / glove',
    sided: true,
    category: 'cap',
    regions: ['hand'],
    measurements: ['handLength', 'handWidth', 'wristCirc'],
    typicalSize: 200,
    keywords: ['hand', 'glove', 'gloves', 'finger', 'fingers', 'knuckle', 'knuckles', 'palm', 'claw'],
  },
  {
    id: 'thigh',
    label: 'Thigh (cuisse)',
    sided: true,
    category: 'tube',
    regions: ['thigh'],
    measurements: ['thighCirc', 'thighLength'],
    typicalSize: 330,
    keywords: ['thigh', 'thighs', 'cuisse', 'cuisses', 'quad', 'upperleg'],
  },
  {
    id: 'knee',
    label: 'Knee (poleyn)',
    sided: true,
    category: 'shell',
    regions: ['knee'],
    measurements: ['thighCirc', 'calfCirc'],
    typicalSize: 150,
    keywords: ['knee', 'knees', 'poleyn', 'kneepad', 'kneecap'],
  },
  {
    id: 'shin',
    label: 'Shin / greave',
    sided: true,
    category: 'shell',
    regions: ['shin', 'calf'],
    measurements: ['calfCirc', 'shinLength'],
    typicalSize: 380,
    keywords: ['shin', 'shins', 'greave', 'greaves', 'lowerleg', 'tibia', 'leg'],
  },
  {
    id: 'calf',
    label: 'Calf (back of greave)',
    sided: true,
    category: 'shell',
    regions: ['calf'],
    measurements: ['calfCirc', 'shinLength'],
    typicalSize: 330,
    keywords: ['calf', 'calves'],
  },
  {
    id: 'boot',
    label: 'Boot / sabaton',
    sided: true,
    category: 'cap',
    regions: ['foot'],
    measurements: ['footLength'],
    typicalSize: 300,
    keywords: ['boot', 'boots', 'foot', 'feet', 'sabaton', 'sabatons', 'shoe', 'toe', 'toecap', 'spat'],
  },
];

const BY_ID = new Map(PIECE_TYPES.map((t) => [t.id, t]));

export function pieceType(id: PieceTypeId): PieceTypeInfo {
  return BY_ID.get(id)!;
}
