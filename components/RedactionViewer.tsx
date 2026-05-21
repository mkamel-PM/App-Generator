
import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ExtractedFrame } from '../types';

interface RedactionViewerProps {
  frame: ExtractedFrame;
  onClose: () => void;
  onSave: (id: string, rects: {x: number, y: number, w: number, h: number}[]) => void;
}

const RedactionViewer: React.FC<RedactionViewerProps> = ({ frame, onClose, onSave }) => {
  const [rects, setRects] = useState<{x: number, y: number, w: number, h: number}[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentRect, setCurrentRect] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const getRelativeCoords = (e: React.MouseEvent | React.TouchEvent) => {
    if (!imgRef.current) return { x: 0, y: 0 };
    const rect = imgRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    // Calculate normalized coordinates (0 to naturalWidth)
    const x = (clientX - rect.left) * (imgRef.current.naturalWidth / rect.width);
    const y = (clientY - rect.top) * (imgRef.current.naturalHeight / rect.height);
    return { x, y };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    const coords = getRelativeCoords(e);
    setIsDrawing(true);
    setCurrentRect({ ...coords, w: 0, h: 0 });
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !currentRect) return;
    const coords = getRelativeCoords(e);
    setCurrentRect({
      ...currentRect,
      w: coords.x - currentRect.x,
      h: coords.y - currentRect.y
    });
  };

  const handleEnd = () => {
    if (currentRect && Math.abs(currentRect.w) > 5 && Math.abs(currentRect.h) > 5) {
      // Normalize rect (handle negative w/h)
      const normalized = {
        x: currentRect.w < 0 ? currentRect.x + currentRect.w : currentRect.x,
        y: currentRect.h < 0 ? currentRect.y + currentRect.h : currentRect.y,
        w: Math.abs(currentRect.w),
        h: Math.abs(currentRect.h)
      };
      setRects([...rects, normalized]);
    }
    setIsDrawing(false);
    setCurrentRect(null);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] bg-black/98 backdrop-blur-3xl flex flex-col p-10 overflow-hidden">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h3 className="text-3xl font-black text-white">Manual Shield Editor</h3>
          <p className="text-[10px] text-gray-500 uppercase tracking-[0.4em] font-black mt-1">Precision PII Neutralization System</p>
        </div>
        <div className="flex gap-4">
          <button onClick={() => setRects([])} className="px-6 py-3 rounded-2xl bg-gray-900 border border-gray-800 text-gray-400 hover:text-white text-[10px] font-black tracking-widest transition-all">CLEAR OVERLAYS</button>
          <button onClick={() => onSave(frame.id, rects)} className="px-8 py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black tracking-widest shadow-[0_0_30px_rgba(37,99,235,0.4)] transition-all">COMMIT REDACTION</button>
          <button onClick={onClose} className="p-3 bg-gray-900 border border-gray-800 rounded-full hover:bg-red-600/20 hover:text-red-500 hover:border-red-500/30 text-white transition-all">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center relative overflow-hidden bg-black/50 rounded-[3rem] border border-gray-800 cursor-crosshair group shadow-inner"
           onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
           onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}>
        
        <div className="relative select-none" ref={containerRef}>
          {/* Always show the original source for editing to prevent double-blurring artifacts */}
          <img ref={imgRef} src={frame.originalDataUrl} className="max-h-[75vh] w-auto object-contain pointer-events-none shadow-2xl rounded-lg" />
          
          {/* Natural Scale Redaction Layers */}
          {imgRef.current && (
            <div className="absolute inset-0 pointer-events-none" style={{ 
                width: imgRef.current.clientWidth, 
                height: imgRef.current.clientHeight,
                top: 0, left: 0
            }}>
              {rects.map((r, i) => {
                const s = imgRef.current!.clientWidth / imgRef.current!.naturalWidth;
                return (
                  <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} key={i} className="absolute border-2 border-blue-500/50 bg-blue-500/10 backdrop-blur-3xl" style={{
                    left: r.x * s, top: r.y * s, width: r.w * s, height: r.h * s
                  }} />
                );
              })}
              {currentRect && (
                <div className="absolute border-2 border-dashed border-white/60 bg-white/5" style={{
                  left: (currentRect.w < 0 ? currentRect.x + currentRect.w : currentRect.x) * (imgRef.current.clientWidth / imgRef.current.naturalWidth),
                  top: (currentRect.h < 0 ? currentRect.y + currentRect.h : currentRect.y) * (imgRef.current.clientHeight / imgRef.current.naturalHeight),
                  width: Math.abs(currentRect.w) * (imgRef.current.clientWidth / imgRef.current.naturalWidth),
                  height: Math.abs(currentRect.h) * (imgRef.current.clientHeight / imgRef.current.naturalHeight)
                }} />
              )}
            </div>
          )}
        </div>
      </div>
      
      <div className="mt-8 flex justify-center gap-10 text-[9px] font-black uppercase tracking-[0.5em] text-gray-700">
        <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-blue-500 rounded-full" /> MANUAL OVERLAY MODE</span>
        <span>•</span>
        <span>DRAG TO ADD PRIVACY BOX</span>
        <span>•</span>
        <span>PII SCANNING RECOMMENDED</span>
      </div>
    </motion.div>
  );
};

export default RedactionViewer;
