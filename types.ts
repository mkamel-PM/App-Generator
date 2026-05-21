
export interface ExtractedFrame {
  id: string;
  timestamp: number;
  dataUrl: string;
  originalDataUrl: string; // Keep source to allow undo and high-quality re-processing
  blurScore: number;
  edgeIntensity: number; // Mean gradient magnitude
  hash: string;
  hashDiff: number;     // Visual distance from the previous frame
  loadingScore: number; // Ratio of skeleton-like pixels detected
  textRatio: number;    // Ratio of text-like pixels detected
  isStable: boolean;
  isUnique: boolean;
  filterReason?: 'blurry' | 'duplicate' | 'manual-restored' | 'transition' | 'overlay' | 'loading' | 'typing' | 'dimmed';
  redacted?: boolean;
}

export interface FilterSettings {
  blurThreshold: number;
  similarityThreshold: number;
  loadingSensitivity: number;
  transitionSensitivity: number; // Sensitivity for detecting movement/transitions
  extractionFps: number;         // Frequency of frame extraction
  showDimmed: boolean;
}

export interface ProcessingStats {
  totalFramesAnalyzed: number;
  duplicateCount: number;
  blurryCount: number;
  stableCount: number;
  transitionCount: number;
  loadingCount: number;
  typingCount: number;
  dimmedCount: number;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  EXTRACTING = 'EXTRACTING',
  COMPLETED = 'COMPLETED',
  AUTO_BLURRING = 'AUTO_BLURRING'
}
