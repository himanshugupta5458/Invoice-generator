"use client";

import { useMemo, useRef, useState } from "react";

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
      <input
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
        className={cn(
          "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900",
          "placeholder:text-stone-400",
          "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-stone-900",
          "disabled:cursor-not-allowed disabled:bg-stone-100",
        )}
      />

      {open && !disabled && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Saved buyers"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-stone-200 bg-white py-1 shadow-lg"
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
                "cursor-pointer px-3 py-2 text-sm",
                index === activeIndex ? "bg-stone-100" : "bg-white",
              )}
            >
              <span className="font-medium text-stone-900">{buyer.name}</span>
              <span className="ml-2 text-xs text-stone-500">
                {buyer.state} ({buyer.stateCode})
                {buyer.gstin ? ` · ${buyer.gstin}` : ""}
              </span>
            </li>
          ))}

          {query.trim() !== "" && matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-stone-500">
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
              "cursor-pointer border-t border-stone-100 px-3 py-2 text-sm font-medium text-stone-700",
              activeIndex === matches.length ? "bg-stone-100" : "bg-white",
            )}
          >
            + Enter a new buyer
          </li>
        </ul>
      )}
    </div>
  );
}
