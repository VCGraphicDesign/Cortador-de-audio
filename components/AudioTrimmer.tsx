
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Waveform from './Waveform';
import { AudioFileState, TrimRegion } from '../types';
import { formatTime, audioBufferToWav, audioBufferToMp3 } from '../utils/audioUtils';
import { NativeAudio } from '@capacitor-community/native-audio';
import { Capacitor } from '@capacitor/core';

interface AudioTrimmerProps {
  audioState: AudioFileState;
  onReset: () => void;
}

const AudioTrimmer: React.FC<AudioTrimmerProps> = ({ audioState, onReset }) => {
  const [region, setRegion] = useState<TrimRegion>({ start: 0, end: audioState.duration });
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const [fadeInDuration, setFadeInDuration] = useState<number>(0);
  const [fadeOutDuration, setFadeOutDuration] = useState<number>(0);
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('mp3');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nativeAudioAssetId = useRef<string>('trimmed-audio');
  const isNative = Capacitor.getPlatform() !== 'web';

  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  const stopPlayback = useCallback(async () => {
    // Detener Web Audio API
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch (e) {}
      sourceNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      try { gainNodeRef.current.gain.cancelScheduledValues(0); } catch(e) {}
    }
    
    // Detener audio nativo en móvil
    if (isNative) {
      try {
        await NativeAudio.stop({ assetId: nativeAudioAssetId.current });
      } catch (e) {
        console.log('Error stopping native audio:', e);
      }
    }
    
    setIsPlaying(false);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  }, [isNative]);

  const prepareNativeAudio = useCallback(async () => {
    if (!isNative) return;
    
    try {
      // Crear blob del segmento de audio
      const blob = audioBufferToMp3(audioState.buffer, region.start, region.end, fadeInDuration, fadeOutDuration);
      
      // Convertir a base64 para el plugin nativo
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const base64data = result.split(',')[1];
          resolve(base64data);
        };
        reader.readAsDataURL(blob);
      });
      
      // Preparar audio nativo
      await NativeAudio.unload({ assetId: nativeAudioAssetId.current });
      await NativeAudio.preload({
        assetId: nativeAudioAssetId.current,
        assetPath: `data:audio/mp3;base64,${base64}`,
        audioChannelNum: 1,
        isUrl: true
      });
    } catch (error) {
      console.error('Error preparing native audio:', error);
    }
  }, [isNative, audioState.buffer, region.start, region.end, fadeInDuration, fadeOutDuration]);

  const startPlayback = useCallback(async () => {
    if (isNative) {
      // Usar audio nativo en móvil
      await stopPlayback();
      await prepareNativeAudio();
      
      try {
        await NativeAudio.play({ 
          assetId: nativeAudioAssetId.current,
          time: currentTime - region.start 
        });
        setIsPlaying(true);
        
        // Simular progreso del tiempo
        const duration = region.end - region.start;
        const startTime = currentTime - region.start;
        let elapsed = startTime;
        
        const updateProgress = () => {
          elapsed += 0.1;
          if (elapsed >= duration) {
            setIsPlaying(false);
            setCurrentTime(region.start);
          } else {
            setCurrentTime(region.start + elapsed);
            setTimeout(updateProgress, 100);
          }
        };
        setTimeout(updateProgress, 100);
      } catch (error) {
        console.error('Error playing native audio:', error);
        // Fallback a Web Audio API
      }
    }
    
    // Web Audio API (fallback o uso en web)
    if (!audioContextRef.current) return;
    await stopPlayback();

    const ctx = audioContextRef.current;
    const source = ctx.createBufferSource();
    source.buffer = audioState.buffer;

    const gainNode = ctx.createGain();
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    let startOffset = currentTime;
    if (startOffset >= region.end || startOffset < region.start) {
      startOffset = region.start;
    }

    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(1, now);

    if (fadeInDuration > 0) {
      const relativeStart = startOffset - region.start;
      if (relativeStart < fadeInDuration) {
        const startVolume = Math.max(0, relativeStart / fadeInDuration);
        const timeRemainingInFade = fadeInDuration - relativeStart;
        gainNode.gain.setValueAtTime(startVolume, now);
        gainNode.gain.linearRampToValueAtTime(1, now + timeRemainingInFade);
      }
    }

    if (fadeOutDuration > 0) {
      const relativeStart = startOffset - region.start;
      const regionDuration = region.end - region.start;
      const fadeOutStartRelative = regionDuration - fadeOutDuration;
      const timeUntilFadeOut = fadeOutStartRelative - relativeStart;

      if (timeUntilFadeOut > 0) {
        gainNode.gain.setValueAtTime(1, now + timeUntilFadeOut);
        gainNode.gain.linearRampToValueAtTime(0, now + timeUntilFadeOut + fadeOutDuration);
      } else {
        const timeInsideFade = -timeUntilFadeOut;
        const timeRemainingInFade = fadeOutDuration - timeInsideFade;
        if (timeRemainingInFade > 0) {
          const startVolume = 1.0 - (timeInsideFade / fadeOutDuration);
          gainNode.gain.setValueAtTime(startVolume, now);
          gainNode.gain.linearRampToValueAtTime(0, now + timeRemainingInFade);
        } else {
          gainNode.gain.setValueAtTime(0, now);
        }
      }
    }

    source.start(0, startOffset);
    startTimeRef.current = ctx.currentTime - startOffset;
    sourceNodeRef.current = source;
    gainNodeRef.current = gainNode;
    setIsPlaying(true);

    const updateLoop = () => {
      if (!audioContextRef.current) return;
      const current = audioContextRef.current.currentTime - startTimeRef.current;
      if (current >= region.end) {
        stopPlayback();
        setCurrentTime(region.start);
      } else {
        setCurrentTime(current);
        animationFrameRef.current = requestAnimationFrame(updateLoop);
      }
    };
    animationFrameRef.current = requestAnimationFrame(updateLoop);
  }, [audioState.buffer, currentTime, region, stopPlayback, fadeInDuration, fadeOutDuration, isNative, prepareNativeAudio]);

  const togglePlay = () => {
    if (isPlaying) stopPlayback();
    else startPlayback();
  };

  const handleSeek = (time: number) => {
    stopPlayback();
    setCurrentTime(time);
  };

  const handleDownload = async () => {
    try {
      let blob: Blob;
      const nameParts = audioState.fileName.split('.');
      nameParts.pop();
      const baseName = nameParts.join('.');
      const fileName = `${baseName}_recortado.${exportFormat}`;

      if (exportFormat === 'mp3') {
        blob = audioBufferToMp3(audioState.buffer, region.start, region.end, fadeInDuration, fadeOutDuration);
      } else {
        blob = audioBufferToWav(audioState.buffer, region.start, region.end, fadeInDuration, fadeOutDuration);
      }

      if (isNative) {
        // Guardar en dispositivo móvil
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const base64Data = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.readAsDataURL(blob);
        });

        await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: Directory.Documents
        });

        alert(`Archivo guardado en Documentos: ${fileName}`);
        onReset();
      } else {
        // Comportamiento web original
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = fileName; 
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
          URL.revokeObjectURL(url);
          onReset();
        }, 1500);
      }
    } catch (error) {
      console.error(error);
      alert("Error al exportar.");
    }
  };

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="bg-slate-800 p-4 rounded-xl shadow-lg border border-slate-700">
        <Waveform 
          buffer={audioState.buffer} 
          region={region} 
          currentTime={currentTime} 
          onRegionChange={(s, e) => setRegion({ start: s, end: e })}
          onSeek={handleSeek}
        />
        <div className="flex justify-between text-xs text-slate-400 mt-2 font-mono">
          <span>{formatTime(0)}</span>
          <span className="text-brand-400 font-bold">{formatTime(currentTime)}</span>
          <span>{formatTime(audioState.duration)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 p-3 rounded-lg border border-slate-700">
          <label className="text-xs text-slate-400 block mb-1">Inicio (s)</label>
          <input 
            type="number" step="0.1"
            className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:border-brand-500 outline-none"
            value={region.start.toFixed(2)}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) setRegion(prev => ({ ...prev, start: Math.min(val, prev.end) }));
            }}
          />
        </div>
        
        <div className="bg-slate-800 p-3 rounded-lg border border-slate-700">
          <label className="text-xs text-slate-400 block mb-1">Fin (s)</label>
          <input 
            type="number" step="0.1"
            className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:border-brand-500 outline-none"
            value={region.end.toFixed(2)}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val)) setRegion(prev => ({ ...prev, end: Math.max(val, prev.start) }));
            }}
          />
        </div>

        <div 
          className={`bg-slate-800 p-3 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${fadeInDuration > 0 ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-700 hover:border-slate-500'}`}
          onClick={() => setFadeInDuration(prev => prev > 0 ? 0 : 2)}
        >
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase font-bold">Fade In</span>
            <span className={`text-sm font-bold ${fadeInDuration > 0 ? 'text-brand-400' : 'text-slate-400'}`}>2 Segundos</span>
          </div>
          <div className={`w-4 h-4 rounded border ${fadeInDuration > 0 ? 'bg-brand-500 border-brand-500' : 'border-slate-600'}`}></div>
        </div>

        <div 
          className={`bg-slate-800 p-3 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${fadeOutDuration > 0 ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-700 hover:border-slate-500'}`}
          onClick={() => setFadeOutDuration(prev => prev > 0 ? 0 : 2)}
        >
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase font-bold">Fade Out</span>
            <span className={`text-sm font-bold ${fadeOutDuration > 0 ? 'text-brand-400' : 'text-slate-400'}`}>2 Segundos</span>
          </div>
          <div className={`w-4 h-4 rounded border ${fadeOutDuration > 0 ? 'bg-brand-500 border-brand-500' : 'border-slate-600'}`}></div>
        </div>
      </div>

      <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
         <div>
           <span className="text-xs text-slate-400 block uppercase tracking-wider font-bold">Duración Final</span>
           <span className="text-2xl font-bold text-brand-400 font-mono">
             {formatTime(region.end - region.start)}
           </span>
         </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button 
          onClick={togglePlay} 
          className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-4 rounded-xl font-bold transition-all flex justify-center items-center gap-2"
        >
          {isPlaying ? "Pausar" : "Reproducir"}
        </button>
        
        <div className="flex-1 flex bg-brand-600 rounded-xl overflow-hidden shadow-lg shadow-brand-900/20">
          <div className="flex bg-brand-700 p-1 gap-1">
            <button 
              onClick={() => setExportFormat('mp3')}
              className={`px-4 text-xs font-black rounded-lg transition-all ${exportFormat === 'mp3' ? 'bg-yellow-400 text-green-800' : 'text-brand-300 hover:bg-brand-600'}`}
            >
              MP3
            </button>
            <button 
              onClick={() => setExportFormat('wav')}
              className={`px-4 text-xs font-black rounded-lg transition-all ${exportFormat === 'wav' ? 'bg-yellow-400 text-green-800' : 'text-brand-300 hover:bg-brand-600'}`}
            >
              WAV
            </button>
          </div>
          <button 
            onClick={handleDownload} 
            className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-4 font-bold border-l border-brand-500/50 transition-all active:scale-95"
          >
            Descargar Recorte
          </button>
        </div>
      </div>

      <button onClick={onReset} className="text-slate-500 hover:text-slate-300 text-sm underline self-center">
        Cargar otro archivo
      </button>
    </div>
  );
};

export default AudioTrimmer;
