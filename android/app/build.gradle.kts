plugins {
    id("com.android.application")
}

// 버전 번호: GitHub Actions 실행 번호를 사용 (업데이트 설치가 되도록 매번 증가)
val buildNo = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "io.github.subinha693.russianstudy"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.github.subinha693.russianstudy"
        minSdk = 24
        targetSdk = 34
        versionCode = buildNo
        versionName = "1.0.$buildNo"
    }

    signingConfigs {
        create("release") {
            // 서명 키는 GitHub 저장소 Secrets에서 받아옴 (워크플로가 파일로 풀어 줌)
            storeFile = file(System.getenv("KEYSTORE_PATH") ?: "release.jks")
            storePassword = System.getenv("KEYSTORE_PASSWORD")
            keyAlias = System.getenv("KEY_ALIAS") ?: "russian"
            keyPassword = System.getenv("KEYSTORE_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (System.getenv("KEYSTORE_PATH") != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
}
