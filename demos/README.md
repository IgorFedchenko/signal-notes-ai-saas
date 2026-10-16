# Genuine demo recording

![Real synthetic account: note, summary, evidence, usage and unavailable test billing](signal-notes.gif)

The 16-second GIF and current workspace/mobile screenshots were captured from the
real Next.js/Supabase/Postgres app at `602b4d0`, in the successful
[`launcher-and-phoenix` job](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38827575492).
The separate browser job in that run stopped at JSON-module discovery; no browser
acceptance is inferred from that failure. The earlier complete browser acceptance
passed at [`34c694d`](https://github.com/IgorFedchenko/signal-notes-ai-saas/actions/runs/38826691940).
Later complete historical results are described in [verification](../docs/VERIFICATION.md).
Actions are now disabled while private; reproduce checks [locally](../docs/TESTING.md).

The recording signs in as `tour@signal.local`, saves a synthetic release decision,
generates a local extractive summary, expands exact evidence, shows cost/prompt/trace
metadata and usage, then opens truthful unavailable test billing. A real synthetic
login warms development routes before the recorded context signs in normally. The
mobile capture uses the same real Auth session in an iPhone viewport and expands all
quotes. No DOM identity edits, route response substitutions, model calls or payment
success screens are used. All media was decoded and visually inspected; hashes and
exact capture revisions are in [media.json](media.json).

With Docker, Node, Chromium dependencies and ffmpeg available:

```sh
npm run demo -- --capture
```

The launcher installs locked app dependencies, starts the dedicated local fixture
stack/app, captures genuine browser interaction, encodes `demos/signal-notes.gif`,
runs the real HTTP/DB smoke and shuts down. Original WebM remains in ignored
`demos/raw/` and the CI artifact. Use `--capture --phoenix` to also check actual route
spans, collector outage and recovery. Stripe-hosted payment, live models and cloud
deployment are outside this case's scope; no payment recording is claimed.
