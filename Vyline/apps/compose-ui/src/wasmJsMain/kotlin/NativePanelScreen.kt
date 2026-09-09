@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.combinedClickable
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

@Composable
internal fun NativePanelScreen(state: SidebarSnapshot, panel: NativePanel, backdrop: Backdrop) {
    if (panel.callLayout != null) { NativeCallScreen(state, panel, backdrop); return }
    val action = rememberScopedAction()
    var retained by remember { mutableStateOf<NativePanelConfirmation?>(null) }
    SideEffect { if (panel.confirmation != null) retained = panel.confirmation }
    val background = if (state.dark) Color(0xFF171719) else Color(0xFFF4F5F8)
    Column((if (panel.compact) Modifier.width(310.dp).heightIn(max = 220.dp) else Modifier.fillMaxSize()).background(background).onPreviewKeyEvent {
        if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) {
            action(if (panel.confirmation == null) "panel-close" else "panel-cancel", id = "${panel.id}:close"); true
        } else false
    }.semantics { paneTitle = panel.title; isTraversalGroup = true }) {
        Row(Modifier.widthIn(max = 1100.dp).fillMaxWidth().align(Alignment.CenterHorizontally).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Label(panel.title, 23, FontWeight.SemiBold, modifier = Modifier.weight(1f).semantics { heading() })
            NativeButton(state.mode, "閉じる") { action("panel-close", id = "${panel.id}:close") }
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val wide = maxWidth >= 760.dp
            val navigation = panel.items.firstOrNull { it.kind == "navigation" }
            var navigationOpen by remember(panel.id) { mutableStateOf(false) }
            Row(Modifier.widthIn(max = 1100.dp).fillMaxWidth().fillMaxHeight().align(Alignment.TopCenter)) {
                if (navigation != null && (wide || navigationOpen)) Column(Modifier.width(if (wide) 240.dp else 180.dp).fillMaxHeight().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    navigation.items.forEach { item ->
                        if (item.kind == "navigation-item") Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                            .background(if (item.primary) LocalAccent.current.copy(alpha = .16f) else Color.Transparent)
                            .selectable(item.primary, enabled = !item.disabled, role = Role.Tab) { action("panel-action", id = item.id); navigationOpen = false }
                            .padding(horizontal = 14.dp, vertical = 12.dp)) {
                            Label(item.label, 14, if (item.primary) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (item.primary) LocalAccent.current else LocalInk.current, maxLines = 2)
                        } else NativePanelControl(state, item)
                    }
                }
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    if (!wide && navigation != null) NativeButton(state.mode, navigation.items.firstOrNull { it.primary }?.label ?: "設定カテゴリ", Modifier.padding(horizontal = 16.dp)) { navigationOpen = !navigationOpen }
                    val density = LocalDensity.current.density
                    var contentBounds by remember { mutableStateOf(Rect.Zero) }
                    val category = navigation?.items?.firstOrNull { it.primary }?.id
                    val list = key(panel.id, category) { rememberLazyListState() }
                    CompositionLocalProvider(LocalHtmlViewport provides scrollingHtmlViewport(contentBounds, state.hostMenu == null && state.controllerDialog == null && panel.confirmation == null, list)) {
                    LazyColumn(Modifier.weight(1f).fillMaxWidth().onGloballyPositioned {
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
    val ink = if (item.danger) Color(0xFFFF453A) else LocalInk.current
    when (item.kind) {
        "heading" -> Label(item.label, if (item.size <= 2) 24 else 17, FontWeight.SemiBold,
            modifier = Modifier.padding(top = 6.dp, bottom = 2.dp).semantics { heading() }, maxLines = 3)
        "row" -> {
            val title = item.label.ifBlank { item.items.firstOrNull { it.kind == "text" }?.label.orEmpty() }
            val children = if (item.label.isBlank()) item.items.drop(1) else item.items
            val switch = children.singleOrNull()?.takeIf { it.kind == "toggle" }
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val controlWidth = maxWidth * .48f
                val narrow = maxWidth < 430.dp && switch == null && children.any { it.kind != "text" }
                val summary: @Composable () -> Unit = {
                    Label(title, 15, FontWeight.Medium, maxLines = 4)
                    item.description?.takeIf { it.isNotBlank() }?.let { Label(it, 12, color = LocalSecondaryInk.current, maxLines = 8) }
                }
                val controls: @Composable () -> Unit = {
                    if (switch != null) NativeSwitch(state.mode, switch.value == "true", { action("panel-change", id = switch.id, value = it.toString()) }, title,
                        Modifier.semantics { contentDescription = title }, enabled = !switch.disabled)
                    else FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        children.forEach { NativePanelControl(state, it) }
                    }
                }
                if (narrow) Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { summary(); controls() }
                else Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) { summary() }
                    Box(Modifier.widthIn(max = controlWidth)) { controls() }
                }
            }
        }
        "choice" -> Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
            .background(if (item.value == "true") LocalAccent.current.copy(alpha = .10f) else Color.Transparent)
            .selectable(item.value == "true", enabled = !item.disabled, role = Role.RadioButton) { action("panel-change", id = item.id, value = "true") }
            .semantics { contentDescription = item.label; stateDescription = if (item.value == "true") "選択中" else "未選択" }
            .padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Label(item.label, 15, FontWeight.Medium, maxLines = 2)
                item.description?.let { Label(it, 12, color = LocalSecondaryInk.current, maxLines = 3) }
            }
            Box(Modifier.size(24.dp)) { if (item.value == "true") {
                if (state.mode == "apple") AppleGlyph(AppleSymbol.Checkmark, LocalAccent.current, 24)
                else Glyph(Icons.Regular.Checkmark, LocalAccent.current, 20)
            } }
        }
        "account" -> Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
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
            Box(Modifier.fillMaxWidth().height(7.dp).clip(RoundedCornerShape(4.dp)).background(LocalSecondaryInk.current.copy(alpha = .16f))
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
                        rail = { Box(Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)).background(LocalSecondaryInk.current.copy(alpha = .25f))) },
                        track = { Box(Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)).background(LocalAccent.current)) },
                        thumb = { Box(Modifier.size(26.dp).clip(RoundedCornerShape(13.dp)).background(Color.White)) })
                }
            }
        }
        "portal" -> ControllerMediaPortal(item.value)
        "strip" -> Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            item.items.forEach { child -> Box(Modifier.widthIn(max = 140.dp)) { NativePanelControl(state, child) } }
        }
        "scene" -> NativeStickerScene(item)
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
                    if (index > 0 && child.kind == "row" && item.items[index - 1].kind == "row") Box(Modifier.fillMaxWidth().height(1.dp).background(LocalSecondaryInk.current.copy(alpha = .12f)))
                    NativePanelControl(state, child)
                } }
            } }
            when (state.mode) {
                "miuix" -> MiuixCard(Modifier.fillMaxWidth(), insideMargin = PaddingValues(0.dp)) { content() }
                "fluent" -> FluentCard(Modifier.fillMaxWidth(), content = content)
                else -> Box(Modifier.fillMaxWidth().clip(RoundedRectangle(22.dp)).background(if (state.dark) Color(0xFF28282C) else Color.White)) { content() }
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
                ControllerImage(item.url, "", if (item.largeImage) Modifier.fillMaxWidth().heightIn(max = 360.dp) else Modifier.size(80.dp))
                if (item.showLabel) Label(item.label, 11, maxLines = 2)
            }
        } else CompositionLocalProvider(LocalAccent provides if (item.danger) ink else LocalAccent.current) {
            NativeButton(state.mode, item.label, enabled = !item.disabled, primary = item.primary) { action("panel-action", id = item.id) }
        }
        "input" -> {
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
                else -> BasicTextField(input, changed, modifier.clip(RoundedCornerShape(12.dp)).background(LocalSecondaryInk.current.copy(alpha = .10f)).padding(12.dp),
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
            Label(item.label, 15, maxLines = 2)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                item.options.forEach { option -> NativeButton(state.mode, option.label, enabled = !item.disabled, primary = item.value == option.value) { action("panel-change", id = item.id, value = option.value) } }
            }
        }
        "image" -> {
            var expanded by remember(item.id) { mutableStateOf(false) }
            item.url?.let { ControllerImage(it, item.label, Modifier.fillMaxWidth().heightIn(max = 360.dp).clip(RoundedRectangle(16.dp))
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
        else -> Label(item.label, 15, color = ink, maxLines = 20, modifier = Modifier.semantics { if (item.live) liveRegion = LiveRegionMode.Polite })
    }
    item.description?.takeIf { it.isNotBlank() && item.kind !in listOf("avatar", "row", "choice", "account") }?.let { Label(it, 12, color = LocalSecondaryInk.current, maxLines = 10) }
}

@Composable
internal fun ControllerDialogSurface(state: SidebarSnapshot, backdrop: Backdrop) {
    val action = rememberScopedAction()
    var retained by remember(state.epoch) { mutableStateOf<ControllerDialog?>(null) }
    SideEffect { if (state.controllerDialog != null) retained = state.controllerDialog }
    retained?.let { dialog -> key(dialog.id) {
        var input by remember { mutableStateOf(dialog.value) }
        val dismiss = { action("controller-dialog-cancel", id = dialog.id) }
        MessageActionSurface(state, MessagePanel.Edit, state.controllerDialog?.id == dialog.id, backdrop, dismiss,
            onDismissFinished = { retained = null }, titleOverride = "確認") {
            val focus = rememberNativeModalFocus(if (dialog.prompt) listOf("input", "accept", "cancel") else listOf("accept", "cancel"), dialog.id)
            Column(Modifier.fillMaxWidth().onPreviewKeyEvent { focus.cycle(it) }, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Label(dialog.text, 16, maxLines = 12)
                if (dialog.prompt) {
                    val modifier = focus.control("input").fillMaxWidth().semantics { contentDescription = "入力" }
                    when (state.mode) {
                        "miuix" -> MiuixTextField(input, { input = it }, modifier, label = "入力")
                        "fluent" -> FluentTextField(input, { input = it }, modifier)
                        else -> BasicTextField(input, { input = it }, modifier.background(LocalSecondaryInk.current.copy(alpha = .12f)).padding(12.dp),
                            textStyle = TextStyle(color = LocalInk.current, fontSize = 16.sp), cursorBrush = SolidColor(LocalAccent.current))
                    }
                }
                NativeButton(state.mode, "実行", focus.control("accept").fillMaxWidth(), primary = true) { action("controller-dialog-accept", id = dialog.id, value = input) }
                NativeButton(state.mode, "キャンセル", focus.control("cancel").fillMaxWidth(), onClick = dismiss)
            }
        }
    } }
}
