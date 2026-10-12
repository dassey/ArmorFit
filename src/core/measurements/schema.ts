export type MeasurementKey =
  | 'height'
  | 'chest'
  | 'waist'
  | 'hips'
  | 'headCirc'
  | 'headLength'
  | 'headWidth'
  | 'neckCirc'
  | 'shoulderWidth'
  | 'torsoLength'
  | 'upperArmLength'
  | 'bicepCirc'
  | 'forearmLength'
  | 'forearmCirc'
  | 'wristCirc'
  | 'handLength'
  | 'handWidth'
  | 'thighLength'
  | 'thighCirc'
  | 'shinLength'
  | 'calfCirc'
  | 'footLength';

export type Measurements = Record<MeasurementKey, number>;

export type ProportionPreset = 'neutral' | 'masculine' | 'feminine';

export type MeasurementGroup = 'Overall' | 'Head & neck' | 'Torso' | 'Arms' | 'Hands' | 'Legs & feet';

export interface MeasurementInfo {
  key: MeasurementKey;
  label: string;
  group: MeasurementGroup;
  howTo: string;
  kind: 'length' | 'circumference';
  min: number;
  max: number;
  quick?: boolean;
}

export const MEASUREMENTS: MeasurementInfo[] = [
  {
    key: 'height',
    label: 'Height',
    group: 'Overall',
    howTo: 'Standing straight, barefoot, floor to top of head.',
    kind: 'length',
    min: 1300,
    max: 2200,
    quick: true,
  },
  {
    key: 'chest',
    label: 'Chest',
    group: 'Torso',
    howTo: 'Around the fullest part of the chest, under the armpits, tape level, breathing normally.',
    kind: 'circumference',
    min: 650,
    max: 1600,
    quick: true,
  },
  {
    key: 'waist',
    label: 'Waist',
    group: 'Torso',
    howTo: 'Around the natural waist (at the navel), relaxed.',
    kind: 'circumference',
    min: 520,
    max: 1600,
    quick: true,
  },
  {
    key: 'headCirc',
    label: 'Head circumference',
    group: 'Head & neck',
    howTo: 'Around the head just above the eyebrows and ears, over the fullest part at the back.',
    kind: 'circumference',
    min: 480,
    max: 660,
    quick: true,
  },
  {
    key: 'headLength',
    label: 'Head length',
    group: 'Head & neck',
    howTo:
      'Front to back: from between the eyebrows to the furthest point at the back of the head (use a ruler against a wall).',
    kind: 'length',
    min: 160,
    max: 230,
  },
  {
    key: 'headWidth',
    label: 'Head width',
    group: 'Head & neck',
    howTo: 'Side to side at the widest point above the ears.',
    kind: 'length',
    min: 125,
    max: 180,
  },
  {
    key: 'neckCirc',
    label: 'Neck circumference',
    group: 'Head & neck',
    howTo: 'Around the neck just below the Adam’s apple.',
    kind: 'circumference',
    min: 260,
    max: 520,
  },
  {
    key: 'hips',
    label: 'Hips',
    group: 'Torso',
    howTo: 'Around the fullest part of the hips and buttocks, feet together.',
    kind: 'circumference',
    min: 700,
    max: 1700,
  },
  {
    key: 'shoulderWidth',
    label: 'Shoulder width',
    group: 'Torso',
    howTo: 'Straight across the back between the bony tips of the shoulders (acromion to acromion).',
    kind: 'length',
    min: 280,
    max: 520,
  },
  {
    key: 'torsoLength',
    label: 'Torso length',
    group: 'Torso',
    howTo:
      'Front of body: from the notch at the top of the breastbone (between the collarbones) down to the navel.',
    kind: 'length',
    min: 300,
    max: 600,
  },
  {
    key: 'upperArmLength',
    label: 'Upper arm length',
    group: 'Arms',
    howTo: 'Arm relaxed at your side: from the bony tip of the shoulder to the point of the elbow.',
    kind: 'length',
    min: 240,
    max: 420,
  },
  {
    key: 'bicepCirc',
    label: 'Bicep circumference (flexed)',
    group: 'Arms',
    howTo:
      'Around the peak of the bicep with the arm flexed (elbow bent, fist clenched) — armor must fit a flexed arm.',
    kind: 'circumference',
    min: 200,
    max: 520,
  },
  {
    key: 'forearmLength',
    label: 'Forearm length',
    group: 'Arms',
    howTo: 'From the point of the elbow to the wrist bone on the thumb side.',
    kind: 'length',
    min: 180,
    max: 340,
  },
  {
    key: 'forearmCirc',
    label: 'Forearm circumference (flexed)',
    group: 'Arms',
    howTo: 'Around the fullest part of the forearm just below the elbow, fist clenched.',
    kind: 'circumference',
    min: 180,
    max: 420,
  },
  {
    key: 'wristCirc',
    label: 'Wrist circumference',
    group: 'Arms',
    howTo: 'Around the wrist just above the wrist bones.',
    kind: 'circumference',
    min: 120,
    max: 240,
  },
  {
    key: 'handLength',
    label: 'Hand length',
    group: 'Hands',
    howTo: 'From the wrist crease to the tip of the middle finger.',
    kind: 'length',
    min: 140,
    max: 240,
  },
  {
    key: 'handWidth',
    label: 'Hand width',
    group: 'Hands',
    howTo: 'Across the knuckles (palm), not including the thumb.',
    kind: 'length',
    min: 60,
    max: 120,
  },
  {
    key: 'thighLength',
    label: 'Thigh length',
    group: 'Legs & feet',
    howTo: 'From the bony point at the side of the hip to the middle of the knee (side of the leg).',
    kind: 'length',
    min: 300,
    max: 600,
  },
  {
    key: 'thighCirc',
    label: 'Thigh circumference',
    group: 'Legs & feet',
    howTo: 'Around the fullest part of the upper thigh, just below the buttock.',
    kind: 'circumference',
    min: 380,
    max: 900,
  },
  {
    key: 'shinLength',
    label: 'Shin length',
    group: 'Legs & feet',
    howTo: 'From the middle of the knee down to the ankle bone.',
    kind: 'length',
    min: 300,
    max: 600,
  },
  {
    key: 'calfCirc',
    label: 'Calf circumference',
    group: 'Legs & feet',
    howTo: 'Around the fullest part of the calf.',
    kind: 'circumference',
    min: 250,
    max: 560,
  },
  {
    key: 'footLength',
    label: 'Foot length',
    group: 'Legs & feet',
    howTo: 'Heel to the tip of the longest toe, standing.',
    kind: 'length',
    min: 200,
    max: 330,
  },
];

export const MEASUREMENT_KEYS = MEASUREMENTS.map((m) => m.key);
export const QUICK_KEYS: MeasurementKey[] = MEASUREMENTS.filter((m) => m.quick).map((m) => m.key);

const INFO = new Map(MEASUREMENTS.map((m) => [m.key, m]));
export function measurementInfo(key: MeasurementKey): MeasurementInfo {
  return INFO.get(key)!;
}

export type Undergarment = 'none' | 'bodysuit' | 'foam';

export const UNDERGARMENT_ALLOWANCE_MM: Record<Undergarment, number> = {
  none: 0,
  bodysuit: 2,
  foam: 10,
};

export const UNDERGARMENT_LABELS: Record<Undergarment, string> = {
  none: 'None',
  bodysuit: 'Bodysuit / undersuit (+2 mm)',
  foam: 'Foam padding (+10 mm)',
};
