# Firefox data declaration

This source review covers upstream RoValra 2.6.13. It is a source audit, not a complete network capture or a guarantee about remote services. The upstream PrivacyPolicy.md is included for attribution and describes RoValra's service practices; it does not cover every behavior found in the current source.

The Firefox package does not declare `none`. Mozilla's definition includes data transferred or handled outside the extension or local browser, including requests to Roblox and RoValra services. Data being public, or a feature being optional in RoValra's own settings, does not make a blanket no-transmission statement accurate.

## Declared categories

The maintained build preserves these features and declares the corresponding categories as required at installation. Required consent permits the full feature set; it does not enable each feature or remove its existing setting. Making these permissions optional would additionally require gating every relevant request with Firefox's optional data permission and handling revocation.

| Category | Source evidence and purpose |
| --- | --- |
| `authenticationInfo` | `src/content/core/oauth/oauth.js` exchanges OAuth codes and authenticates requests with bearer tokens. The fallback flow and Roblox API key helper also handle credentials. |
| `personallyIdentifyingInfo` | OAuth ties requests to Roblox user IDs and usernames; profile and account lookups send user identifiers. A public identifier is still an identifier. |
| `browsingActivity` | Game and profile IDs in external requests identify Roblox pages or experiences being viewed. `features/games/serverlistener.js` sends place IDs obtained from page server responses. This is not a claim of browser-wide history collection. |
| `websiteContent` | The server listener transmits server IDs read from Roblox responses. Profile customization submits status, pronouns, and other content through `core/donators/settingHandler.js`. |
| `websiteActivity` | `core/utils/trackers/playtime.js` posts a place ID to `/v1/playtime/heartbeat` every 30 seconds while playing. Other features perform requested site actions. Playtime and server contribution defaults are enabled upstream. |
| `locationInfo` | `core/utils/location.js` derives latitude/longitude from Roblox join responses and requests `/geolocation/<whole-latitude>.json` from rovalra.com. Longitude processing is local in that function; the requested latitude leaves the browser. |
| `searchTerms` | `core/gameSearch/gameSearch.js` sends typed game/group queries to Roblox search endpoints. |
| `personalCommunications` | `features/moderation/moderation.js` submits the user's written appeal message to RoValra's moderation service. |
| `financialAndPaymentInfo` | `features/plus/sendRobux.js` sends a user-selected Robux amount to Roblox's transfer endpoint. This declaration covers virtual-currency transactions, not an assertion that the extension collects bank or card details. |

No `healthInfo` or `bookmarksInfo` transmission was identified for this declaration. RoValra's game bookmarks are its own local data, not Firefox browser bookmarks.

## Removed technical reporting

Mozilla requires `technicalAndInteraction` to be optional. The build removes two identified reports instead of declaring that category required:

- The added `x-rovalra-user-agent` header on RoValra API requests included browser, engine, extension version, and development/production information.
- `core/utils/trackers/channels.js` polled Roblox client channel assignments and reported them to `/v1/channels/enrollments`. Its exported tracker functions now do nothing, avoiding both the report and its polling.

The functional User-Agent handling for Roblox requests in the background script remains. Ordinary browser transport metadata, such as an IP address and browser-managed headers, still reaches services contacted by the extension. These changes do not remove RoValra's service dependencies, optional server contribution, playtime tracking, or authentication behavior.

The client-channel source has a normalized SHA-256 guard. A changed module or changed diagnostic-header shape stops the build for review. This is a guard for the reviewed transforms, not a comprehensive detector for new upstream data collection. Review new network destinations and payloads before approving a new upstream source version.

## Mozilla references

- [Firefox built-in consent and taxonomy](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/): new extensions require a declaration; Firefox desktop 140 introduced built-in consent; technical and interaction reporting cannot be required.
- [Manifest browser-specific settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings): category values and extension identity.
- [Upstream privacy policy](https://github.com/NotValra/RoValra/blob/main/PrivacyPolicy.md): service-side account, OAuth, donation, and server-data practices.

Mozilla may request a more specific declaration or behavior change during review. Signing approval and live-network verification remain separate from this source review.
