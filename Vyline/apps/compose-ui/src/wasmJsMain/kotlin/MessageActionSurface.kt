import androidx.compose.animation.*
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.shapes.RoundedRectangle
import io.github.composefluent.component.DialogSize
import io.github.composefluent.component.FluentDialog
import top.yukonga.miuix.kmp.overlay.OverlayBottomSheet
import top.yukonga.miuix.kmp.overlay.OverlayDialog

internal val LocalActionSurfaceEnabled = staticCompositionLocalOf { true }

/** Native overlay implementations own their animation. Do not wrap them in `if (visible)`. */
@Composable
internal fun MessageActionSurface(
    state: SidebarSnapshot,
    panel: MessagePanel,
    visible: Boolean,
    backdrop: Backdrop,
    onDismissRequest: () -> Unit,
    onDismissFinished: () -> Unit,
    titleOverride: String? = null,
    content: @Composable () -> Unit,
) {
    val title = titleOverride ?: when (panel) {
        MessagePanel.Actions -> "メッセージの操作"
        MessagePanel.Edit -> "メッセージを編集"
        MessagePanel.Revoke -> "送信の取り消し"
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val contentHeight = (maxHeight - 96.dp).coerceAtLeast(0.dp)
        val body: @Composable () -> Unit = {
            CompositionLocalProvider(LocalActionSurfaceEnabled provides visible) {
                Column(Modifier.fillMaxWidth().heightIn(max = contentHeight)
                    .verticalScroll(rememberScrollState()).padding(16.dp)
                    .onPreviewKeyEvent {
                        if (!visible) true
                        else if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) { onDismissRequest(); true }
                        else false
                    }.semantics { paneTitle = title },
                    verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
            }
        }
        when (state.mode) {
            "miuix" -> if (panel == MessagePanel.Actions) {
                OverlayBottomSheet(show = visible, title = title, sheetMaxWidth = 480.dp,
                    insideMargin = DpSize(4.dp, 8.dp), defaultWindowInsetsPadding = false,
                    enableNestedScroll = true, onDismissRequest = onDismissRequest,
                    onDismissFinished = onDismissFinished, content = body)
            } else {
                OverlayDialog(show = visible, insideMargin = DpSize(4.dp, 8.dp),
                    defaultWindowInsetsPadding = false, onDismissRequest = onDismissRequest,
                    onDismissFinished = onDismissFinished, content = body)
            }
            "fluent" -> FluentDialogSurface(visible, onDismissFinished, body)
            else -> AppleSurfacePresence(visible, onDismissFinished) {
                Box(Modifier.fillMaxSize()) {
                    Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = .18f))
                        .clickable(enabled = visible, onClick = onDismissRequest))
                    val surface = if (state.dark) Color(0xFF29292D) else Color(0xFFFCFCFE)
                    Box(Modifier.align(Alignment.Center).widthIn(max = 420.dp).padding(20.dp)
                        .animateEnterExit(enter = scaleIn(initialScale = .94f, animationSpec = if (state.reducedMotion) tween(0) else spring(.85f, 500f)),
                            exit = scaleOut(targetScale = .98f, animationSpec = tween(if (state.reducedMotion) 0 else 140)))
                        .drawBackdrop(backdrop, { RoundedRectangle(24.dp) }, effects = {
                            vibrancy(); blur(18.dp.toPx()); lens(12.dp.toPx(), 22.dp.toPx())
                        }, onDrawSurface = { drawRect(surface.copy(alpha = .86f)) })) { body() }
                }
            }
        }
    }
}

/**
 * FluentDialog v0.1.0 animates internally but exposes no onDismissFinished callback.
 * Observe actual popup-content disposal instead of guessing a delay from its duration.
 * This also handles a close before the first Popup frame, and rapid sheet/dialog changes.
 */
@Composable
private fun FluentDialogSurface(visible: Boolean, onDismissFinished: () -> Unit, content: @Composable () -> Unit) {
    var mounted by remember { mutableIntStateOf(0) }
    val finished by rememberUpdatedState(onDismissFinished)
    FluentDialog(visible = visible, size = DialogSize(0.dp, 448.dp)) {
        DisposableEffect(Unit) { mounted++; onDispose { mounted-- } }
        content()
    }
    LaunchedEffect(visible, mounted) { if (!visible && mounted == 0) finished() }
}

/** Full-screen scrim fades, while individual glass panels may have their own spring. */
@Composable
internal fun AppleSurfacePresence(
    visible: Boolean,
    onDismissFinished: () -> Unit,
    content: @Composable AnimatedVisibilityScope.() -> Unit,
) {
    val presence = remember { MutableTransitionState(false) }
    val finished by rememberUpdatedState(onDismissFinished)
    presence.targetState = visible
    val duration = if (LocalReducedMotion.current) 0 else 140
    AnimatedVisibility(visibleState = presence, modifier = Modifier.fillMaxSize(),
        enter = fadeIn(tween(duration)), exit = fadeOut(tween(duration)), content = content)
    LaunchedEffect(visible, presence.isIdle, presence.currentState) {
        if (!visible && presence.isIdle && !presence.currentState) finished()
    }
}
