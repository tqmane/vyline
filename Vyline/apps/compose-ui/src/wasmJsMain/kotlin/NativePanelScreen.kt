@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.onPointerEvent
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import com.kyant.backdrop.Backdrop
import com.kyant.shapes.RoundedRectangle
import io.github.composefluent.component.Switcher
import io.github.composefluent.component.TextField as FluentTextField
import io.github.composefluent.surface.Card as FluentCard
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.TextField as MiuixTextField
import top.yukonga.miuix.kmp.basic.Switch as MiuixSwitch
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.Checkmark
import kotlin.math.roundToInt
import top.yukonga.miuix.kmp.basic.NavigationRail
import top.yukonga.miuix.kmp.basic.NavigationRailItem
import top.yukonga.miuix.kmp.basic.NavigationRailValue
import top.yukonga.miuix.kmp.basic.rememberNavigationRailState

/** Fluent distinguishes 4dp controls from 8dp cards; Apple and Miuix retain softer groups. */
internal fun nativePanelShape(mode: String, control: Boolean = false): androidx.compose.ui.graphics.Shape = when (mode) {
    "fluent" -> RoundedCornerShape(if (control) 4.dp else 8.dp)
    "miuix" -> RoundedCornerShape(if (control) 12.dp else 24.dp)
    else -> RoundedRectangle(if (control) 12.dp else 24.dp)
}

@Composable
internal fun NativePanelScreen(state: SidebarSnapshot, panel: NativePanel, backdrop: Backdrop) {
    if (panel.callLayout != null) { NativeCallScreen(state, panel); return }
    val action = rememberScopedAction()
    var retained by remember { mutableStateOf<NativePanelConfirmation?>(null) }
    SideEffect { if (panel.confirmation != null) retained = panel.confirmation }
    val colors = LocalRendererColors.current
    val navigation = panel.items.firstOrNull { it.kind == "navigation" }
    if (state.mode == "fluent" && navigation != null) FluentSettingsPanel(state, panel, navigation)
    else Column((if (panel.compact) Modifier.width(310.dp).heightIn(max = 220.dp) else Modifier.fillMaxSize()).background(if (state.mode == "apple") colors.canvas.copy(alpha = .72f) else colors.canvas).onPreviewKeyEvent {
        if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) {
            action(if (panel.confirmation == null) "panel-close" else "panel-cancel", id = "${panel.id}:close"); true
        } else false
    }.semantics { paneTitle = panel.title; isTraversalGroup = true }) {
        val focus = rememberNativeModalFocus(listOf("close"), panel.id)
        Row(Modifier.widthIn(max = 1100.dp).fillMaxWidth().align(Alignment.CenterHorizontally).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Label(panel.title, if (panel.presentation != null) 18 else 23, FontWeight.SemiBold, modifier = Modifier.weight(1f).semantics { heading() })
            NativeButton(state.mode, "閉じる", focus.control("close")) { action("panel-close", id = "${panel.id}:close") }
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val wide = maxWidth >= 760.dp
            var navigationOpen by remember(panel.id) { mutableStateOf(wide) }
            LaunchedEffect(wide) { navigationOpen = wide }
            Row(Modifier.widthIn(max = 1100.dp).fillMaxWidth().fillMaxHeight().align(Alignment.TopCenter)) {
                if (navigation != null && state.mode == "apple") {
                    AppleSettingsNavigation(state, navigation, backdrop, navigationOpen, { navigationOpen = !navigationOpen }) { if (!wide) navigationOpen = false }
                } else if (navigation != null && state.mode == "miuix") {
                    val rail = rememberNavigationRailState(initialValue = if (wide) NavigationRailValue.Expanded else NavigationRailValue.Collapsed)
                    LaunchedEffect(wide, navigationOpen) { if (wide || navigationOpen) rail.expand() else rail.collapse() }
                    NavigationRail(state = rail, color = colors.sidebar, defaultWindowInsetsPadding = false) {
                        navigation.items.filter { it.kind == "navigation-item" }.forEach { item ->
                            NavigationRailItem(selected = item.primary, onClick = { action("panel-action", id = item.id); navigationOpen = false },
                                icon = fluentSettingsIcon(item.symbol), label = item.label, enabled = !item.disabled)
                        }
                        navigation.items.filter { it.kind != "navigation-item" }.forEach { item ->
                            Box(Modifier.widthIn(max = 220.dp).padding(8.dp)) { NativePanelControl(state, item) }
                        }
                    }
                } else if (navigation != null && (wide || navigationOpen)) Column(Modifier.width(if (wide) 240.dp else 180.dp).fillMaxHeight().background(colors.sidebar.copy(alpha = .65f)).verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    navigation.items.forEach { item ->
                        if (item.kind == "navigation-item") Row(Modifier.fillMaxWidth().clip(nativePanelShape(state.mode, control = true))
                            .background(if (item.primary) colors.selected else Color.Transparent)
                            .selectable(item.primary, enabled = !item.disabled, role = Role.Tab) { action("panel-action", id = item.id); navigationOpen = false }
                            .padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (state.mode == "apple") AppleGlyph(appleSettingsSymbol(item.symbol), if (item.primary) colors.selectedText else colors.accentText, 22)
                            else Glyph(fluentSettingsIcon(item.symbol), if (item.primary) colors.selectedText else colors.accentText, 22)
                            Label(item.label, 14, if (item.primary) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (item.disabled) colors.disabled else if (item.primary) colors.selectedText else colors.text, maxLines = 2)
                        } else NativePanelControl(state, item)
                    }
                }
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    if (!wide && navigation != null && state.mode != "apple") NativeButton(state.mode, navigation.items.firstOrNull { it.primary }?.label ?: "設定カテゴリ", Modifier.padding(horizontal = 16.dp)) { navigationOpen = !navigationOpen }
                    val density = LocalDensity.current.density
                    var contentBounds by remember { mutableStateOf(Rect.Zero) }
                    val category = navigation?.items?.firstOrNull { it.primary }?.id
                    val list = key(panel.id, category) { rememberLazyListState() }
                    CompositionLocalProvider(LocalHtmlViewport provides scrollingHtmlViewport(contentBounds, state.hostMenu == null && state.controllerDialog == null && panel.confirmation == null, list)) {
                    LazyColumn(Modifier.weight(1f).fillMaxWidth().clipToBounds().onGloballyPositioned {
                        val rect = it.boundsInWindow(); contentBounds = Rect(rect.left / density, rect.top / density, rect.right / density, rect.bottom / density)
                    },
                        state = list, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(panel.items.filter { it.kind != "navigation" }, key = { it.id }) { item -> NativePanelControl(state, item) }
                    }
                    }
                }
            }
        }
    }
    retained?.let { confirmation ->
        MessageActionSurface(state, MessagePanel.Revoke, panel.confirmation != null, backdrop,
            onDismissRequest = { action("panel-cancel") }, onDismissFinished = { retained = null }, titleOverride = "確認") {
            Label(confirmation.text, 16, maxLines = 8)
            NativeButton(state.mode, "実行", Modifier.fillMaxWidth(), primary = true) { action("panel-confirm", id = confirmation.id) }
            NativeButton(state.mode, "キャンセル", Modifier.fillMaxWidth()) { action("panel-cancel") }
        }
    }
}

@Composable
internal fun NativePanelControl(state: SidebarSnapshot, item: NativePanelItem) {
    val action = rememberScopedAction()
    val colors = LocalRendererColors.current
    val ink = if (item.disabled) colors.disabled else if (item.danger) colors.danger else colors.text
    when (item.kind) {
        "heading" -> Label(item.label, if (item.size <= 2) 24 else 17, FontWeight.SemiBold,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 2.dp).semantics { heading() }, maxLines = 3)
        "avatar-image" -> Avatar(ConversationRow(item.id, item.label, avatar = item.value, color = item.color, avatarUrl = item.url), item.size.coerceIn(24, 96))
        "profile-summary" -> Column(Modifier.fillMaxWidth().clip(nativePanelShape(state.mode)).background(colors.surface)) {
            Box(Modifier.fillMaxWidth().height(128.dp).background(LocalAccent.current.copy(alpha = .20f))) {
                item.backgroundUrl?.let { ControllerImage(it, "プロフィールの背景", Modifier.matchParentSize(), ContentScale.Crop) }
            }
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Box(Modifier.size(72.dp).semantics { role = Role.Image; contentDescription = "${item.label}のアイコン" }) {
                    Avatar(ConversationRow(item.id, item.label, avatar = item.value, avatarUrl = item.url), 72)
                }
                Label(item.label, 20, FontWeight.SemiBold, modifier = Modifier.weight(1f), maxLines = 3)
            }
            FlowRow(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item.items.forEach { NativePanelControl(state, it) }
            }
        }
        "link" -> Row(Modifier.fillMaxWidth().clip(nativePanelShape(state.mode, control = true))
            .clickable(enabled = !item.disabled, role = Role.Button) { action("panel-action", id = item.id) }
            .semantics { contentDescription = item.label }.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            item.url?.let { ControllerImage(it, "", Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)), ContentScale.Crop) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Label(item.label, 15, FontWeight.Medium, modifier = Modifier.fillMaxWidth(), maxLines = 4)
                item.description?.let { Label(it, 12, color = LocalSecondaryInk.current, modifier = Modifier.fillMaxWidth(), maxLines = 4) }
            }
            Label("↗", 18, color = LocalAccent.current)
        }
        "row" -> {
            val titleItem = item.items.firstOrNull { it.kind == "text" }
            val title = item.label.ifBlank { titleItem?.label.orEmpty() }
            val avatar = item.items.firstOrNull { it.kind == "avatar-image" }
            val children = item.items.filter { it !== avatar && (item.label.isNotBlank() || it !== titleItem) }
            val switch = children.singleOrNull()?.takeIf { it.kind == "toggle" }
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val controlWidth = maxWidth * .48f
                val narrow = maxWidth < 430.dp && switch == null && children.any { it.kind != "text" }
                val summary: @Composable () -> Unit = {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        avatar?.let { NativePanelControl(state, it) }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Label(title, 15, FontWeight.Medium, modifier = Modifier.fillMaxWidth(), maxLines = 4)
                            item.description?.takeIf { it.isNotBlank() }?.let { Label(it, 12, color = LocalSecondaryInk.current, maxLines = 8) }
                        }
                    }
                }
                val controls: @Composable () -> Unit = {
                    if (switch != null) NativeSwitch(state.mode, switch.value == "true", { action("panel-change", id = switch.id, value = it.toString()) }, title,
                        Modifier.semantics { contentDescription = title }, enabled = !switch.disabled)
                    else FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        children.forEach { NativePanelControl(state, if (it.kind == "select") it.copy(showLabel = false) else it) }
                    }
                }
                if (narrow) Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { summary(); controls() }
                else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) { summary() }
                    Box(Modifier.widthIn(max = controlWidth)) { controls() }
                }
            }
        }
        "choice" -> Row(Modifier.fillMaxWidth().clip(nativePanelShape(state.mode, control = true))
            .background(if (item.value == "true") colors.selected else Color.Transparent)
            .selectable(item.value == "true", enabled = !item.disabled, role = Role.RadioButton) { action("panel-change", id = item.id, value = "true") }
            .semantics { contentDescription = item.label; stateDescription = if (item.value == "true") "選択中" else "未選択" }
            .padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Label(item.label, 15, FontWeight.Medium, color = if (item.disabled) colors.disabled else if (item.value == "true") colors.selectedText else ink, maxLines = 2)
                item.description?.let { Label(it, 12, color = if (item.disabled) colors.disabled else if (item.value == "true") colors.selectedSecondary else colors.secondary, maxLines = 3) }
            }
            Box(Modifier.size(24.dp)) { if (item.value == "true") {
                val checkInk = if (item.disabled) colors.disabled else colors.selectedText
                if (state.mode == "apple") AppleGlyph(AppleSymbol.Checkmark, checkInk, 24)
                else Glyph(Icons.Regular.Checkmark, checkInk, 20)
            } }
        }
        "account" -> Row(Modifier.fillMaxWidth().clip(nativePanelShape(state.mode, control = true))
            .clickable(enabled = !item.disabled, role = Role.Button) { action("panel-action", id = item.id) }
            .semantics { contentDescription = item.label }.padding(8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(ConversationRow(item.id, item.label, avatar = item.label.take(1), avatarUrl = item.url), 34)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Label(item.label, 14, FontWeight.Medium, maxLines = 2)
                item.description?.let { Label(it, 11, color = LocalSecondaryInk.current, maxLines = 2) }
            }
        }
        "progress" -> {
            val fraction = ((item.value.toFloatOrNull() ?: 0f) / item.maximum.coerceAtLeast(1f)).coerceIn(0f, 1f)
            Box(Modifier.fillMaxWidth().height(7.dp).clip(RoundedCornerShape(4.dp)).background(colors.separator)
                .semantics { contentDescription = item.label; progressBarRangeInfo = ProgressBarRangeInfo(fraction, 0f..1f) }) {
                Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().background(LocalAccent.current))
            }
        }
        "slider" -> {
            val range = item.minimum..item.maximum.coerceAtLeast(item.minimum + .001f)
            val increment = item.step.coerceAtLeast(.001f)
            var value by remember(item.id, item.value) { mutableFloatStateOf((item.value.toFloatOrNull() ?: range.start).coerceIn(range)) }
            val change: (Float) -> Unit = { next ->
                value = (range.start + ((next - range.start) / increment).roundToInt() * increment).coerceIn(range)
                action("panel-change", id = item.id, value = value.toString())
            }
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (item.showLabel) Label(item.label, 15)
                val control = Modifier.fillMaxWidth().heightIn(min = 44.dp).onPreviewKeyEvent {
                    if (!item.disabled && it.type == KeyEventType.KeyDown && it.key in listOf(Key.DirectionLeft, Key.DirectionRight)) {
                        change(value + if (it.key == Key.DirectionRight) increment else -increment); true
                    } else false
                }.semantics { contentDescription = item.label; progressBarRangeInfo = ProgressBarRangeInfo(value, range)
                    setProgress { if (!item.disabled) change(it); !item.disabled } }.focusable(!item.disabled)
                val steps = (((range.endInclusive - range.start) / increment).roundToInt() - 1).coerceIn(0, 1000)
                when (state.mode) {
                    "fluent" -> io.github.composefluent.component.Slider(value, change, control, enabled = !item.disabled, valueRange = range, steps = steps)
                    "miuix" -> top.yukonga.miuix.kmp.basic.Slider(value, change, control, enabled = !item.disabled, valueRange = range, steps = steps)
                    else -> io.github.composefluent.component.BasicSlider(value, change, control, enabled = !item.disabled, valueRange = range, steps = steps,
                        rail = { io.github.composefluent.component.SliderDefaults.Rail(it, enabled = !item.disabled, showTick = false, color = LocalSecondaryInk.current.copy(alpha = .25f), disabledColor = LocalSecondaryInk.current.copy(alpha = .15f), border = null) },
                        track = { io.github.composefluent.component.SliderDefaults.Track(it, enabled = !item.disabled, color = LocalAccent.current, disabledColor = LocalSecondaryInk.current) },
                        thumb = { io.github.composefluent.component.SliderDefaults.Thumb(it, label = {}, enabled = !item.disabled, border = null, ringColor = Color.White, color = Color.White, draggingColor = Color.White, disabledColor = LocalSecondaryInk.current) })
                }
            }
        }
        "portal" -> ControllerMediaPortal(item.value)
        "sticker-tabs" -> Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).semantics { contentDescription = "スタンプのタブ" },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            item.items.filter { it.kind == "button" }.forEach { tab ->
                Box(Modifier.heightIn(min = 44.dp).clip(nativePanelShape(state.mode, control = true))
                    .background(if (tab.primary) colors.selected else Color.Transparent)
                    .selectable(tab.primary, role = Role.Tab, enabled = !tab.disabled) { action("panel-action", id = tab.id) }
                    .padding(horizontal = 10.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
                    Label(tab.label, 14, FontWeight.Medium, color = if (tab.primary) colors.selectedText else colors.secondary)
                }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                Label(item.items.filter { it.kind == "text" }.joinToString(" ") { it.label }, 11, color = colors.secondary, maxLines = 2)
            }
        }
        "sticker-packs" -> Column(Modifier.fillMaxWidth().semantics { contentDescription = "スタンプパック" }) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                item.items.forEach { pack ->
                    Box(Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).background(if (pack.primary) colors.selected.copy(alpha = .35f) else Color.Transparent)
                        .border(1.dp, if (pack.primary) colors.accent else Color.Transparent, RoundedCornerShape(10.dp))
                        .clickable(enabled = !pack.disabled, role = Role.Button) { action("panel-action", id = pack.id) }
                        .semantics { contentDescription = pack.label; selected = pack.primary }, contentAlignment = Alignment.Center) {
                        pack.url?.let { ControllerImage(it, "", Modifier.size(28.dp), ContentScale.Fit) }
                    }
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(colors.separator).semantics { contentDescription = "パックとスタンプの区切り" })
        }
        "strip" -> Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            item.items.forEach { child -> Box(Modifier.widthIn(max = 140.dp)) { NativePanelControl(state, child) } }
        }
        "scene" -> NativeStickerScene(item)
        "tool-grid" -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item.items.chunked(2).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { tool ->
                        Column(Modifier.weight(1f).clip(nativePanelShape(state.mode)).background(colors.surface)
                            .clickable(enabled = !tool.disabled, role = Role.Button) { action("panel-action", id = tool.id) }
                            .semantics { contentDescription = tool.label; if (tool.disabled) disabled() }
                            .padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            val tint = if (tool.disabled) colors.disabled else colors.accentText
                            if (state.mode == "apple") AppleGlyph(when (tool.symbol) { "reject" -> AppleSymbol.Lock; "album" -> AppleSymbol.Photo; "note" -> AppleSymbol.Compose; "ladder" -> AppleSymbol.Filter; "poll" -> AppleSymbol.Chart; else -> AppleSymbol.Calendar }, tint, 28)
                            else Glyph(fluentSettingsIcon(when (tool.symbol) { "reject" -> "settings-privacy"; "album" -> "settings-display"; "note" -> "settings-storage"; else -> "settings-theme" }), tint, 28)
                            Label(tool.label, 14, color = if (tool.disabled) colors.disabled else colors.text, maxLines = 2)
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        "grid" -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item.items.forEach { child -> Box(Modifier.width(96.dp)) { NativePanelControl(state, child) } }
        }
        "avatar" -> Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(ConversationRow(item.id, item.label, avatar = item.value, color = item.color, avatarUrl = item.url), item.size.coerceIn(32, 128))
            Label(item.label, if (item.size <= 64) 14 else 24, FontWeight.Bold, maxLines = 2)
            item.description?.let { Label(it, 12, color = LocalSecondaryInk.current, maxLines = 2) }
        }
        "section" -> Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (item.label.isNotBlank()) Label(item.label, 13, FontWeight.SemiBold, color = LocalSecondaryInk.current, modifier = Modifier.padding(start = 8.dp).semantics { heading() })
            val content: @Composable () -> Unit = { Column(Modifier.fillMaxWidth().selectableGroup().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item.items.forEachIndexed { index, child -> key(child.id) {
                    if (index > 0 && child.kind == "row" && item.items[index - 1].kind == "row") Box(Modifier.fillMaxWidth().height(1.dp).background(LocalRendererColors.current.separator))
                    NativePanelControl(state, child)
                } }
            } }
            when (state.mode) {
                "miuix" -> MiuixCard(Modifier.fillMaxWidth(), insideMargin = PaddingValues(0.dp)) { content() }
                "fluent" -> FluentCard(Modifier.fillMaxWidth(), shape = nativePanelShape(state.mode), content = content)
                else -> Box(Modifier.fillMaxWidth().clip(nativePanelShape(state.mode)).background(colors.surface)) { content() }
            }
        }
        "button" -> if (item.url != null) {
            val density = LocalDensity.current.density
            var bounds by remember { mutableStateOf(Rect.Zero) }
            val secondary = { action("panel-secondary", id = item.id, x = bounds.center.x / density, y = bounds.center.y / density) }
            Column(Modifier.fillMaxWidth().onGloballyPositioned { bounds = it.boundsInWindow() }
                .combinedClickable(enabled = !item.disabled, role = Role.Button, onClick = { action("panel-action", id = item.id) }, onLongClick = if (item.secondary) secondary else null)
                .onPointerEvent(PointerEventType.Press) { if (item.secondary && it.buttons.isSecondaryPressed) secondary() }.padding(8.dp)
                .semantics { contentDescription = item.label }, horizontalAlignment = Alignment.CenterHorizontally) {
                ControllerImage(item.url, "", if (item.largeImage) Modifier.fillMaxWidth().heightIn(min = 80.dp, max = 360.dp) else Modifier.size(80.dp))
                if (item.showLabel) Label(item.label, 11, maxLines = 2)
            }
        } else NativeButton(state.mode, item.label, enabled = !item.disabled, primary = item.primary, danger = item.danger) { action("panel-action", id = item.id) }
        "input" -> {
            if (item.showLabel) Label(item.label, 14, modifier = Modifier.fillMaxWidth(), maxLines = 3)
            var input by remember(item.id) { mutableStateOf(TextFieldValue(item.value)) }
            var pending by remember(item.id) { mutableStateOf<String?>(null) }
            LaunchedEffect(item.value) {
                if (pending == null || pending == item.value) {
                    pending = null
                    if (input.text != item.value) input = TextFieldValue(item.value, TextRange(input.selection.start.coerceAtMost(item.value.length)))
                }
            }
            val changed: (TextFieldValue) -> Unit = {
                val textChanged = input.text != it.text
                input = it
                if (textChanged) { pending = it.text; action("panel-change", id = item.id, value = it.text) }
                action("panel-selection", id = item.id, selectionStart = it.selection.min, selectionEnd = it.selection.max)
            }
            val transformation = if (item.secret) PasswordVisualTransformation() else VisualTransformation.None
            val modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).semantics { contentDescription = item.label }
            when (state.mode) {
                "miuix" -> MiuixTextField(input, changed, modifier, label = item.label, useLabelAsPlaceholder = true, singleLine = !item.multiline, maxLines = if (item.multiline) 8 else 1, enabled = !item.disabled, readOnly = item.readOnly, visualTransformation = transformation)
                "fluent" -> FluentTextField(input, changed, modifier, placeholder = { Label(item.label, 14) }, singleLine = !item.multiline, maxLines = if (item.multiline) 8 else 1, enabled = !item.disabled, readOnly = item.readOnly, visualTransformation = transformation)
                else -> BasicTextField(input, changed, modifier.clip(nativePanelShape(state.mode, control = true)).background(colors.input).padding(12.dp),
                    textStyle = TextStyle(color = ink, fontSize = 16.sp), cursorBrush = SolidColor(LocalAccent.current), enabled = !item.disabled,
                    singleLine = !item.multiline, maxLines = if (item.multiline) 8 else 1, readOnly = item.readOnly, visualTransformation = transformation, decorationBox = { text -> Box { if (input.text.isEmpty()) Label(item.label, 16, color = LocalSecondaryInk.current); text() } })
            }
        }
        "toggle" -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Label(item.label, 15, modifier = Modifier.weight(1f), maxLines = 3)
            val changed: (Boolean) -> Unit = { action("panel-change", id = item.id, value = it.toString()) }
            val control = Modifier.semantics { contentDescription = item.label }
            NativeSwitch(state.mode, item.value == "true", changed, item.label, control, enabled = !item.disabled)
        }
        "select" -> {
            if (item.showLabel) Label(item.label, 15, modifier = Modifier.fillMaxWidth(), maxLines = 2)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                item.options.forEach { option -> NativeButton(state.mode, option.label, enabled = !item.disabled, primary = item.value == option.value) { action("panel-change", id = item.id, value = option.value) } }
            }
        }
        "image" -> {
            var expanded by remember(item.id) { mutableStateOf(false) }
            item.url?.let { ControllerImage(it, item.label, Modifier.fillMaxWidth().heightIn(min = 80.dp, max = 360.dp).clip(RoundedRectangle(16.dp))
                .clickable(role = Role.Button) { expanded = true }) }
            if (expanded) Popup(properties = PopupProperties(focusable = true), onDismissRequest = { expanded = false }) {
                CompositionLocalProvider(LocalHtmlViewport provides HtmlViewport()) {
                    MediaViewer(ChatMessage(item.id, "", kind = "image", mediaUrl = item.url, fileName = item.label), state.mode) { expanded = false }
                }
            }
        }
        "media" -> if (item.mediaId != null) ControllerStream(item) else item.url?.let { url ->
            ClippedHtmlElementView(factory = {
                (kotlinx.browser.document.createElement(if (item.value == "video") "video" else "audio") as org.w3c.dom.HTMLMediaElement).apply {
                    src = safeMediaUrl(url); controls = true; autoplay = item.autoplay; style.width = "100%"; style.height = "100%"
                }
            }, modifier = Modifier.fillMaxWidth().height(if (item.value == "video") 240.dp else 54.dp), onRelease = { it.pause(); it.removeAttribute("src"); it.load() })
        }
        else -> Label(item.label, 15, color = ink, maxLines = Int.MAX_VALUE, modifier = Modifier.fillMaxWidth().semantics { if (item.live) liveRegion = LiveRegionMode.Polite })
    }
    item.description?.takeIf { it.isNotBlank() && item.kind !in listOf("avatar", "row", "choice", "account", "link") }?.let { Label(it, 12, color = LocalSecondaryInk.current, modifier = Modifier.fillMaxWidth(), maxLines = Int.MAX_VALUE) }
}

@Composable
internal fun ControllerDialogSurface(state: SidebarSnapshot, backdrop: Backdrop, visible: Boolean, onDismissFinished: () -> Unit) {
    val action = rememberScopedAction()
    state.controllerDialog?.let { dialog -> key(dialog.id) {
        var input by remember { mutableStateOf(dialog.value) }
        val dismiss = { action("controller-dialog-cancel", id = dialog.id) }
        MessageActionSurface(state, MessagePanel.Edit, visible, backdrop, dismiss,
            onDismissFinished = onDismissFinished, titleOverride = dialog.title ?: "確認") {
            val keys = if (dialog.prompt) listOf("input", "accept", "cancel") else if (dialog.cancelFirst) listOf("cancel", "accept") else listOf("accept", "cancel")
            val focus = rememberNativeModalFocus(keys, dialog.id)
            Column(Modifier.fillMaxWidth().onPreviewKeyEvent { focus.cycle(it) }, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                dialog.title?.let { Label(it, 18, FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) }
                Label(dialog.text, 16, maxLines = 12)
                if (dialog.prompt) {
                    val modifier = focus.control("input").fillMaxWidth().semantics { contentDescription = "入力" }
                    when (state.mode) {
                        "miuix" -> MiuixTextField(input, { input = it }, modifier, label = "入力")
                        "fluent" -> FluentTextField(input, { input = it }, modifier)
                        else -> BasicTextField(input, { input = it }, modifier.clip(nativePanelShape(state.mode, control = true)).background(LocalRendererColors.current.input).padding(12.dp),
                            textStyle = TextStyle(color = LocalInk.current, fontSize = 16.sp), cursorBrush = SolidColor(LocalAccent.current))
                    }
                }
                NativeButton(state.mode, dialog.acceptLabel ?: "実行", focus.control("accept").fillMaxWidth(), primary = true) { action("controller-dialog-accept", id = dialog.id, value = input) }
                NativeButton(state.mode, "キャンセル", focus.control("cancel").fillMaxWidth(), onClick = dismiss)
            }
        }
    } }
}

internal fun appleSettingsSymbol(symbol: String?): AppleSymbol = when (symbol) {
    "settings-profile" -> AppleSymbol.Person
    "settings-subdevices" -> AppleSymbol.Devices
    "settings-read" -> AppleSymbol.Checkmark
    "settings-display" -> AppleSymbol.Photo
    "settings-theme" -> AppleSymbol.Palette
    "settings-notifications" -> AppleSymbol.Bell
    "settings-storage" -> AppleSymbol.Storage
    "settings-handoff" -> AppleSymbol.Refresh
    "settings-recordings" -> AppleSymbol.Waveform
    "settings-privacy" -> AppleSymbol.Lock
    "settings-plugins" -> AppleSymbol.Plugins
    "settings-info" -> AppleSymbol.Info
    else -> AppleSymbol.Settings
}

@Composable
private fun AppleSettingsNavigation(state: SidebarSnapshot, navigation: NativePanelItem, backdrop: Backdrop,
    expanded: Boolean, toggle: () -> Unit, selectedCategory: () -> Unit) {
    val colors = LocalRendererColors.current
    val action = rememberScopedAction()
    val shape = RoundedRectangle(22.dp)
    val motion = rememberAppleLiquidMotion(enabled = false, reducedMotion = state.reducedMotion)
    Column(Modifier.width(if (expanded) 240.dp else 76.dp).fillMaxHeight().padding(start = 8.dp, end = 6.dp, bottom = 8.dp)
        .appleLiquidBackdrop(motion, backdrop, { shape }, colors.sidebar.copy(alpha = .75f), blurRadius = 18.dp)
        .clip(shape).semantics { contentDescription = "設定サイドバー" }) {
        Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.CenterStart) {
            AppleGlassIcon(backdrop, AppleSymbol.Sidebar, if (expanded) "設定サイドバーを閉じる" else "設定サイドバーを開く", dark = state.dark, onClick = toggle)
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 6.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            navigation.items.forEach { item ->
                if (item.kind == "navigation-item") {
                    val ink = if (item.disabled) colors.disabled else if (item.primary) colors.selectedText else colors.text
                    val modifier = Modifier.fillMaxWidth().clip(RoundedRectangle(12.dp)).background(if (item.primary) colors.selected else Color.Transparent)
                        .selectable(item.primary, enabled = !item.disabled, role = Role.Tab) { action("panel-action", id = item.id); selectedCategory() }
                        .semantics { contentDescription = item.label }
                    if (expanded) Row(modifier.heightIn(min = 44.dp).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        AppleGlyph(appleSettingsSymbol(item.symbol), if (item.primary) ink else colors.accentText, 22)
                        Label(item.label, 14, color = ink, maxLines = 2)
                    } else Column(modifier.padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        AppleGlyph(appleSettingsSymbol(item.symbol), if (item.primary) ink else colors.accentText, 22)
                        Label(item.label, 9, color = ink, maxLines = 2)
                    }
                } else if (expanded) NativePanelControl(state, item)
            }
        }
    }
}
