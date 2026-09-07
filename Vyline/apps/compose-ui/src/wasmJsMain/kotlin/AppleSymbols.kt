import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.DrawableResource
import org.jetbrains.compose.resources.painterResource
import vyline.ui.resources.Res
import vyline.ui.resources.sf_arrow_up
import vyline.ui.resources.sf_arrowshape_turn_up_left
import vyline.ui.resources.sf_bell_slash
import vyline.ui.resources.sf_checkmark
import vyline.ui.resources.sf_chevron_left
import vyline.ui.resources.sf_chevron_right
import vyline.ui.resources.sf_doc_on_doc
import vyline.ui.resources.sf_gearshape
import vyline.ui.resources.sf_heart
import vyline.ui.resources.sf_magnifyingglass
import vyline.ui.resources.sf_mic
import vyline.ui.resources.sf_paperclip
import vyline.ui.resources.sf_pencil
import vyline.ui.resources.sf_person_crop_circle
import vyline.ui.resources.sf_phone
import vyline.ui.resources.sf_pin
import vyline.ui.resources.sf_plus
import vyline.ui.resources.sf_slider_horizontal_3
import vyline.ui.resources.sf_square_and_pencil
import vyline.ui.resources.sf_trash
import vyline.ui.resources.sf_video
import vyline.ui.resources.sf_waveform
import vyline.ui.resources.sf_xmark

internal enum class AppleSymbol(val resource: DrawableResource) {
    Plus(Res.drawable.sf_plus),
    Back(Res.drawable.sf_chevron_left),
    ChevronRight(Res.drawable.sf_chevron_right),
    Compose(Res.drawable.sf_square_and_pencil),
    Send(Res.drawable.sf_arrow_up),
    Search(Res.drawable.sf_magnifyingglass),
    Microphone(Res.drawable.sf_mic),
    Waveform(Res.drawable.sf_waveform),
    Video(Res.drawable.sf_video),
    Phone(Res.drawable.sf_phone),
    Settings(Res.drawable.sf_gearshape),
    Filter(Res.drawable.sf_slider_horizontal_3),
    Attachment(Res.drawable.sf_paperclip),
    Muted(Res.drawable.sf_bell_slash),
    Close(Res.drawable.sf_xmark),
    Pin(Res.drawable.sf_pin),
    Person(Res.drawable.sf_person_crop_circle),
    Heart(Res.drawable.sf_heart),
    Checkmark(Res.drawable.sf_checkmark),
    Reply(Res.drawable.sf_arrowshape_turn_up_left),
    Copy(Res.drawable.sf_doc_on_doc),
    Edit(Res.drawable.sf_pencil),
    Trash(Res.drawable.sf_trash),
}

@Composable
internal fun AppleGlyph(
    symbol: AppleSymbol,
    color: Color,
    size: Int = 28,
    description: String? = null,
    modifier: Modifier = Modifier,
) {
    Image(painter = painterResource(symbol.resource), contentDescription = description,
        modifier = modifier.size(size.dp), contentScale = ContentScale.Fit, colorFilter = ColorFilter.tint(color))
}
