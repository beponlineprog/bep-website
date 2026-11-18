# B.E.P. WhatsApp Broadcast Worker

This Worker sends the approved Meta WhatsApp template `bep_member_announcement` to selected B.E.P. members. It does not send free-form text.

## Safety checks built in

- Verifies the Firebase ID token with Firebase Authentication.
- Allows only the configured B.E.P. administrator UID.
- Reads member records directly from Firestore using the administrator's Firebase ID token.
- Rechecks eligibility immediately before sending: `status === "Active"`, `whatsappOptIn === true`, and a valid South African number in `phone`.
- The browser sends only member document IDs, never phone numbers. The Worker obtains the current numbers from Firestore.
- Limits each request to 50 recipients and sends sequentially.
- Does not expose the Meta access token to the browser.
- Reports Meta-accepted requests separately from delivery/read status. A webhook is required for delivery/read tracking.

## Create the Cloudflare Worker

1. In Cloudflare, open **Workers & Pages** and create a Worker named `bep-whatsapp-broadcast`.
2. Replace its starter code with the contents of `src/index.js`.
3. Add the following **Variables and Secrets** in Worker Settings:

| Name | Type | Value |
|---|---|---|
| `FIREBASE_API_KEY` | Variable | The public Firebase Web API key already used by the B.E.P. admin page |
| `FIREBASE_PROJECT_ID` | Variable | `beponlineprog-8b8bb` |
| `ADMIN_UID` | Variable | `BDTeO6G7xvaYQKBP2clG9f3DtEF3` |
| `WHATSAPP_PHONE_NUMBER_ID` | Variable | Phone Number ID from Meta WhatsApp API setup |
| `WHATSAPP_TEMPLATE_NAME` | Variable | `bep_member_announcement` |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Variable | `en` (must match the exact language code shown in Meta) |
| `META_GRAPH_API_VERSION` | Variable | A currently supported Graph API version, for example `v23.0` |
| `ALLOWED_ORIGINS` | Variable | `https://beponlineprog.github.io` |
| `WHATSAPP_ACCESS_TOKEN` | **Secret** | Your Meta WhatsApp Cloud API access token |

**Never put `WHATSAPP_ACCESS_TOKEN` in GitHub, HTML, JavaScript in the website, or this chat.** Add it only with Cloudflare's Secret control.

4. Deploy the Worker and copy its `workers.dev` URL. The admin page will later call:
   - `GET https://YOUR-WORKER-URL/admin/whatsapp/recipients`
   - `POST https://YOUR-WORKER-URL/admin/whatsapp/send`

## Request formats

The admin page sends the Firebase ID token as `Authorization: Bearer <token>`.

Recipient list:
- Method: GET
- Path: `/admin/whatsapp/recipients`

Send selected members:
- Method: POST
- Path: `/admin/whatsapp/send`
- JSON body: `{"memberIds":["FIRESTORE_MEMBER_DOCUMENT_ID"]}`

The Worker returns per-member `accepted` or `failed` results. An accepted response is not proof of delivery.

## Important setup checks

- The current B.E.P. admin page already reads the `members` collection while signed in as the administrator. Firestore Security Rules must continue to permit that administrator to read the collection.
- Member phone numbers must be stored in the `phone` field. South African local numbers beginning with `0` are converted to `27`; international numbers must resolve to `27` plus nine digits.
- Members must have explicitly opted in. Do not change consent fields to make someone eligible.
- The template must be active and its exact language code must match the Worker setting.
- This first version does not store a broadcast history and does not receive delivery webhooks. Those can be added as a separate, tested stage before enabling routine broadcasts.
