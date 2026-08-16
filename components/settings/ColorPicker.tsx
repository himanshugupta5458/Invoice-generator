"use client";

import { ACCENT_PRESETS, normalizeHex, readableTextOn } from "@/lib/color";
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
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
                "size-8 rounded-full border transition-transform motion-reduce:transition-none",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900",
                selected
                  ? "border-stone-900 ring-2 ring-stone-900 ring-offset-2"
                  : "border-stone-300 hover:scale-105",
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
          className="h-9 w-12 cursor-pointer rounded-md border border-stone-300 bg-white p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
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
        className="rounded-md px-3 py-2 text-sm font-medium"
        style={{ backgroundColor: swatchValue, color: textColor }}
      >
        Invoice heading &amp; totals band
      </div>
    </div>
  );
}
