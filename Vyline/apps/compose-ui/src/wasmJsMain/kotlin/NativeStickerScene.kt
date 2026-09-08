import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import com.kyant.shapes.RoundedRectangle

/** Native placement gestures feed the existing combination-sticker controller's fields. */
@Composable
internal fun NativeStickerScene(scene: NativePanelItem) {
    val action = rememberScopedAction()
    val extent = scene.sceneSize.coerceAtLeast(1f)
    BoxWithConstraints(Modifier.widthIn(max = 360.dp).fillMaxWidth().aspectRatio(1f)
        .clip(RoundedRectangle(20.dp)).background(LocalSecondaryInk.current.copy(alpha = .10f))
        .border(1.dp, LocalSecondaryInk.current.copy(alpha = .20f), RoundedRectangle(20.dp))
        .semantics { contentDescription = scene.label }) {
        val unit = maxWidth / extent
        val pixelsPerUnit = with(LocalDensity.current) { unit.toPx() }
        scene.layers.forEach { layer -> key(layer.id) {
            var x by remember { mutableFloatStateOf(layer.x) }
            var y by remember { mutableFloatStateOf(layer.y) }
            var size by remember { mutableFloatStateOf(layer.size) }
            var dragging by remember { mutableStateOf(false) }
            var awaitingEcho by remember { mutableStateOf(false) }
            LaunchedEffect(layer.x, layer.y, layer.size, dragging) {
                if (abs(layer.x - x) < 1 && abs(layer.y - y) < 1 && abs(layer.size - size) < 1) awaitingEcho = false
                if (!dragging && !awaitingEcho) { x = layer.x; y = layer.y; size = layer.size }
            }
            val bitmap = rememberRemoteImage(layer.url, 400).bitmap
            Box(Modifier.offset(unit * x, unit * y).size(unit * size)) {
                Box(Modifier.fillMaxSize().pointerInput(layer.id, pixelsPerUnit) {
                    detectDragGestures(onDragStart = { dragging = true }, onDragEnd = { dragging = false }, onDragCancel = { dragging = false; awaitingEcho = false }) { change, delta ->
                        change.consume()
                        x = (x + delta.x / pixelsPerUnit).coerceIn(0f, (extent - size).coerceAtLeast(0f))
                        y = (y + delta.y / pixelsPerUnit).coerceIn(0f, (extent - size).coerceAtLeast(0f))
                        awaitingEcho = true
                        action("panel-change", id = layer.xId, value = x.toString())
                        action("panel-change", id = layer.yId, value = y.toString())
                    }
                }.semantics {
                    contentDescription = "${layer.label}の位置を変更"
                    stateDescription = "横位置 ${x.toInt()}、縦位置 ${y.toInt()}"
                }) {
                    if (bitmap != null) Image(bitmap, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                }
                Box(Modifier.align(Alignment.BottomEnd).size(40.dp).clip(CircleShape).background(LocalAccent.current.copy(alpha = .3f))
                    .pointerInput(layer.id, pixelsPerUnit) {
                        detectDragGestures(onDragStart = { dragging = true }, onDragEnd = { dragging = false }, onDragCancel = { dragging = false; awaitingEcho = false }) { change, delta ->
                            change.consume()
                            size = (size + (delta.x + delta.y) / (2 * pixelsPerUnit)).coerceIn(scene.minSize, scene.maxSize)
                            x = x.coerceAtMost((extent - size).coerceAtLeast(0f)); y = y.coerceAtMost((extent - size).coerceAtLeast(0f))
                            awaitingEcho = true
                            action("panel-change", id = layer.sizeId, value = size.toString())
                        }
                    }.semantics {
                        contentDescription = "${layer.label}のサイズを変更"
                        stateDescription = "横位置 ${x.toInt()}、縦位置 ${y.toInt()}、サイズ ${size.toInt()}"
                    }, contentAlignment = Alignment.Center) { Label("↔", 18) }
            }
        } }
    }
}
