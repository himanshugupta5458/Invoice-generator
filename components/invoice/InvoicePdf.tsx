/**
 * Vector PDF rendering of an invoice (spec §8).
 *
 * Mirrors InvoicePreview's layout and takes the same props, so the on-screen
 * preview and the downloaded document cannot drift apart. Everything is real
 * `Text` — never a screenshot — so the PDF stays selectable and searchable.
 *
 * Three things to know before editing this file:
 *
 *  1. FONTS. Noto Sans (Regular + Bold) is registered as the *only* family, and
 *     is the reason `₹` can be rendered as the actual glyph rather than "Rs.".
 *     Adding a second family would break that guarantee for any text that lands
 *     in it, so don't.
 *  2. COLUMNS. The table's columns are defined once, as data, in
 *     `columnsFor(isIntraState)`. The header and the body both walk that array,
 *     which is what keeps their widths aligned — react-pdf has no <table>, so a
 *     hand-duplicated header would silently drift out of register.
 *  3. ACCENT. Only the header rule, the table-header fill, and the grand-total
 *     band take the accent, and text on the accent comes from readableTextOn()
 *     so a light accent stays legible. This matches InvoicePreview exactly.
 */

import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import type { InvoicePreviewProps } from "@/components/invoice/InvoicePreview";
import { readableTextOn, resolveAccent } from "@/lib/color";
import { amountInWords, formatINR } from "@/lib/format";
import type { ComputedLine } from "@/lib/gst";
import type { Buyer, ShipTo } from "@/lib/types";

/**
 * Self-hosted from /public/fonts (OFL, free for commercial use). Registered at
 * module scope so it happens once, when this module is first imported — the
 * download path imports it dynamically, so this never runs on the server.
 */
Font.register({
  family: "Noto Sans",
  fonts: [
    { src: "/fonts/NotoSans-Regular.ttf", fontWeight: 400 },
    { src: "/fonts/NotoSans-Bold.ttf", fontWeight: 700 },
  ],
});

// react-pdf hyphenates long words by default, which turns an HSN code or a long
// product description into "8471-\n30". A tax invoice should not have invented
// hyphens in it, so words wrap whole instead.
Font.registerHyphenationCallback((word) => [word]);

/**
 * Deliberately an alias, not a second copy of the same field list: the PDF and
 * the preview must accept exactly the same input for "mirror the on-screen
 * preview" (§8) to stay true. The import is type-only, so nothing from the
 * preview's client bundle is pulled into the PDF chunk.
 */
export type InvoicePdfProps = InvoicePreviewProps;

const COLORS = {
  text: "#1c1917", // stone-900
  muted: "#57534e", // stone-600
  faint: "#78716c", // stone-500
  rule: "#e7e5e4", // stone-200
  ruleStrong: "#d6d3d1", // stone-300
  zebra: "#fafaf9", // stone-50
  paidBg: "#f0fdf4",
  paidBorder: "#86efac",
  paidText: "#166534",
  unpaidBg: "#fffbeb",
  unpaidBorder: "#fcd34d",
  unpaidText: "#92400e",
} as const;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Noto Sans",
    fontSize: 8.5,
    color: COLORS.text,
    paddingTop: 32,
    paddingBottom: 44, // leaves room for the fixed page-number footer
    paddingHorizontal: 32,
    lineHeight: 1.4,
  },

  // --- header -------------------------------------------------------------
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 10,
    borderBottomWidth: 3,
    borderBottomStyle: "solid",
  },
  headerLeft: { flexDirection: "row", gap: 10, maxWidth: "68%" },
  // Height only — a fixed width would squash a wide logo into a square.
  logo: { height: 42, maxWidth: 120, objectFit: "contain" },
  // lineHeight is explicit, not inherited: react-pdf does not carry the page's
  // lineHeight into a node that overrides fontSize, and at 14pt the resulting
  // tight line box lets the name collide with the address line beneath it.
  businessName: { fontSize: 14, fontWeight: 700, lineHeight: 1.4 },
  headerRight: { alignItems: "flex-end" },
  docLabel: { fontSize: 9, letterSpacing: 1.6, color: COLORS.faint },
  badge: {
    marginTop: 5,
    paddingVertical: 2.5,
    paddingHorizontal: 7,
    borderRadius: 3,
    borderWidth: 1,
    borderStyle: "solid",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.8,
  },

  // --- parties / supply details -------------------------------------------
  parties: {
    flexDirection: "row",
    gap: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: COLORS.rule,
  },
  block: { flex: 1 },
  blockHeading: {
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 0.6,
    color: COLORS.faint,
    marginBottom: 3,
  },
  partyName: { fontWeight: 700 },
  muted: { color: COLORS.muted },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 2,
  },
  detailValue: { fontWeight: 700, textAlign: "right" },

  // --- items table ---------------------------------------------------------
  table: { marginTop: 12 },
  tableHeader: { flexDirection: "row" },
  headerCell: { paddingVertical: 5, paddingHorizontal: 3, fontWeight: 700 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: COLORS.rule,
  },
  rowAlt: { backgroundColor: COLORS.zebra },
  cell: { paddingVertical: 4, paddingHorizontal: 3 },
  emptyRow: {
    paddingVertical: 16,
    textAlign: "center",
    color: COLORS.faint,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: COLORS.rule,
  },

  // --- totals --------------------------------------------------------------
  summary: { flexDirection: "row", gap: 20, marginTop: 12 },
  totals: { width: 210 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2.5,
  },
  roundOffRow: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: COLORS.rule,
  },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 7,
    borderRadius: 3,
    fontSize: 10.5,
    fontWeight: 700,
  },

  // --- footer blocks -------------------------------------------------------
  footer: {
    flexDirection: "row",
    gap: 20,
    marginTop: 18,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: COLORS.rule,
  },
  signature: {
    width: 150,
    alignItems: "flex-end",
    justifyContent: "flex-end",
    textAlign: "right",
  },
  signatureRule: {
    marginTop: 40,
    paddingTop: 3,
    width: "100%",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: COLORS.ruleStrong,
    color: COLORS.faint,
  },
  pageNumber: {
    position: "absolute",
    bottom: 22,
    left: 32,
    right: 32,
    textAlign: "center",
    fontSize: 7.5,
    color: COLORS.faint,
  },
});

type Align = "left" | "right";

export interface Column {
  key: string;
  label: string;
  /** Percentage of the table width. The set must sum to 100 — see tests. */
  width: number;
  align: Align;
  cell: (line: ComputedLine, index: number) => string;
  /** Line totals read as the row's conclusion, so they carry weight. */
  bold?: boolean;
  muted?: boolean;
}

/**
 * The column set follows the tax branch (§6): CGST + SGST intra-state, IGST
 * inter-state. An inter-state invoice never shows empty CGST columns — it gets
 * a genuinely different, wider-columned table.
 *
 * Exported for testing: nothing in react-pdf complains when percentage widths
 * do not add up to 100, the header and body just quietly stop lining up.
 */
export function columnsFor(isIntraState: boolean): Column[] {
  const leading: Column[] = [
    {
      key: "sr",
      label: "#",
      width: isIntraState ? 3.5 : 4,
      align: "left",
      muted: true,
      cell: (_line, index) => `${index + 1}`,
    },
    {
      key: "description",
      label: "Description",
      width: isIntraState ? 27 : 32,
      align: "left",
      cell: (line) => line.description || "—",
    },
    {
      key: "hsn",
      label: "HSN",
      width: isIntraState ? 7 : 9,
      align: "left",
      muted: true,
      cell: (line) => line.hsn || "—",
    },
    {
      key: "quantity",
      label: "Qty",
      width: isIntraState ? 5.5 : 6,
      align: "right",
      cell: (line) => `${line.quantity}`,
    },
    {
      key: "rate",
      label: "Rate",
      width: isIntraState ? 9 : 11,
      align: "right",
      cell: (line) => formatINR(line.rate),
    },
    {
      key: "taxable",
      label: "Taxable",
      width: isIntraState ? 10 : 12,
      align: "right",
      cell: (line) => formatINR(line.taxable),
    },
  ];

  const tax: Column[] = isIntraState
    ? [
        {
          key: "cgstRate",
          label: "CGST %",
          width: 5.5,
          align: "right",
          muted: true,
          cell: (line) => `${line.gstRate / 2}%`,
        },
        {
          key: "cgst",
          label: "CGST",
          width: 8.5,
          align: "right",
          cell: (line) => formatINR(line.cgst),
        },
        {
          key: "sgstRate",
          label: "SGST %",
          width: 5.5,
          align: "right",
          muted: true,
          cell: (line) => `${line.gstRate / 2}%`,
        },
        {
          key: "sgst",
          label: "SGST",
          width: 8.5,
          align: "right",
          cell: (line) => formatINR(line.sgst),
        },
      ]
    : [
        {
          key: "igstRate",
          label: "IGST %",
          width: 7,
          align: "right",
          muted: true,
          cell: (line) => `${line.gstRate}%`,
        },
        {
          key: "igst",
          label: "IGST",
          width: 9.5,
          align: "right",
          cell: (line) => formatINR(line.igst),
        },
      ];

  return [
    ...leading,
    ...tax,
    {
      key: "lineTotal",
      label: "Total",
      width: isIntraState ? 10 : 9.5,
      align: "right",
      bold: true,
      cell: (line) => formatINR(line.lineTotal),
    },
  ];
}

/** Rendered from the ISO parts directly so it never depends on a timezone. */
function formatDate(iso: string): string {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

function stateLine(state: string, stateCode: string): string {
  if (!state) return "";
  return stateCode ? `${state} (${stateCode})` : state;
}

/** A party block — used for both Bill To and Ship To, which share a shape. */
function PartyBlock({
  heading,
  party,
}: {
  heading: string;
  party: Buyer | ShipTo;
}) {
  const location = stateLine(party.state, party.stateCode);
  return (
    <View style={styles.block}>
      <Text style={styles.blockHeading}>{heading.toUpperCase()}</Text>
      <Text style={styles.partyName}>{party.name || "—"}</Text>
      {!!party.address && <Text style={styles.muted}>{party.address}</Text>}
      {!!location && <Text style={styles.muted}>{location}</Text>}
      {!!party.gstin && <Text style={styles.muted}>GSTIN: {party.gstin}</Text>}
      {"phone" in party && !!party.phone && (
        <Text style={styles.muted}>{party.phone}</Text>
      )}
    </View>
  );
}

export function InvoicePdf({
  business,
  buyer,
  shipTo,
  invoiceNumber,
  date,
  computed,
  termsAndConditions,
  accentColor,
  status,
  notes,
}: InvoicePdfProps) {
  const accent = resolveAccent(accentColor);
  const onAccent = readableTextOn(accent);
  const { isIntraState } = computed;
  const columns = columnsFor(isIntraState);
  const paid = status === "paid";

  const businessLocation = [
    business.city,
    stateLine(business.state, business.stateCode),
  ]
    .filter(Boolean)
    .join(", ");
  const contact = [business.phone, business.email].filter(Boolean).join(" · ");

  const bankLines = [
    business.bank.bankName,
    business.bank.accountName,
    business.bank.accountNo && `A/c ${business.bank.accountNo}`,
    business.bank.ifsc && `IFSC ${business.bank.ifsc}`,
    business.bank.upi && `UPI ${business.bank.upi}`,
  ].filter((entry): entry is string => Boolean(entry));

  return (
    <Document
      title={`Invoice ${invoiceNumber}`}
      author={business.name}
      subject={`Tax invoice for ${buyer.name}`}
      creator="Saara Collection Invoice Tool"
      producer="Saara Collection Invoice Tool"
    >
      <Page size="A4" style={styles.page}>
        {/* The header rule is one of the three accent-themed elements (§8). */}
        <View style={[styles.header, { borderBottomColor: accent }]}>
          <View style={styles.headerLeft}>
            {!!business.logoDataUrl && (
              // react-pdf's Image is a PDF primitive, not an <img> — it has no
              // alt prop to give it, and the business name sits beside it.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image style={styles.logo} src={business.logoDataUrl} />
            )}
            <View>
              <Text style={[styles.businessName, { color: accent }]}>
                {business.name || "Your business"}
              </Text>
              {!!business.address && (
                <Text style={styles.muted}>{business.address}</Text>
              )}
              {!!businessLocation && (
                <Text style={styles.muted}>{businessLocation}</Text>
              )}
              {!!business.gstin && (
                <Text style={styles.muted}>GSTIN: {business.gstin}</Text>
              )}
              {!!contact && <Text style={styles.muted}>{contact}</Text>}
            </View>
          </View>

          <View style={styles.headerRight}>
            <Text style={styles.docLabel}>TAX INVOICE</Text>
            {/* Paid/Unpaid badge, near the top of the document (§8). */}
            {!!status && (
              <Text
                style={[
                  styles.badge,
                  paid
                    ? {
                        backgroundColor: COLORS.paidBg,
                        borderColor: COLORS.paidBorder,
                        color: COLORS.paidText,
                      }
                    : {
                        backgroundColor: COLORS.unpaidBg,
                        borderColor: COLORS.unpaidBorder,
                        color: COLORS.unpaidText,
                      },
                ]}
              >
                {status.toUpperCase()}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.parties}>
          <PartyBlock heading="Bill To" party={buyer} />
          {/* Omitted entirely when shipping to the billing address (§8). The
              spacer keeps the details block in the right-hand third either way,
              matching the preview's `sm:col-start-3`. */}
          {shipTo ? (
            <PartyBlock heading="Ship To" party={shipTo} />
          ) : (
            <View style={styles.block} />
          )}

          <View style={styles.block}>
            <Text style={styles.blockHeading}>INVOICE DETAILS</Text>
            <View style={styles.detailRow}>
              <Text style={styles.muted}>Invoice no.</Text>
              <Text style={styles.detailValue}>{invoiceNumber || "—"}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.muted}>Date</Text>
              <Text style={styles.detailValue}>{formatDate(date)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.muted}>Place of supply</Text>
              <Text style={styles.detailValue}>
                {stateLine(
                  computed.placeOfSupply,
                  computed.placeOfSupplyStateCode,
                ) || "—"}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.muted}>Supply type</Text>
              <Text style={styles.detailValue}>
                {isIntraState ? "Intra-state" : "Inter-state"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.table}>
          {/* `fixed` repeats the header at the top of every page the table spans. */}
          <View
            style={[
              styles.tableHeader,
              { backgroundColor: accent, color: onAccent },
            ]}
            fixed
          >
            {columns.map((column) => (
              <Text
                key={column.key}
                style={[
                  styles.headerCell,
                  { width: `${column.width}%`, textAlign: column.align },
                ]}
              >
                {column.label}
              </Text>
            ))}
          </View>

          {computed.lines.length === 0 ? (
            <Text style={styles.emptyRow}>No items.</Text>
          ) : (
            computed.lines.map((line, index) => (
              <View
                key={index}
                style={[styles.row, ...(index % 2 ? [styles.rowAlt] : [])]}
                wrap={false}
              >
                {columns.map((column) => (
                  <Text
                    key={column.key}
                    style={[
                      styles.cell,
                      { width: `${column.width}%`, textAlign: column.align },
                      ...(column.muted ? [{ color: COLORS.muted }] : []),
                      ...(column.bold ? [{ fontWeight: 700 as const }] : []),
                    ]}
                  >
                    {column.cell(line, index)}
                  </Text>
                ))}
              </View>
            ))
          )}
        </View>

        <View style={styles.summary}>
          <View style={styles.block}>
            <Text style={styles.blockHeading}>AMOUNT IN WORDS</Text>
            <Text style={{ fontWeight: 700 }}>
              {amountInWords(computed.grandTotal)}
            </Text>
          </View>

          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text style={styles.muted}>Taxable value</Text>
              <Text>{formatINR(computed.subTotal)}</Text>
            </View>

            {isIntraState ? (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.muted}>CGST</Text>
                  <Text>{formatINR(computed.totalCgst)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.muted}>SGST</Text>
                  <Text>{formatINR(computed.totalSgst)}</Text>
                </View>
              </>
            ) : (
              <View style={styles.totalRow}>
                <Text style={styles.muted}>IGST</Text>
                <Text>{formatINR(computed.totalIgst)}</Text>
              </View>
            )}

            {/* Signed, because it can go either way (§6). */}
            <View style={[styles.totalRow, styles.roundOffRow]}>
              <Text style={styles.muted}>Round off</Text>
              <Text>
                {computed.roundOff >= 0 ? "+" : "−"}
                {formatINR(Math.abs(computed.roundOff))}
              </Text>
            </View>

            <View
              style={[
                styles.grandTotal,
                { backgroundColor: accent, color: onAccent },
              ]}
            >
              <Text>Grand total</Text>
              {/* Noto Sans has a real ₹ glyph — no "Rs." fallback (§8). */}
              <Text>₹{formatINR(computed.grandTotal)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <View style={styles.block}>
            {bankLines.length > 0 && (
              <>
                <Text style={styles.blockHeading}>BANK DETAILS</Text>
                {bankLines.map((entry) => (
                  <Text key={entry} style={styles.muted}>
                    {entry}
                  </Text>
                ))}
              </>
            )}

            {!!termsAndConditions && (
              <>
                <Text
                  style={[
                    styles.blockHeading,
                    bankLines.length > 0 ? { marginTop: 8 } : {},
                  ]}
                >
                  TERMS &amp; CONDITIONS
                </Text>
                <Text style={styles.muted}>{termsAndConditions}</Text>
              </>
            )}

            {!!notes && (
              <>
                <Text style={[styles.blockHeading, { marginTop: 8 }]}>
                  NOTES
                </Text>
                <Text style={styles.muted}>{notes}</Text>
              </>
            )}
          </View>

          <View style={styles.signature}>
            <Text style={styles.muted}>
              For {business.name || "your business"}
            </Text>
            <Text style={styles.signatureRule}>Authorised signatory</Text>
          </View>
        </View>

        <Text
          style={styles.pageNumber}
          fixed
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : ""
          }
        />
      </Page>
    </Document>
  );
}
