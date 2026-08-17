"use client";

import { useMemo, useRef, useState } from "react";

import { TextInput } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import type { SavedBuyer } from "@/lib/types";

export interface BuyerSelectProps {
  buyers: SavedBuyer[];
  /** "" when the buyer is being entered fresh. */
  selectedId: string;
  /** null means "enter a new buyer" — the caller clears the Bill To fields. */
  onSelect: (buyer: SavedBuyer | null) => void;
  disabled?: boolean;
  id?: string;
}

const NEW_BUYER_OPTION = "__new__";

/**
 * Searchable combobox over saved buyers, with an explicit "enter a new buyer"
 * path (§4). Selecting a saved buyer autofills the Bill To fields; those fields
 * stay editable afterwards, and edits there apply to this invoice only — they
 * are never written back to the saved buyer record.
 */
export function BuyerSelect({
  buyers,
  selectedId,
  onSelect,
  disabled = false,
  id,
}: BuyerSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = buyers.find((buyer) => buyer.id === selectedId);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return buyers;
    return buyers.filter((buyer) =>
      [buyer.name, buyer.state, buyer.gstin ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [buyers, query]);

  // The "enter a new buyer" row always sits at the end of the list.
  const optionCount = matches.length + 1;

  function choose(index: number) {
    if (index >= matches.length) {
      onSelect(null);
    } else {
      onSelect(matches[index]);
    }
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + step + optionCount) % optionCount);
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  const listboxId = `${id ?? "buyer-select"}-listbox`;

  return (
    <div
      className="relative"
      onBlur={() => {
        // Let a click on an option land before the list closes.
        blurTimer.current = setTimeout(() => setOpen(false), 120);
      }}
      onFocus={() => {
        if (blurTimer.current) clearTimeout(blurTimer.current);
      }}
    >
      {/* The shared TextInput, not a hand-styled `<input>`: this control has to
          be indistinguishable from the fields under it, and the only way to keep
          it that way is for it to be the same component. */}
      <TextInput
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open ? `${listboxId}-option-${activeIndex}` : undefined
        }
        autoComplete="off"
        disabled={disabled}
        value={open ? query : (selected?.name ?? "")}
        placeholder={
          buyers.length > 0
            ? "Search saved buyers, or enter a new one"
            : "No saved buyers yet — enter a new one"
        }
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {open && !disabled && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Saved buyers"
          className="absolute z-20 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border border-ink-200 bg-white py-1.5 shadow-lg shadow-ink-900/5"
        >
          {matches.map((buyer, index) => (
            <li
              key={buyer.id}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={buyer.id === selectedId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                "mx-1.5 cursor-pointer rounded-lg px-2.5 py-2 text-sm",
                index === activeIndex ? "bg-brand-50" : "bg-white",
              )}
            >
              <span
                className={cn(
                  "font-medium",
                  index === activeIndex ? "text-brand-800" : "text-ink-900",
                )}
              >
                {buyer.name}
              </span>
              <span className="ml-2 text-xs text-ink-500">
                {buyer.state} ({buyer.stateCode})
                {buyer.gstin ? ` · ${buyer.gstin}` : ""}
              </span>
            </li>
          ))}

          {query.trim() !== "" && matches.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-500">
              No saved buyer matches “{query}”.
            </li>
          )}

          <li
            id={`${listboxId}-option-${matches.length}`}
            role="option"
            aria-selected={selectedId === ""}
            data-value={NEW_BUYER_OPTION}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(matches.length)}
            onMouseEnter={() => setActiveIndex(matches.length)}
            className={cn(
              "mx-1.5 mt-1 cursor-pointer rounded-lg border-t border-ink-100 px-2.5 py-2 text-sm font-medium",
              activeIndex === matches.length
                ? "bg-brand-50 text-brand-800"
                : "bg-white text-ink-700",
            )}
          >
            + Enter a new buyer
          </li>
        </ul>
      )}
    </div>
  );
}
