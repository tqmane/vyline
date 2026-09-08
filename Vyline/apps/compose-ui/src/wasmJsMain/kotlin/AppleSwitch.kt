import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

@Composable
internal fun AppleSwitch(checked: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val reduced = LocalReducedMotion.current
    val motion = rememberAppleLiquidMotion(enabled, reduced)
    val progress by animateFloatAsState(if (checked) 1f else 0f, if (reduced) tween(0) else spring(.85f, 500f))
    val color by animateColorAsState(if (checked) Color(0xFF34C759) else LocalSecondaryInk.current.copy(alpha = .3f), tween(if (reduced) 0 else 160))
    Box(modifier.size(51.dp, 44.dp).toggleable(value = checked, enabled = enabled, role = Role.Switch,
        interactionSource = motion.interactionSource, indication = null, onValueChange = onChange)
        .then(motion.pointerModifier), contentAlignment = Alignment.Center) {
        Box(Modifier.size(51.dp, 31.dp).clip(CircleShape).background(color))
        Box(Modifier.align(Alignment.CenterStart).offset(x = 2.dp + 20.dp * progress).size(27.dp)
            .graphicsLayer { val scale = if (reduced) 1f else 1f + .08f * motion.pressProgress; scaleX = scale; scaleY = scale }
            .clip(CircleShape).background(Color.White.copy(alpha = if (enabled) 1f else .6f)))
    }
}
