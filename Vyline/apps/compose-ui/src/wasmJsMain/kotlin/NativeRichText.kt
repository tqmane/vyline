import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

@Composable
internal fun NativeRichText(
    text: String,
    segments: List<TextSegment>,
    style: TextStyle,
    mentionColor: Color,
    modifier: Modifier = Modifier,
    maxLines: Int = Int.MAX_VALUE,
) {
    val resolved = remember(text, segments) { richSegments(text, segments) }
    val annotated = remember(resolved, mentionColor) {
        buildAnnotatedString {
            resolved.forEachIndexed { index, segment ->
                when (segment.type) {
                    "sticon" -> appendInlineContent("sticon-$index", segment.displayText().replace('\n', ' ').replace('\r', ' '))
                    "mention" -> withStyle(SpanStyle(color = mentionColor, fontWeight = FontWeight.SemiBold)) {
                        append(segment.displayText())
                    }
                    "link" -> if (segment.url?.startsWith("https://") == true || segment.url?.startsWith("http://") == true) {
                        withLink(LinkAnnotation.Url(segment.url, TextLinkStyles(style = SpanStyle(color = mentionColor, textDecoration = TextDecoration.Underline)))) {
                            append(segment.displayText())
                        }
                    } else append(segment.displayText())
                    else -> append(segment.displayText())
                }
            }
        }
    }
    val inlineContent = remember(resolved, style) {
        buildMap {
            resolved.forEachIndexed { index, segment ->
                if (segment.type == "sticon") put("sticon-$index", InlineTextContent(
                    Placeholder(1.15.em, 1.15.em, PlaceholderVerticalAlign.TextCenter),
                ) { alt ->
                    // BasicText already exposes the alternate text to accessibility and selection.
                    SticonGlyph(segment.url, alt, style, Modifier.fillMaxSize().clearAndSetSemantics {})
                })
            }
        }
    }
    BasicText(annotated, modifier = modifier, style = style, inlineContent = inlineContent,
        maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}

@Composable
internal fun ComposerEmojiPreview(segments: List<TextSegment>, modifier: Modifier = Modifier) {
    val sticons = remember(segments) { segments.filter { it.type == "sticon" } }
    if (sticons.isEmpty()) return
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Label("LINE絵文字", 12, color = LocalSecondaryInk.current)
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            sticons.forEachIndexed { index, segment ->
                key(index, segment.url) {
                    SticonGlyph(segment.url, segment.displayText(),
                        TextStyle(color = LocalSecondaryInk.current, fontSize = 18.sp), Modifier.size(28.dp))
                }
            }
        }
    }
}

@Composable
private fun SticonGlyph(url: String?, alt: String, style: TextStyle, modifier: Modifier) {
    val image = rememberRemoteImage(url?.takeIf { it.isNotBlank() }, 96).bitmap
    Box(modifier, contentAlignment = Alignment.Center) {
        if (image != null) Image(image, contentDescription = alt,
            modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        else BasicText("◎", style = style, maxLines = 1,
            modifier = Modifier.clearAndSetSemantics { contentDescription = alt })
    }
}

internal val SticonVisualTransformation: VisualTransformation = VisualTransformation { text ->
    TransformedText(AnnotatedString(text.text.replace('\uFFFC', '◎'), text.spanStyles, text.paragraphStyles),
        OffsetMapping.Identity)
}

internal fun richPlainText(text: String, segments: List<TextSegment>): String =
    richSegments(text, segments).joinToString("") { it.displayText() }

private fun richSegments(text: String, segments: List<TextSegment>): List<TextSegment> =
    if (segments.isEmpty() || segments.any { it.type != "sticon" && it.value == null && it.alt == null }) {
        // An unfamiliar segment without display data cannot be reconstructed safely.
        listOf(TextSegment("text", value = text))
    } else segments

private fun TextSegment.displayText(): String = if (type == "sticon") {
    (alt ?: value).orEmpty().replace("\uFFFC", "絵文字").ifBlank { "絵文字" }
} else value ?: alt.orEmpty()

internal fun checkNativeRichText() {
    check(richPlainText("原文", emptyList()) == "原文")
    check(richPlainText("", listOf(TextSegment("text", value = "前"),
        TextSegment("sticon", alt = "[笑顔]"), TextSegment("mention", value = "@名前"),
        TextSegment("future", value = "後"))) == "前[笑顔]@名前後")
    check(richPlainText("元の本文", listOf(TextSegment("future"))) == "元の本文")
    check(richPlainText("", listOf(TextSegment("sticon", alt = "\uFFFC"))) == "絵文字")
    val original = AnnotatedString("😀\uFFFC終")
    val transformed = SticonVisualTransformation.filter(original)
    check(transformed.text.text == "😀◎終" && transformed.text.length == original.length)
    for (offset in 0..original.length) {
        check(transformed.offsetMapping.originalToTransformed(offset) == offset)
        check(transformed.offsetMapping.transformedToOriginal(offset) == offset)
    }
}
