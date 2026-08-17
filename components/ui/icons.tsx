/**
 * The app's icon set.
 *
 * Hand-drawn rather than pulled from a package: three navigation glyphs and a
 * handful of control glyphs do not justify a dependency, and keeping them here
 * means one stroke weight and one grid across the whole of the chrome.
 *
 * All of them are 24×24, stroked in `currentColor`, and sized by the caller
 * through `className` (`size-5` in the sidebar, `size-4` inline). They are
 * decorative — every one is `aria-hidden`, so the accessible name always comes
 * from the text or `aria-label` of the control that holds them.
 */

type IconProps = { className?: string };

function Icon({
  className = "size-5",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** New invoice — a document with a plus. */
export function FilePlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 2.75H7A2.25 2.25 0 0 0 4.75 5v14A2.25 2.25 0 0 0 7 21.25h10A2.25 2.25 0 0 0 19.25 19V8L14 2.75Z" />
      <path d="M13.75 3v5.25H19" />
      <path d="M12 11.75v5M9.5 14.25h5" />
    </Icon>
  );
}

/** History — a clock. */
export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.25V12l3.25 1.9" />
    </Icon>
  );
}

/** Settings — sliders rather than a gear; it reads at 20px, a gear does not. */
export function SlidersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.75 8.25h9.5M17.75 8.25h2.5" />
      <circle cx="15.5" cy="8.25" r="2.25" />
      <path d="M3.75 15.75h2.5M10.75 15.75h9.5" />
      <circle cx="8.5" cy="15.75" r="2.25" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}

/** The wordmark's glyph — a receipt with a torn foot. */
export function ReceiptIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.75 3.75h12.5v16.5l-2.5-1.5-2.5 1.5-2.5-1.5-2.5 1.5-2.5-1.5V3.75Z" />
      <path d="M9 8.5h6M9 12.25h6" />
    </Icon>
  );
}
