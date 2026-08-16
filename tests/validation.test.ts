import { zodResolver } from "@hookform/resolvers/zod";
import { describe, expect, it } from "vitest";

import {
  businessProfileFormSchema,
  buyerFormSchema,
  exportBundleSchema,
  gstinStateMismatch,
  toBuyer,
  toProfile,
  toSavedBuyer,
  type BusinessProfileFormValues,
  type BuyerFormValues,
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
