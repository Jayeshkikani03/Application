# eSource mobile (Codemagic)

This folder is the **only** code you upload to the private GitHub repo for Android / iOS builds.

Do **not** upload `ApplicationAPI`, WEB, SQL, DOC, or Python scripts.

## Upload only this folder

`E:\shared\Application\eSource\Application`

Do **not** upload the parent `eSource` folder (`DOC`, `.rar`, Python scripts).

### Keep (needed for Codemagic)

| Path | Purpose |
|---|---|
| `src/` | React app |
| `public/` | Static files + `app.config.json` (production API) |
| `android/` | Capacitor Android project |
| `assets/` | App icons |
| `package.json` / `package-lock.json` | npm install on CI |
| `index.html`, `vite.config.js`, `jsconfig.json` | Vite build |
| `capacitor.config.json` | App id `com.esource.lab` |
| `codemagic.yaml` | Android + iOS workflows |
| `.gitignore` | Stops extras getting committed |
| `README.md` | These steps |
| `build-android.ps1` | Optional local Windows APK |

`ios/` is created on Codemagic Mac (`npx cap add ios`) the first time.

### Do not upload (already removed or ignored)

- `node_modules/` — Codemagic runs `npm ci`
- `dist/` — Codemagic runs `npm run build`
- `DOC`, Python, `.rar` — not this app
- Keystores, `.p12`, certificates

## 1. Set the API URL

Edit `public/app.config.json` for store builds, or set Codemagic env `API_PATH_BASE`:

```json
{
  "apiPathBase": "https://sspldev-esource.sspluniverse.com/API",
  "isNative": true
}
```

This is already set in `public/app.config.json` for Codemagic store builds. Local IIS web still uses `http://localhost/eSourceApplicationAPI` in the Git_1.0.0 Application folder — do not mix the two.

## 2. Create private GitHub repo

Repo root must be **this folder** (`Application`), so `package.json` and `codemagic.yaml` sit at the root.

```powershell
cd E:\shared\Application\eSource\Application
git init
git add .
git status
git commit -m "eSource Capacitor app for Codemagic"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/esource-lab-mobile.git
git push -u origin main
```

Do not commit `node_modules`, `dist`, `.jks`, or certificates.

## 3. Connect Codemagic

1. Open https://codemagic.io and sign in with GitHub.
2. **Add application** → select the private repo.
3. Workflows come from `codemagic.yaml`:
   - `android-release`
   - `ios-release`

## 4. Android signing

1. Create a keystore (once). Keep it off Git.
2. Codemagic → Teams / app → **Code signing identities** → Android keystore.
3. Env group `keystore_credentials` (or wire `android_signing` in yaml).
4. Set `API_PATH_BASE` in the workflow environment.
5. Run **eSource Android**. Artifact: `.aab` (Play) / `.apk`.

## 5. iOS signing

Needs Apple Developer + Mac workflow (Codemagic provides the Mac).

1. App ID / bundle id: `com.esource.lab`
2. Codemagic → integrations → **App Store Connect API key**
3. Upload iOS distribution cert + App Store profile, or use automatic signing
4. Set `API_PATH_BASE`
5. Run **eSource iOS**. Artifact: `.ipa` (TestFlight)

First iOS build runs `npx cap add ios` then `cap sync` + `pod install`. After that you can commit `ios/` from a Mac if you want it in Git.

## 6. Local Windows (Android only)

```powershell
cd E:\shared\Application\eSource\Application
npm ci
npm run build:android
```

IPA cannot be built on Windows.

## Do not put in this Git repo

- `ApplicationAPI`, `WEB`, `.Docs`
- `appsettings.json` / DB connection strings
- Keystores, `.p12`, provisioning profiles
- `node_modules/`, `dist/`
