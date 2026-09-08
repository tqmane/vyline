@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import com.kyant.shapes.RoundedRectangle
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.composefluent.component.Switcher
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.*
import top.yukonga.miuix.kmp.basic.Switch as MiuixSwitch

@Composable
fun SettingsScreen(state: SidebarSnapshot, split: Boolean = false) {
    val action = rememberScopedAction()
    val focus = remember { FocusRequester() }
    val inputMode = LocalInputModeManager.current
    LaunchedEffect(state.epoch) { inputMode.requestInputMode(InputMode.Keyboard); withFrameNanos {}; focus.requestFocus() }
    val background = if (state.dark) Color(0xFF171719) else if (state.mode == "miuix") Color(0xFFF4F5F8) else Color(0xFFF6F7FA)
    Column(Modifier.fillMaxSize().background(background).onPreviewKeyEvent {
        if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) { action("back"); true } else false
    }.focusRequester(focus).focusable()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Command(state.mode, Icons.Regular.ChevronLeft, "設定を閉じる", "back")
            Label("設定", if (state.mode == "miuix") 30 else 24, FontWeight.Bold, modifier = Modifier.padding(start = 8.dp).semantics { heading() })
            Spacer(Modifier.weight(1f))
            if (split) Command(state.mode, Icons.Regular.Navigation, if (state.sidebarCollapsed) "サイドバーを開く" else "サイドバーを閉じる", "sidebar-toggle")
        }
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = if (state.mode == "fluent") Alignment.TopStart else Alignment.TopCenter) {
        Column(Modifier.widthIn(max = if (state.mode == "apple") 720.dp else 800.dp).fillMaxWidth().fillMaxHeight().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            SettingsGroup(state, "UIスタイル") {
                listOf("apple" to "Messages", "fluent" to "Fluent", "miuix" to "Miuix", "nezu" to "NezuUI", "legacy" to "Vyline Classic").forEach { (id, label) ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (state.mode == id) LocalAccent.current.copy(alpha = .10f) else Color.Transparent)
                        .selectable(selected = state.mode == id, role = Role.RadioButton, onClick = { action("ui-mode", value = id) })
                        .semantics { stateDescription = if (state.mode == id) "選択中" else "未選択" }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Label(label, 16, if (state.mode == id) FontWeight.SemiBold else FontWeight.Normal, modifier = Modifier.weight(1f))
                        if (state.mode == id) { if (state.mode == "apple") AppleGlyph(AppleSymbol.Checkmark, LocalAccent.current, 28) else Glyph(Icons.Regular.Checkmark, LocalAccent.current, 20) }
                    }
                }
            }
            SettingsGroup(state, "外観") {
                FlowRow(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("system" to "システム", "light" to "ライト", "dark" to "ダーク").forEach { (id, label) ->
                        NativeButton(state.mode, label, modifier = Modifier.semantics { selected = state.appearance == id; stateDescription = if (state.appearance == id) "選択中" else "未選択" },
                            primary = state.appearance == id, onClick = { action("appearance", value = id) })
                    }
                }
            }
            SettingsGroup(state, "メッセージ") {
                SettingSwitch(state, "enterToSend", "Enterで送信", "Shift + Enterで改行", state.settings.enterToSend)
                SettingSwitch(state, "voiceMessagesEnabled", "ボイスメッセージ", "音声メッセージの録音", state.settings.voiceMessagesEnabled)
                SettingSwitch(state, "compactDensity", "コンパクト表示", "メッセージの間隔を狭くする", state.settings.compactDensity)
                SettingSwitch(state, "bubbleTail", "吹き出しのしっぽ", "連続するメッセージの最後に表示", state.settings.bubbleTail)
                SettingSwitch(state, "showReaderList", "既読の表示", "既読人数を表示", state.settings.showReaderList)
            }
            NativeButton(state.mode, "アカウント・バックアップ・詳細設定", Modifier.fillMaxWidth()) { action("advanced-settings") }
            Spacer(Modifier.height(12.dp))
        }
        }
    }
}

@Composable
private fun SettingsGroup(state: SidebarSnapshot, title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Label(title, 13, FontWeight.SemiBold, color = LocalSecondaryInk.current, modifier = Modifier.padding(start = 8.dp))
        Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().clip(if (state.mode == "apple") RoundedRectangle(24.dp) else RoundedCornerShape(if (state.mode == "fluent") 6.dp else 24.dp))
            .background(if (state.dark) Color(0xFF262629) else Color.White), content = content)
    }
}

@Composable
private fun SettingSwitch(state: SidebarSnapshot, id: String, title: String, description: String, checked: Boolean) {
    val action = rememberScopedAction()
    val changed: (Boolean) -> Unit = { action("setting", id = id, value = it.toString()) }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Label(title, 15, FontWeight.Medium)
            Label(description, 11, color = LocalSecondaryInk.current, maxLines = 2)
        }
        Box(Modifier.semantics { contentDescription = title; stateDescription = if (checked) "オン" else "オフ" }) {
            when (state.mode) {
                "fluent" -> Switcher(checked = checked, onCheckStateChange = changed)
                "miuix" -> MiuixSwitch(checked = checked, onCheckedChange = changed)
                else -> Box(Modifier.size(width = 51.dp, height = 31.dp).clip(CircleShape).background(if (checked) Color(0xFF34C759) else LocalSecondaryInk.current.copy(alpha = .3f))
                    .combinedClickable(role = Role.Switch, onClick = { changed(!checked) }).padding(2.dp), contentAlignment = if (checked) Alignment.CenterEnd else Alignment.CenterStart) {
                        Box(Modifier.size(27.dp).clip(CircleShape).background(Color.White))
                    }
            }
        }
    }
}
