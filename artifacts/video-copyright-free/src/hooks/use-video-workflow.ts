import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export type AppStep = 'IDLE' | 'SETTINGS' | 'UPLOADING' | 'PROCESSING' | 'SUCCESS' | 'ERROR';

export interface ProcessSettings {
  resolution: string;
  aspectRatio: string;
  pitchShift: boolean;
  colorGrade: boolean;
  removeMetadata: boolean;
  frameModify: boolean;
}

export interface JobStatusData {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  message: string;
  outputFile: string | null;
  errorMessage: string | null;
}

async function fetchJobStatus(jobId: string): Promise<JobStatusData> {
  const res = await fetch(`/api/video/status/${jobId}`);
  if (!res.ok) throw new Error('Failed to fetch status');
  return res.json();
}

function uploadWithProgress(
  file: File,
  onProgress: (pct: number, speedMBs: number, etaSec: number) => void
): Promise<{ filename: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('video', file);

    const startTime = Date.now();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const speedMBs = elapsedSec > 0 ? (e.loaded / 1024 / 1024) / elapsedSec : 0;
        const remaining = e.total - e.loaded;
        const etaSec = speedMBs > 0 ? (remaining / 1024 / 1024) / speedMBs : 0;
        onProgress(pct, speedMBs, etaSec);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Invalid server response'));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

    xhr.open('POST', '/api/video/upload');
    xhr.send(formData);
  });
}

export function useVideoWorkflow() {
  const [step, setStep] = useState<AppStep>('IDLE');
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [uploadEta, setUploadEta] = useState(0);
  const { toast } = useToast();

  const statusQuery = useQuery({
    queryKey: ['job-status', jobId],
    queryFn: () => fetchJobStatus(jobId!),
    enabled: !!jobId && step === 'PROCESSING',
    refetchInterval: 1500,
    retry: 2,
  });

  useEffect(() => {
    if (step !== 'PROCESSING' || !statusQuery.data) return;
    if (statusQuery.data.status === 'completed') {
      setStep('SUCCESS');
    } else if (statusQuery.data.status === 'failed') {
      setStep('ERROR');
      toast({
        title: "Processing Failed",
        description: statusQuery.data.errorMessage || "An unknown error occurred.",
        variant: "destructive",
      });
    }
  }, [step, statusQuery.data, toast]);

  const startProcessing = useCallback(async (settings: ProcessSettings) => {
    if (!file) return;

    setStep('UPLOADING');
    setUploadProgress(0);

    try {
      // Upload with real progress tracking
      const uploadData = await uploadWithProgress(file, (pct, speed, eta) => {
        setUploadProgress(pct);
        setUploadSpeed(speed);
        setUploadEta(eta);
      });

      setUploadProgress(100);
      setStep('PROCESSING');

      const processRes = await fetch('/api/video/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: uploadData.filename, ...settings }),
      });

      if (!processRes.ok) throw new Error('Processing start failed');
      const processData = await processRes.json();
      setJobId(processData.jobId);
    } catch (error: any) {
      console.error(error);
      setStep('ERROR');
      toast({
        title: "Error",
        description: error?.message || "Failed to process video. Please try again.",
        variant: "destructive",
      });
    }
  }, [file, toast]);

  const reset = useCallback(() => {
    setStep('IDLE');
    setFile(null);
    setJobId(null);
    setUploadProgress(0);
    setUploadSpeed(0);
    setUploadEta(0);
  }, []);

  return {
    step,
    setStep,
    file,
    setFile,
    jobId,
    startProcessing,
    statusData: statusQuery.data ?? null,
    uploadProgress,
    uploadSpeed,
    uploadEta,
    reset,
  };
}
