"use client";

import {
  ACCENT_PRESETS,
  contrastRatio,
  normalizeHex,
  readableTextOn,
} from "@/lib/color";
import { cn } from "@/components/ui/cn";
import { TextInput } from "@/components/ui/Field";

export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  /** Wired up by the surrounding Field. */
  id?: string;
  "aria-describedby"?: string;
}

/**
 * Accent colour for this business's invoices (§4): preset swatches, a native
 * colour picker, and a free hex input. The preview band shows the colour with
 * the text colour the invoice will actually use, so an unreadable choice is
 * visible before it reaches a PDF.
 *
 * The colours *inside* this control belong to the invoice document, not to the
 * app: the swatches and the band are the profile's own accent. Only the
 * selection affordance around a swatch — the ring — is app chrome, and it is on
 * the brand colour so it stays legible whichever accent sits under it.
 */
export function ColorPicker({
  value,
  onChange,
  id,
  ...aria
}: ColorPickerProps) {
  const normalized = normalizeHex(value);
  const swatchValue = normalized ?? "#7a5230";
  const textColor = readableTextOn(swatchValue);

  // readableTextOn() already picks whichever of white/dark contrasts better, so
  // this is the best the band can do. Every preset clears 4.5:1, but a mid-tone
  // custom colour (a mid grey, a mid green) cannot with any text colour — worth
  // saying so before it reaches a printed invoice (§4).
  const bandContrast = contrastRatio(swatchValue, textColor);
  const lowContrast = bandContrast < 4.5;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap gap-2.5">
        {ACCENT_PRESETS.map((preset) => {
          const selected = normalized === preset.hex;
          return (
            <button
              key={preset.hex}
              type="button"
              onClick={() => onChange(preset.hex)}
              aria-pressed={selected}
              title={preset.name}
              className={cn(
                "focus-ring size-9 rounded-full border transition-transform motion-reduce:transition-none",
                selected
                  ? "border-white ring-2 ring-brand-600 ring-offset-2"
                  : "border-ink-300 hover:scale-105",
              )}
              style={{ backgroundColor: preset.hex }}
            >
              <span className="sr-only">{preset.name}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="color"
          value={swatchValue}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Custom accent colour"
          className="focus-ring h-10 w-14 cursor-pointer rounded-lg border border-ink-300 bg-white p-1"
        />
        <TextInput
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#7a5230"
          spellCheck={false}
          className="max-w-36 font-mono"
          {...aria}
        />
      </div>

      <div
        className="rounded-lg px-4 py-2.5 text-sm font-semibold"
        style={{ backgroundColor: swatchValue, color: textColor }}
      >
        Invoice heading &amp; totals band
      </div>

      {lowContrast && (
        <p className="text-xs leading-relaxed text-amber-700">
          This colour gives {bandContrast.toFixed(1)}:1 contrast against the band
          text — below the 4.5:1 that reads reliably in print. A darker or
          lighter shade of the same hue will look sharper.
        </p>
      )}
    </div>
  );
}
