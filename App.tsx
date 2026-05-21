
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { motion, AnimatePresence } from 'framer-motion';
import { ProcessingStatus, ExtractedFrame, ProcessingStats, FilterSettings } from './types';
import { calculateAverageHash, calculateImageMetrics, hammingDistance, getLoadingMetrics, analyzeOverlayState, applyRedaction } from './services/videoProcessor';
import { detectPII, BoundingBox } from './services/geminiService';
import FrameGallery from './components/FrameGallery';
import RedactionViewer from './components/RedactionViewer';

const TEMPORAL_LOOKAHEAD = 0.15; 

type ViewMode = 'valid' | 'filtered';

interface FrameMetadata {
  hash: string;
  metrics: { blurScore: number, edgeIntensity: number };
  loading: { skeletonRatio: number, textRatio: number, bgRatio: number };
  overlay: { isDimmed: boolean, hasPopup: boolean };
  dataUrl: string;
}

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [rawCandidates, setRawCandidates] = useState<ExtractedFrame[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('valid');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewFrame, setPreviewFrame] = useState<ExtractedFrame | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const [settings, setSettings] = useState<FilterSettings>({
    blurThreshold: 180,
    similarityThreshold: 5, 
    loadingSensitivity: 0.15, // Default sensitivity for "Placeholder Grey" detection
    transitionSensitivity: 10, 
    extractionFps: 2,
    showDimmed: false
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('video/')) {
      alert('Invalid file type. Please upload a video file.');
      return;
    }
    setRawCandidates([]);
    setSelectedIds(new Set());
    setPreviewFrame(null);
    setStatus(ProcessingStatus.IDLE);
    setViewMode('valid');
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const getFrameMetadata = async (time: number): Promise<FrameMetadata | null> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    
    return new Promise((resolve) => {
      const onSeeked = async () => {
        video.removeEventListener('seeked', onSeeked);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const dataUrl = canvas.toDataURL('image/png');
        const metrics = calculateImageMetrics(canvas);
        const hash = await calculateAverageHash(canvas);
        const loading = getLoadingMetrics(canvas);
        const overlay = analyzeOverlayState(canvas);
        resolve({ hash, metrics, loading, overlay, dataUrl });
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = Math.max(0, Math.min(time, video.duration));
    });
  };

  const processVideo = async () => {
    if (!videoRef.current) return;
    setStatus(ProcessingStatus.EXTRACTING);
    setRawCandidates([]);
    setSelectedIds(new Set());
    setProgress(0);

    const duration = videoRef.current.duration;
    const candidates: ExtractedFrame[] = [];
    let prevHash = '';
    const interval = 1 / settings.extractionFps;

    for (let time = 0; time < duration; time += interval) {
      await new Promise(r => setTimeout(r, 40)); 
      
      const metadata = await getFrameMetadata(time);
      if (!metadata) continue;

      const post = await getFrameMetadata(Math.min(duration, time + TEMPORAL_LOOKAHEAD));
      const postDiff = post ? hammingDistance(metadata.hash, post.hash) : 0;
      const hashDiff = prevHash ? hammingDistance(metadata.hash, prevHash) : 0;
      const isSettled = postDiff <= 2; 

      candidates.push({
        id: Math.random().toString(36).substr(2, 9),
        timestamp: time,
        dataUrl: metadata.dataUrl,
        originalDataUrl: metadata.dataUrl,
        blurScore: metadata.metrics.blurScore,
        edgeIntensity: metadata.metrics.edgeIntensity,
        hash: metadata.hash,
        hashDiff: hashDiff,
        loadingScore: metadata.loading.skeletonRatio,
        textRatio: metadata.loading.textRatio,
        isStable: isSettled,
        isUnique: true
      });

      prevHash = metadata.hash;
      setProgress(Math.min(100, (time / duration) * 100));
      if (candidates.length % 5 === 0) {
        setRawCandidates([...candidates]);
      }
    }

    setRawCandidates(candidates);
    setStatus(ProcessingStatus.COMPLETED);
    setProgress(100);
  };

  const { frames, filteredFrames } = useMemo(() => {
    const valid: ExtractedFrame[] = [];
    const filtered: ExtractedFrame[] = [];
    let lastHash = '';

    rawCandidates.forEach((cand) => {
      let reason: ExtractedFrame['filterReason'] = undefined;

      // 1. Quality Check (Blur)
      if (cand.blurScore < settings.blurThreshold) {
        reason = 'blurry';
      }
      // 2. Structural Loading Check (Refined for Banking/Modern App Skeletons)
      // We check if "neutral grey blocks" cover a significant part of the screen
      // AND if there is a severe lack of actual "information density" (text/sharp icons)
      else if (
        cand.loadingScore > settings.loadingSensitivity && 
        (cand.textRatio < 0.12 || cand.edgeIntensity < 18)
      ) {
        reason = 'loading';
      } 
      // 3. Unstable Transition (Animated states)
      else if (cand.hashDiff > settings.transitionSensitivity && !cand.isStable) {
        reason = 'transition';
      }
      // 4. Structural Duplicate Check (Deduplication)
      else {
        const dist = lastHash ? hammingDistance(cand.hash, lastHash) : 999;
        if (dist <= settings.similarityThreshold) {
          reason = 'duplicate';
        } else {
          lastHash = cand.hash;
        }
      }

      if (reason) {
        filtered.push({ ...cand, filterReason: reason });
      } else {
        valid.push(cand);
      }
    });

    return { frames: valid, filteredFrames: filtered };
  }, [rawCandidates, settings]);

  const autoBlurSelected = async () => {
    if (selectedIds.size === 0) return;
    setStatus(ProcessingStatus.AUTO_BLURRING);
    
    const framesToBlur = [...frames, ...filteredFrames].filter(f => selectedIds.has(f.id));
    
    for (const frame of framesToBlur) {
      const boxes = await detectPII(frame.originalDataUrl);
      if (boxes.length > 0) {
        const img = new Image();
        await new Promise((resolve) => {
          img.onload = resolve;
          img.src = frame.originalDataUrl;
        });

        const pixelRects = boxes.map(box => ({
          x: (box.xmin / 1000) * img.naturalWidth,
          y: (box.ymin / 1000) * img.naturalHeight,
          w: ((box.xmax - box.xmin) / 1000) * img.naturalWidth,
          h: ((box.ymax - box.ymin) / 1000) * img.naturalHeight
        }));

        const redactedUrl = await applyRedaction(frame.originalDataUrl, pixelRects);
        setRawCandidates(prev => prev.map(f => f.id === frame.id ? { ...f, dataUrl: redactedUrl, redacted: true } : f));
      }
    }
    
    setStatus(ProcessingStatus.COMPLETED);
  };

  const handleUndoRedaction = useCallback((id: string) => {
    setRawCandidates(prev => prev.map(f => 
      f.id === id ? { ...f, dataUrl: f.originalDataUrl, redacted: false } : f
    ));
  }, []);

  const handleUndoSelectedRedaction = useCallback(() => {
    setRawCandidates(prev => prev.map(f => 
      selectedIds.has(f.id) ? { ...f, dataUrl: f.originalDataUrl, redacted: false } : f
    ));
  }, [selectedIds]);

  const moveFilteredToValid = (id: string) => {
    setRawCandidates(prev => prev.map(f => f.id === id ? { ...f, filterReason: 'manual-restored' as any, loadingScore: 0, blurScore: 9999, hashDiff: 0, isStable: true } : f));
    setSelectedIds(prev => new Set(prev).add(id));
  };

  const downloadSelected = async () => {
    if (selectedIds.size === 0) return;
    setIsDownloading(true);
    try {
      const zip = new JSZip();
      const all = [...frames, ...filteredFrames];
      const items = all.filter(f => selectedIds.has(f.id)).sort((a, b) => a.timestamp - b.timestamp);
      
      items.forEach((frame, idx) => {
        const base64Data = frame.dataUrl.split(',')[1];
        zip.file(`${idx + 1}_${frame.timestamp.toFixed(2)}s.png`, base64Data, { base64: true });
      });
      
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      const baseFileName = videoFile?.name ? videoFile.name.split('.').slice(0, -1).join('.') : 'anatomi_screens';
      link.download = `${baseFileName}_screens.zip`;
      link.click();
    } finally { setIsDownloading(false); }
  };

  const handleManualSnapshot = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const dataUrl = canvas.toDataURL('image/png');
    const metrics = calculateImageMetrics(canvas);
    const hash = await calculateAverageHash(canvas);
    
    setRawCandidates(prev => [...prev, {
      id: `manual-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: video.currentTime,
      dataUrl,
      originalDataUrl: dataUrl,
      blurScore: metrics.blurScore,
      edgeIntensity: metrics.edgeIntensity,
      hash,
      hashDiff: 0,
      loadingScore: 0,
      textRatio: 1,
      isStable: true,
      isUnique: true,
      filterReason: 'manual-restored'
    }].sort((a,b) => a.timestamp - b.timestamp));
  };

  const activeFrames = viewMode === 'valid' ? frames : filteredFrames;
  const anySelectedIsRedacted = useMemo(() => {
    return activeFrames.some(f => selectedIds.has(f.id) && f.redacted);
  }, [activeFrames, selectedIds]);

  const estimatedTotal = useMemo(() => {
    if (!videoRef.current) return 0;
    return Math.ceil(videoRef.current.duration * settings.extractionFps);
  }, [videoUrl, settings.extractionFps]);

  return (
    <div 
      className="max-w-[1800px] mx-auto px-6 py-10 min-h-screen flex flex-col relative bg-gray-950"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <AnimatePresence>
        {isDragging && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[500] bg-blue-600/10 backdrop-blur-xl border-[6px] border-dashed border-blue-500/50 flex flex-col items-center justify-center p-10 pointer-events-none"
          >
            <motion.div
              animate={{ y: [0, -20, 0] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
              className="bg-blue-600 p-8 rounded-full shadow-[0_0_50px_rgba(37,99,235,0.4)] mb-8"
            >
              <svg className="w-20 h-20 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </motion.div>
            <h2 className="text-4xl font-black text-white tracking-[0.1em] text-center">DROP VIDEO TO UPLOAD</h2>
            <p className="text-blue-400 mt-4 text-sm font-black uppercase tracking-widest">Supports all major video formats</p>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-8">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-white">Anatomi <span className="text-blue-500">Editor</span></h1>
          <p className="text-gray-500 text-[10px] mt-1 uppercase tracking-[0.3em] font-black">Intelligent Frame Intelligence & Privacy Shield</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-5">
          <label className="cursor-pointer bg-gray-900/50 hover:bg-gray-800 text-white px-6 py-3 rounded-2xl border border-gray-800 transition-all flex items-center justify-center gap-3 text-sm font-black shadow-2xl">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            <input type="file" className="hidden" accept="video/*" onChange={handleFileChange} />
            UPLOAD VIDEO
          </label>
          <button 
            disabled={!videoFile || status === ProcessingStatus.EXTRACTING} 
            onClick={processVideo} 
            className={`px-8 py-3 rounded-2xl font-black transition-all text-sm tracking-widest ${status === ProcessingStatus.EXTRACTING ? 'bg-blue-600/30 text-blue-300 cursor-not-allowed border border-blue-600/20' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_30px_rgba(37,99,235,0.3)]'}`}
          >
            {status === ProcessingStatus.EXTRACTING ? 'EXTRACTING...' : 'RUN SMART EXTRACTION'}
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-10 flex-1 min-h-0">
        <div className="lg:col-span-4 space-y-10">
          <section className="bg-gray-900/40 rounded-3xl border border-gray-800 p-6 shadow-2xl backdrop-blur-md">
            <div className="flex items-center justify-between mb-5">
               <h2 className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">Video Source Monitor</h2>
               {videoUrl && <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[8px] font-black rounded border border-blue-500/20 uppercase">HD Live</span>}
            </div>
            <div className="bg-black rounded-2xl overflow-hidden border border-gray-800 relative shadow-inner ring-1 ring-white/5">
              {videoUrl ? <video ref={videoRef} src={videoUrl} className="w-full h-auto max-h-[500px] object-contain" controls /> : (
                <div className="aspect-video w-full flex flex-col items-center justify-center gap-4 text-gray-700">
                  <svg className="w-16 h-16 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2-2v8a2 2 0 002 2z" /></svg>
                  <p className="text-[10px] font-black uppercase tracking-widest">No Active Signal</p>
                </div>
              )}
              {status === ProcessingStatus.EXTRACTING && (
                <div className="absolute inset-0 bg-gray-950/60 backdrop-blur-sm flex items-center justify-center">
                  <div className="flex flex-col items-center gap-6">
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }} className="w-20 h-20 border-4 border-blue-500/10 border-t-blue-500 rounded-full shadow-[0_0_20px_rgba(37,99,235,0.2)]" />
                    <div className="text-center">
                      <div className="text-3xl font-black text-white">{Math.round(progress)}%</div>
                      <div className="text-[9px] font-black text-blue-400 uppercase tracking-widest mt-1">Deep Scanning Frames</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="bg-gray-900/40 rounded-3xl border border-gray-800 p-8 shadow-2xl backdrop-blur-md">
            <h2 className="text-[10px] font-black mb-8 uppercase tracking-[0.25em] text-gray-500">Capture Configuration</h2>
            
            <div className="space-y-10">
              <div>
                <div className="flex justify-between text-[11px] font-black uppercase text-gray-300 mb-4">
                  <span>Extraction Frequency</span>
                  <span className="text-blue-400 font-mono text-xs">{settings.extractionFps} FPS</span>
                </div>
                <input type="range" min="0.5" max="10" step="0.5" value={settings.extractionFps} onChange={e => setSettings({...settings, extractionFps: Number(e.target.value)})} className="w-full accent-blue-500 bg-gray-800 h-2 rounded-xl appearance-none cursor-pointer" />
                <div className="flex justify-between mt-3">
                  <p className="text-[9px] text-gray-500 italic">Captures {settings.extractionFps} frames per sec.</p>
                  {videoUrl && <p className="text-[9px] text-blue-500/50 font-black">~{estimatedTotal} probes</p>}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-black uppercase text-gray-300 mb-4">
                  <span>Sharpness Threshold</span>
                  <span className="text-blue-400 font-mono text-xs">{settings.blurThreshold}</span>
                </div>
                <input type="range" min="0" max="500" step="10" value={settings.blurThreshold} onChange={e => setSettings({...settings, blurThreshold: Number(e.target.value)})} className="w-full accent-blue-500 bg-gray-800 h-2 rounded-xl appearance-none cursor-pointer" />
                <p className="text-[9px] text-gray-500 mt-3 italic">Higher = stricter sharpness requirements.</p>
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-black uppercase text-gray-300 mb-4">
                  <span>Structural Similarity (dHash)</span>
                  <span className="text-blue-400 font-mono text-xs">{settings.similarityThreshold}</span>
                </div>
                <input type="range" min="0" max="40" step="1" value={settings.similarityThreshold} onChange={e => setSettings({...settings, similarityThreshold: Number(e.target.value)})} className="w-full accent-blue-500 bg-gray-800 h-2 rounded-xl appearance-none cursor-pointer" />
                <p className="text-[9px] text-gray-500 mt-3 italic">256-bit dHash sensitivity. Higher = more filtering.</p>
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-black uppercase text-gray-300 mb-4">
                  <span>Transition Sensitivity</span>
                  <span className="text-blue-400 font-mono text-xs">{settings.transitionSensitivity}</span>
                </div>
                <input type="range" min="0" max="40" step="1" value={settings.transitionSensitivity} onChange={e => setSettings({...settings, transitionSensitivity: Number(e.target.value)})} className="w-full accent-blue-500 bg-gray-800 h-2 rounded-xl appearance-none cursor-pointer" />
                <p className="text-[9px] text-gray-500 mt-3 italic">Threshold for structural jumps between states.</p>
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-black uppercase text-gray-300 mb-4">
                  <span>Loading State Filter</span>
                  <span className="text-blue-400 font-mono text-xs">{(settings.loadingSensitivity * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min="0.01" max="0.5" step="0.01" value={settings.loadingSensitivity} onChange={e => setSettings({...settings, loadingSensitivity: Number(e.target.value)})} className="w-full accent-blue-500 bg-gray-800 h-2 rounded-xl appearance-none cursor-pointer" />
                <p className="text-[9px] text-gray-500 mt-3 italic">Filters frames with neutral placeholder blocks.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-12">
              <button onClick={() => setViewMode('valid')} className={`p-6 rounded-2xl border transition-all text-left relative overflow-hidden group ${viewMode === 'valid' ? 'bg-blue-600/10 border-blue-500 shadow-[0_0_20px_rgba(37,99,235,0.15)]' : 'bg-gray-800/40 border-gray-700 hover:border-gray-600'}`}>
                <div className={`text-4xl font-black mb-1 ${viewMode === 'valid' ? 'text-blue-400' : 'text-white'}`}>{frames.length}</div>
                <div className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Valid</div>
                {viewMode === 'valid' && <motion.div layoutId="active-dot" className="absolute top-4 right-4 w-2 h-2 bg-blue-500 rounded-full" />}
              </button>
              <button onClick={() => setViewMode('filtered')} className={`p-6 rounded-2xl border transition-all text-left relative overflow-hidden group ${viewMode === 'filtered' ? 'bg-orange-600/10 border-orange-500 shadow-[0_0_20px_rgba(234,88,12,0.15)]' : 'bg-gray-800/40 border-gray-700 hover:border-gray-600'}`}>
                <div className={`text-4xl font-black mb-1 ${viewMode === 'filtered' ? 'text-orange-400' : 'text-white'}`}>{filteredFrames.length}</div>
                <div className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Filtered</div>
                {viewMode === 'filtered' && <motion.div layoutId="active-dot" className="absolute top-4 right-4 w-2 h-2 bg-orange-500 rounded-full" />}
              </button>
            </div>
          </section>
        </div>

        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="bg-gray-900/30 p-6 rounded-3xl border border-gray-800/50 flex items-center justify-between backdrop-blur-xl sticky top-4 z-40">
            <h2 className="text-2xl font-black text-white capitalize flex items-center gap-4">
              <span className={`w-3 h-3 rounded-full shadow-[0_0_10px_currentColor] ${viewMode === 'valid' ? 'text-blue-500 bg-blue-500' : 'text-orange-500 bg-orange-500'}`} />
              {viewMode} Inventory
            </h2>
            <div className="flex items-center gap-4">
              {selectedIds.size > 0 && (
                <div className="flex gap-3">
                  {anySelectedIsRedacted && (
                    <button 
                      onClick={handleUndoSelectedRedaction}
                      className="px-5 py-2.5 rounded-2xl text-orange-400 hover:text-white hover:bg-orange-600/20 text-[10px] uppercase font-black shadow-2xl transition-all border border-orange-600/30 flex items-center gap-3 backdrop-blur-md"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                      UNDO BLUR
                    </button>
                  )}
                  <button 
                    onClick={autoBlurSelected} 
                    disabled={status === ProcessingStatus.AUTO_BLURRING}
                    className={`px-6 py-2.5 rounded-2xl text-white text-[10px] uppercase font-black shadow-2xl transition-all flex items-center gap-3 ${status === ProcessingStatus.AUTO_BLURRING ? 'bg-purple-600/40 text-purple-200 border border-purple-600/30' : 'bg-purple-600 hover:bg-purple-500 active:scale-95 shadow-[0_0_20px_rgba(147,51,234,0.3)]'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    {status === ProcessingStatus.AUTO_BLURRING ? 'REDACTING PII...' : 'SCAN & BLUR PII'}
                  </button>
                </div>
              )}
              <button disabled={selectedIds.size === 0 || isDownloading} onClick={downloadSelected} className={`px-6 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] transition-all ${selectedIds.size === 0 ? 'bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-700' : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_0_25px_rgba(16,185,129,0.3)] active:scale-95'}`}>
                {isDownloading ? 'COMPRESSING...' : `EXPORT (${selectedIds.size})`}
              </button>
            </div>
          </div>
          
          <div className="flex-1 min-h-0">
             <FrameGallery 
              frames={activeFrames} 
              selectedIds={selectedIds}
              onToggleSelection={(id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
              onToggleAll={(sel) => setSelectedIds(sel ? new Set(activeFrames.map(f => f.id)) : new Set())}
              onDelete={(id) => setRawCandidates(prev => prev.filter(f => f.id !== id))}
              onView={setPreviewFrame}
              onRestore={viewMode === 'filtered' ? moveFilteredToValid : undefined}
              onUndoBlur={handleUndoRedaction}
              onRefine={() => {}}
            />
          </div>
        </div>
      </main>
      
      <AnimatePresence>
        {previewFrame && (
          <RedactionViewer 
            frame={previewFrame} 
            onClose={() => setPreviewFrame(null)} 
            onSave={async (id, rects) => {
               const redactedUrl = await applyRedaction(previewFrame.originalDataUrl, rects);
               setRawCandidates(prev => prev.map(f => f.id === id ? { ...f, dataUrl: redactedUrl, redacted: true } : f));
               setPreviewFrame(null);
            }} 
          />
        )}
      </AnimatePresence>

      <canvas ref={canvasRef} className="hidden" />

      <div className="fixed bottom-10 right-10 z-[100]">
        <button onClick={handleManualSnapshot} className="w-20 h-20 bg-blue-600 hover:bg-blue-500 rounded-full flex items-center justify-center text-white border-4 border-white/10 shadow-[0_10px_40px_rgba(37,99,235,0.4)] transition-all active:scale-90 group">
          <svg className="w-10 h-10 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </button>
      </div>
    </div>
  );
};

export default App;
