import { lineCdnProxy } from "@/utils/lineMedia";
// 各リアクションの公式 sticon（LINE 本家の絵文字画像）: productId / sticonId
const REACTION_STICON: Record<number, { productId: string; sticonId: string }> = {
  2: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "143" }, // NICE 👍
  3: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "165" }, // LOVE ❤️
  4: { productId: "5ac1bfd5040ab15980c9b435", sticonId: "002" }, // FUN 😆
  5: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "172" }, // AMAZING 🎉
  6: { productId: "670e0cce840a8236ddd4ee4c", sticonId: "092" }, // SAD 😢
  7: { productId: "5ac1bfd5040ab15980c9b435", sticonId: "029" }, // OMG 😲
};

const DEMO_REACTION_ASSET: Record<number, string> = {
  2: "/demo/reaction-nice.svg",
  3: "/demo/reaction-love.svg",
  4: "/demo/reaction-fun.svg",
  5: "/demo/reaction-amazing.svg",
  6: "/demo/reaction-sad.svg",
  7: "/demo/reaction-omg.svg",
};

/** リアクション公式 sticon のプロキシ URL（未定義は空文字） */
export function reactionSticonUrl(type: number, emoji?: { productId: string; emojiId: string }): string {
  if (emoji?.productId === "demo-emoji") return `/demo/emoji-${emoji.emojiId}.svg`;
  if (typeof window !== "undefined" && window.location.pathname === "/pr-demo")
    return DEMO_REACTION_ASSET[type] ?? "";
  if (emoji) return lineCdnProxy(`https://stickershop.line-scdn.net/sticonshop/v1/sticon/${encodeURIComponent(emoji.productId)}/android/${encodeURIComponent(emoji.emojiId)}.png`);
  const ref = REACTION_STICON[type];
  if (!ref) return "";
  const url = `https://stickershop.line-scdn.net/sticonshop/v1/sticon/${ref.productId}/android/${ref.sticonId}.png`;
  return lineCdnProxy(url);
}

