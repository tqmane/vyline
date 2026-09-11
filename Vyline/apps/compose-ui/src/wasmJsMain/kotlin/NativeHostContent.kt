@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
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
internal fun NativeHostContent(messageId: String, epoch: Int, chatId: String, measuredHeight: Double?, model: NativePanel?, state: SidebarSnapshot, richContent: Boolean = false) {
    val height = measuredHeight?.takeIf { it.isFinite() }?.coerceIn(1.0, 100_000.0) ?: 200.0
    key(epoch, chatId, messageId, richContent) {
        Box(Modifier.widthIn(max = 360.dp).fillMaxWidth()) {
        if (!richContent) {
        if (model == null) Box(Modifier.fillMaxWidth().height(height.dp)) { Label("読み込み中…", 12, color = LocalSecondaryInk.current) }
        else Column(Modifier.fillMaxWidth().padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            model.items.forEach { item -> key(item.id) { NativePanelControl(state, item) } }
        }
        }
        // Keep LINE card geometry and actions in the existing renderer. Other controllers
        // still project to native controls. Both paths retain timeline clipping/scrolling.
        ClippedHtmlElementView(factory = {
            (document.createElement("div") as HTMLElement).apply {
                hidden = !richContent
                if (!richContent) setAttribute("aria-hidden", "true")
                style.width = "100%"
                style.height = "100%"
                registerContentSlot(messageId, this)
                postToHost(bridgeJson.encodeToString(HostContentEvent(type = "content-slot", id = messageId, epoch = epoch, chatId = chatId)))
            }
        }, modifier = if (richContent) Modifier.fillMaxWidth().height(height.dp) else Modifier.size(1.dp), interactive = richContent, onRelease = { element ->
            if (removeContentSlot(messageId, element)) {
                postToHost(bridgeJson.encodeToString(HostContentEvent(type = "content-slot-removed", id = messageId, epoch = epoch, chatId = chatId)))
            }
        })
        }
    }
}

private fun registerContentSlot(id: String, element: HTMLElement): Unit = js("{ (window.__vylineMessageSlots ??= new Map()).set(id, element); }")
private fun removeContentSlot(id: String, element: HTMLElement): Boolean = js("window.__vylineMessageSlots?.get(id) === element ? window.__vylineMessageSlots.delete(id) : false")
