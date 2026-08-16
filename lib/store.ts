/**
 * Zustand app state, wired to the Repository (spec §2, §7).
 *
 * This store is the only thing in the app that talks to the repository, and the
 * repository is the only thing that talks to storage. Components read records
 * from here and call these actions — they never touch `localStorage`.
 *
 * Nothing is read from storage at module load: App Router renders on the server
 * first, so the store starts empty and a client component calls `hydrate()` in
 * an effect. `hydrated` tells the UI whether an empty list means "nothing saved
 * yet" or "not loaded yet", which keeps empty states from flashing.
 */

import { create } from "zustand";

import {
  getRepository,
  parseExportBundle,
  StorageError,
  type ExportBundle,
} from "./repository";
import type {
  BusinessProfile,
  Invoice,
  InvoiceStatus,
  SavedBuyer,
} from "./types";

export interface InvoiceGenState {
  profiles: BusinessProfile[];
  buyers: SavedBuyer[];
  invoices: Invoice[];

  /** True once the first read from storage has completed. */
  hydrated: boolean;
  /** True while a read or write is in flight. */
  busy: boolean;
  /** Last user-facing storage error, if any. */
  error: string | null;

  hydrate: () => Promise<void>;
  clearError: () => void;

  saveProfile: (profile: BusinessProfile) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;

  saveBuyer: (buyer: SavedBuyer) => Promise<void>;
  deleteBuyer: (id: string) => Promise<void>;

  saveInvoice: (invoice: Invoice) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  setInvoiceStatus: (id: string, status: InvoiceStatus) => Promise<void>;

  exportData: () => Promise<ExportBundle | null>;
  /** Takes the raw text of an uploaded backup file. */
  importData: (rawJson: string) => Promise<boolean>;
}

/** Upsert by id, preserving position for an existing record. */
function upsert<T extends { id: string }>(list: T[], record: T): T[] {
  const index = list.findIndex((existing) => existing.id === record.id);
  if (index === -1) return [...list, record];
  const next = [...list];
  next[index] = record;
  return next;
}

function messageFor(error: unknown): string {
  if (error instanceof StorageError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong while saving your data.";
}

/** Guards against a second hydrate() while the first is still in flight. */
let hydration: Promise<void> | null = null;

export const useInvoiceStore = create<InvoiceGenState>()((set, get) => {
  /**
   * Runs a repository call, then applies its result to state. The write happens
   * first: if storage rejects it, in-memory state is left untouched rather than
   * drifting out of sync with what was actually persisted.
   */
  async function run<T>(
    action: () => Promise<T>,
    apply: (result: T) => Partial<InvoiceGenState>,
  ): Promise<T | null> {
    set({ busy: true, error: null });
    try {
      const result = await action();
      set({ ...apply(result), busy: false });
      return result;
    } catch (error) {
      set({ busy: false, error: messageFor(error) });
      return null;
    }
  }

  return {
    profiles: [],
    buyers: [],
    invoices: [],
    hydrated: false,
    busy: false,
    error: null,

    hydrate: async () => {
      if (get().hydrated) return;
      if (hydration) return hydration;

      hydration = (async () => {
        const repository = getRepository();
        set({ busy: true, error: null });
        try {
          const [profiles, buyers, invoices] = await Promise.all([
            repository.getProfiles(),
            repository.getBuyers(),
            repository.getInvoices(),
          ]);
          set({ profiles, buyers, invoices, hydrated: true, busy: false });
        } catch (error) {
          set({ hydrated: true, busy: false, error: messageFor(error) });
        } finally {
          hydration = null;
        }
      })();

      return hydration;
    },

    clearError: () => set({ error: null }),

    saveProfile: async (profile) => {
      await run(
        () => getRepository().saveProfile(profile),
        (saved) => ({ profiles: upsert(get().profiles, saved) }),
      );
    },

    deleteProfile: async (id) => {
      await run(
        () => getRepository().deleteProfile(id),
        () => ({ profiles: get().profiles.filter((p) => p.id !== id) }),
      );
    },

    saveBuyer: async (buyer) => {
      await run(
        () => getRepository().saveBuyer(buyer),
        (saved) => ({ buyers: upsert(get().buyers, saved) }),
      );
    },

    deleteBuyer: async (id) => {
      await run(
        () => getRepository().deleteBuyer(id),
        () => ({ buyers: get().buyers.filter((b) => b.id !== id) }),
      );
    },

    saveInvoice: async (invoice) => {
      await run(
        () => getRepository().saveInvoice(invoice),
        (saved) => ({ invoices: upsert(get().invoices, saved) }),
      );
    },

    deleteInvoice: async (id) => {
      await run(
        () => getRepository().deleteInvoice(id),
        () => ({ invoices: get().invoices.filter((i) => i.id !== id) }),
      );
    },

    setInvoiceStatus: async (id, status) => {
      await run(
        () => getRepository().updateInvoiceStatus(id, status),
        (updated) =>
          updated ? { invoices: upsert(get().invoices, updated) } : {},
      );
    },

    exportData: async () => run(() => getRepository().exportAll(), () => ({})),

    importData: async (rawJson) => {
      const result = await run(
        async () => {
          // Validate before writing so a wrong file cannot wipe good data.
          const bundle = parseExportBundle(rawJson);
          await getRepository().importAll(bundle);
          return bundle;
        },
        (bundle) => ({
          profiles: bundle.profiles,
          buyers: bundle.buyers,
          invoices: bundle.invoices,
        }),
      );
      return result !== null;
    },
  };
});

/** Reset helper for tests and for the "start over" path. */
export function resetStoreForTests(): void {
  hydration = null;
  useInvoiceStore.setState({
    profiles: [],
    buyers: [],
    invoices: [],
    hydrated: false,
    busy: false,
    error: null,
  });
}
