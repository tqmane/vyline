@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.*
import io.github.composefluent.component.Button as FluentButton
import top.yukonga.miuix.kmp.basic.Button as MiuixButton
import kotlinx.browser.window
import org.w3c.dom.events.Event
import org.w3c.dom.events.KeyboardEvent as BrowserKeyboardEvent

/** The existing call controller owns state; primary call actions never scroll out of reach. */
@Composable
internal fun NativeCallScreen(state: SidebarSnapshot, panel: NativePanel, backdrop: Backdrop) {
    val action = rememberScopedAction()
    val header = panel.items.firstOrNull { it.kind == "call-header" }?.items.orEmpty()
    val primary = panel.items.firstOrNull { it.kind == "call-controls" }?.items.orEmpty()
    val minimize = header.firstOrNull { it.label == "通話を小さくしてトークを見る" }
    val compact = panel.compact || state.nativePanel != null && state.nativePanel.id != panel.id
    val incoming = panel.callLayout == "incoming"
    val escapeAction by rememberUpdatedState(minimize?.takeIf {
        !compact && panel.callLayout == "expanded" && state.hostMenu == null && state.controllerDialog == null
    }?.let { control -> { action("panel-action", id = control.id) } })
    // An ephemeral recording control can disappear while focused. Keep Escape
    // available for this expanded call window, including its HTML media surface.
    DisposableEffect(panel.id) {
        val listener: (Event) -> Unit = { event ->
            val key = event as? BrowserKeyboardEvent
            if (key?.key == "Escape" && !event.defaultPrevented && escapeAction != null && !callMediaFullscreen()) {
                event.preventDefault(); event.stopPropagation(); escapeAction?.invoke()
            }
        }
        window.addEventListener("keydown", listener, true)
        onDispose { window.removeEventListener("keydown", listener, true) }
    }
    val restore: () -> Unit = {
        if (state.nativePanel != null && state.nativePanel.id != panel.id) action("panel-close", id = "${state.nativePanel.id}:close")
        header.firstOrNull { it.label == "通話へ戻る" }?.let { action("panel-action", id = it.id) }
    }
    val background = LocalRendererColors.current.canvas
    Column((if (compact) Modifier.widthIn(max = 340.dp).fillMaxWidth().heightIn(max = 240.dp) else Modifier.fillMaxSize())
        .background(background).onPreviewKeyEvent {
            if (it.type == KeyEventType.KeyDown && it.key == Key.Escape && minimize != null) {
                action("panel-action", id = minimize.id); true
            } else false
        }.semantics { paneTitle = panel.title; isTraversalGroup = true }) {
        if (!incoming) Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Label(if (compact) panel.title else "通話", 16, FontWeight.SemiBold, modifier = Modifier.weight(1f), maxLines = 2)
            if (compact) NativeButton(state.mode, "通話へ戻る", onClick = restore)
            else minimize?.let { NativeButton(state.mode, "トークを見る") { action("panel-action", id = it.id) } }
        }
        if (compact) {
            header.filter { it.kind == "text" && it.label != "通話" }.forEach { item ->
                Label(item.label, 12, color = LocalRendererColors.current.danger, maxLines = 2, modifier = Modifier.padding(horizontal = 12.dp).semantics { liveRegion = LiveRegionMode.Polite })
            }
            if (incoming) Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                panel.items.filter { it.kind != "button" && it.kind != "call-width" }.forEach { item ->
                    if (item.kind == "call-summary") Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Avatar(ConversationRow("caller", item.label, avatar = item.value, avatarUrl = item.url, color = "#7292A9"), 44)
                        Column(Modifier.weight(1f)) { Label(item.label, 16, FontWeight.SemiBold, maxLines = 2); Label(item.description.orEmpty(), 12, color = LocalSecondaryInk.current) }
                    } else NativePanelControl(state, item)
                }
            }
            Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val controls = if (incoming) panel.items.filter { it.kind == "button" } else
                    (primary + header).filter { it.symbol == "hangup" || it.symbol == "mic" || it.symbol == "muted" }
                controls.forEach { item -> Box(Modifier.weight(1f)) { CallCommand(state, item, backdrop) } }
            }
        } else {
            val density = LocalDensity.current.density
            var bounds by remember { mutableStateOf(Rect.Zero) }
            val list = rememberLazyListState()
            CompositionLocalProvider(LocalHtmlViewport provides scrollingHtmlViewport(bounds, state.hostMenu == null && state.controllerDialog == null && (state.nativePanel == null || state.nativePanel.id == panel.id), list)) {
                LazyColumn(Modifier.weight(1f).fillMaxWidth().onGloballyPositioned {
                    val rect = it.boundsInWindow(); bounds = Rect(rect.left / density, rect.top / density, rect.right / density, rect.bottom / density)
                }, state = list, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(panel.items.filter { it.kind !in listOf("call-header", "call-width", "call-controls") }, key = { it.id }) { item ->
                        if (item.kind == "call-summary") Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (item.largeImage) Avatar(ConversationRow("call", item.label, avatar = item.value, avatarUrl = item.url, color = "#7292A9"), 84)
                            Label(item.label, 21, FontWeight.SemiBold, maxLines = 2)
                            Label(item.description.orEmpty(), 14, color = LocalSecondaryInk.current, maxLines = 4,
                                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                            if (!item.caption.isNullOrBlank()) Label(item.caption, 17, color = LocalRendererColors.current.accentText)
                        } else NativePanelControl(state, item)
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                primary.forEach { item -> Box(Modifier.weight(1f)) { CallCommand(state, item, backdrop) } }
            }
        }
    }
}

private fun callMediaFullscreen(): Boolean = js("Boolean(document.fullscreenElement)")

@Composable
private fun CallCommand(state: SidebarSnapshot, item: NativePanelItem, backdrop: Backdrop) {
    val action = rememberScopedAction()
    val ink = when {
        item.disabled -> LocalRendererColors.current.disabled
        item.danger -> LocalRendererColors.current.danger
        else -> LocalRendererColors.current.accentText
    }
    val symbol = when (item.symbol) {
        "hangup" -> AppleSymbol.Hangup; "mic" -> AppleSymbol.Microphone; "muted" -> AppleSymbol.MicOff
        "video" -> AppleSymbol.Video; "videoOff" -> AppleSymbol.VideoOff; "cameraSwitch" -> AppleSymbol.CameraSwitch
        "close" -> AppleSymbol.Close
        else -> AppleSymbol.Phone
    }
    val vector = when (item.symbol) {
        "hangup" -> Icons.Regular.CallEnd; "muted" -> Icons.Regular.MicOff; "mic" -> Icons.Regular.Mic
        "videoOff" -> Icons.Regular.VideoOff; "cameraSwitch" -> Icons.Regular.ArrowSync; "video" -> Icons.Regular.Video
        "close" -> Icons.Regular.Dismiss
        else -> Icons.Regular.Call
    }
    val click = { action("panel-action", id = item.id) }
    val modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp).clearAndSetSemantics {
        role = Role.Button; contentDescription = item.label; selected = item.primary
        if (item.disabled) disabled()
        onClick { if (!item.disabled) click(); !item.disabled }
    }
    val content: @Composable () -> Unit = {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (item.symbol != null) { if (state.mode == "apple") AppleGlyph(symbol, ink, 26) else Glyph(vector, ink, 24) }
            Label(item.caption ?: item.label, 12, color = ink, maxLines = 2)
        }
    }
    when (state.mode) {
        "miuix" -> MiuixButton(onClick = click, modifier = modifier, enabled = !item.disabled) { content() }
        "fluent" -> FluentButton(onClick = click, modifier = modifier, disabled = item.disabled) { content() }
        else -> {
            val motion = rememberAppleLiquidMotion(!item.disabled, state.reducedMotion)
            Box(modifier.appleLiquidBackdrop(motion, backdrop, { CircleShape }, if (item.danger) ink.copy(alpha = .18f) else LocalSecondaryInk.current.copy(alpha = .12f))
                .clickable(enabled = !item.disabled, role = Role.Button, interactionSource = motion.interactionSource, indication = null, onClick = click)
                .then(motion.pointerModifier), contentAlignment = Alignment.Center) { content() }
        }
    }
}

@Composable
internal fun NativeCallDivider(panel: NativePanel, width: Float) {
    val control = panel.items.firstOrNull { it.kind == "call-width" } ?: return
    val action = rememberScopedAction()
    val density = LocalDensity.current.density
    val currentWidth by rememberUpdatedState(width)
    val focus = remember { FocusRequester() }
    val inputMode = LocalInputModeManager.current
    val focusDivider = { inputMode.requestInputMode(InputMode.Keyboard); focusComposeCanvas(); focus.requestFocus(); Unit }
    val change = { value: Float -> action("panel-change", id = control.id, value = value.coerceAtLeast(320f).toString()) }
    Box(Modifier.width(6.dp).fillMaxHeight().background(LocalSecondaryInk.current.copy(alpha = .12f))
        .semantics { contentDescription = control.label; stateDescription = "${width.toInt()}" }
        .onPreviewKeyEvent {
            if (it.type == KeyEventType.KeyDown && it.key in listOf(Key.DirectionLeft, Key.DirectionRight, Key.MoveHome, Key.MoveEnd, Key.Enter)) {
                change(when (it.key) { Key.MoveHome -> 320f; Key.MoveEnd -> 10000f; Key.Enter -> 400f; Key.DirectionLeft -> width + 24f; else -> width - 24f }); true
            } else false
        }.focusRequester(focus).focusable().pointerInput(focus, inputMode) {
            awaitPointerEventScope { while (true) {
                if (awaitPointerEvent(PointerEventPass.Initial).type == PointerEventType.Press) focusDivider()
            } }
        }.combinedClickable(onClick = focusDivider, onDoubleClick = { change(400f) }).pointerInput(control.id, density) {
            var current = width
            detectDragGestures(onDragStart = { current = currentWidth }) { pointer, delta -> pointer.consume(); current = (current - delta.x / density).coerceAtLeast(320f); change(current) }
        })
}
