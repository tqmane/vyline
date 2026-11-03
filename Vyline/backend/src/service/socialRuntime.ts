import { SocialService } from "./socialService.js";
import {
  fetchContactProfile, fetchBlockedContactIds, blockContactMid, unblockContactMid,
  createGroupChat, listSocialFriendMids, socialSelfMid, addSocialFriend, deleteSocialFriend,
} from "./lineService.js";

/** The owning lineService supplies session checks and invalidates its own caches. */
export const socialService = new SocialService({
  profile: fetchContactProfile,
  friendMids: listSocialFriendMids,
  selfMid: socialSelfMid,
  addFriend: addSocialFriend,
  deleteFriend: deleteSocialFriend,
  blockedMids: fetchBlockedContactIds,
  blockContact: blockContactMid,
  unblockContact: unblockContactMid,
  createChat: createGroupChat,
});
