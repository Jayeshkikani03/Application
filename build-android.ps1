param(
    # Full = web build + ensure android + cap sync + native patches + APK
    # NativeOnly = ensure android (if missing) + native patches only (no web/gradle)
    # Sync = web build + ensure android + cap sync + native patches (no gradle)
    [ValidateSet("Full", "Sync", "NativeOnly")]
    [string]$Mode = "Full"
)

$ErrorActionPreference = "Stop"

$RootPath = $PSScriptRoot
$AndroidPath = Join-Path $RootPath "android"
$ApkPath = Join-Path $AndroidPath "app\build\outputs\apk\debug\app-debug.apk"

function Resolve-JavaHome {
    $candidates = @(
        "C:\Program Files\Android\Android Studio\jbr",
        "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot",
        "C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot",
        $env:JAVA_HOME
    ) | Where-Object { $_ -and (Test-Path $_) }

    if ($candidates.Count -eq 0) {
        $searchRoots = @(
            "C:\Program Files\Eclipse Adoptium",
            "C:\Program Files\Java",
            "C:\Program Files\Microsoft"
        )
        foreach ($root in $searchRoots) {
            if (-not (Test-Path $root)) { continue }
            $found = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
                Where-Object { Test-Path (Join-Path $_.FullName "bin\java.exe") } |
                Select-Object -First 1
            if ($found) {
                $candidates = @($found.FullName)
                break
            }
        }
    }

    if ($candidates.Count -eq 0) {
        throw @"
JAVA_HOME not found.

Install JDK 17 or 21 (Eclipse Temurin recommended), then either:
  1. Set JAVA_HOME environment variable, or
  2. Install Android Studio (uses jbr), or
  3. Install to: C:\Program Files\Eclipse Adoptium\jdk-21.x.x-hotspot
"@
    }

    if ($candidates -is [array]) {
        return $candidates[0]
    }
    return $candidates
}

function Ensure-CleartextNetworkConfig {
    param([string]$AndroidAppPath)

    $xmlDir = Join-Path $AndroidAppPath "src\main\res\xml"
    $configPath = Join-Path $xmlDir "network_security_config.xml"
    if (-not (Test-Path $xmlDir)) {
        New-Item -ItemType Directory -Path $xmlDir -Force | Out-Null
    }

    $configXml = @"
<?xml version="1.0" encoding="utf-8"?>
<!-- Allow HTTP (cleartext) API calls from the Capacitor WebView in debug/LAN builds. -->
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
"@
    [System.IO.File]::WriteAllText($configPath, $configXml)
    Write-Host "Ensured network_security_config.xml (cleartext HTTP)."
}

function Add-ManifestPermission {
    param(
        [string]$Content,
        [string]$Permission
    )

    if ($Content -match [regex]::Escape($Permission)) {
        return $Content
    }

    $permissionLine = "    <uses-permission android:name=`"$Permission`" />"

    if ($Content -match '<!-- Permissions -->') {
        return $Content -replace '(<!-- Permissions -->)', "`$1`r`n$permissionLine"
    }

    if ($Content -match '<uses-permission\b') {
        return [regex]::Replace($Content, '(<uses-permission\b[^/]*/>)', "$permissionLine`r`n    `$1", 1)
    }

    return $Content -replace '</manifest>', "$permissionLine`r`n</manifest>"
}

function Ensure-AndroidManifestPermissions {
    param([string]$ManifestPath)

    if (-not (Test-Path $ManifestPath)) {
        throw "AndroidManifest.xml not found after Capacitor platform setup: $ManifestPath"
    }

    $content = [System.IO.File]::ReadAllText($ManifestPath)
    if ([string]::IsNullOrWhiteSpace($content) -or $content.Length -lt 50) {
        throw "AndroidManifest.xml is empty or invalid: $ManifestPath"
    }

    $updated = $content

    foreach ($permission in @(
            "android.permission.INTERNET",
            "android.permission.CAMERA",
            "android.permission.VIBRATE",
            # Needed for Directory.Documents / ExternalStorage on Android 10 and older.
            "android.permission.READ_EXTERNAL_STORAGE",
            "android.permission.WRITE_EXTERNAL_STORAGE"
        )) {
        $updated = Add-ManifestPermission -Content $updated -Permission $permission
    }

    # Allow public Downloads/Documents writes on Android 10 (API 29).
    if ($updated -notmatch 'android:requestLegacyExternalStorage=') {
        $updated = $updated -replace '(<application\b[^>]*)(>)', '$1 android:requestLegacyExternalStorage="true"$2'
    }

    if ($updated -notmatch 'android\.hardware\.camera"') {
        $updated = $updated -replace '</manifest>', @"
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
</manifest>
"@
    }

    # Fresh Capacitor manifests omit these; LAN/debug APIs need cleartext HTTP.
    if ($updated -notmatch 'android:usesCleartextTraffic=') {
        $updated = $updated -replace '(<application\b[^>]*)(>)', '$1 android:usesCleartextTraffic="true"$2'
    }
    if ($updated -notmatch 'android:networkSecurityConfig=') {
        $updated = $updated -replace '(<application\b[^>]*)(>)', '$1 android:networkSecurityConfig="@xml/network_security_config"$2'
    }
    if ($updated -notmatch 'android:windowSoftInputMode=') {
        $updated = $updated -replace '(<activity\b[^>]*android:name="\.MainActivity"[^>]*)(>)', '$1 android:windowSoftInputMode="adjustResize"$2'
        if ($updated -notmatch 'android:windowSoftInputMode=') {
            $updated = $updated -replace '(<activity\b[^>]*)(>)', '$1 android:windowSoftInputMode="adjustResize"$2'
        }
    }

    # Keep launcher icon refs explicit (Capacitor default, but assert after fresh add).
    if ($updated -notmatch 'android:icon=') {
        $updated = $updated -replace '(<application\b[^>]*)(>)', '$1 android:icon="@mipmap/ic_launcher"$2'
    }
    if ($updated -notmatch 'android:roundIcon=') {
        $updated = $updated -replace '(<application\b[^>]*)(>)', '$1 android:roundIcon="@mipmap/ic_launcher_round"$2'
    }

    if ($updated -ne $content) {
        [System.IO.File]::WriteAllText($ManifestPath, $updated)
        Write-Host "Updated AndroidManifest.xml (permissions, cleartext, keyboard, icons)."
    }
    else {
        Write-Host "AndroidManifest.xml already has required native settings."
    }
}

function Ensure-AndroidPlatform {
    param([string]$ProjectRoot)

    $gradlePath = Join-Path $ProjectRoot "android\app\build.gradle"
    if (Test-Path $gradlePath) {
        Write-Host "Android platform already present."
        return
    }

    Write-Host "Android platform not found (expected on a fresh clone - android/ is gitignored)."
    Write-Host "Creating Capacitor Android project via: npx cap add android"

    Push-Location -Path $ProjectRoot
    try {
        npx --yes cap add android
        if ($LASTEXITCODE -ne 0) {
            throw "npx cap add android failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Path $gradlePath)) {
        throw "Android platform was not created. Expected: $gradlePath"
    }

    Write-Host "Android platform created successfully."
}

function Ensure-AppIcons {
    param(
        [string]$ProjectRoot,
        [string]$SourceIconRelativePath = "assets\icon.png"
    )

    $sourceIcon = Join-Path $ProjectRoot $SourceIconRelativePath
    if (-not (Test-Path $sourceIcon)) {
        $fallback = Join-Path $ProjectRoot "assets\app-icon.png"
        if (Test-Path $fallback) {
            $sourceIcon = $fallback
        }
        else {
            throw "App icon source not found. Place assets\icon.png (or assets\app-icon.png) before building."
        }
    }

    Add-Type -AssemblyName System.Drawing

    function Resize-Png {
        param([string]$Src, [string]$Dest, [int]$Size)

        $img = [System.Drawing.Image]::FromFile($Src)
        try {
            $bmp = New-Object System.Drawing.Bitmap $Size, $Size
            $bmp.SetResolution(72, 72)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            try {
                $g.Clear([System.Drawing.Color]::Transparent)
                $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $g.DrawImage($img, 0, 0, $Size, $Size)
            }
            finally {
                $g.Dispose()
            }

            $dir = Split-Path $Dest -Parent
            if (-not (Test-Path $dir)) {
                New-Item -ItemType Directory -Path $dir -Force | Out-Null
            }
            $bmp.Save($Dest, [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
        }
        finally {
            $img.Dispose()
        }
    }

    Write-Host "Applying app icon from: $sourceIcon"

    $publicDir = Join-Path $ProjectRoot "public"
    Resize-Png -Src $sourceIcon -Dest (Join-Path $publicDir "icon-192.png") -Size 192
    Resize-Png -Src $sourceIcon -Dest (Join-Path $publicDir "icon-512.png") -Size 512

    $resRoot = Join-Path $ProjectRoot "android\app\src\main\res"
    if (-not (Test-Path $resRoot)) {
        throw "Android res folder not found after Capacitor setup: $resRoot"
    }

    $densities = @(
        @{ Name = "mdpi"; Launcher = 48; Foreground = 108 },
        @{ Name = "hdpi"; Launcher = 72; Foreground = 162 },
        @{ Name = "xhdpi"; Launcher = 96; Foreground = 216 },
        @{ Name = "xxhdpi"; Launcher = 144; Foreground = 324 },
        @{ Name = "xxxhdpi"; Launcher = 192; Foreground = 432 }
    )

    foreach ($density in $densities) {
        $mipmap = Join-Path $resRoot ("mipmap-" + $density.Name)
        Resize-Png -Src $sourceIcon -Dest (Join-Path $mipmap "ic_launcher.png") -Size $density.Launcher
        Resize-Png -Src $sourceIcon -Dest (Join-Path $mipmap "ic_launcher_round.png") -Size $density.Launcher
        Resize-Png -Src $sourceIcon -Dest (Join-Path $mipmap "ic_launcher_foreground.png") -Size $density.Foreground
    }

    # Full branded icon must not use adaptive crop layers (they trim the wordmark).
    $adaptiveDir = Join-Path $resRoot "mipmap-anydpi-v26"
    foreach ($adaptiveName in @("ic_launcher.xml", "ic_launcher_round.xml")) {
        $adaptivePath = Join-Path $adaptiveDir $adaptiveName
        if (Test-Path $adaptivePath) {
            Remove-Item -Path $adaptivePath -Force
        }
    }

    $bgColorPath = Join-Path $resRoot "values\ic_launcher_background.xml"
    $bgColorXml = @"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FFFFFF</color>
</resources>
"@
    [System.IO.File]::WriteAllText($bgColorPath, $bgColorXml)

    foreach ($legacyPath in @(
            (Join-Path $resRoot "drawable\ic_launcher_background.xml"),
            (Join-Path $resRoot "drawable-v24\ic_launcher_foreground.xml")
        )) {
        if (Test-Path $legacyPath) {
            Remove-Item -Path $legacyPath -Force
        }
    }

    Write-Host "App icons updated (Android APK mipmaps + PWA icon-192/icon-512)."
}

function Apply-AndroidNativeCustomizations {
    param([string]$ProjectRoot)

    $androidAppPath = Join-Path $ProjectRoot "android\app"
    $manifestPath = Join-Path $androidAppPath "src\main\AndroidManifest.xml"

    if (-not (Test-Path $androidAppPath)) {
        throw "Android app folder missing. Run Ensure-AndroidPlatform / npx cap add android first."
    }

    Write-Host "`n=== Applying Android native customizations (post Capacitor) ==="
    Ensure-AppIcons -ProjectRoot $ProjectRoot
    Ensure-CleartextNetworkConfig -AndroidAppPath $androidAppPath
    Ensure-AndroidManifestPermissions -ManifestPath $manifestPath
    Write-Host "Native customizations complete."
}

function Invoke-CapacitorSync {
    param([string]$ProjectRoot)

    Write-Host "`n=== Syncing with Capacitor ==="
    Push-Location -Path $ProjectRoot
    try {
        npx --yes cap sync android
        if ($LASTEXITCODE -ne 0) {
            throw "Capacitor sync failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-WebBuild {
    param([string]$ProjectRoot)

    Write-Host "=== Building React/Vite Web App ==="
    Push-Location -Path $ProjectRoot
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "Web build failed."
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-ApkBuild {
    param([string]$AndroidProjectPath, [string]$OutputApkPath)

    $javaHomePath = Resolve-JavaHome
    Write-Host "`n=== Setting JAVA_HOME for Android Build ==="
    Write-Host "Using JAVA_HOME: $javaHomePath"
    $env:JAVA_HOME = $javaHomePath
    $env:Path = "$env:JAVA_HOME\bin;$env:Path"
    java -version

    if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
        $defaultSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
        if (Test-Path $defaultSdk) {
            $env:ANDROID_HOME = $defaultSdk
            $env:ANDROID_SDK_ROOT = $defaultSdk
            Write-Host "Using Android SDK: $defaultSdk"
        }
        else {
            Write-Warning "ANDROID_HOME is not set. Install Android Studio SDK or set ANDROID_HOME before building."
        }
    }

    Write-Host "`n=== Building Android APK ==="
    Push-Location -Path $AndroidProjectPath
    try {
        .\gradlew.bat :app:assembleDebug
        if ($LASTEXITCODE -ne 0) {
            throw "Gradle build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Path $OutputApkPath)) {
        throw "Android build finished but APK was not found: $OutputApkPath"
    }

    $apkSizeMb = [math]::Round((Get-Item $OutputApkPath).Length / 1MB, 2)
    Write-Host "`n=== Build Complete! ==="
    Write-Host "APK file : $OutputApkPath"
    Write-Host "APK size  : $apkSizeMb MB"
    Write-Host "`nInstall on a connected device:"
    Write-Host "  adb install -r `"$OutputApkPath`""
}

# --- Main ------------------------------------------------------------------

Set-Location -Path $RootPath
Write-Host "build-android.ps1 mode: $Mode"

switch ($Mode) {
    "NativeOnly" {
        Ensure-AndroidPlatform -ProjectRoot $RootPath
        Apply-AndroidNativeCustomizations -ProjectRoot $RootPath
    }
    "Sync" {
        Invoke-WebBuild -ProjectRoot $RootPath
        Ensure-AndroidPlatform -ProjectRoot $RootPath
        Invoke-CapacitorSync -ProjectRoot $RootPath
        # Always re-apply AFTER cap sync/add - Capacitor ships default icons + stock manifest.
        Apply-AndroidNativeCustomizations -ProjectRoot $RootPath
    }
    "Full" {
        Invoke-WebBuild -ProjectRoot $RootPath
        Ensure-AndroidPlatform -ProjectRoot $RootPath
        Invoke-CapacitorSync -ProjectRoot $RootPath
        Apply-AndroidNativeCustomizations -ProjectRoot $RootPath
        Invoke-ApkBuild -AndroidProjectPath $AndroidPath -OutputApkPath $ApkPath
    }
}
