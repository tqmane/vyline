@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFontFamilyResolver
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.platform.Font
import androidx.compose.ui.window.ComposeViewport
import vyline.ui.resources.Res

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    listenToHost(::receiveSnapshot)
    if (selfChecksEnabled()) { checkNativeRichText(); checkNativeHostMenu(); checkNativeReaders(); checkMessageDelta(); checkHtmlClipPath() }
    ComposeViewport(viewportContainerId = "composeApp") {
        LaunchedEffect(Unit) { containCanvasGestures() }
        val resolver = LocalFontFamilyResolver.current
        var fontsReady by remember { mutableStateOf(false) }
        LaunchedEffect(resolver) {
            try {
                val bytes = Res.readBytes("files/NotoSansJP.ttf")
                // Register a same-origin CJK fallback, as in the Miuix Web demo. No chat text leaves the app.
                resolver.preload(FontFamily(listOf(400, 600, 700).map { weight ->
                    Font(identity = "VylineNotoSansJP-$weight", getData = { bytes }, weight = FontWeight(weight),
                        variationSettings = FontVariation.Settings(FontVariation.weight(weight)))
                }))
                val emojiBytes = Res.readBytes("files/NotoColorEmoji.ttf")
                resolver.preload(FontFamily(Font(identity = "VylineNotoColorEmoji", getData = { emojiBytes })))
                fontsReady = true
                postToHost("""{"channel":"vyline-ui","version":1,"type":"ready","messageDelta":true,"hostMenu":true,"panes":true}""")
            } catch (_: Exception) {
                postToHost("""{"channel":"vyline-ui","version":1,"type":"error","message":"font-load-failed"}""")
            }
        }
        if (fontsReady) App(snapshot)
        else Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { BasicText("Vyline…") }
    }
}

private fun selfChecksEnabled(): Boolean = js("new URLSearchParams(window.location.search).has('selftest')")

// Compose 1.12 defaults to pan-x pan-y and hands an unconsumed edge drag
// back to the browser. Only the canvas owns pan gestures; pinch zoom and
// sibling HTML audio/video/input controls retain their native behavior.
private fun containCanvasGestures(): Unit = js("""{
    const host = document.querySelector('#composeApp > div > div');
    const canvas = host?.shadowRoot?.querySelector('canvas');
    if (canvas) canvas.style.touchAction = 'pinch-zoom';
}""")
