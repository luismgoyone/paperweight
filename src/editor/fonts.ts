import { ALL_FONTS, SCRIPT_FONTS, fontFile, fontId } from '../shared/fonts';

// Font bytes, fetched once from our own origin during startup and kept in memory so a
// restarted engine can be given them again without another request (spec §8).
let loaded: Promise<Map<string, Uint8Array>> | null = null;

/** Fetches every bundled font and registers it with the browser for the text editor overlay. */
export function loadFonts(): Promise<Map<string, Uint8Array>> {
  loaded ??= Promise.all(
    ALL_FONTS.map(async (f) => {
      const url = new URL(fontFile(f.family, f), document.baseURI);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${fontFile(f.family, f)}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const face = new FontFace(f.family, bytes.slice().buffer, {
        weight: f.bold ? '700' : '400',
        style: f.italic ? 'italic' : 'normal',
      });
      document.fonts.add(await face.load());
      return [fontId(f.family, f), bytes] as const;
    }),
  ).then(async (entries) => {
    // Signature script fonts: browser only (typed signatures are drawn to an image). Fetched
    // during startup like the others, but a failure only affects typed signatures, which then
    // fall back to the browser's cursive font, so it mustn't block the text tool.
    await Promise.allSettled(
      SCRIPT_FONTS.map(async (f) => {
        const response = await fetch(new URL(f.file, document.baseURI));
        if (!response.ok) throw new Error(`Could not load ${f.file}`);
        document.fonts.add(await new FontFace(f.family, await response.arrayBuffer()).load());
      }),
    );
    return new Map(entries);
  });
  return loaded;
}
