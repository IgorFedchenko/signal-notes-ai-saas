# Genuine demo recording

The final GIF is pending capture; existing screenshots are from the earlier real
local browser acceptance. Do not fabricate a GIF or a payment success screen.

With Docker, Node, Chromium dependencies and ffmpeg available:

```sh
npm run demo -- --capture
```

The launcher installs dependencies, starts the dedicated local fixture stack/app,
records real browser interaction with `tour@signal.local`, encodes
`demos/signal-notes.gif`, runs the HTTP/DB smoke, and shuts down. It saves the original
WebM in ignored `demos/raw/`. The account and note are synthetic; no DOM replacement,
model network call or Stripe payment is used. Inspect the actual GIF before linking it
from README. The video shows save → summarize → exact evidence → usage → billing.
