import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LocalStorageRepository,
  parseExportBundle,
  STORAGE_KEYS,
  StorageError,
  createId,
} from "@/lib/repository";
import { computeInvoice } from "@/lib/gst";
import { resetStoreForTests, useInvoiceStore } from "@/lib/store";
import type { BusinessProfile, Invoice, SavedBuyer } from "@/lib/types";
import { toInvoice, type InvoiceFormValues } from "@/lib/validation";

/** Minimal stand-in for the browser Storage API. */
class FakeStorage implements Storage {
  private map = new Map<string, string>();
  /** Simulates a quota-exceeded / private-mode write rejection. */
  failOnWrite = false;

  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (this.failOnWrite) {
      const error = new Error("QuotaExceededError");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

const storage = new FakeStorage();

/** Pretend we are in the browser, the way the app runs after hydration. */
function enterBrowser(): void {
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
}

function profile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: "profile-1",
    name: "Saara Collection",
    address: "12 Linking Road",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
    gstin: "27ABCDE1234F1Z5",
    phone: "9800000000",
    email: "hello@saara.example",
    bank: {
      accountName: "Saara Collection",
      accountNo: "000111222333",
      ifsc: "HDFC0000123",
      bankName: "HDFC Bank",
      upi: "saara@hdfcbank",
    },
    invoicePrefix: "SC/2026/",
    nextInvoiceNumber: 1,
    accentColor: "#7a5230",
    ...overrides,
  };
}

function buyer(overrides: Partial<SavedBuyer> = {}): SavedBuyer {
  return {
    id: "buyer-1",
    name: "Anand Traders",
    address: "5 MG Road",
    state: "Maharashtra",
    stateCode: "27",
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    invoiceNumber: "SC/2026/1",
    date: "2026-08-16",
    businessProfileId: "profile-1",
    businessSnapshot: profile(),
    buyer: buyer(),
    accentColor: "#7a5230",
    items: [
      {
        description: "Cotton kurta",
        hsn: "6206",
        quantity: 2,
        rate: 500,
        gstRate: 18,
      },
    ],
    status: "unpaid",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clear();
  storage.failOnWrite = false;
});

describe("LocalStorageRepository — server render (no window)", () => {
  // App Router renders on the server first, where `window` does not exist.
  // Nothing here may throw, and reads must come back empty.
  const repository = new LocalStorageRepository();

  it("reads empty without touching storage", async () => {
    expect(typeof window).toBe("undefined");
    expect(await repository.getProfiles()).toEqual([]);
    expect(await repository.getBuyers()).toEqual([]);
    expect(await repository.getInvoices()).toEqual([]);
  });

  it("makes writes a no-op instead of throwing", async () => {
    await expect(repository.saveProfile(profile())).resolves.toEqual(profile());
    await expect(repository.deleteProfile("profile-1")).resolves.toBeUndefined();
    expect(await repository.updateInvoiceStatus("invoice-1", "paid")).toBe(null);
    expect(storage.length).toBe(0);
  });
});

describe("LocalStorageRepository — in the browser", () => {
  let repository: LocalStorageRepository;

  beforeEach(() => {
    enterBrowser();
    repository = new LocalStorageRepository();
  });

  it("round-trips all three record types under the namespaced keys", async () => {
    await repository.saveProfile(profile());
    await repository.saveBuyer(buyer());
    await repository.saveInvoice(invoice());

    expect(storage.keys().sort()).toEqual(
      [STORAGE_KEYS.buyers, STORAGE_KEYS.invoices, STORAGE_KEYS.profiles].sort(),
    );
    expect(await repository.getProfiles()).toEqual([profile()]);
    expect(await repository.getBuyers()).toEqual([buyer()]);
    expect(await repository.getInvoices()).toEqual([invoice()]);
  });

  it("upserts by id rather than appending duplicates", async () => {
    await repository.saveProfile(profile());
    await repository.saveProfile(profile({ id: "profile-2", name: "Second" }));
    await repository.saveProfile(profile({ name: "Renamed" }));

    const profiles = await repository.getProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles[0].name).toBe("Renamed"); // replaced in place
    expect(profiles[1].name).toBe("Second");
  });

  it("deletes by id", async () => {
    await repository.saveBuyer(buyer());
    await repository.saveBuyer(buyer({ id: "buyer-2", name: "Nandi Retail" }));
    await repository.deleteBuyer("buyer-1");

    const buyers = await repository.getBuyers();
    expect(buyers).toHaveLength(1);
    expect(buyers[0].id).toBe("buyer-2");
  });

  it("toggles invoice status and reports a missing invoice as null", async () => {
    await repository.saveInvoice(invoice());

    const updated = await repository.updateInvoiceStatus("invoice-1", "paid");
    expect(updated?.status).toBe("paid");
    expect((await repository.getInvoices())[0].status).toBe("paid");

    expect(await repository.updateInvoiceStatus("nope", "paid")).toBe(null);
    expect(await repository.getInvoices()).toHaveLength(1);
  });

  it("treats corrupt or wrongly-shaped stored data as empty", async () => {
    storage.setItem(STORAGE_KEYS.profiles, "{not json");
    storage.setItem(STORAGE_KEYS.buyers, '{"not":"an array"}');

    expect(await repository.getProfiles()).toEqual([]);
    expect(await repository.getBuyers()).toEqual([]);
  });

  it("raises a StorageError when the browser refuses a write", async () => {
    storage.failOnWrite = true;
    await expect(repository.saveProfile(profile())).rejects.toBeInstanceOf(
      StorageError,
    );
  });

  it("exports and re-imports all three record types", async () => {
    await repository.saveProfile(profile());
    await repository.saveBuyer(buyer());
    await repository.saveInvoice(invoice());

    const bundle = await repository.exportAll();
    expect(bundle.version).toBe(1);
    expect(bundle.profiles).toHaveLength(1);
    expect(bundle.buyers).toHaveLength(1);
    expect(bundle.invoices).toHaveLength(1);

    storage.clear();
    await repository.importAll(bundle);

    expect(await repository.getProfiles()).toEqual([profile()]);
    expect(await repository.getInvoices()).toEqual([invoice()]);
  });
});

describe("parseExportBundle", () => {
  it("accepts a well-formed bundle", () => {
    const parsed = parseExportBundle(
      JSON.stringify({ profiles: [], buyers: [], invoices: [] }),
    );
    expect(parsed.version).toBe(1);
    expect(parsed.profiles).toEqual([]);
  });

  it("round-trips a profile's Quick Fill style examples", () => {
    // Optional and added in v1.2: a backup written before it must still import,
    // and one written after it must not lose the list (§16).
    const parsed = parseExportBundle(
      JSON.stringify({
        profiles: [
          profile({ styleExamples: ["Kundan Necklace Set"] }),
          profile({ id: "profile-2", styleExamples: undefined }),
        ],
        buyers: [],
        invoices: [],
      }),
    );
    expect(parsed.profiles[0].styleExamples).toEqual(["Kundan Necklace Set"]);
    expect(parsed.profiles[1].styleExamples).toBeUndefined();
  });

  it("rejects files that would wipe good data", () => {
    expect(() => parseExportBundle("not json at all")).toThrow(StorageError);
    expect(() => parseExportBundle("null")).toThrow(StorageError);
    expect(() => parseExportBundle('{"profiles":[]}')).toThrow(StorageError);
    expect(() => parseExportBundle('{"profiles":{},"buyers":[],"invoices":[]}')).toThrow(
      StorageError,
    );
  });
});

describe("createId", () => {
  it("returns distinct ids", () => {
    expect(createId()).not.toBe(createId());
  });
});

describe("store wired to the repository", () => {
  beforeEach(() => {
    enterBrowser();
    resetStoreForTests();
  });

  it("starts empty and only reports hydrated after loading", async () => {
    storage.setItem(STORAGE_KEYS.profiles, JSON.stringify([profile()]));

    expect(useInvoiceStore.getState().hydrated).toBe(false);
    expect(useInvoiceStore.getState().profiles).toEqual([]);

    await useInvoiceStore.getState().hydrate();

    expect(useInvoiceStore.getState().hydrated).toBe(true);
    expect(useInvoiceStore.getState().profiles).toEqual([profile()]);
  });

  it("shares one read across concurrent hydrate calls", async () => {
    storage.setItem(STORAGE_KEYS.buyers, JSON.stringify([buyer()]));

    await Promise.all([
      useInvoiceStore.getState().hydrate(),
      useInvoiceStore.getState().hydrate(),
      useInvoiceStore.getState().hydrate(),
    ]);

    // Concurrent calls must not stack up duplicate records.
    expect(useInvoiceStore.getState().buyers).toEqual([buyer()]);

    // A later call is a no-op and cannot clobber unsaved in-memory work.
    await useInvoiceStore.getState().saveBuyer(buyer({ id: "buyer-2" }));
    await useInvoiceStore.getState().hydrate();
    expect(useInvoiceStore.getState().buyers).toHaveLength(2);
  });

  it("persists writes through the repository", async () => {
    await useInvoiceStore.getState().hydrate();
    await useInvoiceStore.getState().saveBuyer(buyer());
    await useInvoiceStore.getState().saveInvoice(invoice());

    expect(useInvoiceStore.getState().buyers).toHaveLength(1);
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.buyers)!)).toHaveLength(1);
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.invoices)!)).toHaveLength(1);

    await useInvoiceStore.getState().setInvoiceStatus("invoice-1", "paid");
    expect(useInvoiceStore.getState().invoices[0].status).toBe("paid");

    await useInvoiceStore.getState().deleteBuyer("buyer-1");
    expect(useInvoiceStore.getState().buyers).toEqual([]);
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.buyers)!)).toEqual([]);
  });

  it("keeps state in sync with storage when a write fails", async () => {
    await useInvoiceStore.getState().hydrate();
    storage.failOnWrite = true;

    const saved = await useInvoiceStore.getState().saveBuyer(buyer());

    // Callers close forms and show success notices off this boolean, so a
    // refused write has to report itself rather than resolve quietly.
    expect(saved).toBe(false);
    // The record was never persisted, so it must not appear in memory either.
    expect(useInvoiceStore.getState().buyers).toEqual([]);
    expect(useInvoiceStore.getState().error).toMatch(/storage/i);

    useInvoiceStore.getState().clearError();
    expect(useInvoiceStore.getState().error).toBe(null);
  });

  it("replaces everything on import and leaves data intact on a bad file", async () => {
    await useInvoiceStore.getState().hydrate();
    await useInvoiceStore.getState().saveBuyer(buyer());

    const imported = await useInvoiceStore
      .getState()
      .importData(
        JSON.stringify({ profiles: [profile()], buyers: [], invoices: [] }),
      );

    expect(imported).toBe(true);
    expect(useInvoiceStore.getState().profiles).toHaveLength(1);
    expect(useInvoiceStore.getState().buyers).toEqual([]);

    const rejected = await useInvoiceStore.getState().importData("garbage");
    expect(rejected).toBe(false);
    expect(useInvoiceStore.getState().error).toBeTruthy();
    expect(useInvoiceStore.getState().profiles).toHaveLength(1); // untouched
  });

  it("exports the current data", async () => {
    await useInvoiceStore.getState().hydrate();
    await useInvoiceStore.getState().saveProfile(profile());

    const bundle = await useInvoiceStore.getState().exportData();
    expect(bundle?.profiles).toEqual([profile()]);
  });
});

/**
 * The end-to-end guarantee behind §14: an issued invoice is a document, not a
 * view. Once saved, nothing the user does to the profile or the buyer afterwards
 * may change it — including a reload, which is what re-reading storage below
 * simulates.
 */
describe("an issued invoice is immune to later edits", () => {
  beforeEach(() => {
    enterBrowser();
    resetStoreForTests();
  });

  /** The form values the builder would submit for the fixtures above. */
  function formValues(): InvoiceFormValues {
    return {
      businessProfileId: "profile-1",
      invoiceNumber: "SC/2026/1",
      date: "2026-08-16",
      buyerId: "buyer-1",
      buyer: {
        name: "Anand Traders",
        address: "5 MG Road",
        state: "Maharashtra",
        stateCode: "27",
        gstin: "",
        phone: "",
      },
      saveBuyer: false,
      sameAsBilling: true,
      shipTo: { name: "", address: "", state: "", stateCode: "", gstin: "" },
      items: [
        { description: "Cotton kurta", hsn: "6206", quantity: 2, rate: 500, gstRate: 18 },
      ],
      notes: "",
    };
  }

  it("keeps its snapshot when the source profile and buyer are edited", async () => {
    const store = useInvoiceStore.getState();
    await store.hydrate();

    const original = profile({ termsAndConditions: "Payment due in 15 days." });
    await store.saveProfile(original);
    await store.saveBuyer(buyer());
    await store.saveInvoice(toInvoice(formValues(), original, "invoice-1"));

    // The user later rebrands, moves state, and rewrites the terms; the buyer
    // record is corrected too.
    await store.saveProfile(
      profile({
        name: "Saara Collection Pvt Ltd",
        state: "Karnataka",
        stateCode: "29",
        accentColor: "#0f766e",
        termsAndConditions: "New terms.",
      }),
    );
    await store.saveBuyer(buyer({ name: "Anand Traders & Sons" }));

    // Re-read from storage, the way a page reload would.
    resetStoreForTests();
    await useInvoiceStore.getState().hydrate();
    const [stored] = useInvoiceStore.getState().invoices;

    expect(stored.businessSnapshot.name).toBe("Saara Collection");
    expect(stored.businessSnapshot.stateCode).toBe("27");
    expect(stored.accentColor).toBe("#7a5230");
    expect(stored.termsAndConditions).toBe("Payment due in 15 days.");
    expect(stored.buyer.name).toBe("Anand Traders");

    // And the snapshot's own state code still drives the tax branch: seller 27
    // vs buyer 27 is intra-state, even though the live profile is now 29.
    const computed = computeInvoice(
      stored.businessSnapshot,
      stored.buyer,
      stored.items,
    );
    expect(computed.isIntraState).toBe(true);
    expect(computed.grandTotal).toBe(1180);
  });

  it("reports a refused save so the builder can keep the invoice number", async () => {
    const store = useInvoiceStore.getState();
    await store.hydrate();
    await store.saveProfile(profile());

    storage.failOnWrite = true;
    const saved = await useInvoiceStore
      .getState()
      .saveInvoice(toInvoice(formValues(), profile(), "invoice-1"));

    expect(saved).toBe(false);
    expect(useInvoiceStore.getState().invoices).toEqual([]);
    expect(useInvoiceStore.getState().error).toMatch(/storage/i);
  });

  it("saves as paid and survives a status toggle across a reload", async () => {
    const store = useInvoiceStore.getState();
    await store.hydrate();
    await store.saveProfile(profile());
    await store.saveInvoice(toInvoice(formValues(), profile(), "invoice-1"));

    expect(useInvoiceStore.getState().invoices[0].status).toBe("paid");

    await useInvoiceStore.getState().setInvoiceStatus("invoice-1", "unpaid");

    resetStoreForTests();
    await useInvoiceStore.getState().hydrate();
    expect(useInvoiceStore.getState().invoices[0].status).toBe("unpaid");
  });
});
