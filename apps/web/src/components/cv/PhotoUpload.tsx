'use client';

import { useEffect, useRef, useState } from 'react';

import type { GetToken } from '@/lib/authFetch';
import {
  getPhotoUploadUrl,
  confirmPhotoUpload,
  removeCvPhoto,
  getPhotoPreviewUrl,
} from '@/lib/cvApi';
import { validatePhotoFile } from './validatePhotoFile';

type Status = 'idle' | 'uploading' | 'removing' | 'error';

interface Props {
  cvId: string;
  getToken: GetToken;
  hasPhoto: boolean;
  /** Called after a successful upload/replace/remove so the parent can
   *  update its own `cv.photoObjectKey`/preview state. */
  onChange: (hasPhoto: boolean) => void;
}

/**
 * Profile template's optional photo control — scoped to the Profile
 * template only (see CvBuilderWorkspace.tsx, which renders this only when
 * `templateId === 'profile'`). Real direct-to-R2 upload, same three-step
 * shape as NewCvUpload.tsx's CV-file flow (getUploadUrl → PUT to R2 →
 * confirm), never a mock/placeholder. The preview itself is always a
 * short-lived signed URL fetched from the API, never stored client-side
 * beyond the current session.
 */
export function PhotoUpload({ cvId, getToken, hasPhoto, onChange }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hasPhoto) {
      setPreviewUrl(null);
      return;
    }
    void (async () => {
      try {
        const { previewUrl: url } = await getPhotoPreviewUrl(getToken, cvId);
        if (!cancelled) setPreviewUrl(url);
      } catch {
        // A transient preview-load failure must never be treated as "no
        // photo" — the association on the CV is untouched either way, so
        // this only affects what's shown here, not what gets saved/PDFed.
        if (!cancelled) setPreviewUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasPhoto, cvId, getToken]);

  async function handleFileSelected(file: File) {
    const validation = validatePhotoFile(file);
    if (!validation.valid) {
      setError(validation.message);
      setStatus('error');
      return;
    }
    setError('');
    setStatus('uploading');
    try {
      const { uploadUrl, r2ObjectKey } = await getPhotoUploadUrl(
        getToken,
        cvId,
        file.type,
        file.size,
      );
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error('Photo upload to storage failed.');

      await confirmPhotoUpload(getToken, cvId, r2ObjectKey, file.size, file.type);
      setStatus('idle');
      onChange(true);
    } catch {
      setError('Photo upload failed. Please try again.');
      setStatus('error');
    }
  }

  async function handleRemove() {
    setStatus('removing');
    setError('');
    try {
      await removeCvPhoto(getToken, cvId);
      setStatus('idle');
      onChange(false);
    } catch {
      setError('Failed to remove photo. Please try again.');
      setStatus('error');
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFileSelected(file);
  }

  // Fix (reported scroll-to-bottom during upload): once the native file
  // picker closes, some browsers restore focus to the hidden <input>
  // itself (it's what `.click()` was called on) — whether or not a file
  // was actually chosen (a cancelled dialog fires no `change` event at
  // all, only this). This component's Photo panel lives deep inside the
  // builder's scrollable editor column, and the input is the LAST element
  // in this component's own markup, so that default focus-restoration
  // could scroll the editor pane down trying to bring an invisible 1x1px
  // element into view. Redirecting focus straight back to the trigger
  // button (already on-screen — the user just clicked it) the moment the
  // input receives it, with preventScroll, avoids that jump regardless of
  // which element the browser would otherwise have focused or whether a
  // file was picked.
  function handleInputFocus() {
    triggerButtonRef.current?.focus({ preventScroll: true });
  }

  const busy = status === 'uploading' || status === 'removing';

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-gray-700">Photo (optional)</span>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-300 bg-gray-50 text-xs text-gray-400">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed R2 URL, not a Next-optimizable static asset
            <img
              src={previewUrl}
              alt=""
              // object-position matches profile-document.tsx's .cvpf-photo
              // (and the PDF's PHOTO_VERTICAL_BIAS) — biases the crop
              // window toward the top of the photo so this thumbnail
              // doesn't cut off the crown of the head either.
              style={{ objectPosition: '50% 22%' }}
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden="true">No photo</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <button
              ref={triggerButtonRef}
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            >
              {status === 'uploading' ? 'Uploading…' : hasPhoto ? 'Replace photo' : 'Upload photo'}
            </button>
            {hasPhoto && (
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={busy}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-400 disabled:opacity-50"
              >
                {status === 'removing' ? 'Removing…' : 'Remove'}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400">PNG or JPEG, max 3 MB. Entirely optional.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={handleChange}
        onFocus={handleInputFocus}
        disabled={busy}
        aria-label="Upload profile photo"
        className="sr-only"
      />
    </div>
  );
}
