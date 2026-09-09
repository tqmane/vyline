@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.browser.document
import org.w3c.dom.HTMLImageElement

/** Keep the existing bitmap caches; retain browser media for animation/failed canvas decoding. */
@Composable
internal fun ControllerImage(url: String, label: String, modifier: Modifier, contentScale: ContentScale = ContentScale.Fit) {
    val animated = url.contains("sticker_animation") || Regex("\\.(gif|apng)([?#]|$)", RegexOption.IGNORE_CASE).containsMatchIn(url)
    val loaded = rememberRemoteImage(if (animated) null else url, 600)
    if (loaded.bitmap != null) Image(loaded.bitmap, label.takeIf { it.isNotBlank() }, modifier, contentScale = contentScale)
    else if (animated || loaded.failed) key(url) {
        val safe = controllerImageUrl(url)
        if (safe.isNotEmpty()) ClippedHtmlElementView(factory = {
            (document.createElement("img") as HTMLImageElement).apply {
                src = safe; alt = label; style.width = "100%"; style.height = "100%"; style.setProperty("object-fit", if (contentScale == ContentScale.Crop) "cover" else "contain")
                setAttribute("referrerpolicy", "no-referrer")
            }
        }, modifier = modifier, interactive = false)
        else Label("画像を読み込めません", 12)
    } else Box(modifier)
}

// Read-only image URLs retain the previous rich-content renderer's web-image behavior.
// This does not broaden safeMediaUrl for executable/interactive media or navigation.
private fun controllerImageUrl(url: String): String = js("""(() => {
    try {
        const target = new URL(url, window.location.href);
        if (['http:', 'https:'].includes(target.protocol) && !target.username && !target.password) return target.href;
        if (target.protocol === 'blob:' && target.origin === location.origin) return target.href;
        if (/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(url) && url.length < 12000000) return url;
    } catch (_) {}
    return '';
})()""")
