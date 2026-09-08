import java.security.MessageDigest

plugins {
    kotlin("multiplatform")
    id("org.jetbrains.kotlin.plugin.compose")
}

group = "org.jetbrains.compose.ui"
version = "1.12.0-vyline.1"
layout.buildDirectory.set(rootProject.layout.buildDirectory.dir("patched-ui"))

// Rebuild only the pinned Web UI module. All upstream source/licensing comes
// from its published sources artifact; do not patch caches or compiled Wasm.
val sourceArchive by configurations.creating { isTransitive = false }
dependencies { sourceArchive("org.jetbrains.compose.ui:ui-wasm-js:1.12.0:sources@jar") }
val upstream = layout.buildDirectory.dir("upstream")
val prepareUiSources = tasks.register("prepareUiSources") {
    inputs.files(sourceArchive)
    outputs.dir(upstream)
    doLast {
        val archive = sourceArchive.singleFile
        val hash = MessageDigest.getInstance("SHA-256").digest(archive.readBytes()).joinToString("") { "%02x".format(it) }
        check(hash == "f9af10184b4ded72d9c0ab6ecba74308681fc57c019c2f83b88d0874549719ea") { "Unexpected Compose UI source artifact" }
        copy { from(zipTree(archive)); into(upstream) }
        val listener = upstream.get().file("webMain/androidx/compose/ui/platform/accessibility/ComposeWebSemanticsListener.kt").asFile
        var source = listener.readText()
        fun replace(old: String, new: String) {
            check(source.contains(old)) { "Compose owner patch no longer matches: $old" }
            source = source.replace(old, new)
        }
        replace("private var semanticsOwner: SemanticsOwner? = null",
            """private val semanticsOwners = mutableListOf<SemanticsOwner>()
    private fun hasControls(node: SemanticsNode): Boolean = node.layoutNode.isAttached &&
        (node.config.contains(SemanticsActions.OnClick) || node.config.contains(SemanticsProperties.EditableText) || node.replacedChildren.any(::hasControls))
    private val semanticsOwner get() = semanticsOwners.lastOrNull { hasControls(it.rootSemanticsNode) } ?: semanticsOwners.firstOrNull()""")
        replace("this.semanticsOwner = semanticsOwner", "semanticsOwners.add(semanticsOwner)\n        invalidationChannel.trySend(Unit)")
        replace("this.semanticsOwner = null", "semanticsOwners.remove(semanticsOwner)\n        invalidationChannel.trySend(Unit)")
        replace("val root = semanticsOwner?.rootSemanticsNode ?: return", "val root = semanticsOwner?.rootSemanticsNode")
        replace("if (root.isValid())", "if (root != null && root.isValid())")
        // Explicit Tab/Switch/Radio roles must not be overwritten by OnClick.
        replace("if (this.contains(SemanticsActions.OnClick)) {", "if (roleId == -1 && this.contains(SemanticsActions.OnClick)) {")
        replace("val listener = config[SemanticsActions.OnClick].action!!", "val nodeId = sn.id")
        replace("listener.invoke()", "val current = nodes[nodeId]?.config\n                if (current != null && current.contains(SemanticsActions.OnClick) && !current.contains(SemanticsProperties.Disabled)) current[SemanticsActions.OnClick].action?.invoke()")
        replace("setA11YAriaRole(element = htmlNode, config.getRoleId())", """
            setA11YAriaRole(element = htmlNode, config.getRoleId())
            if (config.contains(SemanticsProperties.Selected)) htmlNode.setAttribute("aria-selected", config[SemanticsProperties.Selected].toString())
            else htmlNode.removeAttribute("aria-selected")
            if (config.contains(SemanticsProperties.Disabled)) htmlNode.setAttribute("aria-disabled", "true")
            else htmlNode.removeAttribute("aria-disabled")
            if (config.contains(SemanticsProperties.ToggleableState)) htmlNode.setAttribute("aria-checked", when (config[SemanticsProperties.ToggleableState].toString()) { "On" -> "true"; "Off" -> "false"; else -> "mixed" })
            else if (config.getRoleId() == AriaRoleId.RadioButton && config.contains(SemanticsProperties.Selected)) htmlNode.setAttribute("aria-checked", config[SemanticsProperties.Selected].toString())
            else htmlNode.removeAttribute("aria-checked")
        """.trimIndent())
        listener.writeText(source)
        // Kotlin 2.4 checks the type exposed by this existing @PublishedApi
        // inline function. Publish the lock type too; synchronization is unchanged.
        listOf("commonMain", "skikoMain").forEach { sourceSet ->
            fileTree(upstream.get().dir(sourceSet)).matching { include("**/Synchronization.*.kt") }.forEach { file ->
                val text = file.readText()
                if (text.contains("internal expect class SynchronizedObject"))
                    file.writeText(text.replace("internal expect class SynchronizedObject", "@PublishedApi\ninternal expect class SynchronizedObject"))
                if (text.contains("internal actual class SynchronizedObject"))
                    file.writeText(text.replace("internal actual class SynchronizedObject", "@PublishedApi\ninternal actual class SynchronizedObject"))
            }
        }
    }
}

kotlin {
    @OptIn(org.jetbrains.kotlin.gradle.ExperimentalWasmDsl::class)
    wasmJs {
        browser()
        compilerOptions {
            moduleName.set("compose-multiplatform-core-compose-ui-ui")
            freeCompilerArgs.addAll("-Xir-module-name=org.jetbrains.compose.ui:ui",
                "-XXLanguage:+AllowAnyAsAnActualTypeForExpectInterface", "-XXLanguage:+JsAllowImplementingFunctionInterface")
        }
    }
    sourceSets {
        val commonMain by getting {
            kotlin.srcDir(upstream.map { it.dir("commonMain") })
            dependencies {
                api("androidx.annotation:annotation:1.9.1")
                api("androidx.compose.runtime:runtime-retain:1.12.0")
                api("androidx.savedstate:savedstate-compose:1.4.0")
                api("org.jetbrains.androidx.lifecycle:lifecycle-runtime-compose:2.9.6")
                api("org.jetbrains.compose.runtime:runtime-saveable:1.12.0")
                api("org.jetbrains.compose.ui:ui-geometry:1.12.0")
                api("org.jetbrains.compose.ui:ui-graphics:1.12.0")
                api("org.jetbrains.compose.ui:ui-text:1.12.0")
                api("org.jetbrains.compose.ui:ui-unit:1.12.0")
                api("org.jetbrains.compose.ui:ui-util:1.12.0")
                api("org.jetbrains.kotlinx:atomicfu:0.28.0")
                api("org.jetbrains.kotlinx:kotlinx-browser:0.5.0")
                api("org.jetbrains.skiko:skiko:0.150.1")
                implementation("androidx.collection:collection:1.5.0")
                implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
                implementation("androidx.lifecycle:lifecycle-viewmodel-savedstate:2.11.0")
                implementation("org.jetbrains.androidx.lifecycle:lifecycle-viewmodel:2.9.6")
                implementation("org.jetbrains.androidx.lifecycle:lifecycle-viewmodel-savedstate:2.9.6")
                implementation("org.jetbrains.androidx.navigationevent:navigationevent-compose:1.1.0")
                implementation("org.jetbrains.compose.annotation-internal:annotation:1.10.0")
                implementation("org.jetbrains.compose.collection-internal:collection:1.10.0")
                implementation("org.jetbrains.compose.runtime:runtime:1.12.0")
                implementation("org.jetbrains.compose.ui:ui-backhandler:1.12.0")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
            }
        }
        val skikoMain by creating { dependsOn(commonMain); kotlin.srcDir(upstream.map { it.dir("skikoMain") }) }
        val nonJvmMain by creating { dependsOn(skikoMain); kotlin.srcDir(upstream.map { it.dir("nonJvmMain") }) }
        val webMain by creating { dependsOn(nonJvmMain); kotlin.srcDir(upstream.map { it.dir("webMain") }) }
        val wasmJsMain by getting {
            dependsOn(webMain)
            kotlin.srcDir(upstream.map { it.dir("wasmJsMain") })
            dependencies {
                implementation("org.jetbrains.skiko:skiko-wasm-js:0.150.1")
                implementation("org.jetbrains.skiko:skiko-js-wasm-runtime:0.150.1")
            }
        }
        all {
            listOf("androidx.compose.runtime.InternalComposeApi", "androidx.compose.ui.InternalComposeUiApi",
                "androidx.compose.ui.ExperimentalComposeUiApi", "androidx.compose.ui.text.InternalTextApi",
                "kotlin.contracts.ExperimentalContracts", "kotlin.time.ExperimentalTime", "kotlin.js.ExperimentalWasmJsInterop",
                "kotlinx.coroutines.ExperimentalCoroutinesApi", "kotlinx.coroutines.InternalCoroutinesApi").forEach(languageSettings::optIn)
        }
    }
}
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompilationTask<*>>().configureEach { dependsOn(prepareUiSources) }
