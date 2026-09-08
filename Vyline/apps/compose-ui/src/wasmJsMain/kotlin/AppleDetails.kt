@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.focusable
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.*
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.shadow.Shadow
import com.kyant.shapes.RoundedRectangle

@Composable
internal fun AppleGlassIcon(backdrop: Backdrop, icon: AppleSymbol, label: String, modifier: Modifier = Modifier,
    enabled: Boolean = true, dark: Boolean = false, onClick: () -> Unit) {
    val fill = if (dark) Color(0xFF262629) else Color.White
    val motion = rememberAppleLiquidMotion(enabled = enabled, reducedMotion = LocalReducedMotion.current)
    Box(modifier.size(44.dp).appleLiquidBackdrop(motion, backdrop, { CircleShape }, fill.copy(alpha = .80f),
        blurRadius = 6.dp, lensRadius = 10.dp, lensHeight = 16.dp)
        .clickable(interactionSource = motion.interactionSource, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
        .then(motion.pointerModifier).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        AppleGlyph(icon, if (enabled) LocalInk.current else LocalSecondaryInk.current.copy(alpha = .5f), 28)
    }
}

@Composable
internal fun AppleDetails(state: SidebarSnapshot, backdrop: Backdrop, onDismiss: () -> Unit) {
    val action = rememberScopedAction()
    val chat = state.chat ?: return
    val surface = if (state.dark) Color(0xFF202023) else Color(0xFFF3F3F6)
    val card = if (state.dark) Color(0xFF37373A).copy(alpha = .72f) else Color.White.copy(alpha = .75f)
    var confirmBlock by remember(chat.id) { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val inputMode = LocalInputModeManager.current
    LaunchedEffect(chat.id) { inputMode.requestInputMode(InputMode.Keyboard); withFrameNanos {}; focus.requestFocus() }
    Column(Modifier.fillMaxSize().drawBackdrop(backdrop, { RoundedRectangle(0.dp) }, effects = { vibrancy(); blur(24.dp.toPx()) },
        onDrawSurface = { drawRect(surface.copy(alpha = .94f)) }).border(1.dp, LocalSecondaryInk.current.copy(alpha = .08f))
        .onPreviewKeyEvent { if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) { onDismiss(); true } else false }.focusRequester(focus).focusable()
        .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent(PointerEventPass.Final).changes.forEach { it.consume() } } }
        .semantics { paneTitle = "トークの情報" }) {
        Row(Modifier.fillMaxWidth().padding(14.dp)) { AppleGlassIcon(backdrop, AppleSymbol.Close, "トークの情報を閉じる", dark = state.dark, onClick = onDismiss) }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            item {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Avatar(ConversationRow(chat.id, chat.title, avatar = chat.avatar, color = chat.color, avatarUrl = chat.avatarUrl), 80, gradient = true)
                    Label(chat.title, 24, FontWeight.Bold, maxLines = 3)
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        DetailIcon(backdrop, AppleSymbol.Phone, "音声通話", chat.canCall) { action("call", id = chat.id, value = "voice") }
                        DetailIcon(backdrop, AppleSymbol.Video, "ビデオ通話", chat.canCall && !chat.isGroup) { action("call", id = chat.id, value = "video") }
                        DetailIcon(backdrop, AppleSymbol.Person, "プロフィール", true) { action("profile", id = chat.id) }
                    }
                }
            }
            if (chat.status.isNotBlank()) item {
                Column(Modifier.fillMaxWidth().clip(RoundedRectangle(24.dp)).background(card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Label("ステータス", 12, color = LocalSecondaryInk.current)
                    Label(chat.status, 15, maxLines = 5)
                }
            }
            item {
                Column(Modifier.fillMaxWidth().clip(RoundedRectangle(24.dp)).background(card)) {
                    Row(Modifier.fillMaxWidth().combinedClickable(role = Role.Button, onClick = { onDismiss(); action("chat-search") }).padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        AppleGlyph(AppleSymbol.Search, LocalAccent.current, 22)
                        Label("トーク内を検索", 15, modifier = Modifier.weight(1f))
                        AppleGlyph(AppleSymbol.ChevronRight, LocalSecondaryInk.current, 18)
                    }
                    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(.5.dp).background(LocalSecondaryInk.current.copy(alpha = .16f)))
                    Row(Modifier.fillMaxWidth().combinedClickable(role = Role.Button, onClick = { onDismiss(); action("chat-menu") }).padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        AppleGlyph(AppleSymbol.Filter, LocalAccent.current, 22)
                        Label("トークの操作", 15, modifier = Modifier.weight(1f))
                        AppleGlyph(AppleSymbol.ChevronRight, LocalSecondaryInk.current, 18)
                    }
                }
            }
            item {
                Column(Modifier.fillMaxWidth().clip(RoundedRectangle(24.dp)).background(card)) {
                    DetailToggle("通知を非表示", chat.muted) { action("chat-mute", id = chat.id, value = (!chat.muted).toString()) }
                    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(.5.dp).background(LocalSecondaryInk.current.copy(alpha = .16f)))
                    DetailToggle("トークを固定", chat.pinned) { action("pin-chat", id = chat.id, value = (!chat.pinned).toString()) }
                }
            }
            if (chat.canBlock) item {
                Column(Modifier.fillMaxWidth().clip(RoundedRectangle(24.dp)).background(card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (confirmBlock) {
                        Label(if (chat.blocked) "ブロックを解除しますか？" else "この相手をブロックしますか？", 15, FontWeight.Medium, maxLines = 2)
                        NativeButton(state.mode, "確定", Modifier.fillMaxWidth()) { action("block-chat", id = chat.id, value = (!chat.blocked).toString()); confirmBlock = false }
                        NativeButton(state.mode, "キャンセル", Modifier.fillMaxWidth()) { confirmBlock = false }
                    } else Label(if (chat.blocked) "ブロックを解除" else "相手をブロック", 15, color = Color(0xFFFF453A),
                        modifier = Modifier.fillMaxWidth().combinedClickable(onClick = { confirmBlock = true }).semantics { role = Role.Button })
                }
            }
            if (chat.isGroup && chat.members.isNotEmpty()) {
                item { Label("メンバー ${chat.members.size}人", 12, FontWeight.SemiBold, color = LocalSecondaryInk.current, modifier = Modifier.padding(horizontal = 8.dp)) }
                items(chat.members, key = { it.id }) { member ->
                    Row(Modifier.fillMaxWidth().clip(RoundedRectangle(18.dp)).background(card).combinedClickable(onClick = { action("open-member", id = member.id) }).padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Avatar(ConversationRow(member.id, member.name, avatar = member.avatar, color = member.color, avatarUrl = member.avatarUrl), 34, gradient = true)
                        Label(member.name, 14, modifier = Modifier.weight(1f))
                        AppleGlyph(AppleSymbol.ChevronRight, LocalSecondaryInk.current, 18)
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailIcon(backdrop: Backdrop, icon: AppleSymbol, label: String, enabled: Boolean, onClick: () -> Unit) {
    val motion = rememberAppleLiquidMotion(enabled = enabled, reducedMotion = LocalReducedMotion.current)
    Box(Modifier.size(54.dp).appleLiquidBackdrop(motion, backdrop, { CircleShape }, LocalSecondaryInk.current.copy(alpha = .09f))
        .clickable(interactionSource = motion.interactionSource, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
        .then(motion.pointerModifier).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        AppleGlyph(icon, if (enabled) LocalAccent.current else LocalSecondaryInk.current.copy(alpha = .4f), 32)
    }
}

@Composable
private fun DetailToggle(title: String, checked: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().combinedClickable(role = Role.Switch, onClick = onClick).semantics { stateDescription = if (checked) "オン" else "オフ" }.padding(16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Label(title, 15, modifier = Modifier.weight(1f))
        Box(Modifier.size(width = 50.dp, height = 30.dp).clip(CircleShape).background(if (checked) Color(0xFF34C759) else LocalSecondaryInk.current.copy(alpha = .3f)).padding(2.dp),
            contentAlignment = if (checked) Alignment.CenterEnd else Alignment.CenterStart) { Box(Modifier.size(26.dp).clip(CircleShape).background(Color.White)) }
    }
}
