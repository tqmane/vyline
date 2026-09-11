@file:OptIn(io.github.composefluent.ExperimentalFluentApi::class)

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.key.*
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.composefluent.component.NavigationDisplayMode
import io.github.composefluent.component.NavigationView
import io.github.composefluent.component.SideNavItem
import io.github.composefluent.component.rememberNavigationState
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.Navigation
import io.github.composefluent.icons.regular.Person

/** The settings controller owns categories and mutations; Fluent owns only navigation/layout. */
@Composable
internal fun FluentSettingsPanel(state: SidebarSnapshot, panel: NativePanel, categories: NativePanelItem) {
    val action = rememberScopedAction()
    val navigation = rememberNavigationState(initialExpanded = false)
    val colors = LocalRendererColors.current
    val entries = categories.items.filter { it.kind == "navigation-item" }
    val accounts = categories.items.filter { it.kind != "navigation-item" }
    val focus = rememberNativeModalFocus(listOf("close"), panel.id)
    val category = entries.firstOrNull { it.primary }?.id
    NavigationView(
        modifier = Modifier.fillMaxSize().background(colors.canvas).onPreviewKeyEvent {
            if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) {
                if (navigation.expanded) navigation.expanded = false
                else action("panel-close", id = "${panel.id}:close")
                true
            } else false
        }.semantics { paneTitle = "設定" },
        displayMode = NavigationDisplayMode.LeftCompact,
        contentPadding = PaddingValues(),
        state = navigation,
        expandedButton = {
            Box(Modifier.width(48.dp).height(48.dp), contentAlignment = Alignment.Center) {
                LocalIconButton(Icons.Regular.Navigation, "設定ナビゲーション", state.mode) { navigation.expanded = !navigation.expanded }
            }
        },
        menuItems = {
            entries.forEach { item -> item(key = item.id) {
                val choose = { action("panel-action", id = item.id); navigation.expanded = false }
                SideNavItem(selected = item.primary, expand = navigation.expanded,
                    onClick = { if (!item.disabled) choose() },
                    modifier = Modifier.heightIn(min = 44.dp).semantics(mergeDescendants = true) {
                        contentDescription = item.label; role = Role.Tab; selected = item.primary
                        if (item.disabled) disabled() else onClick { choose(); true }
                    },
                    icon = { Glyph(fluentSettingsIcon(item.symbol), if (item.primary) colors.accentText else colors.text, 20) }) {
                    Label(item.label, 14, maxLines = 1)
                }
            } }
        },
        footerItems = {
            if (accounts.isNotEmpty()) {
                if (navigation.expanded) accounts.forEach { item -> item(key = item.id) {
                    Box(Modifier.widthIn(max = 260.dp).padding(12.dp)) { NativePanelControl(state, item) }
                } }
                else item(key = "settings-accounts") {
                    SideNavItem(selected = false, expand = false, onClick = { navigation.expanded = true },
                        modifier = Modifier.semantics { contentDescription = "ログイン中のアカウント" },
                        icon = { Glyph(Icons.Regular.Person, colors.text, 20) }) { Label("アカウント", 14) }
                }
            }
        },
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Label("設定", 23, FontWeight.SemiBold, modifier = Modifier.weight(1f).semantics { heading() })
                NativeButton(state.mode, "閉じる", focus.control("close")) { action("panel-close", id = "${panel.id}:close") }
            }
            val density = LocalDensity.current.density
            var bounds by remember { mutableStateOf(Rect.Zero) }
            val list = key(panel.id, category) { rememberLazyListState() }
            CompositionLocalProvider(LocalHtmlViewport provides scrollingHtmlViewport(bounds,
                !navigation.expanded && state.hostMenu == null && state.controllerDialog == null && panel.confirmation == null, list)) {
                LazyColumn(state = list, modifier = Modifier.weight(1f).fillMaxWidth().clipToBounds().onGloballyPositioned {
                    val rect = it.boundsInWindow(); bounds = Rect(rect.left / density, rect.top / density, rect.right / density, rect.bottom / density)
                }, contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    items(panel.items.filter { it.kind != "navigation" }, key = { it.id }) { item ->
                        Box(Modifier.widthIn(max = 800.dp).fillMaxWidth()) { NativePanelControl(state, item) }
                    }
                }
            }
        }
    }
}
