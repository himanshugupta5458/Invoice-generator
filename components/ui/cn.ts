/**
 * Join conditional class names.
 *
 * This is a plain join, NOT a Tailwind-aware merge: two classes setting the same
 * property both survive, and the winner is whichever rule Tailwind emits last in
 * the stylesheet — not whichever appears last here. `w-24` loses to the `w-full`
 * baked into the shared field styles, for instance, so passing a width to
 * TextInput/Select does nothing. Size those controls from their container
 * (a grid column, a max-w-* utility) rather than by overriding the base class.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
