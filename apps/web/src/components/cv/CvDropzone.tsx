'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';

import { cn } from '@/lib/utils';
import { resolveDroppedCvFile } from './resolveDroppedCvFile';

interface CvDropzoneProps {
  /** Main label for the idle/uploading state — the caller's own phase text
   *  (e.g. "Choose a PDF or DOCX file" / "Uploading…"). Replaced with
   *  "Drop your CV here" while a file is being dragged over the zone. */
  label: string;
  /** Secondary hint line (e.g. "PDF or DOCX, max 5 MB"). */
  hint: string;
  disabled?: boolean;
  /**
   * Called with exactly one File, whether it came from the native file
   * dialog (click/keyboard) or a drag-and-drop. This component never
   * validates type or size itself and never touches the upload pipeline —
   * the caller's own existing handler (unchanged) owns that, exactly as it
   * already did for the plain file input before this component existed.
   */
  onFile: (file: File) => void;
  /**
   * Called when the drop itself is invalid at the dropzone level (more
   * than one file dropped in one gesture). Per-file type/size validation
   * errors are still surfaced by the caller after onFile — this is only
   * for what the dropzone itself can detect before a File ever reaches
   * the caller.
   */
  onRejected?: (message: string) => void;
  /** Outer shape/spacing classes (border radius, padding) — each caller
   *  passes its own existing values so neither page's appearance changes. */
  className?: string;
}

/**
 * Reusable CV upload dropzone: native label+input for click/keyboard
 * (unchanged accessibility — a visually-hidden but focusable file input,
 * same as before this component existed), plus drag-and-drop layered on
 * top. Both paths funnel into the same onFile callback, so the caller's
 * existing upload flow (getUploadUrl → PUT to R2 → confirmUpload) and
 * validation logic are reused completely unchanged — this component
 * never duplicates any of that.
 */
export function CvDropzone({
  label,
  hint,
  disabled,
  onFile,
  onRejected,
  className,
}: CvDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so selecting the exact same file again still fires
    // onChange — matches the pre-existing plain-input behavior.
    e.target.value = '';
    if (file) onFile(file);
  }

  function handleDragEnter(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }

  function handleDragOver(e: React.DragEvent<HTMLLabelElement>) {
    // Must be prevented on every dragover, not just dragenter — otherwise
    // the browser never considers this a valid drop target and a drop
    // navigates the tab away instead of firing the drop handler.
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragLeave(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    e.stopPropagation();
    // Only clear the highlight when genuinely leaving the dropzone, not
    // when moving between its own child elements (icon/text/hint), which
    // also fire dragleave and would otherwise make the highlight flicker
    // on/off as the pointer crosses internal element boundaries.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;

    const result = resolveDroppedCvFile(e.dataTransfer.files);
    if (!result) return;
    if ('rejected' in result) {
      onRejected?.(result.rejected);
      return;
    }
    onFile(result.file);
  }

  return (
    <label
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center gap-2 text-center transition-colors',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        isDragging
          ? 'border-indigo-500 bg-indigo-50'
          : 'border-gray-300 bg-white hover:border-indigo-400',
        className,
      )}
    >
      <Upload className={cn('h-6 w-6', isDragging ? 'text-indigo-500' : 'text-gray-400')} />
      <span className="text-sm font-medium text-gray-700">
        {isDragging ? 'Drop your CV here' : label}
      </span>
      <span className="text-xs text-gray-400">{hint}</span>
      {!isDragging && !disabled && <span className="text-xs text-gray-400">or drag and drop</span>}
      <input
        type="file"
        accept=".pdf,.docx"
        onChange={handleChange}
        disabled={disabled}
        className="sr-only"
      />
    </label>
  );
}
