@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlin.math.abs

// Match MessageBubble's left-swipe threshold; vertical scrolling and child controls keep ownership.
internal fun Modifier.messageSwipeReply(id: String, ignoreSwipe: () -> Boolean, onOffset: (Float) -> Unit, onReply: () -> Unit): Modifier =
    pointerInput(id) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            if (down.type != PointerType.Touch || ignoreSwipe()) return@awaitEachGesture
            var claimed = false
            var distance = 0f
            try {
                while (true) {
                    val event = awaitPointerEvent(PointerEventPass.Main)
                    val change = event.changes.find { it.id == down.id } ?: break
                    if (event.changes.count { it.pressed } > 1 || change.isConsumed) break
                    val delta = change.position - down.position
                    if (!change.pressed) {
                        if (claimed && distance >= 52.dp.toPx() && distance > abs(delta.y) * 1.25f) {
                            vibrateSwipeReply()
                            onReply()
                        }
                        break
                    }
                    if (!claimed) {
                        if (abs(delta.x) < 18.dp.toPx() && abs(delta.y) < 18.dp.toPx()) continue
                        if (delta.x >= 0 || -delta.x <= abs(delta.y) * 1.25f) break
                        claimed = true
                    }
                    distance = -delta.x
                    change.consume()
                    onOffset(-((distance - 18.dp.toPx()).coerceIn(0f, 72.dp.toPx())))
                }
            } finally { onOffset(0f) }
        }
    }

private fun vibrateSwipeReply(): Unit = js("{ if (typeof navigator.vibrate === 'function') navigator.vibrate(8); }")
