@file:OptIn(io.github.composefluent.ExperimentalFluentApi::class)

import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.*
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import io.github.composefluent.component.Flyout
import io.github.composefluent.component.MenuFlyoutItem
import io.github.composefluent.component.MenuFlyoutScope
import io.github.composefluent.component.MenuFlyoutSeparator
import io.github.composefluent.component.MenuFlyoutContainer
import io.github.composefluent.component.FlyoutPlacement
import io.github.composefluent.icons.Icons
import io.github.composefluent.icons.regular.ChevronRight
import top.yukonga.miuix.kmp.overlay.OverlayBottomSheet
import kotlinx.coroutines.delay

/**
 * The host still owns every menu command. This is presentation, not a second action router.
 * `visible=false` starts the library's exit; the caller retains the menu until completion.
 */
@Composable
internal fun ThemedHostMenu(
    menu: HostMenu, mode: String, dark: Boolean, backdrop: Backdrop,
    visible: Boolean, onDismissFinished: () -> Unit,
    onChoose: ((String) -> Unit)? = null, onDismissRequest: (() -> Unit)? = null,
) {
    val action = rememberScopedAction()
    val interactive by rememberUpdatedState(visible)
    val dismiss = { if (interactive) { if (onDismissRequest != null) onDismissRequest() else action("dismiss-host-menu", id = menu.id) } }
    val choose: (String) -> Unit = { if (interactive) { if (onChoose != null) onChoose(it) else action("host-menu", id = it) } }
    CompositionLocalProvider(LocalActionSurfaceEnabled provides visible) {
        when (mode) {
            "fluent" -> FluentHostFlyout(menu, visible, choose, dismiss, onDismissFinished)
            "miuix" -> OverlayBottomSheet(show = visible, title = "メニュー", sheetMaxWidth = 480.dp,
                insideMargin = DpSize(8.dp, 8.dp), defaultWindowInsetsPadding = false,
                renderInRootScaffold = false,
                enableNestedScroll = true, onDismissRequest = dismiss, onDismissFinished = onDismissFinished) {
                MiuixHostMenuContent(menu, visible, choose, dismiss)
            }
            else -> AppleSurfacePresence(visible, onDismissFinished) {
                val reduced = LocalReducedMotion.current
                NativeHostMenu(menu, mode, dark, backdrop,
                    panelMotion = Modifier.animateEnterExit(
                        enter = scaleIn(initialScale = .94f, animationSpec = if (reduced) tween(0) else spring(.85f, 500f)),
                        exit = scaleOut(targetScale = .98f, animationSpec = tween(if (reduced) 0 else 140))))
            }
        }
    }
}

@Composable
private fun FluentHostFlyout(
    menu: HostMenu, visible: Boolean, choose: (String) -> Unit,
    dismiss: () -> Unit, onDismissFinished: () -> Unit,
) {
    var mounted by remember(menu.id) { mutableIntStateOf(0) }
    val finished by rememberUpdatedState(onDismissFinished)
    BoxWithConstraints(Modifier.fillMaxSize()) {
        // Bridge coordinates are CSS px; Compose dp maps them through the viewport density.
        // Fluent v0.1.0 Auto centers left-edge anchors outside the window. Explicit
        // placement and pane-sized constraints also cover offset/split chat hosts.
        val width = (maxWidth - 16.dp).coerceIn(1.dp, 300.dp)
        val x = (menu.x.takeIf { it.isFinite() } ?: 0.0).toFloat().dp.coerceIn(8.dp, (maxWidth - width - 8.dp).coerceAtLeast(8.dp))
        val y = (menu.y.takeIf { it.isFinite() } ?: 0.0).toFloat().dp.coerceIn(8.dp, (maxHeight - 8.dp).coerceAtLeast(8.dp))
        val above = y > maxHeight / 2
        val available = (if (above) y - 16.dp else maxHeight - y - 16.dp).coerceAtLeast(1.dp)
        val compact = maxWidth < 640.dp
        val openToLeft = x + width / 2 > maxWidth / 2
        Box(Modifier.offset(x, y).size(1.dp)) {
            Flyout(visible = visible, onDismissRequest = dismiss, adaptivePlacement = false, focusable = true,
                placement = if (above) FlyoutPlacement.TopAlignedStart else FlyoutPlacement.BottomAlignedStart,
                modifier = Modifier.width(width).heightIn(max = available)) {
                // BasicFlyout first measures invisible content before placing the popup.
                // A counter observes real disposal, including that preflight composition.
                DisposableEffect(Unit) { mounted++; onDispose { mounted-- } }
                val menuScope = remember(menu.id) { FocusableFluentMenuScope() }
                Box(Modifier.heightIn(max = available).verticalScroll(rememberScrollState())) {
                    with(menuScope) { FluentMenuEntries(menu.id, menu.items, visible, choose, dismiss, compact, openToLeft) }
                }
            }
        }
    }
    LaunchedEffect(visible, mounted) { if (!visible && mounted == 0) finished() }
}

// MenuFlyout v0.1.0 hardcodes focusable=false and hides its scope constructor.
// Keep Fluent's Flyout/rows and delayed submenu hover while allowing keyboard focus.
private class FocusableFluentMenuScope : MenuFlyoutScope {
    private var latestHovered by mutableStateOf<MutableInteractionSource?>(null)
    @Composable
    override fun registerHoveredMenuItem(interaction: MutableInteractionSource, onDelayedHoveredChanged: (Boolean) -> Unit) {
        val hovered by interaction.collectIsHoveredAsState()
        val changed by rememberUpdatedState(onDelayedHoveredChanged)
        LaunchedEffect(hovered) {
            if (hovered) { latestHovered = interaction; delay(250); if (latestHovered === interaction) changed(true) }
        }
        LaunchedEffect(latestHovered) { if (latestHovered !== interaction) changed(false) }
    }
}

@Composable
private fun MenuFlyoutScope.FluentMenuEntries(
    identity: String, items: List<HostMenuItem>, enabled: Boolean,
    choose: (String) -> Unit, dismiss: () -> Unit,
    compact: Boolean = false, openToLeft: Boolean = false,
) {
    val menuScope = this
    var nested by remember(identity) { mutableStateOf<HostMenuItem?>(null) }
    if (compact && nested != null) {
        Column {
            NativeButton("fluent", "戻る", Modifier.fillMaxWidth()) { nested = null }
            FluentMenuEntries("$identity/${nested!!.id}", nested!!.children, enabled, choose, dismiss, compact = true)
        }
        return
    }
    val keys = items.indices.map { "item-$it" } + "menu-close"
    val focus = rememberNativeModalFocus(keys, identity)
    Column(Modifier.widthIn(max = 300.dp).onPreviewKeyEvent {
        if (!enabled) true
        else if (it.type == KeyEventType.KeyDown && it.key == Key.Escape) { dismiss(); true }
        else focus.cycle(it, arrows = true)
    }.semantics { paneTitle = "メニュー" }) {
        items.forEachIndexed { index, item ->
            val interaction = remember(identity, item.id) { MutableInteractionSource() }
            val modifier = focus.control("item-$index").heightIn(min = 44.dp).semantics {
                if (item.children.isNotEmpty()) stateDescription = "サブメニュー"
            }
            val text: @Composable () -> Unit = {
                Label(item.label, 14, maxLines = 3, color = if (item.danger) {
                    if (LocalInk.current.red > .5f) androidx.compose.ui.graphics.Color(0xFFFF6961) else androidx.compose.ui.graphics.Color(0xFFD70015)
                } else LocalInk.current)
            }
            // Narrow panes drill down in place; wider panes use their known available side.
            if (item.children.isNotEmpty() && compact) {
                MenuFlyoutItem(onClick = { nested = item }, text = text, modifier = modifier, interaction = interaction, enabled = enabled)
                registerHoveredMenuItem(interaction) { if (enabled && it) nested = item }
            } else if (item.children.isNotEmpty()) MenuFlyoutContainer(
                placement = if (openToLeft) FlyoutPlacement.StartAlignedTop else FlyoutPlacement.EndAlignedTop, adaptivePlacement = false,
                flyout = { FluentMenuEntries("$identity/${item.id}", item.children, enabled, choose, dismiss, compact = true) }) {
                val open = { isFlyoutVisible = !isFlyoutVisible }
                menuScope.MenuFlyoutItem(onClick = open, text = text,
                    trailing = { Glyph(Icons.Regular.ChevronRight, LocalSecondaryInk.current, 14) },
                    modifier = modifier.clearAndSetSemantics { role = Role.Button; contentDescription = item.label; stateDescription = "サブメニュー"; onClick { open(); true }; if (!enabled) disabled() },
                    interaction = interaction, enabled = enabled)
                menuScope.registerHoveredMenuItem(interaction) { isFlyoutVisible = enabled && it }
            } else MenuFlyoutItem(onClick = { choose(item.id) }, text = text,
                modifier = modifier.clearAndSetSemantics { role = Role.Button; contentDescription = item.label; onClick { choose(item.id); true }; if (!enabled) disabled() },
                interaction = interaction, enabled = enabled)
        }
        MenuFlyoutSeparator()
        MenuFlyoutItem(onClick = dismiss, text = { Label("閉じる", 14) },
            modifier = focus.control("menu-close").heightIn(min = 44.dp), enabled = enabled)
    }
}

@Composable
private fun MiuixHostMenuContent(menu: HostMenu, visible: Boolean, choose: (String) -> Unit, dismiss: () -> Unit) {
    var path by remember(menu.id, menu.items) { mutableStateOf(emptyList<HostMenuItem>()) }
    val items = path.lastOrNull()?.children ?: menu.items
    val keys = buildList {
        if (path.isNotEmpty()) add("back")
        items.indices.forEach { add("item-$it") }
        add("close")
    }
    val focus = rememberNativeModalFocus(keys, menu.id to path)
    Column(Modifier.fillMaxWidth().heightIn(max = 520.dp).verticalScroll(rememberScrollState())
        .padding(12.dp).onPreviewKeyEvent {
            if (!visible) true
            else when {
                it.type == KeyEventType.KeyDown && it.key == Key.Escape -> { dismiss(); true }
                it.type == KeyEventType.KeyDown && it.key == Key.DirectionLeft && path.isNotEmpty() -> { path = path.dropLast(1); true }
                else -> focus.cycle(it, arrows = true)
            }
        }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        path.lastOrNull()?.let { Label(it.label, 16, modifier = Modifier.padding(bottom = 4.dp), maxLines = 2) }
        if (path.isNotEmpty()) NativeButton("miuix", "戻る", focus.control("back").fillMaxWidth()) { path = path.dropLast(1) }
        items.forEachIndexed { index, item ->
            val ink = if (item.danger) {
                if (LocalInk.current.red > .5f) androidx.compose.ui.graphics.Color(0xFFFF6961) else androidx.compose.ui.graphics.Color(0xFFD70015)
            } else LocalInk.current
            CompositionLocalProvider(LocalInk provides ink) {
            NativeButton("miuix", item.label, focus.control("item-$index").fillMaxWidth().semantics {
                role = Role.Button
                contentDescription = item.label
                if (item.children.isNotEmpty()) stateDescription = "サブメニュー"
            }) { if (item.children.isNotEmpty()) path = path + item else choose(item.id) }
            }
        }
        NativeButton("miuix", "閉じる", focus.control("close").fillMaxWidth(), onClick = dismiss)
    }
}
