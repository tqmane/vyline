plugins {
    kotlin("multiplatform") version "2.4.10"
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.10"
    kotlin("plugin.serialization") version "2.4.10"
    id("org.jetbrains.compose") version "1.12.0"
}

// Keep compiler output inside the repository's existing generated-file boundary.
layout.buildDirectory.set(layout.projectDirectory.dir("dist/gradle"))

kotlin {
    @OptIn(org.jetbrains.kotlin.gradle.ExperimentalWasmDsl::class)
    wasmJs {
        browser()
        binaries.executable()
    }
    sourceSets {
        commonMain.dependencies {
            implementation("org.jetbrains.compose.foundation:foundation:1.12.0")
            implementation("org.jetbrains.compose.ui:ui:1.12.0")
            implementation("org.jetbrains.compose.components:components-resources:1.12.0")
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
            implementation("io.github.kyant0:backdrop:2.0.1")
            implementation("io.github.kyant0:shapes:1.2.1")
            implementation("io.github.compose-fluent:fluent:v0.1.0")
            implementation("top.yukonga.miuix.kmp:miuix-ui:0.9.3")
            implementation("top.yukonga.miuix.kmp:miuix-blur:0.9.3")
        }
    }
}

compose.resources { packageOfResClass = "vyline.ui.resources" }
