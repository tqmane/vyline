/*
 * Copyright 2025 Kyant
 * SPDX-License-Identifier: Apache-2.0
 * Adapted from AndroidLiquidGlass commonMain LiquidButton and InteractiveHighlight.
 * Changes: shared Compose interaction source, disabled/reduced-motion handling,
 * dynamic Backdrop optical effects. See licenses/AndroidLiquidGlass-NOTICE.md.
 */

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.RuntimeShader
import com.kyant.backdrop.asComposeShader
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.backdrop.shadow.Shadow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.tanh

@Stable
internal class AppleLiquidMotion(
    private val scope: CoroutineScope,
    val enabled: Boolean,
    val reducedMotion: Boolean,
) {
    val interactionSource = MutableInteractionSource()
    private val pressure = Animatable(0f, 0.001f)
    private val displacement = Animatable(Offset.Zero, Offset.VectorConverter, Offset.VisibilityThreshold)
    private var origin = Offset.Unspecified
    val pressProgress: Float get() = pressure.value
    val offset: Offset get() = displacement.value
    // Backdrop's skikoMain implements this with Skia RuntimeEffect on Wasm as well.
    private val shader = RuntimeShader("""
        layout(color) uniform half4 color;
        uniform float radius;
        uniform float2 position;
        half4 main(float2 coord) {
            float dist = distance(coord, position);
            float intensity = smoothstep(radius, radius * 0.5, dist);
            return color * intensity;
        }
    """)

    fun press() {
        if (!enabled) return
        scope.launch {
            if (reducedMotion) pressure.snapTo(1f)
            else pressure.animateTo(1f, spring(0.5f, 300f, 0.001f))
        }
    }

    fun release() {
        scope.launch {
            launch {
                if (reducedMotion) pressure.snapTo(0f)
                else pressure.animateTo(0f, spring(0.5f, 300f, 0.001f))
            }
            launch {
                if (reducedMotion) displacement.snapTo(Offset.Zero)
                else displacement.animateTo(Offset.Zero, spring(0.5f, 300f, Offset.VisibilityThreshold))
            }
        }
    }

    private fun begin(position: Offset) {
        origin = position
        scope.launch { displacement.snapTo(Offset.Zero) }
    }

    private fun move(position: Offset) {
        if (!reducedMotion) scope.launch { displacement.snapTo(position - origin) }
    }

    // Observe at Initial without consuming: clickable owns keyboard activation,
    // release/out-of-bounds cancellation, and scroll gestures retain priority.
    val pointerModifier: Modifier = if (!enabled) Modifier else Modifier.pointerInput(this) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            begin(down.position)
            press()
            try {
                var cancelled = false
                do {
                    val event = awaitPointerEvent(PointerEventPass.Initial)
                    val pointer = event.changes.firstOrNull { it.id == down.id }
                    if (!cancelled && pointer?.pressed == true) move(pointer.position)
                    val finalEvent = awaitPointerEvent(PointerEventPass.Final)
                    if (!cancelled && finalEvent.changes.any { it.id == down.id && it.isConsumed }) {
                        cancelled = true
                        release()
                    }
                } while (pointer?.pressed == true)
            } finally { release() }
        }
    }

    fun DrawScope.drawHighlight() {
        val progress = pressProgress.coerceIn(0f, 1f)
        if (progress <= 0f) return
        val position = if (origin == Offset.Unspecified) center else origin + offset
        drawRect(Color.White.copy(alpha = 0.08f * progress), blendMode = BlendMode.Plus)
        shader.setColorUniform("color", Color.White.copy(alpha = 0.15f * progress))
        shader.setFloatUniform("radius", size.minDimension * 1.5f)
        shader.setFloatUniform("position", position.x.coerceIn(0f, size.width), position.y.coerceIn(0f, size.height))
        drawRect(ShaderBrush(shader.asComposeShader()), blendMode = BlendMode.Plus)
    }
}

@Composable
internal fun rememberAppleLiquidMotion(enabled: Boolean = true, reducedMotion: Boolean = false): AppleLiquidMotion {
    val scope = rememberCoroutineScope()
    val motion = remember(scope, enabled, reducedMotion) { AppleLiquidMotion(scope, enabled, reducedMotion) }
    LaunchedEffect(motion) {
        motion.interactionSource.interactions.collect { interaction ->
            when (interaction) {
                is PressInteraction.Press -> motion.press()
                is PressInteraction.Release, is PressInteraction.Cancel -> motion.release()
            }
        }
    }
    return motion
}

internal fun Modifier.appleLiquidBackdrop(
    motion: AppleLiquidMotion,
    backdrop: Backdrop,
    shape: () -> Shape,
    surfaceColor: Color,
    blurRadius: Dp = 12.dp,
    lensRadius: Dp = 8.dp,
    lensHeight: Dp = 12.dp,
): Modifier = drawBackdrop(
    backdrop = backdrop,
    shape = shape,
    effects = {
        val progress = motion.pressProgress.coerceIn(0f, 1f)
        vibrancy()
        blur(blurRadius.toPx())
        lens(lensRadius.toPx() * (1f + 0.35f * progress), lensHeight.toPx() * (1f + 0.5f * progress))
    },
    highlight = { Highlight.Default.copy(alpha = 0.65f + 0.35f * motion.pressProgress.coerceIn(0f, 1f)) },
    shadow = { Shadow(radius = 12.dp + 6.dp * motion.pressProgress.coerceIn(0f, 1f), color = Color.Black.copy(alpha = 0.08f)) },
    innerShadow = { InnerShadow(radius = 4.dp, alpha = 0.15f * motion.pressProgress.coerceIn(0f, 1f)) },
    layerBlock = {
        if (!motion.reducedMotion && size.minDimension > 0f) {
            val progress = motion.pressProgress
            val scale = 1f + 4.dp.toPx() / size.height * progress
            val offset = motion.offset
            val maxOffset = size.minDimension
            translationX = maxOffset * tanh(0.05f * offset.x / maxOffset)
            translationY = maxOffset * tanh(0.05f * offset.y / maxOffset)
            val maxDragScale = 4.dp.toPx() / size.height
            val angle = atan2(offset.y, offset.x)
            scaleX = scale + maxDragScale * abs(cos(angle) * offset.x / size.maxDimension) * (size.width / size.height).coerceAtMost(1f)
            scaleY = scale + maxDragScale * abs(sin(angle) * offset.y / size.maxDimension) * (size.height / size.width).coerceAtMost(1f)
        }
    },
    onDrawSurface = {
        drawRect(surfaceColor)
        with(motion) { drawHighlight() }
    },
)
