"use client";

import { useMemo, useState } from "react";

import { BuyerForm } from "@/components/settings/BuyerForm";
import { Button } from "@/components/ui/Button";
import { EmptyState, PanelLoading, SectionCard } from "@/components/ui/Card";
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
    // Only leave the form on a write that actually landed — closing it after a
    // failed save would throw away everything just typed.
    if (await saveBuyer(toSavedBuyer(values, id))) setMode({ kind: "list" });
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
    <SectionCard
      title="Buyers"
      description="Saved customers you can pick when creating an invoice."
      actions={
        <Button variant="primary" onClick={() => setMode({ kind: "new" })}>
          Add buyer
        </Button>
      }
      bare
    >
      {/* The search belongs to the list, so it sits in its own band above the
          rows rather than floating above the whole card. */}
      {buyers.length > 0 && (
        <div className="border-b border-ink-100 px-5 py-3 sm:px-6">
          <TextInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search buyers by name, state, or GSTIN"
            aria-label="Search buyers"
            className="sm:max-w-sm"
          />
        </div>
      )}

      {!hydrated ? (
        <PanelLoading />
      ) : buyers.length === 0 ? (
        <div className="px-5 sm:px-6">
          <EmptyState
            bordered={false}
            title="No buyers saved yet"
            description="Add one here, or tick “Save this buyer for next time” while creating an invoice."
            action={
              <Button variant="primary" onClick={() => setMode({ kind: "new" })}>
                Add your first buyer
              </Button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-500 sm:px-6">
          No buyers match “{query}”.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {visible.map((buyer) => (
            <li
              key={buyer.id}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 py-4 sm:px-6"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-900">
                  {buyer.name}
                </p>
                <p className="mt-1 truncate text-sm text-ink-600">
                  {buyer.state} ({buyer.stateCode})
                  {buyer.gstin && (
                    <>
                      {" · "}
                      <span className="font-mono">{buyer.gstin}</span>
                    </>
                  )}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-ink-500">
                  {buyer.address}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
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
    </SectionCard>
  );
}
