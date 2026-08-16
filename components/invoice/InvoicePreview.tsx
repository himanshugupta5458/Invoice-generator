"use client";

import { readableTextOn, resolveAccent } from "@/lib/color";
import { amountInWords, formatINR } from "@/lib/format";
import type { ComputedInvoice } from "@/lib/gst";
import type {
  BusinessProfile,
  Buyer,
  InvoiceStatus,
  ShipTo,
} from "@/lib/types";

export interface InvoicePreviewProps {
  business: BusinessProfile;
  buyer: Buyer;
  /** Omitted when shipping to the billing address. */
  shipTo?: ShipTo;
  invoiceNumber: string;
  date: string;
  computed: ComputedInvoice;
  termsAndConditions?: string;
  /** Frozen accent for a saved invoice; the live profile colour while editing. */
  accentColor: string;
  status?: InvoiceStatus;
  notes?: string;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  // Rendered from the ISO parts directly so the server and client agree.
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

/**
 * On-screen invoice preview (§4, §9). Mirrors the PDF layout.
 *
 * Only three elements take the accent colour — the heading rule, the table
 * header, and the grand-total band — and their text colour comes from
 * readableTextOn() so a light accent stays legible. Everything else is neutral
 * for print legibility.
 */
export function InvoicePreview({
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
}: InvoicePreviewProps) {
  const accent = resolveAccent(accentColor);
  const onAccent = readableTextOn(accent);
  const { isIntraState } = computed;

  return (
    <article className="mx-auto w-full max-w-3xl bg-white p-6 text-stone-900 shadow-sm ring-1 ring-stone-200 sm:p-8">
      <header
        className="flex flex-wrap items-start justify-between gap-4 border-b-4 pb-4"
        style={{ borderColor: accent }}
      >
        <div className="flex items-start gap-3">
          {business.logoDataUrl && (
            // A user-supplied data URL — next/image adds nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={business.logoDataUrl}
              alt=""
              className="h-14 w-auto object-contain"
            />
          )}
          <div>
            <h1
              className="text-lg font-bold tracking-tight"
              style={{ color: accent }}
            >
              {business.name || "Your business"}
            </h1>
            <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-stone-600">
              {business.address}
              {business.city ? `\n${business.city}` : ""}
              {business.state ? `\n${business.state} (${business.stateCode})` : ""}
            </p>
            <p className="mt-1 text-xs text-stone-600">
              GSTIN: <span className="font-mono">{business.gstin}</span>
            </p>
            {(business.phone || business.email) && (
              <p className="text-xs text-stone-600">
                {[business.phone, business.email].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-widest text-stone-500">
            Tax Invoice
          </p>
          {status && (
            <span
              className={
                status === "paid"
                  ? "mt-1 inline-block rounded border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-green-800"
                  : "mt-1 inline-block rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800"
              }
            >
              {status}
            </span>
          )}
        </div>
      </header>

      <section className="grid gap-4 border-b border-stone-200 py-4 text-xs sm:grid-cols-3">
        <div>
          <h2 className="font-semibold uppercase tracking-wide text-stone-500">
            Bill To
          </h2>
          <p className="mt-1 font-medium text-stone-900">
            {buyer.name || "—"}
          </p>
          <p className="whitespace-pre-line text-stone-600">{buyer.address}</p>
          <p className="text-stone-600">
            {buyer.state}
            {buyer.stateCode ? ` (${buyer.stateCode})` : ""}
          </p>
          {buyer.gstin && (
            <p className="text-stone-600">
              GSTIN: <span className="font-mono">{buyer.gstin}</span>
            </p>
          )}
        </div>

        {shipTo && (
          <div>
            <h2 className="font-semibold uppercase tracking-wide text-stone-500">
              Ship To
            </h2>
            <p className="mt-1 font-medium text-stone-900">{shipTo.name}</p>
            <p className="whitespace-pre-line text-stone-600">
              {shipTo.address}
            </p>
            <p className="text-stone-600">
              {shipTo.state}
              {shipTo.stateCode ? ` (${shipTo.stateCode})` : ""}
            </p>
            {shipTo.gstin && (
              <p className="text-stone-600">
                GSTIN: <span className="font-mono">{shipTo.gstin}</span>
              </p>
            )}
          </div>
        )}

        <dl className={shipTo ? "" : "sm:col-start-3"}>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-500">Invoice no.</dt>
            <dd className="font-mono font-medium">{invoiceNumber || "—"}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <dt className="text-stone-500">Date</dt>
            <dd className="font-medium">{formatDate(date)}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <dt className="text-stone-500">Place of supply</dt>
            <dd className="text-right font-medium">
              {computed.placeOfSupply || "—"}
              {computed.placeOfSupplyStateCode
                ? ` (${computed.placeOfSupplyStateCode})`
                : ""}
            </dd>
          </div>
        </dl>
      </section>

      <div className="overflow-x-auto py-4">
        <table className="w-full border-collapse text-xs">
          <thead>
            {/* The tax columns follow the branch: CGST+SGST intra-state, IGST inter-state (§6). */}
            <tr style={{ backgroundColor: accent, color: onAccent }}>
              <th scope="col" className="px-2 py-2 text-left font-semibold">
                #
              </th>
              <th scope="col" className="px-2 py-2 text-left font-semibold">
                Description
              </th>
              <th scope="col" className="px-2 py-2 text-left font-semibold">
                HSN
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Qty
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Rate
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Taxable
              </th>
              {isIntraState ? (
                <>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    CGST %
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    CGST
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    SGST %
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    SGST
                  </th>
                </>
              ) : (
                <>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    IGST %
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    IGST
                  </th>
                </>
              )}
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Total
              </th>
            </tr>
          </thead>

          <tbody>
            {computed.lines.length === 0 ? (
              <tr>
                <td
                  colSpan={isIntraState ? 11 : 9}
                  className="px-2 py-6 text-center text-stone-500"
                >
                  No items yet.
                </td>
              </tr>
            ) : (
              computed.lines.map((line, index) => (
                <tr key={index} className="border-b border-stone-100">
                  <td className="px-2 py-2 text-stone-500">{index + 1}</td>
                  <td className="px-2 py-2">{line.description || "—"}</td>
                  {/* HSN/SAC is optional — the PDF shows "—" too (§4). */}
                  <td className="px-2 py-2 font-mono text-stone-600">
                    {line.hsn || "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {line.quantity}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatINR(line.rate)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatINR(line.taxable)}
                  </td>
                  {isIntraState ? (
                    <>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                        {line.gstRate / 2}%
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatINR(line.cgst)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                        {line.gstRate / 2}%
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatINR(line.sgst)}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                        {line.gstRate}%
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatINR(line.igst)}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-2 text-right font-medium tabular-nums">
                    {formatINR(line.lineTotal)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-4 sm:flex-row sm:justify-between">
        <div className="flex-1 text-xs">
          <p className="text-stone-500">Amount in words</p>
          <p className="mt-0.5 font-medium text-stone-800">
            {amountInWords(computed.grandTotal)}
          </p>
        </div>

        <dl className="w-full text-xs sm:max-w-xs">
          <div className="flex justify-between py-1">
            <dt className="text-stone-600">Taxable value</dt>
            <dd className="tabular-nums">{formatINR(computed.subTotal)}</dd>
          </div>

          {isIntraState ? (
            <>
              <div className="flex justify-between py-1">
                <dt className="text-stone-600">CGST</dt>
                <dd className="tabular-nums">{formatINR(computed.totalCgst)}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="text-stone-600">SGST</dt>
                <dd className="tabular-nums">{formatINR(computed.totalSgst)}</dd>
              </div>
            </>
          ) : (
            <div className="flex justify-between py-1">
              <dt className="text-stone-600">IGST</dt>
              <dd className="tabular-nums">{formatINR(computed.totalIgst)}</dd>
            </div>
          )}

          <div className="flex justify-between border-t border-stone-200 py-1">
            <dt className="text-stone-600">Round off</dt>
            <dd className="tabular-nums">
              {computed.roundOff >= 0 ? "+" : "−"}
              {formatINR(Math.abs(computed.roundOff))}
            </dd>
          </div>

          <div
            className="mt-1 flex justify-between rounded px-2 py-2 text-sm font-semibold"
            style={{ backgroundColor: accent, color: onAccent }}
          >
            <dt>Grand total</dt>
            <dd className="tabular-nums">₹{formatINR(computed.grandTotal)}</dd>
          </div>
        </dl>
      </section>

      <footer className="mt-6 grid gap-4 border-t border-stone-200 pt-4 text-xs sm:grid-cols-2">
        <div>
          <h2 className="font-semibold uppercase tracking-wide text-stone-500">
            Bank details
          </h2>
          <dl className="mt-1 text-stone-600">
            {business.bank.bankName && <dd>{business.bank.bankName}</dd>}
            {business.bank.accountName && <dd>{business.bank.accountName}</dd>}
            {business.bank.accountNo && (
              <dd className="font-mono">A/c {business.bank.accountNo}</dd>
            )}
            {business.bank.ifsc && (
              <dd className="font-mono">IFSC {business.bank.ifsc}</dd>
            )}
            {business.bank.upi && (
              <dd className="font-mono">UPI {business.bank.upi}</dd>
            )}
          </dl>

          {termsAndConditions && (
            <>
              <h2 className="mt-4 font-semibold uppercase tracking-wide text-stone-500">
                Terms &amp; conditions
              </h2>
              <p className="mt-1 whitespace-pre-line text-stone-600">
                {termsAndConditions}
              </p>
            </>
          )}

          {notes && (
            <>
              <h2 className="mt-4 font-semibold uppercase tracking-wide text-stone-500">
                Notes
              </h2>
              <p className="mt-1 whitespace-pre-line text-stone-600">{notes}</p>
            </>
          )}
        </div>

        <div className="flex flex-col items-end justify-end text-right">
          <p className="text-stone-600">For {business.name || "your business"}</p>
          <div className="mt-10 w-48 border-t border-stone-300 pt-1 text-stone-500">
            Authorised signatory
          </div>
        </div>
      </footer>
    </article>
  );
}
