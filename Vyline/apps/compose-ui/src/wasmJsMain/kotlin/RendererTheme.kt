@file:OptIn(io.github.composefluent.ExperimentalFluentApi::class)

import androidx.compose.foundation.LocalOverscrollFactory
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.TextStyle
import io.github.composefluent.FluentTheme
import io.github.composefluent.background.Mica
import io.github.composefluent.darkColors
import io.github.composefluent.lightColors
import top.yukonga.miuix.kmp.basic.Scaffold as MiuixScaffold
import top.yukonga.miuix.kmp.theme.MiuixTheme
import top.yukonga.miuix.kmp.theme.darkColorScheme
import top.yukonga.miuix.kmp.theme.lightColorScheme

/** App-owned roles for custom renderer content; native controls retain their native themes. */
@Immutable
internal data class RendererColors(
    val canvas: Color,
    val sidebar: Color,
    val surface: Color,
    val raised: Color,
    val input: Color,
    val separator: Color,
    val text: Color,
    val secondary: Color,
    val disabled: Color,
    val accent: Color,
    val accentText: Color,
    val onAccent: Color,
    val danger: Color,
    val dangerContainer: Color,
    val incoming: Color,
    val outgoing: Color,
    val onIncoming: Color,
    val onOutgoing: Color,
    val linkIncoming: Color,
    val linkOutgoing: Color,
    val selected: Color,
    val selectedText: Color,
    val selectedSecondary: Color,
    val mutedBadge: Color,
    val mutedBadgeText: Color,
)

internal val LocalRendererColors = staticCompositionLocalOf { appleRendererColors(dark = false) }
internal val LocalRendererTextStyle = staticCompositionLocalOf { TextStyle.Default }
// Compatibility locals remain overridable for selected rows and other content surfaces.
internal val LocalInk = staticCompositionLocalOf { Color(0xFF19191B) }
internal val LocalSecondaryInk = staticCompositionLocalOf { Color(0xFF686872) }
internal val LocalAccent = staticCompositionLocalOf { Color(0xFF007AFF) }
internal val LocalReducedMotion = staticCompositionLocalOf { false }
internal val LocalRendererMode = staticCompositionLocalOf { "apple" }

@Composable
fun RendererTheme(state: SidebarSnapshot, content: @Composable () -> Unit) {
    // Keep every native provider and the measurement-time Scaffold body at one
    // stable location. Moving content into Miuix's subcomposition disposes it
    // before measurement can insert it, losing scroll/viewer/media state.
    FluentTheme(
        colors = if (state.dark) darkColors() else lightColors(),
        useAcrylicPopup = true,
        compactMode = false,
    ) {
        MiuixTheme(colors = if (state.dark) darkColorScheme() else lightColorScheme()) {
            val colors = when (state.mode) {
                "fluent" -> fluentRendererColors()
                "miuix" -> miuixRendererColors(state.dark)
                else -> appleRendererColors(state.dark)
            }
            if (selfChecksEnabled()) remember(colors) { checkRendererContrast(colors); true }
            val textStyle = when (state.mode) {
                "fluent" -> FluentTheme.typography.body
                "miuix" -> MiuixTheme.textStyles.body1
                else -> TextStyle.Default
            }
            // Scaffold hosts Miuix overlays outside its body subcomposition. Provide
            // live renderer roles above the host so sheets/dialogs do not see defaults.
            CompositionLocalProvider(LocalRendererMode provides state.mode) {
                RendererLocals(colors, textStyle, state.reducedMotion) {
                    Mica(Modifier.fillMaxSize()) {
                        MiuixScaffold(
                            modifier = Modifier.fillMaxSize(),
                            containerColor = Color.Transparent,
                            contentWindowInsets = WindowInsets(0, 0, 0, 0),
                        ) {
                            key(state.epoch) { content() }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RendererLocals(colors: RendererColors, textStyle: TextStyle, reducedMotion: Boolean, content: @Composable () -> Unit) {
    val overscroll = LocalOverscrollFactory.current
    CompositionLocalProvider(
        LocalRendererColors provides colors,
        LocalRendererTextStyle provides textStyle,
        LocalInk provides colors.text,
        LocalSecondaryInk provides colors.secondary,
        LocalAccent provides colors.accent,
        LocalReducedMotion provides reducedMotion,
        LocalOverscrollFactory provides if (reducedMotion) null else overscroll,
        content = content,
    )
}

@Composable
private fun fluentRendererColors(): RendererColors {
    val native = FluentTheme.colors
    return RendererColors(
        canvas = native.background.solid.base,
        sidebar = native.background.solid.secondary,
        surface = native.background.solid.tertiary,
        raised = native.background.solid.quaternary,
        input = native.control.default.compositeOver(native.background.solid.tertiary),
        separator = native.stroke.divider.default,
        text = native.text.text.primary,
        secondary = native.text.text.secondary,
        disabled = native.text.text.disabled,
        accent = native.fillAccent.default,
        accentText = native.text.accent.primary,
        onAccent = native.text.onAccent.primary,
        danger = native.system.critical,
        dangerContainer = native.system.criticalBackground,
        incoming = native.background.solid.quinary,
        outgoing = native.fillAccent.default,
        onIncoming = native.text.text.primary,
        onOutgoing = native.text.onAccent.primary,
        linkIncoming = native.text.accent.primary,
        // On solid accent bubbles use the native on-accent text with link underlining.
        linkOutgoing = native.text.onAccent.primary,
        // Match ListItemDefaults.selectedListItemColors, including its neutral selection.
        selected = native.subtleFill.secondary,
        selectedText = native.text.text.primary,
        selectedSecondary = native.text.text.secondary,
        mutedBadge = native.system.solidNeutralBackground,
        mutedBadgeText = native.text.text.primary,
    )
}

@Composable
private fun miuixRendererColors(dark: Boolean): RendererColors {
    val native = MiuixTheme.colorScheme
    val accentText = if (dark) native.onPrimaryVariant else Color(0xFF005CBF)
    return RendererColors(
        canvas = native.surface,
        // The native Scaffold/TopAppBar use the lower canvas behind raised cards.
        sidebar = native.surface,
        surface = native.surfaceContainer,
        raised = native.surfaceContainerHighest,
        input = native.secondaryContainer,
        separator = native.dividerLine,
        text = native.onSurface,
        secondary = native.onSurfaceVariantSummary,
        disabled = native.disabledOnSurface,
        accent = native.primary,
        accentText = accentText,
        // The pinned primary blue needs dark ink for app-owned small text.
        onAccent = Color.Black,
        danger = native.onErrorContainer,
        dangerContainer = native.errorContainer,
        incoming = native.surfaceContainer,
        outgoing = native.primary,
        onIncoming = native.onSurfaceContainer,
        onOutgoing = Color.Black,
        linkIncoming = accentText,
        linkOutgoing = Color.Black,
        // primaryContainer is saturated in 0.9.3; tertiaryContainer is its tinted selection pair.
        selected = native.tertiaryContainer,
        // Native onTertiaryContainer is accent blue; neutral ink keeps small previews legible.
        selectedText = native.onSurface,
        selectedSecondary = if (dark) native.onSurfaceSecondary else native.onSurfaceVariantSummary,
        mutedBadge = native.secondaryVariant,
        mutedBadgeText = native.onSecondaryVariant,
    )
}

private fun appleRendererColors(dark: Boolean): RendererColors {
    val text = if (dark) Color(0xFFF5F5F7) else Color(0xFF19191B)
    val secondary = if (dark) Color(0xFFABABB3) else Color(0xFF686872)
    val canvas = if (dark) Color(0xFF050506) else Color.White
    val sidebar = if (dark) Color(0xFF1D1D20) else Color(0xFFF9F9FA)
    val surface = if (dark) Color(0xFF1C1C1E) else Color(0xFFF2F2F7)
    val accent = Color(0xFF005CBF)
    return RendererColors(
        canvas = canvas,
        sidebar = sidebar,
        surface = surface,
        raised = secondary.copy(alpha = .07f).compositeOver(sidebar),
        input = secondary.copy(alpha = .08f).compositeOver(canvas),
        separator = secondary.copy(alpha = .15f),
        text = text,
        secondary = secondary,
        disabled = secondary.copy(alpha = .45f),
        accent = accent,
        accentText = if (dark) Color(0xFF64B5FF) else accent,
        onAccent = Color.White,
        danger = if (dark) Color(0xFFFF6961) else Color(0xFFC42B1C),
        dangerContainer = if (dark) Color(0xFF442726) else Color(0xFFFDE7E9),
        incoming = if (dark) Color(0xFF2C2C2E) else Color(0xFFE9E9EB),
        outgoing = accent,
        onIncoming = text,
        onOutgoing = Color.White,
        linkIncoming = if (dark) Color(0xFF64B5FF) else Color(0xFF005CBF),
        linkOutgoing = Color.White,
        selected = accent,
        selectedText = Color.White,
        selectedSecondary = Color.White.copy(alpha = .85f),
        mutedBadge = if (dark) Color(0xFF3A3A3C) else Color(0xFFE5E5EA),
        mutedBadgeText = text,
    )
}
