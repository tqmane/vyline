import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.kyant.shapes.Capsule

/** LiquidSlider catalog proportions, using the shared backdrop/motion and accessible host range. */
@Composable
internal fun AppleSlider(value: Float, change: (Float) -> Unit, range: ClosedFloatingPointRange<Float>,
    modifier: Modifier = Modifier, enabled: Boolean = true) {
    val current by rememberUpdatedState(value)
    val changed by rememberUpdatedState(change)
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val colors = LocalRendererColors.current
    val backdrop = LocalAppleControlBackdrop.current
    val motion = rememberAppleLiquidMotion(enabled, LocalReducedMotion.current)
    BoxWithConstraints(modifier, contentAlignment = Alignment.CenterStart) {
        val span = range.endInclusive - range.start
        val width = constraints.maxWidth.toFloat().coerceAtLeast(1f)
        val fraction = ((current - range.start) / span).coerceIn(0f, 1f)
        val trackWidth = (maxWidth - 28.dp).coerceAtLeast(0.dp)
        val pointer = Modifier.fillMaxSize()
            .pointerInput(enabled, range, rtl) {
                if (enabled) detectTapGestures { point ->
                    val progress = (point.x / width).coerceIn(0f, 1f)
                    changed(range.start + (if (rtl) 1f - progress else progress) * span)
                }
            }
            .draggable(rememberDraggableState { delta ->
                changed((current + delta / width * span * if (rtl) -1f else 1f).coerceIn(range))
            }, Orientation.Horizontal, enabled = enabled, interactionSource = motion.interactionSource)
        Box(pointer) {
            Box(Modifier.align(Alignment.Center).fillMaxWidth().height(6.dp).clip(Capsule())
                .background(colors.secondary.copy(alpha = .25f)))
            Box(Modifier.align(Alignment.CenterStart).fillMaxWidth(fraction).height(6.dp).clip(Capsule())
                .background(if (enabled) colors.accent else colors.disabled))
            Box(Modifier.align(Alignment.CenterStart).offset(x = trackWidth * fraction).size(28.dp)
                .then(if (backdrop != null) Modifier.appleLiquidBackdrop(motion, backdrop, { Capsule() },
                    Color.White.copy(alpha = if (enabled) .9f else .6f), blurRadius = 8.dp, lensRadius = 10.dp, lensHeight = 14.dp)
                    else Modifier.clip(Capsule()).background(Color.White)))
        }
    }
}
