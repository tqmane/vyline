@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.browser.document
import org.w3c.dom.HTMLElement

/** Media transport/recording stays in the host. Only the visible media element lives here. */
@Composable
internal fun ControllerStream(item: NativePanelItem) {
    val element = remember { arrayOfNulls<HTMLElement>(1) }
    ClippedHtmlElementView(factory = {
        (document.createElement(if (item.value == "canvas") "canvas" else "video") as HTMLElement).apply {
            style.width = "100%"; style.height = "100%"; style.setProperty("object-fit", "contain")
            setAttribute("aria-label", item.label); element[0] = this
        }
    }, modifier = Modifier.fillMaxWidth().height(240.dp), interactive = false,
        onRelease = { releaseControllerStream(it); element[0] = null })
    SideEffect { element[0]?.let { bindControllerStream(it, item.mediaId ?: "") } }
}

private fun bindControllerStream(target: HTMLElement, id: String): Unit = js("""{
    if (target.__vylineSourceId === id) { target.__vylineSync?.(); return; }
    target.__vylineRelease?.();
    target.__vylineSourceId = id;
    let frame = 0;
    const source = () => window.parent.__vylineControllerMedia?.(id);
    const sync = () => {
        const original = source();
        if (target.tagName === 'VIDEO') {
            const stream = original?.srcObject ?? null;
            if (target.srcObject !== stream) target.srcObject = stream;
            target.muted = true; target.autoplay = true; target.playsInline = true;
            if (stream && target.paused) target.play().catch(() => {});
        }
    };
    if (target.tagName === 'CANVAS') {
        const context = target.getContext('2d');
        const draw = () => {
            const original = source();
            if (original?.width && original?.height) {
                if (target.width !== original.width) target.width = original.width;
                if (target.height !== original.height) target.height = original.height;
                context.drawImage(original, 0, 0);
            } else context.clearRect(0, 0, target.width, target.height);
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
    }
    target.__vylineSync = sync;
    target.__vylineRelease = () => {
        cancelAnimationFrame(frame);
        if (target.tagName === 'VIDEO') { target.pause(); target.srcObject = null; }
        delete target.__vylineSourceId; delete target.__vylineSync; delete target.__vylineRelease;
    };
    sync();
}""")
private fun releaseControllerStream(target: HTMLElement): Unit = js("{ target.__vylineRelease?.(); }")
