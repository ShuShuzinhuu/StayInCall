<p align="center">
  <a href="https://github.com/ShuShuzinhuu">
    <img src="https://github.com/ShuShuzinhuu.png" width="96" height="96" alt="ShuShuzinhuu" style="border-radius: 50%">
  </a>
</p>

<h1 align="center">StayInCall</h1>

<p align="center">A Vencord userplugin that keeps you in a chosen voice channel, reconnects automatically, and toggles AFK mode with a keybind.</p>

<p align="center">Made by <a href="https://github.com/ShuShuzinhuu">ShuShuzinhuu</a> · Written with help from Claude Code (AI)</p>

## Features

- Pick a server and voice channel from searchable lists, or save the channel you're in
- Reconnects to that channel if you get disconnected
- Mutes and/or deafens you when AFK mode turns on, and restores your audio when it turns off
- Keybind to toggle AFK mode (default `ctrl+shift+k`)
- Can turn AFK mode on when Vesktop starts
- Stops reconnecting after too many attempts, so it won't keep rejoining a channel you were removed from
- Errors are logged to the console and shown as toasts, and the plugin turns itself off if it keeps failing

## Installation

This is a userplugin, so you need to [build Vencord from source](https://docs.vencord.dev/installing/).

1. Inside your Vencord folder, run:
   ```sh
   git clone https://github.com/ShuShuzinhuu/StayInCall src/userplugins/stayInCall
   ```
2. Run `pnpm build`
3. On Vesktop, set **Settings → Vesktop Settings → Vencord Location** to `Vencord/dist`, then restart
4. Enable **StayInCall** under **Settings → Vencord → Plugins**

To update, run `git pull` inside `src/userplugins/stayInCall` and build again.

## Note

Client mods are against Discord's Terms of Service. Use at your own risk.
