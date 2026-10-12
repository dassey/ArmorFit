import { parseProject, serializeProject, type ProjectPiece } from '../core/export/project';
import { parseProfile, serializeProfile } from '../core/measurements/profile';
import { APP_VERSION } from '../version';
import { pendingPieces, pieces } from './pieces';
import { clearanceBase, printSettings, profile } from './store';

const BODY_ASSET = 'makehuman-hm08@a8bc2d54/v1';

export function buildProjectJson(): string {
  const list = pieces.value;
  const saved: ProjectPiece[] = list.map((p) => {
    const sourceIndex = p.sourceId ? list.findIndex((q) => q.id === p.sourceId) : -1;
    return {
      name: p.name,
      fileName: p.fileName,
      fileHash: p.fileHash,
      type: p.type,
      side: p.side,
      unitScale: p.unitScale,
      orientation: p.orientation,
      placement: p.placement,
      scale: p.scale,
      mirrored: p.mirrored,
      ...(sourceIndex >= 0 ? { sourceIndex } : {}),
    };
  });
  for (const pend of pendingPieces.value) {
    const { index: _index, ...rest } = pend;
    saved.push(rest);
  }
  return serializeProject({
    app: `ArmorFit ${APP_VERSION}`,
    savedAt: new Date().toISOString(),
    bodyAsset: BODY_ASSET,
    measurements: JSON.parse(serializeProfile(profile.value)),
    clearance: clearanceBase.value,
    printer: { id: printSettings.value.printerId, custom: printSettings.value.custom },
    exportOrientation: printSettings.value.orientation,
    pieces: saved,
  });
}

export function loadProjectJson(json: string): { waiting: number; warning?: string } {
  const proj = parseProject(json);
  profile.value = parseProfile(JSON.stringify(proj.measurements));
  clearanceBase.value = { ...clearanceBase.value, ...proj.clearance };
  printSettings.value = {
    ...printSettings.value,
    printerId: proj.printer?.id ?? printSettings.value.printerId,
    custom: proj.printer?.custom ?? printSettings.value.custom,
    orientation: proj.exportOrientation ?? printSettings.value.orientation,
  };
  pendingPieces.value = proj.pieces.map((p, index) => ({ ...p, index }));
  return {
    waiting: proj.pieces.length,
    warning:
      proj.bodyAsset !== BODY_ASSET
        ? 'This project was saved with a different mannequin version; piece positions may need adjusting.'
        : undefined,
  };
}
