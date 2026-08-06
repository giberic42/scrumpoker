# Scrum Poker Room

Static scrum poker app for GitHub Pages with Firebase Auth and Cloud Firestore for live room syncing.

## What it does

- Create or join a room by `room ID`
- Protect access with a shared session passphrase
- Let each teammate set their own story point vote
- Hide votes until the host reveals them
- Show a live average from all submitted votes
- Let the host clear votes for the next round

## Files

- `index.html`: app shell and styles
- `app.js`: Firebase-powered room logic
- `firebase-config.js`: your local Firebase web app config, kept out of git
- `firebase-config.example.js`: template for the Firebase web app config
- `firestore.rules`: starter Firestore rules

## Firebase setup

1. Create a Firebase project in the Firebase console.
2. Add a web app to that project.
3. Enable `Authentication`.
4. In `Authentication > Sign-in method`, enable `Anonymous`.
5. Create a `Cloud Firestore` database.
6. Copy `firebase-config.example.js` to `firebase-config.js`.
7. Replace the placeholder values in `firebase-config.js` with your real web app config.
8. In `Authentication > Settings > Authorized domains`, add your GitHub Pages domain, for example `yourname.github.io`.

## Firestore rules

Start with the rules in `firestore.rules`.

These rules require Firebase Auth, but they do not do deep server-side validation of the room passphrase. This app keeps the passphrase out of Firestore and derives the room document key locally from `room ID + passphrase`. That is a good fit for a static GitHub Pages app, but it is not the same as a full backend-enforced access control system.

If you want stronger room security later, the next step is a small backend or Cloud Functions layer.

## Deploy to GitHub Pages

1. Push these files to a GitHub repository.
2. In GitHub, open `Settings > Secrets and variables > Actions` and add:
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`
3. In GitHub, open `Settings > Pages`.
4. Set the source to `GitHub Actions`.
5. Push to `main` or run the `Deploy GitHub Pages` workflow manually.
6. Wait for GitHub Pages to publish the site.
7. Open the published URL and test:
   - create a room
   - copy the invite link
   - open a second browser or private window
   - join with the same room ID and passphrase

## Notes

- Firebase web config values are intended for client-side apps, but storing them in GitHub Actions secrets keeps them out of the source repository and avoids GitHub secret-scanning alerts.
- The passphrase should be shared separately from the room link.
- The room host is the person who creates the room. The host controls reveal and vote reset.

## Optional Firebase Hosting

If you later decide you would rather host the app on Firebase instead of GitHub Pages, Firebase Hosting officially supports static assets and the `firebase init hosting` flow.
