export interface PrinterProfile {
  id: string;
  brand: string;
  model: string;
  volume: [number, number, number];
  note?: string;
  source: string;
}

export const PRINTERS: PrinterProfile[] = [
  {
    id: 'bambu-h2c-left',
    brand: 'Bambu Lab',
    model: 'H2C — left nozzle',
    volume: [325, 320, 320],
    note: 'Standard (left) hotend. Largest single-material volume on the H2C.',
    source: 'https://wiki.bambulab.com/en/h2/manual/max-printable-area',
  },
  {
    id: 'bambu-h2c-right',
    brand: 'Bambu Lab',
    model: 'H2C — right nozzle (Vortek)',
    volume: [305, 320, 325],
    note: 'The Vortek hotend rack reduces X on the right nozzle.',
    source: 'https://wiki.bambulab.com/en/h2/manual/max-printable-area',
  },
  {
    id: 'bambu-h2c-dual',
    brand: 'Bambu Lab',
    model: 'H2C — both nozzles on one part',
    volume: [300, 320, 320],
    note: 'Store lists 325 mm height, the wiki 320 mm; the safer 320 mm is used.',
    source: 'https://us.store.bambulab.com/products/h2c',
  },
  {
    id: 'bambu-h2d-left',
    brand: 'Bambu Lab',
    model: 'H2D — left nozzle',
    volume: [325, 320, 320],
    source: 'https://wiki.bambulab.com/en/h2/manual/max-printable-area',
  },
  {
    id: 'bambu-h2d-right',
    brand: 'Bambu Lab',
    model: 'H2D — right nozzle',
    volume: [325, 320, 325],
    source: 'https://wiki.bambulab.com/en/h2/manual/max-printable-area',
  },
  {
    id: 'bambu-h2s',
    brand: 'Bambu Lab',
    model: 'H2S',
    volume: [340, 320, 340],
    source: 'https://us.store.bambulab.com/products/h2s',
  },
  {
    id: 'bambu-x1c',
    brand: 'Bambu Lab',
    model: 'X1 Carbon / X1E',
    volume: [256, 256, 256],
    note: 'Bambu Studio defaults to 250 mm printable height.',
    source: 'https://public-cdn.bambulab.com/store/bambulab-X1-carbon-tech-specs.pdf',
  },
  {
    id: 'bambu-p1s',
    brand: 'Bambu Lab',
    model: 'P1S / P1P / P2S',
    volume: [256, 256, 256],
    note: 'Bambu Studio defaults to 250 mm printable height.',
    source: 'https://us.store.bambulab.com/products/p1s',
  },
  {
    id: 'bambu-a1',
    brand: 'Bambu Lab',
    model: 'A1',
    volume: [256, 256, 256],
    source: 'https://us.store.bambulab.com/products/a1',
  },
  {
    id: 'bambu-a1-mini',
    brand: 'Bambu Lab',
    model: 'A1 mini',
    volume: [180, 180, 180],
    source: 'https://us.store.bambulab.com/products/a1-mini',
  },
  {
    id: 'prusa-mk4s',
    brand: 'Prusa',
    model: 'MK4S',
    volume: [250, 210, 220],
    source: 'https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer-5/',
  },
  {
    id: 'prusa-core-one',
    brand: 'Prusa',
    model: 'CORE One',
    volume: [250, 220, 270],
    source: 'https://www.prusa3d.com/product/prusa-core-one/',
  },
  {
    id: 'prusa-core-one-l',
    brand: 'Prusa',
    model: 'CORE One L',
    volume: [300, 300, 330],
    source: 'https://www.prusa3d.com/product/prusa-core-one-l-2/',
  },
  {
    id: 'prusa-xl',
    brand: 'Prusa',
    model: 'XL',
    volume: [360, 360, 360],
    source: 'https://www.prusa3d.com/product/original-prusa-xl-assembled-single-toolhead-3d-printer/',
  },
  {
    id: 'prusa-mini',
    brand: 'Prusa',
    model: 'MINI+',
    volume: [180, 180, 180],
    source:
      'https://www.prusa3d.com/product/original-prusa-mini-semi-assembled-3d-printer-enclosure-bundle-5/',
  },
  {
    id: 'creality-k1',
    brand: 'Creality',
    model: 'K1 / K1C',
    volume: [220, 220, 250],
    source: 'https://www.creality.com/support/creality-k1-3d-printer',
  },
  {
    id: 'creality-k1-max',
    brand: 'Creality',
    model: 'K1 Max',
    volume: [300, 300, 300],
    source: 'https://www.creality.com/support/creality-k1-max-3d-printer',
  },
  {
    id: 'creality-k2',
    brand: 'Creality',
    model: 'K2',
    volume: [260, 260, 260],
    source: 'https://www.creality.com/products/k2-series-3d-printer',
  },
  {
    id: 'creality-k2-pro',
    brand: 'Creality',
    model: 'K2 Pro',
    volume: [300, 300, 300],
    source: 'https://www.creality.com/products/k2-series-3d-printer',
  },
  {
    id: 'creality-k2-plus',
    brand: 'Creality',
    model: 'K2 Plus',
    volume: [350, 350, 350],
    source: 'https://www.creality.com/products/creality-k2-plus-cfs-combo',
  },
  {
    id: 'creality-ender3-v3',
    brand: 'Creality',
    model: 'Ender-3 V3 / V3 SE',
    volume: [220, 220, 250],
    source: 'https://www.creality.com/support/creality-ender-3-v3',
  },
  {
    id: 'creality-ender3-v3-ke',
    brand: 'Creality',
    model: 'Ender-3 V3 KE',
    volume: [220, 220, 240],
    source: 'https://www.creality.com/support/creality-ender-3-v3-ke',
  },
  {
    id: 'creality-ender3-v3-plus',
    brand: 'Creality',
    model: 'Ender-3 V3 Plus',
    volume: [300, 300, 330],
    source: 'https://www.creality.com/support/creality-ender-3-v3-plus',
  },
  {
    id: 'elegoo-neptune4-pro',
    brand: 'Elegoo',
    model: 'Neptune 4 Pro',
    volume: [225, 225, 265],
    source: 'https://us.elegoo.com/products/elegoo-neptune-4-pro-fdm-3d-printer',
  },
  {
    id: 'elegoo-neptune4-max',
    brand: 'Elegoo',
    model: 'Neptune 4 Max',
    volume: [420, 420, 480],
    source: 'https://us.elegoo.com/products/neptune-4-max-fdm-3d-printer',
  },
  {
    id: 'elegoo-centauri-carbon',
    brand: 'Elegoo',
    model: 'Centauri Carbon',
    volume: [256, 256, 256],
    source: 'https://us.elegoo.com/pages/elegoo-centauri-carbon',
  },
  {
    id: 'anycubic-kobra3',
    brand: 'Anycubic',
    model: 'Kobra 3',
    volume: [250, 250, 260],
    source: 'https://store.anycubic.com/products/kobra-3-combo',
  },
  {
    id: 'anycubic-kobra-s1',
    brand: 'Anycubic',
    model: 'Kobra S1',
    volume: [250, 250, 250],
    source: 'https://store.anycubic.com/products/kobra-s1',
  },
  {
    id: 'anycubic-kobra3-max',
    brand: 'Anycubic',
    model: 'Kobra 3 Max',
    volume: [420, 420, 500],
    source: 'https://store.anycubic.com/products/kobra-3-max',
  },
  {
    id: 'qidi-plus4',
    brand: 'QIDI',
    model: 'Plus4',
    volume: [305, 305, 280],
    source: 'https://us.qidi3d.com/products/plus4-3d-printer',
  },
  {
    id: 'qidi-xmax3',
    brand: 'QIDI',
    model: 'X-Max 3',
    volume: [325, 325, 315],
    source: 'https://qidi3d.com/products/qidi-x-max-3',
  },
  {
    id: 'sovol-sv08',
    brand: 'Sovol',
    model: 'SV08',
    volume: [350, 350, 345],
    source: 'https://www.sovol3d.com/products/sovol-sv08-3d-printer',
  },
  {
    id: 'snapmaker-u1',
    brand: 'Snapmaker',
    model: 'U1',
    volume: [270, 270, 270],
    source: 'https://www.snapmaker.com/snapmaker-u1/specs',
  },
  {
    id: 'voron-24-350',
    brand: 'Voron',
    model: '2.4 (350 kit)',
    volume: [350, 350, 310],
    note: 'Official sources list 310–330 mm Z; the conservative stock Klipper value is used.',
    source: 'https://docs.vorondesign.com/hardware.html',
  },
  {
    id: 'voron-24-300',
    brand: 'Voron',
    model: '2.4 (300 kit)',
    volume: [300, 300, 260],
    note: 'Official sources list 260–280 mm Z; the conservative stock Klipper value is used.',
    source: 'https://docs.vorondesign.com/hardware.html',
  },
];

export const DEFAULT_PRINTER_ID = 'bambu-h2c-left';

export function findPrinter(id: string): PrinterProfile | undefined {
  return PRINTERS.find((p) => p.id === id);
}

export function customPrinter(volume: [number, number, number]): PrinterProfile {
  return { id: 'custom', brand: 'Custom', model: 'Custom printer', volume, source: '' };
}
