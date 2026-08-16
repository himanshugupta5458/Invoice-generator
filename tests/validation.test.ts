import { zodResolver } from "@hookform/resolvers/zod";
import { describe, expect, it } from "vitest";

import {
  businessProfileFormSchema,
  buyerFormSchema,
  exportBundleSchema,
  gstinStateMismatch,
  invoiceFormSchema,
  toBuyer,
  toInvoice,
  toInvoiceItems,
  toProfile,
  toSavedBuyer,
  type BusinessProfileFormValues,
  type BuyerFormValues,
  type InvoiceFormValues,
} from "@/lib/validation";

function profileValues(
  overrides: Partial<BusinessProfileFormValues> = {},
): BusinessProfileFormValues {
  return {
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
      ifsc: "hdfc0000123",
      bankName: "HDFC Bank",
      upi: "saara@hdfcbank",
    },
    invoicePrefix: "SC/2026/",
    nextInvoiceNumber: 1,
    accentColor: "#7A5230",
    termsAndConditions: "Payment due within 15 days.",
    ...overrides,
  };
}

function buyerValues(overrides: Partial<BuyerFormValues> = {}): BuyerFormValues {
  return {
    name: "Anand Traders",
    address: "5 MG Road",
    state: "Maharashtra",
    stateCode: "27",
    gstin: "",
    phone: "",
    ...overrides,
  };
}

/** First error message for a field path, or undefined. */
function messageFor(
  result: ReturnType<typeof businessProfileFormSchema.safeParse>,
  path: string,
): string | undefined {
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path.join(".") === path)
    ?.message;
}

describe("businessProfileFormSchema", () => {
  it("accepts a complete profile", () => {
    expect(businessProfileFormSchema.safeParse(profileValues()).success).toBe(
      true,
    );
  });

  it("requires the fields an invoice cannot be issued without", () => {
    const result = businessProfileFormSchema.safeParse(
      profileValues({ name: "", address: "", state: "", invoicePrefix: "" }),
    );
    expect(messageFor(result, "name")).toMatch(/required/i);
    expect(messageFor(result, "address")).toMatch(/required/i);
    expect(messageFor(result, "state")).toMatch(/required/i);
    expect(messageFor(result, "invoicePrefix")).toMatch(/required/i);
  });

  it("rejects a malformed GSTIN and state code", () => {
    const result = businessProfileFormSchema.safeParse(
      profileValues({ gstin: "27ABCDE", stateCode: "7" }),
    );
    expect(messageFor(result, "gstin")).toMatch(/15-character/i);
    expect(messageFor(result, "stateCode")).toMatch(/2 digits/i);
  });

  it("treats an empty email as fine but a malformed one as an error", () => {
    expect(
      businessProfileFormSchema.safeParse(profileValues({ email: "" })).success,
    ).toBe(true);
    expect(
      messageFor(
        businessProfileFormSchema.safeParse(profileValues({ email: "nope" })),
        "email",
      ),
    ).toMatch(/valid email/i);
  });

  it("requires a usable starting invoice number", () => {
    // An empty number input reaches the resolver as NaN.
    expect(
      messageFor(
        businessProfileFormSchema.safeParse(
          profileValues({ nextInvoiceNumber: Number.NaN }),
        ),
        "nextInvoiceNumber",
      ),
    ).toMatch(/starting invoice number/i);
    expect(
      messageFor(
        businessProfileFormSchema.safeParse(
          profileValues({ nextInvoiceNumber: 0 }),
        ),
        "nextInvoiceNumber",
      ),
    ).toMatch(/1 or more/i);
    expect(
      messageFor(
        businessProfileFormSchema.safeParse(
          profileValues({ nextInvoiceNumber: 2.5 }),
        ),
        "nextInvoiceNumber",
      ),
    ).toMatch(/whole number/i);
  });

  it("rejects an unusable accent colour", () => {
    expect(
      messageFor(
        businessProfileFormSchema.safeParse(
          profileValues({ accentColor: "burnt sienna" }),
        ),
        "accentColor",
      ),
    ).toMatch(/hex colour/i);
  });
});

describe("buyerFormSchema", () => {
  it("accepts a buyer with no GSTIN (unregistered)", () => {
    expect(buyerFormSchema.safeParse(buyerValues()).success).toBe(true);
  });

  it("validates a GSTIN only when one is entered", () => {
    const result = buyerFormSchema.safeParse(buyerValues({ gstin: "27ABC" }));
    expect(result.success).toBe(false);
    expect(
      buyerFormSchema.safeParse(buyerValues({ gstin: "27AAACB1234C1ZX" }))
        .success,
    ).toBe(true);
  });

  it("requires the state code that decides the tax branch", () => {
    expect(buyerFormSchema.safeParse(buyerValues({ stateCode: "" })).success).toBe(
      false,
    );
  });
});

describe("zodResolver integration", () => {
  // Guards the wiring react-hook-form actually depends on: errors must come
  // back keyed by field path, including nested bank fields.
  it("returns per-field errors for the form to render", async () => {
    const resolve = zodResolver(businessProfileFormSchema);
    const context = { fields: {}, shouldUseNativeValidation: false };

    const valid = await resolve(profileValues(), undefined, context);
    expect(valid.errors).toEqual({});

    const invalid = await resolve(
      profileValues({ name: "", gstin: "nope" }),
      undefined,
      context,
    );
    const errors = invalid.errors as Record<string, { message?: string }>;
    expect(errors.name?.message).toMatch(/required/i);
    expect(errors.gstin?.message).toMatch(/15-character/i);
  });
});

describe("gstinStateMismatch", () => {
  it("flags a GSTIN whose state digits disagree with the state code", () => {
    expect(gstinStateMismatch("29AAACB1234C1ZX", "27")).toBe(true);
  });

  it("stays quiet when they agree or either field is incomplete", () => {
    expect(gstinStateMismatch("27ABCDE1234F1Z5", "27")).toBe(false);
    expect(gstinStateMismatch("27ABC", "27")).toBe(false);
    expect(gstinStateMismatch("27ABCDE1234F1Z5", "2")).toBe(false);
  });
});

describe("form values to stored records", () => {
  it("normalises the values that must be consistent downstream", () => {
    const profile = toProfile(profileValues(), "profile-1");
    expect(profile.id).toBe("profile-1");
    expect(profile.accentColor).toBe("#7a5230"); // normalised hex
    expect(profile.gstin).toBe("27ABCDE1234F1Z5");
    expect(profile.bank.ifsc).toBe("HDFC0000123"); // uppercased
  });

  it("stores absent optional values as undefined, not empty strings", () => {
    const profile = toProfile(
      profileValues({ termsAndConditions: "   " }),
      "profile-1",
    );
    expect(profile.termsAndConditions).toBeUndefined();
    expect(profile.logoDataUrl).toBeUndefined();

    const buyer = toBuyer(buyerValues({ gstin: "", phone: "  " }));
    expect(buyer.gstin).toBeUndefined();
    expect(buyer.phone).toBeUndefined();

    const [item] = toInvoiceItems([
      { description: "Cotton kurta", hsn: "  ", quantity: 1, rate: 500, gstRate: 5 },
    ]);
    expect(item.hsn).toBeUndefined();
  });

  it("uppercases a buyer GSTIN and keeps the id on a saved buyer", () => {
    const saved = toSavedBuyer(
      buyerValues({ gstin: "27aaacb1234c1zx" }),
      "buyer-1",
    );
    expect(saved.id).toBe("buyer-1");
    expect(saved.gstin).toBe("27AAACB1234C1ZX");
  });
});

function invoiceValues(
  overrides: Partial<InvoiceFormValues> = {},
): InvoiceFormValues {
  return {
    businessProfileId: "profile-1",
    invoiceNumber: "SC/2026/1",
    date: "2026-08-16",
    buyerId: "",
    buyer: buyerValues(),
    saveBuyer: false,
    sameAsBilling: true,
    shipTo: { name: "", address: "", state: "", stateCode: "", gstin: "" },
    items: [
      {
        description: "Cotton kurta",
        hsn: "6206",
        quantity: 2,
        rate: 500,
        gstRate: 18,
      },
    ],
    notes: "",
    ...overrides,
  };
}

describe("invoiceFormSchema", () => {
  it("accepts a complete invoice", () => {
    expect(invoiceFormSchema.safeParse(invoiceValues()).success).toBe(true);
  });

  it("requires a business profile and at least one item", () => {
    const result = invoiceFormSchema.safeParse(
      invoiceValues({ businessProfileId: "", items: [] }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((issue) => issue.message);
    expect(messages).toContain("Select a business profile");
    expect(messages).toContain("Add at least one item");
  });

  it("rejects an item with no description, no quantity, or an off-slab GST rate", () => {
    const result = invoiceFormSchema.safeParse(
      invoiceValues({
        items: [
          { description: "", hsn: "", quantity: 0, rate: -1, gstRate: 17 },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("items.0.description");
    expect(paths).toContain("items.0.quantity");
    expect(paths).toContain("items.0.rate");
    expect(paths).toContain("items.0.gstRate");
    // HSN/SAC is optional (§4) — a blank one is not an error.
    expect(paths).not.toContain("items.0.hsn");
  });

  it("accepts an item with a blank or missing HSN/SAC", () => {
    expect(
      invoiceFormSchema.safeParse(
        invoiceValues({
          items: [
            { description: "Cotton kurta", hsn: "", quantity: 1, rate: 500, gstRate: 5 },
          ],
        }),
      ).success,
    ).toBe(true);

    // A CSV row with no hsn column at all leaves the key undefined.
    expect(
      invoiceFormSchema.safeParse(
        invoiceValues({
          items: [
            { description: "Cotton kurta", quantity: 1, rate: 500, gstRate: 5 },
          ],
        }),
      ).success,
    ).toBe(true);
  });

  it("ignores empty Ship To fields while 'same as billing' is on", () => {
    // Ship To is optional by default, so blank fields must not block a save.
    expect(
      invoiceFormSchema.safeParse(invoiceValues({ sameAsBilling: true })).success,
    ).toBe(true);
  });

  it("requires Ship To details once 'same as billing' is switched off", () => {
    const result = invoiceFormSchema.safeParse(
      invoiceValues({ sameAsBilling: false }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("shipTo.name");
    expect(paths).toContain("shipTo.address");
    expect(paths).toContain("shipTo.state");
    expect(paths).toContain("shipTo.stateCode");
  });

  it("accepts a filled-in Ship To", () => {
    expect(
      invoiceFormSchema.safeParse(
        invoiceValues({
          sameAsBilling: false,
          shipTo: {
            name: "Nandi Warehouse",
            address: "Plot 9",
            state: "Karnataka",
            stateCode: "29",
            gstin: "",
          },
        }),
      ).success,
    ).toBe(true);
  });
});

describe("toInvoice — the snapshot rule (§5)", () => {
  const profile = toProfile(profileValues(), "profile-1");

  it("defaults to paid and freezes the accent colour and terms", () => {
    const invoice = toInvoice(invoiceValues(), profile, "invoice-1");
    expect(invoice.status).toBe("paid");
    expect(invoice.accentColor).toBe(profile.accentColor);
    expect(invoice.termsAndConditions).toBe("Payment due within 15 days.");
    expect(invoice.businessProfileId).toBe("profile-1");
  });

  it("takes terms from the profile, not the form — they are seller-only (§4)", () => {
    const other = toProfile(
      profileValues({ termsAndConditions: "Goods once sold are not returnable." }),
      "profile-2",
    );
    expect(toInvoice(invoiceValues(), other, "i1").termsAndConditions).toBe(
      "Goods once sold are not returnable.",
    );

    // A profile with no default leaves the invoice without terms rather than
    // storing an empty string.
    const bare = toProfile(profileValues({ termsAndConditions: "" }), "profile-3");
    expect(toInvoice(invoiceValues(), bare, "i2").termsAndConditions).toBeUndefined();
  });

  it("keeps a deep copy of the business, so later profile edits cannot change it", () => {
    const invoice = toInvoice(invoiceValues(), profile, "invoice-1");

    // Simulate the user editing the profile afterwards.
    profile.name = "Renamed Later";
    profile.bank.ifsc = "CHANGED0001";
    profile.accentColor = "#000000";

    expect(invoice.businessSnapshot.name).toBe("Saara Collection");
    expect(invoice.businessSnapshot.bank.ifsc).toBe("HDFC0000123");
    expect(invoice.accentColor).toBe("#7a5230");
  });

  it("omits shipTo when shipping to the billing address", () => {
    expect(toInvoice(invoiceValues(), profile, "i1").shipTo).toBeUndefined();
  });

  it("stores shipTo when a separate shipping party is given", () => {
    const invoice = toInvoice(
      invoiceValues({
        sameAsBilling: false,
        shipTo: {
          name: "Nandi Warehouse",
          address: "Plot 9",
          state: "Karnataka",
          stateCode: "29",
          gstin: "",
        },
      }),
      profile,
      "i1",
    );
    expect(invoice.shipTo?.name).toBe("Nandi Warehouse");
    expect(invoice.shipTo?.stateCode).toBe("29");
    expect(invoice.shipTo?.gstin).toBeUndefined();
  });
});

describe("exportBundleSchema", () => {
  it("accepts an empty backup", () => {
    expect(
      exportBundleSchema.safeParse({ profiles: [], buyers: [], invoices: [] })
        .success,
    ).toBe(true);
  });

  it("rejects a file whose records are the wrong shape", () => {
    expect(
      exportBundleSchema.safeParse({
        profiles: [{ name: "no id" }],
        buyers: [],
        invoices: [],
      }).success,
    ).toBe(false);
  });
});
