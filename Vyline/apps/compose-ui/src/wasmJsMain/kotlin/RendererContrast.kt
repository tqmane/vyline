import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import kotlin.math.pow

/** Run on resolved library roles in the existing selftest fixture, never in production. */
internal fun checkRendererContrast(colors: RendererColors) {
    fun luminance(color: Color): Double {
        fun linear(value: Float): Double = if (value <= .04045f) value / 12.92 else ((value + .055) / 1.055).pow(2.4)
        return .2126 * linear(color.red) + .7152 * linear(color.green) + .0722 * linear(color.blue)
    }
    fun pair(name: String, foreground: Color, background: Color) {
        val a = luminance(foreground.compositeOver(background))
        val b = luminance(background)
        val ratio = (maxOf(a, b) + .05) / (minOf(a, b) + .05)
        check(ratio >= 4.5) { "$name small-text contrast is $ratio, expected >= 4.5" }
    }
    with(colors) {
        pair("incoming", onIncoming, incoming)
        pair("incoming link", linkIncoming, incoming)
        pair("outgoing", onOutgoing, outgoing)
        pair("outgoing link", linkOutgoing, outgoing)
        pair("active badge", onAccent, accent)
        pair("muted badge", mutedBadgeText, mutedBadge)
        pair("selected title", selectedText, selected.compositeOver(sidebar))
        pair("selected preview", selectedSecondary, selected.compositeOver(sidebar))
        pair("missed call", danger, dangerContainer)
        for ((name, background) in listOf("canvas" to canvas, "surface" to surface, "raised" to raised, "input" to input)) {
            pair("$name body", text, background)
            pair("$name accent", accentText, background)
            pair("$name danger", danger, background)
        }
    }
}
