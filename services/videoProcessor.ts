
import { ExtractedFrame } from '../types';

/**
 * Calculates a Difference Hash (16x16) of a canvas.
 */
export async function calculateAverageHash(canvas: HTMLCanvasElement): Promise<string> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';

  const size = 16;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = size + 1;
  tempCanvas.height = size;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return '';

  tempCtx.drawImage(canvas, 0, 0, size + 1, size);
  const imageData = tempCtx.getImageData(0, 0, size + 1, size);
  const pixels = imageData.data;

  const grayscale = new Uint8Array((size + 1) * size);
  for (let i = 0; i < (size + 1) * size; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    grayscale[i] = (r * 0.299 + g * 0.587 + b * 0.114);
  }

  let hash = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = grayscale[y * (size + 1) + x];
      const right = grayscale[y * (size + 1) + x + 1];
      hash += left < right ? '1' : '0';
    }
  }
  return hash;
}

/**
 * Returns ratios for skeleton, text, and background.
 * Refined for high-brightness skeletons with subtle tints.
 */
export function getLoadingMetrics(canvas: HTMLCanvasElement): { skeletonRatio: number, textRatio: number, bgRatio: number } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { skeletonRatio: 0, textRatio: 0, bgRatio: 0 };

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  let skeletonPixelCount = 0;
  let textPixelCount = 0;
  let backgroundPixelCount = 0;
  
  const samples = 2000; // Increased sampling for better structural coverage
  
  // Skeletons are often lighter than before. Range: 200 (mid-grey) to 253 (almost white)
  const skeletonGrey = { min: 200, max: 253 }; 

  for (let i = 0; i < samples; i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const idx = (y * width + x) * 4;
    
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const brightness = (r + g + b) / 3;
    
    // Modern apps use cool-grey or warm-grey skeletons.
    // We allow a larger tolerance (8 instead of 4) to catch these tints.
    const isNeutralish = Math.abs(r - g) < 8 && Math.abs(g - b) < 8 && Math.abs(r - b) < 8;

    if (isNeutralish && brightness >= skeletonGrey.min && brightness <= skeletonGrey.max) {
      // Additionally check if the surrounding area is also flat (loading skeletons are blocks)
      skeletonPixelCount++;
    } else if (brightness < 65) { 
      textPixelCount++;
    } else if (brightness > 253) { 
      backgroundPixelCount++;
    }
  }

  return {
    skeletonRatio: skeletonPixelCount / samples,
    textRatio: textPixelCount / samples,
    bgRatio: backgroundPixelCount / samples
  };
}

export function analyzeOverlayState(canvas: HTMLCanvasElement): { isDimmed: boolean, hasPopup: boolean } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { isDimmed: false, hasPopup: false };

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  let edgeBrightness = 0;
  let centerBrightness = 0;
  let edgeSamples = 0;
  let centerSamples = 0;

  const step = 40;
  const centerX = width / 2;
  const centerY = height / 2;
  const cRx = width * 0.35;
  const cRy = height * 0.3;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const bri = (data[idx] + data[idx+1] + data[idx+2]) / 3;

      const inCenter = Math.abs(x - centerX) < cRx && Math.abs(y - centerY) < cRy;
      const atEdge = x < width * 0.1 || x > width * 0.9 || y < height * 0.1 || y > height * 0.9;

      if (inCenter) {
        centerBrightness += bri;
        centerSamples++;
      } else if (atEdge) {
        edgeBrightness += bri;
        edgeSamples++;
      }
    }
  }

  const isDimmed = (edgeBrightness / edgeSamples) < 80;
  const hasPopup = isDimmed && ((centerBrightness / centerSamples) > (edgeBrightness / edgeSamples) + 60);

  return { isDimmed, hasPopup };
}

export function calculateImageMetrics(canvas: HTMLCanvasElement): { blurScore: number; edgeIntensity: number } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { blurScore: 0, edgeIntensity: 0 };

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  let mean = 0;
  let edgeSum = 0;
  const sampleStep = 8;
  let count = 0;

  for (let i = 0; i < data.length - 8; i += sampleStep * 4) {
    const gray = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114);
    mean += gray;
    count++;
    
    const nextGray = (data[i+4] * 0.299 + data[i+5] * 0.587 + data[i+6] * 0.114);
    edgeSum += Math.abs(gray - nextGray);
  }
  
  mean /= count;
  let variance = 0;
  for (let i = 0; i < data.length - 8; i += sampleStep * 4) {
    const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    variance += Math.pow(gray - mean, 2);
  }
  variance /= count;

  return { blurScore: variance, edgeIntensity: edgeSum / count };
}

export function hammingDistance(h1: string, h2: string): number {
  let distance = 0;
  for (let i = 0; i < h1.length; i++) {
    if (h1[i] !== h2[i]) distance++;
  }
  return distance;
}

export function applyRedaction(dataUrl: string, rects: {x: number, y: number, w: number, h: number}[]): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      rects.forEach(r => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.filter = 'blur(40px)';
        ctx.drawImage(img, 0, 0);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.restore();
      });

      resolve(canvas.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}
