# Using SuperGrok or X Premium With Kilo Code

The **SuperGrok / X Premium (OAuth)** provider lets you use Grok models through an eligible SuperGrok or X Premium subscription. It authenticates directly with xAI using OAuth, so you do not need an xAI API key.

This provider is independent from the [xAI API-key provider](xai.md). Selecting one never signs in to, configures, or automatically falls back to the other.

## Availability

This provider currently supports:

- Kilo Code for VS Code
- Agents started by the VS Code Agent Manager
- Text prompts and image inputs

It is not currently available in the JetBrains extension. Support for other input types is not included yet.

## Sign In

1. Open Kilo Code settings from the gear icon in the Kilo Code panel.
2. In **API Provider**, select **SuperGrok / X Premium (OAuth)**.
3. Choose the sign-in method that matches your environment.
4. Complete authorization with the xAI account that has your subscription.
5. Select a Grok model and save your settings.

### Sign in with browser

Use **Sign in with browser** when VS Code and your browser are running on the same computer. Kilo Code opens the xAI authorization page and waits for the callback on `127.0.0.1:56121`.

If the browser does not open automatically, use **Copy link** and open the authorization link manually on that computer.

### Remote / VPS sign-in

Use **Remote / VPS sign-in** when Kilo Code runs on a server, in a container, or anywhere the browser cannot reach the local callback.

Kilo Code displays a verification link and one-time code. Open the link on any device, enter the code, and leave the settings page open while Kilo Code waits for authorization. Both the link and code can be copied from the settings page.

## Account and Token Storage

Kilo Code stores one global xAI account in VS Code Secret Storage. All profiles that use this provider share that account. Signing out disconnects it for every profile.

Agents started by Agent Manager request short-lived access tokens from the main extension. Refresh tokens remain in VS Code Secret Storage and are not copied into agent configuration or child-process environment variables.

## Models

The model list is loaded dynamically from the xAI catalog on [models.dev](https://models.dev/). Kilo Code refreshes it at startup, periodically while running, and when you click **Refresh models**. If the catalog is temporarily unavailable, Kilo Code uses its cached or bundled model list.

Catalog entries describe model capabilities and limits, but the models your account can actually use depend on your xAI subscription entitlement. A model appearing in the picker does not guarantee that xAI has enabled it for your account.

Context-window values shown in Kilo Code come from the dynamic catalog. Response output is currently capped at 32K tokens.

## Troubleshooting

- **The browser flow does not finish:** Check whether another application is using port `56121`, then retry. For a remote environment, use **Remote / VPS sign-in** instead.
- **A model is listed but access is denied:** Choose a model included with your subscription or verify the account's entitlement with xAI.
- **The model list looks stale:** Click **Refresh models**. Cached models remain available during a catalog outage.
- **Authentication expired:** Kilo Code normally refreshes tokens automatically. If xAI rejects the refresh token, sign out and sign in again.
