import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import wasmLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmLoaderNoSimd from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url';
import wasmBinaryNoSimd from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url';
import type { PhotoLandmark, PhotoView } from '../core/photo/silhouette';

// On-device pose landmarks and person segmentation (MediaPipe Pose Landmarker, Apache-2.0). The model and
// runtime are served with the app; photos are processed in this tab and never uploaded.

const MODEL_URL = './assets/models/pose_landmarker_full.task';

/** Longest side of the image handed to the model, in pixels. */
export const PHOTO_MAX_SIDE = 1280;

const INDEX: Record<PhotoLandmark, number> = {
  nose: 0,
  eyeL: 2,
  eyeR: 5,
  shoulderL: 11,
  shoulderR: 12,
  elbowL: 13,
  elbowR: 14,
  wristL: 15,
  wristR: 16,
  hipL: 23,
  hipR: 24,
  kneeL: 25,
  kneeR: 26,
  ankleL: 27,
  ankleR: 28,
};

let loading: Promise<PoseLandmarker> | null = null;

export function loadPoseDetector(): Promise<PoseLandmarker> {
  loading ??= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const simd = await FilesetResolver.isSimdSupported();
    const fileset = simd
      ? { wasmLoaderPath: wasmLoader, wasmBinaryPath: wasmBinary }
      : { wasmLoaderPath: wasmLoaderNoSimd, wasmBinaryPath: wasmBinaryNoSimd };
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL(MODEL_URL, document.baseURI).href, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numPoses: 1,
      outputSegmentationMasks: true,
    });
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Draws an image into a canvas no larger than PHOTO_MAX_SIDE, honouring the photo's EXIF orientation. */
export async function photoCanvas(
  source: Blob | HTMLCanvasElement | HTMLVideoElement,
): Promise<HTMLCanvasElement> {
  const img =
    source instanceof Blob ? await createImageBitmap(source, { imageOrientation: 'from-image' }) : source;
  const w = img instanceof HTMLVideoElement ? img.videoWidth : img.width;
  const h = img instanceof HTMLVideoElement ? img.videoHeight : img.height;
  if (!w || !h) throw new Error('This image is empty.');
  const s = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(h * s);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (img instanceof ImageBitmap) img.close();
  return canvas;
}

/** Finds the person in a photo: mask and landmarks in the canvas's pixels, or null if nobody is found. */
export async function detectPose(canvas: HTMLCanvasElement): Promise<PhotoView | null> {
  const landmarker = await loadPoseDetector();
  const result = landmarker.detect(canvas);
  try {
    const points = result.landmarks[0];
    const mask = result.segmentationMasks?.[0];
    if (!points || !mask) return null;
    const data = Float32Array.from(mask.getAsFloat32Array());
    const landmarks: PhotoView['landmarks'] = {};
    for (const [name, i] of Object.entries(INDEX) as [PhotoLandmark, number][]) {
      const p = points[i];
      if (p) landmarks[name] = { x: p.x * mask.width, y: p.y * mask.height, visibility: p.visibility ?? 1 };
    }
    return { mask: { width: mask.width, height: mask.height, data }, landmarks };
  } finally {
    result.close();
  }
}
