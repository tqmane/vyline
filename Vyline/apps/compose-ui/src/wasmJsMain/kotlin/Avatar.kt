@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.suspendCancellableCoroutine
import org.jetbrains.skia.Image
import kotlin.coroutines.resume
import kotlin.io.encoding.Base64

private val avatarImages = LinkedHashMap<String, ImageBitmap>()
private val mediaImages = LinkedHashMap<String, ImageBitmap>()
internal data class RemoteImageLoad(val bitmap: ImageBitmap? = null, val failed: Boolean = false)

@Composable
internal fun rememberRemoteImage(url: String?, maximum: Int, retry: Int = 0): RemoteImageLoad {
    val cache = if (maximum <= 160) avatarImages else if (maximum <= 800) mediaImages else null
    val key = "$maximum:$url"
    var image by remember(key, retry) { mutableStateOf(RemoteImageLoad(cache?.get(key))) }
    LaunchedEffect(key, retry) {
        if (url == null || image.bitmap != null) return@LaunchedEffect
        val bytes = browserImageBytes(url, maximum)
        val decoded = bytes?.let { runCatching { Image.makeFromEncoded(it).toComposeImageBitmap() }.getOrNull() }
        if (decoded != null) {
            if (cache != null) {
                if (cache.size >= if (maximum <= 160) 160 else 24) cache.remove(cache.keys.first())
                cache[key] = decoded
            }
            image = RemoteImageLoad(decoded)
        } else image = RemoteImageLoad(failed = true)
    }
    return image
}

@Composable
fun Avatar(row: ConversationRow, size: Int, gradient: Boolean = false) {
    val image = rememberRemoteImage(row.avatarUrl, (size * 2).coerceAtMost(160)).bitmap
    val fallbackColors = listOf(0xFF8196B2, 0xFF9D91B5, 0xFF71A69B, 0xFFB19487, 0xFF789EBE)
    val parsed = row.color.removePrefix("#").takeIf { row.color.startsWith("#") && it.length == 6 }?.toLongOrNull(16)
    val color = parsed?.let { Color(0xFF000000 or it) } ?: Color(fallbackColors[(row.id.hashCode() and Int.MAX_VALUE) % fallbackColors.size])
    Box(Modifier.size(size.dp).clip(CircleShape).background(if (gradient) Brush.verticalGradient(listOf(lerp(Color.White, color, .58f), color)) else SolidColor(color)), contentAlignment = Alignment.Center) {
        image?.let { Image(it, contentDescription = null, modifier = Modifier.size(size.dp), contentScale = ContentScale.Crop) }
            ?: BasicText(row.avatar.ifBlank { row.title.take(1) }, style = TextStyle(fontSize = (size * .34f).sp, color = Color.White, fontWeight = if (size >= 56) FontWeight.SemiBold else FontWeight.Medium))
    }
}

private suspend fun browserImageBytes(url: String, maximum: Int): ByteArray? = suspendCancellableCoroutine { continuation ->
    decodeBrowserImage(url, maximum) { encoded ->
        if (continuation.isActive) continuation.resume(if (encoded.isEmpty()) null else runCatching { Base64.decode(encoded) }.getOrNull())
    }
}

internal fun safeMediaUrl(url: String): String = js("""(() => {
    try {
        const target = new URL(url, window.location.href);
        if ((target.protocol === 'http:' || target.protocol === 'https:' || target.protocol === 'blob:') && target.origin === window.location.origin) return target.href;
        if (/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(url) && url.length < 12000000) return url;
    } catch (_) {}
    return '';
})()""")

// Browser decoding supports SVG and downsamples before bytes cross into Skia. The cache never holds full-size photos.
private fun decodeBrowserImage(url: String, maximum: Int, done: (String) -> Unit): Unit = js("""{
    let target;
    try { target = new URL(url, window.location.href); } catch (_) { done(''); return; }
    const allowed = ['http:', 'https:', 'blob:'].includes(target.protocol) && target.origin === window.location.origin
        || /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(url) && url.length < 12000000;
    if (!allowed) { done(''); return; }
    const image = new Image();
    image.decoding = 'async';
    image.src = target.href;
    image.decode().then(() => {
        if (!image.naturalWidth || !image.naturalHeight) { done(''); return; }
        const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/png').split(',')[1]);
        image.src = '';
    }).catch(() => done(''));
}""")
