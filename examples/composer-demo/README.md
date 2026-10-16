# composer-demo

One page that shows the composer the way an app would use it: `Composer` at the foot of a phone-sized page with attach and
camera on, importing `voice-kit/composer` and its stylesheet from this workspace's source. Attach a picture and a Send arrow
stands beside Hold to talk; one tap sends the picture with no words, and the page lists what the app received. Not part of
`npm pack`.

```bash
npm ci --no-audit --no-fund   # once, from the repo root
npm run dev --workspace composer-demo   # serves http://localhost:5173
```

`tests/shot.test.ts` builds the page, opens it in Chromium at 390 x 844, attaches a picture and measures it: the arrow beside
the bar, the bar the same height and left and bottom edges as before, one tap sending the picture with `text: ''`. It needs
Chromium (skipped with a note when it will not launch; `VOICE_KIT_REQUIRE_CHROMIUM=1` makes that a failure).
`COMPOSER_SHOT_DIR=<dir>` also writes the shot there; the committed one is `shots/attachment-390x844.png`.
