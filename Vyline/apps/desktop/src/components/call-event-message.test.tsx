import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CallEventMessage, GroupCallBanner } from "./call-event-message";

test("group call notices distinguish starting and ending from missed calls", () => {
  const started = renderToStaticMarkup(
    <CallEventMessage meta={{ group: true, video: true, outcome: "started" }} />,
  );
  expect(started).toContain("グループビデオ通話が開始されました");
  expect(started).not.toContain("不在着信");
  const ended = renderToStaticMarkup(
    <CallEventMessage meta={{ group: true, video: false, outcome: "ended" }} />,
  );
  expect(ended).toContain("グループ通話が終了しました");
  const unknown = renderToStaticMarkup(
    <CallEventMessage meta={{ group: true, video: false, outcome: "unknown" }} />,
  );
  expect(unknown).not.toContain("終了しました");
  expect(unknown).not.toContain("不在着信");
});

test("only group start notices offer joining, and the live banner shows the member count", () => {
  const onJoin = () => {};
  const started = renderToStaticMarkup(
    <CallEventMessage meta={{ group: true, video: false, outcome: "started" }} onJoin={onJoin} />,
  );
  expect(started).toContain(">参加</button>");
  for (const outcome of ["ended", "unknown"] as const) {
    const notice = renderToStaticMarkup(
      <CallEventMessage meta={{ group: true, video: false, outcome }} onJoin={onJoin} />,
    );
    expect(notice).not.toContain("<button");
  }
  const quoted = renderToStaticMarkup(
    <CallEventMessage meta={{ group: true, video: false, outcome: "started" }} />,
  );
  expect(quoted).not.toContain("<button");
  const banner = renderToStaticMarkup(
    <GroupCallBanner memberCount={2} video onJoin={onJoin} joining />,
  );
  expect(banner).toContain("2人でビデオ通話中");
  expect(banner).toContain("disabled");
});
