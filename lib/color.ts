/**
 * Accent-colour presets and readability helpers (spec §4, §8).
 *
 * The accent drives only the invoice heading rule, table header, and grand-total
 * band — in both the HTML preview and the PDF. Everything else stays neutral for
 * print legibility, so these helpers exist mainly to keep text on the accent band
 * readable when a user picks a very light or very dark colour.
 */

/** Enforced readable default (§4). */
export const DEFAULT_ACCENT = "#7a5230";

/** Text colours used on top of an accent band. */
export const ACCENT_TEXT_LIGHT = "#ffffff";
export const ACCENT_TEXT_DARK = "#1f2937";

export interface AccentPreset {
  name: string;
  hex: string;
}

/** Small preset palette offered alongside the custom hex / native picker. */
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { name: "Warm Brown", hex: DEFAULT_ACCENT },
  { name: "Indigo", hex: "#4338ca" },
  { name: "Teal", hex: "#0f766e" },
  { name: "Maroon", hex: "#7f1d1d" },
  { name: "Slate", hex: "#475569" },
  { name: "Black", hex: "#111111" },
] as const;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Normalise "#abc" / "abc" / "#AABBCC" to lowercase 6-digit "#aabbcc".
 * Returns null when the input is not a valid hex colour.
 */
export function normalizeHex(hex: string): string | null {
  if (typeof hex !== "string") return null;
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) return null;
  const digits = match[1].toLowerCase();
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((c) => c + c)
          .join("")
      : digits;
  return `#${full}`;
}

export function isValidHexColor(hex: string): boolean {
  return normalizeHex(hex) !== null;
}

/** Any invalid/absent accent falls back to the readable default. */
export function resolveAccent(hex?: string | null): string {
  return (hex ? normalizeHex(hex) : null) ?? DEFAULT_ACCENT;
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex) ?? hexToRgb(DEFAULT_ACCENT)!;
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Text colour to use on an accent band: white by default, dark when the accent
 * is light enough that white would be unreadable (§4, §8).
 */
export function readableTextOn(accent: string): string {
  const bg = resolveAccent(accent);
  return contrastRatio(bg, ACCENT_TEXT_LIGHT) >=
    contrastRatio(bg, ACCENT_TEXT_DARK)
    ? ACCENT_TEXT_LIGHT
    : ACCENT_TEXT_DARK;
}
