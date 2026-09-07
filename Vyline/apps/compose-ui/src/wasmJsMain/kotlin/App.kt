import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import com.kyant.shapes.RoundedRectangle
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.Mail
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop

@Composable
fun App(state: SidebarSnapshot) {
    val menuBackdrop = rememberLayerBackdrop()
    // Bind intents to the committed UI, not a newer snapshot waiting to be rendered.
    val actionScope = remember(state.epoch, state.chat?.id, state.view) { UiActionScope(state.epoch, state.chat?.id, state.chat != null && state.view == "chat") }
    DisposableEffect(actionScope) { actionScope.activateFiles(); onDispose {} }
    RendererTheme(state) {
        CompositionLocalProvider(LocalUiActionScope provides actionScope) {
        BoxWithConstraints(Modifier.fillMaxSize().background(if (state.dark) Color(0xFF050506) else Color.White)) {
            val split = maxWidth >= 760.dp
            val sidebarWidth = if (!split) maxWidth else when (state.mode) { "fluent" -> 360.dp; "miuix" -> 330.dp; else -> (maxWidth * .28f).coerceIn(280.dp, 384.dp) }
            Row(Modifier.fillMaxSize().then(if (state.hostMenu != null) Modifier.layerBackdrop(menuBackdrop) else Modifier)) {
                if (split || state.splitPick || state.chat == null && state.view != "settings") {
                    Box(Modifier.width(sidebarWidth).fillMaxHeight().then(if (state.mode == "apple" && split) Modifier.padding(12.dp).clip(RoundedRectangle(26.dp)) else Modifier)) { Sidebar(state, compact = !split) }
                    if (split && state.mode != "apple") Box(Modifier.width(1.dp).fillMaxHeight().background(LocalSecondaryInk.current.copy(alpha = .16f)))
                }
                if (split || !state.splitPick && (state.chat != null || state.view == "settings")) Box(Modifier.weight(1f).fillMaxHeight()) {
                    when {
                        state.view == "settings" -> SettingsScreen(state)
                        state.panes.isNotEmpty() -> NativePanes(state, split)
                        state.chat != null -> key(state.chat.id) { ChatScreen(state, split) }
                        else -> Column(Modifier.fillMaxSize().background(if (state.dark) Color(0xFF171719) else Color(0xFFFAFAFC)),
                            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                            if (state.mode == "apple") AppleGlyph(AppleSymbol.Compose, LocalAccent.current, 64) else Glyph(Icons.Regular.Mail, LocalAccent.current, 64)
                            Spacer(Modifier.height(24.dp))
                            Label("会話を選択", 26, FontWeight.SemiBold)
                            Spacer(Modifier.height(10.dp))
                            Label("メッセージを表示するトークを選んでください", 14, color = LocalSecondaryInk.current)
                        }
                    }
                }
            }
            state.hostMenu?.let { NativeHostMenu(it, state.mode, state.dark, menuBackdrop) }
        }
        }
    }
}
