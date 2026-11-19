plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services")
}

// Đăng nhập Facebook trên Android bắt buộc dùng Facebook SDK (điều khoản của Facebook - Firebase chặn
// luồng OAuth chung cho Facebook). App ID + Client Token đọc từ backend/.env (dùng chung với Backend),
// hoặc truyền khi build: -PFACEBOOK_APP_ID=... -PFACEBOOK_CLIENT_TOKEN=...
// Chỉ 2 giá trị công khai này được đưa vào APK - FACEBOOK_APP_SECRET không bao giờ nằm trong app.
val facebookKeys = setOf("FACEBOOK_APP_ID", "FACEBOOK_CLIENT_TOKEN")
val backendEnvFile = rootProject.file("../../backend/.env")
val backendFacebookEnv: Map<String, String> =
    if (backendEnvFile.isFile) {
        backendEnvFile.readLines(Charsets.UTF_8)
            .map { it.trim() }
            .filter { line -> facebookKeys.any { line.startsWith("$it=") } }
            .associate { it.substringBefore("=") to it.substringAfter("=").trim().trim('"', '\'') }
    } else {
        emptyMap()
    }
fun facebookConfig(key: String): String =
    ((findProperty(key) as String?) ?: backendFacebookEnv[key] ?: "").trim()
val facebookAppId = facebookConfig("FACEBOOK_APP_ID").ifEmpty { "0" }
val facebookClientToken = facebookConfig("FACEBOOK_CLIENT_TOKEN")

android {
    namespace = "com.example.airhcm_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.example.airhcm_mobile"
        minSdk = flutter.minSdkVersion // Đã nâng lên 21 để hỗ trợ Google Maps & Notifications
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        // Cấu hình Facebook SDK (AndroidManifest.xml đọc qua @string/...)
        resValue("string", "facebook_app_id", facebookAppId)
        resValue("string", "fb_login_protocol_scheme", "fb$facebookAppId")
        resValue("string", "facebook_client_token", facebookClientToken)
    }

    buildFeatures {
        resValues = true
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

// Kotlin 2.2+: kotlinOptions đã bị loại bỏ, dùng compilerOptions
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")
}

configurations.all {
    resolutionStrategy {
        force("androidx.core:core:1.15.0")
        force("androidx.core:core-ktx:1.15.0")
    }
}
