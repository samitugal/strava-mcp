import { z } from "zod";
import { getAllActivities as fetchAllActivities, getValidToken } from "../stravaClient.js";

// Common activity types
export const ACTIVITY_TYPES = {
    // Core types
    RIDE: "Ride",
    RUN: "Run", 
    SWIM: "Swim",
    
    // Common types
    WALK: "Walk",
    HIKE: "Hike",
    VIRTUAL_RIDE: "VirtualRide",
    VIRTUAL_RUN: "VirtualRun",
    WORKOUT: "Workout",
    WEIGHT_TRAINING: "WeightTraining",
    YOGA: "Yoga",
    
    // Winter sports
    ALPINE_SKI: "AlpineSki",
    BACKCOUNTRY_SKI: "BackcountrySki",
    NORDIC_SKI: "NordicSki",
    SNOWBOARD: "Snowboard",
    ICE_SKATE: "IceSkate",
    
    // Water sports
    KAYAKING: "Kayaking",
    ROWING: "Rowing",
    STAND_UP_PADDLING: "StandUpPaddling",
    SURFING: "Surfing",
    
    // Other
    GOLF: "Golf",
    ROCK_CLIMBING: "RockClimbing",
    SOCCER: "Soccer",
    ELLIPTICAL: "Elliptical",
    STAIR_STEPPER: "StairStepper"
} as const;

// Common sport types (more granular)
export const SPORT_TYPES = {
    MOUNTAIN_BIKE_RIDE: "MountainBikeRide",
    GRAVEL_RIDE: "GravelRide",
    E_BIKE_RIDE: "EBikeRide",
    TRAIL_RUN: "TrailRun",
    VIRTUAL_RIDE: "VirtualRide",
    VIRTUAL_RUN: "VirtualRun"
} as const;

const GetAllActivitiesInputSchema = z.object({
    startDate: z.string().optional().describe("ISO date string for activities after this date (e.g., '2024-01-01')"),
    endDate: z.string().optional().describe("ISO date string for activities before this date (e.g., '2024-12-31')"),
    activityTypes: z.array(z.string()).optional().describe("Array of activity types to filter (e.g., ['Run', 'Ride'])"),
    sportTypes: z.array(z.string()).optional().describe("Array of sport types for granular filtering (e.g., ['MountainBikeRide', 'TrailRun'])"),
    summaryMode: z.boolean().optional().default(false).describe("Return aggregated statistics instead of activity list. Includes totals, averages, bests, and weekly/monthly breakdowns."),
    maxActivities: z.number().int().positive().optional().default(500).describe("Maximum activities to return after filtering (default: 500)"),
    maxApiCalls: z.number().int().positive().optional().default(10).describe("Maximum API calls to prevent quota exhaustion (default: 10 = ~2000 activities)"),
    perPage: z.number().int().positive().min(1).max(200).optional().default(200).describe("Activities per API call (default: 200, max: 200)")
});

type GetAllActivitiesInput = z.infer<typeof GetAllActivitiesInputSchema>;

// Helper function to format activity summary
function formatActivitySummary(activity: any): string {
    const date = activity.start_date ? new Date(activity.start_date).toLocaleDateString() : 'N/A';
    const distance = activity.distance ? `${(activity.distance / 1000).toFixed(2)} km` : 'N/A';
    const duration = activity.moving_time ? formatDuration(activity.moving_time) : 'N/A';
    const type = activity.sport_type || activity.type || 'Unknown';
    const activityId = activity.id ?? 'N/A';

    const stravaUrl = activityId !== 'N/A' ? `https://www.strava.com/activities/${activityId}` : '';
    return `${type} ${activity.name} (ID: ${activityId}) - ${distance} in ${duration} on ${date}${stravaUrl ? `\n   URL: ${stravaUrl}` : ''}`;
}

// Helper function to format duration
function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
}

// ── Summary mode helpers ──────────────────────────────────────────────────────

function getWeekKey(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    // Monday as week start
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.toISOString().slice(0, 10); // "YYYY-MM-DD" of the Monday
}

function getMonthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(key: string): string {
    const [year, month] = key.split('-');
    const d = new Date(Number(year), Number(month) - 1, 1);
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

function formatWeekLabel(mondayStr: string): string {
    const start = new Date(mondayStr);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`;
    return `${fmt(start)} – ${fmt(end)}`;
}

function formatPace(metersPerSec: number): string {
    if (!metersPerSec || metersPerSec <= 0) return '—';
    const secPerKm = 1000 / metersPerSec;
    const min = Math.floor(secPerKm / 60);
    const sec = Math.round(secPerKm % 60);
    return `${min}:${String(sec).padStart(2, '0')} /km`;
}

interface BucketStats {
    count: number;
    distance: number;   // meters
    movingTime: number; // seconds
    elevation: number;  // meters
    hrSum: number;
    hrCount: number;
    speedSum: number;
    speedCount: number;
}

function emptyBucket(): BucketStats {
    return { count: 0, distance: 0, movingTime: 0, elevation: 0, hrSum: 0, hrCount: 0, speedSum: 0, speedCount: 0 };
}

function addToBucket(b: BucketStats, a: any): void {
    b.count++;
    b.distance += a.distance || 0;
    b.movingTime += a.moving_time || 0;
    b.elevation += a.total_elevation_gain || 0;
    if (a.average_heartrate) { b.hrSum += a.average_heartrate; b.hrCount++; }
    if (a.average_speed) { b.speedSum += a.average_speed; b.speedCount++; }
}

function bucketRow(label: string, b: BucketStats): string {
    const dist = `${(b.distance / 1000).toFixed(1)} km`;
    const time = formatDuration(b.movingTime);
    const elev = `${Math.round(b.elevation)} m`;
    const hr = b.hrCount ? `${Math.round(b.hrSum / b.hrCount)} bpm` : '—';
    const avgSpeed = b.speedCount ? b.speedSum / b.speedCount : 0;
    const pace = avgSpeed ? formatPace(avgSpeed) : '—';
    return `| ${label} | ${b.count} | ${dist} | ${time} | ${elev} | ${hr} | ${pace} |`;
}

function computeSummary(activities: any[]): string {
    if (activities.length === 0) return 'No activities found.';

    // ── Overall totals ────────────────────────────────────────────────────────
    const total = emptyBucket();
    let bestDist = { val: 0, name: '', date: '' };
    let bestElev = { val: 0, name: '', date: '' };
    let bestPace = { val: 0, name: '', date: '' }; // highest speed = best pace

    const byType: Record<string, BucketStats> = {};
    const byMonth: Record<string, BucketStats> = {};
    const byWeek: Record<string, BucketStats> = {};

    for (const a of activities) {
        addToBucket(total, a);

        // By type
        const type = a.sport_type || a.type || 'Unknown';
        if (!byType[type]) byType[type] = emptyBucket();
        addToBucket(byType[type], a);

        // By month / week
        const date = new Date(a.start_date || a.start_date_local || 0);
        const mk = getMonthKey(date);
        const wk = getWeekKey(date);
        if (!byMonth[mk]) byMonth[mk] = emptyBucket();
        if (!byWeek[wk]) byWeek[wk] = emptyBucket();
        addToBucket(byMonth[mk]!, a);
        addToBucket(byWeek[wk]!, a);

        // Bests
        const dist = a.distance || 0;
        const elev = a.total_elevation_gain || 0;
        const speed = a.average_speed || 0;
        const label = a.name || 'Activity';
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        if (dist > bestDist.val) bestDist = { val: dist, name: label, date: dateStr };
        if (elev > bestElev.val) bestElev = { val: elev, name: label, date: dateStr };
        if (speed > bestPace.val) bestPace = { val: speed, name: label, date: dateStr };
    }

    const avgHr = total.hrCount ? Math.round(total.hrSum / total.hrCount) : null;
    const avgSpeedAll = total.speedCount ? total.speedSum / total.speedCount : 0;
    const tableHeader = `| Period | Acts | Distance | Moving Time | Elevation | Avg HR | Avg Pace |\n|--------|------|----------|-------------|-----------|--------|----------|`;

    // ── Overview table ────────────────────────────────────────────────────────
    let out = `## Summary\n\n`;
    out += `| Metric | Value |\n|--------|-------|\n`;
    out += `| Total activities | ${total.count} |\n`;
    out += `| Total distance | ${(total.distance / 1000).toFixed(1)} km |\n`;
    out += `| Total moving time | ${formatDuration(total.movingTime)} |\n`;
    out += `| Total elevation gain | ${Math.round(total.elevation)} m |\n`;
    if (avgHr) out += `| Avg heart rate | ${avgHr} bpm |\n`;
    if (avgSpeedAll) out += `| Avg pace | ${formatPace(avgSpeedAll)} |\n`;

    // ── Bests ─────────────────────────────────────────────────────────────────
    out += `\n## Personal Bests\n\n`;
    out += `| Category | Activity | Value | Date |\n|----------|----------|-------|------|\n`;
    if (bestDist.val) out += `| Longest | ${bestDist.name} | ${(bestDist.val / 1000).toFixed(2)} km | ${bestDist.date} |\n`;
    if (bestElev.val) out += `| Most elevation | ${bestElev.name} | ${Math.round(bestElev.val)} m | ${bestElev.date} |\n`;
    if (bestPace.val) out += `| Fastest pace | ${bestPace.name} | ${formatPace(bestPace.val)} | ${bestPace.date} |\n`;

    // ── By activity type ──────────────────────────────────────────────────────
    out += `\n## By Activity Type\n\n${tableHeader}\n`;
    for (const [type, b] of Object.entries(byType).sort((a, b) => b[1].count - a[1].count)) {
        out += bucketRow(type, b) + '\n';
    }

    // ── Monthly breakdown ─────────────────────────────────────────────────────
    out += `\n## Monthly Breakdown\n\n${tableHeader}\n`;
    for (const mk of Object.keys(byMonth).sort()) {
        out += bucketRow(formatMonthLabel(mk), byMonth[mk]!) + '\n';
    }

    // ── Weekly breakdown ──────────────────────────────────────────────────────
    const weekKeys = Object.keys(byWeek).sort();
    out += `\n## Weekly Breakdown\n\n${tableHeader}\n`;
    for (const wk of weekKeys) {
        out += bucketRow(formatWeekLabel(wk), byWeek[wk]!) + '\n';
    }

    return out;
}

// Export the tool definition
export const getAllActivities = {
    name: "get-all-activities",
    description: "Fetches activity history with optional filtering by date range and activity type. Set summaryMode=true to get aggregated statistics (totals, averages, bests, monthly/weekly breakdowns) instead of a list.",
    inputSchema: GetAllActivitiesInputSchema,
    execute: async (input: GetAllActivitiesInput) => {
        let token: string;
        try {
            token = await getValidToken();
        } catch (error) {
            return {
                content: [{ type: "text" as const, text: `❌ ${error instanceof Error ? error.message : 'Authentication failed. Use the connect-strava tool to link your Strava account.'}` }],
                isError: true
            };
        }

        const {
            startDate,
            endDate,
            activityTypes,
            sportTypes,
            summaryMode = false,
            maxActivities = 500,
            maxApiCalls = 10,
            perPage = 200
        } = input;

        try {
            // Convert dates to epoch timestamps if provided
            const before = endDate ? Math.floor(new Date(endDate).getTime() / 1000) : undefined;
            const after = startDate ? Math.floor(new Date(startDate).getTime() / 1000) : undefined;
            
            // Validate date inputs
            if (before && isNaN(before)) {
                return {
                    content: [{ type: "text" as const, text: "❌ Invalid endDate format. Please use ISO date format (e.g., '2024-12-31')." }],
                    isError: true
                };
            }
            if (after && isNaN(after)) {
                return {
                    content: [{ type: "text" as const, text: "❌ Invalid startDate format. Please use ISO date format (e.g., '2024-01-01')." }],
                    isError: true
                };
            }

            console.error(`Fetching activities with filters:`);
            console.error(`  Date range: ${startDate || 'any'} to ${endDate || 'any'}`);
            console.error(`  Activity types: ${activityTypes?.join(', ') || 'any'}`);
            console.error(`  Sport types: ${sportTypes?.join(', ') || 'any'}`);
            console.error(`  Max activities: ${maxActivities}, Max API calls: ${maxApiCalls}`);

            const allActivities: any[] = [];
            const filteredActivities: any[] = [];
            let apiCalls = 0;
            let currentPage = 1;
            let hasMore = true;

            // Progress callback
            const onProgress = (fetched: number, page: number) => {
                console.error(`  Page ${page}: Fetched ${fetched} total activities...`);
            };

            // Fetch activities page by page
            while (hasMore && apiCalls < maxApiCalls && filteredActivities.length < maxActivities) {
                apiCalls++;
                
                // Fetch a page of activities
                const pageActivities = await fetchAllActivities(token, {
                    page: currentPage,
                    perPage,
                    before,
                    after,
                    onProgress
                });

                // Check if we got any activities
                if (pageActivities.length === 0) {
                    hasMore = false;
                    break;
                }

                // Add to all activities
                allActivities.push(...pageActivities);

                // Apply filters if specified
                let toFilter = pageActivities;
                
                // Filter by activity type
                if (activityTypes && activityTypes.length > 0) {
                    toFilter = toFilter.filter(a => 
                        activityTypes.some(type => 
                            a.type?.toLowerCase() === type.toLowerCase()
                        )
                    );
                }
                
                // Filter by sport type (more specific)
                if (sportTypes && sportTypes.length > 0) {
                    toFilter = toFilter.filter(a => 
                        sportTypes.some(type => 
                            a.sport_type?.toLowerCase() === type.toLowerCase()
                        )
                    );
                }

                // Add filtered activities
                filteredActivities.push(...toFilter);

                // Check if we should continue
                hasMore = pageActivities.length === perPage;
                currentPage++;

                // Log progress
                console.error(`  After page ${currentPage - 1}: ${allActivities.length} fetched, ${filteredActivities.length} match filters`);
            }

            // Limit results to maxActivities
            const resultsToReturn = filteredActivities.slice(0, maxActivities);

            // Prepare summary statistics
            const stats = {
                totalFetched: allActivities.length,
                totalMatching: filteredActivities.length,
                returned: resultsToReturn.length,
                apiCalls: apiCalls
            };

            console.error(`\nFetch complete:`);
            console.error(`  Total activities fetched: ${stats.totalFetched}`);
            console.error(`  Activities matching filters: ${stats.totalMatching}`);
            console.error(`  Activities returned: ${stats.returned}`);
            console.error(`  API calls made: ${stats.apiCalls}`);

            if (resultsToReturn.length === 0) {
                return {
                    content: [{
                        type: "text" as const,
                        text: `No activities found matching your criteria.\n\nStatistics:\n- Fetched ${stats.totalFetched} activities\n- ${stats.totalMatching} matched filters\n- Used ${stats.apiCalls} API calls`
                    }]
                };
            }

            // Summary mode — return aggregated stats tables
            if (summaryMode) {
                const summaryText = computeSummary(resultsToReturn);
                return {
                    content: [{ type: "text" as const, text: summaryText }]
                };
            }

            // List mode — format activities for display
            const summaries = resultsToReturn.map(activity => formatActivitySummary(activity));

            let responseText = `**Found ${stats.returned} activities**\n\n`;
            responseText += `📊 Statistics:\n`;
            responseText += `- Total fetched: ${stats.totalFetched}\n`;
            responseText += `- Matching filters: ${stats.totalMatching}\n`;
            responseText += `- API calls: ${stats.apiCalls}\n\n`;

            if (stats.returned < stats.totalMatching) {
                responseText += `⚠️ Showing first ${stats.returned} of ${stats.totalMatching} matching activities (limited by maxActivities)\n\n`;
            }

            responseText += `**Activities:**\n${summaries.join('\n')}`;

            return {
                content: [{ type: "text" as const, text: responseText }]
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
            console.error("Error in get-all-activities tool:", errorMessage);
            
            // Check for rate limiting
            if (errorMessage.includes('429')) {
                return {
                    content: [{ 
                        type: "text" as const, 
                        text: `⚠️ Rate limit reached. Please wait a few minutes before trying again.\n\nStrava API limits: 100 requests per 15 minutes, 1000 per day.` 
                    }],
                    isError: true,
                };
            }
            
            return {
                content: [{ type: "text" as const, text: `❌ API Error: ${errorMessage}` }],
                isError: true,
            };
        }
    }
};
