@AGENTS.md

# Working agreement

Don't stop to ask for input on implementation judgment calls — make the reasonable
choice yourself, note what you decided and why in your final report, and keep going.
Only stop if you hit something that's genuinely ambiguous in the spec itself (not
"how should I structure this fix"), or if a gate fails and you can't resolve it.

Always run the four gates before committing:

- `npm test`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`

Commit and push after every completed milestone or change — don't leave work unpushed.
