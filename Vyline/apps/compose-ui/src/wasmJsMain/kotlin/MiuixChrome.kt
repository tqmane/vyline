import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import top.yukonga.miuix.kmp.anim.folmeSpring
import top.yukonga.miuix.kmp.blur.BlendColorEntry
import top.yukonga.miuix.kmp.blur.BlurDefaults
import top.yukonga.miuix.kmp.blur.LayerBackdrop
import top.yukonga.miuix.kmp.blur.rememberLayerBackdrop
import top.yukonga.miuix.kmp.blur.textureBlur

/** One capture per visible Miuix timeline. No blur layers on individual message bubbles. */
@Stable
internal class MiuixChrome(val backdrop: LayerBackdrop) {
    var scrolling by mutableStateOf(false)
}

internal val LocalMiuixChrome = staticCompositionLocalOf<MiuixChrome?> { null }

@Composable
internal fun rememberMiuixChrome(): MiuixChrome {
    val backdrop = rememberLayerBackdrop()
    return remember(backdrop) { MiuixChrome(backdrop) }
}

/** Real miuix-blur texture effect, shared with its sample; no browser/platform heuristic. */
@Composable
internal fun Modifier.miuixChrome(shape: Shape, dark: Boolean, focused: Boolean = false): Modifier {
    val chrome = checkNotNull(LocalMiuixChrome.current) { "Miuix chrome requires a timeline backdrop" }
    val active = focused || chrome.scrolling
    val reduced = LocalReducedMotion.current
    val radius by animateFloatAsState(if (active) 24f else 18f,
        animationSpec = if (reduced) snap() else folmeSpring(damping = .9f, response = .38f),
        label = "Miuix texture blur")
    val tint = LocalRendererColors.current.raised
    val colors = BlurDefaults.blurColors(blendColors = listOf(BlendColorEntry(tint.copy(alpha = .76f))), saturation = 1.15f)
    return textureBlur(backdrop = chrome.backdrop, shape = shape, blurRadius = radius,
        noiseCoefficient = .015f, colors = colors)
}
