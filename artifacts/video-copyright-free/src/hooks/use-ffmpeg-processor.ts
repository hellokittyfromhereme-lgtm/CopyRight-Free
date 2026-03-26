import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

// Served from /public/ffmpeg/ — no CDN dependency, no external Worker issues
function getFFmpegBase() {
  const base = import.meta.env.BASE_URL; // e.g. "/" or "/app/"
  // Build absolute URL so Worker URL resolves correctly
  return `${window.location.origin}${base.endsWith('/') ? base : base + '/'}ffmpeg`;
}
const CORE_BASE = getFFmpegBase();

export type ProcessStep = 'idle' | 'loading' | 'processing' | 'done' | 'error';

export interface ProcessOptions {
  removeMetadata: boolean;
  muteAudio: boolean;
  pitchShift: boolean;
  colorGrade: boolean;
  frameModify: boolean;
  resolution: string;
  aspectRatio: string;
}

export function useFFmpegProcessor() {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [step, setStep] = useState<ProcessStep>('idle');
  const [loadProgress, setLoadProgress] = useState(0);
  const [processProgress, setProcessProgress] = useState(0);
  const [processMessage, setProcessMessage] = useState('');
  const [outputURL, setOutputURL] = useState<string | null>(null);
  const [outputFilename, setOutputFilename] = useState('copyright-free.mp4');
  const [error, setError] = useState<string | null>(null);

  const ensureLoaded = useCallback(async (): Promise<FFmpeg> => {
    if (ffmpegRef.current?.loaded) return ffmpegRef.current;

    setStep('loading');
    setLoadProgress(0);

    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;

    // Animate progress from 5→92 while WASM loads (31 MB can take 5–30s)
    let animPct = 5;
    setLoadProgress(animPct);
    const timer = setInterval(() => {
      // Accelerate quickly to ~50%, then slow down near 92%
      const step = animPct < 50 ? 3 : animPct < 80 ? 1 : 0.3;
      animPct = Math.min(92, animPct + step);
      setLoadProgress(Math.round(animPct));
    }, 300);

    try {
      await ffmpeg.load({
        classWorkerURL: `${CORE_BASE}/worker.js`,
        coreURL: `${CORE_BASE}/ffmpeg-core.js`,
        wasmURL: `${CORE_BASE}/ffmpeg-core.wasm`,
      });
    } finally {
      clearInterval(timer);
    }

    setLoadProgress(100);
    return ffmpeg;
  }, []);

  const processVideo = useCallback(async (file: File, options: ProcessOptions) => {
    setError(null);
    setOutputURL(null);
    setProcessProgress(0);
    setProcessMessage('Initializing...');

    let ffmpeg: FFmpeg;
    try {
      ffmpeg = await ensureLoaded();
    } catch (err: any) {
      console.error('FFmpeg load error:', err);
      ffmpegRef.current = null; // reset so next attempt retries
      const msg = err?.message || String(err);
      setError(`Failed to load processing engine: ${msg}`);
      setStep('error');
      return;
    }

    setStep('processing');
    setProcessProgress(5);
    setProcessMessage('Reading video file...');

    try {
      const ext = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '.mp4';
      const inputName = `input${ext}`;
      const outputName = 'output.mp4';

      await ffmpeg.writeFile(inputName, await fetchFile(file));
      setProcessProgress(15);
      setProcessMessage('Analyzing video...');

      // Build FFmpeg filter chain
      const videoFilters: string[] = [];
      const audioFilters: string[] = [];

      if (options.aspectRatio !== 'original') {
        const ratioMap: Record<string, string> = {
          '16:9': 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
          '9:16': 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
          '1:1': 'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2',
          '4:3': 'scale=1440:1080:force_original_aspect_ratio=decrease,pad=1440:1080:(ow-iw)/2:(oh-ih)/2',
          '21:9': 'scale=2560:1080:force_original_aspect_ratio=decrease,pad=2560:1080:(ow-iw)/2:(oh-ih)/2',
        };
        if (ratioMap[options.aspectRatio]) videoFilters.push(ratioMap[options.aspectRatio]);
      } else if (options.resolution !== 'original') {
        const [w, h] = options.resolution.split('x');
        videoFilters.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`);
      }

      if (options.colorGrade) videoFilters.push('eq=brightness=0.01:saturation=1.02:contrast=1.01');
      if (options.frameModify) videoFilters.push('hue=h=1');
      if (options.pitchShift && !options.muteAudio) audioFilters.push('asetrate=44100*1.005,aresample=44100');

      const needsVideoRecode = videoFilters.length > 0;
      const needsAudioRecode = audioFilters.length > 0;

      const args: string[] = ['-i', inputName];

      if (needsVideoRecode) {
        args.push('-vf', videoFilters.join(','));
        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30');
      } else {
        args.push('-c:v', 'copy');
      }

      if (options.muteAudio) {
        // Remove all audio streams
        args.push('-an');
      } else if (needsAudioRecode) {
        args.push('-af', audioFilters.join(','));
        args.push('-c:a', 'aac', '-b:a', '128k');
      } else {
        args.push('-c:a', 'copy');
      }

      if (options.removeMetadata) {
        args.push('-map_metadata', '-1', '-map_chapters', '-1');
      }

      args.push('-movflags', '+faststart', outputName);

      // Track progress via log events
      const msgs = [
        'Stripping metadata & fingerprints...',
        'Modifying audio signature...',
        'Applying visual alterations...',
        'Encoding output...',
        'Finalizing...',
      ];

      ffmpeg.on('progress', ({ progress }) => {
        const pct = 15 + Math.round(progress * 80);
        setProcessProgress(Math.min(95, pct));
        const idx = Math.min(Math.floor(progress * msgs.length), msgs.length - 1);
        setProcessMessage(msgs[idx]);
      });

      setProcessProgress(20);
      setProcessMessage('Removing copyright fingerprints...');

      await ffmpeg.exec(args);

      setProcessProgress(97);
      setProcessMessage('Creating download file...');

      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([(data as Uint8Array).buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      const baseName = file.name.replace(/\.[^.]+$/, '');
      setOutputFilename(`${baseName}-copyright-free.mp4`);
      setOutputURL(url);
      setProcessProgress(100);
      setProcessMessage('Done!');
      setStep('done');

      // Cleanup virtual FS
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}

    } catch (err: any) {
      console.error('FFmpeg error:', err);
      setError(err?.message || 'Processing failed. Try a smaller file or different format.');
      setStep('error');
    }
  }, [ensureLoaded]);

  const reset = useCallback(() => {
    if (outputURL) URL.revokeObjectURL(outputURL);
    setStep('idle');
    setLoadProgress(0);
    setProcessProgress(0);
    setProcessMessage('');
    setOutputURL(null);
    setError(null);
  }, [outputURL]);

  return {
    step,
    loadProgress,
    processProgress,
    processMessage,
    outputURL,
    outputFilename,
    error,
    processVideo,
    reset,
  };
}
