/**
 * Minimal, dependency-free PNG/JPEG signature + dimension validation for
 * the Profile template's photo upload (see cv-photo.service.ts). No image
 * decoding library is added for this — PDFKit itself already decodes the
 * actual pixel data at render time (see profile-pdf-renderer.ts), so this
 * only needs to answer two narrow questions before anything is persisted:
 * "are these genuinely PNG/JPEG bytes, matching the declared Content-Type"
 * and "what are its real pixel dimensions" (needed for the PDFKit
 * renderer's center-crop/"cover" math). Fails closed — any input that
 * doesn't cleanly match a well-formed PNG/JPEG header is rejected, never
 * guessed at.
 */

export type DetectedImageFormat = 'image/png' | 'image/jpeg';

export interface ImageDimensions {
  format: DetectedImageFormat;
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Real-world sanity bounds — generous enough for any legitimate profile
// photo, tight enough to reject corrupt/adversarial header values (e.g. a
// declared width of 0 or 4 billion) before they ever reach layout math.
const MIN_DIMENSION_PX = 32;
const MAX_DIMENSION_PX = 8000;

function isSaneDimensions(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= MIN_DIMENSION_PX &&
    height >= MIN_DIMENSION_PX &&
    width <= MAX_DIMENSION_PX &&
    height <= MAX_DIMENSION_PX
  );
}

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  // The IHDR chunk is always the very first chunk in a well-formed PNG:
  // 4-byte length, 4-byte type "IHDR", then its 13-byte payload.
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR') return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!isSaneDimensions(width, height)) return null;
  return { format: 'image/png', width, height };
}

// JPEG markers that carry a frame header (width/height) — every other
// marker with a length is skipped over unread. FFC4 (DHT)/FFC8 (JPG,
// reserved)/FFCC (DAC) are deliberately excluded even though they fall in
// the C0-CF range — they are not Start-Of-Frame markers.
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let pos = 2;
  // A generous but finite iteration cap — real JPEGs have at most a few
  // dozen segments before their SOF marker; this only guards against a
  // malformed/adversarial file that could otherwise loop until `pos`
  // wanders out of bounds.
  const MAX_SEGMENTS = 500;

  for (let i = 0; i < MAX_SEGMENTS && pos + 1 < buffer.length; i++) {
    if (buffer[pos] !== 0xff) return null;
    const marker = buffer[pos + 1] as number;

    // Markers with no payload/length field at all.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      pos += 2;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      pos += 2;
      continue;
    }

    if (pos + 3 >= buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(pos + 2);
    if (segmentLength < 2) return null;

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (pos + 2 + 7 > buffer.length) return null;
      const height = buffer.readUInt16BE(pos + 5);
      const width = buffer.readUInt16BE(pos + 7);
      if (!isSaneDimensions(width, height)) return null;
      return { format: 'image/jpeg', width, height };
    }

    pos += 2 + segmentLength;
  }

  return null;
}

/**
 * Returns real pixel dimensions and the detected format from the actual
 * bytes — never trusting a client-declared Content-Type/extension — or
 * `null` if `buffer` isn't a well-formed PNG or JPEG. Callers must treat
 * `null` as a hard rejection (fail closed), never a fallback guess.
 */
export function detectImageDimensions(buffer: Buffer): ImageDimensions | null {
  return readPngDimensions(buffer) ?? readJpegDimensions(buffer);
}

/**
 * Validates that `buffer` is genuinely the format declared by
 * `declaredMimeType` (e.g. from a client-supplied Content-Type/DTO field)
 * — a mismatch (e.g. a PNG renamed/relabeled as image/jpeg) is rejected
 * rather than silently accepted under the wrong assumed format.
 */
export function validateImageBytes(
  buffer: Buffer,
  declaredMimeType: string,
): ImageDimensions | null {
  const detected = detectImageDimensions(buffer);
  if (!detected) return null;
  if (detected.format !== declaredMimeType) return null;
  return detected;
}
