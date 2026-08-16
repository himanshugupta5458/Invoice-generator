/**
 * Persistence boundary (spec §7).
 *
 * Three record types are persisted: business profiles, saved buyers, and
 * invoices. v1 stores them in the browser's `localStorage` and nowhere else —
 * no database. That means data lives on one device, survives reloads, and is
 * lost if the user clears site data. This is deliberate for v1; the Export /
 * Import JSON action is how a user backs up or moves their data.
 *
 * Components and the Zustand store call this Repository only — they never touch
 * `localStorage` directly. Every method is async even though `localStorage` is
 * synchronous, so a network-backed implementation can satisfy the same interface
 * without changing a single call site.
 *
 * // TODO: add PostgresRepository/SupabaseRepository implementing Repository for durable, multi-device storage — only do this after v1 is tested and a real need for it is confirmed.
 */

import type {
  BusinessProfile,
  Invoice,
  InvoiceStatus,
  SavedBuyer,
} from "./types";
import { exportBundleSchema } from "./validation";

/** Namespaced storage keys (§7). */
export const STORAGE_KEYS = {
  profiles: "invoicegen:profiles",
  buyers: "invoicegen:buyers",
  invoices: "invoicegen:invoices",
} as const;

/** Shape of the Settings > Export / Import JSON payload. */
export interface ExportBundle {
  version: 1;
  exportedAt: string; // ISO timestamp
  profiles: BusinessProfile[];
  buyers: SavedBuyer[];
  invoices: Invoice[];
}

export const EXPORT_VERSION = 1;

/**
 * Keep these method names stable so swapping in a database-backed
 * implementation later is a mechanical change (§7).
 */
export interface Repository {
  getProfiles(): Promise<BusinessProfile[]>;
  /** Upsert by id — inserts a new profile or replaces the existing one. */
  saveProfile(profile: BusinessProfile): Promise<BusinessProfile>;
  deleteProfile(id: string): Promise<void>;

  getBuyers(): Promise<SavedBuyer[]>;
  saveBuyer(buyer: SavedBuyer): Promise<SavedBuyer>;
  deleteBuyer(id: string): Promise<void>;

  getInvoices(): Promise<Invoice[]>;
  saveInvoice(invoice: Invoice): Promise<Invoice>;
  deleteInvoice(id: string): Promise<void>;
  /** Returns the updated invoice, or null when no invoice has that id. */
  updateInvoiceStatus(
    id: string,
    status: InvoiceStatus,
  ): Promise<Invoice | null>;

  /** Dump all three record types for the Settings backup action (§7). */
  exportAll(): Promise<ExportBundle>;
  /** Restore all three record types, replacing what is currently stored. */
  importAll(bundle: ExportBundle): Promise<void>;
}

/** Thrown when the browser refuses a write (private mode, quota exceeded). */
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
  }
}

/**
 * App Router renders on the server first, where `window` does not exist.
 * Every storage access goes through this guard.
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Stable id for new records. */
export function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without the Web Crypto API.
  return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function readList<T>(key: string): T[] {
  if (!isBrowser()) return []; // server render — nothing persisted to read
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // Corrupt or unreadable JSON must not crash the app; treat it as empty.
    return [];
  }
}

function writeList<T>(key: string, list: T[]): void {
  if (!isBrowser()) return; // no-op on the server
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch (cause) {
    throw new StorageError(
      "Could not save to browser storage. It may be full (a large logo image is the usual cause) or disabled in this browser.",
      { cause },
    );
  }
}

/** Upsert by id, preserving position for an existing record. */
function upsert<T extends { id: string }>(list: T[], record: T): T[] {
  const index = list.findIndex((existing) => existing.id === record.id);
  if (index === -1) return [...list, record];
  const next = [...list];
  next[index] = record;
  return next;
}

/** Concrete v1 implementation: browser `localStorage`, no database (§7). */
export class LocalStorageRepository implements Repository {
  async getProfiles(): Promise<BusinessProfile[]> {
    return readList<BusinessProfile>(STORAGE_KEYS.profiles);
  }

  async saveProfile(profile: BusinessProfile): Promise<BusinessProfile> {
    const profiles = await this.getProfiles();
    writeList(STORAGE_KEYS.profiles, upsert(profiles, profile));
    return profile;
  }

  async deleteProfile(id: string): Promise<void> {
    const profiles = await this.getProfiles();
    writeList(
      STORAGE_KEYS.profiles,
      profiles.filter((profile) => profile.id !== id),
    );
    // Saved invoices keep a frozen businessSnapshot, so deleting a profile
    // never disturbs invoice history (§5 snapshot rule).
  }

  async getBuyers(): Promise<SavedBuyer[]> {
    return readList<SavedBuyer>(STORAGE_KEYS.buyers);
  }

  async saveBuyer(buyer: SavedBuyer): Promise<SavedBuyer> {
    const buyers = await this.getBuyers();
    writeList(STORAGE_KEYS.buyers, upsert(buyers, buyer));
    return buyer;
  }

  async deleteBuyer(id: string): Promise<void> {
    const buyers = await this.getBuyers();
    writeList(
      STORAGE_KEYS.buyers,
      buyers.filter((buyer) => buyer.id !== id),
    );
  }

  async getInvoices(): Promise<Invoice[]> {
    return readList<Invoice>(STORAGE_KEYS.invoices);
  }

  async saveInvoice(invoice: Invoice): Promise<Invoice> {
    const invoices = await this.getInvoices();
    writeList(STORAGE_KEYS.invoices, upsert(invoices, invoice));
    return invoice;
  }

  async deleteInvoice(id: string): Promise<void> {
    const invoices = await this.getInvoices();
    writeList(
      STORAGE_KEYS.invoices,
      invoices.filter((invoice) => invoice.id !== id),
    );
  }

  async updateInvoiceStatus(
    id: string,
    status: InvoiceStatus,
  ): Promise<Invoice | null> {
    const invoices = await this.getInvoices();
    const existing = invoices.find((invoice) => invoice.id === id);
    if (!existing) return null;
    const updated: Invoice = { ...existing, status };
    writeList(STORAGE_KEYS.invoices, upsert(invoices, updated));
    return updated;
  }

  async exportAll(): Promise<ExportBundle> {
    return {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      profiles: await this.getProfiles(),
      buyers: await this.getBuyers(),
      invoices: await this.getInvoices(),
    };
  }

  async importAll(bundle: ExportBundle): Promise<void> {
    writeList(STORAGE_KEYS.profiles, bundle.profiles);
    writeList(STORAGE_KEYS.buyers, bundle.buyers);
    writeList(STORAGE_KEYS.invoices, bundle.invoices);
  }
}

/**
 * Validate an uploaded backup file before it is allowed to replace stored data.
 * Records are checked structurally rather than against the stricter form rules,
 * so a legitimate export always re-imports cleanly while a wrong file is
 * rejected before it can wipe good data.
 */
export function parseExportBundle(raw: string): ExportBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new StorageError("That file is not valid JSON.", { cause });
  }

  const result = exportBundleSchema.safeParse(parsed);
  if (!result.success) {
    throw new StorageError(
      "That file is not an InvoiceGen backup — it is missing valid profiles, buyers, or invoices.",
      { cause: result.error },
    );
  }

  return {
    version: EXPORT_VERSION,
    exportedAt: result.data.exportedAt ?? new Date().toISOString(),
    profiles: result.data.profiles,
    buyers: result.data.buyers,
    invoices: result.data.invoices,
  };
}

/**
 * The single repository instance the app uses. Swapping storage later means
 * calling setRepository() with a different implementation — nothing else changes.
 */
let repository: Repository = new LocalStorageRepository();

export function getRepository(): Repository {
  return repository;
}

export function setRepository(next: Repository): void {
  repository = next;
}
