import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.shadow.Shadow
import com.kyant.shapes.RoundedRectangle
import io.github.composefluent.surface.Card as FluentCard
import top.yukonga.miuix.kmp.basic.Card as MiuixCard
import kotlin.math.roundToInt

@Composable
internal fun NativeHostMenu(menu: HostMenu, mode: String, dark: Boolean, backdrop: Backdrop, panelMotion: Modifier = Modifier) {
    val action = rememberScopedAction()
    var path by remember(menu.id, menu.items) { mutableStateOf(emptyList<HostMenuItem>()) }
    val items = path.lastOrNull()?.children ?: menu.items
    val title = path.lastOrNull()?.label ?: "メニュー"
    val itemOffset = if (path.isEmpty()) 1 else 2
    val firstFocus = if (items.isEmpty()) 0 else itemOffset
    val requesters = remember(menu.id, path, items) { List(items.size + itemOffset) { FocusRequester() } }
    var focusedIndex by remember(requesters) { mutableIntStateOf(firstFocus) }
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    val inputMode = LocalInputModeManager.current
    val accent = LocalAccent.current
    val dismiss = { action("dismiss-host-menu", id = menu.id) }
    val back = { path = path.dropLast(1) }
    LaunchedEffect(requesters) {
        scroll.scrollTo(0)
        inputMode.requestInputMode(InputMode.Keyboard)
        withFrameNanos { }
        focusComposeCanvas()
        requesters[firstFocus].requestFocus()
    }

    fun controlFocus(index: Int): Modifier = Modifier.focusRequester(requesters[index])
        .onFocusChanged { if (it.isFocused) focusedIndex = index }
        .border(if (focusedIndex == index) 2.dp else 0.dp,
            if (focusedIndex == index) accent else Color.Transparent, RoundedCornerShape(8.dp))

    val content: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth().verticalScroll(scroll).padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (path.isNotEmpty()) NativeButton(mode, "戻る", controlFocus(1), onClick = back)
                Label(title, 14, FontWeight.SemiBold,
                    modifier = Modifier.weight(1f).padding(horizontal = 8.dp), maxLines = 2)
                NativeButton(mode, "閉じる", controlFocus(0), onClick = dismiss)
            }
            items.forEachIndexed { index, item ->
                val ink = if (item.danger) {
                    if (dark) Color(0xFFFF6961) else Color(0xFFD70015)
                } else LocalInk.current
                CompositionLocalProvider(LocalInk provides ink,
                    LocalAccent provides if (item.danger) ink else accent) {
                    NativeButton(mode, item.label,
                        controlFocus(index + itemOffset).fillMaxWidth().heightIn(min = 44.dp).semantics {
                            contentDescription = item.label
                            if (item.children.isNotEmpty()) stateDescription = "サブメニュー"
                        }) {
                        if (item.children.isNotEmpty()) path = path + item
                        else action("host-menu", id = item.id)
                    }
                }
            }
        }
    }

    Layout(modifier = Modifier.fillMaxSize().onPreviewKeyEvent { event ->
        if (event.type != KeyEventType.KeyDown) false
        else when (event.key) {
            Key.Escape -> { dismiss(); true }
            Key.DirectionLeft -> if (path.isNotEmpty()) { back(); true } else false
            Key.Tab, Key.DirectionDown, Key.DirectionUp -> {
                val delta = if (event.key == Key.DirectionUp || event.key == Key.Tab && event.isShiftPressed) -1 else 1
                requesters[(focusedIndex + delta + requesters.size) % requesters.size].requestFocus()
                true
            }
            else -> false
        }
    }, content = {
        // Scrim and pane must stay siblings: a clickable ancestor breaks Wasm pane semantics.
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = if (dark) .22f else .10f))
            .focusProperties { canFocus = false }
            .clickable(role = Role.Button, onClick = dismiss)
            .semantics { contentDescription = "メニューを閉じる" })
        val panel = panelMotion.fillMaxWidth()
            .focusProperties { onExit = { cancelFocusChange(); requesters[focusedIndex].requestFocus() } }.focusGroup()
            .semantics { paneTitle = title; isTraversalGroup = true }
            .pointerInput(menu.id) {
                awaitPointerEventScope {
                    while (true) awaitPointerEvent()
                }
            }
        when (mode) {
            "fluent" -> FluentCard(modifier = panel, shape = RoundedCornerShape(6.dp), content = content)
            "miuix" -> MiuixCard(modifier = panel, cornerRadius = 24.dp, insideMargin = PaddingValues(0.dp)) { content() }
            else -> {
                val shape = RoundedRectangle(24.dp)
                val surface = if (dark) Color(0xFF262629) else Color.White
                Box(panel.drawBackdrop(backdrop, { shape }, effects = {
                    vibrancy(); blur(18.dp.toPx()); lens(12.dp.toPx(), 24.dp.toPx())
                }, shadow = { Shadow(radius = 24.dp, color = Color.Black.copy(alpha = .18f)) },
                    onDrawSurface = { drawRect(surface.copy(alpha = .76f)) })
                    .border(1.dp, Color.White.copy(alpha = if (dark) .10f else .36f), shape)) { content() }
            }
        }
    }) { measurables, constraints ->
        val scrim = measurables[0].measure(constraints)
        val margin = 8.dp.roundToPx()
        val panel = measurables[1].measure(Constraints(
            maxWidth = minOf(300.dp.roundToPx(), (constraints.maxWidth - margin * 2).coerceAtLeast(0)),
            maxHeight = (constraints.maxHeight - margin * 2).coerceAtLeast(0),
        ))
        // Bridge positions use CSS pixels; the Canvas layout measures physical pixels.
        val x = hostMenuCoordinate(menu.x, density.density, constraints.maxWidth, panel.width, margin)
        val y = hostMenuCoordinate(menu.y, density.density, constraints.maxHeight, panel.height, margin)
        layout(constraints.maxWidth, constraints.maxHeight) {
            scrim.place(0, 0)
            panel.place(x, y)
        }
    }
}

private fun hostMenuCoordinate(css: Double, density: Float, viewport: Int, extent: Int, margin: Int): Int {
    val minimum = minOf(margin, (viewport - extent).coerceAtLeast(0))
    val maximum = (viewport - extent - margin).coerceAtLeast(minimum)
    return ((css.takeIf { it.isFinite() } ?: 0.0) * density).roundToInt().coerceIn(minimum, maximum)
}

internal fun checkNativeHostMenu() {
    check(hostMenuCoordinate(20.0, 2f, 400, 100, 8) == 40)
    check(hostMenuCoordinate(90.0, 2f, 200, 80, 8) == 112)
    check(hostMenuCoordinate(-50.0, 1f, 280, 264, 8) == 8)
    check(hostMenuCoordinate(Double.NaN, 1f, 280, 264, 8) == 8)
    check(hostMenuCoordinate(90.0, 1f, 10, 10, 8) == 0)
}
