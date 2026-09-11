import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.shadow.Shadow
import com.kyant.shapes.RoundedRectangle

internal val LocalMessageMenuSelection = staticCompositionLocalOf<String?> { null }

/** iMessage's three floating surfaces. Commands remain bound to the host's original menu. */
@Composable
internal fun AppleMessageMenu(menu: HostMenu, dark: Boolean, backdrop: Backdrop, choose: (String) -> Unit, dismiss: () -> Unit) {
    val message = menu.message ?: return
    val colors = LocalRendererColors.current
    val enabled = LocalActionSurfaceEnabled.current
    val reactionItems = menu.items.firstOrNull { it.label == "リアクション" }?.children.orEmpty()
    val reactions = reactionItems.filter { it.iconUrl != null }
    val emojiPicker = reactionItems.firstOrNull { it.label == "所有している絵文字" }
    val primary = menu.items.filter { it.label in listOf("リプライ", "コピー", "部分コピー", "編集", "再送信", "画像をダウンロード", "動画をダウンロード", "ダウンロード", "送信を取り消し") }
    val remaining = menu.items.filter { it !in primary && it.label != "リアクション" } + reactionItems.filter { it.label == "リアクションを取り消す" }
    var path by remember(menu.id) { mutableStateOf(emptyList<HostMenuItem>()) }
    val entries = path.lastOrNull()?.children ?: primary
    val keys = listOf("dismiss") + (reactions.map { it.id } + listOfNotNull(emojiPicker?.id)) + entries.map { it.id } + if (path.isNotEmpty()) listOf("back") else if (remaining.isNotEmpty()) listOf("more") else emptyList()
    val focus = rememberNativeModalFocus(keys, menu.id)
    val density = LocalDensity.current
    var height by remember(menu.id) { mutableStateOf(360.dp) }
    var bubbleHeight by remember(menu.id) { mutableStateOf(50.dp) }
    val glass = if (dark) Color(0xFF292A2D) else Color(0xFFDADDE1)
    BoxWithConstraints(Modifier.fillMaxSize().onPreviewKeyEvent {
        if (!enabled) true
        else if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) { if (path.isNotEmpty()) path = path.dropLast(1) else dismiss(); true }
        else focus.cycle(it, arrows = true)
    }.semantics { paneTitle = "メッセージの操作" }) {
        val viewportHeight = maxHeight
        val messageWidth = message.width?.takeIf { it.isFinite() && it > 0 }?.dp?.coerceAtMost((maxWidth - 16.dp).coerceAtLeast(1.dp))
        val width = minOf((maxWidth - 16.dp).coerceAtLeast(1.dp), maxOf(380.dp, messageWidth ?: 0.dp))
        val x = (menu.x.takeIf { it.isFinite() } ?: 0.0).toFloat().dp.coerceIn(8.dp, (maxWidth - width - 8.dp).coerceAtLeast(8.dp))
        val reactionHeight = if (reactions.isNotEmpty()) 68.dp else 0.dp
        val y = ((menu.y.takeIf { it.isFinite() } ?: 0.0).toFloat().dp - bubbleHeight / 2 - reactionHeight).coerceIn(16.dp, (maxHeight - height - 16.dp).coerceAtLeast(16.dp))
        Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = if (dark) .44f else .16f))
            .then(focus.control("dismiss")).clickable(enabled = enabled, role = Role.Button, onClick = dismiss)
            .semantics { contentDescription = "メニューを閉じる" })
        Column(Modifier.offset(x, y).width(width).heightIn(max = (maxHeight - 32.dp).coerceAtLeast(0.dp))
            .onSizeChanged { height = with(density) { it.height.toDp() } },
            horizontalAlignment = if (message.mine) Alignment.End else Alignment.Start) {
            if (reactions.isNotEmpty()) {
                Row(Modifier.width(minOf(width, 356.dp)).messageMenuGlass(backdrop, glass, 32)
                    .padding(horizontal = 10.dp, vertical = 8.dp)
                    .semantics { contentDescription = "リアクションバー" }, verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        reactions.sortedBy { if (it.label == "愛してる") -1 else reactions.indexOf(it) }.forEach { reaction ->
                            Box(focus.control(reaction.id).size(44.dp).clip(CircleShape)
                                .background(if (focus.isHighlighted(reaction.id)) colors.text.copy(alpha = .12f) else Color.Transparent)
                                .clickable(enabled = enabled, role = Role.Button) { choose(reaction.id) }
                                .semantics { contentDescription = reaction.label }, contentAlignment = Alignment.Center) {
                                ControllerImage(reaction.iconUrl!!, "", Modifier.size(32.dp), ContentScale.Fit)
                            }
                        }
                    }
                    emojiPicker?.let { picker ->
                        Box(focus.control(picker.id).padding(start = 4.dp).size(44.dp).clip(CircleShape)
                            .background(colors.text.copy(alpha = if (focus.isHighlighted(picker.id)) .12f else .06f))
                            .clickable(enabled = enabled, role = Role.Button) { choose(picker.id) }
                            .semantics { contentDescription = picker.label }, contentAlignment = Alignment.Center) {
                            AppleGlyph(AppleSymbol.Plus, colors.text, 24)
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
            val media = rememberRemoteImage(if (message.kind in listOf("image", "sticker")) message.mediaUrl?.let(::safeMediaUrl) else null, 800).bitmap
            val originalX = (menu.x.takeIf { it.isFinite() } ?: 0.0).toFloat().dp
            Column(Modifier.align(Alignment.Start).then(if (messageWidth != null) Modifier.offset(x = (originalX - x).coerceIn(0.dp, (width - messageWidth).coerceAtLeast(0.dp))).width(messageWidth) else Modifier.widthIn(max = width)).heightIn(max = minOf(180.dp, viewportHeight * .26f))
                .onSizeChanged { bubbleHeight = with(density) { it.height.toDp() } }
                .then(if (message.kind == "text") Modifier.appleMessageTail(if (message.mine) colors.outgoing else colors.incoming, message.mine) else Modifier)
                .clip(RoundedRectangle(23.dp))
                .background(if (message.kind == "sticker") Color.Transparent else if (message.mine) colors.outgoing else colors.incoming)
                .verticalScroll(rememberScrollState()).padding(horizontal = 15.dp, vertical = if (message.compact) 6.dp else 8.dp)
                .semantics { contentDescription = "選択したメッセージ" }) {
                if (media != null) Image(media, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.heightIn(max = 140.dp).widthIn(max = 280.dp))
                if (message.text.isNotBlank()) NativeRichText(message.text, emptyList(), style = TextStyle(color = if (message.mine) colors.onOutgoing else colors.onIncoming, fontSize = (17 * message.fontScale).sp, lineHeight = (22 * message.fontScale).sp), mentionColor = colors.accent)
                else if (media == null) Label(when (message.kind) { "audio" -> "音声メッセージ"; "video" -> "動画"; "image" -> "画像"; "sticker" -> "スタンプ"; else -> "添付ファイル" }, 17, color = if (message.mine) colors.onOutgoing else colors.onIncoming)
            }
            Spacer(Modifier.height(24.dp))
            Box(Modifier.width(minOf(width, 288.dp)).weight(1f, fill = false)) {
                if (path.isNotEmpty()) {
                    val parentTitle = path.dropLast(1).lastOrNull()?.label ?: "メッセージの操作"
                    Box(Modifier.matchParentSize().padding(horizontal = 12.dp).padding(bottom = 24.dp)
                        .messageMenuGlass(backdrop, glass.copy(alpha = .7f), 28)
                        .clickable(enabled = enabled) { path = path.dropLast(1) }
                        .padding(horizontal = 20.dp, vertical = 16.dp).semantics { contentDescription = "親メニュー" }) {
                        Label(parentTitle, 13, color = colors.secondary)
                    }
                }
                Column(Modifier.padding(top = if (path.isNotEmpty()) 48.dp else 0.dp).fillMaxWidth()
                    .messageMenuGlass(backdrop, glass, 30).verticalScroll(rememberScrollState()).padding(vertical = 12.dp)
                    .semantics { contentDescription = if (path.isNotEmpty()) "サブメニュー" else "メッセージ操作メニュー" }) {
                    if (path.isNotEmpty()) {
                        val parent = path.last()
                        MessageMenuRow(parent.label, messageMenuSymbol(parent.label), focus.control("back"), enabled, colors.text, disclosure = true) { path = path.dropLast(1) }
                        Box(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp).height(1.dp).background(colors.separator))
                    }
                    entries.forEachIndexed { index, item ->
                        if (index > 0 && (item.label == "コピー" || item.danger)) Box(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp).height(1.dp).background(colors.separator))
                        MessageMenuRow(if (item.label == "リプライ") "返信" else item.label, messageMenuSymbol(item.label),
                            focus.control(item.id).background(if (focus.isHighlighted(item.id)) colors.text.copy(alpha = .08f) else Color.Transparent),
                            enabled, if (item.danger) colors.danger else colors.text, disclosure = if (item.children.isNotEmpty()) false else null) {
                            if (item.children.isNotEmpty()) path = path + item else choose(item.id)
                        }
                    }
                    if (path.isEmpty() && remaining.isNotEmpty()) {
                        Box(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp).height(1.dp).background(colors.separator))
                        MessageMenuRow("その他", null, focus.control("more"), enabled, colors.text, disclosure = false) { path = path + HostMenuItem("more", "その他", children = remaining) }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageMenuRow(label: String, symbol: AppleSymbol?, modifier: Modifier, enabled: Boolean, color: Color, disclosure: Boolean? = null, onClick: () -> Unit) {
    Row(modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .semantics { contentDescription = if (disclosure == true) "${label}を閉じる" else label; if (disclosure != null) stateDescription = if (disclosure) "展開中" else "サブメニュー" }.padding(horizontal = 24.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        if (symbol != null) AppleGlyph(symbol, color, 24)
        else Box(Modifier.size(24.dp).border(1.5.dp, color, CircleShape), contentAlignment = Alignment.Center) { Label("···", 16, color = color) }
        Label(label, 17, color = color, maxLines = 2, modifier = Modifier.weight(1f))
        if (disclosure != null) AppleGlyph(if (disclosure) AppleSymbol.ChevronUp else AppleSymbol.ChevronRight, color.copy(alpha = .65f), 18)
    }
}

private fun messageMenuSymbol(label: String): AppleSymbol? = when {
    label == "リプライ" -> AppleSymbol.Reply
    label == "コピー" -> AppleSymbol.Copy
    label == "部分コピー" -> AppleSymbol.Crop
    label.contains("編集") -> AppleSymbol.Edit
    label.contains("取り消") || label.contains("復元") -> AppleSymbol.Trash
    label.contains("既読") -> AppleSymbol.Checkmark
    label.contains("アナウンス") -> AppleSymbol.Pin
    label.contains("ダウンロード") -> AppleSymbol.Document
    else -> null
}

private fun Modifier.messageMenuGlass(backdrop: Backdrop, color: Color, radius: Int): Modifier = drawBackdrop(
    backdrop, { RoundedRectangle(radius.dp) }, effects = { vibrancy(); blur(22.dp.toPx()); lens(14.dp.toPx(), 22.dp.toPx()) },
    shadow = { Shadow(radius = 24.dp, color = Color.Black.copy(alpha = .18f)) },
    onDrawSurface = { drawRect(color.copy(alpha = color.alpha * .74f)) },
).border(.5.dp, Color.White.copy(alpha = .28f), RoundedRectangle(radius.dp))

internal fun Modifier.appleMessageTail(color: Color, mine: Boolean): Modifier = drawBehind {
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
    drawPath(path, color)
}
