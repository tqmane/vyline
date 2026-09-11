import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Geometry follows desktop/lib/chatPanes.ts: chatPaneDropPlan + equal pane sizes. */
@Composable
internal fun PaneDropPreview(state: SidebarSnapshot, drag: ChatListDrag) {
    if (!drag.active || !drag.split || !drag.paneBounds.contains(drag.position)) return
    val ids = state.panes.map { it.id }.ifEmpty { listOfNotNull(state.chat?.id) }
    val count = ids.size + if (drag.source in ids) 0 else 1
    if (count > 4) return
    val bounds = drag.paneBounds
    val x = ((drag.position.x - bounds.left) / bounds.width).coerceIn(0f, .999999f)
    val y = ((drag.position.y - bounds.top) / bounds.height).coerceIn(0f, .999999f)
    val rect = when {
        count <= 1 -> Rect(0f, 0f, 1f, 1f)
        count == 2 -> { val left = if (x < .5f) 0f else .5f; Rect(left, 0f, left + .5f, 1f) }
        count == 3 && y > .27f && y < .73f || count == 4 && y > .3f && y < .7f -> {
            val left = (x * count).toInt().toFloat() / count
            Rect(left, 0f, left + 1f / count, 1f)
        }
        else -> {
            val left = if (x < .5f) 0f else .5f
            val top = if (y < .5f) 0f else .5f
            Rect(left, top, left + .5f, top + .5f)
        }
    }
    val density = LocalDensity.current.density
    Box(Modifier.offset((bounds.left + rect.left * bounds.width).div(density).dp, (bounds.top + rect.top * bounds.height).div(density).dp)
        .size((rect.width * bounds.width / density).dp, (rect.height * bounds.height / density).dp).padding(6.dp)
        .background(LocalAccent.current.copy(alpha = .18f), RoundedCornerShape(16.dp))
        .border(2.dp, LocalAccent.current, RoundedCornerShape(16.dp))
        .semantics { contentDescription = "分割の配置プレビュー" }, contentAlignment = Alignment.Center) {
        Label("ここに表示", 18, color = LocalAccent.current)
    }
}
