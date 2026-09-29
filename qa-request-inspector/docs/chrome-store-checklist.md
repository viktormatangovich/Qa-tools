# Chrome Web Store release checklist

- [ ] Increment `public/manifest.json` version and update screenshots/listing text.
- [ ] Run `npm run test:qa`, `npx tsc --noEmit`, and `npm run build`.
- [ ] Load `dist/` in Chrome and verify Network capture, Console capture, QA Check, Contract Checker, negative-test mock enable/disable, saved-session comparison, and report downloads.
- [ ] Confirm no captured body, cookie, token, or request data is sent outside the browser.
- [ ] Review `PRIVACY.md` and permission explanations for the submitted listing.
- [ ] Create the upload archive with `npm run zip` and inspect its contents before upload.
