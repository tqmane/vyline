@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class, io.github.composefluent.ExperimentalFluentApi::class)

import androidx.compose.foundation.Image
import androidx.compose.foundation.LocalOverscrollFactory
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.onPointerEvent
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
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
import io.github.composefluent.FluentTheme
import io.github.composefluent.background.Mica
import io.github.composefluent.darkColors
import io.github.composefluent.lightColors
import io.github.composefluent.component.ListItem as FluentListItem
import io.github.composefluent.component.menuItem
import io.github.composefluent.component.SubtleButton as FluentButton
import io.github.composefluent.component.TextField as FluentTextField
import io.github.composefluent.icons.Icons as FluentIcons
import io.github.composefluent.icons.regular.*
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import top.yukonga.miuix.kmp.basic.IconButton as MiuixIconButton
import top.yukonga.miuix.kmp.basic.NavigationBarItem
import top.yukonga.miuix.kmp.basic.TextField as MiuixTextField
import top.yukonga.miuix.kmp.basic.TopAppBar as MiuixTopAppBar
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.darkColorScheme
import top.yukonga.miuix.kmp.theme.lightColorScheme

internal val LocalInk = staticCompositionLocalOf { Color(0xFF19191B) }
internal val LocalSecondaryInk = staticCompositionLocalOf { Color(0xFF6B6B73) }
internal val LocalAccent = staticCompositionLocalOf { Color(0xFF007AFF) }

@Composable
fun RendererTheme(state: SidebarSnapshot, content: @Composable () -> Unit) {
    val ink = if (state.dark) Color(0xFFF5F5F7) else Color(0xFF19191B)
    val secondary = if (state.dark) Color(0xFFABABB3) else Color(0xFF686872)
    val accent = if (state.mode == "fluent") Color(0xFF0078D4) else Color(0xFF007AFF)
    CompositionLocalProvider(LocalInk provides ink, LocalSecondaryInk provides secondary, LocalAccent provides accent) {
        when (state.mode) {
            "fluent" -> FluentTheme(colors = if (state.dark) darkColors() else lightColors(), compactMode = false) {
                Mica(Modifier.fillMaxSize()) { RespectMotionPreference(state, content) }
            }
            "miuix" -> MiuixTheme(colors = if (state.dark) darkColorScheme() else lightColorScheme()) {
                RespectMotionPreference(state, content)
            }
            else -> RespectMotionPreference(state, content)
        }
    }
}

@Composable
private fun RespectMotionPreference(state: SidebarSnapshot, content: @Composable () -> Unit) {
    if (state.reducedMotion) CompositionLocalProvider(LocalOverscrollFactory provides null, content = content)
    else content()
}

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
        "fluent" -> FluentSidebar(state)
        "miuix" -> MiuixSidebar(state)
        else -> if (compact) ApplePhoneSidebar(state) else AppleSidebar(state)
    }
}

@Composable
private fun AppleSidebar(state: SidebarSnapshot) {
    var filters by remember { mutableStateOf(false) }
    val surface = if (state.dark) Color(0xFF1D1D20) else Color(0xFFF9F9FA)
    Column(Modifier.fillMaxSize().background(surface).border(1.dp, if (state.dark) Color.White.copy(alpha = .06f) else Color.White, RoundedRectangle(26.dp))) {
        Spacer(Modifier.height(32.dp))
        Search(state, Modifier.fillMaxWidth().padding(horizontal = 16.dp), onFilter = { filters = !filters })
        AppleSelfProfile(state, Modifier.padding(horizontal = 16.dp, vertical = 14.dp))
        if (filters) {
            FilterTabs(state, Modifier.padding(bottom = 8.dp))
            CommandRow(state, Modifier.padding(horizontal = 14.dp), includeSettings = false)
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().semantics { contentDescription = "トーク一覧" }, contentPadding = PaddingValues(top = 6.dp, bottom = 16.dp)) {
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
            .background(LocalSecondaryInk.current.copy(alpha = .07f)).combinedClickable(onClick = { action("profile") }).padding(horizontal = 11.dp, vertical = 11.dp),
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
    val surface = if (state.dark) Color(0xFF050506) else Color.White
    var filters by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(surface)) {
        LazyColumn(Modifier.fillMaxSize().layerBackdrop(backdrop).semantics { contentDescription = "トーク一覧" },
            contentPadding = PaddingValues(bottom = 92.dp)) {
            item {
                Spacer(Modifier.height(60.dp))
                Label("メッセージ", 34, FontWeight.Bold, modifier = Modifier.padding(start = 16.dp, top = 6.dp, bottom = 4.dp))
                AppleSelfProfile(state, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                if (filters) FilterTabs(state, Modifier.padding(vertical = 8.dp))
                if (edit) {
                    CommandRow(state, Modifier.padding(horizontal = 18.dp), includeSettings = false)
                    NativeButton(state.mode, "表示とテーマ", Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp)) { action("settings") }
                }
            }
            if (state.rows.isEmpty()) item { EmptyConversations(state) }
            items(state.rows, key = { it.id }) { row -> Conversation(state, row, phone = true) }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Box(Modifier.width(66.dp).height(44.dp).drawBackdrop(backdrop, { CircleShape }, effects = {
                vibrancy(); blur(12.dp.toPx()); lens(9.dp.toPx(), 16.dp.toPx())
            }, shadow = { com.kyant.backdrop.shadow.Shadow(radius = 12.dp, color = Color.Black.copy(alpha = .05f)) },
                onDrawSurface = { drawRect(surface.copy(alpha = .78f)) }).combinedClickable(role = Role.Button, onClick = { edit = !edit }), contentAlignment = Alignment.Center) {
                Label(if (edit) "完了" else "編集", 17, FontWeight.SemiBold)
            }
            AppleGlassIcon(backdrop, AppleSymbol.Filter, "トークのフィルタ", dark = state.dark) { filters = !filters }
        }
        Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 28.dp, vertical = 18.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Search(state, Modifier.weight(1f).drawBackdrop(backdrop, { CircleShape }, effects = {
                vibrancy(); blur(15.dp.toPx()); lens(11.dp.toPx(), 19.dp.toPx())
            }, shadow = { com.kyant.backdrop.shadow.Shadow(radius = 15.dp, color = Color.Black.copy(alpha = .07f)) },
                onDrawSurface = { drawRect(surface.copy(alpha = .78f)) }), glass = true)
            AppleGlassIcon(backdrop, AppleSymbol.Compose, "グループを作成", dark = state.dark) { action("create-group") }
        }
    }
}

@Composable
private fun FluentSidebar(state: SidebarSnapshot) {
    val action = rememberScopedAction()
    val navigation = io.github.composefluent.component.rememberNavigationState(initialExpanded = false)
    io.github.composefluent.component.NavigationView(
        modifier = Modifier.fillMaxSize(), displayMode = io.github.composefluent.component.NavigationDisplayMode.LeftCompact,
        state = navigation, expandedButton = {
            LocalIconButton(FluentIcons.Regular.Navigation, "ナビゲーション", state.mode) { navigation.expanded = !navigation.expanded }
        },
        menuItems = {
            state.tabs.forEachIndexed { index, tab ->
                menuItem(selected = tab.id == state.tab, onClick = { action("tab", id = tab.id); navigation.expanded = false },
                    text = { Label(tab.label, 13) }, icon = { Glyph(tabIcon(index), LocalInk.current, description = tab.label) }, key = tab.id)
            }
        },
        footerItems = {
            menuItem(selected = false, onClick = { action("profile") }, text = { Label("プロフィール", 13) },
                icon = { Glyph(FluentIcons.Regular.Person, LocalInk.current, description = "プロフィール") })
            menuItem(selected = false, onClick = { action("settings") }, text = { Label("設定", 13) },
                icon = { Glyph(FluentIcons.Regular.Settings, LocalInk.current, description = "設定") })
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
            Box(Modifier.fillMaxWidth().height(1.dp).background(LocalSecondaryInk.current.copy(alpha = .14f)))
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
    val surface = if (state.dark) Color(0xFF101012) else Color(0xFFF4F5F8)
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
                MiuixCard(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp), onClick = { action("profile") }, insideMargin = PaddingValues(16.dp)) {
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
                Label(state.sortLabel, 11, color = LocalSecondaryInk.current, modifier = Modifier.combinedClickable(onClick = { action("sort") }).padding(6.dp).semantics { role = Role.Button })
            } }
            if (state.rows.isEmpty()) item { EmptyConversations(state) }
            items(state.rows, key = { it.id }) { row -> Conversation(state, row) }
        }
        top.yukonga.miuix.kmp.basic.NavigationBar(defaultWindowInsetsPadding = false, showDivider = false) {
            state.tabs.forEachIndexed { index, tab ->
                NavigationBarItem(selected = tab.id == state.tab, onClick = { action("tab", id = tab.id) },
                    icon = tabIcon(index), label = tab.label)
            }
        }
    }
}

@Composable
private fun EmptyConversations(state: SidebarSnapshot) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Glyph(FluentIcons.Regular.Search, LocalSecondaryInk.current, 30)
        Spacer(Modifier.height(12.dp))
        Label(if (state.query.isBlank()) "トークがありません" else "見つかりませんでした", 14, FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Label(if (state.query.isBlank()) "同期するとここに表示されます" else "別のキーワードをお試しください", 11, color = LocalSecondaryInk.current)
    }
}

@Composable
private fun CommandRow(state: SidebarSnapshot, modifier: Modifier, includeSettings: Boolean = true) {
    val action = rememberScopedAction()
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).combinedClickable(onClick = { action("sort") }).padding(vertical = 12.dp, horizontal = 4.dp)
            .semantics { role = Role.Button; contentDescription = state.sortLabel }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Label(state.sortLabel, 11, color = LocalSecondaryInk.current, modifier = Modifier.weight(1f, fill = false))
                Glyph(FluentIcons.Regular.ChevronDown, LocalSecondaryInk.current, 12)
            }
        }
        Command(state.mode, FluentIcons.Regular.ArrowSync, "トークを同期", "refresh", enabled = state.canRefresh)
        Command(state.mode, FluentIcons.Regular.ArrowExpand, "分割表示するトークを選択", "split-pick", selected = state.splitPick)
        if (includeSettings) Command(state.mode, FluentIcons.Regular.Settings, "設定", "settings")
    }
}

private fun tabIcon(index: Int) = when (index % 4) {
    0 -> FluentIcons.Regular.Mail
    1 -> FluentIcons.Regular.Alert
    2 -> FluentIcons.Regular.Person
    else -> FluentIcons.Regular.Folder
}

@Composable
private fun Search(state: SidebarSnapshot, modifier: Modifier, onFilter: (() -> Unit)? = null, glass: Boolean = false) {
    val action = rememberScopedAction()
    var query by remember { mutableStateOf(state.query) }
    LaunchedEffect(state.query) { if (query != state.query) query = state.query }
    val changed: (String) -> Unit = { query = it; action("search", value = it) }
    val accessible = modifier.semantics { contentDescription = "トークを検索" }
    when (state.mode) {
        "fluent" -> FluentTextField(value = query, onValueChange = changed, modifier = accessible, singleLine = true,
            placeholder = { Label("検索", 14, color = LocalSecondaryInk.current, modifier = Modifier.fillMaxWidth()) },
            leadingIcon = { Glyph(FluentIcons.Regular.Search, LocalSecondaryInk.current, 16) })
        "miuix" -> MiuixTextField(value = query, onValueChange = changed, modifier = accessible, singleLine = true, label = "検索", useLabelAsPlaceholder = true,
            textStyle = TextStyle(fontSize = 15.sp, color = LocalInk.current),
            leadingIcon = { Glyph(FluentIcons.Regular.Search, LocalSecondaryInk.current, 18) })
        else -> BasicTextField(value = query, onValueChange = changed, singleLine = true,
            modifier = accessible.clip(CircleShape).background(if (glass) Color.Transparent else LocalSecondaryInk.current.copy(alpha = .08f)).padding(start = 13.dp, end = 8.dp).height(if (glass) 48.dp else 44.dp),
            textStyle = TextStyle(fontSize = if (glass) 17.sp else 15.sp, color = LocalInk.current), cursorBrush = SolidColor(LocalAccent.current),
            decorationBox = { input -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                AppleGlyph(AppleSymbol.Search, LocalSecondaryInk.current, 24)
                Box(Modifier.weight(1f)) { if (query.isEmpty()) Label("検索", if (glass) 17 else 15, color = LocalSecondaryInk.current); input() }
                if (onFilter != null) Box(Modifier.size(28.dp).clip(CircleShape).combinedClickable(onClick = onFilter).semantics { contentDescription = "トークのフィルタ" }, contentAlignment = Alignment.Center) {
                    AppleGlyph(AppleSymbol.Filter, LocalSecondaryInk.current, 24)
                }
            } })
    }
}

@Composable
private fun FilterTabs(state: SidebarSnapshot, modifier: Modifier = Modifier) {
    val action = rememberScopedAction()
    Row(modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp).semantics { selectableGroup() }, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        state.tabs.forEach { tab ->
            val selected = tab.id == state.tab
            Box(Modifier.clip(CircleShape).background(if (selected) LocalAccent.current else Color.Transparent)
                .combinedClickable(onClick = { action("tab", id = tab.id) }).semantics { role = Role.Tab; this.selected = selected }
                .padding(horizontal = 15.dp, vertical = 10.dp)) {
                Label(tab.label, 12, FontWeight.SemiBold, color = if (selected) Color.White else LocalAccent.current)
            }
        }
    }
}

@Composable
private fun Conversation(state: SidebarSnapshot, row: ConversationRow, phone: Boolean = false) {
    val action = rememberScopedAction()
    val density = LocalDensity.current.density
    var bounds by remember { mutableStateOf(Rect.Zero) }
    var focused by remember { mutableStateOf(false) }
    val context = { action("context", id = row.id, x = (bounds.right - 24f) / density, y = bounds.center.y / density) }
    val accessible = Modifier.onGloballyPositioned { bounds = it.boundsInWindow() }.onFocusChanged { focused = it.hasFocus }
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
        }.border(if (focused) 2.dp else 0.dp, if (focused) LocalAccent.current else Color.Transparent, RoundedCornerShape(if (state.mode == "miuix") 20.dp else 12.dp))
    val selectedBackground = when {
        !row.selected -> Color.Transparent
        state.mode == "apple" -> Color(0xFF0088FF)
        else -> LocalAccent.current.copy(alpha = .12f)
    }
    when (state.mode) {
        "fluent" -> FluentListItem(selected = row.selected, onSelectedChanged = { action("open", id = row.id) },
            modifier = accessible.padding(horizontal = 6.dp),
            text = { Row(Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) { Avatar(row, 32); Box(Modifier.weight(1f)) { RowText(row, false) } } },
            trailing = { RowTrailing(row, context, compact = true) })
        "miuix" -> MiuixCard(modifier = accessible.padding(horizontal = 12.dp), onClick = { action("open", id = row.id) }, onLongPress = context,
            insideMargin = PaddingValues(0.dp)) {
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
                CompositionLocalProvider(LocalInk provides if (row.selected) Color.White else LocalInk.current,
                    LocalSecondaryInk provides if (row.selected) Color.White.copy(alpha = .70f) else LocalSecondaryInk.current) {
                    Box(Modifier.weight(1f)) { RowText(row, true, phone) }
                    RowTrailing(row, context, compact = false, blueSelection = row.selected, apple = true, phone = phone, modifier = Modifier.align(Alignment.Top))
                }
            }
            Box(Modifier.padding(start = 74.dp, end = 10.dp).fillMaxWidth().height(.5.dp).background(LocalSecondaryInk.current.copy(alpha = .15f)))
        }
    }
}

@Composable
private fun RowText(row: ConversationRow, apple: Boolean, phone: Boolean = false) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(if (phone) 2.dp else 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Label(row.title, if (phone) 17 else if (apple) 16 else 14, if (row.unread > 0 || apple) FontWeight.SemiBold else FontWeight.Medium, modifier = Modifier.weight(1f, fill = false))
            if (row.pinned) { if (apple) AppleGlyph(AppleSymbol.Pin, LocalSecondaryInk.current, 16) else Glyph(FluentIcons.Regular.Pin, LocalSecondaryInk.current, 11) }
            if (row.locked) Glyph(FluentIcons.Regular.Key, LocalSecondaryInk.current, 11)
        }
        Label(row.preview, if (phone) 15 else if (apple) 13 else 12, color = LocalSecondaryInk.current, maxLines = if (apple) 2 else 1)
    }
}

@Composable
private fun RowTrailing(row: ConversationRow, context: () -> Unit, compact: Boolean, blueSelection: Boolean = false, apple: Boolean = false, phone: Boolean = false, modifier: Modifier = Modifier) {
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(5.dp), modifier = modifier.widthIn(min = if (compact) 40.dp else 44.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Label(row.time, if (phone) 11 else 10, color = LocalSecondaryInk.current)
            if (phone) AppleGlyph(AppleSymbol.ChevronRight, LocalSecondaryInk.current.copy(alpha = .5f), 16)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            if (row.unread > 0) Box(Modifier.clip(CircleShape).background(if (blueSelection) Color.White else if (row.muted) LocalSecondaryInk.current else LocalAccent.current).padding(horizontal = 6.dp, vertical = 2.dp)) {
                Label(if (row.unread > 99) "99+" else row.unread.toString(), 10, FontWeight.SemiBold, if (blueSelection) LocalAccent.current else Color.White)
            }
            if (!apple) Box(Modifier.size(30.dp).clip(CircleShape).combinedClickable(onClick = context, role = Role.Button)
                .semantics { contentDescription = "${row.title}のメニュー" }, contentAlignment = Alignment.Center) {
                Glyph(FluentIcons.Regular.MoreHorizontal, LocalSecondaryInk.current, 16)
            }
        }
    }
}

@Composable
internal fun Command(mode: String, icon: ImageVector, label: String, command: String, enabled: Boolean = true, selected: Boolean = false) {
    val action = rememberScopedAction()
    val modifier = Modifier.size(40.dp).semantics { contentDescription = label; this.selected = selected }
    val ink = if (enabled) LocalAccent.current else LocalSecondaryInk.current.copy(alpha = .45f)
    when (mode) {
        "fluent" -> FluentButton(onClick = { action(command) }, modifier = modifier, disabled = !enabled) { Glyph(icon, ink, description = if (mode == "fluent") label else null) }
        "miuix" -> MiuixIconButton(onClick = { action(command) }, modifier = modifier, enabled = enabled) { Glyph(icon, ink, description = if (mode == "fluent") label else null) }
        else -> Box(modifier.clip(CircleShape).background(if (selected) LocalAccent.current.copy(alpha = .14f) else Color.Transparent)
            .combinedClickable(enabled = enabled, role = Role.Button, onClick = { action(command) }), contentAlignment = Alignment.Center) { AppleControlGlyph(icon, ink) }
    }
}

@Composable
internal fun LocalIconButton(icon: ImageVector, label: String, mode: String, selected: Boolean = false, onClick: () -> Unit) {
    val modifier = Modifier.size(40.dp).semantics { contentDescription = label; this.selected = selected }
    val ink = LocalAccent.current
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
    BasicText(text, modifier = modifier, style = TextStyle(color = color, fontSize = size.sp, fontWeight = weight, lineHeight = (size + 4).sp), maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}
