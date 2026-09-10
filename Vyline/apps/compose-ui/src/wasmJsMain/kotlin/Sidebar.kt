@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class, io.github.composefluent.ExperimentalFluentApi::class)

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitLongPressOrCancellation
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import com.kyant.shapes.RoundedRectangle
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.isPrimaryPressed
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.onPointerEvent
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import io.github.composefluent.component.ListItem as FluentListItem
import io.github.composefluent.component.SideNavItem
import io.github.composefluent.component.SubtleButton as FluentButton
import io.github.composefluent.component.TextField as FluentTextField
import io.github.composefluent.icons.Icons as FluentIcons
import io.github.composefluent.icons.regular.*
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.IconButton as MiuixIconButton
import top.yukonga.miuix.kmp.basic.NavigationBarItem
import top.yukonga.miuix.kmp.basic.TextField as MiuixTextField
import top.yukonga.miuix.kmp.basic.TopAppBar as MiuixTopAppBar
import top.yukonga.miuix.kmp.utils.PressFeedbackType

internal class ChatListDrag {
    var source: String? = null
    var start = Offset.Zero
    var position by mutableStateOf(Offset.Zero)
    var active by mutableStateOf(false)
    var split = false
    var paneBounds = Rect.Zero
    val rowBounds = mutableMapOf<String, Rect>()
    fun reset() { source = null; active = false }
    fun drop(action: UiActionScope, customOrder: Boolean) {
        val id = source ?: return
        if (active) {
            if (split && paneBounds.contains(position)) action("drop-chat", id = id,
                x = ((position.x - paneBounds.left) / paneBounds.width).coerceIn(0f, 1f),
                y = ((position.y - paneBounds.top) / paneBounds.height).coerceIn(0f, 1f))
            else if (customOrder) rowBounds.entries.firstOrNull { it.key != id && it.value.contains(position) }?.let {
                action("reorder-chat", id = id, value = it.key)
            }
        }
        reset()
    }
}
internal val LocalChatListDrag = staticCompositionLocalOf { ChatListDrag() }

@Composable
fun Sidebar(state: SidebarSnapshot, compact: Boolean = false) {
    val action = rememberScopedAction()
    Column(Modifier.fillMaxSize()) {
        if (state.splitPick) Row(Modifier.fillMaxWidth().background(LocalAccent.current.copy(alpha = .09f)).padding(10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Label("分割表示するトークを選択", 13, FontWeight.Medium, modifier = Modifier.weight(1f), maxLines = 2)
            NativeButton(state.mode, "キャンセル") { action("back") }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) { SidebarContent(state, compact) }
    }
}

@Composable
private fun SidebarContent(state: SidebarSnapshot, compact: Boolean) {
    when (state.mode) {
        "fluent" -> FluentSidebar(state, compact)
        "miuix" -> MiuixSidebar(state)
        else -> if (compact) ApplePhoneSidebar(state) else AppleSidebar(state)
    }
}

@Composable
private fun AppleSidebar(state: SidebarSnapshot) {
    var filters by remember { mutableStateOf(false) }
    val backdrop = rememberLayerBackdrop()
    val colors = LocalRendererColors.current
    val surface = colors.sidebar
    Column(Modifier.fillMaxSize().background(surface).border(1.dp, colors.separator, RoundedRectangle(26.dp))) {
        Spacer(Modifier.height(32.dp))
        Search(state, Modifier.fillMaxWidth().padding(horizontal = 16.dp), onFilter = { filters = !filters })
        AppleSelfProfile(state, Modifier.padding(horizontal = 16.dp, vertical = 14.dp))
        if (filters) {
            FilterTabs(state, Modifier.padding(bottom = 8.dp), backdrop, surface)
            CommandRow(state, Modifier.padding(horizontal = 14.dp), includeSettings = false)
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().layerBackdrop(backdrop).semantics { contentDescription = "トーク一覧" }, contentPadding = PaddingValues(top = 6.dp, bottom = 16.dp)) {
            if (state.rows.isEmpty()) item { EmptyConversations(state) }
            items(state.rows, key = { it.id }) { row -> Conversation(state, row) }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp), horizontalArrangement = Arrangement.End) {
            Command(state.mode, FluentIcons.Regular.Edit, "グループを作成", "create-group")
            Command(state.mode, FluentIcons.Regular.Settings, "設定", "settings")
        }
    }
}

@Composable
private fun AppleSelfProfile(state: SidebarSnapshot, modifier: Modifier) {
    val action = rememberScopedAction()
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp))
            .background(LocalRendererColors.current.raised).combinedClickable(onClick = { action("profile") }).padding(horizontal = 11.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Avatar(ConversationRow("self-profile", state.profile.name.ifBlank { "プロフィール" }, avatar = state.profile.avatar.ifBlank { state.profile.name.take(1) }, color = "#8995C6", avatarUrl = state.profile.avatarUrl), 42, gradient = true)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Label(state.profile.name.ifBlank { "プロフィール" }, 15, FontWeight.SemiBold)
                Label(state.profile.status.ifBlank { "マイプロフィール" }, 12, color = LocalSecondaryInk.current)
            }
            AppleGlyph(AppleSymbol.ChevronRight, LocalSecondaryInk.current, 23)
        }
}

@Composable
private fun ApplePhoneSidebar(state: SidebarSnapshot) {
    val action = rememberScopedAction()
    val backdrop = rememberLayerBackdrop()
    val surface = LocalRendererColors.current.canvas
    var filters by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf(false) }
    val editMotion = rememberAppleLiquidMotion(enabled = true, reducedMotion = state.reducedMotion)
    val searchMotion = rememberAppleLiquidMotion(enabled = true, reducedMotion = state.reducedMotion)
    Box(Modifier.fillMaxSize().background(surface)) {
        // Tabs sample the list layer as a sibling; recording their own glass would create feedback.
        Column(Modifier.fillMaxSize()) {
        if (filters) {
            Spacer(Modifier.height(60.dp))
            FilterTabs(state, Modifier.padding(vertical = 8.dp), backdrop, surface)
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().layerBackdrop(backdrop).semantics { contentDescription = "トーク一覧" },
            contentPadding = PaddingValues(bottom = 92.dp)) {
            item {
                if (!filters) Spacer(Modifier.height(60.dp))
                Label("メッセージ", 34, FontWeight.Bold, modifier = Modifier.padding(start = 16.dp, top = 6.dp, bottom = 4.dp))
                AppleSelfProfile(state, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                if (edit) {
                    CommandRow(state, Modifier.padding(horizontal = 18.dp), includeSettings = false)
                    NativeButton(state.mode, "表示とテーマ", Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp)) { action("settings") }
                }
            }
            if (state.rows.isEmpty()) item { EmptyConversations(state) }
            items(state.rows, key = { it.id }) { row -> Conversation(state, row, phone = true) }
        }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Box(Modifier.width(66.dp).height(44.dp)
                .appleLiquidBackdrop(editMotion, backdrop, { CircleShape }, surface.copy(alpha = .78f), lensRadius = 9.dp, lensHeight = 16.dp)
                .clickable(interactionSource = editMotion.interactionSource, indication = null, role = Role.Button, onClick = { edit = !edit })
                .then(editMotion.pointerModifier), contentAlignment = Alignment.Center) {
                Label(if (edit) "完了" else "編集", 17, FontWeight.SemiBold)
            }
            AppleGlassIcon(backdrop, AppleSymbol.Filter, "トークのフィルタ", dark = state.dark) { filters = !filters }
        }
        Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 28.dp, vertical = 18.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Search(state, Modifier.weight(1f)
                .appleLiquidBackdrop(searchMotion, backdrop, { CircleShape }, surface.copy(alpha = .78f), blurRadius = 15.dp, lensRadius = 11.dp, lensHeight = 19.dp)
                .then(searchMotion.pointerModifier), glass = true)
            AppleGlassIcon(backdrop, AppleSymbol.Compose, "グループを作成", dark = state.dark) { action("create-group") }
        }
    }
}

@Composable
private fun FluentSidebar(state: SidebarSnapshot, compact: Boolean) {
    val action = rememberScopedAction()
    val navigation = io.github.composefluent.component.rememberNavigationState(initialExpanded = false)
    io.github.composefluent.component.NavigationView(
        modifier = Modifier.fillMaxSize(),
        displayMode = if (compact) io.github.composefluent.component.NavigationDisplayMode.LeftCollapsed else io.github.composefluent.component.NavigationDisplayMode.LeftCompact,
        contentPadding = if (compact) PaddingValues(top = 48.dp) else PaddingValues(),
        state = navigation, expandedButton = {
            Box(Modifier.width(48.dp).height(40.dp), contentAlignment = Alignment.Center) {
                LocalIconButton(FluentIcons.Regular.Navigation, "ナビゲーション", state.mode) { navigation.expanded = !navigation.expanded }
            }
        },
        menuItems = {
            state.tabs.forEach { tab ->
                item(key = tab.id) { SideNavItem(selected = tab.id == state.tab, expand = navigation.expanded || compact,
                    onClick = { action("tab", id = tab.id); navigation.expanded = false },
                    modifier = Modifier.clearAndSetSemantics { contentDescription = tab.label; role = Role.Tab; this.selected = tab.id == state.tab; onClick { action("tab", id = tab.id); navigation.expanded = false; true } },
                    icon = { Glyph(tabIcon(tab.id), LocalInk.current, description = tab.label) }) { Label(tab.label, 13) } }
            }
        },
        footerItems = {
            item(key = "profile") { SideNavItem(selected = false, expand = true, onClick = { action("profile") },
                icon = { Glyph(FluentIcons.Regular.Person, LocalInk.current, description = "プロフィール") }) { if (navigation.expanded) Label("プロフィール", 13) } }
            item(key = "settings") { SideNavItem(selected = state.view == "settings", expand = true, onClick = { action("settings") },
                icon = { Glyph(FluentIcons.Regular.Settings, LocalInk.current, description = "設定") }) { if (navigation.expanded) Label("設定", 13) } }
        },
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 14.dp, end = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Label(state.tabs.firstOrNull { it.id == state.tab }?.label?.let { if (state.tab == "all") "チャット" else it } ?: "チャット",
                    23, FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Command(state.mode, FluentIcons.Regular.Edit, "グループを作成", "create-group")
            }
            Search(state, Modifier.fillMaxWidth().padding(horizontal = 12.dp))
            CommandRow(state, Modifier.fillMaxWidth().padding(start = 8.dp, end = 4.dp, top = 5.dp, bottom = 5.dp), includeSettings = false)
            Box(Modifier.fillMaxWidth().height(1.dp).background(LocalRendererColors.current.separator))
            LazyColumn(Modifier.weight(1f).fillMaxWidth().semantics { contentDescription = "トーク一覧" }, contentPadding = PaddingValues(vertical = 8.dp)) {
                if (state.rows.isEmpty()) item { EmptyConversations(state) }
                items(state.rows, key = { it.id }) { row -> Conversation(state, row) }
            }
        }
    }
}

@Composable
private fun MiuixSidebar(state: SidebarSnapshot) {
    val action = rememberScopedAction()
    var more by remember { mutableStateOf(false) }
    val surface = LocalRendererColors.current.sidebar
    Column(Modifier.fillMaxSize().background(surface)) {
        MiuixTopAppBar(title = "トーク", largeTitle = "トーク", color = surface, defaultWindowInsetsPadding = false,
            actions = {
                Command(state.mode, FluentIcons.Regular.Edit, "グループを作成", "create-group")
                LocalIconButton(FluentIcons.Regular.MoreHorizontal, "その他の操作", state.mode, selected = more) { more = !more }
            })
        Search(state, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp))
        if (more) CommandRow(state, Modifier.fillMaxWidth().padding(horizontal = 16.dp))
        LazyColumn(Modifier.weight(1f).fillMaxWidth().semantics { contentDescription = "トーク一覧" },
            contentPadding = PaddingValues(top = 18.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                MiuixCard(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp), onClick = { action("profile") }, insideMargin = PaddingValues(16.dp),
                    pressFeedbackType = if (state.reducedMotion) PressFeedbackType.None else PressFeedbackType.Sink,
                    showIndication = true) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(38.dp).clip(CircleShape).background(LocalAccent.current.copy(alpha = .12f)), contentAlignment = Alignment.Center) {
                            Glyph(FluentIcons.Regular.Person, LocalAccent.current, 22)
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Label(state.profile.name.ifBlank { "プロフィール" }, 15, FontWeight.SemiBold)
                            Label(state.profile.status.ifBlank { "マイプロフィール" }, 11, color = LocalSecondaryInk.current)
                        }
                        Glyph(FluentIcons.Regular.ChevronRight, LocalSecondaryInk.current, 16)
                    }
                }
            }
            item { Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Label(state.tabs.firstOrNull { it.id == state.tab }?.label ?: "すべてのトーク", 12, FontWeight.Medium, color = LocalSecondaryInk.current, modifier = Modifier.weight(1f))
                Label(state.sortLabel, 11, color = LocalSecondaryInk.current, modifier = Modifier.padding(6.dp))
            } }
            if (state.rows.isEmpty()) item { EmptyConversations(state) }
            items(state.rows, key = { it.id }) { row -> Conversation(state, row) }
        }
        top.yukonga.miuix.kmp.basic.NavigationBar(defaultWindowInsetsPadding = false, showDivider = false) {
            state.tabs.forEach { tab ->
                NavigationBarItem(selected = tab.id == state.tab, onClick = { action("tab", id = tab.id) },
                    icon = tabIcon(tab.id), label = tab.label)
            }
        }
    }
}

@Composable
private fun EmptyConversations(state: SidebarSnapshot) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (state.mode == "apple") AppleGlyph(AppleSymbol.Search, LocalSecondaryInk.current, 30)
        else Glyph(FluentIcons.Regular.Search, LocalSecondaryInk.current, 30)
        Spacer(Modifier.height(12.dp))
        Label(if (state.query.isBlank()) "トークがありません" else "見つかりませんでした", 14, FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Label(if (state.query.isBlank()) "同期するとここに表示されます" else "別のキーワードをお試しください", 11, color = LocalSecondaryInk.current)
    }
}

@Composable
private fun CommandRow(state: SidebarSnapshot, modifier: Modifier, includeSettings: Boolean = true) {
    val action = rememberScopedAction()
    var sortOpen by remember(state.epoch) { mutableStateOf(false) }
    Column(modifier.onPreviewKeyEvent { if (it.type == KeyEventType.KeyDown && it.key == Key.Escape && sortOpen) { sortOpen = false; true } else false }) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).combinedClickable(onClick = { sortOpen = !sortOpen }).padding(vertical = 12.dp, horizontal = 4.dp)
            .semantics { role = Role.Button; contentDescription = "並び順"; stateDescription = "${state.sortLabel}・${if (sortOpen) "展開中" else "閉じた状態"}" }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Label(state.sortLabel, 11, color = LocalSecondaryInk.current, modifier = Modifier.weight(1f, fill = false))
                Glyph(FluentIcons.Regular.ChevronDown, LocalSecondaryInk.current, 12)
            }
        }
        Command(state.mode, FluentIcons.Regular.ArrowSync, "トークを同期", "refresh", enabled = state.canRefresh)
        Command(state.mode, FluentIcons.Regular.ArrowExpand, "分割表示するトークを選択", "split-pick", selected = state.splitPick)
        if (includeSettings) Command(state.mode, FluentIcons.Regular.Settings, "設定", "settings")
    }
    if (sortOpen) Column(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf("recent" to "最新順", "unread" to "未読順", "custom" to "カスタム順").forEach { (id, label) ->
            NativeButton(state.mode, label, Modifier.fillMaxWidth().semantics { selected = state.sortLabel == label }, primary = state.sortLabel == label) {
                action("sort", value = id); sortOpen = false
            }
        }
        NativeButton(state.mode, "すべて既読にする", Modifier.fillMaxWidth()) { action("mark-all-read"); sortOpen = false }
    }
    }
}

private fun tabIcon(id: String) = when (id) {
    "friend" -> FluentIcons.Regular.Person
    "group", "groups" -> FluentIcons.Regular.People
    "official" -> FluentIcons.Regular.Megaphone
    "hidden" -> FluentIcons.Regular.EyeOff
    "unread" -> FluentIcons.Regular.MailUnread
    else -> FluentIcons.Regular.Chat
}

@Composable
private fun Search(state: SidebarSnapshot, modifier: Modifier, onFilter: (() -> Unit)? = null, glass: Boolean = false) {
    val action = rememberScopedAction()
    var query by remember { mutableStateOf(state.query) }
    LaunchedEffect(state.query) { if (query != state.query) query = state.query }
    val changed: (String) -> Unit = { query = it; action("search", value = it) }
    val inputBehavior = Modifier.onPreviewKeyEvent {
        if (it.type == KeyEventType.KeyDown && it.key == Key.Escape && query.isNotEmpty()) { changed(""); true } else false
    }.semantics { contentDescription = "トークを検索" }
    val clear: @Composable () -> Unit = { if (query.isNotEmpty()) LocalIconButton(FluentIcons.Regular.Dismiss, "検索をクリア", state.mode) { changed("") } }
    when (state.mode) {
        "fluent" -> FluentTextField(value = query, onValueChange = changed, modifier = modifier.then(inputBehavior), singleLine = true,
            placeholder = { Label("検索", 14, color = LocalSecondaryInk.current, modifier = Modifier.fillMaxWidth()) },
            leadingIcon = { Glyph(FluentIcons.Regular.Search, LocalSecondaryInk.current, 16) }, isClearable = false, trailing = { clear() })
        "miuix" -> MiuixTextField(value = query, onValueChange = changed, modifier = modifier.then(inputBehavior), singleLine = true, label = "検索", useLabelAsPlaceholder = true,
            textStyle = LocalRendererTextStyle.current.copy(fontSize = 15.sp, lineHeight = 19.sp, color = LocalInk.current),
            leadingIcon = { Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) { Glyph(FluentIcons.Regular.Search, LocalSecondaryInk.current, 18) } },
            trailingIcon = { Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) { clear() } })
        else -> Row(modifier.clip(CircleShape).background(if (glass) Color.Transparent else LocalRendererColors.current.input).padding(start = 13.dp, end = 8.dp).height(if (glass) 48.dp else 44.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                AppleGlyph(AppleSymbol.Search, LocalSecondaryInk.current, 24)
                BasicTextField(value = query, onValueChange = changed, singleLine = true,
                    modifier = Modifier.weight(1f).then(inputBehavior),
                    textStyle = LocalRendererTextStyle.current.copy(fontSize = if (glass) 17.sp else 15.sp, lineHeight = if (glass) 21.sp else 19.sp, color = LocalInk.current), cursorBrush = SolidColor(LocalAccent.current),
                    decorationBox = { input -> Box { if (query.isEmpty()) Label("検索", if (glass) 17 else 15, color = LocalSecondaryInk.current); input() } })
                clear()
                if (onFilter != null) Box(Modifier.size(28.dp).clip(CircleShape).combinedClickable(onClick = onFilter).semantics { contentDescription = "トークのフィルタ" }, contentAlignment = Alignment.Center) {
                    AppleGlyph(AppleSymbol.Filter, LocalSecondaryInk.current, 24)
                }
            }
    }
}

@Composable
private fun FilterTabs(state: SidebarSnapshot, modifier: Modifier = Modifier, backdrop: Backdrop? = null, backgroundColor: Color = Color.Transparent) {
    val action = rememberScopedAction()
    if (state.mode == "apple" && backdrop != null) {
        AppleLiquidTabs(labels = state.tabs.map { it.label }, selectedIndex = state.tabs.indexOfFirst { it.id == state.tab }.coerceAtLeast(0), backgroundColor = backgroundColor,
            onSelected = { index -> action("tab", id = state.tabs[index].id) }, backdrop = backdrop,
            reducedMotion = state.reducedMotion, modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp))
        return
    }
    Row(modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp).semantics { selectableGroup() }, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        state.tabs.forEach { tab ->
            val selected = tab.id == state.tab
            Box(Modifier.clip(CircleShape).background(if (selected) LocalAccent.current else Color.Transparent)
                .combinedClickable(onClick = { action("tab", id = tab.id) }).semantics { role = Role.Tab; this.selected = selected }
                .padding(horizontal = 15.dp, vertical = 10.dp)) {
                Label(tab.label, 12, FontWeight.SemiBold, color = if (selected) LocalRendererColors.current.onAccent else LocalRendererColors.current.accentText)
            }
        }
    }
}

@Composable
private fun Conversation(state: SidebarSnapshot, row: ConversationRow, phone: Boolean = false) {
    val action = rememberScopedAction()
    val density = LocalDensity.current.density
    val drag = LocalChatListDrag.current
    val colors = LocalRendererColors.current
    val rowShape = when (state.mode) {
        "fluent" -> io.github.composefluent.FluentTheme.shapes.control
        "miuix" -> RoundedRectangle(top.yukonga.miuix.kmp.basic.CardDefaults.CornerRadius)
        else -> RoundedRectangle(26.dp)
    }
    var bounds by remember { mutableStateOf(Rect.Zero) }
    DisposableEffect(row.id) { onDispose { drag.rowBounds.remove(row.id); if (drag.source == row.id) drag.reset() } }
    var focused by remember { mutableStateOf(false) }
    val context = { action("context", id = row.id, x = (bounds.right - 24f) / density, y = bounds.center.y / density) }
    val accessible = Modifier.onGloballyPositioned { bounds = it.boundsInWindow(); drag.rowBounds[row.id] = bounds }.onFocusChanged { focused = it.hasFocus }
        .onPointerEvent(PointerEventType.Press, PointerEventPass.Initial) { event ->
            val pointer = event.changes.firstOrNull()
            if (state.desktopInteraction && pointer?.type == PointerType.Mouse && event.buttons.isPrimaryPressed) {
                drag.source = row.id; drag.start = bounds.topLeft + pointer.position; drag.position = drag.start
            }
        }.onPointerEvent(PointerEventType.Move, PointerEventPass.Initial) { event ->
            if (drag.source == row.id && event.buttons.isPrimaryPressed) event.changes.firstOrNull()?.let { pointer ->
                drag.position = bounds.topLeft + pointer.position
                if ((drag.position - drag.start).getDistance() > 8f * density) drag.active = true
                if (drag.active) pointer.consume()
            }
        }.onPointerEvent(PointerEventType.Release, PointerEventPass.Initial) { event ->
            if (drag.source == row.id) {
                if (drag.active) event.changes.forEach { it.consume() }
                drag.drop(action, state.chatSort == "custom")
            }
        }
        .onPointerEvent(PointerEventType.Press) { event ->
            if (event.buttons.isSecondaryPressed) {
                val point = event.changes.firstOrNull()?.position
                action("context", id = row.id, x = (bounds.left + (point?.x ?: 0f)) / density, y = (bounds.top + (point?.y ?: 0f)) / density)
            }
        }.onPreviewKeyEvent { event ->
            if (event.type == KeyEventType.KeyDown && (event.key == Key.Menu || event.key == Key.F10 && event.isShiftPressed)) { context(); true } else false
        }.semantics {
            selected = row.selected
            customActions = listOf(CustomAccessibilityAction("トークのメニュー") { context(); true })
        }.border(if (focused) 2.dp else 0.dp, if (focused) colors.accent else Color.Transparent, rowShape)
    val selectedBackground = if (row.selected) colors.selected else Color.Transparent
    CompositionLocalProvider(
        LocalInk provides if (row.selected) colors.selectedText else colors.text,
        LocalSecondaryInk provides if (row.selected) colors.selectedSecondary else colors.secondary,
    ) {
    when (state.mode) {
        "fluent" -> FluentListItem(selected = row.selected, onSelectedChanged = { action("open", id = row.id) },
            modifier = accessible.padding(horizontal = 6.dp).pointerInput(row.id, action) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    if (awaitLongPressOrCancellation(down.id) != null && !drag.active) {
                        context()
                        do {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            event.changes.forEach { it.consume() }
                        } while (event.changes.any { it.pressed })
                    }
                }
            },
            text = { Row(Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) { Avatar(row, 32); Box(Modifier.weight(1f)) { RowText(row, false) } } },
            trailing = { RowTrailing(row, context, compact = true) })
        "miuix" -> MiuixCard(modifier = accessible.padding(horizontal = 12.dp), onClick = { action("open", id = row.id) }, onLongPress = context,
            pressFeedbackType = if (state.reducedMotion) PressFeedbackType.None else PressFeedbackType.Sink,
            showIndication = true, insideMargin = PaddingValues(0.dp)) {
            Row(Modifier.background(selectedBackground).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Avatar(row, 48)
                Box(Modifier.weight(1f)) { RowText(row, false) }
                RowTrailing(row, context, compact = false)
            }
        }
        else -> Column(Modifier.padding(horizontal = 16.dp)) {
            Row(accessible.fillMaxWidth().clip(RoundedRectangle(26.dp)).background(selectedBackground)
                .combinedClickable(onClick = { action("open", id = row.id) }, onLongClick = context, role = Role.Button)
                .padding(horizontal = if (phone) 10.dp else 12.dp, vertical = if (phone) 10.dp else 17.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Avatar(row, if (phone) 44 else 46, gradient = true)
                Box(Modifier.weight(1f)) { RowText(row, true, phone) }
            }
            Box(Modifier.padding(start = 74.dp, end = 10.dp).fillMaxWidth().height(.5.dp).background(colors.separator))
        }
    }
    }
}

@Composable
private fun RowText(row: ConversationRow, apple: Boolean, phone: Boolean = false) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(if (phone) 2.dp else 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Label(row.title, if (phone) 17 else if (apple) 16 else 14, if (row.unread > 0 || apple) FontWeight.SemiBold else FontWeight.Medium, modifier = Modifier.weight(1f, fill = apple))
            if (row.pinned) { if (apple) AppleGlyph(AppleSymbol.Pin, LocalSecondaryInk.current, 16) else Glyph(FluentIcons.Regular.Pin, LocalSecondaryInk.current, 11) }
            if (row.locked) Glyph(FluentIcons.Regular.Key, LocalSecondaryInk.current, 11)
            if (apple) {
                Label(row.time, if (phone) 11 else 10, color = LocalSecondaryInk.current)
                if (phone) AppleGlyph(AppleSymbol.ChevronRight, LocalSecondaryInk.current.copy(alpha = .5f), 16)
            }
        }
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Label(row.preview, if (phone) 15 else if (apple) 13 else 12, color = LocalSecondaryInk.current,
                modifier = Modifier.weight(1f), maxLines = if (apple) 2 else 1)
            if (apple) UnreadBadge(row, blueSelection = row.selected)
        }
    }
}

@Composable
private fun RowTrailing(row: ConversationRow, context: () -> Unit, compact: Boolean) {
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(5.dp), modifier = Modifier.widthIn(min = if (compact) 40.dp else 44.dp)) {
        Label(row.time, 10, color = LocalSecondaryInk.current)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            UnreadBadge(row)
            Box(Modifier.size(30.dp).clip(CircleShape).combinedClickable(onClick = context, role = Role.Button)
                .semantics { contentDescription = "${row.title}のメニュー" }, contentAlignment = Alignment.Center) {
                Glyph(FluentIcons.Regular.MoreHorizontal, LocalSecondaryInk.current, 16)
            }
        }
    }
}

@Composable
private fun UnreadBadge(row: ConversationRow, blueSelection: Boolean = false) {
    val colors = LocalRendererColors.current
    // Muted badges must not inherit selected-row ink: it can be translucent white.
    val background = when {
        row.muted -> colors.mutedBadge
        blueSelection -> colors.selectedText
        else -> colors.accent
    }
    val foreground = when {
        row.muted -> colors.mutedBadgeText
        blueSelection -> colors.selected
        else -> colors.onAccent
    }
    if (row.unread > 0) Box(Modifier.clip(CircleShape).background(background).padding(horizontal = 6.dp, vertical = 2.dp)) {
        Label(if (row.unread > 99) "99+" else row.unread.toString(), 10, FontWeight.SemiBold, foreground)
    }
}

@Composable
internal fun Command(mode: String, icon: ImageVector, label: String, command: String, enabled: Boolean = true, selected: Boolean = false) {
    val action = rememberScopedAction()
    val density = LocalDensity.current.density
    var bounds by remember { mutableStateOf(androidx.compose.ui.geometry.Rect.Zero) }
    val clicked = { action(command, x = bounds.center.x / density, y = bounds.bottom / density) }
    val modifier = Modifier.size(40.dp).onGloballyPositioned { bounds = it.boundsInWindow() }.semantics { contentDescription = label; this.selected = selected }
    val ink = if (enabled) LocalRendererColors.current.accentText else LocalRendererColors.current.disabled
    when (mode) {
        "fluent" -> FluentButton(onClick = clicked, modifier = modifier, disabled = !enabled) { Glyph(icon, ink, description = if (mode == "fluent") label else null) }
        "miuix" -> MiuixIconButton(onClick = clicked, modifier = modifier, enabled = enabled) { Glyph(icon, ink, description = if (mode == "fluent") label else null) }
        else -> Box(modifier.clip(CircleShape).background(if (selected) LocalAccent.current.copy(alpha = .14f) else Color.Transparent)
            .combinedClickable(enabled = enabled, role = Role.Button, onClick = clicked), contentAlignment = Alignment.Center) { AppleControlGlyph(icon, ink) }
    }
}

@Composable
internal fun LocalIconButton(icon: ImageVector, label: String, mode: String, selected: Boolean = false, onClick: () -> Unit) {
    val modifier = Modifier.size(40.dp).semantics { contentDescription = label; this.selected = selected }
    val ink = LocalRendererColors.current.accentText
    when (mode) {
        "fluent" -> FluentButton(onClick = onClick, modifier = modifier) { Glyph(icon, ink, description = if (mode == "fluent") label else null) }
        "miuix" -> MiuixIconButton(onClick = onClick, modifier = modifier) { Glyph(icon, ink, description = if (mode == "fluent") label else null) }
        else -> Box(modifier.clip(CircleShape).background(if (selected) ink.copy(alpha = .14f) else Color.Transparent)
            .combinedClickable(role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) { AppleControlGlyph(icon, ink) }
    }
}

@Composable
private fun AppleControlGlyph(icon: ImageVector, ink: Color) {
    val symbol = when (icon) {
        FluentIcons.Regular.ChevronLeft, FluentIcons.Regular.ArrowLeft -> AppleSymbol.Back
        FluentIcons.Regular.Dismiss -> AppleSymbol.Close
        FluentIcons.Regular.Settings -> AppleSymbol.Settings
        FluentIcons.Regular.Person -> AppleSymbol.Person
        FluentIcons.Regular.Attach -> AppleSymbol.Attachment
        FluentIcons.Regular.Heart -> AppleSymbol.Heart
        FluentIcons.Regular.Alert -> AppleSymbol.Muted
        FluentIcons.Regular.Filter -> AppleSymbol.Filter
        FluentIcons.Regular.Add -> AppleSymbol.Plus
        FluentIcons.Regular.ChevronRight, FluentIcons.Regular.ArrowRight -> AppleSymbol.ChevronRight
        FluentIcons.Regular.ChevronUp -> AppleSymbol.ChevronUp
        FluentIcons.Regular.ChevronDown -> AppleSymbol.ChevronDown
        FluentIcons.Regular.ArrowSync -> AppleSymbol.Refresh
        FluentIcons.Regular.ArrowExpand -> AppleSymbol.Expand
        FluentIcons.Regular.Navigation -> AppleSymbol.Sidebar
        FluentIcons.Regular.Search -> AppleSymbol.Search
        FluentIcons.Regular.Mic -> AppleSymbol.Waveform
        FluentIcons.Regular.Call -> AppleSymbol.Phone
        FluentIcons.Regular.Video -> AppleSymbol.Video
        else -> null
    }
    if (symbol != null) AppleGlyph(symbol, ink) else Glyph(icon, ink)
}

@Composable
internal fun Glyph(vector: ImageVector, color: Color, size: Int = 20, description: String? = null) {
    Image(vector, contentDescription = description, modifier = Modifier.size(size.dp), colorFilter = ColorFilter.tint(color))
}

@Composable
internal fun Label(text: String, size: Int, weight: FontWeight = FontWeight.Normal, color: Color = LocalInk.current, modifier: Modifier = Modifier, maxLines: Int = 1) {
    BasicText(text, modifier = modifier, style = LocalRendererTextStyle.current.copy(color = color, fontSize = size.sp, fontWeight = weight, lineHeight = (size + 4).sp), maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}
