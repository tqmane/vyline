import { useDesignSystemStore } from "./design-system-store";
import { IconShield, IconCalendar, IconDice, IconMemo, IconPhoto, IconPoll } from "@/components/icons";
import calendar from "../assets/plus-symbols/calendar.svg?url";
import shuffle from "../assets/plus-symbols/shuffle.svg?url";
import checklist from "../assets/plus-symbols/checklist.svg?url";
import note from "../assets/plus-symbols/note.svg?url";
import photos from "../assets/plus-symbols/photos.svg?url";

const symbols = { schedule: calendar, ladder: shuffle, poll: checklist, note, album: photos };
const icons = {
  schedule: IconCalendar,
  ladder: IconDice,
  poll: IconPoll,
  note: IconMemo,
  album: IconPhoto,
};

/** Original local SF Symbols keep Apple's menu aligned with the native composer. */
export function PlusIcon({ name }: { name: keyof typeof symbols | "reject" }) {
  const apple = useDesignSystemStore((state) => state.mode === "apple");
  if (name === "reject") return <span aria-hidden="true" className="shrink-0"><IconShield size={20} /></span>;
  const Icon = icons[name];
  return apple ? (
    <span
      aria-hidden="true"
      data-sf-symbol={name}
      className="inline-block size-5 shrink-0 bg-current"
      style={{
        mask: `url("${symbols[name]}") center / contain no-repeat`,
        WebkitMask: `url("${symbols[name]}") center / contain no-repeat`,
      }}
    />
  ) : (
    <span aria-hidden="true" className="shrink-0">
      <Icon size={20} />
    </span>
  );
}
