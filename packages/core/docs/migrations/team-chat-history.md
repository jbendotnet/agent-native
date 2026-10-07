# Team-aware chat history

The Toolkit chat-history app wrapper supplies Core-backed thread capabilities.
The legacy presentation component remains exported, but callers that enable
`enforceThreadCapabilities` must provide its capability hook or use the wrapper.
Without that hook, enforced management controls are unavailable. This is not an
authorization bypass. Server actions still validate access on every request.

## Import map

| Existing import                                      | App-integrated replacement                               |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `@agent-native/toolkit/chat-history/ChatHistoryList` | `@agent-native/toolkit/app/chat-history/ChatHistoryList` |
| `@agent-native/toolkit/chat-history/TeamShareMenu`   | `@agent-native/toolkit/app/chat-history/TeamShareMenu`   |

Both legacy paths remain exported. `TeamShareMenu` forwards to the app module.
No package export is removed by this compatibility change.

## Migration checklist

1. Identify callers of the legacy `ChatHistoryList` that enable
   `enforceThreadCapabilities`.
2. For a Core-connected app, change the import to the app wrapper. Keep existing
   props. The wrapper supplies `useThreadCapabilities`.
3. For an app-owned presentation integration, keep the legacy import and pass a
   compatible `useThreadCapabilities` hook. Do not derive capabilities from team
   membership or organization roles alone.
4. Verify owner management controls and viewer read-only behavior. Verify denial
   after membership or a share is revoked, including a fresh run connection.

Team binding does not grant discovery. Conversations stay personally owned and
private until the owner explicitly shares with one team as viewers. Team leads
and organization administrators do not gain private conversation access.
Existing unbound conversations remain unbound.

See the [team action reference](../content/organizations-teams-permissions.mdx#team-actions)
and [conversation sharing contract](../content/sharing.mdx#team-conversations).
