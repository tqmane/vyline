@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.browser.document
import org.w3c.dom.HTMLElement

@Composable
internal fun ControllerMediaPortal(id: String) {
    key(id) {
        ClippedHtmlElementView(factory = {
            (document.createElement("div") as HTMLElement).apply {
                style.width = "100%"; style.height = "100%"
                registerMediaPortal(id, this)
            }
        }, modifier = Modifier.fillMaxWidth().height(440.dp), onRelease = { removeMediaPortal(id, it) })
    }
}
private fun registerMediaPortal(id: String, element: HTMLElement): Unit = js("""{
    (window.__vylineMediaSlots ??= new Map()).set(id, element);
    window.parent.postMessage({ channel: 'vyline-ui', version: 1, type: 'media-slot', id }, location.origin);
}""")
private fun removeMediaPortal(id: String, element: HTMLElement): Unit = js("""{
    if (window.__vylineMediaSlots?.get(id) !== element) return;
    window.__vylineMediaSlots.delete(id);
    window.parent.postMessage({ channel: 'vyline-ui', version: 1, type: 'media-slot-removed', id }, location.origin);
}""")
