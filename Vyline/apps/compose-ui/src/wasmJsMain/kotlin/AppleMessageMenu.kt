@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.shadow.Shadow
import com.kyant.shapes.RoundedRectangle
import kotlin.math.roundToInt

@Composable
internal fun AppleMessageMenu(state: SidebarSnapshot, message: ChatMessage, backdrop: Backdrop, anchor: Rect?,
    copyError: Boolean, onCopy: () -> Unit, onEdit: () -> Unit, onRevoke: () -> Unit, onDismiss: () -> Unit) {
    val action = rememberScopedAction()
    val density = LocalDensity.current
    val mine = message.authorId == "me"
    val revoked = message.messageState.startsWith("revoked")
    val canCopy = message.text.isNotBlank() && (!revoked || message.revokedNotice != null)
    val showReaders = state.chat?.isGroup == true && state.settings.showReaderList && (!revoked || message.readCount > 0) && message.status !in listOf("sending", "pending") && !message.id.startsWith("pending_")
    val canManage = mine && message.status !in listOf("sending", "pending") && !message.id.startsWith("pending_")
    val focus = rememberNativeModalFocus(buildList {
        if (message.canReact) (2..7).forEach { add("reaction-$it") }
        if (!revoked) {
            add("reply")
            if (message.canRetry) add("retry")
            if (canManage) {
                if (message.kind == "text") add("edit")
                add("revoke")
            }
        }
        if (canCopy) add("copy")
        if (showReaders) add("readers")
        add("details"); add("close")
    }, message.id)
    var measuredHeight by remember { mutableIntStateOf(0) }
    val surface = if (state.dark) Color(0xFF242427) else Color(0xFFF2F3F5)
    val glass: (Modifier, Float) -> Modifier = { modifier, radius ->
        modifier.drawBackdrop(backdrop, { RoundedRectangle(radius.dp) }, effects = {
            vibrancy(); blur(20.dp.toPx()); lens(12.dp.toPx(), 24.dp.toPx())
        }, shadow = { Shadow(radius = 24.dp, color = Color.Black.copy(alpha = .16f)) },
            onDrawSurface = { drawRect(surface.copy(alpha = .88f)) })
    }
    BoxWithConstraints(Modifier.fillMaxSize().onPreviewKeyEvent {
        if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) { onDismiss(); true } else focus.cycle(it)
    }) {
        Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = if (state.dark) .45f else .18f))
            .focusProperties { canFocus = false }.combinedClickable(onClick = onDismiss)
            .semantics { contentDescription = "メッセージの操作を閉じる" })
        val width = (maxWidth - 32.dp).coerceAtMost(360.dp)
        val actualHeight = with(density) { measuredHeight.toDp() }
        val anchorTop = with(density) { (anchor?.top ?: 260f).toDp() }
        val top = (anchorTop - 68.dp).coerceIn(16.dp, (maxHeight - actualHeight - 16.dp).coerceAtLeast(16.dp))
        Column(Modifier.align(if (mine) Alignment.TopEnd else Alignment.TopStart).padding(horizontal = 16.dp)
            .offset { IntOffset(0, with(density) { top.toPx().roundToInt() }) }.width(width)
            .heightIn(max = maxHeight - 32.dp).verticalScroll(rememberScrollState())
            .onSizeChanged { measuredHeight = it.height }
            .semantics { paneTitle = "メッセージの操作" },
            horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (message.canReact) Row(glass(Modifier.fillMaxWidth(), 50f).padding(horizontal = 6.dp, vertical = 8.dp)
                .horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.SpaceEvenly) {
                (2..7).forEach { type ->
                    Box(Modifier.size(48.dp).then(focus.control("reaction-$type"))
                        .clip(CircleShape).background(if (message.reactions.any { it.type == type && it.selected }) LocalAccent.current.copy(alpha = .20f) else Color.Transparent)
                        .combinedClickable(role = Role.Button, onClick = { action("react", id = message.id, value = type.toString()); onDismiss() })
                        .semantics { contentDescription = reactionName(type); selected = message.reactions.any { it.type == type && it.selected } },
                        contentAlignment = Alignment.Center) { Label(reactionSymbol(type), 29) }
                }
            }
            Box(Modifier.widthIn(max = width).clip(RoundedRectangle(21.dp))
                .background(if (mine) Color(0xFF007AFF) else if (state.dark) Color(0xFF353538) else Color(0xFFE9E9EB)).padding(15.dp)) {
                NativeRichText(message.text.ifBlank { message.fileName ?: "添付メッセージ" }, message.segments,
                    TextStyle(color = if (mine) Color.White else LocalInk.current, fontSize = 17.sp, lineHeight = 22.sp),
                    if (mine) Color.White else LocalAccent.current, maxLines = 7)
            }
            Column(glass(Modifier.widthIn(max = 280.dp).fillMaxWidth(), 28f).padding(vertical = 8.dp)) {
                if (!revoked) {
                    AppleMenuRow(AppleSymbol.Reply, "返信", focus.control("reply")) { action("reply", id = message.id); onDismiss() }
                    if (message.canRetry) AppleMenuRow(AppleSymbol.Send, "再送信", focus.control("retry")) { action("retry", id = message.id); onDismiss() }
                    if (canManage) {
                        Box(Modifier.padding(horizontal = 18.dp).fillMaxWidth().height(.5.dp).background(LocalSecondaryInk.current.copy(alpha = .22f)))
                        if (message.kind == "text") AppleMenuRow(AppleSymbol.Edit, "編集", focus.control("edit"), onClick = onEdit)
                        AppleMenuRow(AppleSymbol.Trash, "送信を取り消す", focus.control("revoke"), onClick = onRevoke)
                    }
                }
                if (canCopy) AppleMenuRow(AppleSymbol.Copy, "コピー", focus.control("copy"), onClick = onCopy)
                if (showReaders) AppleMenuRow(AppleSymbol.Person, "既読者を確認", focus.control("readers")) { action("readers", id = message.id); onDismiss() }
                Box(Modifier.padding(horizontal = 18.dp).fillMaxWidth().height(.5.dp).background(LocalSecondaryInk.current.copy(alpha = .22f)))
                AppleMenuRow(AppleSymbol.Filter, "詳細・その他の操作", focus.control("details")) { action("view-rich", id = message.id); onDismiss() }
                AppleMenuRow(AppleSymbol.Close, "閉じる", focus.control("close"), onClick = onDismiss)
                if (copyError) Label("コピーできませんでした", 12, color = Color(0xFFE34E4E), modifier = Modifier.padding(16.dp))
            }
        }
    }
}

@Composable
private fun AppleMenuRow(icon: AppleSymbol, label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(modifier.fillMaxWidth().heightIn(min = 48.dp).combinedClickable(role = Role.Button, onClick = onClick)
        .padding(horizontal = 22.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        AppleGlyph(icon, LocalInk.current, 23)
        Label(label, 16, modifier = Modifier.weight(1f), maxLines = 2)
    }
}
