@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, io.github.composefluent.ExperimentalFluentApi::class)

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.shapes.RoundedRectangle
import io.github.composefluent.component.TextField as FluentTextField
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.*
import top.yukonga.miuix.kmp.basic.TextField as MiuixTextField

@Composable
internal fun ChatAuxiliary(state: SidebarSnapshot, backdrop: Backdrop) {
    val action = rememberScopedAction()
    val ui = state.chatUi
    val surface = LocalRendererColors.current.raised
    val expanded = ui?.announcementExpanded == true
    val announcementScroll = rememberScrollState()
    LaunchedEffect(state.chat?.id, expanded) { announcementScroll.scrollTo(0) }
    val announcementHeight = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.height.toDp() * .38f }.coerceAtMost(288.dp)
    val hasContent = ui?.search?.open == true || ui?.groupCall != null || state.announcements.isNotEmpty()
    if (!hasContent) return
    val shape = if (state.mode == "apple") RoundedRectangle(22.dp) else RoundedCornerShape(if (state.mode == "miuix") 22.dp else 6.dp)
    val panel = Modifier.padding(horizontal = 12.dp, vertical = 4.dp).fillMaxWidth()
    Column((if (state.mode == "apple") panel.drawBackdrop(backdrop, { shape }, effects = {
        vibrancy(); blur(12.dp.toPx()); lens(8.dp.toPx(), 14.dp.toPx())
    }, onDrawSurface = { drawRect(surface.copy(alpha = .88f)) }) else panel.clip(shape).background(surface))
        .padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (ui?.search?.open == true) {
            var query by remember(state.chat?.id) { mutableStateOf(ui.search.query) }
            LaunchedEffect(ui.search.query) { query = ui.search.query }
            val changed: (String) -> Unit = { query = it; action("chat-search-query", value = it) }
            val input = Modifier.weight(1f).semantics { contentDescription = "トーク内を検索" }
                .onPreviewKeyEvent {
                    if (it.type != KeyEventType.KeyDown) false
                    else when (it.key) {
                        Key.Escape -> { action("chat-search-close"); true }
                        Key.Enter, Key.NumPadEnter -> {
                            if (ui.search.count > 0) action(if (it.isShiftPressed) "chat-search-previous" else "chat-search-next")
                            true
                        }
                        else -> false
                    }
                }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                when (state.mode) {
                    "fluent" -> FluentTextField(query, changed, modifier = input, singleLine = true, placeholder = { Label("トーク内を検索", 13) })
                    "miuix" -> MiuixTextField(query, changed, modifier = input, singleLine = true, label = "トーク内を検索", useLabelAsPlaceholder = true)
                    else -> BasicTextField(query, changed, modifier = input.heightIn(min = 40.dp).padding(10.dp), singleLine = true,
                        textStyle = TextStyle(color = LocalInk.current, fontSize = 15.sp), cursorBrush = SolidColor(LocalAccent.current),
                        decorationBox = { text -> Box { if (query.isEmpty()) Label("検索", 15, color = LocalSecondaryInk.current); text() } })
                }
                Label("${if (ui.search.count > 0) ui.search.index + 1 else 0}/${ui.search.count}", 11, color = LocalSecondaryInk.current)
                Command(state.mode, Icons.Regular.ChevronLeft, "前の一致", "chat-search-previous", enabled = ui.search.count > 0)
                Command(state.mode, Icons.Regular.ChevronRight, "次の一致", "chat-search-next", enabled = ui.search.count > 0)
                Command(state.mode, Icons.Regular.Dismiss, "検索を閉じる", "chat-search-close")
            }
        }
        ui?.groupCall?.let { call ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.mode == "apple") AppleGlyph(if (call.kind == "video") AppleSymbol.Video else AppleSymbol.Phone, LocalAccent.current, 22)
                else Glyph(if (call.kind == "video") Icons.Regular.Video else Icons.Regular.Call, LocalAccent.current, 22)
                Label("${if (call.memberCount > 0) "${call.memberCount}人で" else "グループ"}${if (call.kind == "video") "ビデオ" else "音声"}通話中", 13, modifier = Modifier.weight(1f), maxLines = 2)
                NativeButton(state.mode, if (ui.joiningCall) "参加中…" else "参加", enabled = !ui.joiningCall, primary = true) { action("join-call") }
            }
        }
        if (state.announcements.isNotEmpty()) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.mode == "apple") AppleGlyph(AppleSymbol.Pin, LocalAccent.current, 18) else Glyph(Icons.Regular.Pin, LocalAccent.current, 18)
                Label("アナウンス (${state.announcements.size})", 12, FontWeight.SemiBold, modifier = Modifier.weight(1f))
                LocalIconButton(if (expanded) Icons.Regular.ChevronUp else Icons.Regular.ChevronDown, if (expanded) "アナウンスを折りたたむ" else "アナウンスを展開", state.mode) { action("announcement-toggle") }
            }
            Column(Modifier.heightIn(max = announcementHeight).verticalScroll(announcementScroll)
                .semantics { contentDescription = "アナウンス一覧" }) {
                (if (expanded) state.announcements else state.announcements.take(1)).forEach { item ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Label(item.text, 13, modifier = Modifier.weight(1f).combinedClickable(enabled = item.messageId != null, onClick = { action("jump-message", id = item.messageId) })
                            .semantics { role = Role.Button; contentDescription = "アナウンス: ${item.text}" }.padding(6.dp), maxLines = 2)
                        if (expanded) LocalIconButton(Icons.Regular.Dismiss, "アナウンスを解除: ${item.text}", state.mode) { action("announcement-remove", id = item.id) }
                    }
                }
            }
        }
    }
}
