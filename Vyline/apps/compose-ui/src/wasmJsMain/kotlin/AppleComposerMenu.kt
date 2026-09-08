import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.shapes.RoundedRectangle

@Composable
internal fun AppleComposerMenu(state: SidebarSnapshot, items: List<HostMenuItem>, backdrop: Backdrop, visible: Boolean,
    onDismiss: () -> Unit, onDismissFinished: () -> Unit, onChoose: (String) -> Unit) {
    AppleSurfacePresence(visible, onDismissFinished) {
        val focus = rememberNativeModalFocus(items.map { it.id } + "close", state.chat?.id)
        BoxWithConstraints(Modifier.fillMaxSize().onPreviewKeyEvent {
            if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) { onDismiss(); true } else focus.cycle(it, arrows = true)
        }) {
            Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = .15f))
                .focusProperties { canFocus = false }.clickable(enabled = visible, onClick = onDismiss)
                .semantics { contentDescription = "添付メニューを閉じる" })
            Column(Modifier.align(Alignment.BottomStart).padding(16.dp).widthIn(max = 300.dp).fillMaxWidth()
                .heightIn(max = maxHeight - 32.dp)
                .animateEnterExit(enter = scaleIn(initialScale = .90f, animationSpec = if (state.reducedMotion) tween(0) else spring(.85f, 500f)),
                    exit = scaleOut(targetScale = .94f, animationSpec = tween(if (state.reducedMotion) 0 else 140)))
                .drawBackdrop(backdrop, { RoundedRectangle(30.dp) }, effects = { vibrancy(); blur(24.dp.toPx()); lens(12.dp.toPx(), 20.dp.toPx()) },
                    onDrawSurface = { drawRect((if (state.dark) Color(0xFF242427) else Color.White).copy(alpha = .78f)) })
                .verticalScroll(rememberScrollState()).padding(vertical = 8.dp).semantics { paneTitle = "添付とその他の操作" }) {
                items.forEach { item ->
                    val (symbol, tint) = when (item.id) {
                        "photo" -> AppleSymbol.Photo to Color(0xFF34C759)
                        "sticker-picker" -> AppleSymbol.Sticker to Color(0xFFAF87F5)
                        "record-start" -> AppleSymbol.Waveform to Color(0xFFFF765E)
                        "chat-tools" -> AppleSymbol.Compose to Color(0xFFFFAD23)
                        "mute" -> AppleSymbol.Muted to Color(0xFF8D8D94)
                        "settings" -> AppleSymbol.Settings to Color(0xFF8D8D94)
                        "chat-search" -> AppleSymbol.Search to Color(0xFF007AFF)
                        "chat-menu" -> AppleSymbol.Filter to Color(0xFF007AFF)
                        else -> AppleSymbol.Document to Color(0xFF007AFF)
                    }
                    val motion = rememberAppleLiquidMotion(visible, state.reducedMotion)
                    Row(focus.control(item.id).fillMaxWidth().heightIn(min = 56.dp)
                        .clickable(interactionSource = motion.interactionSource, indication = null, enabled = visible, role = Role.Button, onClick = { onChoose(item.id) })
                        .then(motion.pointerModifier).padding(horizontal = 20.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Box(Modifier.size(34.dp).clip(CircleShape).background(tint), contentAlignment = Alignment.Center) { AppleGlyph(symbol, Color.White, 21) }
                        Label(item.label, 16, FontWeight.Medium, maxLines = 2)
                    }
                }
                NativeButton("apple", "閉じる", focus.control("close").fillMaxWidth().padding(horizontal = 12.dp), onClick = onDismiss)
            }
        }
    }
}
