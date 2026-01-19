import React, { useState, useCallback } from 'react';
import { AppStatus, AudioFileState } from './types';
import { decodeAudioFile } from './utils/audioUtils';
import AudioTrimmer from './components/AudioTrimmer';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [audioState, setAudioState] = useState<AudioFileState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const file = files[0];
    const validTypes = ['audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/ogg', 'audio/flac', 'audio/mp4'];
    
    // Loose check, browser decodeAudioData is the real test
    if (!file.type.startsWith('audio/') && !validTypes.includes(file.type)) {
      setErrorMsg("Formato de archivo no soportado. Intente mp3, wav, ogg.");
      return;
    }

    setStatus(AppStatus.LOADING);
    setErrorMsg(null);

    try {
      const context = new (window.AudioContext || (window as any).webkitAudioContext)();
      const buffer = await decodeAudioFile(file, context);
      
      setAudioState({
        file,
        buffer,
        fileName: file.name,
        duration: buffer.duration
      });
      setStatus(AppStatus.READY);
      
      // Cleanup context immediately as we just needed it for decoding into a buffer
      context.close();
    } catch (err) {
      console.error(err);
      setErrorMsg("Error al decodificar el audio. El archivo podría estar corrupto.");
      setStatus(AppStatus.ERROR);
    }
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const resetApp = () => {
    setAudioState(null);
    setStatus(AppStatus.IDLE);
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 py-4 px-6 shadow-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/icon-192.png" alt="Audio Cutter" className="w-12 h-12" />
            <div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-brand-400 to-indigo-400">
                Cortador de audio
              </h1>
              <p className="text-xs text-slate-400">Directo en tu dispositivo</p>
            </div>
          </div>
          <div className="text-xs text-slate-500 hidden sm:block">
            v1.0.0 • Client-Side
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-3xl mx-auto p-4 md:p-8 flex flex-col justify-center">
        
        {status === AppStatus.IDLE || status === AppStatus.ERROR ? (
          <div 
            className={`
              flex flex-col items-center justify-center border-4 border-dashed rounded-3xl p-10 transition-all duration-300
              ${dragActive ? 'border-brand-500 bg-slate-800/50 scale-105' : 'border-slate-700 bg-slate-800/20'}
              min-h-[400px]
            `}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6 shadow-lg">
              <img src="/icon-192.png" alt="Audio Cutter" className="w-16 h-16" />
            </div>
            
            <h2 className="text-2xl font-bold mb-2">Sube tu audio</h2>
            <p className="text-slate-400 text-center mb-8 max-w-sm">
              Arrastra un archivo (mp3, wav, flac) o haz clic para seleccionar.
              <br/>
              <span className="text-xs opacity-60">Procesamiento 100% local. El archivo no sale de tu red.</span>
            </p>

            <label className="cursor-pointer bg-brand-600 hover:bg-brand-500 text-white px-8 py-3 rounded-full font-bold shadow-lg transition-transform hover:scale-105 active:scale-95">
              Seleccionar Archivo
              <input 
                type="file" 
                className="hidden" 
                accept="audio/*"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </label>

            {errorMsg && (
              <div className="mt-6 p-4 bg-red-900/50 border border-red-700 text-red-200 rounded-lg text-sm max-w-md text-center">
                {errorMsg}
              </div>
            )}
          </div>
        ) : status === AppStatus.LOADING ? (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="w-16 h-16 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-brand-400 font-medium animate-pulse">Decodificando audio...</p>
          </div>
        ) : (
          audioState && <AudioTrimmer audioState={audioState} onReset={resetApp} />
        )}

      </main>
    </div>
  );
};

export default App;
