@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class, kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.onPointerEvent
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.ArrowLeft
import io.github.composefluent.icons.regular.ArrowRight
import io.github.composefluent.icons.regular.Dismiss

@Composable
internal fun NativePanes(state: SidebarSnapshot, split: Boolean) {
    val action = rememberScopedAction()
    val focused = state.panes.find { it.id == state.chat?.id } ?: state.panes.first()
    val focusedIndex = state.panes.indexOf(focused)
    var layoutsOpen by remember { mutableStateOf(false) }
    val surface = when { state.dark -> Color(0xFF242426); state.mode == "miuix" -> Color(0xFFF4F5F8); else -> Color(0xFFF8F8FA) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(surface).padding(horizontal = 4.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()).semantics { selectableGroup() }, verticalAlignment = Alignment.CenterVertically) {
                state.panes.forEach { pane -> key(pane.id) {
                    val selected = pane.id == focused.id
                    Row(Modifier.padding(end = 3.dp).background(if (selected) LocalAccent.current.copy(alpha = .13f) else Color.Transparent,
                        RoundedCornerShape(if (state.mode == "fluent") 5.dp else 16.dp)), verticalAlignment = Alignment.CenterVertically) {
                        Label(pane.chat.title, 13, if (selected) FontWeight.SemiBold else FontWeight.Normal,
                            modifier = Modifier.widthIn(max = 180.dp).heightIn(min = 40.dp)
                                .clickable(role = Role.Tab) { action("pane-focus", id = pane.id) }
                                .semantics { this.selected = selected; contentDescription = "${pane.chat.title}のペインを選択" }
                                .padding(start = 13.dp, top = 11.dp, bottom = 9.dp, end = 5.dp))
                        LocalIconButton(Icons.Regular.Dismiss, "${pane.chat.title}のペインを閉じる", state.mode) { action("pane-close", id = pane.id) }
                    }
                } }
            }
            NativeButton(state.mode, "配置", primary = layoutsOpen) { layoutsOpen = !layoutsOpen }
        }
        if (layoutsOpen) Row(Modifier.fillMaxWidth().background(surface).horizontalScroll(rememberScrollState()).padding(6.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            NativeButton(state.mode, "横並び", primary = state.paneLayout == "columns") { action("pane-layout", value = "columns"); layoutsOpen = false }
            if (state.panes.size == 3) {
                NativeButton(state.mode, "左を分割", primary = state.paneLayout == "split-left") { action("pane-layout", value = "split-left"); layoutsOpen = false }
                NativeButton(state.mode, "右を分割", primary = state.paneLayout == "split-right") { action("pane-layout", value = "split-right"); layoutsOpen = false }
            }
            if (state.panes.size == 4) NativeButton(state.mode, "4分割", primary = state.paneLayout == "grid") { action("pane-layout", value = "grid"); layoutsOpen = false }
            if (focusedIndex > 0) LocalIconButton(Icons.Regular.ArrowLeft, "${focused.chat.title}のペインを前へ移動", state.mode) {
                action("pane-move", id = focused.id, value = (focusedIndex - 1).toString())
            }
            if (focusedIndex < state.panes.lastIndex) LocalIconButton(Icons.Regular.ArrowRight, "${focused.chat.title}のペインを次へ移動", state.mode) {
                action("pane-move", id = focused.id, value = (focusedIndex + 1).toString())
            }
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().clipToBounds()) {
            val wide = split && maxWidth >= 560.dp
            val areaWidth = maxWidth
            val areaHeight = maxHeight
            val rects = state.paneRects.takeIf { it.size == state.panes.size }
                ?: state.panes.indices.map { PaneRect(it * 100.0 / state.panes.size, 0.0, 100.0 / state.panes.size, 100.0) }
            state.panes.forEachIndexed { index, pane -> if (wide || pane.id == focused.id) key(state.epoch, pane.id) {
                val rect = if (wide) rects[index] else PaneRect(0.0, 0.0, 100.0, 100.0)
                NativeChatPane(state, pane, pane.id == focused.id, split,
                    Modifier.offset(areaWidth * (rect.x / 100).toFloat(), areaHeight * (rect.y / 100).toFloat())
                        .size(areaWidth * (rect.width / 100).toFloat(), areaHeight * (rect.height / 100).toFloat()))
            } }
            if (wide && state.panes.size > 1) {
                if (state.paneLayout == "columns") rects.dropLast(1).forEachIndexed { index, rect ->
                    PaneDivider("ペイン ${index + 1} と ${index + 2} の幅を変更", false, (rect.x + rect.width).toFloat(), areaWidth.value,
                        Modifier.offset(x = areaWidth * ((rect.x + rect.width) / 100).toFloat() - 4.dp).width(8.dp).fillMaxHeight()) { delta ->
                        action("pane-resize", id = index.toString(), value = delta.toString(), x = areaWidth.value)
                    }
                } else {
                    val main = rects.map { it.x }.filter { it > 0 }.minOrNull()?.toFloat() ?: 50f
                    val cross = rects.map { it.y }.filter { it > 0 }.minOrNull()?.toFloat() ?: 50f
                    PaneDivider("左右のペインの幅を変更", false, main, areaWidth.value,
                        Modifier.offset(x = areaWidth * (main / 100) - 4.dp).width(8.dp).fillMaxHeight(), absolute = true) { value ->
                        action("pane-main-ratio", value = value.toString())
                    }
                    val crossLeft = if (state.paneLayout == "split-right") main else 0f
                    val crossWidth = when (state.paneLayout) { "split-left" -> main; "split-right" -> 100 - main; else -> 100f }
                    PaneDivider("上下のペインの高さを変更", true, cross, areaHeight.value,
                        Modifier.offset(x = areaWidth * (crossLeft / 100), y = areaHeight * (cross / 100) - 4.dp)
                            .width(areaWidth * (crossWidth / 100)).height(8.dp), absolute = true) { value ->
                        action("pane-cross-ratio", value = value.toString())
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeChatPane(state: SidebarSnapshot, pane: KmpPaneSnapshot, focused: Boolean, split: Boolean, modifier: Modifier) {
    val scope = remember(state.epoch, pane.id) { UiActionScope(state.epoch, pane.id, true) }
    val density = LocalDensity.current.density
    var bounds by remember { mutableStateOf<Rect?>(null) }
    val activate = {
        scope.activateFiles()
        if (!focused) scope("pane-focus", id = pane.id)
    }
    DisposableEffect(scope) { onDispose { removePaneBounds(scope.epoch, pane.id) } }
    SideEffect { bounds?.let { registerPaneBounds(scope.epoch, pane.id, it.left / density, it.top / density, it.right / density, it.bottom / density) } }
    val paneState = state.copy(chat = pane.chat, messages = pane.messages, composer = pane.composer,
        history = pane.history, chatUi = pane.chatUi, announcements = pane.announcements,
        highlightMessageId = pane.highlightMessageId, scrollLatest = pane.scrollLatest,
        profileOpen = pane.profileOpen, readersPanel = pane.readersPanel, notice = if (focused) state.notice else "", panes = emptyList())
    CompositionLocalProvider(LocalUiActionScope provides scope) {
        Box(modifier.clipToBounds().border(1.dp, if (focused) LocalAccent.current.copy(alpha = .6f) else LocalSecondaryInk.current.copy(alpha = .16f))
            .onGloballyPositioned { bounds = it.boundsInWindow() }
            .onFocusChanged { if (it.hasFocus) activate() }.focusGroup()
            .onPreviewKeyEvent { activate(); false }
            .semantics { paneTitle = pane.chat.title; isTraversalGroup = true }) {
            ChatScreen(paneState, split)
        }
    }
}

@Composable
private fun PaneDivider(label: String, horizontal: Boolean, ratio: Float, extent: Float, modifier: Modifier,
    absolute: Boolean = false, change: (Float) -> Unit) {
    val density = LocalDensity.current.density
    val focus = remember { FocusRequester() }
    val inputMode = LocalInputModeManager.current
    val currentRatio by rememberUpdatedState(ratio)
    val currentChange by rememberUpdatedState(change)
    fun adjust(delta: Float) = currentChange(if (absolute) (currentRatio + delta).coerceIn(22f, 78f) else delta)
    Box(modifier.semantics {
        contentDescription = label
        stateDescription = "${ratio.toInt()}%"
        customActions = listOf(CustomAccessibilityAction("比率を減らす") { adjust(-2f); true }, CustomAccessibilityAction("比率を増やす") { adjust(2f); true })
    }.onPreviewKeyEvent { event ->
        if (event.type != KeyEventType.KeyDown) false
        else if (event.key == if (horizontal) Key.DirectionUp else Key.DirectionLeft) { adjust(-2f); true }
        else if (event.key == if (horizontal) Key.DirectionDown else Key.DirectionRight) { adjust(2f); true }
        else false
    }.focusRequester(focus).focusable()
        .onPointerEvent(PointerEventType.Press, PointerEventPass.Initial) {
            inputMode.requestInputMode(InputMode.Keyboard)
            focusComposeCanvas()
            focus.requestFocus()
        }.pointerInput(horizontal, extent, absolute, density) {
        var startRatio = 0f
        var total = 0f
        detectDragGestures(onDragStart = { startRatio = currentRatio; total = 0f }) { pointer, amount ->
            pointer.consume()
            val delta = (if (horizontal) amount.y else amount.x) / density / extent.coerceAtLeast(1f) * 100
            total += delta
            currentChange(if (absolute) (startRatio + total).coerceIn(22f, 78f) else delta)
        }
    }, contentAlignment = Alignment.Center) {
        Box((if (horizontal) Modifier.fillMaxWidth().height(1.dp) else Modifier.fillMaxHeight().width(1.dp))
            .background(LocalSecondaryInk.current.copy(alpha = .25f)))
    }
}

private fun registerPaneBounds(epoch: Int, chatId: String, left: Float, top: Float, right: Float, bottom: Float): Unit = js("""{
    (window.vylinePaneBounds ??= new Map()).set(chatId, { epoch, chatId, left, top, right, bottom });
}""")
private fun removePaneBounds(epoch: Int, chatId: String): Unit = js("""{
    if (window.vylinePaneBounds?.get(chatId)?.epoch === epoch) window.vylinePaneBounds.delete(chatId);
}""")
