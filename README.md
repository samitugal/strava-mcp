# Strava MCP Server

**Talk to your Strava data using AI.**

Connect Claude to your Strava account and ask questions in plain English: "How far did I run this month?", "Analyze my last ride", or "Show me my fastest segments."

> **This is a fork of [r-huijts/strava-mcp](https://github.com/r-huijts/strava-mcp).**
> See [What's different in this fork](#whats-different-in-this-fork) for the full list of changes.

---

## What's Different in This Fork

### 🔑 Auto-Authentication — No More "Connect my Strava"

The original requires you to run `connect-strava` every time your token expires. This fork handles it automatically:

- **Proactive refresh**: If your token expires within 5 minutes, it's refreshed before the API call.
- **Reactive refresh**: Any `401` response triggers a silent token refresh and retries the request — you never see an auth error mid-session.
- **Persistent tokens**: After a refresh, the new token is saved to `~/.config/strava-mcp/config.json`. On the next server restart, the saved (valid) token is preferred over the potentially-stale token in your env/config file. You stay logged in.

Set your credentials once in `claude_desktop_config.json` with `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_ACCESS_TOKEN`, and `STRAVA_REFRESH_TOKEN` — the server handles the rest.

### 🗺️ New Tool: `find-nearby-routes`

Find your saved Strava routes that start near a location, sorted by distance:

> "Show me my routes within 15 km of Istanbul"
> "Find cycling routes near 48.8566, 2.3522"

Parameters: `latitude`, `longitude`, `maxDistanceKm` (default: 10 km), optional `activityType` (ride/run).

Uses the [Haversine formula](https://en.wikipedia.org/wiki/Haversine_formula) to calculate great-circle distances. Automatically paginates through all your saved routes.

### 🐛 Bug Fixes

- **`z.coerce.number()` for all ID parameters**: Claude serializes tool parameters as strings. The original used `z.number()` which rejected them with `Expected number, received string`. All ID params (`activityId`, `segmentId`, `effortId`, `athleteId`) now use `z.coerce.number()`.
- **Consistent `activityId` naming**: `getActivityLaps` and `getActivityStreams` previously used `id` in their schemas, causing `Required, received undefined` errors when Claude passed `activityId`. Renamed to match.

### 📝 Improved Tool Descriptions & Error Messages

- All tool descriptions use active voice and describe what fields are returned, so Claude chooses the right tool more reliably.
- Removed "Obtain this ID first by calling..." meta-hints that caused unnecessary chained calls.
- All 26 tools return consistent, user-friendly error messages.

---

## What Can You Do With This?

Once connected, just talk to Claude like you're talking to a friend who has access to all your Strava data:

### 🏃 Track Your Progress
> "How many kilometers did I run this month?"
>
> "Compare my running stats from January to December"
>
> "What's my longest ride ever?"

### 📊 Analyze Your Workouts
> "Break down my last cycling workout - show me power, heart rate, and cadence"
>
> "How did my heart rate zones look during yesterday's run?"
>
> "What was my average pace for each lap in my interval training?"

### 🗺️ Explore Routes & Segments
> "Find my saved routes within 20 km of my location"
>
> "What are the most popular cycling segments near Central Park?"
>
> "Export my Sunday morning route as a GPX file"

### 🏆 Get Coaching Insights
> "Analyze my training load this week"
>
> "How does my current fitness compare to last month?"
>
> "Give me a summary of my cycling performance this year"

---

## Quick Start (3 Steps)

### Step 1: Add to Claude Desktop

Open your Claude Desktop configuration file:
- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add this to the file:

```json
{
  "mcpServers": {
    "strava": {
      "command": "npx",
      "args": ["-y", "@stugal/strava-mcp-server"],
      "env": {
        "STRAVA_CLIENT_ID": "your_client_id",
        "STRAVA_CLIENT_SECRET": "your_client_secret",
        "STRAVA_ACCESS_TOKEN": "your_access_token",
        "STRAVA_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

Setting the env vars here means you never need to run `connect-strava` — tokens are refreshed automatically.

### Step 1 (alternative): Add to Claude Code

```
claude mcp add --transport stdio strava -- npx @stugal/strava-mcp-server
```

### Step 2: Restart Claude Desktop

Close and reopen Claude Desktop to load the new configuration.

### Step 3: Start Talking

That's it! Ask Claude about your Strava data directly. If you provided credentials in Step 1, you're already authenticated.

If you didn't set env vars, say:

> **"Connect my Strava account"**

---

## Connecting Your Strava Account

### Getting Your Strava API Credentials

You need to create a free Strava API application (one-time setup):

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Click "Create an App" (or view your existing app)
3. Fill in the form:
   - **Application Name**: Anything you want (e.g., "My Claude Assistant")
   - **Category**: Choose any
   - **Website**: Can be anything (e.g., `http://localhost`)
   - **Authorization Callback Domain**: Must be `localhost`
4. Copy your **Client ID** and **Client Secret**

### Getting Your Access & Refresh Tokens

Run the initial OAuth flow once to get your tokens:

1. Add only `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` to your config
2. Say "Connect my Strava account" — a browser window opens
3. Authorize the app on Strava
4. Your tokens are saved to `~/.config/strava-mcp/config.json`
5. Copy them from there into your `claude_desktop_config.json` env block

After this one-time setup, token refresh is fully automatic.

### Managing Your Connection

- **Check status**: "Am I connected to Strava?"
- **Force reconnect**: "Connect my Strava account"
- **Disconnect**: "Disconnect my Strava account"

---

## Installation Options

### Option A: Just Use It (Recommended)

No installation needed! The `npx` command automatically downloads and runs the latest version.

### Option B: Install Globally

```bash
npm install -g @stugal/strava-mcp-server
```

### Option C: Build from Source

```bash
git clone https://github.com/samitugal/strava-mcp.git
cd strava-mcp
npm install
npm run build
```

Then point Claude to your local build:

```json
{
  "mcpServers": {
    "strava": {
      "command": "node",
      "args": ["/path/to/strava-mcp/dist/server.js"]
    }
  }
}
```

---

## Available Tools

### Account & Profile

| What you can ask | What it does |
|------------------|--------------|
| "Connect my Strava account" | Links your Strava to Claude |
| "Check my Strava connection" | Shows connection status |
| "Get my Strava profile" | Shows your profile info |
| "What shoes do I have?" | Lists your shoes and usage distance |
| "What are my training zones?" | Shows HR and power zones |

### Activities

| What you can ask | What it does |
|------------------|--------------|
| "Show my recent activities" | Lists your latest workouts |
| "Get all my runs from January" | Fetches activities with filters |
| "Analyze activity 12345" | Distance, time, elevation, pace, HR, cadence, power |
| "Show the laps from my last run" | Per-lap time, distance, speed, HR, cadence, power |
| "Get heart rate data from my ride" | Time-series streams at configurable resolution |
| "Show photos from my hike" | Activity photos |

### Stats & Progress

| What you can ask | What it does |
|------------------|--------------|
| "What are my running stats?" | Recent, YTD, and all-time totals |
| "How far have I cycled this year?" | Activity totals by type |

### Routes *(includes new tool)*

| What you can ask | What it does |
|------------------|--------------|
| "Find routes within 10 km of [location]" | **NEW** — nearby routes by lat/lng + max distance |
| "List my saved routes" | Your created routes |
| "Get details for my [route name]" | Route info |
| "Export [route] as GPX" | Download for GPS devices |
| "Export [route] as TCX" | Download for GPS devices |

### Segments

| What you can ask | What it does |
|------------------|--------------|
| "Show my starred segments" | Your favorite segments |
| "Find segments near [location]" | Popular segments in a bounding box |
| "Get details on segment 12345" | Location, distance, grade, elevation, effort counts |
| "Star this segment" | Save to favorites |
| "Show my efforts on [segment]" | Your attempts with time, distance, PR/KOM rank |
| "Show the leaderboard for segment 12345" | Top times with optional filters |

### Clubs

| What you can ask | What it does |
|------------------|--------------|
| "What clubs am I in?" | Lists your Strava clubs |

---

## Troubleshooting

### Token errors after restart

This fork saves refreshed tokens to `~/.config/strava-mcp/config.json` and prefers them over env var tokens on restart. If you're still seeing auth errors, delete the config file and re-authenticate:

```bash
rm ~/.config/strava-mcp/config.json
```

Then say "Connect my Strava account".

### First npx run is slow

`npx` downloads the package on first run (~30 seconds). Subsequent runs use the cache and start immediately.

### Claude doesn't see the Strava tools

- Make sure your `claude_desktop_config.json` is valid JSON (no trailing commas!)
- Restart Claude Desktop after config changes
- Verify with: `npx -y @stugal/strava-mcp-server` — you should see the server start message

### "Scope not found" or similar npm errors

Make sure you're using `@stugal/strava-mcp-server`, not the original `@r-huijts/strava-mcp-server`.

---

## For Developers

<details>
<summary>Click to expand technical details</summary>

### Environment Variables

| Variable | Description |
|----------|-------------|
| `STRAVA_CLIENT_ID` | Your Strava Application Client ID |
| `STRAVA_CLIENT_SECRET` | Your Strava Application Client Secret |
| `STRAVA_ACCESS_TOKEN` | OAuth access token |
| `STRAVA_REFRESH_TOKEN` | OAuth refresh token |

### Token Refresh Flow

1. `getValidToken()` is called at the start of every tool execution
2. If `expiresAt` is known and within 5 minutes, token is proactively refreshed
3. If no token exists but refresh token does, refresh is attempted automatically
4. Any `401` response from the API triggers `handleApiError()` → silent refresh → retry
5. Refreshed tokens are saved to both `process.env` and `~/.config/strava-mcp/config.json`
6. On next server start, `loadConfig()` prefers the saved file token if it's still valid

### Config Priority

1. `~/.config/strava-mcp/config.json` — if token is valid (not expired) ← **new behavior**
2. Environment variables
3. Local `.env` file

### Building & Testing

```bash
npm install
npm run build
npm test
```

### Activity Streams Optimization

The `get-activity-streams` tool uses a compact format by default, reducing payload size by ~70-80%:

- **Compact format** (default): Raw arrays with metadata, ideal for LLM processing
- **Verbose format**: Human-readable objects with formatted values
- **Smart chunking**: Large activities split into ~50KB chunks
- **Intelligent downsampling**: Reduces large datasets while preserving peaks and valleys

### API Reference

The server implements the Model Context Protocol (MCP) and exposes **26 tools** for Strava API v3. See `src/tools/` for implementation details.

### Contributing

Contributions welcome! Please submit a Pull Request to [samitugal/strava-mcp](https://github.com/samitugal/strava-mcp).

</details>

---

## Credits

This project is a fork of [r-huijts/strava-mcp](https://github.com/r-huijts/strava-mcp) by Rick Huijts. The original project provides the solid MCP foundation and Strava API integration that this fork builds on.

---

## License

MIT License - see LICENSE file for details.

---

**Questions or issues?** Open an issue on [GitHub](https://github.com/samitugal/strava-mcp/issues).
