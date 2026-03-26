import React, { useCallback, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud, Settings2, CheckCircle2, Download, RefreshCw,
  AlertCircle, FileVideo, ShieldAlert, Languages, MessageCircle,
  Code2, Lock, X, Cpu, Zap, Shield, Play,
} from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Language } from '@/lib/translations';
import { useFFmpegProcessor, ProcessOptions } from '@/hooks/use-ffmpeg-processor';
import { Switch } from '@/components/ui/switch';
import { SelectNative } from '@/components/ui/select-native';
import confetti from 'canvas-confetti';

// ─── Animated Background ────────────────────────────────────────────────────
function FloatingOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(6)].map((_, i) => (
        <motion.div key={i}
          className="absolute rounded-full"
          style={{
            width: `${[400, 300, 500, 350, 250, 450][i]}px`,
            height: `${[400, 300, 500, 350, 250, 450][i]}px`,
            background: i % 2 === 0
              ? 'radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(99,102,241,0.10) 0%, transparent 70%)',
            left: `${[-10, 60, 20, 75, -5, 45][i]}%`,
            top: `${[10, -20, 50, 30, 70, 80][i]}%`,
          }}
          animate={{
            x: [0, 30, -20, 0],
            y: [0, -25, 15, 0],
            scale: [1, 1.05, 0.95, 1],
          }}
          transition={{ duration: 10 + i * 3, repeat: Infinity, ease: 'easeInOut', delay: i * 1.5 }}
        />
      ))}
      {/* Scanline grid */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
    </div>
  );
}

// ─── Circular Progress Ring ──────────────────────────────────────────────────
function ProgressRing({ pct, size = 220, color = 'hsl(var(--primary))' }: { pct: number; size?: number; color?: string }) {
  const r = (size / 2) - 12;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
      <motion.circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="8"
        strokeLinecap="round" strokeDasharray={circ}
        animate={{ strokeDashoffset: circ - (circ * pct) / 100 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        style={{ filter: `drop-shadow(0 0 8px ${color})` }}
      />
    </svg>
  );
}

export default function Home() {
  const { t, language, setLanguage } = useLanguage();
  const { step, loadProgress, processProgress, processMessage, outputURL, outputFilename, error, processVideo, reset } = useFFmpegProcessor();
  const [file, setFile] = useState<File | null>(null);
  const [videoPreviewURL, setVideoPreviewURL] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [sourcePassword, setSourcePassword] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [isDownloadingSource, setIsDownloadingSource] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const [options, setOptions] = useState<ProcessOptions>({
    resolution: 'original',
    aspectRatio: 'original',
    pitchShift: false,
    muteAudio: false,
    colorGrade: false,
    removeMetadata: true,
    frameModify: false,
  });

  // Create video preview URL
  useEffect(() => {
    if (!file) { setVideoPreviewURL(null); return; }
    const url = URL.createObjectURL(file);
    setVideoPreviewURL(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Confetti on success
  useEffect(() => {
    if (step !== 'done') return;
    const end = Date.now() + 3000;
    const iv = setInterval(() => {
      if (Date.now() > end) { clearInterval(iv); return; }
      const pc = 40 * ((end - Date.now()) / 3000);
      confetti({ startVelocity: 30, spread: 360, ticks: 60, zIndex: 0, particleCount: pc, origin: { x: Math.random(), y: Math.random() - 0.2 } });
    }, 250);
  }, [step]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.type.startsWith('video/')) setFile(dropped);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setFile(e.target.files[0]);
  };

  const handleStart = () => {
    if (!file) return;
    setIsSettingsOpen(false);
    processVideo(file, options);
  };

  const handleReset = () => {
    reset();
    setFile(null);
    setVideoPreviewURL(null);
    setIsSettingsOpen(false);
  };

  const handleSourceDownload = async () => {
    setSourceError('');
    if (!sourcePassword) { setSourceError('Please enter the password.'); return; }
    setIsDownloadingSource(true);
    try {
      const res = await fetch(`/api/source/download?password=${encodeURIComponent(sourcePassword)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSourceError((data as any).error || 'Wrong password.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'nexus-copyright-remover-source.zip'; a.click();
      URL.revokeObjectURL(url);
      setIsSourceOpen(false); setSourcePassword('');
    } catch { setSourceError('Download failed. Try again.'); }
    finally { setIsDownloadingSource(false); }
  };

  const willRecode = options.pitchShift || options.muteAudio || options.colorGrade || options.frameModify
    || options.aspectRatio !== 'original' || options.resolution !== 'original';

  const isActive = step === 'loading' || step === 'processing';

  return (
    <div className="min-h-screen w-full relative overflow-hidden flex flex-col bg-[#060610]">
      <FloatingOrbs />

      {/* ── Header ── */}
      <header className="relative z-10 w-full px-5 py-4 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-indigo-500 flex items-center justify-center shadow-lg shadow-primary/30 border border-primary/30">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-black text-xl leading-none text-white tracking-wide">{t.appTitle}</h1>
            <p className="text-[10px] text-primary/80 font-bold tracking-[0.2em] uppercase">{t.appSubtitle}</p>
          </div>
        </div>

        {/* Language switcher */}
        <div className="relative group">
          <button className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-sm font-medium backdrop-blur-md">
            <Languages className="w-4 h-4 text-muted-foreground" />
            <span className="uppercase text-white/80">{language}</span>
          </button>
          <div className="absolute right-0 mt-2 w-36 rounded-xl bg-[#0d0d1f]/95 backdrop-blur-xl border border-white/10 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 overflow-hidden z-50">
            {(['en', 'bn', 'hi'] as Language[]).map(lang => (
              <button key={lang} onClick={() => setLanguage(lang)}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-white/10 transition-colors ${language === lang ? 'text-primary font-bold' : 'text-white/70'}`}>
                {lang === 'en' ? '🇬🇧 English' : lang === 'bn' ? '🇧🇩 বাংলা' : '🇮🇳 हिन्दी'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 sm:p-8 max-w-5xl mx-auto w-full">
        <AnimatePresence mode="wait">

          {/* IDLE */}
          {step === 'idle' && (
            <motion.div key="idle"
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16, scale: 0.97 }} transition={{ duration: 0.45 }}
              className="w-full flex flex-col items-center text-center"
            >
              {/* Feature pills */}
              <div className="flex flex-wrap justify-center gap-2 mb-8">
                {[
                  { icon: <Cpu className="w-3 h-3" />, text: t.localBadge, color: 'text-primary border-primary/30 bg-primary/10' },
                  { icon: <Zap className="w-3 h-3" />, text: t.noUpload, color: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' },
                  { icon: <Shield className="w-3 h-3" />, text: t.privateLabel, color: 'text-green-400 border-green-400/30 bg-green-400/10' },
                ].map(({ icon, text, color }) => (
                  <span key={text} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${color}`}>
                    {icon} {text}
                  </span>
                ))}
              </div>

              <h2 className="text-4xl sm:text-5xl md:text-6xl font-black mb-5 leading-[1.1] max-w-3xl">
                {t.heroTitle.split('100%').map((part, i, arr) => (
                  <React.Fragment key={i}>
                    {part}
                    {i < arr.length - 1 && (
                      <span className="relative inline-block">
                        <span className="relative z-10 bg-gradient-to-r from-primary via-violet-400 to-indigo-400 bg-clip-text text-transparent">100%</span>
                        <span className="absolute inset-0 bg-gradient-to-r from-primary/20 to-indigo-400/20 blur-xl -z-10" />
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </h2>
              <p className="text-base sm:text-lg text-white/50 max-w-2xl mb-10 leading-relaxed">{t.heroSubtitle}</p>

              {/* Drop Zone */}
              <motion.div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={onDrop}
                animate={{ borderColor: isDragOver ? 'hsl(var(--primary))' : file ? 'hsl(var(--primary) / 0.6)' : 'rgba(255,255,255,0.1)' }}
                className="w-full max-w-3xl rounded-3xl border-2 transition-all duration-300 flex flex-col items-center justify-center relative overflow-hidden cursor-pointer group"
                style={{ minHeight: '280px' }}
              >
                <input type="file" accept="video/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={onFileChange} />

                {/* Glow on hover */}
                <div className={`absolute inset-0 transition-opacity duration-500 ${isDragOver || file ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}
                  style={{ background: 'radial-gradient(ellipse at center, rgba(168,85,247,0.12) 0%, transparent 70%)' }} />

                {file && videoPreviewURL ? (
                  <div className="w-full h-full flex flex-col items-center z-20 pointer-events-none p-6 gap-4">
                    <div className="relative w-full max-w-xs rounded-2xl overflow-hidden shadow-2xl shadow-primary/20 border border-white/10">
                      <video src={videoPreviewURL} className="w-full h-40 object-cover" muted />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                        <span className="text-white text-xs font-bold truncate">{file.name}</span>
                        <span className="text-white/70 text-xs shrink-0 ml-2">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-primary font-semibold">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="text-sm">{t.fileSelected}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center z-20 pointer-events-none gap-5 py-10 px-6">
                    <motion.div
                      animate={{ scale: isDragOver ? 1.15 : 1, rotate: isDragOver ? 5 : 0 }}
                      className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:border-primary/40 group-hover:bg-primary/10 transition-all"
                    >
                      <UploadCloud className="w-10 h-10 text-white/30 group-hover:text-primary transition-colors" />
                    </motion.div>
                    <div>
                      <p className="text-2xl font-bold text-white mb-2">{t.uploadZoneTitle}</p>
                      <p className="text-sm text-white/40">{t.uploadZoneSubtitle}</p>
                    </div>
                    <div className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 text-white/60 text-sm font-medium group-hover:border-primary/40 group-hover:text-primary transition-all">
                      {t.browseFiles}
                    </div>
                  </div>
                )}
              </motion.div>

              {file && (
                <motion.button initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                  onClick={() => setIsSettingsOpen(true)}
                  className="mt-7 px-8 py-4 rounded-2xl bg-gradient-to-r from-primary to-indigo-500 text-white font-bold text-lg flex items-center gap-3 shadow-[0_0_30px_rgba(168,85,247,0.35)] hover:shadow-[0_0_45px_rgba(168,85,247,0.5)] hover:-translate-y-1 transition-all duration-300"
                >
                  <Settings2 className="w-5 h-5" />
                  {t.configureSettings}
                </motion.button>
              )}
            </motion.div>
          )}

          {/* LOADING ffmpeg */}
          {step === 'loading' && (
            <motion.div key="loading"
              initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }} className="flex flex-col items-center text-center max-w-lg w-full"
            >
              <div className="relative mb-10">
                <div className="absolute inset-0 rounded-full bg-indigo-500/20 blur-3xl animate-pulse" />
                <div className="relative">
                  <ProgressRing pct={loadProgress} color="hsl(239, 84%, 67%)" />
                  <div className="absolute inset-0 flex items-center justify-center flex-col gap-1">
                    <span className="text-4xl font-black text-white">{loadProgress}%</span>
                    <Cpu className="w-5 h-5 text-indigo-400 animate-spin" style={{ animationDuration: '3s' }} />
                  </div>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">{t.loadingTitle}</h3>
              <p className="text-white/50 text-sm leading-relaxed max-w-sm">
                {loadProgress < 30
                  ? '⚙️ Starting processing engine…'
                  : loadProgress < 70
                  ? '📦 Downloading FFmpeg engine (~31 MB)…'
                  : loadProgress < 92
                  ? '🔧 Almost ready, initializing…'
                  : t.loadingSubtitle}
              </p>
              <p className="text-xs text-white/30 mt-2">First load only — cached instantly after</p>
              {/* progress bar */}
              <div className="mt-3 w-64 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-indigo-500"
                  animate={{ width: `${loadProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <div className="mt-4 flex gap-1">
                {[0,1,2].map(i => (
                  <motion.div key={i} className="w-2 h-2 rounded-full bg-indigo-400"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.4 }} />
                ))}
              </div>
            </motion.div>
          )}

          {/* PROCESSING */}
          {step === 'processing' && (
            <motion.div key="processing"
              initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }} className="flex flex-col items-center text-center max-w-lg w-full"
            >
              <div className="relative mb-10">
                <div className="absolute inset-0 rounded-full bg-primary/20 blur-3xl animate-pulse" />
                <div className="relative">
                  <ProgressRing pct={processProgress} />
                  <div className="absolute inset-0 flex items-center justify-center flex-col gap-1">
                    <span className="text-4xl font-black text-white">{processProgress}%</span>
                    <div className="flex gap-0.5">
                      {[0,1,2,3,4].map(i => (
                        <motion.div key={i} className="w-1 rounded-full bg-primary"
                          animate={{ height: ['8px','20px','8px'] }}
                          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <h3 className="text-2xl font-bold text-white mb-3">{t.processingTitle}</h3>

              <AnimatePresence mode="wait">
                <motion.p key={processMessage}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  className="text-primary font-semibold text-base"
                >
                  {processMessage}
                </motion.p>
              </AnimatePresence>

              <div className="mt-6 w-full max-w-sm h-1.5 bg-white/10 rounded-full overflow-hidden">
                <motion.div className="h-full bg-gradient-to-r from-primary via-violet-400 to-indigo-400 rounded-full"
                  style={{ width: `${processProgress}%` }} transition={{ duration: 0.5 }} />
              </div>

              <p className="text-xs text-white/30 mt-4">{t.processingSubtitle}</p>
            </motion.div>
          )}

          {/* SUCCESS */}
          {step === 'done' && outputURL && (
            <motion.div key="done"
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="relative p-10 rounded-3xl flex flex-col items-center text-center max-w-xl w-full overflow-hidden border border-white/10 bg-white/[0.03] backdrop-blur-xl"
            >
              <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-green-400/80 to-transparent" />
              <div className="absolute top-0 inset-x-0 h-20 bg-gradient-to-b from-green-500/10 to-transparent pointer-events-none" />

              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12, delay: 0.1 }}
                className="w-24 h-24 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(34,197,94,0.25)]"
              >
                <CheckCircle2 className="w-12 h-12 text-green-400" />
              </motion.div>

              <h2 className="text-3xl font-black text-white mb-3">{t.successTitle}</h2>
              <p className="text-white/50 mb-8 leading-relaxed">{t.successSubtitle}</p>

              <div className="flex flex-col sm:flex-row gap-3 w-full">
                <a href={outputURL} download={outputFilename}
                  className="flex-1 px-5 py-4 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-green-500/20"
                >
                  <Download className="w-5 h-5" /> {t.downloadVideo}
                </a>
                <button onClick={handleReset}
                  className="flex-1 px-5 py-4 rounded-xl bg-white/5 border border-white/10 text-white font-bold flex items-center justify-center gap-2 hover:bg-white/10 transition-all"
                >
                  <RefreshCw className="w-5 h-5" /> {t.processAnother}
                </button>
              </div>
            </motion.div>
          )}

          {/* ERROR */}
          {step === 'error' && (
            <motion.div key="error"
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="p-10 rounded-3xl flex flex-col items-center text-center max-w-xl w-full border border-white/10 bg-white/[0.03] backdrop-blur-xl"
            >
              <div className="w-24 h-24 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(239,68,68,0.2)] text-red-400">
                <AlertCircle className="w-12 h-12" />
              </div>
              <h2 className="text-3xl font-black text-white mb-3">{t.errorTitle}</h2>
              <p className="text-white/40 mb-8 leading-relaxed text-sm max-w-sm">{error || 'An unexpected error occurred.'}</p>
              <button onClick={handleReset}
                className="px-8 py-4 rounded-xl bg-white/5 border border-white/10 text-white font-bold flex items-center justify-center gap-2 hover:bg-white/10 transition-all w-full max-w-xs"
              >
                <RefreshCw className="w-5 h-5" /> Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Settings Drawer ── */}
      <AnimatePresence>
        {isSettingsOpen && !isActive && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={() => setIsSettingsOpen(false)} />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 220 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-md z-50 flex flex-col border-l border-white/10 bg-[#0a0a1a]/95 backdrop-blur-2xl shadow-2xl"
            >
              <div className="p-6 border-b border-white/10">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-xl font-bold text-white">{t.settingsTitle}</h2>
                  <button onClick={() => setIsSettingsOpen(false)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-all">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-white/40">{t.settingsSubtitle}</p>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Resolution & Aspect Ratio */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-white/50 uppercase tracking-widest">{t.resolution}</label>
                    <SelectNative value={options.resolution}
                      onChange={(e) => setOptions({ ...options, resolution: e.target.value })}
                      options={[
                        { value: 'original', label: t.original },
                        { value: '1920x1080', label: t.fhd },
                        { value: '2560x1440', label: t.qhd },
                        { value: '3840x2160', label: t.uhd },
                      ]} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-white/50 uppercase tracking-widest">{t.aspectRatio}</label>
                    <SelectNative value={options.aspectRatio}
                      onChange={(e) => setOptions({ ...options, aspectRatio: e.target.value })}
                      options={[
                        { value: 'original', label: t.original },
                        { value: '16:9', label: t.ratio169 },
                        { value: '9:16', label: t.ratio916 },
                        { value: '1:1', label: t.ratio11 },
                        { value: '4:3', label: t.ratio43 },
                        { value: '21:9', label: t.ratio219 },
                      ]} />
                  </div>
                </div>

                <hr className="border-white/5" />

                {/* Toggles */}
                {[
                  { section: t.audioSettings, items: [
                    { key: 'muteAudio' as const, label: t.muteAudio, desc: t.muteAudioDesc, fast: false },
                    { key: 'pitchShift' as const, label: t.pitchShift, desc: t.pitchShiftDesc, fast: false },
                  ]},
                  { section: t.videoSettings, items: [
                    { key: 'colorGrade' as const, label: t.colorGrade, desc: t.colorGradeDesc, fast: false },
                    { key: 'frameModify' as const, label: t.frameModify, desc: t.frameModifyDesc, fast: false },
                  ]},
                  { section: t.metadataSettings, items: [{ key: 'removeMetadata' as const, label: t.removeMetadata, desc: t.removeMetadataDesc, fast: true }] },
                ].map(({ section, items }) => (
                  <div key={section}>
                    <p className="text-[10px] font-black text-primary/70 uppercase tracking-[0.2em] mb-3">{section}</p>
                    <div className="space-y-2">
                      {items.map(({ key, label, desc, fast }) => (
                        <div key={key} className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-white/15 transition-colors">
                          <div className="pr-4 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="font-semibold text-white text-sm">{label}</p>
                              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border ${fast ? 'text-green-400 bg-green-500/10 border-green-500/20' : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'}`}>
                                {fast ? '⚡ FAST' : '🔄 RE-ENCODE'}
                              </span>
                            </div>
                            <p className="text-xs text-white/35">{desc}</p>
                          </div>
                          <Switch checked={options[key] as boolean}
                            onCheckedChange={(c) => setOptions({ ...options, [key]: c })} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-5 border-t border-white/10 bg-black/30 space-y-3">
                {/* Speed badge */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border ${willRecode ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>
                  <span>{willRecode ? '🔄' : '⚡'}</span>
                  <span>{willRecode ? 'Re-encode mode — takes longer' : 'Stream copy — very fast!'}</span>
                </div>
                <button onClick={handleStart}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-primary to-indigo-500 text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-[0_0_25px_rgba(168,85,247,0.4)] hover:shadow-[0_0_35px_rgba(168,85,247,0.6)] hover:-translate-y-0.5 transition-all duration-200"
                >
                  <Play className="w-5 h-5 fill-current" />
                  {t.startProcessing}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Floating buttons ── */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 items-end">
        <button onClick={() => setIsSourceOpen(true)} title="Source Code"
          className="w-11 h-11 rounded-full bg-white/8 border border-white/15 text-white/70 flex items-center justify-center hover:scale-110 hover:bg-white/15 hover:text-white transition-all duration-200 group relative"
        >
          <Code2 className="w-4 h-4" />
          <span className="absolute right-13 whitespace-nowrap text-xs bg-black/80 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">Source Code</span>
        </button>
        <button onClick={() => setIsHelpOpen(true)} title="Telegram Help"
          className="w-13 h-13 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-lg shadow-blue-500/30 hover:scale-110 hover:shadow-blue-500/50 transition-all duration-200 relative"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.88 13.47l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.837.95z"/>
          </svg>
        </button>
      </div>

      {/* ── Source Code Modal ── */}
      <AnimatePresence>
        {isSourceOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
              onClick={() => { setIsSourceOpen(false); setSourceError(''); setSourcePassword(''); }} />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm p-7 rounded-2xl border border-white/10 bg-[#0a0a1a]/95 backdrop-blur-2xl shadow-2xl z-50"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/20 flex items-center justify-center text-primary">
                    <Code2 className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-white text-sm">Source Code</p>
                    <p className="text-xs text-white/40">Password protected ZIP</p>
                  </div>
                </div>
                <button onClick={() => { setIsSourceOpen(false); setSourceError(''); setSourcePassword(''); }}
                  className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input type="password" value={sourcePassword}
                    onChange={(e) => { setSourcePassword(e.target.value); setSourceError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleSourceDownload()}
                    placeholder="Enter password..."
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 transition-colors text-sm" />
                </div>
                {sourceError && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-red-400 text-xs flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {sourceError}
                  </motion.p>
                )}
                <button onClick={handleSourceDownload} disabled={isDownloadingSource}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50">
                  {isDownloadingSource
                    ? <><RefreshCw className="w-4 h-4 animate-spin" /> Downloading...</>
                    : <><Download className="w-4 h-4" /> Download ZIP</>}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Help Modal ── */}
      <AnimatePresence>
        {isHelpOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
              onClick={() => setIsHelpOpen(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed bottom-24 right-6 w-76 p-5 rounded-2xl border border-blue-500/20 bg-[#0a0a1a]/95 backdrop-blur-2xl shadow-2xl z-50"
            >
              <div className="flex items-start gap-3 mb-5">
                <div className="w-11 h-11 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold text-white">{t.helpCenter}</p>
                  <p className="text-xs text-white/40 mt-1 leading-relaxed">{t.helpCenterDesc}</p>
                </div>
              </div>
              <a href="https://t.me/CyperXPloit" target="_blank" rel="noopener noreferrer"
                className="w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.88 13.47l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.837.95z"/>
                </svg>
                {t.contactSupport}
              </a>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
