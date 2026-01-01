// Define global interface for lamejs since we are loading it via script tag
declare global {
  interface Window {
    lamejs: any;
  }
}

// Formats seconds into MM:SS.ms
export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
};

// Reads a File object and decodes it into an AudioBuffer
export const decodeAudioFile = async (file: File, context: AudioContext): Promise<AudioBuffer> => {
  const arrayBuffer = await file.arrayBuffer();
  return await context.decodeAudioData(arrayBuffer);
};

// Helper: Apply fades and extract raw PCM samples (Float32)
const getProcessedSamples = (
  buffer: AudioBuffer,
  optStart: number,
  optEnd: number,
  fadeInDuration: number,
  fadeOutDuration: number
) => {
  const startOffset = Math.floor(optStart * buffer.sampleRate);
  const endOffset = Math.floor(optEnd * buffer.sampleRate);
  const frameCount = endOffset - startOffset;
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;

  const fadeInSamples = Math.floor(fadeInDuration * sampleRate);
  const fadeOutSamples = Math.floor(fadeOutDuration * sampleRate);

  const processedChannels: Float32Array[] = [];

  for (let c = 0; c < numChannels; c++) {
    const rawData = buffer.getChannelData(c);
    const output = new Float32Array(frameCount);

    for (let i = 0; i < frameCount; i++) {
      let sample = rawData[startOffset + i];

      // Calculate Fade Multiplier
      let multiplier = 1.0;

      // Fade In
      if (i < fadeInSamples && fadeInSamples > 0) {
        multiplier = i / fadeInSamples;
      }

      // Fade Out
      const distFromEnd = frameCount - 1 - i;
      if (distFromEnd < fadeOutSamples && fadeOutSamples > 0) {
        multiplier *= distFromEnd / fadeOutSamples;
      }

      sample = sample * multiplier;
      
      // Clamp
      output[i] = Math.max(-1, Math.min(1, sample));
    }
    processedChannels.push(output);
  }

  return { processedChannels, frameCount, sampleRate, numChannels };
};

// Encodes an AudioBuffer to a WAV Blob
export const audioBufferToWav = (
  buffer: AudioBuffer, 
  optStart: number, 
  optEnd: number, 
  fadeInDuration: number = 0, 
  fadeOutDuration: number = 0
): Blob => {
  const { processedChannels, frameCount, sampleRate, numChannels } = getProcessedSamples(
    buffer, optStart, optEnd, fadeInDuration, fadeOutDuration
  );

  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  
  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  
  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write interleaved 16-bit PCM
  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = processedChannels[c][i];
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }
  
  return new Blob([arrayBuffer], { type: 'audio/wav' });
};

// Encodes an AudioBuffer to an MP3 Blob using global lamejs
export const audioBufferToMp3 = (
  buffer: AudioBuffer,
  optStart: number,
  optEnd: number,
  fadeInDuration: number = 0,
  fadeOutDuration: number = 0
): Blob => {
  // Check if lamejs is loaded via window object
  if (!window.lamejs) {
    throw new Error("La librería de codificación MP3 (lamejs) no se ha cargado correctamente.");
  }

  const { processedChannels, frameCount, sampleRate, numChannels } = getProcessedSamples(
    buffer, optStart, optEnd, fadeInDuration, fadeOutDuration
  );

  // lamejs limits: supports mono or stereo. If > 2 channels, take first 2.
  const encodingChannels = Math.min(numChannels, 2);
  
  // Convert Float32 samples to Int16
  const sampleData: Int16Array[] = [];
  for(let c = 0; c < encodingChannels; c++) {
    const channelData = processedChannels[c];
    const int16 = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const s = channelData[i];
      // Simple clipping
      const clamped = Math.max(-1, Math.min(1, s));
      int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    }
    sampleData.push(int16);
  }

  // Initialize Encoder using window.lamejs
  const mp3encoder = new window.lamejs.Mp3Encoder(encodingChannels, sampleRate, 128); // 128kbps
  const mp3Data = [];

  // Encode in chunks
  const blockSize = 1152; // standard mp3 frame size
  
  for (let i = 0; i < frameCount; i += blockSize) {
    const leftChunk = sampleData[0].subarray(i, i + blockSize);
    const rightChunk = encodingChannels > 1 ? sampleData[1].subarray(i, i + blockSize) : undefined;
    
    // encodeBuffer expects Int16Arrays
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  // Finish encoding
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
};

// Helper to convert Blob to Base64
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};