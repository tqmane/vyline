import {
  IconMic,
  IconMicOff,
  IconPhone,
  IconVideo,
  IconVideoOff,
  IconCameraSwitch,
} from "@/components/icons";
import { useDesignSystemStore } from "./design-system-store";
import phone from "../assets/call-symbols/phone.svg?url";
import hangup from "../assets/call-symbols/phone-down.svg?url";
import mic from "../assets/call-symbols/mic.svg?url";
import muted from "../assets/call-symbols/mic-slash.svg?url";
import video from "../assets/call-symbols/video.svg?url";
import videoOff from "../assets/call-symbols/video-slash.svg?url";
import cameraSwitch from "../assets/call-symbols/camera-switch.svg?url";

const symbols = { phone, hangup, mic, muted, video, videoOff, cameraSwitch };

/** Apple glyphs come unchanged from the user's local SF Symbols collection. */
export function CallIcon({ name, size = 24 }: { name: keyof typeof symbols; size?: number }) {
  const apple = useDesignSystemStore((state) => state.mode === "apple");
  if (apple)
    return (
      <span
        aria-hidden="true"
        data-sf-symbol={name}
        data-call-icon={name}
        className="inline-block shrink-0 bg-current"
        style={{
          width: size,
          height: size,
          mask: `url("${symbols[name]}") center / contain no-repeat`,
          WebkitMask: `url("${symbols[name]}") center / contain no-repeat`,
        }}
      />
    );
  const Icon =
    name === "mic"
      ? IconMic
      : name === "muted"
        ? IconMicOff
        : name === "phone" || name === "hangup"
          ? IconPhone
          : name === "cameraSwitch"
            ? IconCameraSwitch
            : name === "videoOff"
              ? IconVideoOff
              : IconVideo;
  return (
    <span data-call-icon={name} className="inline-flex">
      <Icon size={size} className={name === "hangup" ? "rotate-[135deg]" : undefined} />
    </span>
  );
}
