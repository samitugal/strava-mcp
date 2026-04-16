import { z } from "zod";
import { getActivityLaps as getActivityLapsClient, getValidToken } from "../stravaClient.js";
import { formatDuration } from "../server.js"; // Import helper

const name = "get-activity-laps";

const description = "Returns per-lap metrics (time, distance, speed, heart rate, cadence, power) for a specific activity.";

const inputSchema = z.object({
    activityId: z.coerce.number().int().positive().describe("The unique identifier of the activity to fetch laps for."),
});

type GetActivityLapsInput = z.infer<typeof inputSchema>;

export const getActivityLapsTool = {
    name,
    description,
    inputSchema,
    execute: async ({ activityId }: GetActivityLapsInput) => {
        let token: string;
        try {
            token = await getValidToken();
        } catch (error) {
            return {
                content: [{ type: "text" as const, text: `❌ ${error instanceof Error ? error.message : 'Authentication failed. Use the connect-strava tool to link your Strava account.'}` }],
                isError: true
            };
        }

        try {
            console.error(`Fetching laps for activity ID: ${activityId}...`);
            const laps = await getActivityLapsClient(token, activityId);

            if (!laps || laps.length === 0) {
                return {
                    content: [{ type: "text" as const, text: `✅ No laps found for activity ID: ${activityId}` }]
                };
            }

            // Generate human-readable summary
            const lapSummaries = laps.map(lap => {
                const details = [
                    `Lap ${lap.lap_index}: ${lap.name || 'Unnamed Lap'}`,
                    `  Time: ${formatDuration(lap.elapsed_time)} (Moving: ${formatDuration(lap.moving_time)})`,
                    `  Distance: ${(lap.distance / 1000).toFixed(2)} km`,
                    `  Avg Speed: ${lap.average_speed ? (lap.average_speed * 3.6).toFixed(2) + ' km/h' : 'N/A'}`,
                    `  Max Speed: ${lap.max_speed ? (lap.max_speed * 3.6).toFixed(2) + ' km/h' : 'N/A'}`,
                    lap.total_elevation_gain ? `  Elevation Gain: ${lap.total_elevation_gain.toFixed(1)} m` : null,
                    lap.average_heartrate ? `  Avg HR: ${lap.average_heartrate.toFixed(1)} bpm` : null,
                    lap.max_heartrate ? `  Max HR: ${lap.max_heartrate} bpm` : null,
                    lap.average_cadence ? `  Avg Cadence: ${lap.average_cadence.toFixed(1)} rpm` : null,
                    lap.average_watts ? `  Avg Power: ${lap.average_watts.toFixed(1)} W ${lap.device_watts ? '(Sensor)' : ''}` : null,
                ];
                return details.filter(d => d !== null).join('\n');
            });

            const summaryText = `Activity Laps Summary (ID: ${activityId}):\n\n${lapSummaries.join('\n\n')}`;
            
            // Add raw data section
            const rawDataText = `\n\nComplete Lap Data:\n${JSON.stringify(laps, null, 2)}`;
            
            console.error(`Successfully fetched ${laps.length} laps for activity ${activityId}`);
            
            return {
                content: [
                    { type: "text" as const, text: summaryText },
                    { type: "text" as const, text: rawDataText }
                ]
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error fetching laps for activity ${activityId}: ${errorMessage}`);
            const userFriendlyMessage = errorMessage.includes("Record Not Found") || errorMessage.includes("404")
                ? `Activity with ID ${activityId} not found.`
                : `An unexpected error occurred while fetching laps for activity ${activityId}. Details: ${errorMessage}`;
            return {
                content: [{ type: "text" as const, text: `❌ ${userFriendlyMessage}` }],
                isError: true
            };
        }
    }
}; 