const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

/**
 * Decodes XML entities from uiautomator attribute values. Without this,
 * a button labeled `Ropa & Accesorios` appears as `Ropa &amp; Accesorios`
 * and text matching silently fails.
 */
export function unescapeXml(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g,
    (entity) => {
      const named = XML_ENTITIES[entity];
      if (named) return named;
      const code = entity.startsWith("&#x")
        ? parseInt(entity.slice(3, -1), 16)
        : parseInt(entity.slice(2, -1), 10);
      return Number.isNaN(code) ? entity : String.fromCodePoint(code);
    },
  );
}

/**
 * Icon fonts put their glyphs in Unicode's Private Use Area. Those render as
 * blank everywhere except the device, so they survive a "has text" filter and
 * then print as empty strings — noise in every tree read.
 */
export function isIconGlyph(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return [...trimmed].every((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (
      (code >= 0xe000 && code <= 0xf8ff) ||
      (code >= 0xf0000 && code <= 0xffffd) ||
      (code >= 0x100000 && code <= 0x10fffd)
    );
  });
}
