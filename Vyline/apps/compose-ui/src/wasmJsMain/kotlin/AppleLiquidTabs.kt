/*
 * Copyright 2025 Kyant
 * SPDX-License-Identifier: Apache-2.0
 * Adapted from AndroidLiquidGlass commonMain LiquidBottomTabs/DampedDragAnimation.
 * Changes: app filter tabs, single accessible content row, drag cancellation,
 * keyboard selection, reduced-motion support. See licenses/AndroidLiquidGlass-NOTICE.md.
 */

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.selectableGroup
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.backdrop.shadow.Shadow
import kotlin.math.abs
import kotlin.math.roundToInt

@Composable
internal fun AppleLiquidTabs(
    labels: List<String>,
    selectedIndex: Int,
    onSelected: (Int) -> Unit,
    backdrop: Backdrop,
    backgroundColor: Color,
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    if (labels.isEmpty()) return
    val selected = selectedIndex.coerceIn(labels.indices)
    val motion = rememberAppleLiquidMotion(reducedMotion = reducedMotion)
    val interactions = remember { MutableInteractionSource() }
    val position = remember { Animatable(selected.toFloat(), 0.001f) }
    var target by remember { mutableFloatStateOf(selected.toFloat()) }
    var dragging by remember { mutableStateOf(false) }
    var dragPosition by remember { mutableFloatStateOf(selected.toFloat()) }
    val currentSelection by rememberUpdatedState(selected)
    val select by rememberUpdatedState(onSelected)
    val accent = LocalAccent.current
    val ink = LocalInk.current
    val surface = if (ink.red > 0.5f) Color(0xFF232326).copy(alpha = 0.60f) else Color.White.copy(alpha = 0.55f)
    LaunchedEffect(motion, interactions) {
        interactions.interactions.collect { interaction ->
            // A child click is cancelled when this row claims a drag; the glass
            // must stay pressed until that drag commits or cancels.
            if (!dragging) when (interaction) {
                is PressInteraction.Press -> motion.press()
                is PressInteraction.Release, is PressInteraction.Cancel -> motion.release()
            }
        }
    }
    LaunchedEffect(selected, labels.size) { if (!dragging) target = selected.toFloat() }
    LaunchedEffect(target, dragging, reducedMotion) {
        val destination = target.coerceIn(0f, labels.lastIndex.toFloat())
        if (dragging) return@LaunchedEffect
        if (reducedMotion) position.snapTo(destination)
        else {
            position.snapTo(dragPosition)
            if (abs(position.value - destination) > 0.001f) motion.press()
            position.animateTo(destination, spring(1f, 1000f, 0.001f))
        }
        dragPosition = destination
        motion.release()
    }
    BoxWithConstraints(modifier.fillMaxWidth().semantics { selectableGroup() }) {
        val tabWidth = (maxWidth - 8.dp) / labels.size
        val tabWidthPx = with(LocalDensity.current) { tabWidth.toPx() }
        val direction = if (LocalLayoutDirection.current == LayoutDirection.Ltr) 1f else -1f
        Box(Modifier.fillMaxWidth().height(56.dp)
            .pointerInput(motion, labels.size, tabWidthPx, direction) {
                detectHorizontalDragGestures(
                    onDragStart = {
                        dragging = true
                        dragPosition = position.value.coerceIn(0f, labels.lastIndex.toFloat())
                        motion.press()
                    },
                    onHorizontalDrag = { change, amount ->
                        change.consume()
                        dragPosition = (dragPosition + amount * direction / tabWidthPx).coerceIn(0f, labels.lastIndex.toFloat())
                    },
                    onDragEnd = {
                        val index = dragPosition.roundToInt().coerceIn(labels.indices)
                        target = index.toFloat()
                        dragging = false
                        select(index)
                    },
                    onDragCancel = {
                        target = currentSelection.toFloat()
                        dragging = false
                        motion.release()
                    },
                )
            }
            .drawBackdrop(backdrop, { CircleShape }, effects = {
                vibrancy(); blur(8.dp.toPx())
                val progress = motion.pressProgress.coerceIn(0f, 1f)
                lens(18.dp.toPx() * (1f + .35f * progress), 18.dp.toPx())
            }, onDrawSurface = { drawRect(surface) })
        ) {
            // One text layer, painted above the optics. Refraction of a second
            // text capture changes glyph geometry as the lens crosses a label.
            // Glass still refracts the live backdrop; labels never move or scale.
            Box(Modifier.offset(4.dp, 4.dp).width(tabWidth).height(48.dp)
                .graphicsLayer {
                    val current = if (dragging) dragPosition else position.value
                    translationX = (if (direction > 0) current else labels.lastIndex - current) * tabWidthPx
                }
                .drawBackdrop(backdrop, { CircleShape }, effects = {
                    val progress = motion.pressProgress.coerceIn(0f, 1f)
                    lens(10.dp.toPx() * progress, 14.dp.toPx() * progress, chromaticAberration = true)
                }, highlight = { Highlight.Default.copy(alpha = motion.pressProgress.coerceIn(0f, 1f)) },
                    shadow = { Shadow(radius = 10.dp, alpha = motion.pressProgress.coerceIn(0f, 1f)) },
                    innerShadow = { InnerShadow(radius = 8.dp * motion.pressProgress.coerceIn(0f, 1f), alpha = motion.pressProgress.coerceIn(0f, 1f)) },
                    layerBlock = {
                        if (!reducedMotion) {
                            val progress = motion.pressProgress
                            val velocity = position.velocity / 10f
                            scaleX = (1f + 0.08f * progress) / (1f - (velocity * 0.75f).coerceIn(-0.2f, 0.2f))
                            scaleY = (1f + 0.12f * progress) * (1f - (velocity * 0.25f).coerceIn(-0.2f, 0.2f))
                        }
                    }, onDrawSurface = {
                        drawRect(backgroundColor.copy(alpha = .65f))
                        drawRect(accent.copy(alpha = 0.13f))
                    })
            )
            Row(Modifier.fillMaxWidth().padding(4.dp)) {
                labels.forEachIndexed { index, label ->
                    Box(Modifier.weight(1f).height(48.dp)
                        .clickable(interactionSource = interactions, indication = null, role = Role.Tab) {
                            dragPosition = position.value
                            target = index.toFloat()
                            select(index)
                        }.semantics { this.selected = index == selected }, contentAlignment = Alignment.Center) {
                        val current = if (dragging) dragPosition else position.value
                        Label(label, 12, FontWeight.SemiBold, color = lerp(ink, accent, (1f - abs(current - index)).coerceIn(0f, 1f)))
                    }
                }
            }
        }
    }
}
