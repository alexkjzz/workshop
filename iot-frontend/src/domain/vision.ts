export interface Face {
  // null for an unknown face.
  name: string | null;
  confidence: number;
}

export interface VisionDetection {
  detectedAt: string;
  persons: number;
  faces: Face[];
}

const DETECTIONS_SIZE = 50;
// A detection older than this no longer describes what the camera sees.
export const CURRENT_DETECTION_MS = 5000;

// Newest first, without duplicates.
export function mergeDetections(current: VisionDetection[], incoming: VisionDetection[]): VisionDetection[] {
  const byTime = new Map([...current, ...incoming].map((detection) => [detection.detectedAt, detection]));
  return [...byTime.values()]
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
    .slice(0, DETECTIONS_SIZE);
}

export function currentDetection(detections: VisionDetection[], now: number): VisionDetection | null {
  const latest = detections[0];
  return latest && now - Date.parse(latest.detectedAt) < CURRENT_DETECTION_MS ? latest : null;
}

export function hasUnknownFace(detection: VisionDetection | null): boolean {
  return detection?.faces.some((face) => face.name === null) ?? false;
}
