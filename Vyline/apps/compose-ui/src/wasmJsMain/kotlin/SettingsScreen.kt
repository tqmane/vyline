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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
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
    val colors = LocalRendererColors.current
    Column(Modifier.fillMaxSize().background(colors.canvas).onPreviewKeyEvent {
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
                listOf("apple" to "iMessage", "fluent" to "Fluent", "miuix" to "Miuix", "nezu" to "NezuUI", "legacy" to "Vyline Classic").forEach { (id, label) ->
                    Row(Modifier.fillMaxWidth().clip(nativePanelShape(state.mode, control = true)).background(if (state.mode == id) colors.selected else Color.Transparent)
                        .selectable(selected = state.mode == id, role = Role.RadioButton, onClick = { action("ui-mode", value = id) })
                        .semantics { stateDescription = if (state.mode == id) "選択中" else "未選択" }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Label(label, 16, if (state.mode == id) FontWeight.SemiBold else FontWeight.Normal,
                            color = if (state.mode == id) colors.selectedText else colors.text, modifier = Modifier.weight(1f))
                        if (state.mode == id) { if (state.mode == "apple") AppleGlyph(AppleSymbol.Checkmark, colors.selectedText, 28) else Glyph(Icons.Regular.Checkmark, colors.selectedText, 20) }
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
    val colors = LocalRendererColors.current
    val shape = nativePanelShape(state.mode)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Label(title, 13, FontWeight.SemiBold, color = colors.secondary, modifier = Modifier.padding(start = 8.dp))
        Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().clip(shape).background(colors.surface)
            .then(if (state.mode == "fluent") Modifier.border(1.dp, colors.separator, shape) else Modifier), content = content)
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
        val control = Modifier.semantics { contentDescription = title; stateDescription = if (checked) "オン" else "オフ" }
        NativeSwitch(state.mode, checked, changed, title, control)
    }
}

@Composable
internal fun NativeSwitch(mode: String, checked: Boolean, changed: (Boolean) -> Unit, label: String,
    modifier: Modifier = Modifier, enabled: Boolean = true) {
    when (mode) {
        "fluent" -> Box(modifier.clearAndSetSemantics {
            role = Role.Switch; contentDescription = label; toggleableState = ToggleableState(checked)
            if (!enabled) disabled()
            onClick { if (enabled) changed(!checked); enabled }
        }) { Switcher(checked = checked, onCheckStateChange = changed, enabled = enabled) }
        "miuix" -> MiuixSwitch(checked = checked, onCheckedChange = changed, enabled = enabled, modifier = modifier)
        else -> AppleSwitch(checked, changed, modifier, enabled)
    }
}
