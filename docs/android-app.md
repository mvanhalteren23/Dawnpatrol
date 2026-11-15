# Head Above CRM – Android app

The Android app opens the live CRM (`https://headabovedigital.com/crm/today`) full screen, using
Chrome underneath (a "Trusted Web Activity"). Everything in the CRM works in it, because it *is*
the CRM:

- **Today**: what needs you now (lines with problems, new leads, follow-ups due, campaign replies,
  clients to nudge), each with Call · Text · Done · Tomorrow · Open
- Dashboard, Accounts, Pipeline, **Client health**
- On an account: **create an AI receptionist**, **buy or attach a phone number**, forwarding steps
- **Dialer** and **auto-dial**, talking through the app or **"Call my phone first"**
- **Notifications**, **Share → Head Above**, **fingerprint sign-in** (below)
- Campaigns, Launch check and everything else under *More*

Designed for the **Pixel 10 Pro** (6.3", 410×914 CSS px, Android 16): on phones the CRM has a
bottom tab bar (Today · Accounts · Health · Dialer · More) within thumb reach, clear of the gesture
bar. Tablets and computers keep the sidebar.

New CRM features show up in the app the moment they're deployed: no app update needed (except
changes to the app shell itself, like the share menu or notification icon: rebuild once).
Links to `headabovedigital.com/crm/...` (alert emails, texts) open in the app.

## Set up on your phone (2 minutes, after installing)

Settings → **Phone & app** (the Today screen links there until it's done):

1. **Your mobile**: used by "Call my phone first", by Grace to recognise you, and for text alerts.
2. **Turn on notifications for this device**, then **Send a test**. Pick what you want (line
   problems, new leads, email replies, billing) and quiet hours (default 9pm–7am; line outages
   still come through unless you untick that).
3. **Add a passkey on this device**: next time tap **Sign in with fingerprint** (no password or
   authenticator code: the passkey counts as both).

## What sends a notification

| Kind | When |
| --- | --- |
| Line problems (urgent) | Daily line check finds a problem, a client's calls go to voicemail, a line is paused, voice credits or the phone balance run low, Twilio spending alert |
| New leads | Website demo request; Grace (or a demo agent) books a meeting into the CRM |
| Email replies | Someone replies to a cold email campaign |
| Billing | A client's card is declined; a client reaches 75% of their minutes |

Lead, reply and billing notifications go to the account's rep and to administrators; line problems
to administrators. Tapping one opens the account (or Client health). Notifications are free (no
SMS cost); the existing texts and emails still go out as before.

## Call my phone first

Dialer → *Talk through* → **Call my phone first**. On the first call Twilio rings your mobile:
answer, **press 1**, then switch back to the app (the call stays connected). Every prospect is then
dialled through that one call, auto-dial included; they see the business number, calls are
recorded and voicemail drop works as before. Mute and keypad are on your phone. Between calls your
phone waits in silence; after 15 idle minutes it hangs up. Leaving the dialer page or
**Hang up my phone** ends it. Cost: your own leg is billed by Twilio while connected (about
1.5¢/min in Canada), on top of the prospect's leg. The live demo builder needs the in-app audio.

## Share → Head Above

In Google Maps open a business → **Share → Head Above** (or in Chrome: ⋮ → Share → Head Above).
The name, address, city, phone and website are filled in; tap **Add to Head Above**. It's checked
for duplicates, researched automatically, and (ticked by default) gets its demo receptionist built.

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
