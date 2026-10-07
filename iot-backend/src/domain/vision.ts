export interface Face {
  // null for an unknown face.
  name: string | null;
  confidence: number;
}

export interface VisionDetection {
  detectedAt: Date;
  persons: number;
  faces: Face[];
}
