@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class, io.github.composefluent.ExperimentalFluentApi::class, kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.onPointerEvent
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
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
import com.kyant.backdrop.shadow.Shadow
import com.kyant.shapes.RoundedRectangle
import kotlinx.coroutines.launch
import io.github.composefluent.component.AccentButton
import io.github.composefluent.component.Button as FluentButton
import io.github.composefluent.component.TextField as FluentTextField
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.*
import top.yukonga.miuix.kmp.basic.Button as MiuixButton
import top.yukonga.miuix.kmp.basic.TextField as MiuixTextField
import top.yukonga.miuix.kmp.basic.SmallTopAppBar

@Composable
fun ChatScreen(state: SidebarSnapshot, split: Boolean) {
    val action = rememberScopedAction()
    val chat = state.chat ?: return
    val backdrop = rememberLayerBackdrop()
    val density = LocalDensity.current
    var headerHeight by remember { mutableStateOf(if (state.mode == "apple") 90.dp else 64.dp) }
    var composerHeight by remember { mutableStateOf(94.dp) }
    var menuSelection by remember { mutableStateOf<ChatMessage?>(null) }
    val menuMessage = remember(state.messages, menuSelection) { menuSelection?.let { selected -> state.messages.find {
        it.id == selected.id && (!it.messageState.startsWith("revoked") || it.messageState == selected.messageState)
    } }
    }
    val messageBounds = remember(chat.id) { mutableMapOf<String, Rect>() }
    var screenOrigin by remember { mutableStateOf(Offset.Zero) }
    var mediaMessageId by remember { mutableStateOf<String?>(null) }
    val mediaMessage = remember(state.messages, mediaMessageId) { mediaMessageId?.let { id ->
        state.messages.find { it.id == id && (!it.messageState.startsWith("revoked") || it.revokedNotice != null) }
    } }
    LaunchedEffect(menuSelection, menuMessage, mediaMessageId, mediaMessage) {
        if (menuMessage == null) menuSelection = null
        if (mediaMessage == null) mediaMessageId = null
    }
    val detailsVisible = state.mode == "apple" && state.profileOpen
    val surface = when {
        state.dark && state.mode == "apple" -> Color(0xFF050506)
        state.dark -> Color(0xFF171719)
        state.mode == "miuix" -> Color(0xFFF4F5F8)
        state.mode == "fluent" -> Color(0xFFFAFAFA)
        else -> Color.White
    }
    BoxWithConstraints(Modifier.fillMaxSize().onGloballyPositioned { screenOrigin = it.positionInWindow() }) {
        val inlineDetails = maxWidth >= 740.dp
        Row(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxHeight().background(surface)) {
        MessageTimeline(state, backdrop,
            headerHeight, composerHeight, messageBounds,
            htmlVisible = menuMessage == null && mediaMessage == null && state.readersPanel == null && state.hostMenu == null && (!detailsVisible || inlineDetails),
            onMenu = { menuSelection = it }, onMedia = { mediaMessageId = it.id })
        Column(Modifier.fillMaxWidth().onSizeChanged { headerHeight = with(density) { it.height.toDp() } }) {
        ChatHeader(state, split, backdrop, Modifier.fillMaxWidth()) {
            if (state.mode == "apple") {
                action(if (detailsVisible) "close-details" else "chat-details")
            } else action("profile", id = chat.id)
        }
        ChatAuxiliary(state, backdrop)
        }
        NativeComposer(state, backdrop, compact = !split, modifier = Modifier.align(Alignment.BottomCenter).widthIn(max = when (state.mode) { "apple" -> 1200.dp; "fluent" -> 1100.dp; else -> 920.dp }).fillMaxWidth()
            .onSizeChanged { composerHeight = with(density) { it.height.toDp() } })
        if (state.notice.isNotBlank()) Box(Modifier.align(Alignment.TopCenter).padding(top = headerHeight + 8.dp)
            .clip(RoundedCornerShape(12.dp)).background(LocalInk.current.copy(alpha = .90f)).padding(horizontal = 18.dp, vertical = 12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite }) { Label(state.notice, 13, color = surface, maxLines = 3) }
        menuMessage?.let { message -> key(message.id) { MessageActions(state, message, backdrop, messageBounds[message.id]?.translate(-screenOrigin), onDismiss = { menuSelection = null }) } }
        mediaMessage?.let { message -> MediaViewer(message, state.mode, onDismiss = { mediaMessageId = null }) }        }
        if (detailsVisible && inlineDetails) Box(Modifier.width(320.dp).fillMaxHeight()) { AppleDetails(state, backdrop) { action("close-details") } }
        }
        if (detailsVisible && !inlineDetails) AppleDetails(state, backdrop) { action("close-details") }
        if (state.readersPanel != null) NativeReadersPanel(state, backdrop) { action("close-readers") }
    }
}

@Composable
private fun ChatHeader(state: SidebarSnapshot, split: Boolean, backdrop: Backdrop, modifier: Modifier, onDetails: () -> Unit) {
    val action = rememberScopedAction()
    val chat = state.chat ?: return
    val surface = if (state.dark) Color(0xFF222225) else Color(0xFFF9FAFC)
    val avatar = ConversationRow(chat.id, chat.title, avatar = chat.avatar, color = chat.color, avatarUrl = chat.avatarUrl)
    when (state.mode) {
        "apple" -> BoxWithConstraints(modifier.height(122.dp)) {
            val titleWidth = (maxWidth - 96.dp).coerceAtMost(360.dp)
            val nameMotion = rememberAppleLiquidMotion(enabled = true, reducedMotion = state.reducedMotion)
            if (!split) AppleGlassIcon(backdrop, AppleSymbol.Back, "トーク一覧に戻る", Modifier.align(Alignment.TopStart).padding(start = 12.dp, top = 12.dp), dark = state.dark) { action("back") }
            else AppleGlassIcon(backdrop, AppleSymbol.Filter, if (state.sidebarCollapsed) "サイドバーを開く" else "サイドバーを閉じる", Modifier.align(Alignment.TopStart).padding(start = 12.dp, top = 12.dp), dark = state.dark) { action("sidebar-toggle") }
            Column(Modifier.align(Alignment.TopCenter).padding(top = 10.dp).widthIn(max = titleWidth)
                .clickable(interactionSource = nameMotion.interactionSource, indication = null, role = Role.Button, onClick = onDetails)
                .semantics { contentDescription = "${chat.title}の情報" }, horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(avatar, 60, gradient = true)
                Spacer(Modifier.height(2.dp))
                Row(Modifier.widthIn(max = titleWidth)
                    .appleLiquidBackdrop(nameMotion, backdrop, { CircleShape }, surface.copy(alpha = .90f), blurRadius = 9.dp, lensRadius = 7.dp, lensHeight = 14.dp)
                    .then(nameMotion.pointerModifier).padding(horizontal = 12.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Label(chat.title, 16, FontWeight.Bold, modifier = Modifier.weight(1f, fill = false))
                    AppleGlyph(AppleSymbol.ChevronRight, LocalSecondaryInk.current.copy(alpha = .65f), 18)
                }
            }
            if (!split) AppleGlassIcon(backdrop, AppleSymbol.Video, "ビデオ通話", Modifier.align(Alignment.TopEnd).padding(end = 16.dp, top = 12.dp), enabled = chat.canCall && !chat.isGroup, dark = state.dark) { action("call", id = chat.id, value = "video") }
            else AppleGlassIcon(backdrop, AppleSymbol.Filter, "トークの操作", Modifier.align(Alignment.TopEnd).padding(end = 16.dp, top = 12.dp), dark = state.dark) { action("chat-menu") }
        }
        "miuix" -> SmallTopAppBar(title = chat.title, modifier = modifier, color = surface,
            navigationIcon = { Row(verticalAlignment = Alignment.CenterVertically) {
                if (!split) Command(state.mode, Icons.Regular.ChevronLeft, "トーク一覧に戻る", "back")
                else Command(state.mode, Icons.Regular.MoreHorizontal, if (state.sidebarCollapsed) "サイドバーを開く" else "サイドバーを閉じる", "sidebar-toggle")
                Box(Modifier.combinedClickable(onClick = { action("profile", id = chat.id) }).semantics { contentDescription = "${chat.title}の情報" }) { Avatar(avatar, 30) }
            } },
            actions = { Row { Command(state.mode, Icons.Regular.Search, "トーク内を検索", "chat-search"); Command(state.mode, Icons.Regular.MoreHorizontal, "トークの操作", "chat-menu"); Command(state.mode, Icons.Regular.Settings, "設定", "settings") } }, defaultWindowInsetsPadding = false)
        else -> Row(modifier.background(surface).padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!split) Command(state.mode, Icons.Regular.ArrowLeft, "トーク一覧に戻る", "back")
            else Command(state.mode, Icons.Regular.MoreHorizontal, if (state.sidebarCollapsed) "サイドバーを開く" else "サイドバーを閉じる", "sidebar-toggle")
            Box(Modifier.combinedClickable(role = Role.Button, onClick = { action("profile", id = chat.id) }).semantics { contentDescription = "${chat.title}のプロフィール" }) { Avatar(avatar, 38) }
            Column(Modifier.weight(1f).combinedClickable(onClick = { action("profile", id = chat.id) }).semantics { contentDescription = "${chat.title}の情報" }, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Label(chat.title, 18, FontWeight.SemiBold)
                if (chat.status.isNotBlank()) Label(chat.status, 11, color = LocalSecondaryInk.current)
            }
            Command(state.mode, Icons.Regular.Search, "トーク内を検索", "chat-search")
            Command(state.mode, Icons.Regular.MoreHorizontal, "トークの操作", "chat-menu")
            Command(state.mode, Icons.Regular.Settings, "設定", "settings")
        }
    }
}

@Composable
private fun MessageTimeline(state: SidebarSnapshot,
    backdrop: com.kyant.backdrop.backdrops.LayerBackdrop, top: androidx.compose.ui.unit.Dp, bottom: androidx.compose.ui.unit.Dp, messageBounds: MutableMap<String, Rect>, htmlVisible: Boolean, onMenu: (ChatMessage) -> Unit, onMedia: (ChatMessage) -> Unit) {
    val action = rememberScopedAction()
    val messages = state.messages
    val mode = state.mode
    val dark = state.dark
    val settings = state.settings
    val history = state.history
    val chat = state.chat ?: return
    val group = chat.isGroup
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var userScrollAt by remember { mutableDoubleStateOf(Double.NEGATIVE_INFINITY) }
    var olderBoundaryArmed by remember { mutableStateOf(false) }
    var historyAnchor by remember { mutableStateOf<Triple<String, Int, String?>?>(null) }
    var historyAnchorTop by remember { mutableStateOf<Float?>(null) }
    var historyWasLoading by remember { mutableStateOf(false) }
    val currentHistory by rememberUpdatedState(history)
    val currentMessages by rememberUpdatedState(messages)
    fun requestOlder() {
        list.layoutInfo.visibleItemsInfo.firstOrNull { it.key is String }?.let {
            historyAnchor = Triple(it.key as String, it.offset, currentMessages.firstOrNull()?.id)
            historyAnchorTop = messageBounds[it.key]?.top
            historyWasLoading = false
        }
        action("load-older")
    }
    fun nearEnd(): Boolean = list.layoutInfo.let { info ->
        info.visibleItemsInfo.lastOrNull()?.let {
            it.index == info.totalItemsCount - 1 &&
                it.offset + it.size <= info.viewportEndOffset - info.afterContentPadding + 80
        } ?: true
    }
    var lastSeen by remember { mutableStateOf<String?>(null) }
    val lastMessage = messages.lastOrNull()
    // Read the old measured viewport during composition, before a larger message
    // or composer is laid out. Measuring first would lose the user's end position.
    val followMessageUpdate = remember(lastMessage) {
        lastSeen == null || nearEnd() || lastSeen != lastMessage?.id && lastMessage?.authorId == "me"
    }
    LaunchedEffect(list) {
        snapshotFlow { list.firstVisibleItemIndex to list.firstVisibleItemScrollOffset }.collect { (index, offset) ->
            if (index > 1 || offset > 240) olderBoundaryArmed = true
            else if (index == 0 && offset <= 80 && olderBoundaryArmed && messageInteractionNow() - userScrollAt < 1500 && currentHistory.hasMore && !currentHistory.loading) {
                olderBoundaryArmed = false
                requestOlder()
            }
        }
    }
    val density = LocalDensity.current.density
    // Lazy item offsets exclude the leading content padding. Retain the visible
    // keys: end clamping can evict the first item when the header shrinks.
    // One effect handles both heights so anchoring cannot undo end-following.
    var previousBottom by remember { mutableStateOf(bottom) }
    val followLayoutResize = remember(top, bottom) { bottom != previousBottom && nearEnd() }
    SideEffect { previousBottom = bottom }
    val layoutAnchor = remember(top, bottom) {
        list.layoutInfo.let { info -> info.visibleItemsInfo.filter { it.key is String }
            .map { it.key to it.offset + info.beforeContentPadding } to info.beforeContentPadding }
    }
    LaunchedEffect(top, bottom) {
        withFrameNanos {}
        if (followLayoutResize && currentMessages.isNotEmpty()) {
            userScrollAt = Double.NEGATIVE_INFINITY
            list.scrollToItem(currentMessages.lastIndex + if (currentHistory.hasMore || currentHistory.loading) 1 else 0)
            return@LaunchedEffect
        }
        val info = list.layoutInfo
        val displacement = layoutAnchor.first.firstNotNullOfOrNull { (key, position) ->
            info.visibleItemsInfo.find { it.key == key }?.let { it.offset + info.beforeContentPadding - position }
        } ?: (info.beforeContentPadding - layoutAnchor.second)
        if (displacement != 0) {
            userScrollAt = Double.NEGATIVE_INFINITY
            list.scrollBy(displacement.toFloat())
        }
    }
    var timelineBounds by remember { mutableStateOf(Rect.Zero) }
    val htmlViewport = HtmlViewport(Rect(timelineBounds.left, timelineBounds.top + top.value,
        timelineBounds.right, timelineBounds.bottom - bottom.value), htmlVisible)
    LaunchedEffect(messages.firstOrNull()?.id, history.loading) {
        val anchor = historyAnchor ?: return@LaunchedEffect
        if (messages.firstOrNull()?.id != anchor.third) {
            val index = messages.indexOfFirst { it.id == anchor.first }
            if (index >= 0) {
                userScrollAt = Double.NEGATIVE_INFINITY
                list.scrollToItem(index + if (history.hasMore || history.loading) 1 else 0, -anchor.second)
                // The first item can lose its date/sender header after a prepend.
                // Retain the bubble's position as well as the LazyColumn item key.
                withFrameNanos {}; withFrameNanos {}
                val previousTop = historyAnchorTop
                val currentTop = messageBounds[anchor.first]?.top
                if (previousTop != null && currentTop != null) list.scrollBy(currentTop - previousTop)
            }
            historyAnchor = null
        } else if (history.loading) historyWasLoading = true
        else if (historyWasLoading) historyAnchor = null
    }
    val searchTarget = state.chatUi?.search?.activeId
    LaunchedEffect(state.highlightMessageId) {
        val index = messages.indexOfFirst { it.id == state.highlightMessageId }
        if (index >= 0) { userScrollAt = Double.NEGATIVE_INFINITY; list.scrollToItem(index + if (history.hasMore || history.loading) 1 else 0) }
    }
    LaunchedEffect(searchTarget) {
        val index = messages.indexOfFirst { it.id == searchTarget }
        if (index >= 0) { userScrollAt = Double.NEGATIVE_INFINITY; list.scrollToItem(index + if (history.hasMore || history.loading) 1 else 0) }
    }
    LaunchedEffect(state.scrollLatest) {
        if (state.scrollLatest > 0 && messages.isNotEmpty()) { userScrollAt = Double.NEGATIVE_INFINITY; list.scrollToItem(messages.lastIndex + if (history.hasMore || history.loading) 1 else 0) }
    }
    LaunchedEffect(lastMessage) {
        val last = lastMessage ?: return@LaunchedEffect
        if (followMessageUpdate) {
            userScrollAt = Double.NEGATIVE_INFINITY
            list.scrollToItem(messages.lastIndex + if (history.hasMore || history.loading) 1 else 0)
        }
        lastSeen = last.id
    }
    CompositionLocalProvider(LocalHtmlViewport provides htmlViewport) {
    Box(Modifier.fillMaxSize()) {
    LazyColumn(state = list, modifier = Modifier.fillMaxSize().layerBackdrop(backdrop)
        .onPointerEvent(PointerEventType.Scroll) { userScrollAt = messageInteractionNow() }
        .onPointerEvent(PointerEventType.Move) { event -> if (event.changes.any { it.type == PointerType.Touch && it.pressed && it.position != it.previousPosition }) userScrollAt = messageInteractionNow() }
        .onGloballyPositioned { val bounds = it.boundsInWindow(); timelineBounds = Rect(bounds.left / density, bounds.top / density, bounds.right / density, bounds.bottom / density) }
        .semantics { contentDescription = "メッセージ履歴" },
        contentPadding = PaddingValues(top = top + 16.dp, bottom = bottom + 14.dp, start = if (mode == "fluent") 24.dp else 16.dp, end = if (mode == "fluent") 24.dp else 16.dp),
        verticalArrangement = Arrangement.spacedBy(if (settings.compactDensity) 3.dp else if (mode == "apple") 4.dp else 5.dp)) {
        if (history.hasMore || history.loading) item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            NativeButton(mode, if (history.loading) "読み込み中…" else "以前のメッセージ", enabled = !history.loading, onClick = ::requestOlder)
        } }
        itemsIndexed(messages, key = { _, message -> message.id }) { index, message ->
            val day = remember(message.createdAt) { calendarDay(message.createdAt.toDouble()) }
            val previousTime = messages.getOrNull(index - 1)?.createdAt
            val previousDay = remember(previousTime) { previousTime?.let { calendarDay(it.toDouble()) } }
            if (index == 0 || day != previousDay || mode == "apple" && previousTime != null && message.createdAt - previousTime > 900_000) Box(Modifier.fillMaxWidth().padding(vertical = 14.dp), contentAlignment = Alignment.Center) {
                Label(if (mode == "apple") calendarMoment(message.createdAt.toDouble()) else day, if (mode == "apple") 12 else 11, FontWeight.Medium, color = LocalSecondaryInk.current)
            }
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Box(Modifier.widthIn(max = if (mode == "fluent") 1080.dp else 920.dp).fillMaxWidth()
                    .then(if (message.id == searchTarget || message.id == state.highlightMessageId) Modifier.background(LocalAccent.current.copy(alpha = .09f)) else Modifier)) {
                    if (message.hostContent) Box(Modifier.fillMaxWidth(), contentAlignment = if (message.authorId == "me") Alignment.CenterEnd else Alignment.CenterStart) {
                        NativeHostContent(message.id, state.epoch, chat.id, state.hostContentHeights[message.id])
                    } else MessageCell(message, mode, dark, settings, group, messageBounds, onMenu, onMedia)
                }
            }
        }
    }
    if (list.canScrollForward && !nearEnd()) NativeButton(mode, "最新のメッセージへ", Modifier.align(Alignment.BottomEnd).padding(end = 18.dp, bottom = bottom + 14.dp)) {
        userScrollAt = Double.NEGATIVE_INFINITY
        scope.launch { list.scrollToItem(messages.lastIndex.coerceAtLeast(0) + if (history.hasMore || history.loading) 1 else 0) }
    }
    }
}

}

private fun messageInteractionNow(): Double = js("performance.now()")

@Composable
private fun MessageCell(message: ChatMessage, mode: String, dark: Boolean, settings: SettingsModel, group: Boolean, messageBounds: MutableMap<String, Rect>, onMenu: (ChatMessage) -> Unit, onMedia: (ChatMessage) -> Unit) {
    val action = rememberScopedAction()
    val mine = message.authorId == "me"
    var swipeOffset by remember(message.id) { mutableFloatStateOf(0f) }
    var linkGesture by remember(message.id) { mutableStateOf(false) }
    val messageFocus = remember(message.id) { FocusRequester() }
    val inputMode = LocalInputModeManager.current
    val profile = { action("reader-profile", id = message.authorId) }
    val revoked = message.messageState.startsWith("revoked")
    val system = message.kind == "system" || (revoked && message.revokedNotice == null)
    if (system) {
        Box(Modifier.fillMaxWidth().padding(vertical = 10.dp)
            .then(if (message.messageState.startsWith("revoked")) Modifier.combinedClickable(onClick = { onMenu(message) }, onLongClick = { onMenu(message) }) else Modifier), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Label(message.text, 12, color = LocalSecondaryInk.current, maxLines = 5)
                if (revoked) Label(message.revokedNotice ?: if (mine) "あなたが送信を取り消しました" else "送信が取り消されました", 11, color = LocalSecondaryInk.current)
                Label(message.time, 10, color = LocalSecondaryInk.current)
            }
        }
        return
    }
    val readersAvailable = group && settings.showReaderList && (!revoked || message.readCount > 0) && message.status !in listOf("sending", "pending") && !message.id.startsWith("pending_")
    val bubble = when {
        message.kind == "sticker" -> Color.Transparent
        mode == "apple" && mine -> Color(0xFF007AFF)
        mode == "apple" -> if (dark) Color(0xFF28282A) else Color(0xFFE9E9EB)
        mode == "fluent" && mine -> if (dark) Color(0xFF163F61) else Color(0xFFE0EEFA)
        mode == "fluent" -> if (dark) Color(0xFF29292C) else Color.White
        mine -> if (dark) Color(0xFF15426E) else Color(0xFFD9EBFF)
        else -> if (dark) Color(0xFF252529) else Color.White
    }
    val contentColor = if (mode == "apple" && mine) Color.White else LocalInk.current
    val shape = if (mode == "apple") RoundedRectangle(21.dp) else RoundedCornerShape(if (mode == "fluent") 5.dp else 22.dp)
    Row(Modifier.fillMaxWidth().padding(top = if (message.groupStart) 10.dp else 0.dp), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom) {
        if (!mine && (group || mode != "apple")) {
            if (message.groupEnd) Box(Modifier.combinedClickable(enabled = group, role = Role.Button, onClick = profile).semantics { contentDescription = "${message.authorName}のプロフィール" }) {
                Avatar(ConversationRow(message.authorId, message.authorName, avatar = message.avatar, color = message.color, avatarUrl = message.avatarUrl), if (mode == "fluent") 30 else 28)
            }
            else Spacer(Modifier.width(if (mode == "fluent") 30.dp else 28.dp))
            Spacer(Modifier.width(8.dp))
        }
        BoxWithConstraints(Modifier.weight(1f, fill = false)) {
            val maximum = (maxWidth * if (mode == "apple") .78f else .86f).coerceAtMost(if (mode == "fluent") 640.dp else 520.dp)
            Column(Modifier.widthIn(max = maximum), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                if (!mine && group && message.groupStart) Label(message.authorName, 11, FontWeight.Medium, color = LocalSecondaryInk.current, modifier = Modifier.combinedClickable(role = Role.Button, onClick = profile).semantics { contentDescription = "${message.authorName}のプロフィール" }.padding(start = 10.dp, bottom = 5.dp))
                Column(Modifier.onGloballyPositioned { messageBounds[message.id] = it.boundsInWindow() }.drawBehind {
                    if (mode == "apple" && settings.bubbleTail && message.groupEnd && message.kind == "text") {
                        val unit = density
                        val w = size.width; val h = size.height
                        val path = Path().apply {
                            if (mine) {
                                moveTo(w - 14 * unit, h - 20 * unit)
                                cubicTo(w - 8 * unit, h - 5 * unit, w - unit, h + unit, w + 6 * unit, h)
                                cubicTo(w - 4 * unit, h + 2 * unit, w - 12 * unit, h - unit, w - 18 * unit, h - 6 * unit)
                            } else {
                                moveTo(14 * unit, h - 20 * unit)
                                cubicTo(8 * unit, h - 5 * unit, unit, h + unit, -6 * unit, h)
                                cubicTo(4 * unit, h + 2 * unit, 12 * unit, h - unit, 18 * unit, h - 6 * unit)
                            }
                            close()
                        }
                        drawPath(path, bubble)
                    }
                }.onPointerEvent(PointerEventType.Press, androidx.compose.ui.input.pointer.PointerEventPass.Initial) { linkGesture = false }
                    .then(if (revoked) Modifier else Modifier.messageSwipeReply(message.id, { linkGesture }, { swipeOffset = it }) { action("reply", id = message.id) })
                    .graphicsLayer { translationX = swipeOffset }.clip(shape).background(bubble)
                    .focusRequester(messageFocus)
                    .onPreviewKeyEvent { event ->
                        if (event.type == KeyEventType.KeyDown && (event.key == Key.Menu || event.key == Key.F10 && event.isShiftPressed)) { onMenu(message); true } else false
                    }
                    .combinedClickable(onClick = {}, onDoubleClick = { onMenu(message) }, onLongClick = { onMenu(message) })
                    .onPointerEvent(PointerEventType.Press) {
                        // Foundation's combinedClickable does not request mouse focus.
                        if (it.changes.any { change -> change.type == PointerType.Mouse }) {
                            inputMode.requestInputMode(InputMode.Keyboard)
                            messageFocus.requestFocus()
                        }
                        if (it.buttons.isSecondaryPressed) onMenu(message)
                    }
                    .semantics { stateDescription = "${message.time} ${message.revokedNotice ?: if (mine) deliveryState(message, group) else message.authorName}"; customActions = buildList { if (!revoked) add(CustomAccessibilityAction("返信") { action("reply", id = message.id); true }); add(CustomAccessibilityAction("メッセージの操作") { onMenu(message); true }) } }
                    .padding(horizontal = if (mode == "apple") 15.dp else 14.dp, vertical = if (settings.compactDensity) 6.dp else if (mode == "apple") 8.dp else 10.dp)) {
                    message.replyText?.let { quote -> Row(Modifier.fillMaxWidth().padding(bottom = 8.dp).heightIn(min = 26.dp)
                        .combinedClickable(enabled = message.replyToId != null, onClick = { action("jump-message", id = message.replyToId) })
                        .semantics { contentDescription = "返信先へ移動" }, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.width(3.dp).height(30.dp).background(contentColor.copy(alpha = .5f)))
                        Label(quote, 12, color = contentColor.copy(alpha = .75f), maxLines = 2)
                    } }
                    if (message.mediaUrl != null && message.kind in listOf("image", "video", "audio", "sticker")) NativeMedia(message, onContext = { onMenu(message) }) { onMedia(message) }
                    if (message.text.isNotBlank() && message.kind != "sticker") NativeRichText(message.text, message.segments, style = TextStyle(color = contentColor,
                        fontSize = ((if (mode == "apple") 17 else 15) * settings.fontScale).sp, lineHeight = ((if (mode == "apple") 22 else 21) * settings.fontScale).sp),
                        mentionColor = if (mine && mode == "apple") Color.White else LocalAccent.current, onLinkPress = { linkGesture = true })
                    if (message.kind != "text" && message.text.isBlank() && message.mediaUrl == null) Label(message.fileName ?: when (message.kind) { "image" -> "画像"; "video" -> "動画"; "audio" -> "音声メッセージ"; "sticker" -> "スタンプ"; else -> "添付メッセージ" }, 14, color = contentColor)
                }
                message.revokedNotice?.let { Label(it, 11, color = LocalSecondaryInk.current, maxLines = 2,
                    modifier = Modifier.padding(top = 5.dp, start = 10.dp, end = 10.dp).semantics { liveRegion = LiveRegionMode.Polite }) }
                if (!revoked && message.reactions.isNotEmpty()) Row(Modifier.padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    message.reactions.forEach { reaction -> Box(Modifier.clip(CircleShape).background(LocalAccent.current.copy(alpha = if (reaction.selected) .18f else .08f))
                        .combinedClickable(enabled = message.canReact, role = Role.Button, onClick = { action("react", id = message.id, value = reaction.type.toString()) }).semantics { contentDescription = "${reactionName(reaction.type)} ${reaction.count}件"; selected = reaction.selected }.padding(horizontal = 7.dp, vertical = 4.dp)) {
                        Label("${reactionSymbol(reaction.type)} ${reaction.count}", 11)
                    } }
                }
                if (message.edited || message.messageState == "edited") Label("編集済み", 11, color = if (mode == "apple") LocalAccent.current else LocalSecondaryInk.current,
                    modifier = Modifier.combinedClickable(role = Role.Button, onClick = { action("view-rich", id = message.id) }).semantics { contentDescription = "編集前のメッセージと履歴を表示" }.padding(top = 4.dp, start = 10.dp, end = 10.dp))
                Row(Modifier.padding(top = 4.dp, start = 10.dp, end = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Label(message.time, 10, color = LocalSecondaryInk.current)
                    if (mine && !revoked && (!readersAvailable || message.readCount == 0)) Label(deliveryState(message, group), 10, color = if (message.status == "failed") Color(0xFFE34E4E) else LocalSecondaryInk.current,
                        modifier = if (message.canRetry) Modifier.combinedClickable(role = Role.Button, onClick = { action("retry", id = message.id) }).semantics { contentDescription = "送信に失敗したメッセージを再送信" } else Modifier)
                }
                if (readersAvailable) {
                    Label("既読 ${message.readCount}", 11, color = LocalSecondaryInk.current, modifier = Modifier
                        .combinedClickable(role = Role.Button, onClick = { action("readers", id = message.id) })
                        .semantics { contentDescription = "既読者一覧 ${message.readCount}人" }
                        .padding(horizontal = 10.dp, vertical = 7.dp))
                }
            }
        }
    }
}

@Composable
private fun NativeComposer(state: SidebarSnapshot, backdrop: Backdrop, compact: Boolean, modifier: Modifier) {
    val action = rememberScopedAction()
    val chat = state.chat ?: return
    val host = state.composer
    var input by remember(chat.id) { mutableStateOf(TextFieldValue(host.text, TextRange(host.text.length))) }
    var awaitingEcho by remember(chat.id) { mutableStateOf<String?>(null) }
    var toolsOpen by remember { mutableStateOf(false) }
    var appearanceChoices by remember { mutableStateOf(false) }
    var mentionIndex by remember(host.mentionOptions) { mutableIntStateOf(host.mentionIndex) }
    var mentionsDismissed by remember(host.text) { mutableStateOf(false) }
    val pendingDraft = awaitingEcho
    SideEffect {
        if (host.text == pendingDraft) awaitingEcho = null
        // Host draft -> cleared draft can coalesce into one frame. Reconcile even when the String key is unchanged.
        if ((pendingDraft == null || host.text == pendingDraft) && host.text != input.text) {
            input = TextFieldValue(host.text, TextRange((host.selectionStart ?: host.text.length).coerceIn(0, host.text.length), (host.selectionEnd ?: host.text.length).coerceIn(0, host.text.length)))
        }
    }
    val change: (TextFieldValue) -> Unit = { value ->
        input = value; awaitingEcho = value.text
        action("draft", value = value.text, selectionStart = value.selection.start, selectionEnd = value.selection.end)
    }
    val disabled = chat.locked || chat.blocked || host.sending || !host.available
    val canSend = !disabled && if (host.pending.isNotEmpty()) host.canSendMedia else input.text.isNotBlank()
    val send = {
        if (canSend) {
            action("draft", value = input.text, selectionStart = input.selection.start, selectionEnd = input.selection.end)
            awaitingEcho = null
            action(if (host.pending.isNotEmpty()) "send-attachments" else "send")
        }
    }
    val surface = if (state.dark) Color(0xFF252529) else Color(0xFFFAFBFE)
    val outer = when (state.mode) {
        "apple" -> modifier.padding(horizontal = if (compact) 28.dp else 16.dp, vertical = if (compact) 26.dp else 10.dp)
        "miuix" -> modifier.padding(horizontal = 14.dp, vertical = 12.dp).clip(RoundedCornerShape(24.dp)).background(surface)
        else -> modifier.background(surface).border(1.dp, LocalSecondaryInk.current.copy(alpha = .14f)).padding(16.dp)
    }
    Column(outer.padding(if (state.mode == "miuix") 8.dp else 0.dp)) {
        if (host.segments.any { it.type == "sticon" }) Box(Modifier.clip(RoundedCornerShape(16.dp)).background(surface.copy(alpha = .96f)).padding(8.dp)) { ComposerEmojiPreview(host.segments) }
        if (host.pending.isNotEmpty()) Box(Modifier.clip(RoundedCornerShape(22.dp)).background(surface.copy(alpha = .97f))) { PendingFiles(state) }
        if (!mentionsDismissed && host.mentionOptions.isNotEmpty()) Box(Modifier.clip(RoundedCornerShape(22.dp)).background(surface.copy(alpha = .97f))) {
            MentionPicker(state, mentionIndex) { index -> awaitingEcho = null; action("mention", id = index.toString()) }
        }
        host.replyToId?.let { Row(Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(RoundedCornerShape(16.dp)).background(surface.copy(alpha = .96f)).padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Label("返信", 11, FontWeight.SemiBold, color = LocalAccent.current); Label(host.replyText ?: "メッセージ", 12, color = LocalSecondaryInk.current) }
            Command(state.mode, Icons.Regular.Dismiss, "返信をキャンセル", "cancel-reply")
        } }
        if (chat.locked || chat.blocked) Label(if (chat.locked) "このトークはロックされています" else "ブロック中の相手には送信できません", 12, color = LocalSecondaryInk.current, modifier = Modifier.padding(12.dp))
        else if (host.recording) Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(Color(0xFFEB4747)))
            Label("録音中 ${host.recordingSeconds.toInt() / 60}:${(host.recordingSeconds.toInt() % 60).toString().padStart(2, '0')}", 14, modifier = Modifier.weight(1f))
            NativeButton(state.mode, "取消") { action("record-cancel") }
            NativeButton(state.mode, "音声を送信", enabled = host.canSendMedia, primary = true) { action("record-stop") }
        } else {
            val field = Modifier.heightIn(min = if (state.mode == "apple") 34.dp else 42.dp).semantics { contentDescription = "メッセージを入力" }
                .onPreviewKeyEvent { event ->
                    if (event.type != KeyEventType.KeyDown || input.composition != null) false
                    else if (!mentionsDismissed && host.mentionOptions.isNotEmpty() && event.key == Key.DirectionDown) { mentionIndex = (mentionIndex + 1) % host.mentionOptions.size; true }
                    else if (!mentionsDismissed && host.mentionOptions.isNotEmpty() && event.key == Key.DirectionUp) { mentionIndex = (mentionIndex + host.mentionOptions.size - 1) % host.mentionOptions.size; true }
                    else if (!mentionsDismissed && host.mentionOptions.isNotEmpty() && (event.key == Key.Enter || event.key == Key.Tab)) { awaitingEcho = null; action("mention", id = mentionIndex.coerceIn(host.mentionOptions.indices).toString()); true }
                    else if (event.key == Key.Escape && !mentionsDismissed && host.mentionOptions.isNotEmpty()) { mentionsDismissed = true; true }
                    else if (event.key == Key.Escape && host.replyToId != null) { action("cancel-reply"); true }
                    else if (event.key == Key.Enter && !event.isShiftPressed && host.enterToSend && canSend) { send(); true } else false
                }
            if (state.mode == "apple") Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                val composerMotion = rememberAppleLiquidMotion(enabled = !disabled, reducedMotion = state.reducedMotion)
                AppleGlassIcon(backdrop, AppleSymbol.Plus, "添付とその他の操作", dark = state.dark) { toolsOpen = !toolsOpen }
                Row(Modifier.weight(1f)
                    .appleLiquidBackdrop(composerMotion, backdrop, { RoundedRectangle(25.dp) }, surface.copy(alpha = .82f), blurRadius = 14.dp, lensRadius = 9.dp, lensHeight = 16.dp)
                    .then(composerMotion.pointerModifier)
                    .padding(start = 15.dp, end = 6.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    BasicTextField(value = input, onValueChange = change, modifier = field.weight(1f).heightIn(min = 34.dp).padding(vertical = 6.dp), enabled = !disabled,
                        maxLines = 7, visualTransformation = SticonVisualTransformation, textStyle = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, color = LocalInk.current), cursorBrush = SolidColor(LocalAccent.current),
                        decorationBox = { text -> Box { if (input.text.isEmpty()) Label("メッセージ", 16, color = LocalSecondaryInk.current.copy(alpha = .6f)); text() } })
                    AnimatedContent(targetState = input.text.isNotEmpty() || host.pending.isNotEmpty(),
                        modifier = Modifier.align(Alignment.CenterVertically), transitionSpec = {
                            val duration = if (state.reducedMotion) 0 else 160
                            (fadeIn(tween(duration)) + scaleIn(tween(duration), initialScale = .82f)) togetherWith
                                (fadeOut(tween(duration)) + scaleOut(tween(duration), targetScale = .82f))
                        }, label = "送信ボタン") { hasContent ->
                    val buttonEnabled = if (hasContent) canSend else host.available && host.voiceEnabled
                    val sendMotion = rememberAppleLiquidMotion(enabled = buttonEnabled, reducedMotion = state.reducedMotion)
                    if (!hasContent) Box(Modifier.size(44.dp)
                        .appleLiquidBackdrop(sendMotion, backdrop, { CircleShape }, Color.Transparent, blurRadius = 2.dp)
                        .clickable(interactionSource = sendMotion.interactionSource, indication = null, enabled = buttonEnabled, role = Role.Button, onClick = { action("record-start") })
                        .then(sendMotion.pointerModifier)
                        .semantics { contentDescription = "音声メッセージを録音" }, contentAlignment = Alignment.Center) {
                        AppleGlyph(AppleSymbol.Microphone, LocalSecondaryInk.current.copy(alpha = .6f), 28)
                    } else Box(Modifier.size(44.dp)
                        .appleLiquidBackdrop(sendMotion, backdrop, { CircleShape }, if (canSend) Color(0xFF0088FF) else LocalSecondaryInk.current.copy(alpha = .12f), blurRadius = 2.dp)
                        .clickable(interactionSource = sendMotion.interactionSource, indication = null, enabled = canSend, role = Role.Button, onClick = send)
                        .then(sendMotion.pointerModifier).semantics { contentDescription = "送信" }, contentAlignment = Alignment.Center) {
                        AppleGlyph(AppleSymbol.Send, if (canSend) Color.White else LocalSecondaryInk.current, 28)
                    }
                    }
                }
            } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                when (state.mode) {
                    "fluent" -> FluentTextField(value = input, onValueChange = change, modifier = field.weight(1f), maxLines = 7, enabled = !disabled, visualTransformation = SticonVisualTransformation,
                        placeholder = { Label("メッセージを入力", 14, color = LocalSecondaryInk.current, modifier = Modifier.fillMaxWidth()) })
                    else -> MiuixTextField(value = input, onValueChange = change, modifier = field.weight(1f), maxLines = 7, enabled = !disabled, visualTransformation = SticonVisualTransformation,
                        label = "メッセージ", useLabelAsPlaceholder = true, textStyle = TextStyle(fontSize = 16.sp, color = LocalInk.current))
                }
                NativeButton(state.mode, if (host.sending) "送信中" else "送信", enabled = canSend, primary = true, onClick = send)
            }
            if (state.mode != "apple" || toolsOpen) NativeButton(state.mode, "ノート・アルバム・イベント", Modifier.padding(top = 5.dp)) { action("chat-tools") }
            if (state.mode == "apple" && toolsOpen) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                NativeButton(state.mode, "トーク内を検索") { action("chat-search"); toolsOpen = false }
                NativeButton(state.mode, "トークの操作") { action("chat-menu"); toolsOpen = false }
            }
            if (state.mode != "apple" || toolsOpen) Row(Modifier.padding(top = 6.dp).clip(RoundedCornerShape(18.dp)).background(surface.copy(alpha = .94f)), verticalAlignment = Alignment.CenterVertically) {
                Command(state.mode, Icons.Regular.Attach, "添付ファイルを選択", "attach", enabled = host.available && !host.sending)
                Command(state.mode, Icons.Regular.Heart, "スタンプと絵文字", "sticker-picker", enabled = host.available && !host.sending)
                NativeButton(state.mode, "音声", enabled = host.available && host.voiceEnabled && !host.sending) { action("record-start") }
                LocalIconButton(Icons.Regular.Alert, "通知せず送信", state.mode, selected = host.mute) { action("mute", value = (!host.mute).toString()) }
                if (state.mode == "apple") LocalIconButton(Icons.Regular.Settings, "設定", state.mode, selected = appearanceChoices) { appearanceChoices = !appearanceChoices }
                Spacer(Modifier.weight(1f))
                if (state.mode == "fluent") Label(if (host.enterToSend) "Shift + Enterで改行" else "Enterで改行", 10, color = LocalSecondaryInk.current)
            }
            if (state.mode == "apple" && toolsOpen && appearanceChoices) Column(Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(22.dp)).background(surface.copy(alpha = .97f)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Label("表示とテーマ", 13, FontWeight.SemiBold)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("apple" to "Messages", "fluent" to "Fluent", "miuix" to "Miuix", "nezu" to "NezuUI", "legacy" to "Classic").forEach { (id, label) ->
                        NativeButton(state.mode, label, primary = state.mode == id) { action("ui-mode", value = id) }
                    }
                }
                NativeButton(state.mode, "すべての設定", Modifier.fillMaxWidth()) { action("settings") }
            }
        }
    }
}

@Composable
internal fun NativeButton(mode: String, label: String, modifier: Modifier = Modifier, enabled: Boolean = true, primary: Boolean = false, onClick: () -> Unit) {
    when (mode) {
        "fluent" -> if (primary) AccentButton(onClick = onClick, modifier = modifier, disabled = !enabled) { Label(label, 13, color = Color.White) }
            else FluentButton(onClick = onClick, modifier = modifier, disabled = !enabled) { Label(label, 13) }
        "miuix" -> MiuixButton(onClick = onClick, modifier = modifier, enabled = enabled) { Label(label, 13, FontWeight.Medium, color = if (enabled) LocalInk.current else LocalSecondaryInk.current) }
        else -> Box(modifier.then(if (primary && label == "送信") Modifier.semantics { contentDescription = label } else Modifier).clip(CircleShape).background(if (primary && enabled) LocalAccent.current else LocalSecondaryInk.current.copy(alpha = .08f))
            .combinedClickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp)) {
                if (primary && label == "送信") AppleGlyph(AppleSymbol.Send, if (enabled) Color.White else LocalSecondaryInk.current, 28)
                else Label(label, 14, FontWeight.SemiBold, color = if (!enabled) LocalSecondaryInk.current else if (primary) Color.White else LocalAccent.current)
            }
    }
}

@Composable
private fun MessageActions(state: SidebarSnapshot, message: ChatMessage, backdrop: Backdrop, anchor: Rect?, onDismiss: () -> Unit) {
    val action = rememberScopedAction()
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val surface = if (state.dark) Color(0xFF29292D) else Color(0xFFFCFCFE)
    var editing by remember(message.id) { mutableStateOf(false) }
    var confirmRevoke by remember(message.id) { mutableStateOf(false) }
    var editText by remember(message.id) { mutableStateOf(message.text) }
    var copyError by remember(message.id) { mutableStateOf(false) }
    if (state.mode == "apple" && !editing && !confirmRevoke) {
        AppleMessageMenu(state, message, backdrop, anchor, copyError, onCopy = {
            scope.launch {
                runCatching { clipboard.setClipEntry(ClipEntry.withPlainText(richPlainText(message.text, message.segments))) }
                    .onSuccess { onDismiss() }.onFailure { copyError = true }
            }
        }, onEdit = { editText = message.text; editing = true }, onRevoke = { confirmRevoke = true }, onDismiss = onDismiss)
        return
    }
    val revoked = message.messageState.startsWith("revoked")
    val canCopy = message.text.isNotBlank() && (!revoked || message.revokedNotice != null)
    val showReaders = state.chat?.isGroup == true && state.settings.showReaderList && (!revoked || message.readCount > 0) && message.status !in listOf("sending", "pending") && !message.id.startsWith("pending_")
    val canManage = message.authorId == "me" && message.status !in listOf("sending", "pending") && !message.id.startsWith("pending_")
    val focus = rememberNativeModalFocus(buildList {
        when {
            confirmRevoke -> { add("revoke"); add("cancel") }
            editing -> { add("editor"); if (editText.isNotBlank()) add("save"); add("cancel") }
            else -> {
                if (!revoked) {
                    if (message.canReact) (2..7).forEach { add("reaction-$it") }
                    add("reply")
                    if (message.canRetry) add("retry")
                    if (canManage) { if (message.kind == "text") add("edit"); add("revoke") }
                }
                if (canCopy) add("copy")
                if (showReaders) add("readers")
                add("details"); add("close")
            }
        }
    }, message.id)
    Box(Modifier.fillMaxSize()
        .onPreviewKeyEvent { if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) { onDismiss(); true } else focus.cycle(it) }) {
        Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = .18f)).focusProperties { canFocus = false }.combinedClickable(onClick = onDismiss))
        val panel = Modifier.align(Alignment.Center).widthIn(max = 380.dp).padding(20.dp)
        Column((if (state.mode == "apple") panel.drawBackdrop(backdrop, { RoundedRectangle(24.dp) }, effects = {
            vibrancy(); blur(18.dp.toPx()); lens(12.dp.toPx(), 22.dp.toPx())
        }, onDrawSurface = { drawRect(surface.copy(alpha = .86f)) }) else panel.clip(RoundedCornerShape(if (state.mode == "miuix") 28.dp else 8.dp)).background(surface))
            .heightIn(max = 620.dp).verticalScroll(rememberScrollState()).padding(16.dp)
            .semantics { paneTitle = "メッセージの操作" }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                confirmRevoke -> {
                    Label("送信を取り消しますか？", 17, FontWeight.SemiBold)
                    Label("相手のトークからもメッセージが取り消されます。", 13, color = LocalSecondaryInk.current, maxLines = 3)
                    NativeButton(state.mode, "送信を取り消す", focus.control("revoke").fillMaxWidth()) { action("revoke", id = message.id); onDismiss() }
                    NativeButton(state.mode, "キャンセル", focus.control("cancel").fillMaxWidth()) { confirmRevoke = false }
                }
                editing -> {
                    Label("メッセージを編集", 17, FontWeight.SemiBold)
                    when (state.mode) {
                        "fluent" -> FluentTextField(value = editText, onValueChange = { editText = it }, modifier = focus.control("editor").fillMaxWidth().semantics { contentDescription = "編集するメッセージ" }, maxLines = 8)
                        "miuix" -> MiuixTextField(value = editText, onValueChange = { editText = it }, modifier = focus.control("editor").fillMaxWidth().semantics { contentDescription = "編集するメッセージ" }, maxLines = 8)
                        else -> BasicTextField(value = editText, onValueChange = { editText = it }, modifier = focus.control("editor").fillMaxWidth().heightIn(min = 80.dp)
                            .clip(RoundedCornerShape(12.dp)).background(LocalSecondaryInk.current.copy(alpha = .09f)).padding(12.dp).semantics { contentDescription = "編集するメッセージ" },
                            textStyle = TextStyle(color = LocalInk.current, fontSize = 15.sp), maxLines = 8)
                    }
                    NativeButton(state.mode, "変更を保存", (if (editText.isNotBlank()) focus.control("save") else Modifier).fillMaxWidth(), enabled = editText.isNotBlank(), primary = true) { action("edit", id = message.id, value = editText); onDismiss() }
                    NativeButton(state.mode, "キャンセル", focus.control("cancel").fillMaxWidth()) { editing = false }
                }
                else -> {
                    Label(richPlainText(message.text, message.segments).ifBlank { "添付メッセージ" }, 14, maxLines = 4)
                    Label("${calendarMoment(message.createdAt.toDouble())} · ${if (message.authorId == "me") deliveryState(message, state.chat?.isGroup == true) else message.authorName}", 11, color = LocalSecondaryInk.current, maxLines = 2)
                    if (copyError) Label("クリップボードにコピーできませんでした", 12, color = Color(0xFFE34E4E), maxLines = 2)
                    if (!revoked) {
                    if (message.canReact) FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        (2..7).forEach { type -> NativeButton(state.mode, reactionName(type), focus.control("reaction-$type"), primary = message.reactions.any { it.type == type && it.selected }) {
                            action("react", id = message.id, value = type.toString()); onDismiss()
                        } }
                    }
                    NativeButton(state.mode, "返信", focus.control("reply").fillMaxWidth()) { action("reply", id = message.id); onDismiss() }
                    if (message.canRetry) NativeButton(state.mode, "再送信", focus.control("retry").fillMaxWidth()) { action("retry", id = message.id); onDismiss() }
                    if (canManage) {
                        if (message.kind == "text") NativeButton(state.mode, "編集", focus.control("edit").fillMaxWidth()) { editText = message.text; editing = true }
                        NativeButton(state.mode, "送信を取り消す", focus.control("revoke").fillMaxWidth()) { confirmRevoke = true }
                    }
                    }
                    if (canCopy) NativeButton(state.mode, "コピー", focus.control("copy").fillMaxWidth()) {
                        scope.launch {
                            runCatching { clipboard.setClipEntry(ClipEntry.withPlainText(richPlainText(message.text, message.segments))) }
                                .onSuccess { onDismiss() }.onFailure { copyError = true }
                        }
                    }
                    if (showReaders) NativeButton(state.mode, "既読者を確認", focus.control("readers").fillMaxWidth()) { action("readers", id = message.id); onDismiss() }
                    NativeButton(state.mode, "詳細・その他の操作", focus.control("details").fillMaxWidth()) { action("view-rich", id = message.id); onDismiss() }
                    NativeButton(state.mode, "閉じる", focus.control("close").fillMaxWidth(), onClick = onDismiss)
                }
            }
        }
    }
}

internal fun reactionSymbol(type: Int): String = when (type) { 2 -> "👍"; 3 -> "❤️"; 4 -> "😆"; 5 -> "😮"; 6 -> "😢"; 7 -> "😲"; else -> "＋" }
internal fun reactionName(type: Int): String = when (type) { 2 -> "いいね"; 3 -> "ハート"; 4 -> "笑い"; 5 -> "驚き"; 6 -> "悲しい"; 7 -> "びっくり"; else -> "リアクション" }

private fun calendarDay(milliseconds: Double): String = js("(window.vylineDayFormatter ??= new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })).format(new Date(milliseconds))")



private fun deliveryState(message: ChatMessage, group: Boolean): String = when {
    message.status == "failed" -> "送信失敗"
    message.status == "sending" || message.status == "pending" -> "送信中…"
    message.readCount > 0 -> if (group) "既読 ${message.readCount}" else "既読"
    else -> "配信済み"
}

private fun calendarMoment(milliseconds: Double): String = js("""(() => {
    const date = new Date(milliseconds);
    const year = date.getFullYear() === new Date().getFullYear() ? '' : date.getFullYear() + '年';
    return year + (date.getMonth() + 1) + '月' + date.getDate() + '日(' + ['日','月','火','水','木','金','土'][date.getDay()] + ') '
        + date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
})()""")
