
import React from 'react';
import * as ReactWindow from 'react-window';
import _AutoSizer from 'react-virtualized-auto-sizer';
import { motion, AnimatePresence } from 'framer-motion';
import { ExtractedFrame } from '../types';

const List = (ReactWindow as any).FixedSizeList;
const AutoSizer = _AutoSizer as any;

interface FrameGalleryProps {
  frames: ExtractedFrame[];
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onToggleAll: (selected: boolean) => void;
  onDelete: (id: string) => void;
  onView: (frame: ExtractedFrame) => void;
  onRestore?: (id: string) => void;
  onUndoBlur?: (id: string) => void;
  onRefine: (frame: ExtractedFrame) => void;
}

const FrameGallery: React.FC<FrameGalleryProps> = ({ 
  frames, 
  selectedIds, 
  onToggleSelection, 
  onToggleAll,
  onDelete,
  onView,
  onRestore,
  onUndoBlur
}) => {
  const allSelectedInCurrentView = frames.length > 0 && frames.every(f => selectedIds.has(f.id));

  const getGridConfig = (containerWidth: number) => {
    if (containerWidth < 640) return { columns: 1, gap: 24 };
    if (containerWidth < 1024) return { columns: 2, gap: 32 };
    if (containerWidth < 1440) return { columns: 2, gap: 32 };
    return { columns: 3, gap: 32 };
  };

  const FrameItem = ({ frame, isSelected }: { frame: ExtractedFrame, isSelected: boolean }) => {
    const isFiltered = !!frame.filterReason;

    return (
      <motion.div layout className={`group relative bg-gray-900 rounded-[2rem] overflow-hidden border transition-all duration-500 shadow-2xl h-full flex flex-col ${isSelected ? 'border-blue-500 ring-[12px] ring-blue-500/10' : 'border-gray-800 hover:border-gray-600'}`}>
        <div className="aspect-video bg-gray-950 relative overflow-hidden flex-shrink-0 cursor-pointer" onClick={() => onToggleSelection(frame.id)}>
          <img src={frame.dataUrl} alt="Screen" className={`w-full h-full object-contain transition-transform duration-1000 ease-out ${isSelected ? 'scale-110' : 'group-hover:scale-105'}`} loading="lazy" />
          
          {/* Checkbox Overlay */}
          <div className={`absolute top-5 left-5 w-7 h-7 rounded-xl border-2 flex items-center justify-center transition-all backdrop-blur-xl ${isSelected ? 'bg-blue-600 border-blue-400 shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-black/40 border-white/20 hover:border-white/40'}`}>
             {isSelected && <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" /></svg>}
          </div>

          {/* Status Badges */}
          <div className="absolute top-5 right-5 flex flex-col gap-2 items-end">
             {frame.redacted && (
               <motion.span initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="bg-purple-600 text-white text-[8px] px-3 py-1 rounded-full font-black uppercase tracking-widest shadow-2xl border border-purple-400/30">
                 SHIELD ACTIVE
               </motion.span>
             )}
             {isFiltered ? (
               <span className="bg-orange-600/90 text-white text-[8px] px-3 py-1 rounded-full font-black uppercase tracking-widest shadow-2xl border border-orange-400/30 backdrop-blur-md">{frame.filterReason}</span>
             ) : (
               <span className="bg-emerald-600/90 text-white text-[8px] px-3 py-1 rounded-full font-black uppercase tracking-widest shadow-2xl border border-emerald-400/30 backdrop-blur-md">VALIDATED</span>
             )}
          </div>

          <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-xl text-[10px] font-black font-mono py-1 px-3 rounded-xl border border-white/10 text-blue-400 shadow-2xl">
            {frame.timestamp.toFixed(2)}s
          </div>
        </div>
        
        <div className="p-4 flex items-center justify-between bg-gray-900 mt-auto border-t border-gray-800/50">
          <div className="flex gap-2">
            <button onClick={(e) => { e.stopPropagation(); onView(frame); }} title="Analyze & Redact" className="p-2.5 bg-gray-800 hover:bg-blue-600/20 rounded-xl transition-all text-blue-400 border border-gray-700/50 active:scale-90">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            </button>
            {frame.redacted && onUndoBlur && (
              <button onClick={(e) => { e.stopPropagation(); onUndoBlur(frame.id); }} title="Restore Original" className="p-2.5 bg-gray-800 hover:bg-orange-600/20 rounded-xl transition-all text-orange-400 border border-gray-700/50 active:scale-90">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
              </button>
            )}
          </div>
          
          <div className="flex gap-2">
            {onRestore && <button onClick={(e) => { e.stopPropagation(); onRestore(frame.id); }} className="p-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white shadow-lg active:scale-90"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>}
            <button onClick={(e) => { e.stopPropagation(); onDelete(frame.id); }} className="p-2.5 bg-gray-800 hover:bg-red-600/20 rounded-xl text-gray-500 hover:text-red-400 transition-all border border-transparent hover:border-red-600/30 active:scale-90">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
      </motion.div>
    );
  };

  if (frames.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-32 bg-gray-900/20 rounded-[3rem] border-4 border-dashed border-gray-800/50 h-full backdrop-blur-sm">
        <svg className="w-20 h-20 text-gray-800 mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
        <p className="text-gray-600 font-black uppercase tracking-[0.4em] text-xs">Awaiting Extraction Results</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-8">
      <div className="flex items-center gap-6 py-3 px-6 bg-gray-900/60 rounded-2xl border border-gray-800 shadow-2xl backdrop-blur-xl flex-shrink-0">
        <input type="checkbox" checked={allSelectedInCurrentView} onChange={(e) => onToggleAll(e.target.checked)} className="w-5 h-5 rounded-lg bg-gray-800 border-gray-700 text-blue-600 accent-blue-600 cursor-pointer" />
        <span className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em]">{frames.length} TOTAL FRAMES IN VIEW</span>
      </div>

      <div className="flex-1 rounded-[3rem] overflow-hidden border border-gray-800/50 bg-gray-950/20 relative min-h-0 shadow-inner">
        <AutoSizer>
          {({ height, width }: { height: number, width: number }) => {
            const { columns, gap } = getGridConfig(width);
            const columnWidth = (width - (columns + 1) * gap) / columns;
            const rowHeight = (columnWidth * (9/16)) + 70; 
            const rowCount = Math.ceil(frames.length / columns);

            return (
              <List height={height} itemCount={rowCount} itemSize={rowHeight + gap} width={width} itemData={{ columns, columnWidth, gap, frames, selectedIds }}>
                {({ index, style, data }: any) => {
                  const { columns, columnWidth, gap, frames, selectedIds } = data;
                  const rowFrames = frames.slice(index * columns, (index + 1) * columns);
                  return (
                    <div style={{ ...style, display: 'flex', paddingLeft: gap, paddingTop: gap }}>
                      {rowFrames.map((f: ExtractedFrame) => (
                        <div key={f.id} style={{ width: columnWidth, marginRight: gap, height: rowHeight }}>
                          <FrameItem frame={f} isSelected={selectedIds.has(f.id)} />
                        </div>
                      ))}
                    </div>
                  );
                }}
              </List>
            );
          }}
        </AutoSizer>
      </div>
    </div>
  );
};

export default FrameGallery;
