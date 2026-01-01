
export interface AudioFileState {
  file: File;
  buffer: AudioBuffer;
  fileName: string;
  duration: number;
}

export interface TrimRegion {
  start: number;
  end: number;
}

// Added missing interface to fix build error in services/geminiService.ts
export interface GeminiAnalysisResult {
  start: number;
  end: number;
  reason?: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  READY = 'READY',
  PLAYING = 'PLAYING',
  ERROR = 'ERROR'
}
