export function isReceiveMessageOperationType(type: string): boolean {
  return type === "RECEIVE_MESSAGE" || type === "26" || type === "NOTIFIED_RECEIVE_MESSAGE";
}

export function isReadOperationType(type: string): boolean {
  return (
    type === "NOTIFIED_READ_MESSAGE" ||
    type === "55" ||
    type === "RECEIVE_MESSAGE_RECEIPT" ||
    type === "28" ||
    type === "RECEIVE_READ_WATERMARK" ||
    type === "91" ||
    type === "29"
  );
}

/** Current Talk OpType values, including legacy GROUP events (line-types/thrift.ts). */
export function groupMembershipKind(type: string): "invited" | "joined" | "left" | "kicked" | undefined {
  if (["INVITE_INTO_CHAT", "123", "NOTIFIED_INVITE_INTO_CHAT", "124", "INVITE_INTO_GROUP", "12", "NOTIFIED_INVITE_INTO_GROUP", "13"].includes(type)) return "invited";
  if (["ACCEPT_CHAT_INVITATION", "129", "NOTIFIED_ACCEPT_CHAT_INVITATION", "130", "ACCEPT_GROUP_INVITATION", "16", "NOTIFIED_ACCEPT_GROUP_INVITATION", "17"].includes(type)) return "joined";
  if (["NOTIFIED_DELETE_SELF_FROM_CHAT", "128", "NOTIFIED_LEAVE_GROUP", "15"].includes(type)) return "left";
  if (["NOTIFIED_DELETE_OTHER_FROM_CHAT", "133", "NOTIFIED_KICKOUT_FROM_GROUP", "19"].includes(type)) return "kicked";
  return undefined;
}
