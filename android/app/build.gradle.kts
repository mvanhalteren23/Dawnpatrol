// Head Above CRM for Android: a Trusted Web Activity. The app opens the live CRM full screen in
// Chrome (no address bar once the site vouches for the app in /.well-known/assetlinks.json), so
// every CRM feature, including the browser dialer and its microphone, works exactly as on the web.

plugins {
    id("com.android.application")
}

val host: String = (findProperty("twaHost") as String?) ?: "headabovedigital.com"
val launchUrl = "https://$host/crm"

android {
    namespace = "com.headabovedigital.crm"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.headabovedigital.crm"
        minSdk = 24
        targetSdk = 36
        // CI passes -PversionCode=<run number> so every build installs over the last one.
        versionCode = ((findProperty("versionCode") as String?) ?: "1").toInt()
        versionName = (findProperty("versionName") as String?) ?: "1.0.$versionCode"

        resValue("string", "appName", "Head Above CRM")
        resValue("string", "launcherName", "Head Above")
        resValue("string", "launchUrl", launchUrl)
        resValue("string", "hostName", host)
        resValue(
            "string",
            "assetStatements",
            "[{\\\"relation\\\": [\\\"delegate_permission/common.handle_all_urls\\\"], \\\"target\\\": {\\\"namespace\\\": \\\"web\\\", \\\"site\\\": \\\"https://$host\\\"}}]",
        )
        manifestPlaceholders["hostName"] = host
    }

    // Release signing comes from environment variables (set by the GitHub workflow from secrets).
    val keystore = System.getenv("ANDROID_KEYSTORE_FILE")
    signingConfigs {
        if (!keystore.isNullOrBlank()) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "headabove"
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (!keystore.isNullOrBlank()) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
}
