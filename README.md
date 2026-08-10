# Romieaux — interactive prototype

A working prototype of Romieaux, a travel intelligence platform.

**Live:** https://candiland-ux.github.io/romieaux-demo/

Seven trips are pre-built and explorable immediately — no account, no setup.
One path — "Generate a trip live" — calls the Claude API to propose real venues
for a destination you choose, then scores them locally: every dollar figure in
that trip is computed in your browser against a stated baseline, never written
by the model.

The live path needs your own Anthropic API key, entered in the demo and stored
only in your browser. Roughly 10–20 cents per generated trip. The demo does not
book anything, take payment, or create accounts.

## What's here

`index.html`, the seven scripts it loads, and a favicon. Scoring is pure
client-side JavaScript — no build step, no backend.

## Status

Prototype. Not a product, and not a template to build on.
