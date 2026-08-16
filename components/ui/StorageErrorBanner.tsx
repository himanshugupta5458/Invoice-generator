"use client";

import { Button } from "./Button";
import { useInvoiceStore } from "@/lib/store";

/** Surfaces a failed read/write so a lost save is never silent. */
export function StorageErrorBanner() {
  const error = useInvoiceStore((state) => state.error);
  const clearError = useInvoiceStore((state) => state.clearError);

  if (!error) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <p>{error}</p>
      <Button size="sm" variant="ghost" onClick={clearError}>
        Dismiss
      </Button>
    </div>
  );
}
