import React, { useEffect, useRef, useState } from 'react';

interface WaveformProps {
  buffer: AudioBuffer;
  region: { start: number; end: number };
  currentTime: number;
  onRegionChange: (start: number, end: number) => void;
  onSeek: (time: number) => void;
  color?: string;
}

const Waveform: React.FC<WaveformProps> = ({ 
  buffer, 
  region, 
  currentTime, 
  onRegionChange, 
  onSeek,
  color = '#38bdf8' 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragTarget, setDragTarget] = useState<'start' | 'end' | null>(null);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.clearRect(0, 0, width, height);
    
    // 1. Dibujar forma de onda de fondo (zona inactiva)
    ctx.fillStyle = '#334155'; 
    ctx.beginPath();
    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }

    const duration = buffer.duration;
    const startPx = (region.start / duration) * width;
    const endPx = (region.end / duration) * width;
    const currentPx = (currentTime / duration) * width;

    // 2. Zona Activa
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = color;
    ctx.fillRect(startPx, 0, endPx - startPx, height);
    ctx.globalCompositeOperation = 'source-over';

    // 3. Resaltado de selección
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fillRect(startPx, 0, endPx - startPx, height);

    // 4. Cabezal de reproducción
    ctx.fillStyle = '#fbbf24'; 
    ctx.fillRect(currentPx, 0, 2, height);

    // --- MANIJAS (HANDLES) ---
    const handleWidth = 4;
    
    // Función auxiliar para dibujar manijas
    const drawHandle = (x: number, isStart: boolean) => {
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        
        // Línea vertical
        ctx.fillRect(x - (handleWidth / 2), 0, handleWidth, height);
        
        // Triángulo superior "agarradera"
        ctx.beginPath();
        if (isStart) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 20);
            ctx.lineTo(x + 12, 0);
        } else {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 20);
            ctx.lineTo(x - 12, 0);
        }
        ctx.fill();
        ctx.shadowBlur = 0; // Reset shadow
    };

    drawHandle(startPx, true);
    drawHandle(endPx, false);

    // Tooltip de tiempo mientras se arrastra
    if (dragTarget) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(width / 2 - 40, 10, 80, 24);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        const timeVal = dragTarget === 'start' ? region.start : region.end;
        ctx.fillText(timeVal.toFixed(2) + 's', width / 2, 26);
    }
  };

  useEffect(() => {
    const resize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.offsetWidth;
        canvasRef.current.height = containerRef.current.offsetHeight;
        draw();
      }
    };
    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, [buffer]);

  useEffect(() => {
    draw();
  }, [buffer, region, currentTime, dragTarget]);

  // --- LÓGICA DE INTERACCIÓN ---

  const getClientX = (e: React.PointerEvent) => {
     const canvas = canvasRef.current;
     if (!canvas) return 0;
     const rect = canvas.getBoundingClientRect();
     return e.clientX - rect.left;
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Detección basada en píxeles (Hit Testing)
    const x = getClientX(e);
    const { width } = canvas;
    const { duration } = buffer;

    const startPx = (region.start / duration) * width;
    const endPx = (region.end / duration) * width;
    
    // Radio de toque de 30px para facilitar uso en móviles
    const HIT_THRESHOLD = 30; 

    const distStart = Math.abs(x - startPx);
    const distEnd = Math.abs(x - endPx);

    let target: 'start' | 'end' | null = null;
    
    // Determinar qué manija está más cerca dentro del umbral
    if (distStart < HIT_THRESHOLD && distStart <= distEnd) {
        target = 'start';
    } else if (distEnd < HIT_THRESHOLD) {
        target = 'end';
    }

    if (target) {
        setDragTarget(target);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault(); 
    } else {
        // Si no tocó ninguna manija, es un Seek (saltar reproducción)
        const time = (x / width) * duration;
        onSeek(Math.min(Math.max(0, time), duration));
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragTarget) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const x = getClientX(e);
    const { width } = canvas;
    const { duration } = buffer;
    
    // Convertir posición X actual a Tiempo
    let newTime = (x / width) * duration;
    newTime = Math.max(0, Math.min(newTime, duration));
    
    const minDuration = 0.5; // Duración mínima del clip

    if (dragTarget === 'start') {
        const maxStart = region.end - minDuration;
        const finalStart = Math.min(newTime, maxStart);
        onRegionChange(finalStart, region.end);
    } else if (dragTarget === 'end') {
        const minEnd = region.start + minDuration;
        const finalEnd = Math.max(newTime, minEnd);
        onRegionChange(region.start, finalEnd);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setDragTarget(null);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div 
        ref={containerRef} 
        className="w-full h-32 bg-slate-800 rounded-lg relative overflow-hidden touch-none shadow-inner select-none"
    >
      <canvas 
        ref={canvasRef} 
        className="w-full h-full cursor-ew-resize active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        title="Arrastra las barras blancas para recortar"
      />
    </div>
  );
};

export default Waveform;