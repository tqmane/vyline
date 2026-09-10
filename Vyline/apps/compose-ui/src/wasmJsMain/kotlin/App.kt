import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.*
import com.kyant.shapes.RoundedRectangle
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.Mail
import io.github.composefluent.icons.regular.Navigation
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import top.yukonga.miuix.kmp.basic.Scaffold as MiuixScaffold

@Composable
fun App(source: SidebarSnapshot) {
    var retainedMenu by remember(source.epoch, source.mode) { mutableStateOf<HostMenu?>(null) }
    val menu = source.hostMenu ?: retainedMenu
    // Keep media/HTML occlusion and the Apple backdrop alive through the exit frames.
    // Do not serialize this presentation-only copy back to the TypeScript host.
    val state = if (source.hostMenu == null && menu != null) source.copy(hostMenu = menu) else source
    SideEffect { if (source.hostMenu != null) retainedMenu = source.hostMenu }
    val menuBackdrop = rememberLayerBackdrop()
    val drag = remember(state.epoch) { ChatListDrag() }
    // Bind intents to the committed UI, not a newer snapshot waiting to be rendered.
    val actionScope = remember(state.epoch, state.chat?.id, state.view) { UiActionScope(state.epoch, state.chat?.id, state.chat != null && state.view == "chat") }
    DisposableEffect(actionScope) { actionScope.activateFiles(); onDispose {} }
    RendererTheme(state) {
        CompositionLocalProvider(LocalUiActionScope provides actionScope, LocalChatListDrag provides drag) {
        BoxWithConstraints(Modifier.fillMaxSize().background(if (state.mode == "fluent") Color.Transparent else LocalRendererColors.current.canvas)) {
            val split = maxWidth >= 760.dp
            val sidebarWidth = if (!split) maxWidth else state.sidebarWidth.toFloat().coerceIn(260f, 520f).dp
            val dockedCall = state.controllerCall?.takeIf { it.callLayout == "docked" && state.nativePanel == null }
            val callWidth = dockedCall?.items?.firstOrNull { it.kind == "call-width" }?.value?.toFloatOrNull()?.dp ?: 400.dp
            SideEffect { drag.split = split && state.desktopInteraction && state.view == "chat"; if (!state.desktopInteraction || state.view != "chat") drag.reset() }
            Row(Modifier.fillMaxSize().then(if (state.hostMenu != null) Modifier.layerBackdrop(menuBackdrop) else Modifier)) {
                if (split && (!state.sidebarCollapsed || state.splitPick) || !split && (state.splitPick || state.chat == null && state.view != "settings")) {
                    Box(Modifier.width(sidebarWidth).fillMaxHeight().then(if (state.mode == "apple" && split) Modifier.padding(12.dp).clip(RoundedRectangle(26.dp)) else Modifier)) { Sidebar(state, compact = !split) }
                    if (split && state.desktopInteraction) SidebarDivider(state)
                    else if (split && state.mode != "apple") Box(Modifier.width(1.dp).fillMaxHeight().background(LocalSecondaryInk.current.copy(alpha = .16f)))
                }
                if (split || !state.splitPick && (state.chat != null || state.view == "settings")) Box(Modifier.weight(1f).fillMaxHeight().clipToBounds().onGloballyPositioned { drag.paneBounds = it.boundsInWindow() }) {
                    RouteMotion(state, split) {
                    when {
                        state.view == "settings" -> SettingsScreen(state, split)
                        state.panes.isNotEmpty() -> NativePanes(state, split)
                        state.chat != null -> key(state.epoch, state.chat.id) { ChatScreen(state, split) }
                        else -> Column(Modifier.fillMaxSize().background(LocalRendererColors.current.canvas),
                            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                            if (state.mode == "apple") AppleGlyph(AppleSymbol.Compose, LocalAccent.current, 64) else Glyph(Icons.Regular.Mail, LocalAccent.current, 64)
                            Spacer(Modifier.height(24.dp))
                            Label("会話を選択", 26, FontWeight.SemiBold)
                            Spacer(Modifier.height(10.dp))
                            Label("メッセージを表示するトークを選んでください", 14, color = LocalSecondaryInk.current)
                            if (split) Command(state.mode, Icons.Regular.Navigation, if (state.sidebarCollapsed) "サイドバーを開く" else "サイドバーを閉じる", "sidebar-toggle")
                        }
                    }
                    }
                }
                dockedCall?.let { call ->
                    NativeCallDivider(call, callWidth.value)
                    Box(Modifier.width(callWidth).fillMaxHeight()) { NativeCallScreen(state, call, menuBackdrop) }
                }
            }
            if (drag.active) Box(Modifier.align(Alignment.BottomCenter).padding(16.dp).background(LocalInk.current, RoundedCornerShape(10.dp)).padding(12.dp).semantics { liveRegion = LiveRegionMode.Polite }) {
                Label(if (drag.paneBounds.contains(drag.position)) "ここにドロップして分割表示" else "移動先のトークへドロップ", 13, color = if (state.dark) Color.Black else Color.White)
            }
            val menuContent: @Composable () -> Unit = { menu?.let { shown -> key(shown.id) {
                val content: @Composable () -> Unit = {
                ThemedHostMenu(shown, state.mode, state.dark, menuBackdrop,
                    visible = source.hostMenu?.id == shown.id,
                    onDismissFinished = { if (source.hostMenu == null && retainedMenu?.id == shown.id) retainedMenu = null })
                }
                if (state.mode == "apple" && state.nativePanel != null) Popup(properties = PopupProperties(focusable = true), content = content)
                else content()
            } } }
            val foregroundPanel = state.nativePanel ?: state.controllerCall?.takeIf { it !== dockedCall }
            val nestedMiuix = state.mode == "miuix" && foregroundPanel != null && !foregroundPanel.compact
            val panelContent: @Composable (NativePanel) -> Unit = { panel ->
                if (nestedMiuix) MiuixScaffold(modifier = Modifier.fillMaxSize(), containerColor = Color.Transparent,
                    contentWindowInsets = WindowInsets(0, 0, 0, 0)) {
                    // Miuix overlays belong to this foreground window's Scaffold,
                    // not the root Scaffold underneath the Compose Popup.
                    Box(Modifier.fillMaxSize()) {
                        NativePanelScreen(state, panel, menuBackdrop)
                        menuContent()
                        ControllerDialogSurface(state, menuBackdrop)
                    }
                } else NativePanelScreen(state, panel, menuBackdrop)
            }
            if (!nestedMiuix) menuContent()
            state.nativePanel?.let { panel -> key(state.epoch, panel.id) {
                Popup(alignment = if (panel.compact) Alignment.TopEnd else Alignment.TopStart, properties = PopupProperties(focusable = !panel.compact), onDismissRequest = { if (!panel.compact) actionScope("panel-close") }) {
                    Column(Modifier.fillMaxSize()) {
                        state.controllerCall?.takeIf { it.callLayout != "incoming" }?.let { call ->
                            Box(Modifier.align(Alignment.End)) { NativeCallScreen(state, call, menuBackdrop) }
                        }
                        Box(Modifier.weight(1f).fillMaxWidth()) { panelContent(panel) }
                    }
                }
            } }
            state.controllerCall?.takeIf { it !== dockedCall }?.let { call -> key(state.epoch, call.id) {
                if (call.callLayout == "incoming") Popup(alignment = Alignment.TopEnd, properties = PopupProperties(focusable = true)) {
                    Box(Modifier.widthIn(max = 360.dp).padding(12.dp)) { NativeCallScreen(state, call, menuBackdrop) }
                } else if (state.nativePanel == null) {
                    if (call.compact) Box(Modifier.align(Alignment.TopEnd).padding(12.dp)) { NativeCallScreen(state, call, menuBackdrop) }
                    else Popup(properties = PopupProperties(focusable = true)) { panelContent(call) }
                }
            } }
            if (state.mode == "apple" && state.nativePanel != null && state.controllerDialog != null) Popup(properties = PopupProperties(focusable = true)) { ControllerDialogSurface(state, menuBackdrop) }
            else if (!nestedMiuix) ControllerDialogSurface(state, menuBackdrop)
        }
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun SidebarDivider(state: SidebarSnapshot) {
    val action = rememberScopedAction()
    val density = LocalDensity.current.density
    val width by rememberUpdatedState(state.sidebarWidth)
    val focus = remember { FocusRequester() }
    val inputMode = LocalInputModeManager.current
    val focusDivider = {
        inputMode.requestInputMode(InputMode.Keyboard)
        focusComposeCanvas()
        focus.requestFocus()
        Unit
    }
    Box(Modifier.width(6.dp).fillMaxHeight().background(LocalSecondaryInk.current.copy(alpha = .13f))
        .semantics { contentDescription = "サイドバーの幅を調整（ダブルクリックでリセット）"; stateDescription = "${state.sidebarWidth.toInt()}px" }
        .onPreviewKeyEvent { event ->
            if (event.type == KeyEventType.KeyDown && event.key in listOf(Key.DirectionLeft, Key.DirectionRight, Key.MoveHome)) {
                action("sidebar-width", value = (if (event.key == Key.MoveHome) 360.0 else width + if (event.key == Key.DirectionLeft) -16 else 16).toString()); true
            } else false
        }.focusRequester(focus).pointerInput(focus, inputMode) {
            // Double-click recognition delays onClick; arrow keys should work as soon as pressed.
            awaitPointerEventScope {
                while (true) {
                    if (awaitPointerEvent(PointerEventPass.Initial).type == PointerEventType.Press) focusDivider()
                }
            }
        }.combinedClickable(onClick = focusDivider, onDoubleClick = { action("sidebar-width", value = "360") })
        .pointerInput(action, density) {
            var current = 360.0
            detectDragGestures(onDragStart = { current = width }) { pointer, amount ->
                pointer.consume(); current = (current + amount.x / density).coerceIn(260.0, 520.0)
                action("sidebar-width", value = current.toString())
            }
        })
}
