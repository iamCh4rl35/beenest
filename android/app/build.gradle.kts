import java.util.Properties

plugins {
    id("com.android.application")
}

// Klucz podpisu wersji wydawanej: android/keystore.properties (poza gitem), plik .jks poza repozytorium.
// Bez tego pliku wersja release się nie podpisze (debug – kluczem testowym Androida).
val keystore = Properties().apply {
    rootProject.file("keystore.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}

// Tryb demonstracyjny: strona z ula (main.html + static/) zapisana w zasobach aplikacji – android/make_demo.py
val makeDemo = tasks.register<Exec>("makeDemo") {
    workingDir = rootProject.projectDir.parentFile
    commandLine("python3", "android/make_demo.py")
}
tasks.named("preBuild") { dependsOn(makeDemo) }

android {
    namespace = "pl.beenest.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "pl.beenest.app"
        minSdk = 29          // Android 10: łączenie z Wi-Fi ula (WifiNetworkSpecifier)
        targetSdk = 36
        versionCode = 3
        versionName = "a.0.2"
    }

    signingConfigs {
        if (keystore.isNotEmpty()) {
            create("release") {
                storeFile = file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
}
