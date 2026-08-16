"use client";

import { useMemo, useState } from "react";

import { BuyerForm } from "@/components/settings/BuyerForm";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { createId } from "@/lib/repository";
import { useHydratedStore, useInvoiceStore } from "@/lib/store";
import type { SavedBuyer } from "@/lib/types";
import { toSavedBuyer, type BuyerFormValues } from "@/lib/validation";

type Mode = { kind: "list" } | { kind: "new" } | { kind: "edit"; id: string };

export function BuyersPanel() {
  const hydrated = useHydratedStore();
  const buyers = useInvoiceStore((state) => state.buyers);
  const saveBuyer = useInvoiceStore((state) => state.saveBuyer);
  const deleteBuyer = useInvoiceStore((state) => state.deleteBuyer);
  const busy = useInvoiceStore((state) => state.busy);

  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [query, setQuery] = useState("");

  const editing =
    mode.kind === "edit"
      ? buyers.find((buyer) => buyer.id === mode.id)
      : undefined;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return buyers;
    return buyers.filter((buyer) =>
      [buyer.name, buyer.state, buyer.gstin ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [buyers, query]);

  async function handleSubmit(values: BuyerFormValues) {
    const id = editing?.id ?? createId();
    await saveBuyer(toSavedBuyer(values, id));
    setMode({ kind: "list" });
  }

  async function handleDelete(buyer: SavedBuyer) {
    const confirmed = window.confirm(
      `Delete "${buyer.name}"? Invoices already issued to this buyer keep their own copy and are not affected.`,
    );
    if (confirmed) await deleteBuyer(buyer.id);
  }

  if (mode.kind === "new" || editing) {
    return (
      <BuyerForm
        key={editing?.id ?? "new"}
        buyer={editing}
        busy={busy}
        onSubmit={handleSubmit}
        onCancel={() => setMode({ kind: "list" })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-stone-900">Buyers</h2>
          <p className="text-sm text-stone-500">
            Saved customers you can pick when creating an invoice.
          </p>
        </div>
        <Button variant="primary" onClick={() => setMode({ kind: "new" })}>
          Add buyer
        </Button>
      </div>

      {buyers.length > 0 && (
        <TextInput
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search buyers by name, state, or GSTIN"
          aria-label="Search buyers"
          className="max-w-sm"
        />
      )}

      {!hydrated ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : buyers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-8 text-center text-sm text-stone-500">
          No buyers saved yet — add one here, or save a buyer while creating an
          invoice.
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-stone-500">
          No buyers match “{query}”.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((buyer) => (
            <li
              key={buyer.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-stone-900">
                  {buyer.name}
                </p>
                <p className="mt-0.5 text-sm text-stone-600">
                  {buyer.state} ({buyer.stateCode})
                  {buyer.gstin && (
                    <>
                      {" · "}
                      <span className="font-mono">{buyer.gstin}</span>
                    </>
                  )}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-stone-500">
                  {buyer.address}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setMode({ kind: "edit", id: buyer.id })}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void handleDelete(buyer)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
