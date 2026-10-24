/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore, Forms, GuildChannelStore, GuildStore, MediaEngineStore, SearchableSelect,
    SelectedChannelStore, showToast, SortedGuildStore, useMemo, UserStore
} from "@webpack/common";

const VoiceActions = findByPropsLazy("selectVoiceChannel", "selectChannel");
const AudioActions = findByPropsLazy("toggleSelfMute", "toggleSelfDeaf");

const logger = new Logger("StayInCall");

const RETRY_WINDOW = 10 * 60_000;
const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_TOAST_COOLDOWN = 30_000;

type Variant = "default" | "success" | "critical";

function toast(text: string, variant: Variant = "default") {
    try {
        showToast({ text, variant });
    } catch (e) {
        logger.error("Failed to show toast", e);
    }
}

const lastErrorToast: Record<string, number> = {};

function safe<T>(label: string, fn: () => T): T | undefined {
    try {
        return fn();
    } catch (e) {
        logger.error(`${label} failed`, e);
        const now = Date.now();
        if (now - (lastErrorToast[label] ?? 0) > ERROR_TOAST_COOLDOWN) {
            lastErrorToast[label] = now;
            toast(`StayInCall: ${label} failed (see console)`, "critical");
        }
        return undefined;
    }
}

function getInterval() {
    const n = Number(settings.store.interval);
    return Number.isFinite(n) ? Math.max(5, n) * 1000 : 10_000;
}

function getMaxRetries() {
    const n = Number(settings.store.maxRetries);
    return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 3;
}

const settings = definePluginSettings({
    guildId: {
        type: OptionType.STRING,
        description: "Server ID",
        default: "",
        hidden: true
    },
    channelId: {
        type: OptionType.STRING,
        description: "Voice channel ID",
        default: "",
        hidden: true
    },
    picker: {
        type: OptionType.COMPONENT,
        component: () => <ChannelPicker />
    },
    keybind: {
        type: OptionType.STRING,
        description: "AFK mode keybind (e.g. ctrl+shift+k)",
        default: "ctrl+shift+k"
    },
    autoEnable: {
        type: OptionType.BOOLEAN,
        description: "Enable AFK mode when Vesktop starts",
        default: false
    },
    mute: {
        type: OptionType.BOOLEAN,
        description: "Mute when entering AFK mode",
        default: true
    },
    deafen: {
        type: OptionType.BOOLEAN,
        description: "Deafen when entering AFK mode",
        default: false
    },
    interval: {
        type: OptionType.NUMBER,
        description: "Check interval (seconds, minimum 5)",
        default: 10,
        onChange: () => {
            if (afk) restartTimer();
        }
    },
    maxRetries: {
        type: OptionType.NUMBER,
        description: "Max reconnects within 10 min (AFK mode turns off after that)",
        default: 3
    }
});

const ChannelPicker = ErrorBoundary.wrap(() => {
    const { guildId, channelId } = settings.use(["guildId", "channelId"]);

    const guildOptions = useMemo(() => SortedGuildStore.getFlattenedGuildIds()
        .map(id => GuildStore.getGuild(id))
        .filter(Boolean)
        .map(g => ({ label: g.name, value: g.id })), []);

    const channelOptions = useMemo(() => {
        if (!guildId) return [];
        return (GuildChannelStore.getChannels(guildId)?.VOCAL ?? [])
            .map(({ channel }) => ({ label: channel.name, value: channel.id }));
    }, [guildId]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Forms.FormTitle>Server</Forms.FormTitle>
            <SearchableSelect
                placeholder="Select a server"
                options={guildOptions}
                value={guildId || undefined}
                onChange={v => {
                    settings.store.guildId = v ?? "";
                    settings.store.channelId = "";
                }}
                closeOnSelect
            />

            <Forms.FormTitle>Voice channel</Forms.FormTitle>
            <SearchableSelect
                placeholder={guildId ? "Select a channel" : "Select a server first"}
                options={channelOptions}
                value={channelId || undefined}
                onChange={v => settings.store.channelId = v ?? ""}
                isDisabled={!guildId}
                closeOnSelect
            />

            <Button onClick={() => safe("Saving current channel", () => {
                const id = SelectedChannelStore.getVoiceChannelId();
                if (!id) return toast("You are not in a voice channel", "critical");
                const ch = ChannelStore.getChannel(id);
                if (!ch?.guild_id) return toast("Only server voice channels are supported", "critical");
                settings.store.guildId = ch.guild_id;
                settings.store.channelId = id;
                toast(`Saved: ${ch.name}`, "success");
            })}>
                Use my current voice channel
            </Button>
        </div>
    );
}, { message: "StayInCall settings failed to load. Check the console for details." });

let afk = false;
let timer: ReturnType<typeof setInterval> | null = null;
let attempts: number[] = [];
let consecutiveErrors = 0;
let didMute = false;
let didDeafen = false;
let autoEnableDone = false;

function targetChannel() {
    const { guildId, channelId } = settings.store;
    const ch = channelId ? ChannelStore.getChannel(channelId) : null;
    if (!ch) return null;
    if (guildId && ch.guild_id !== guildId) return null;
    return ch;
}

function check() {
    const ch = targetChannel();
    if (!ch) return;
    if (SelectedChannelStore.getVoiceChannelId() === ch.id) return;

    const now = Date.now();
    attempts = attempts.filter(t => now - t < RETRY_WINDOW);
    if (attempts.length >= getMaxRetries()) {
        setAfk(false, false);
        toast("Too many reconnects — AFK mode disabled", "critical");
        return;
    }
    attempts.push(now);
    VoiceActions.selectVoiceChannel(ch.id);
}

function runCheck() {
    try {
        check();
        consecutiveErrors = 0;
    } catch (e) {
        consecutiveErrors++;
        logger.error(`Reconnect check failed (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`, e);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            setAfk(false, false);
            toast("StayInCall keeps failing — AFK mode disabled (see console)", "critical");
        }
    }
}

function restartTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(runCheck, getInterval());
}

function applyAudio() {
    safe("Muting", () => {
        if (settings.store.mute && !MediaEngineStore.isSelfMute()) {
            AudioActions.toggleSelfMute();
            didMute = true;
        }
        if (settings.store.deafen && !MediaEngineStore.isSelfDeaf()) {
            AudioActions.toggleSelfDeaf();
            didDeafen = true;
        }
    });
}

function restoreAudio() {
    safe("Unmuting", () => {
        if (didDeafen && MediaEngineStore.isSelfDeaf()) AudioActions.toggleSelfDeaf();
        if (didMute && MediaEngineStore.isSelfMute()) AudioActions.toggleSelfMute();
    });
    didMute = didDeafen = false;
}

function setAfk(on: boolean, notify = true) {
    if (timer) clearInterval(timer);
    timer = null;

    if (!on) {
        const wasOn = afk;
        afk = false;
        if (wasOn) restoreAudio();
        if (notify) toast("AFK mode off");
        return;
    }

    const ch = safe("Finding channel", targetChannel);
    if (!ch) {
        afk = false;
        if (notify) toast("Set a valid voice channel first", "critical");
        return;
    }

    afk = true;
    attempts = [];
    consecutiveErrors = 0;
    runCheck();
    restartTimer();
    applyAudio();

    const guild = safe("Finding server", () => GuildStore.getGuild(ch.guild_id));
    if (notify) toast(`AFK mode on: ${guild?.name ?? "?"} / ${ch.name}`, "success");
}

function matches(e: KeyboardEvent, combo: string) {
    const parts = (combo ?? "").toLowerCase().split("+").map(p => p.trim()).filter(Boolean);
    const key = parts.pop();
    if (!key) return false;
    const pressed = e.key === " " ? "space" : e.key.toLowerCase();
    return pressed === key
        && e.ctrlKey === parts.includes("ctrl")
        && e.shiftKey === parts.includes("shift")
        && e.altKey === parts.includes("alt")
        && e.metaKey === parts.includes("meta");
}

function onKey(e: KeyboardEvent) {
    if (e.repeat) return;
    safe("Keybind", () => {
        if (matches(e, settings.store.keybind)) setAfk(!afk);
    });
}

function tryAutoEnable() {
    if (autoEnableDone || afk || !settings.store.autoEnable) return;
    if (!safe("Startup check", () => UserStore.getCurrentUser())) return;
    autoEnableDone = true;
    setAfk(true);
}

export default definePlugin({
    name: "StayInCall",
    description: "Stays in a chosen voice channel, auto-reconnects, and toggles AFK mode with a keybind",
    authors: [{ name: "ShuShuzinhuu", id: 530917459125993482n }],
    settings,
    flux: {
        CONNECTION_OPEN: tryAutoEnable
    },
    start() {
        autoEnableDone = false;
        document.addEventListener("keydown", onKey);
        tryAutoEnable();
    },
    stop() {
        document.removeEventListener("keydown", onKey);
        setAfk(false, false);
    }
});
