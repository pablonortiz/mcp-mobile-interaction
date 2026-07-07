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
