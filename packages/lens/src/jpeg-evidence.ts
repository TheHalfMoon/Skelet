/**
 * Bounded JPEG marker/frame validator for report ingress.
 * This validates structure and decoded-image dimensions BEFORE any consumer
 * attempts to decode the image. It is NOT a full entropy/image decoder.
 */
export interface JpegDimensions {
  width: number;
  height: number;
}

const MAX_SIDE = 4096;
const MAX_PIXELS = 16_000_000;

export function inspectJpeg(bytes: Uint8Array): JpegDimensions | null {
  if (bytes.length < 24 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let index = 2;
  let width = 0;
  let height = 0;
  let sawFrame = false;
  let sawScan = false;
  let entropyBytes = 0;
  let inScan = false;

  while (index < bytes.length) {
    if (inScan) {
      if (bytes[index] !== 0xff) {
        entropyBytes += 1;
        index += 1;
        continue;
      }
      const next = bytes[index + 1];
      if (next === 0x00) {
        entropyBytes += 1;
        index += 2;
        continue;
      }
      if (next !== undefined && next >= 0xd0 && next <= 0xd7) {
        index += 2;
        continue;
      }
      inScan = false;
      continue;
    }

    if (bytes[index] !== 0xff) return null;
    while (bytes[index] === 0xff) index += 1;
    const marker = bytes[index];
    if (marker === undefined) return null;
    index += 1;

    if (marker === 0xd9) {
      return sawFrame && sawScan && entropyBytes > 0 &&
        index === bytes.length ? { width, height } : null;
    }
    // Fail closed: an explicit segment allowlist for Chromium's DCT JPEGs.
    // Arbitrary JPEG markers are not safe metadata: SOF3+ can add a second
    // frame, DHP (FFDE) declares hierarchical dimensions, DNL changes
    // height, and arithmetic/JPEG-LS/hierarchical controls are unsupported.
    const allowedSegment = marker === 0xc0 || marker === 0xc1 ||
      marker === 0xc2 || marker === 0xc4 || marker === 0xda ||
      marker === 0xdb || marker === 0xdd || marker === 0xfe ||
      (marker >= 0xe0 && marker <= 0xef);
    if (!allowedSegment || index + 2 > bytes.length) return null;

    const segmentLength = ((bytes[index] as number) << 8) | (bytes[index + 1] as number);
    if (segmentLength < 2 || index + segmentLength > bytes.length) return null;

    // Only baseline/extended/progressive 8-bit DCT frames are accepted.
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (sawFrame || segmentLength < 11 ||
          bytes[index + 2] !== 8) return null;
      height = ((bytes[index + 3] as number) << 8) | (bytes[index + 4] as number);
      width = ((bytes[index + 5] as number) << 8) | (bytes[index + 6] as number);
      const channels = bytes[index + 7] as number;
      if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE ||
          width * height > MAX_PIXELS ||
          (channels !== 1 && channels !== 3) ||
          segmentLength !== 8 + 3 * channels) return null;
      sawFrame = true;
    }
    if (marker === 0xda) {
      if (!sawFrame || segmentLength < 6) return null;
      sawScan = true;
      inScan = true;
    }
    index += segmentLength;
  }
  return null;
}
