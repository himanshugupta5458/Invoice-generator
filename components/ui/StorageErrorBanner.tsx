"use client";

import { Notice } from "./Notice";
import { useInvoiceStore } from "@/lib/store";

/** Surfaces a failed read/write so a lost save is never silent. */
export function StorageErrorBanner() {
  const error = useInvoiceStore((state) => state.error);
  const clearError = useInvoiceStore((state) => state.clearError);

  if (!error) return null;

  return (
    <Notice
      tone="danger"
      role="alert"
      onDismiss={clearError}
      dismissLabel="Dismiss storage error"
    >
      {error}
    </Notice>
  );
}
