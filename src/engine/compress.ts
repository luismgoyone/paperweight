import * as mupdf from 'mupdf';

const JPEG_QUALITY = 75;

/**
 * Resamples images that are shown at more than `dpi` (the largest size any page shows them at
 * decides) and re-encodes them as JPEG, keeping a replacement only when it's smaller. Images
 * with masks or unusual encodings are left alone.
 */
export function downsampleImages(doc: mupdf.PDFDocument, dpi: number): void {
  // How big each image is ever drawn, in points, keyed by its pixel size (the device gives us
  // the decoded image, not its object).
  const shownAt = new Map<string, number>();
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const device = new mupdf.Device({
      fillImage(image, ctm) {
        const key = `${image.getWidth()}x${image.getHeight()}`;
        const widthPt = Math.hypot(ctm[0], ctm[1]);
        shownAt.set(key, Math.max(shownAt.get(key) ?? 0, widthPt));
      },
    });
    try {
      page.runPageContents(device, mupdf.Matrix.identity);
    } finally {
      device.close();
      page.destroy();
    }
  }

  const seen = new Set<number>();
  for (let i = 0; i < doc.countPages(); i++) {
    const xobjects = doc.findPage(i).get('Resources', 'XObject');
    if (!xobjects.isDictionary()) continue;
    xobjects.forEach((ref) => {
      if (!ref.isIndirect() || seen.has(ref.asIndirect())) return;
      seen.add(ref.asIndirect());
      const obj = ref.resolve();
      if (!ref.isStream() || obj.get('Subtype').asName() !== 'Image') return;
      if (
        !obj.get('SMask').isNull() ||
        !obj.get('Mask').isNull() ||
        obj.get('ImageMask').asBoolean?.()
      )
        return;
      const width = obj.get('Width').asNumber();
      const height = obj.get('Height').asNumber();
      const shown = shownAt.get(`${width}x${height}`);
      if (!shown) return;
      const targetWidth = Math.round((shown / 72) * dpi);
      if (targetWidth >= width * 0.8) return; // not worth it
      const targetHeight = Math.max(1, Math.round((height * targetWidth) / width));
      try {
        let pix = doc.loadImage(ref).toPixmap();
        const gray = pix.getNumberOfComponents() - pix.getAlpha() === 1;
        if (!gray && pix.getColorSpace()?.getName() !== 'DeviceRGB') {
          pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, false);
        }
        const small = pix.warp(
          [
            [0, 0],
            [width, 0],
            [width, height],
            [0, height],
          ],
          targetWidth,
          targetHeight,
        );
        const jpeg = small.asJPEG(JPEG_QUALITY, false);
        const current = ref.readRawStream();
        const currentLength = current.getLength();
        current.destroy();
        if (jpeg.length >= currentLength) return;
        ref.writeRawStream(jpeg);
        obj.put('Width', targetWidth);
        obj.put('Height', targetHeight);
        obj.put('BitsPerComponent', 8);
        obj.put('ColorSpace', doc.newName(gray ? 'DeviceGray' : 'DeviceRGB'));
        obj.put('Filter', doc.newName('DCTDecode'));
        obj.delete('DecodeParms');
        obj.delete('Decode');
      } catch {
        // An image MuPDF can't decode or re-encode is simply kept as it is.
      }
    });
  }
}
