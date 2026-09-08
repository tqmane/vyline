export function isReceiveMessageOperationType(type: string): boolean {
  return type === "RECEIVE_MESSAGE" || type === "26" || type === "NOTIFIED_RECEIVE_MESSAGE";
}

export function isRevokeOperationType(type: string): boolean {
  return (
    type === "DESTROY_MESSAGE" ||
    type === "64" ||
    type === "NOTIFIED_DESTROY_MESSAGE" ||
    type === "65"
  );
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
