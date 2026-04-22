import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Config file location: ~/.config/strava-mcp/config.json
const CONFIG_DIR = path.join(os.homedir(), '.config', 'strava-mcp');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface StravaConfig {
    clientId?: string;
    clientSecret?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
}

/**
 * Ensures the config directory exists
 */
async function ensureConfigDir(): Promise<void> {
    try {
        await fs.mkdir(CONFIG_DIR, { recursive: true });
    } catch (error) {
        // Directory might already exist, that's fine
    }
}

/**
 * Loads config from the JSON file
 */
async function loadConfigFile(): Promise<StravaConfig> {
    try {
        const content = await fs.readFile(CONFIG_FILE, 'utf-8');
        return JSON.parse(content) as StravaConfig;
    } catch {
        return {};
    }
}

/**
 * Saves config to the JSON file
 */
export async function saveConfig(config: StravaConfig): Promise<void> {
    await ensureConfigDir();

    // Merge with existing config
    const existing = await loadConfigFile();
    const merged = { ...existing, ...config };

    await fs.writeFile(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

/**
 * Loads Strava configuration from multiple sources.
 *
 * Token priority (access/refresh tokens): config file > environment variables.
 *   Rationale: Strava rotates refresh tokens on every refresh and tokens can be
 *   refreshed mid-session. The file is updated on each refresh, while env vars
 *   supplied by MCP clients (e.g. Claude Desktop) are static and become stale
 *   after the first rotation. Env vars act only as a bootstrap fallback.
 *
 * Client credentials priority: environment variables > config file.
 *   Rationale: these are long-lived and typically provisioned via env.
 */
export async function loadConfig(): Promise<StravaConfig> {
    // Load from config file first
    const fileConfig = await loadConfigFile();

    // The config file is the source of truth for tokens once the user has
    // connected. Strava rotates refresh tokens on every refresh, and tokens
    // may be refreshed mid-session — so any value from the file is newer than
    // the static env var supplied by the MCP client config. Env vars only
    // act as a fallback for the initial bootstrap (before the file exists).
    const accessToken = fileConfig.accessToken || process.env.STRAVA_ACCESS_TOKEN;
    const refreshToken = fileConfig.refreshToken || process.env.STRAVA_REFRESH_TOKEN;

    const config: StravaConfig = {
        clientId: process.env.STRAVA_CLIENT_ID || fileConfig.clientId,
        clientSecret: process.env.STRAVA_CLIENT_SECRET || fileConfig.clientSecret,
        accessToken,
        refreshToken,
        expiresAt: fileConfig.expiresAt,
    };

    return config;
}

/**
 * Updates tokens in both the config file and process.env
 */
export async function updateTokens(accessToken: string, refreshToken: string, expiresAt?: number): Promise<void> {
    // Update process.env for current session
    process.env.STRAVA_ACCESS_TOKEN = accessToken;
    process.env.STRAVA_REFRESH_TOKEN = refreshToken;

    // Save to config file for persistence
    await saveConfig({
        accessToken,
        refreshToken,
        expiresAt,
    });
}

/**
 * Saves client credentials to the config file
 */
export async function saveClientCredentials(clientId: string, clientSecret: string): Promise<void> {
    await saveConfig({
        clientId,
        clientSecret,
    });
}

/**
 * Checks if we have the minimum required config for authentication
 */
export function hasClientCredentials(config: StravaConfig): boolean {
    return !!(config.clientId && config.clientSecret);
}

/**
 * Checks if we have valid tokens
 */
export function hasValidTokens(config: StravaConfig): boolean {
    return !!(config.accessToken && config.refreshToken);
}

/**
 * Gets the config file path (useful for display to users)
 */
export function getConfigPath(): string {
    return CONFIG_FILE;
}

/**
 * Clears all stored config (useful for logout/reset)
 */
export async function clearConfig(): Promise<void> {
    try {
        await fs.unlink(CONFIG_FILE);
    } catch {
        // File might not exist, that's fine
    }
}

/**
 * Clears only client credentials (clientId/clientSecret) while preserving tokens
 */
export async function clearClientCredentials(): Promise<void> {
    try {
        const existing = await loadConfigFile();
        delete existing.clientId;
        delete existing.clientSecret;
        await ensureConfigDir();
        await fs.writeFile(CONFIG_FILE, JSON.stringify(existing, null, 2), 'utf-8');
    } catch {
        // loadConfigFile handles missing/corrupted files internally (returns {}),
        // so this catch only covers writeFile failures (e.g. permission issues).
        // In that case, old credentials remain in config.json
        // the user will need to manually delete the file or fix permissions.
    }
}
