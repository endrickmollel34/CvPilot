'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { CheckCircle, Upload } from 'lucide-react';

import { getUploadUrl, confirmUpload, getCv, prefillCv } from '@/lib/cvApi';
import { useApiError } from '@/hooks/useApiError';
import { ActionableError } from '@/components/ui/ActionableError';

type Phase = 'choose' | 'uploading' | 'parsing' | 'ready' | 'prefilling';

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export function NewCvUpload() {
  const { getToken } = useAuth();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('choose');
  const [fileName, setFileName] = useState('');
  const [uploadedCvId, setUploadedCvId] = useState<string | null>(null);
  const error = useApiError();
  const parseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (parseRef.current) clearInterval(parseRef.current);
    },
    [],
  );

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      error.setMessage('Only PDF and DOCX files are supported.');
      return;
    }
    error.clear();
    setFileName(file.name);
    setPhase('uploading');

    try {
      const { uploadUrl, r2ObjectKey } = await getUploadUrl(
        getToken,
        file.name,
        file.type,
        file.size,
      );

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error('File upload to storage failed.');

      // Fetch a fresh token again here rather than reusing whatever
      // getUploadUrl resolved before the (potentially slow) direct-to-R2
      // upload above — passing getToken itself (not a captured string)
      // makes authFetch request a live token immediately before this call.
      const cv = await confirmUpload(getToken, r2ObjectKey, file.name, file.size, file.type);
      setUploadedCvId(cv.id);
      setPhase('parsing');

      parseRef.current = setInterval(() => {
        void (async () => {
          try {
            const updated = await getCv(getToken, cv.id);
            if (updated.parseStatus === 'done') {
              clearInterval(parseRef.current!);
              setPhase('ready');
            } else if (updated.parseStatus === 'failed') {
              clearInterval(parseRef.current!);
              error.setMessage('Text extraction failed. Try a different file.');
              setPhase('choose');
            }
          } catch {
            /* keep polling */
          }
        })();
      }, 2000);
    } catch (err) {
      error.setFromError(err, 'Upload failed. Please try again.');
      setPhase('choose');
    } finally {
      e.target.value = '';
    }
  }

  async function handleUseExtractedDetails() {
    if (!uploadedCvId) return;
    setPhase('prefilling');
    error.clear();
    try {
      const cv = await prefillCv(getToken, uploadedCvId);
      router.push(`/cvs/${cv.id}/edit`);
    } catch (err) {
      error.setFromError(err);
      setPhase('ready');
    }
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <div className="mb-8">
        <Link href="/cvs/new" className="text-sm text-indigo-600 hover:underline">
          ← Create a CV
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Upload an existing CV</h1>
        <p className="mt-1 text-sm text-gray-500">
          We&apos;ll extract your details and open them in the CV builder for you to review.
        </p>
      </div>

      {error.message && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <ActionableError message={error.message} quota={error.quota} />
        </div>
      )}

      {(phase === 'choose' || phase === 'uploading') && (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-center hover:border-indigo-400 transition-colors">
          <Upload className="h-6 w-6 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">
            {phase === 'uploading' ? 'Uploading…' : 'Choose a PDF or DOCX file'}
          </span>
          <span className="text-xs text-gray-400">Max 5 MB</span>
          <input
            type="file"
            accept=".pdf,.docx"
            onChange={(e) => void handleFileChange(e)}
            disabled={phase === 'uploading'}
            className="sr-only"
          />
        </label>
      )}

      {phase === 'parsing' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white p-8 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
          <p className="text-sm font-medium text-gray-700">Extracting text from {fileName}…</p>
          <p className="text-xs text-gray-400">This usually takes a few seconds.</p>
        </div>
      )}

      {(phase === 'ready' || phase === 'prefilling') && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-8 text-center">
          <CheckCircle className="h-6 w-6 text-green-600" />
          <p className="text-sm font-medium text-gray-900">{fileName} uploaded and parsed.</p>
          <p className="text-xs text-gray-500">
            We can pull your details into a structured CV you can edit.
          </p>
          <button
            onClick={() => void handleUseExtractedDetails()}
            disabled={phase === 'prefilling'}
            className="mt-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {phase === 'prefilling' ? 'Opening builder…' : 'Use extracted details'}
          </button>
        </div>
      )}
    </main>
  );
}
