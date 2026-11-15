# Head Above CRM – Android app

The Android app opens the live CRM (`https://headabovedigital.com/crm`) full screen, using Chrome
underneath (a "Trusted Web Activity"). Everything in the CRM works in it, because it *is* the CRM:

- Dashboard, Accounts, Pipeline, **Client health**
- On an account: **create an AI receptionist**, **buy or attach a phone number**, forwarding steps
- **Dialer** and **auto-dial** (the microphone prompt appears the first time you call)
- Campaigns, Launch check and everything else in the menu

Designed for the **Pixel 10 Pro** (6.3", 410×914 CSS px, Android 16): on phones the CRM has a
bottom tab bar (Home · Accounts · Health · Dialer · More) within thumb reach, clear of the gesture
bar; *More* opens every other page. Tablets and computers keep the sidebar.

New CRM features show up in the app the moment they're deployed: no app update needed.
Links to `headabovedigital.com/crm/...` (alert emails, texts) open in the app.

## One-time setup (about 10 minutes)

1. **Password for the signing key.** GitHub → repo → Settings → Secrets and variables → Actions →
   New repository secret: `ANDROID_KEYSTORE_PASSWORD` = a long random password (save it in your
   password manager too).
2. **Create the key.** GitHub → Actions → "Android app" → Run workflow → tick
   *Create a new signing key* → Run. When it finishes, download the artifact
   `android-signing-key-DOWNLOAD-AND-DELETE` (it is deleted after 1 day). It contains:
   - `headabove-release.jks`: the key. Keep it safe (password manager / offline). If it's lost,
     the app can't be updated and has to be reinstalled.
   - `ANDROID_KEYSTORE_BASE64.txt`: add it as the repository secret `ANDROID_KEYSTORE_BASE64`.
   - `ANDROID_CERT_SHA256.txt`: add it in **Vercel** → project → Settings → Environment
     Variables as `ANDROID_CERT_SHA256` (Production), then redeploy.
   Then delete the downloaded files from your Downloads folder.
3. **Build the app.** Actions → "Android app" → Run workflow (leave the box unticked). Download the
   artifact `head-above-android-N`: `app-release.apk` (install directly) and `app-release.aab`
   (for Google Play).
4. **Check the link.** Open `https://headabovedigital.com/.well-known/assetlinks.json`: it should
   show `com.headabovedigital.crm` and your fingerprint. Without it the app still works but shows
   a thin address bar at the top.

## Installing on a phone

- Copy `app-release.apk` to the phone (Google Drive, email, USB) and open it. Android asks to allow
  installs from that app (Drive/Files) once. Chrome must be installed (it is on almost every phone).
- Sign in with your CRM login. Staff only: client logins go to the portal as usual.

## Google Play (optional, for the team)

Upload `app-release.aab` to a Play Console app (one-time US$25 developer fee) under
*Internal testing* to share with staff by email. Play re-signs the app with its own key: copy
Play Console → Test and release → App integrity → **App signing key certificate SHA-256** and add
it to `ANDROID_CERT_SHA256` in Vercel after a comma, so both fingerprints are trusted.

## Building on a computer

`cd android && ./gradlew assembleRelease` (needs JDK 17+ and the Android SDK; without the
signing env vars it signs with the debug key). Site and package name are in
`android/app/build.gradle.kts` and `android/gradle.properties` (`twaHost`).
