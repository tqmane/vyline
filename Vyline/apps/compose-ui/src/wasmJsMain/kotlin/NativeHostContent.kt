@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.browser.document
import kotlinx.serialization.Serializable
import org.w3c.dom.HTMLElement

@Serializable
private data class HostContentEvent(
    val channel: String = "vyline-ui",
    val version: Int = 1,
    val type: String,
    val id: String,
    val epoch: Int,
    val chatId: String,
)

@Composable
internal fun NativeHostContent(messageId: String, epoch: Int, chatId: String, measuredHeight: Double?) {
    val height = measuredHeight?.takeIf { it.isFinite() }?.coerceIn(1.0, 100_000.0) ?: 200.0
    key(epoch, chatId, messageId) {
        ClippedHtmlElementView(factory = {
            (document.createElement("div") as HTMLElement).apply {
                style.width = "100%"
                style.height = "100%"
                registerContentSlot(messageId, this)
                postToHost(bridgeJson.encodeToString(HostContentEvent(type = "content-slot", id = messageId, epoch = epoch, chatId = chatId)))
            }
        }, modifier = Modifier.widthIn(max = 360.dp).fillMaxWidth().height(height.dp), onRelease = { element ->
            if (removeContentSlot(messageId, element)) {
                postToHost(bridgeJson.encodeToString(HostContentEvent(type = "content-slot-removed", id = messageId, epoch = epoch, chatId = chatId)))
            }
        })
    }
}

private fun registerContentSlot(id: String, element: HTMLElement): Unit = js("{ (window.__vylineMessageSlots ??= new Map()).set(id, element); }")
private fun removeContentSlot(id: String, element: HTMLElement): Boolean = js("window.__vylineMessageSlots?.get(id) === element ? window.__vylineMessageSlots.delete(id) : false")
