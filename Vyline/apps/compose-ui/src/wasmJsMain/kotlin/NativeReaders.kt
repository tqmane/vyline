@file:OptIn(kotlin.js.ExperimentalWasmJsInterop::class)

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.shadow.Shadow
import com.kyant.shapes.RoundedRectangle
import io.github.composefluent.component.ListItem as FluentListItem
import io.github.composefluent.surface.Card as FluentCard
import top.yukonga.miuix.kmp.basic.Card as MiuixCard

@Composable
internal fun NativeReadersPanel(state: SidebarSnapshot, backdrop: Backdrop, onDismiss: () -> Unit) {
    val action = rememberScopedAction()
    val panelState = state.readersPanel ?: return
    val readers = state.messages.firstOrNull { it.id == panelState.messageId }?.readers.orEmpty()
    val focus = rememberNativeModalFocus(listOf("close") + readers.indices.map { "reader-$it" }, panelState.messageId)
    val scroll = rememberScrollState()
    val accent = LocalAccent.current
    fun controlFocus(key: String): Modifier = focus.control(key)
        .border(if (focus.isHighlighted(key)) 2.dp else 0.dp,
            if (focus.isHighlighted(key)) accent else Color.Transparent,
            if (key == "close" && state.mode == "apple") androidx.compose.foundation.shape.CircleShape else RoundedCornerShape(12.dp))

    val content: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Label("既読", 18, FontWeight.SemiBold, modifier = Modifier.weight(1f))
                NativeButton(state.mode, "閉じる", controlFocus("close").heightIn(min = 44.dp), onClick = onDismiss)
            }
            Column(Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(scroll),
                verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (panelState.loading) Label("既読情報を読み込み中…", 14, color = LocalSecondaryInk.current,
                    modifier = Modifier.padding(vertical = 16.dp).semantics { liveRegion = LiveRegionMode.Polite }, maxLines = 2)
                if (readers.isEmpty() && !panelState.loading) Label("既読情報はまだありません", 14,
                    color = LocalSecondaryInk.current, modifier = Modifier.padding(vertical = 20.dp), maxLines = 2)
                readers.forEachIndexed { index, reader ->
                    val name = safeReaderName(reader)
                    val time = readerTimeLabel(reader.readAt)
                    val description = if (time.isEmpty()) "$name、プロフィールを開く" else "$name、$time、プロフィールを開く"
                    val openProfile = { action("reader-profile", id = reader.id) }
                    val row = controlFocus("reader-$index").fillMaxWidth().heightIn(min = 56.dp).semantics {
                        role = Role.Button
                        contentDescription = description
                    }
                    val readerContent: @Composable () -> Unit = {
                        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Label(name, 15, FontWeight.Medium, maxLines = 2)
                            if (time.isNotEmpty()) Label(time, 12, color = LocalSecondaryInk.current)
                        }
                    }
                    when (state.mode) {
                        "fluent" -> FluentListItem(onClick = openProfile, text = {
                            Box(Modifier.padding(vertical = 8.dp)) { readerContent() }
                        }, modifier = row.clearAndSetSemantics {
                            role = Role.Button
                            contentDescription = description
                            onClick { openProfile(); true }
                        })
                        "miuix" -> MiuixCard(modifier = row.clickable(role = Role.Button, onClick = openProfile), cornerRadius = 12.dp,
                            insideMargin = PaddingValues(12.dp)) { readerContent() }
                        else -> Box(row.clip(RoundedRectangle(12.dp))
                            .background(if (state.dark) Color(0xFF333337).copy(alpha = .96f) else Color(0xFFF1F1F3).copy(alpha = .96f))
                            .clickable(role = Role.Button, onClick = openProfile).padding(12.dp)) { readerContent() }
                    }
                }
            }
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize().onPreviewKeyEvent { event ->
        if (event.type != KeyEventType.KeyDown) false
        else when (event.key) {
            Key.Escape -> { onDismiss(); true }
            else -> focus.cycle(event, arrows = true)
        }
    }) {
        // Keep the dismiss target separate from the pane's semantics subtree.
        Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = .18f))
            .focusProperties { canFocus = false }.clickable(role = Role.Button, onClick = onDismiss)
            .semantics { contentDescription = "既読一覧を閉じる" })
        val panel = Modifier.align(Alignment.Center)
            .width(minOf(380.dp, (maxWidth - 32.dp).coerceAtLeast(0.dp)))
            .heightIn(max = (maxHeight - 32.dp).coerceAtLeast(0.dp))
            .semantics { paneTitle = "既読一覧"; isTraversalGroup = true }
            .pointerInput(panelState.messageId) {
                awaitPointerEventScope {
                    while (true) awaitPointerEvent(PointerEventPass.Final).changes.forEach { it.consume() }
                }
            }
        when (state.mode) {
            "fluent" -> FluentCard(modifier = panel.background(if (state.dark) Color(0xFF292929) else Color(0xFFFAFAFA), RoundedCornerShape(6.dp)), shape = RoundedCornerShape(6.dp), content = content)
            "miuix" -> MiuixCard(modifier = panel, cornerRadius = 24.dp, insideMargin = PaddingValues(0.dp)) { content() }
            else -> {
                val shape = RoundedRectangle(24.dp)
                val surface = if (state.dark) Color(0xFF262629) else Color.White
                Box(panel.drawBackdrop(backdrop, { shape }, effects = {
                    vibrancy(); blur(18.dp.toPx()); lens(12.dp.toPx(), 24.dp.toPx())
                }, shadow = { Shadow(radius = 24.dp, color = Color.Black.copy(alpha = .18f)) },
                    onDrawSurface = { drawRect(surface.copy(alpha = .82f)) })
                    .border(1.dp, Color.White.copy(alpha = if (state.dark) .10f else .36f), shape)) { content() }
            }
        }
    }
}

private val readerMid = Regex("^[a-z][0-9a-f]{32}$", RegexOption.IGNORE_CASE)

private fun safeReaderName(reader: MessageReader): String = reader.name.trim()
    .takeUnless { it.isEmpty() || it == reader.id || readerMid.matches(it) } ?: "メンバー"

private fun readerTimeLabel(readAt: Double?): String =
    if (readAt != null && readAt.isFinite() && readAt > 0.0 && readAt <= 8.64e15) formatReaderTime(readAt) else ""

private fun formatReaderTime(milliseconds: Double): String = js("(window.vylineReaderTimeFormatter ??= new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })).format(new Date(milliseconds))")

internal fun checkNativeReaders() {
    check(safeReaderName(MessageReader("example", " 表示名 ")) == "表示名")
    check(safeReaderName(MessageReader("example", "")) == "メンバー")
    check(safeReaderName(MessageReader("u" + "0".repeat(32), "u" + "0".repeat(32))) == "メンバー")
    check(safeReaderName(MessageReader("example", "U" + "A".repeat(32))) == "メンバー")
    check(readerTimeLabel(null).isEmpty() && readerTimeLabel(Double.NaN).isEmpty())
    check(readerTimeLabel(Double.POSITIVE_INFINITY).isEmpty() && readerTimeLabel(9e15).isEmpty())
}
