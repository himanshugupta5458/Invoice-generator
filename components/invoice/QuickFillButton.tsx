"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/Button";
import { TextArea, TextInput } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { formatINR } from "@/lib/format";
import {
  MAX_DESCRIPTION_CHARS,
  parseGstRateFromDescription,
  type QuickFillErrorBody,
  type QuickFillResponseBody,
  type QuickFillRowError,
} from "@/lib/quick-fill";
import type { InvoiceItemFormValues } from "@/lib/validation";

/**
 * Quick Fill (AI) — describe a purchase, get plausible rows (§16, v1.1).
 *
 * Shaped after CsvImportButton on purpose: a trigger that sits with the other
 * item actions, a panel that renders full-width under the rows it changes, and
 * one hook holding the state both halves read. The two features append items the
 * same way and report refusals the same way, so they should not feel like two
 * different mechanisms.
 *
 * What is different is trust. A CSV came from the user; these rows came from a
 * model, so the copy says plainly that they are estimates for testing — never
 * anything that should go out as a real purchase record without being checked.
 *
 * The model only picks the mix; the rates are solved server-side against the
 * app's own GST engine. Those rates are whole rupees, because that is what a real
 * invoice quotes — which means a target is approached rather than guaranteed, and
 * the panel says by how much it missed. Reporting ₹8,65,400 next to a target of
 * ₹8,65,412 without mentioning the ₹12 would invite exactly the wrong assumption.
 *
 * Nothing here holds a key or talks to Groq: it POSTs to /api/quick-fill, which
 * is the only place the key exists.
 */

/** Rejected rows listed in full before collapsing into a "…and N more" line. */
const MAX_LISTED_REJECTIONS = 6;

interface QuickFillSummary {
  added: number;
  rejected: QuickFillRowError[];
  /** GST-inclusive total of the rows that were added. */
  total: number;
  /** What the user asked for, when they asked for anything. */
  target?: number;
  /**
   * `total - target`, from the solver. Whole-rupee rates cannot reach every
   * figure, so this is shown whenever it is not zero — a total sitting silently
   * ₹12 below the target the user typed invites them to assume it matched.
   */
  gap: number;
}

export interface QuickFillState {
  open: boolean;
  busy: boolean;
  description: string;
  setDescription: (value: string) => void;
  targetAmount: string;
  setTargetAmount: (value: string) => void;
  /** A blocking problem — nothing was added. */
  error: string | null;
  /** What the last successful generation produced. */
  summary: QuickFillSummary | null;
  toggle: () => void;
  close: () => void;
  generate: () => Promise<void>;
}

/**
 * @param onGenerate  Where the solved rows go — the same path CSV rows take.
 * @param isIntraState  The invoice's current tax branch (§6). It has to travel
 *   with the request because CGST + SGST and IGST round differently, and the
 *   solver has to price for the branch these rows will actually be taxed on.
 */
export function useQuickFill(
  onGenerate: (items: InvoiceItemFormValues[]) => void,
  isIntraState: boolean,
): QuickFillState {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<QuickFillSummary | null>(null);

  async function generate() {
    const trimmed = description.trim();

    // Checked here as well as on the route: an empty submission should cost the
    // shared free tier nothing at all.
    if (trimmed === "") {
      setSummary(null);
      setError("Describe what you bought first.");
      return;
    }
    if (trimmed.length > MAX_DESCRIPTION_CHARS) {
      setSummary(null);
      setError(`Keep the description under ${MAX_DESCRIPTION_CHARS} characters.`);
      return;
    }

    // A rate named in the description pins every row to it. Checked here as well
    // as on the route so a "15%" typo is corrected without a round trip, using
    // the same pure function so the two can never disagree about what is valid.
    const namedRate = parseGstRateFromDescription(trimmed);
    if (namedRate.error) {
      setSummary(null);
      setError(namedRate.error);
      return;
    }

    const typedTarget = targetAmount.trim();
    let target: number | undefined;
    if (typedTarget !== "") {
      const parsed = Number(typedTarget.replace(/[₹,\s]/g, ""));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setSummary(null);
        setError("Enter a target amount greater than 0, or leave it blank.");
        return;
      }
      // The rows will total this exactly, and an invoice total is always a whole
      // number of rupees (§6) — so a target with paise in it is unreachable by
      // definition, and saying so beats quietly hitting a different figure.
      if (!Number.isInteger(parsed)) {
        setSummary(null);
        setError(
          "Use a whole number of rupees — an invoice total is always rounded to the nearest rupee.",
        );
        return;
      }
      target = parsed;
    }

    setBusy(true);
    setError(null);
    setSummary(null);

    try {
      const response = await fetch("/api/quick-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: trimmed,
          targetAmount: target,
          isIntraState,
        }),
      });

      // Every route reply is JSON, but a proxy or a platform error page is not,
      // so a failed parse must still produce a sentence rather than a crash.
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          (body as QuickFillErrorBody | null)?.error ??
          "Quick Fill could not generate items. Try again in a moment.";
        setError(message);
        return;
      }

      const data = body as QuickFillResponseBody | null;
      if (!data || !Array.isArray(data.items) || data.items.length === 0) {
        setError("Quick Fill returned no usable items. Try rewording it.");
        return;
      }

      onGenerate(data.items);
      setSummary({
        added: data.items.length,
        rejected: Array.isArray(data.rejected) ? data.rejected : [],
        total: typeof data.total === "number" ? data.total : 0,
        gap: typeof data.gap === "number" ? data.gap : 0,
        target,
      });
    } catch (cause) {
      console.error("Quick Fill request failed", cause);
      setError("Could not reach Quick Fill. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return {
    open,
    busy,
    description,
    setDescription,
    targetAmount,
    setTargetAmount,
    error,
    summary,
    toggle: () => setOpen((value) => !value),
    close: () => {
      setOpen(false);
      setError(null);
      setSummary(null);
    },
    generate,
  };
}

export interface QuickFillButtonProps {
  state: QuickFillState;
  panelId: string;
  disabled?: boolean;
}

/** The trigger; the panel it opens is rendered by the caller, under the rows. */
export function QuickFillButton({
  state,
  panelId,
  disabled,
}: QuickFillButtonProps) {
  return (
    <Button
      disabled={disabled}
      onClick={state.toggle}
      aria-expanded={state.open}
      aria-controls={panelId}
    >
      <SparkIcon />
      Quick Fill (AI)
    </Button>
  );
}

export interface QuickFillPanelProps {
  state: QuickFillState;
  id: string;
  disabled?: boolean;
}

export function QuickFillPanel({ state, id, disabled }: QuickFillPanelProps) {
  const fieldId = useId();
  const descriptionId = `${fieldId}-description`;
  const targetId = `${fieldId}-target`;

  if (!state.open) return null;

  const remaining = MAX_DESCRIPTION_CHARS - state.description.trim().length;
  const locked = disabled || state.busy;

  return (
    <div
      id={id}
      className="rounded-xl border border-ink-200 bg-ink-50 p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <span className="flex size-6 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
              <SparkIcon />
            </span>
            Quick Fill (AI)
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            Describe a purchase and the AI will draft sample rows for you. Rates
            come out as whole rupees, landing as near your target as those allow.
          </p>
        </div>
        <button
          type="button"
          onClick={state.close}
          aria-label="Close Quick Fill"
          className="focus-ring shrink-0 rounded-lg p-1 text-ink-500 transition-colors hover:bg-ink-200 hover:text-ink-900 motion-reduce:transition-none"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={descriptionId}
            className="text-[0.8125rem] font-medium leading-5 text-ink-700"
          >
            What was bought
          </label>
          <TextArea
            id={descriptionId}
            rows={3}
            maxLength={MAX_DESCRIPTION_CHARS}
            disabled={locked}
            placeholder="e.g. furniture shopping — a sofa, two side tables and a lamp"
            value={state.description}
            onChange={(event) => state.setDescription(event.target.value)}
          />
          <p className="text-xs leading-relaxed text-ink-500">
            Name a GST rate — &ldquo;Motor Parts 5%&rdquo; — to put every row on
            that slab.{" "}
            {remaining < 0
              ? `${Math.abs(remaining)} characters over the limit`
              : `${remaining} characters left`}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={targetId}
            className="text-[0.8125rem] font-medium leading-5 text-ink-700"
          >
            Target total{" "}
            <span className="font-normal text-ink-400">(optional)</span>
          </label>
          <TextInput
            id={targetId}
            type="number"
            min={0}
            step="1"
            inputMode="decimal"
            disabled={locked}
            placeholder="45000"
            className="text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            value={state.targetAmount}
            onChange={(event) => state.setTargetAmount(event.target.value)}
            // This panel sits inside the invoice <form>, so Enter here would
            // otherwise submit the invoice rather than generate rows.
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (!locked) void state.generate();
            }}
          />
          <p className="text-xs leading-relaxed text-ink-500">
            Including GST. Whole rupees. Approached, not guaranteed.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={locked}
          aria-busy={state.busy}
          onClick={() => void state.generate()}
        >
          {state.busy ? "Generating…" : "Generate items"}
        </Button>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-500">
          Sample rows for testing — not verified purchase data. The prices are
          worked backwards from the target, not looked up. Check every figure
          before issuing the invoice.
        </p>
      </div>

      {state.error && (
        <Notice tone="warning" role="alert" size="sm" className="mt-3">
          {state.error}
        </Notice>
      )}

      {state.summary && <QuickFillSummaryNote summary={state.summary} />}
    </div>
  );
}

/** What the generation added, and what it refused. */
function QuickFillSummaryNote({ summary }: { summary: QuickFillSummary }) {
  const listed = summary.rejected.slice(0, MAX_LISTED_REJECTIONS);
  const hidden = summary.rejected.length - listed.length;

  return (
    <Notice
      tone={summary.rejected.length > 0 ? "warning" : "success"}
      size="sm"
      className="mt-3"
    >
      <p>
        Added {summary.added} {summary.added === 1 ? "item" : "items"} totalling{" "}
        <span className="font-medium tabular-nums">
          ₹{formatINR(summary.total)}
        </span>
        {summary.target !== undefined && (
          <>
            {summary.gap === 0
              ? " — exactly your target"
              : ` — ₹${formatINR(Math.abs(summary.gap))} ${
                  summary.gap < 0 ? "under" : "over"
                } your ₹${formatINR(summary.target)} target`}
          </>
        )}
        .
      </p>
      {summary.target !== undefined && summary.gap !== 0 && (
        <p className="mt-1">
          Rates are whole rupees, which cannot always add up to an exact total.
          Adjust any rate by hand to close the difference.
        </p>
      )}

      {listed.length > 0 && (
        <>
          <p className="mt-1.5 font-medium">
            {summary.rejected.length}{" "}
            {summary.rejected.length === 1 ? "row was" : "rows were"} not added:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {listed.map((row) => (
              <li key={row.index}>
                Row {row.index}
                {row.label ? ` (${row.label})` : ""}: {row.messages.join("; ")}
              </li>
            ))}
          </ul>
          {hidden > 0 && <p className="mt-1">…and {hidden} more row(s).</p>}
        </>
      )}
    </Notice>
  );
}

function SparkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 2.25 7.1 5.4 10.25 6.5 7.1 7.6 6 10.75 4.9 7.6 1.75 6.5 4.9 5.4 6 2.25ZM11.75 9.25l.6 1.65 1.65.6-1.65.6-.6 1.65-.6-1.65-1.65-.6 1.65-.6.6-1.65Z" />
    </svg>
  );
}
